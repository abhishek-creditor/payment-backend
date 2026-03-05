const axios = require("axios");
const prisma = require("../config/prismaClient"); // adjust path

async function executeProductWebhooks({ productId, triggerEvent, payload }) {

    const integrations = await prisma.productWebhookConfig.findMany({
        where: {
            productId,
            triggerEvent,
            isActive: true
        },
        orderBy: {
            executionOrder: "asc"
        }
    });

    if (!integrations.length) {
        console.log("No product webhooks configured.");
        return;
    }

    for (const integration of integrations) {
        try {
            await callWebhook(integration, payload);
        } catch (err) {
            console.error(`Webhook failed: ${integration.callbackUrl}`, err.message);

            if (!integration.continueOnFailure) {
                console.log("Stopping further executions due to continueOnFailure = false");
                break;
            }
        }
    }
}

async function callWebhook(integration, payload) {

    const headers = {
        "Content-Type": "application/json",
        ...(integration.headers || {})
    };

    // Auth handling
    if (integration.authType === "BEARER_TOKEN" && integration.authSecret) {
        headers["Authorization"] = `Bearer ${integration.authSecret}`;
    }

    const body = buildBodyFromTemplate(integration.bodyTemplate, payload);

    await axios({
        method: integration.httpMethod,
        url: integration.callbackUrl,
        headers,
        data: body,
        timeout: integration.timeoutMs
    });
}

function buildBodyFromTemplate(template, payload) {
    if (!template) return payload;

    const templateString = JSON.stringify(template);

    const replaced = templateString.replace(/{{(.*?)}}/g, (_, key) => {
        return payload[key.trim()] ?? "";
    });

    return JSON.parse(replaced);
}

module.exports = {
    executeProductWebhooks
};