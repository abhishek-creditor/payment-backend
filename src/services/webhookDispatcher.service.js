const axios = require("axios");
const prisma = require("../config/prismaClient");

// Map payment tilled events to ebook backend events
function mapEvent(triggerEvent) {
  const mapping = {
    "payment_intent.succeeded": "PAYMENT_SUCCEEDED",
    "payment_intent.payment_failed": "PAYMENT_FAILED",
    "payment_intent.canceled": "PAYMENT_CANCELLED",
  };

  return mapping[triggerEvent] || triggerEvent;
}

async function dispatch(orderId, triggerEvent) {
  console.log("Dispatching webhook for order:", orderId);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      product: true,
      payments: true,
    },
  });

  if (!order) {
    console.error("Order not found for dispatch");
    return;
  }

  const payment = order.payments?.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )[0];

  if (!payment) {
    console.error("No payment found for order");
    return;
  }

  const configs = await prisma.productWebhookConfig.findMany({
    where: {
      productId: order.productId,
      triggerEvent: triggerEvent,
      isActive: true,
    },
  });

  if (!configs.length) {
    console.log("No webhook config found for event:", triggerEvent);
    return;
  }

  const payload = {
    event: mapEvent(triggerEvent),
    orderId: order.id,
    referenceId: order.referenceId,
    status: payment.status,
    timestamp: new Date().toISOString(),
  };

  console.log("Payload being sent to webhook:", payload);

  for (const config of configs) {
    await attemptDelivery(config, order.id, payload);
  }
}

async function attemptDelivery(config, orderId, payload) {
  let attempt = 1;
  const maxRetries = config.maxRetries || 3;
  const delay = config.retryDelayMs || 1000;

  while (attempt <= maxRetries) {
    try {
      const headers = buildHeaders(config);

      const response = await axios({
        method: config.httpMethod,
        url: config.callbackUrl,
        data: payload,
        headers,
        timeout: 100000,
      });

      // Save success record (don't let DB error crash the flow)
      try {
        await prisma.outgoingWebhookDelivery.create({
          data: {
            configId: config.id,
            orderId,
            attemptNumber: attempt,
            statusCode: response.status,
            requestBody: payload,
            responseBody: JSON.stringify(response.data),
            success: true,
            deliveredAt: new Date(),
          },
        });
      } catch (dbErr) {
        console.error("Failed to save SUCCESS delivery record to DB:", dbErr.message);
      }

      console.log(`Webhook delivered successfully to ${config.callbackUrl} (status: ${response.status})`);
      return;

    } catch (error) {

      // Save failure record (don't let DB error crash the retry loop)
      try {
        await prisma.outgoingWebhookDelivery.create({
          data: {
            configId: config.id,
            orderId,
            attemptNumber: attempt,
            statusCode: error.response?.status || null,
            requestBody: payload,
            responseBody: error.response?.data
              ? JSON.stringify(error.response.data)
              : null,
            errorMessage: error.message,
            success: false,
          },
        });
      } catch (dbErr) {
        console.error("Failed to save FAILED delivery record to DB:", dbErr.message);
      }

      console.error(`Webhook delivery FAILED attempt ${attempt}/${maxRetries}:`, {
        url: config.callbackUrl,
        statusCode: error.response?.status || "NO_RESPONSE",
        errorMessage: error.message,
        responseData: error.response?.data || null,
        code: error.code || null, // ECONNREFUSED, ENOTFOUND, ETIMEDOUT etc.
      });

      if (attempt === maxRetries) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }

  }
}

function buildHeaders(config) {
  let headers = {
    "Content-Type": "application/json",
  };

  if (config.authType === "BEARER_TOKEN" && config.authSecret) {
    headers["Authorization"] = `Bearer ${config.authSecret}`;
  }

  if (config.authType === "API_KEY_HEADER" && config.authSecret) {
    headers["x-api-key"] = config.authSecret;
  }

  if (config.headers) {
    headers = { ...headers, ...config.headers };
  }

  return headers;
}

module.exports = {
  dispatch,
};
