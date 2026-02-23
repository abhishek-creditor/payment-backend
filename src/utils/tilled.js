// src/utils/tilled.js

module.exports = {
  paymentIntents: {
    create: async (data, options = {}) => {
      console.log("🛠️ Tilled Mock: Creating Payment Intent...");
      console.log("🔑 Idempotency-Key forwarded:", options.headers?.["Idempotency-Key"]);

      await new Promise(resolve => setTimeout(resolve, 500));

      return {
        id: "mock_pi_" + Math.random().toString(36).substring(2, 11),
        status: "INITIATED",
        amount: data.amount,
        currency: data.currency || "usd",
        metadata: data.metadata || {}
      };
    }
  },

  refunds: {
    create: async (data, options = {}) => {
      console.log("🛠️ Tilled Mock: Processing Refund...");
      console.log("🔑 Idempotency-Key forwarded:", options.headers?.["Idempotency-Key"]);

      await new Promise(resolve => setTimeout(resolve, 500));

      return {
        id: "mock_ref_" + Math.random().toString(36).substring(2, 11),
        status: "succeeded",
        amount: data.amount
      };
    }
  }
};