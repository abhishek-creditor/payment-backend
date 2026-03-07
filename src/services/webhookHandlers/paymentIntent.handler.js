const paymentDAO = require("../../dao/payment.dao");
const orderDAO = require("../../dao/order.dao");
const prisma = require("../../config/prismaClient");
const subscriptionService = require("../subscriptions.service");

const webhookDispatcher = require("../webhookDispatcher.service");// for build connection to webhook dispatcher to trigger webhooks on payment status change

// ---> Handle successful payment intent
exports.handlePaymentIntentSucceeded = async (event) => {
    const paymentIntent = event.data;
    const tilledPaymentId = paymentIntent.id;
    const paymentMethodId = paymentIntent.payment_method_id || null;

    console.log(`Processing successful payment intent: ${tilledPaymentId}`);

    const payment = await paymentDAO.getPaymentByTilledId(null, tilledPaymentId);

    if (!payment) {
        console.error(`Payment not found for Tilled Payment ID: ${tilledPaymentId}`);
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
            status: "PAID"
        });
    });
    console.log("WEBHOOK DISPATCH STARTED: ", { orderId: payment.orderId, eventType: event.type });
    await webhookDispatcher.dispatch(payment.orderId, event.type); // Trigger webhooks for this event
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

            const subscription = await subscriptionService.createSubscription(
                order.productId,
                {
                    externalUserId: metadata.user_id || order.productUser?.externalUserId,
                    productPlanId: metadata.plan_id || order.planId,
                    paymentMethodId: paymentMethodId,
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
    const tilledPaymentId = paymentIntent.id;

    console.log(`Processing failed payment intent: ${tilledPaymentId}`);

    const payment = await paymentDAO.getPaymentByTilledId(null, tilledPaymentId);

    if (payment) {
        await prisma.$transaction(async (tx) => {
            await paymentDAO.updatePayment(tx, payment.id, {
                status: "FAILED",
                rawResponse: paymentIntent
            });

            await orderDAO.updateOrder(tx, payment.orderId, {
                status: "FAILED"
            });
        });
        console.log("WEBHOOK DISPATCH STARTED: ", { orderId: payment.orderId, eventType: event.type });
        await webhookDispatcher.dispatch(payment.orderId, event.type); // Trigger webhooks for this event
        console.log(`Successfully updated order ${payment.orderId} to FAILED.`);
    }
};

// ---> Handle canceled payment intent
exports.handlePaymentIntentCanceled = async (event) => {
    const paymentIntent = event.data;
    const tilledPaymentId = paymentIntent.id;
    const payment = await paymentDAO.getPaymentByTilledId(null, tilledPaymentId);

    if (payment) {
        await prisma.$transaction(async (tx) => {
            await paymentDAO.updatePayment(tx, payment.id, {
                status: "CANCELLED",
                rawResponse: paymentIntent
            });
            await orderDAO.updateOrder(tx, payment.orderId, {
                status: "CANCELLED"
            });
        });
        console.log("WEBHOOK DISPATCH STARTED: ", { orderId: payment.orderId, eventType: event.type });
        await webhookDispatcher.dispatch(payment.orderId, event.type); // Trigger webhooks for this event
        console.log(`Successfully CANCELLED order ${payment.orderId}.`);
    }
};
