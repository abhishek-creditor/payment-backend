const TilledService = require("../services/tilled.service");
const webhookEventDAO = require("../dao/webhookEvent.dao");
const paymentIntentHandler = require("../services/webhookHandlers/paymentIntent.handler");
const customerHandler = require("../services/webhookHandlers/customer.handler");
const subscriptionHandler = require("../services/webhookHandlers/subscription.handler");
const chargeHandler = require("../services/webhookHandlers/charge.handler");

exports.webhook = async (req, res) => {

    const signature = req.headers["tilled-signature"];

    if (!signature) {
        console.error("Webhook Error: Missing tilled-signature header");
        return res.status(400).send("Webhook Error: Missing signature");
    }

    try {
        // 1. VERIFY TILLED WEBHOOK SIGNATURE
        const rawBodyContent = req.rawBody || JSON.stringify(req.body);

        try {
            TilledService.verifyWebhookSignature(signature, rawBodyContent);
            console.log("Webhook signature verified successfully!");
        } catch (err) {
            console.error(`Webhook Signature Verification Failed: ${err.message}`);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        // 2. Parse Event
        const event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        console.log(`Received Tilled webhook event: ${event.type}`);

        // 3. Save Webhook Event to DB
        let dbEvent;

        try {

            dbEvent = await webhookEventDAO.createEvent(null, {
                eventType: event.type,
                tilledId: event.id,
                payload: event
            });

        } catch (err) {
            console.error("Failed to save webhook to DB:", err.message);
            // We continue processing even if logging fails, 
        }

        // 4. HANDLE EVENTS

        try {

            switch (event.type) {
                // ==========================
                // PAYMENT INTENT EVENTS
                // ==========================
                case "payment_intent.succeeded":
                    await paymentIntentHandler.handlePaymentIntentSucceeded(event);
                    break;

                case "payment_intent.payment_failed":
                    await paymentIntentHandler.handlePaymentIntentFailed(event);
                    break;

                case "payment_intent.canceled":
                    await paymentIntentHandler.handlePaymentIntentCanceled(event);
                    break;

                // ==========================
                // CUSTOMER EVENTS
                // ==========================
                case "customer.created":
                case "customer.updated":
                    await customerHandler.handleCustomerEvent(event);
                    break;

                // ==========================
                // SUBSCRIPTION EVENTS
                // ==========================
                case "subscription.created":
                    await subscriptionHandler.handleSubscriptionCreated(event);
                    break;

                case "subscription.updated":
                    await subscriptionHandler.handleSubscriptionUpdated(event);
                    break;

                case "subscription.canceled":
                    await subscriptionHandler.handleSubscriptionCanceled(event);
                    break;

                // ==========================
                // CHARGE / INVOICE LOGGING
                // ==========================
                case "charge.succeeded":
                case "charge.failed":
                case "charge.refunded":
                    await chargeHandler.handleChargeEvent(event);
                    break;

                default:
                    console.log(`Unhandled event type: ${event.type}`);
            }

            // Mark Webhook as Processed
            if (dbEvent) {
                await webhookEventDAO.markAsProcessed(null, dbEvent.id);
            }

        } catch (err) {
            console.error(`Error processing webhook event '${event.type}':`, err);
             // Return 500 if the internal logic fails so Tilled retries
            return res.status(500).send("Internal processing error");
        }

         // Return a 200 response to acknowledge receipt of the event
        res.json({ received: true });

    } catch (error) {

        console.error(`Webhook Wrapper Error: ${error.message}`);
        res.status(500).send("Internal Server Error");
    }

};