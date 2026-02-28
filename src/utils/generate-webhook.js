const crypto = require('crypto');
require('dotenv').config({ path: '.env.development' });

// 1. Paste your local secret from your .env file
const secret = process.env.TILLED_WEBHOOK_SECRET; 

// 2. Create a mock payload for the event you want to test
const payloadObj = {
  id: "evt_12345",
  type: "payment_intent.succeeded",
  data: {
    id: "pi_67890",
    amount: 5000,
    metadata: { orderId: "ord_abc" }
  }
};

const rawBody = JSON.stringify(payloadObj);
const timestamp = Math.floor(Date.now() / 1000).toString();

// 3. Generate the exact signature Tilled expects
const signedPayload = `${timestamp}.${rawBody}`;
const signature = crypto
  .createHmac('sha256', secret)
  .update(signedPayload)
  .digest('hex');

const tilledSignatureHeader = `t=${timestamp},v1=${signature}`;

console.log("--- USE THIS IN POSTMAN ---");
console.log("HEADER:");
console.log(`tilled-signature: ${tilledSignatureHeader}\n`);
console.log("BODY (Raw JSON):");
console.log(rawBody);