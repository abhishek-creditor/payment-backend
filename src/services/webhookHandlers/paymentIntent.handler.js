const paymentDAO = require("../../dao/payment.dao");
const orderDAO = require("../../dao/order.dao");
const prisma = require("../../config/prismaClient");
const subscriptionService = require("../subscriptions.service");

const webhookDispatcher = require("../webhookDispatcher.service"); // trigger webhooks on payment status change

// Idempotency status values (using string literals for reliability)
const IDEMPOTENCY_STATUS = {
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

// 🔧 FIX: Helper to resolve payment safely (handles race condition)
async function resolvePayment(paymentIntent) {
  const tilledPaymentId = paymentIntent.id;
  let payment = await paymentDAO.getPaymentByTilledId(null, tilledPaymentId);

  if (!payment) {
    const orderId = paymentIntent?.metadata?.order_id;
    if (orderId) {
      console.warn(
        "[Webhook] Payment not found by tilledId, falling back to order lookup:",
        orderId,
      );
      const order = await orderDAO.getOrderById(null, orderId, {
        payments: true,
      });
      payment = order?.payments?.[0] || null;
    }
  }
  return payment;
}

// 🔧 FIX: Helper to update idempotency status reliably.
// Prisma v6 rejects string enum values inside $transaction callbacks.
// Workaround: use raw SQL which bypasses ORM validation entirely.
async function updateIdempotencyStatus(tx, payment, newStatus) {
  const result = await tx.$executeRaw`
    UPDATE "IdempotencyKey"
    SET "status" = CAST(${newStatus} AS "IdempotencyStatus"), "updatedAt" = NOW()
    WHERE "paymentId" = ${payment.id} OR "orderId" = ${payment.orderId}
  `;

  console.log(`[Idempotency Updated - ${newStatus}]`, {
    orderId: payment.orderId,
    paymentId: payment.id,
    rowsUpdated: result,
  });

  return result;
}

// ---> Handle successful payment intent
exports.handlePaymentIntentSucceeded = async (event) => {
  const paymentIntent = event.data;
  const paymentMethodId = paymentIntent.payment_method_id || null;
  console.log(`Processing successful payment intent: ${paymentIntent.id}`);
  // 🔧 FIX: safe lookup
  const payment = await resolvePayment(paymentIntent);

  if (!payment) {
    console.error(`Payment not found for webhook event ${paymentIntent.id}`);
    return;
  }

    // Update payment status + store payment_method_id
    await prisma.$transaction(async (tx) => {
        await paymentDAO.updatePayment(tx, payment.id, {
            status: "SUCCEEDED",
            rawResponse: paymentIntent,
            tilledPaymentMethodId: paymentMethodId,
        });

    await orderDAO.updateOrder(tx, payment.orderId, {
      status: "PAID",
    });

    await updateIdempotencyStatus(tx, payment, IDEMPOTENCY_STATUS.COMPLETED);
  });

  console.log("[Webhook Idempotency Update]", payment.orderId);
  await webhookDispatcher.dispatch(payment.orderId, event.type);
  console.log(`Successfully updated order ${payment.orderId} to PAID.`);

    // ---------------------------
    // AUTO-CREATE SUBSCRIPTION
    // If this payment was for a RECURRING plan, create the subscription
    // ---------------------------
    const metadata = paymentIntent.metadata || {};

    if (metadata.billing_type === "RECURRING" && paymentMethodId) {
        console.log(`RECURRING payment detected for order ${payment.orderId}. Creating subscription...`);

        try {
            // We need the order to get productId and the associated account
            const order = await orderDAO.getOrderById(null, payment.orderId, {
                productUser: true,
            });

            if (!order) {
                console.error(`Order ${payment.orderId} not found, cannot create subscription.`);
                return;
            }

            // Get the customer's saved payment methods
            // setup_future_usage: "off_session" makes Tilled auto-save the card to the customer
            const TilledService = require("../tilled.service");
            const customerId = paymentIntent.customer?.id || paymentIntent.customer;

            if (!customerId) {
                console.error(`No customer ID found in payment intent, cannot create subscription.`);
                return;
            }

            const pmResponse = await TilledService.listCustomerPaymentMethods(customerId, paymentIntent.account_id);
            console.log(`Customer payment methods:`, JSON.stringify(pmResponse.data, null, 2));

            // Find the most recent chargeable payment method
            const paymentMethods = pmResponse.data?.items || pmResponse.data || [];
            const reusablePaymentMethod = Array.isArray(paymentMethods)
                ? paymentMethods.find(pm => pm.chargeable === true) || paymentMethods[0]
                : null;

            if (!reusablePaymentMethod) {
                console.error(`No saved payment methods found for customer ${customerId}. Subscription skipped.`);
                return;
            }

            console.log(`Using payment method ${reusablePaymentMethod.id} for subscription (chargeable: ${reusablePaymentMethod.chargeable})`);

            const subscription = await subscriptionService.createSubscription(
                order.productId,
                {
                    externalUserId: metadata.user_id || order.productUser?.externalUserId,
                    productPlanId: metadata.plan_id || order.planId,
                    paymentMethodId: reusablePaymentMethod.id,
                    tilledAccountId: paymentIntent.account_id,
                }
            );

            // Link the subscription to the order
            await orderDAO.updateOrder(null, order.id, {
                subscriptionId: subscription.id,
            });

            console.log(`Subscription ${subscription.id} created and linked to order ${order.id}`);
        } catch (err) {
            // Log the error but don't fail the webhook — the payment was already marked as SUCCEEDED
            // The subscription can be retried manually using the stored payment_method_id
            console.error(`Failed to auto-create subscription for order ${payment.orderId}:`, err.message);
        }
    }

};

// ---> Handle failed payment intent
exports.handlePaymentIntentFailed = async (event) => {
  const paymentIntent = event.data;
  console.log(`Processing failed payment intent: ${paymentIntent.id}`);

  // 🔧 FIX: safe lookup
  const payment = await resolvePayment(paymentIntent);

  if (!payment) {
    console.error(`Payment not found for webhook event`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await paymentDAO.updatePayment(tx, payment.id, {
      status: "FAILED",
      rawResponse: paymentIntent,
    });

    await orderDAO.updateOrder(tx, payment.orderId, {
      status: "FAILED",
    });

    await updateIdempotencyStatus(tx, payment, IDEMPOTENCY_STATUS.FAILED);
  });

  await webhookDispatcher.dispatch(payment.orderId, event.type);

  console.log(`Successfully updated order ${payment.orderId} to FAILED.`);
};

// ---> Handle canceled payment intent
exports.handlePaymentIntentCanceled = async (event) => {
  const paymentIntent = event.data;

  console.log(`Processing canceled payment intent: ${paymentIntent.id}`);

  // 🔧 FIX: safe lookup
  const payment = await resolvePayment(paymentIntent);

  if (!payment) {
    console.error(`Payment not found for webhook event`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await paymentDAO.updatePayment(tx, payment.id, {
      status: "CANCELLED",
      rawResponse: paymentIntent,
    });

    await orderDAO.updateOrder(tx, payment.orderId, {
      status: "CANCELLED",
    });

    await updateIdempotencyStatus(tx, payment, IDEMPOTENCY_STATUS.CANCELLED);
  });

  await webhookDispatcher.dispatch(payment.orderId, event.type);

  console.log(`Successfully CANCELLED order ${payment.orderId}.`);
};
