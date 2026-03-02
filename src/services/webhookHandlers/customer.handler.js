const productUserDAO = require("../../dao/productUser.dao");

exports.handleCustomerEvent = async (event) => {
    const customer = event.data;
    const metadata = customer.metadata || {};
    const { productId, externalUserId } = metadata;

    if (productId && externalUserId) {
        // Ensure product use exists
        const productUser = await productUserDAO.upsertProductUser(
            null,
            productId,
            externalUserId,
            customer.email
        );

        // Link Tilled Customer ID
        await productUserDAO.updateTilledCustomerId(null, productUser.id, customer.id);
        console.log(`Customer ${customer.id} linked to ProductUser ${externalUserId}`);
    } else {
        console.log(`Customer event skipped matching: Missing productId/externalUserId in metadata`);
    }
};
