const paymentDAO = require("../../dao/payment.dao");
const orderDAO = require("../../dao/order.dao");
const prisma = require("../../config/prismaClient");

const webhookDispatcher = require("../webhookDispatcher.service");// for build connection to webhook dispatcher to trigger webhooks on payment status change

// ---> Handle successful payment intent
exports.handlePaymentIntentSucceeded = async (event) => {
    const paymentIntent = event.data;
    const tilledPaymentId = paymentIntent.id;

    console.log(`Processing successful payment intent: ${tilledPaymentId}`);

    const payment = await paymentDAO.getPaymentByTilledId(null, tilledPaymentId);

    if (!payment) {
        console.error(`Payment not found for Tilled Payment ID: ${tilledPaymentId}`);
        return;
    }

    await prisma.$transaction(async (tx) => {
        await paymentDAO.updatePayment(tx, payment.id, {
            status: "SUCCEEDED",
            rawResponse: paymentIntent
        });

        await orderDAO.updateOrder(tx, payment.orderId, {
            status: "PAID"
        });
    });
    console.log("WEBHOOK DISPATCH STARTED: ", { orderId: payment.orderId, eventType: event.type });
    await webhookDispatcher.dispatch(payment.orderId, event.type); // Trigger webhooks for this event
    console.log(`Successfully updated order ${payment.orderId} to PAID.`);
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
