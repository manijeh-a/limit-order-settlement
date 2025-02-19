const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { time, expect, ether, trim0x, timeIncreaseTo, getPermit, getPermit2, compressPermit, permit2Contract } = require('@1inch/solidity-utils');
const { buildMakerTraits } = require('@1inch/limit-order-protocol-contract/test/helpers/orderUtils');
const { initContractsForSettlement } = require('./helpers/fixtures');
const { buildAuctionDetails, buildCalldataForOrder } = require('./helpers/fusionUtils');

const ORDER_FEE = 100n;
const BACK_ORDER_FEE = 125n;
const BASE_POINTS = ether('0.001'); // 1e15

describe('Settlement', function () {
    it('opposite direction recursive swap', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, resolver },
            accounts: { owner, alice },
        } = setupData;

        const fillOrderToData1 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.11'),
                takingAmount: ether('100'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('100'),
            isInnermostOrder: true,
        });

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: owner.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: owner,
            setupData,
            minReturn: ether('0.1'),
            additionalDataForSettlement: fillOrderToData1,
        });

        const txn = await resolver.settleOrders(fillOrderToData0);
        await expect(txn).to.changeTokenBalances(dai, [owner, alice, resolver], [ether('-100'), ether('100'), ether('0')]);
        await expect(txn).to.changeTokenBalances(weth, [owner, alice, resolver], [ether('0.1'), ether('-0.11'), ether('0.01')]);
    });

    it('settle orders with permits, permit', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, lopv4, resolver },
            accounts: { owner, alice },
            others: { chainId },
        } = setupData;

        const fillOrderToData1 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.11'),
                takingAmount: ether('100'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('100'),
            isInnermostOrder: true,
        });

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: owner.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: owner,
            setupData,
            minReturn: ether('0.1'),
            additionalDataForSettlement: fillOrderToData1,
        });

        await weth.connect(alice).approve(lopv4.address, ether('0.11'));
        await dai.connect(owner).approve(lopv4.address, 0n); // remove direct approve
        const permit0 = compressPermit(await getPermit(owner, dai, '1', chainId, lopv4.address, ether('100')));
        const packing = (1n << 248n) | 1n;
        const txn = await resolver.settleOrdersWithPermits(fillOrderToData0, packing,
            owner.address + trim0x(dai.address) + trim0x(permit0));
        await expect(txn).to.changeTokenBalances(dai, [owner, alice, resolver], [ether('-100'), ether('100'), ether('0')]);
        await expect(txn).to.changeTokenBalances(weth, [owner, alice, resolver], [ether('0.1'), ether('-0.11'), ether('0.01')]);
    });

    it('settle orders with permits, permit2', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, lopv4, resolver },
            accounts: { owner, alice },
            others: { chainId },
        } = setupData;

        const fillOrderToData1 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.11'),
                takingAmount: ether('100'),
                makerTraits: buildMakerTraits({ usePermit2: true }),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('100'),
            isInnermostOrder: true,
        });

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: owner.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                makerTraits: buildMakerTraits({ usePermit2: true }),
            },
            orderSigner: owner,
            setupData,
            minReturn: ether('0.1'),
            additionalDataForSettlement: fillOrderToData1,
        });

        const permit2 = await permit2Contract();
        await dai.approve(permit2.address, ether('100'));
        await weth.connect(alice).approve(permit2.address, ether('0.11'));
        await dai.connect(owner).approve(lopv4.address, 0n); // remove direct approve
        await weth.connect(alice).approve(lopv4.address, 0n); // remove direct approve
        const permit0 = compressPermit(await getPermit2(owner, dai.address, chainId, lopv4.address, ether('100')));
        const permit1 = compressPermit(await getPermit2(alice, weth.address, chainId, lopv4.address, ether('0.11')));
        const packing = (2n << 248n) | 2n | 8n;
        const txn = await resolver.settleOrdersWithPermits(fillOrderToData0, packing,
            owner.address + trim0x(dai.address) + trim0x(permit0) + trim0x(alice.address) + trim0x(weth.address) + trim0x(permit1));
        await expect(txn).to.changeTokenBalances(dai, [owner, alice, resolver], [ether('-100'), ether('100'), ether('0')]);
        await expect(txn).to.changeTokenBalances(weth, [owner, alice, resolver], [ether('0.1'), ether('-0.11'), ether('0.01')]);
    });

    it('opposite direction recursive swap with taking fee', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, settlement, resolver },
            accounts: { owner, alice, bob },
        } = setupData;

        const fillOrderToData1 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.11'),
                takingAmount: ether('100'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('100'),
            isInnermostOrder: true,
            feeType: 2,
            integrator: bob.address,
            resolverFee: 1000000,
        });

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: owner.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: owner,
            setupData,
            minReturn: ether('0.1'),
            additionalDataForSettlement: fillOrderToData1,
            feeType: 2,
            integrator: bob.address,
            resolverFee: 1000000,
        });

        const wethFeeAmount = ether('0.0001');
        const daiFeeAmount = ether('0.1');
        // send fee amounts to resolver contract
        await weth.transfer(resolver.address, wethFeeAmount.toString());
        await dai.connect(alice).transfer(resolver.address, daiFeeAmount.toString());
        // approve fee amounts to be spent by SettlementExtension
        await resolver.approve(weth.address, settlement.address);
        await resolver.approve(dai.address, settlement.address);

        const txn = await resolver.settleOrders(fillOrderToData0);
        await expect(txn).to.changeTokenBalances(dai, [owner, alice, bob], [ether('-100'), ether('100'), ether('0.1')]);
        await expect(txn).to.changeTokenBalances(weth, [owner, alice, bob], [ether('0.1'), ether('-0.11'), ether('0.0001')]);
    });

    it('unidirectional recursive swap', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, resolver },
            accounts: { owner, alice },
            others: { abiCoder },
        } = setupData;

        const resolverArgs = abiCoder.encode(
            ['address[]', 'bytes[]'],
            [
                [weth.address],
                [
                    weth.interface.encodeFunctionData('transferFrom', [
                        owner.address,
                        resolver.address,
                        ether('0.025'),
                    ]),
                ],
            ],
        );

        const fillOrderToData1 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('15'),
                takingAmount: ether('0.015'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('15'),
            additionalDataForSettlement: resolverArgs,
            isInnermostOrder: true,
            isMakingAmount: false,
        });

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('10'),
                takingAmount: ether('0.01'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('10'),
            additionalDataForSettlement: fillOrderToData1,
            isMakingAmount: false,
        });

        await weth.approve(resolver.address, ether('0.025'));

        const txn = await resolver.settleOrders(fillOrderToData0);
        await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('25'), ether('-25')]);
        await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.025'), ether('0.025')]);
    });

    it('triple recursive swap', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, resolver },
            accounts: { owner, alice },
        } = setupData;

        const fillOrderToData2 = await buildCalldataForOrder({
            orderData: {
                maker: owner.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.025'),
                takingAmount: ether('25'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: owner,
            setupData,
            minReturn: ether('0.025'),
            isInnermostOrder: true,
            isMakingAmount: false,
        });

        const fillOrderToData1 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('15'),
                takingAmount: ether('0.015'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('15'),
            additionalDataForSettlement: fillOrderToData2,
            isMakingAmount: false,
        });

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('10'),
                takingAmount: ether('0.01'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('10'),
            additionalDataForSettlement: fillOrderToData1,
            isMakingAmount: false,
        });

        const txn = await resolver.settleOrders(fillOrderToData0);
        await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.025'), ether('0.025')]);
        await expect(txn).to.changeTokenBalances(dai, [owner, alice], [ether('25'), ether('-25')]);
    });

    describe('dutch auction params', function () {
        const prepareSingleOrder = async ({
            targetTakingAmount = 0n,
            setupData,
        }) => {
            const {
                contracts: { dai, weth, resolver },
                accounts: { owner, alice },
                others: { abiCoder },
                auction: { startTime, delay, duration, initialRateBump },
            } = setupData;

            let actualTakingAmount = targetTakingAmount;
            if (actualTakingAmount === 0n) {
                actualTakingAmount = ether('0.1');
                const ts = await time.latest();
                // TODO: avoid this shit (as well as any other computations in tests)
                if (ts < startTime + delay + duration) {
                    // actualTakingAmount = actualTakingAmount * (
                    //    _BASE_POINTS + initialRateBump * (startTime + delay + duration - currentTimestamp) / duration
                    // ) / _BASE_POINTS
                    const minDuration = startTime + delay + duration - ts > duration ? duration : startTime + delay + duration - ts - 3;
                    actualTakingAmount =
                        (actualTakingAmount * (10000000n + (BigInt(initialRateBump) * BigInt(minDuration)) / BigInt(duration))) /
                        10000000n;
                }
            }

            const resolverCalldata = abiCoder.encode(
                ['address[]', 'bytes[]'],
                [
                    [weth.address],
                    [
                        weth.interface.encodeFunctionData('transferFrom', [
                            owner.address,
                            resolver.address,
                            actualTakingAmount,
                        ]),
                    ],
                ],
            );

            const fillOrderToData = await buildCalldataForOrder({
                orderData: {
                    maker: alice.address,
                    makerAsset: dai.address,
                    takerAsset: weth.address,
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    makerTraits: buildMakerTraits(),
                },
                orderSigner: alice,
                setupData,
                minReturn: ether('100'),
                additionalDataForSettlement: resolverCalldata,
                isInnermostOrder: true,
                isMakingAmount: false,
                fillingAmount: actualTakingAmount,
            });

            await weth.approve(resolver.address, actualTakingAmount);
            return fillOrderToData;
        };

        it('matching order before orderTime has maximal rate bump', async function () {
            const dataFormFixture = await loadFixture(initContractsForSettlement);
            const auction = await buildAuctionDetails({ delay: 60, initialRateBump: 1000000n });
            const setupData = { ...dataFormFixture, auction };
            const {
                contracts: { dai, weth, resolver },
                accounts: { owner, alice },
            } = setupData;

            const fillOrderToData = await prepareSingleOrder({ setupData });

            const txn = await resolver.settleOrders(fillOrderToData);
            await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('100'), ether('-100')]);
            await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.11'), ether('0.11')]);
        });

        describe('order with one bump point', async function () {
            it('matching order equal to bump point', async function () {
                const dataFormFixture = await loadFixture(initContractsForSettlement);
                const auction = await buildAuctionDetails({ points: [[900000, 240]] });
                const setupData = { ...dataFormFixture, auction };
                const {
                    contracts: { dai, weth, resolver },
                    accounts: { owner, alice },
                } = setupData;

                const fillOrderToData = await prepareSingleOrder({
                    targetTakingAmount: ether('0.109'),
                    setupData,
                });

                await timeIncreaseTo(setupData.auction.startTime + 239);

                const txn = await resolver.settleOrders(fillOrderToData);
                await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('100'), ether('-100')]);
                await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.109'), ether('0.109')]);
            });

            it('matching order before bump point', async function () {
                const dataFormFixture = await loadFixture(initContractsForSettlement);
                const auction = await buildAuctionDetails({ initialRateBump: 1000000n, points: [[900000, 240]] });
                const setupData = { ...dataFormFixture, auction };
                const {
                    contracts: { dai, weth, resolver },
                    accounts: { owner, alice },
                } = setupData;

                const fillOrderToData = await prepareSingleOrder({
                    targetTakingAmount: ether('0.1095'), // 1/2 * (takingAmount * 10%) + 1/2 * (takingAmount * 9%)
                    setupData,
                });

                await timeIncreaseTo(setupData.auction.startTime + 240 / 2 - 1);

                const txn = await resolver.settleOrders(fillOrderToData);
                await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('100'), ether('-100')]);
                await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.1095'), ether('0.1095')]);
            });

            it('matching order after bump point', async function () {
                const dataFormFixture = await loadFixture(initContractsForSettlement);
                const auction = await buildAuctionDetails({ points: [[900000, 240]] });
                const setupData = { ...dataFormFixture, auction };
                const {
                    contracts: { dai, weth, resolver },
                    accounts: { owner, alice },
                } = setupData;

                const fillOrderToData = await prepareSingleOrder({
                    targetTakingAmount: ether('0.106'),
                    setupData,
                });
                await timeIncreaseTo(setupData.auction.startTime + 759);

                const txn = await resolver.settleOrders(fillOrderToData);
                await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('100'), ether('-100')]);
                await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.106'), ether('0.106')]);
            });

            it('matching order between 2 bump point', async function () {
                const dataFormFixture = await loadFixture(initContractsForSettlement);
                const auction = await buildAuctionDetails({ points: [[500000, 240], [100000, 1240]] });
                const setupData = { ...dataFormFixture, auction };
                const {
                    contracts: { dai, weth, resolver },
                    accounts: { owner, alice },
                } = setupData;

                const fillOrderToData = await prepareSingleOrder({
                    targetTakingAmount: ether('0.103'),
                    setupData,
                });
                await timeIncreaseTo(setupData.auction.startTime + 859);

                const txn = await resolver.settleOrders(fillOrderToData);
                await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('100'), ether('-100')]);
                await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.103'), ether('0.103')]);
            });
        });

        it('set initial rate', async function () {
            const dataFormFixture = await loadFixture(initContractsForSettlement);
            const auction = await buildAuctionDetails({ delay: 60, initialRateBump: 2000000n });
            const setupData = { ...dataFormFixture, auction };
            const {
                contracts: { dai, weth, resolver },
                accounts: { owner, alice },
            } = setupData;

            const fillOrderToData = await prepareSingleOrder({ setupData });

            const txn = await resolver.settleOrders(fillOrderToData);
            await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('100'), ether('-100')]);
            await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.12'), ether('0.12')]);
        });

        it('set auctionDuration', async function () {
            const dataFormFixture = await loadFixture(initContractsForSettlement);

            const normalizeTime = Math.floor(((await time.latest()) + 59) / 60) * 60;
            const auction = await buildAuctionDetails({ startTime: normalizeTime - (450 - 3), duration: 900, initialRateBump: 1000000n });
            const setupData = { ...dataFormFixture, auction };
            const {
                contracts: { dai, weth, resolver },
                accounts: { owner, alice },
            } = setupData;

            await time.increaseTo(normalizeTime);
            const fillOrderToData = await prepareSingleOrder({
                setupData,
            });

            const txn = await resolver.settleOrders(fillOrderToData);
            await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('100'), ether('-100')]);
            await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.105'), ether('0.105')]);
        });
    });

    it('should change availableCredit with non-zero fee', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, settlement, resolver },
            accounts: { owner, alice },
        } = setupData;

        const fillOrderToData1 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.1'),
                takingAmount: ether('100'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('0.1'),
            isInnermostOrder: true,
            isMakingAmount: false,
            feeType: 1,
            resolverFee: BACK_ORDER_FEE,
        });

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: owner.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: owner,
            setupData,
            minReturn: ether('100'),
            additionalDataForSettlement: fillOrderToData1,
            isMakingAmount: false,
            feeType: 1,
            resolverFee: ORDER_FEE,
        });
        const availableCreditBefore = await settlement.availableCredit(resolver.address);

        await resolver.settleOrders(fillOrderToData0);
        expect(await settlement.availableCredit(resolver.address)).to.equal(
            availableCreditBefore.toBigInt() - BASE_POINTS * (ORDER_FEE + BACK_ORDER_FEE),
        );
    });

    it('partial fill with taking fee', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, settlement, resolver },
            accounts: { owner, alice },
            others: { abiCoder },
        } = setupData;

        const partialModifier = 40n;
        const points = 100n;

        const resolverArgs = abiCoder.encode(
            ['address[]', 'bytes[]'],
            [
                [weth.address],
                [
                    weth.interface.encodeFunctionData('transferFrom', [
                        owner.address,
                        resolver.address,
                        ether('0.01') * partialModifier / points,
                    ]),
                ],
            ],
        );

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('10'),
                takingAmount: ether('0.01'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('0.01') * partialModifier / points,
            additionalDataForSettlement: resolverArgs,
            isInnermostOrder: true,
            fillingAmount: ether('10') * partialModifier / points,
            feeType: 1,
            resolverFee: ORDER_FEE,
        });

        await weth.approve(resolver.address, ether('0.01'));
        const availableCreditBefore = await settlement.availableCredit(resolver.address);

        const txn = await resolver.settleOrders(fillOrderToData0);
        await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('10') * partialModifier / points, ether('-10') * partialModifier / points]);
        await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.01') * partialModifier / points, ether('0.01') * partialModifier / points]);
        expect(await settlement.availableCredit(resolver.address)).to.equal(
            availableCreditBefore.toBigInt() - (ORDER_FEE * partialModifier / points) * BASE_POINTS,
        );
    });

    it('resolver should pay minimal 1 wei fee', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, settlement, resolver },
            accounts: { owner, alice },
            others: { abiCoder },
        } = setupData;

        const minimalPartialModifier = 1n;
        const points = ether('0.01');
        const minimalOrderFee = 10n;

        const resolverArgs = abiCoder.encode(
            ['address[]', 'bytes[]'],
            [
                [weth.address],
                [
                    weth.interface.encodeFunctionData('transferFrom', [
                        owner.address,
                        resolver.address,
                        ether('0.01') * minimalPartialModifier / points,
                    ]),
                ],
            ],
        );

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('10'),
                takingAmount: ether('0.01'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('0.01'),
            additionalDataForSettlement: resolverArgs,
            isInnermostOrder: true,
            fillingAmount: ether('10') * minimalPartialModifier / points,
            feeType: 1,
            resolverFee: minimalOrderFee,
        });

        await weth.approve(resolver.address, ether('0.01'));
        const availableCreditBefore = await settlement.availableCredit(resolver.address);

        const txn = await resolver.settleOrders(fillOrderToData0);
        await expect(txn).to.changeTokenBalances(dai, [resolver, alice], [ether('10') * minimalPartialModifier / points, ether('-10') * minimalPartialModifier / points]);
        await expect(txn).to.changeTokenBalances(weth, [owner, alice], [ether('-0.01') * minimalPartialModifier / points, ether('0.01') * minimalPartialModifier / points]);
        expect(await settlement.availableCredit(resolver.address)).to.equal(
            availableCreditBefore.toBigInt() - 1n,
        );
    });

    it('should not change when availableCredit is not enough', async function () {
        const dataFormFixture = await loadFixture(initContractsForSettlement);
        const auction = await buildAuctionDetails();
        const setupData = { ...dataFormFixture, auction };
        const {
            contracts: { dai, weth, resolver },
            accounts: { owner, alice },
        } = setupData;

        const fillOrderToData1 = await buildCalldataForOrder({
            orderData: {
                maker: alice.address,
                makerAsset: weth.address,
                takerAsset: dai.address,
                makingAmount: ether('0.1'),
                takingAmount: ether('100'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: alice,
            setupData,
            minReturn: ether('100'),
            isInnermostOrder: true,
            feeType: 1,
            resolverFee: BACK_ORDER_FEE,
        });

        const fillOrderToData0 = await buildCalldataForOrder({
            orderData: {
                maker: owner.address,
                makerAsset: dai.address,
                takerAsset: weth.address,
                makingAmount: ether('100'),
                takingAmount: ether('0.1'),
                makerTraits: buildMakerTraits(),
            },
            orderSigner: owner,
            setupData,
            minReturn: ether('0.1'),
            additionalDataForSettlement: fillOrderToData1,
            feeType: 1,
            resolverFee: '1000000',
        });

        await expect(resolver.settleOrders(fillOrderToData0)).to.be.revertedWithCustomError(
            dataFormFixture.contracts.settlement, 'NotEnoughCredit',
        );
    });

    describe('whitelist lock period', async function () {
        it('should change only after whitelistedCutOff', async function () {
            const dataFormFixture = await loadFixture(initContractsForSettlement);
            const auction = await buildAuctionDetails({ startTime: await time.latest() + time.duration.hours('3') });
            const setupData = { ...dataFormFixture, auction };
            const {
                contracts: { dai, weth, resolver },
                accounts: { owner, alice },
            } = setupData;

            const fillOrderToData1 = await buildCalldataForOrder({
                orderData: {
                    maker: alice.address,
                    makerAsset: weth.address,
                    takerAsset: dai.address,
                    makingAmount: ether('0.1'),
                    takingAmount: ether('100'),
                    makerTraits: buildMakerTraits(),
                },
                orderSigner: alice,
                setupData,
                minReturn: ether('100'),
                isInnermostOrder: true,
            });

            const fillOrderToData0 = await buildCalldataForOrder({
                orderData: {
                    maker: owner.address,
                    makerAsset: dai.address,
                    takerAsset: weth.address,
                    makingAmount: ether('100'),
                    takingAmount: ether('0.1'),
                    makerTraits: buildMakerTraits(),
                },
                orderSigner: owner,
                setupData,
                minReturn: ether('0.1'),
                additionalDataForSettlement: fillOrderToData1,
            });

            await expect(resolver.settleOrders(fillOrderToData0)).to.be.revertedWithCustomError(
                setupData.contracts.settlement, 'ResolverIsNotWhitelisted',
            );

            await timeIncreaseTo(setupData.auction.startTime + 1);

            await resolver.settleOrders(fillOrderToData0);
        });
    });
});
