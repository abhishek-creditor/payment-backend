function buildTilledMetadata(order, product, extraData) {
    return {
        order_id: order.id,
        user_id: extraData.externalUserId || order.productUserId,
        user_tilled_id: extraData.userTilledId || null,
        plan_name: extraData.planName || null,
        entity_id: extraData.bookId || extraData.purchased_id || null,
        entity_type: product.code === "ebook" ? "BOOK" : "PLAN",
        organisation_id: extraData.organisationId || null,
        author_id: extraData.authorId || null,
        plan_id: extraData.planId || null,
        product_id: product.id,
        product_name: product.name
    };
}

module.exports = {
    buildTilledMetadata
};
