const prisma = require("../config/prismaClient");
const productUserDAO = require("../dao/productUser.dao");
const subscriptionDAO = require("../dao/subscription.dao");
const TilledService = require("./tilled.service");

/**
 * CREATE SUBSCRIPTION
 *
 * Flow:
 * 1️⃣ Validate ProductPlan (must be RECURRING)
 * 2️⃣ Find ProductUser → get tilledCustomerId
 * 3️⃣ Call Tilled API to create subscription
 * 4️⃣ Save subscription in our DB
 */
exports.createSubscription = async (productId, data) => {
    const {
        externalUserId,
        productPlanId,
        paymentMethodId,
        billingCycleAnchor,
        tilledAccountId,
    } = data;

    // ---------------------------
    // STEP 1: VALIDATE PLAN
    // ---------------------------
    const plan = await prisma.productPlan.findFirst({
        where: {
            id: productPlanId,
            productId,
            isActive: true,
        },
    });

    if (!plan) {
        const error = new Error("Invalid or inactive productPlanId");
        error.statusCode = 400;
        throw error;
    }

    if (plan.billingType !== "RECURRING") {
        const error = new Error("Plan must be of billingType RECURRING for subscriptions");
        error.statusCode = 400;
        throw error;
    }

    if (!plan.interval || !plan.intervalCount) {
        const error = new Error("Plan is missing interval or intervalCount configuration");
        error.statusCode = 400;
        throw error;
    }

    // ---------------------------
    // STEP 2: GET PRODUCT USER
    // ---------------------------
    const productUser = await productUserDAO.getProductUserByExternalId(
        null,
        productId,
        externalUserId
    );

    if (!productUser) {
        const error = new Error("User not found. User must complete at least one payment before subscribing.");
        error.statusCode = 404;
        throw error;
    }

    if (!productUser.tilledCustomerId) {
        const error = new Error("User does not have a Tilled customer ID. User must complete at least one payment first.");
        error.statusCode = 400;
        throw error;
    }

    // ---------------------------
    // STEP 3: CALL TILLED API
    // ---------------------------
    const targetAccountId = tilledAccountId;

    // Map Prisma BillingInterval enum to Tilled API interval_unit
    const intervalUnitMap = {
        MONTH: "month",
        YEAR: "year",
    };

    const intervalUnit = intervalUnitMap[plan.interval];
    if (!intervalUnit) {
        const error = new Error(`Unsupported billing interval: ${plan.interval}`);
        error.statusCode = 400;
        throw error;
    }

    const subscriptionData = {
        billing_cycle_anchor: billingCycleAnchor || new Date().toISOString(),
        currency: plan.currency.toLowerCase(),
        customer_id: productUser.tilledCustomerId,
        interval_count: plan.intervalCount,
        interval_unit: intervalUnit,
        payment_method_id: paymentMethodId,
        price: plan.price,
        metadata: {
            productId,
            productUserId: productUser.id,
            planId: plan.id,
        },
    };

    console.log("Creating Tilled subscription:", JSON.stringify(subscriptionData, null, 2));

    const tilledResponse = await TilledService.createSubscription(
        subscriptionData,
        targetAccountId
    );

    console.log("Tilled Subscription Response:", JSON.stringify(tilledResponse.data, null, 2));

    if (tilledResponse.statusCode >= 400) {
        const error = new Error(
            `Tilled Error: ${tilledResponse.data?.message || tilledResponse.data?.error || "Failed to create subscription"}`
        );
        error.statusCode = tilledResponse.statusCode;
        throw error;
    }

    const tilledSubscription = tilledResponse.data;

    // ---------------------------
    // STEP 4: SAVE TO DB
    // ---------------------------
    const subscription = await subscriptionDAO.upsertSubscription(null, {
        productId,
        productUserId: productUser.id,
        planId: plan.id,
        tilledSubscriptionId: tilledSubscription.id,
        status: tilledSubscription.status?.toUpperCase() || "ACTIVE",
        currentPeriodStart: new Date(tilledSubscription.billing_cycle_anchor),
        currentPeriodEnd: new Date(tilledSubscription.next_payment_at),
        cancelAtPeriodEnd: false,
        metadata: tilledSubscription,
    });

    console.log(`Subscription ${subscription.id} created successfully (Tilled ID: ${tilledSubscription.id})`);

    return subscription;
};
