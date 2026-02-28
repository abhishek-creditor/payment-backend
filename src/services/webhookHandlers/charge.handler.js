exports.handleChargeEvent = async (event) => {
    console.log(`Handled charge event: ${event.type} for charge ID: ${event.data.id}`);
};
