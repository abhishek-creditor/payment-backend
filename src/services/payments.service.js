const prisma = require("../utils/prisma");
const productUserDAO = require("../dao/productUser.dao");
const orderDAO = require("../dao/order.dao");
const paymentDAO = require("../dao/payment.dao");
const refundDAO = require("../dao/refund.dao");
const TilledService = require("./tilled.service");
const { buildTilledMetadata } = require("./tilledMetadata.service");

// Assume Tilled SDK instance

/**
 * CREATE PAYMENT
 *
 * State Machine:
 * 1️⃣ DB Transaction → Create Order + Payment(INITIATED)
 * 2️⃣ Commit
 * 3️⃣ Call Tilled with idempotencyKey
 * 4️⃣ Update Payment + Order based on status
 */
exports.createPayment = async (productId, data, options = {}) => {
  const { idempotencyKey } = options;

  const {
    externalUserId,
    productUserId,
    email,
    user_email,
    referenceId,
    plan_code,
    paymentMethod = "CARD",
    tilledAccountId,
    account_id,
    platform_fee_amount,
    items: rawItems,
    extraData = {}
  } = data;

  const resolvedExternalUserId = externalUserId || productUserId;
  const resolvedEmail = email || user_email;
  const resolvedAccountId = tilledAccountId || account_id;
  const normalizedPlanCode = String(plan_code).trim();
  const items = Array.isArray(rawItems)
    ? rawItems
    : Array.isArray(extraData?.items)
      ? extraData.items
      : [];

  const plan = await prisma.productPlan.findFirst({
    where: {
      productId,
      code: normalizedPlanCode,
      isActive: true
    },
    include: {
      product: true
    }
  });
  if (!plan) {
    console.log("Invalid plan_code", normalizedPlanCode);
    throw new Error("Invalid plan_code");
  }
  if (!plan.price || !plan.currency) {
    throw new Error("Invalid plan configuration");
  }
  const amount = plan.price;
  const currency = plan.currency;

  // ---------------------------
  // STEP 1: DB TRANSACTION
  // ---------------------------
  const result = await prisma.$transaction(async (tx) => {
    const productUser = await productUserDAO.upsertProductUser(
      tx,
      productId,
      resolvedExternalUserId,
      resolvedEmail
    );

    const existingOrder = await orderDAO.getOrderByReferenceId(tx, productId, referenceId);

    // ==========================================
    // CASE: ORDER EXISTS
    // ==========================================

    if (existingOrder) {
      const latestPayment = existingOrder.payments?.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      )[0];

      if (!latestPayment) {
        const newPayment = await paymentDAO.createPayment(tx, {
          orderId: existingOrder.id,
          method: paymentMethod,
          status: "INITIATED",
          amount,
        });
        return {
          order: existingOrder,
          payment: newPayment,
          duplicate: false, // Ye naya payment tha. Abhi tak payment create nahi hua tha, to is case me duplicate false hoga.
          productUser,
        };
      }

      // Already paid
      if (latestPayment.status === "SUCCEEDED") {
        return {
          order: existingOrder,
          duplicate: true, // Ye duplicate hai kyunki same referenceId ke saath ek successful payment already exist karta hai. Naya payment create nahi hoga, existing order ko hi reuse karenge.
          payment: latestPayment,
          productUser,
        };
      }

      // Still processing
      if (
        latestPayment.status === "INITIATED" ||
        latestPayment.status === "PROCESSING"
      ) {
        return {
          order: existingOrder,
          payment: latestPayment,
          duplicate: true, // Ye duplicate hai kyunki same referenceId ke saath ek payment already exist karta hai jo abhi processing me hai. Naya payment create nahi hoga, existing order ko hi reuse karenge.
          productUser,
        };
      }

      // Retry allowed
      if (
        latestPayment.status === "FAILED" ||
        latestPayment.status === "CANCELLED"
      ) {
        const newPayment = await paymentDAO.createPayment(tx, {
          orderId: existingOrder.id,
          method: paymentMethod,
          status: "INITIATED",
          amount,
        });
        console.log(`Retrying payment for existing order ${existingOrder.id} with new payment ${newPayment.id}`);
        return {
          order: existingOrder,
          payment: newPayment,
          duplicate: false, // Ye duplicate nahi hai kyunki previous payment failed/cancelled tha, ab naya payment create kar rahe hain. Is case me retry allowed hai aur naya payment create hoga.
          productUser,
        };
      }

      // Fallback: unknown status, treat as duplicate and return latest
      return {
        order: existingOrder,
        payment: latestPayment,
        duplicate: true,
        productUser,
      };
    }

    // ==========================================
    // CASE: ORDER DOES NOT EXIST
    // ==========================================

    const order = await orderDAO.createOrder(tx, {
      productId,
      productUserId: productUser.id,
      planId: plan.id,   //added this as order table expects required relation with plan table for which we need id
      referenceId,
      amount,
      currency,
      status: "CREATED",
      items,
    });

    const payment = await paymentDAO.createPayment(tx, {
      orderId: order.id,
      amount,
      method: paymentMethod,
      status: "INITIATED",
    });

    console.log(`Created new order ${order.id} with payment ${payment.id}`);
    return {
      order,
      payment,
      duplicate: false,
      productUser,
    };
  });

  // ==========================================
  // IF DUPLICATE SUCCESS → RETURN
  // ==========================================

  if (result.duplicate) { // Duplicate case me Tilled call nahi karenge, existing order/payment ko hi reuse karenge.
    const latestPayment = result.order.payments?.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    )[0];

    return {
      ...result.order,
      payments: latestPayment ? [latestPayment] : [],
      duplicate: true, // Ye duplicate hai kyunki same referenceId ke saath ek payment already exist karta hai. Naya payment create nahi hoga, existing order ko hi reuse karenge.
    };
  }
  const { order, payment, productUser } = result;

  // ==========================================
  // STEP 2: CALL TILLED
  // ==========================================

  // IMPORTANT FOR TILLED INTEGRATION TEAM:
  // Before calling Tilled API, update payment status to "PROCESSING".
  // This ensures correct state flow:
  // INITIATED → PROCESSING → (SUCCEEDED / FAILED / CANCELLED)
  // The actual Tilled API call must happen AFTER this update.
    // 3. Create or get Tilled Customer
    let tilledCustomer = null;
    const targetAccountId = resolvedAccountId || process.env.TILLED_SANDBOX_ACCOUNT_ID;
  
    if (productUser.tilledCustomerId) {
      try {
        const getCustomerResponse = await TilledService.getCustomer(productUser.tilledCustomerId, targetAccountId);
        if (getCustomerResponse.statusCode >= 200 && getCustomerResponse.statusCode < 300) {
          tilledCustomer = getCustomerResponse.data;
        }
      } catch (error) {
        console.error(`Could not fetch existing Tilled customer ${productUser.tilledCustomerId}, will create a new one.`);
      }
    }
  
    if (!tilledCustomer) {
      const tilledCustomerResponse = await TilledService.createCustomer({
        email: resolvedEmail,
        first_name: resolvedExternalUserId,
        metadata: {
          externalUserId: resolvedExternalUserId,
          productId: productId
        }
      }, targetAccountId);
      tilledCustomer = tilledCustomerResponse.data;
  
      // Update our DB with this most recent customer ID outside the main transaction
      await productUserDAO.updateTilledCustomerId(null, productUser.id, tilledCustomer.id);
    }
  
    // 4. Create Tilled Checkout Session
    const lineItems = [{
      price_data: {
        currency: currency,
        product_data: {
          name: plan.name || `Plan ${plan.code}` || "Order Payment"
        },
        unit_amount: amount
      },
      quantity: 1
    }];
  
    const tilledMetadata = buildTilledMetadata(order, plan.product, {
      ...extraData,
      planName: plan.name,
      planCode: plan.code,
    });
  
    const checkoutSessionResponse = await TilledService.createCheckoutSession({
      customer_id: tilledCustomer.id,
      line_items: lineItems,
      mode: 'payment',
      success_url: process.env.CLIENT_SUCCESS_URL || `https://www.example.com/success`,
      cancel_url: process.env.CLIENT_CANCEL_URL || `https://www.example.com/cancel`,
      payment_intent_data: {
        description: `Order ${order.id}`,
        setup_future_usage: "off_session",
        payment_method_types: ["card"],
        ...(platform_fee_amount !== undefined && platform_fee_amount !== null && { platform_fee_amount: Number(platform_fee_amount) })
      },
      metadata: tilledMetadata
    }, targetAccountId);
  
    console.log("Checkout Session Response:", checkoutSessionResponse);
  
    const checkoutSession = checkoutSessionResponse.data;
  
    if (checkoutSessionResponse.statusCode >= 400) {
      throw new Error(`Tilled Error: ${checkoutSession.message || checkoutSession.error || 'Failed to create checkout session'}`);
    }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "PROCESSING" },
  });

  let finalStatus = "PROCESSING";

  try {
    // TILLED TEAM: Implement actual Tilled API call here
    // const tilledResponse = await tilled.createPayment(...);

    // After receiving Tilled response,
    // set finalStatus accordingly:
    // finalStatus = "SUCCEEDED" | "FAILED" | "CANCELLED";

    finalStatus = "SUCCEEDED"; // temporary simulation
  } catch (err) {
    finalStatus = "FAILED";
  }

  // ==========================================
  // STEP 3: UPDATE PAYMENT + ORDER
  // ==========================================

  await prisma.$transaction(async (tx) => {
    await paymentDAO.updatePayment(tx, payment.id, {
      status: finalStatus,
    });

    if (finalStatus === "SUCCEEDED") {
      await orderDAO.updateOrder(tx, order.id, {
        status: "PAID",
      });
    }

    if (finalStatus === "FAILED") {
      await orderDAO.updateOrder(tx, order.id, {
        status: "PAYMENT_FAILED",
      });
    }
  });

  return {
    ...order,
    payments: [
      {
        ...payment,
        status: finalStatus,
      },
    ],
    duplicate: false,
  };
};

/**
 * REFUND PAYMENT
 *
 * State Machine:
 * 1️⃣ Validate balance
 * 2️⃣ Create Refund(PENDING)
 * 3️⃣ Commit
 * 4️⃣ Call Tilled
 * 5️⃣ Finalize SUCCEEDED / FAILED
 */
exports.refundPayment = async (
  productId,
  orderId,
  refundData,
  options = {},
) => {
  const { idempotencyKey } = options;
  const { amount, reason } = refundData;

  if (!amount || amount <= 0) {
    const error = new Error("Invalid refund amount");
    error.statusCode = 400;
    throw error;
  }

  const { refund, payment } = await prisma.$transaction(async (tx) => {
    const order = await orderDAO.getOrderByIdAndProduct(
      tx,
      orderId,
      productId,
      { payments: true, refunds: true },
    );

    if (!order) {
      const error = new Error("Order not found");
      error.statusCode = 404;
      throw error;
    }

    const successfulPayment = order.payments.find(
      (p) => p.status === "SUCCEEDED",
    );

    if (!successfulPayment) {
      const error = new Error("No successful payment found");
      error.statusCode = 400;
      throw error;
    }

    const totalRefunded = successfulPayment.refunds.reduce(
      (sum, r) => sum + r.amount,
      0,
    );

    if (amount > successfulPayment.amount - totalRefunded) {
      const error = new Error("Refund exceeds available balance");
      error.statusCode = 400;
      throw error;
    }

    const refund = await refundDAO.createRefund(tx, {
      paymentId: successfulPayment.id,
      amount,
      reason,
      status: "PENDING",
    });

    return { refund, payment: successfulPayment };
  });

  await refundDAO.updateRefund(null, refund.id, {
    status: "SUCCEEDED",
    tilledRefundId: tilledRefund.id,
  });

  return refund;
};
