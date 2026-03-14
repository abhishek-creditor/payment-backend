const axios = require("axios");
const prisma = require("../config/prismaClient");

// Map payment tilled events to ebook backend events
function mapEvent(triggerEvent) {
  const mapping = {
    "payment_intent.succeeded": "PAYMENT_SUCCEEDED",
    "payment_intent.payment_failed": "PAYMENT_FAILED",
    "payment_intent.canceled": "PAYMENT_CANCELLED",
    "subscription.created": "SUBSCRIPTION_CREATED",
    "subscription.updated": "SUBSCRIPTION_UPDATED",
    "subscription.canceled": "SUBSCRIPTION_CANCELLED",
  };

  return mapping[triggerEvent] || triggerEvent;
}

async function dispatch(orderId, triggerEvent, eventId) {
  try {
    console.log(`Webhook sending for Order ID: ${orderId} | Event: ${triggerEvent}`);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        product: true,
        payments: true,
        subscription: true,
        productUser: {
          select: {
            externalUserId: true,
            email: true,
          },
        },
      },
    });

    if (!order) {
      console.error(`Webhook FAILED for Order ID: ${orderId} | Error: Order not found`);
      return;
    }

    const payment = order.payments?.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    )[0];

    if (!payment) {
      console.error(`Webhook FAILED for Order ID: ${orderId} | Error: No payment found for order`);
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
      console.log(`Webhook skipped for Order ID: ${order.id} | No webhook config found for event: ${triggerEvent}`);
      return;
    }

    const payload = {
      event: mapEvent(triggerEvent),
      orderId: order.id,
      referenceId: order.referenceId,
      status: payment.status,
      timestamp: new Date().toISOString(),
    };

    // Enrich payload with subscription data if available
    if (order.subscription) {
      payload.subscriptionId = order.subscription.id;
      payload.tilledSubscriptionId = order.subscription.tilledSubscriptionId;
      payload.subscription_status = order.subscription.status;
      payload.planId = order.planId;
    }

    // Include user identifiers
    if (order.productUser) {
      payload.externalUserId = order.productUser.externalUserId;
      payload.email = order.productUser.email;
    }

    console.log(`Webhook payload for Order ID: ${order.id}:`, payload);

    for (const config of configs) {
      await attemptDelivery(config, order.id, payload);
    }
  } catch (err) {
    console.error(`Webhook dispatch crashed for Order ID: ${orderId} | Error: ${err.message}`);
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
            errorMessage: null,
            success: true,
            deliveredAt: new Date(),
          },
        });
      } catch (dbErr) {
        console.error(`Webhook DB record save failed for Order ID: ${orderId} | Error: ${dbErr.message}`);
      }

      console.log(`Webhook SUCCESS for Order ID: ${orderId} | URL: ${config.callbackUrl} | Status: ${response.status}`);
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
        console.error(`Webhook DB record save failed for Order ID: ${orderId} | Error: ${dbErr.message}`);
      }

      console.error(`Webhook FAILED for Order ID: ${orderId} | Attempt: ${attempt}/${maxRetries} | Error: ${error.message}`, {
        url: config.callbackUrl,
        statusCode: error.response?.status || "NO_RESPONSE",
        responseData: error.response?.data || null,
        code: error.code || null,
      });

      // Don't retry on 4xx errors - these are permanent failures
      const status = error.response?.status;
      if (status && status >= 400 && status < 500) {
        console.error(`Webhook FAILED for Order ID: ${orderId} | Skipping retries - got ${status} (client error, retry won't help)`);
        return;
      }

      if (attempt === maxRetries) {
        console.error(`Webhook EXHAUSTED all ${maxRetries} retries for Order ID: ${orderId} | URL: ${config.callbackUrl}`);
        return;
      }

      attempt++;
      console.log(`Retry attempt ${attempt} for Order ID: ${orderId}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
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
