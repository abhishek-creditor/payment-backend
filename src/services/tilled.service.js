const { request } = require('undici');
const crypto = require('crypto');

class TilledService {
    // ... (rest of class methods, assuming they are static and fine)

    // Generic wrapper for requests
    static async _makeRequest(endpoint, method = 'GET', body = null, tilledAccountId = null) {

        const headers = {
            'tilled-api-key': process.env.TILLED_SANDBOX_SECRET_KEY,
            'Content-Type': 'application/json'
        };

        const accountId = tilledAccountId;

        if (accountId) {
            headers['tilled-account'] = accountId;
        }

        try {
            const { statusCode, body: responseBody } = await request(`${process.env.TILLED_SANDBOX_BASE_URL}${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : null
            });

            const data = await responseBody.json();
            return { statusCode, data };

        } catch (error) {
            console.error('Tilled API Error:', error);
            throw error;
        }
    }

    static verifyWebhookSignature(header, rawBody) {
        const webhookSecret = process.env.TILLED_SANDBOX_WEBHOOK_SECRET;

        if (!header || !webhookSecret) {
            throw new Error("Missing signature header or webhook secret");
        }

        const details = header.split(',').reduce((accum, item) => {
            const [key, value] = item.split('=');
            if (key === 't') accum.timestamp = value;
            if (key === 'v1') accum.signature = value;
            return accum;
        }, { timestamp: -1, signature: -1 });

        if (details.timestamp === -1 || details.signature === -1) {
            throw new Error("Unable to extract timestamp and signature from header");
        }

        // Prepare the signed payload string: "timestamp.rawBody"
        // Note: Ensure rawBody is a string
        const payload = `${details.timestamp}.${rawBody.toString()}`;

        //Compute the expected signature using HMAC SHA256
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(payload)
            .digest('hex');

        //constant-time comparison to prevent timing attacks
        const sigBuffer = Buffer.from(details.signature);
        const expectedBuffer = Buffer.from(expectedSignature);

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            throw new Error("Signature mismatch");
        }

        return true;
    }

    static async getAccount(tilledAccountId) {
        return await this._makeRequest('/accounts', 'GET', null, tilledAccountId);
    }

    static async updateAccount(tilledAccountId, updateData) {
        return await this._makeRequest('/accounts/', 'PATCH', updateData, tilledAccountId);
    }

    static async createConnectedAccount(accountData, partnerAccountId) {
        return await this._makeRequest('/accounts/connected', 'POST', accountData, partnerAccountId);
    }

    static async listConnectedAccounts(tilledAccountId, queryParams = {}) {
        const queryString = new URLSearchParams();
        Object.entries(queryParams).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                queryString.append(key, value);
            }
        });

        const endpoint = `/accounts/connected?${queryString.toString()}`;
        return await this._makeRequest(endpoint, 'GET', null, tilledAccountId);
    }

    static async listCustomers(tilledAccountId, queryParams = {}) {
        const queryString = new URLSearchParams();

        Object.entries(queryParams).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                if (key === 'metadata' && typeof value === 'object') {
                    Object.entries(value).forEach(([metaKey, metaValue]) => {
                        queryString.append(`metadata[${metaKey}]`, metaValue);
                    });
                } else {
                    queryString.append(key, value);
                }
            }
        });

        const endpoint = `/customers?${queryString.toString()}`;
        return await this._makeRequest(endpoint, 'GET', null, tilledAccountId);
    }

    static async createPaymentIntent(paymentData, tilledAccountId) {
        return await this._makeRequest('/payment-intents', 'POST', paymentData, tilledAccountId);
    }

    static async createCheckoutSession(sessionData, tilledAccountId) {
        return await this._makeRequest('/checkout-sessions', 'POST', sessionData, tilledAccountId);
    }

    static async getCustomer(customerId, tilledAccountId) {
        return await this._makeRequest(`/customers/${customerId}`, 'GET', null, tilledAccountId);
    }

    static async createCustomer(customerData, tilledAccountId) {
        return await this._makeRequest('/customers', 'POST', customerData, tilledAccountId);
    }

    static async createSubscription(subscriptionData, tilledAccountId) {
        return await this._makeRequest('/subscriptions', 'POST', subscriptionData, tilledAccountId);
    }

    static async getPaymentMethod(paymentMethodId, tilledAccountId) {
        return await this._makeRequest(`/payment-methods/${paymentMethodId}`, 'GET', null, tilledAccountId);
    }

    static async listCustomerPaymentMethods(customerId, tilledAccountId) {
        return await this._makeRequest(`/payment-methods?customer_id=${customerId}&type=card`, 'GET', null, tilledAccountId);
    }

    static async attachPaymentMethodToCustomer(paymentMethodId, customerId, tilledAccountId) {
        return await this._makeRequest(`/payment-methods/${paymentMethodId}/attach`, 'PUT', {
            customer_id: customerId
        }, tilledAccountId);
    }

    static async createRefund(refundData, tilledAccountId) {
        return await this._makeRequest('/refunds', 'POST', refundData, tilledAccountId);
    }

}

module.exports = TilledService;