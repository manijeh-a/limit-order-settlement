const { time, trim0x } = require('@1inch/solidity-utils');
const { ethers } = require('hardhat');
const { buildOrder, buildTakerTraits, signOrder } = require('@1inch/limit-order-protocol-contract/test/helpers/orderUtils');

async function buildCalldataForOrder({
    orderData,
    orderSigner,
    minReturn,
    setupData,
    additionalDataForSettlement = '',
    isInnermostOrder = false,
    isMakingAmount = true,
    fillingAmount = isMakingAmount ? orderData.makingAmount : orderData.takingAmount,
    feeType = 0,
    integrator = orderSigner.address,
    resolverFee = 0,
    whitelistData = '0x' + setupData.contracts.resolver.address.substring(22),
}) {
    const {
        contracts: { lopv4, settlement, resolver },
        others: { chainId },
        auction: { startTime: auctionStartTime, details: auctionDetails },
    } = setupData;

    let postInteractionFeeDataTypes = ['uint8'];
    let postInteractionFeeData = [0];
    if (feeType === 1) {
        postInteractionFeeDataTypes = [...postInteractionFeeDataTypes, 'bytes4'];
        postInteractionFeeData = [feeType, '0x' + resolverFee.toString(16).padStart(8, '0')];
    }
    if (feeType === 2) {
        postInteractionFeeDataTypes = [...postInteractionFeeDataTypes, 'bytes20', 'bytes4'];
        postInteractionFeeData = [feeType, integrator, '0x' + resolverFee.toString(16).padStart(8, '0')];
    }

    const order = buildOrder(orderData, {
        makingAmountData: settlement.address + trim0x(auctionDetails),
        takingAmountData: settlement.address + trim0x(auctionDetails),
        postInteraction: settlement.address +
            trim0x(ethers.utils.solidityPack(postInteractionFeeDataTypes, postInteractionFeeData)) +
            trim0x(ethers.utils.solidityPack(['uint32', 'bytes10', 'uint16'], [auctionStartTime, whitelistData, 0])),
    });

    const { r, _vs: vs } = ethers.utils.splitSignature(await signOrder(order, chainId, lopv4.address, orderSigner));

    await resolver.approve(order.takerAsset, lopv4.address);

    const takerTraits = buildTakerTraits({
        makingAmount: isMakingAmount,
        minReturn,
        extension: order.extension,
        interaction: resolver.address + (isInnermostOrder ? '01' : '00') + trim0x(additionalDataForSettlement),
        target: resolver.address,
    });

    return lopv4.interface.encodeFunctionData('fillOrderArgs', [
        order,
        r,
        vs,
        fillingAmount,
        takerTraits.traits,
        takerTraits.args,
    ]);
}

async function buildAuctionDetails({
    startTime, // default is time.latest()
    duration = 1800, // default is 30 minutes
    delay = 0,
    initialRateBump = 0,
    points = [],
} = {}) {
    startTime = startTime || await time.latest();
    let details = ethers.utils.solidityPack(
        ['uint32', 'uint24', 'uint24'], [startTime + delay, duration, initialRateBump],
    );
    for (let i = 0; i < points.length; i++) {
        details += trim0x(ethers.utils.solidityPack(['uint24', 'uint16'], [points[i][0], points[i][1]]));
    }
    return { startTime, details, delay, duration, initialRateBump };
}

module.exports = {
    buildAuctionDetails,
    buildCalldataForOrder,
};
