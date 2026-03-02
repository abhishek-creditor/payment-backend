const TilledService = require("../services/tilled.service");
const paymentDAO = require("../dao/payment.dao");
const orderDAO = require("../dao/order.dao");
const prisma = require("../config/prismaClient");

exports.webhook = async (req, res) => {
    const signature = req.headers["tilled-signature"];

    if (!signature) {
        console.error("Webhook Error: Missing tilled-signature header");
        return res.status(400).send("Webhook Error: Missing signature");
    }

    try {
        // 1. Verify Signature
        // We assume app.js has been configured to store the raw body in req.rawBody
        const rawBodyContent = req.rawBody || JSON.stringify(req.body);

        try {
            TilledService.verifyWebhookSignature(signature, rawBodyContent);
            console.log("Webhook signature verified successfully!");
        } catch (err) {
            console.error(`Webhook Signature Verification Failed: ${err.message}`);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        // 2. Parse Event
        const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        console.log(`Received Tilled webhook event: ${event.type}`);

        // 3. Handle Event
        switch (event.type) {
            case "payment_intent.succeeded": {
                const paymentIntent = event.data;
                const tilledPaymentId = paymentIntent.id;

                console.log(`Processing successful payment intent: ${tilledPaymentId}`);

                // Find the corresponding payment in our database
                const payment = await paymentDAO.getPaymentByTilledId(null, tilledPaymentId);

                if (!payment) {
                    console.error(`Payment not found for Tilled Payment ID: ${tilledPaymentId}`);
                    return res.status(200).json({ received: true, message: "Payment not found but acknowledged" });
                }

                // Update Payment status to SUCCEEDED and Order status to PAID
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
                break;
            }

            case "payment_intent.payment_failed": {
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
                }
                break;
            }

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        // Return a 200 response to acknowledge receipt of the event
        res.json({ received: true });

    } catch (error) {
        console.error(`Webhook Error: ${error.message}`);
        res.status(500).send("Internal Server Error");
    }
};
