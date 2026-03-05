const paymentDAO = require("../../dao/payment.dao");
const orderDAO = require("../../dao/order.dao");
const prisma = require("../../config/prismaClient");
const productWebhookExecutor = require ("../../services/productWebhookExecutor.service");

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

    console.log(`Successfully updated order ${payment.orderId} to PAID.`);
    //trigger product api
    try{ 
        await productWebhookExecutor.executeProductWebhooks({
        productId: order.productId,
        triggerEvent: "payment_intent.succeeded",
        payload: {
            orderId: order.id,
            userId: order.userId,
            paymentId: payment.id,
            amount: order.totalAmount
        }
    });
       } catch (err) {
       console.error("Product webhook execution failed:", err);
    }
    console.log("First call to product backend has been called");
};

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
        //trigger product api
        try{
         await productWebhookExecutor.executeProductWebhooks({
            productId: order.productId,
            triggerEvent: "payment_intent.payment_failed",
            payload: {
                orderId: order.id,
                userId: order.userId,
                paymentId: payment.id
            }
        });
            } catch (err) {
            console.error("Product webhook execution failed:", err);
     }
    }
};

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
        console.log(`Successfully CANCELLED order ${payment.orderId}.`);
        //trigger product api for cancel situation
        try{
          await productWebhookExecutor.executeProductWebhooks({
            productId: order.productId,
            triggerEvent: "payment_intent.canceled",
            payload: {
                orderId: order.id,
                userId: order.userId,
                paymentId: payment.id
            }
        });
           } catch (err) {
           console.error("Product webhook execution failed:", err);
        }
    }
};
