const { expect, ether, getPermit, deployContract } = require('@1inch/solidity-utils');
const { ethers } = require('hardhat');
const { BigNumber: BN } = require('ethers');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { PANIC_CODES } = require('@nomicfoundation/hardhat-chai-matchers/panic');
const { deploySwapTokens, getChainId } = require('./helpers/fixtures');

describe('FeeBank', function () {
    async function initContracts() {
        const chainId = await getChainId();
        const [owner, alice] = await ethers.getSigners();

        const inch = await deployContract('ERC20PermitMock', ['1INCH', '1INCH', owner.address, ether('1000')]);
        const { lopv4 } = await deploySwapTokens();
        const matcher = await deployContract('SettlementExtensionMock', [lopv4.address, inch.address]);

        const FeeBank = await ethers.getContractFactory('FeeBank');
        const feeBank = FeeBank.attach(await matcher.feeBank());

        await inch.transfer(alice.address, ether('100'));
        await inch.approve(feeBank.address, ether('1000'));
        await inch.connect(alice).approve(feeBank.address, ether('1000'));

        return {
            contracts: { inch, feeBank, matcher },
            accounts: { owner, alice },
            others: { chainId },
        };
    }

    describe('deposits', function () {
        it('should increase accountDeposits and availableCredit with deposit()', async function () {
            const { contracts: { inch, feeBank }, accounts: { owner, alice } } = await loadFixture(initContracts);
            const ownerAmount = ether('1');
            const aliceAmount = ether('10');
            const ownerBalanceBefore = await inch.balanceOf(owner.address);
            const aliceBalanceBefore = await inch.balanceOf(alice.address);

            await feeBank.deposit(ownerAmount);
            await feeBank.connect(alice).deposit(aliceAmount);

            expect(await feeBank.availableCredit(owner.address)).to.equal(ownerAmount);
            expect(await feeBank.availableCredit(alice.address)).to.equal(aliceAmount);
            expect(await inch.balanceOf(owner.address)).to.equal(ownerBalanceBefore.sub(ownerAmount));
            expect(await inch.balanceOf(alice.address)).to.equal(aliceBalanceBefore.sub(aliceAmount));
        });

        it('should increase accountDeposits and availableCredit with depositFor()', async function () {
            const { contracts: { inch, feeBank }, accounts: { owner, alice } } = await loadFixture(initContracts);
            const ownerAmount = ether('1');
            const aliceAmount = ether('10');
            const ownerBalanceBefore = await inch.balanceOf(owner.address);
            const aliceBalanceBefore = await inch.balanceOf(alice.address);

            await feeBank.connect(alice).depositFor(owner.address, ownerAmount);
            await feeBank.depositFor(alice.address, aliceAmount);

            expect(await feeBank.availableCredit(owner.address)).to.equal(ownerAmount);
            expect(await feeBank.availableCredit(alice.address)).to.equal(aliceAmount);
            expect(await inch.balanceOf(owner.address)).to.equal(ownerBalanceBefore.sub(aliceAmount));
            expect(await inch.balanceOf(alice.address)).to.equal(aliceBalanceBefore.sub(ownerAmount));
        });

        it('should increase accountDeposits and availableCredit without approve with depositWithPermit()', async function () {
            const { contracts: { inch, feeBank }, accounts: { owner }, others: { chainId } } = await loadFixture(initContracts);
            const ownerAmount = ether('1');
            await inch.approve(feeBank.address, '0');
            const permit = await getPermit(owner, inch, '1', chainId, feeBank.address, ownerAmount);
            const ownerBalanceBefore = await inch.balanceOf(owner.address);

            await feeBank.depositWithPermit(ownerAmount, permit);

            expect(await feeBank.availableCredit(owner.address)).to.equal(ownerAmount);
            expect(await inch.balanceOf(owner.address)).to.equal(ownerBalanceBefore.sub(ownerAmount));
        });

        it('should increase accountDeposits and availableCredit without approve with depositForWithPermit()', async function () {
            const { contracts: { inch, feeBank }, accounts: { owner, alice }, others: { chainId } } = await loadFixture(initContracts);
            const ownerAmount = ether('1');
            await inch.approve(feeBank.address, '0');
            const permit = await getPermit(owner, inch, '1', chainId, feeBank.address, ownerAmount);
            const ownerBalanceBefore = await inch.balanceOf(owner.address);

            await feeBank.depositForWithPermit(alice.address, ownerAmount, permit);

            expect(await feeBank.availableCredit(alice.address)).to.equal(ownerAmount);
            expect(await inch.balanceOf(owner.address)).to.equal(ownerBalanceBefore.sub(ownerAmount));
        });
    });

    describe('withdrawals', function () {
        async function initContratsAndDeposit() {
            const data = await initContracts();
            const { contracts: { feeBank } } = data;
            const totalDepositAmount = ether('100');
            await feeBank.deposit(totalDepositAmount);
            return { ...data, others: { ...data.others, totalDepositAmount } };
        }

        it('should decrease accountDeposits and availableCredit with withdraw()', async function () {
            const { contracts: { inch, feeBank }, accounts: { owner }, others: { totalDepositAmount } } = await loadFixture(initContratsAndDeposit);
            const amount = ether('10');
            const ownerBalanceBefore = await inch.balanceOf(owner.address);

            await feeBank.withdraw(amount);

            expect(await feeBank.availableCredit(owner.address)).to.equal(totalDepositAmount - amount);
            expect(await inch.balanceOf(owner.address)).to.equal(ownerBalanceBefore.add(amount));
        });

        it('should decrease accountDeposits and availableCredit with withdrawTo()', async function () {
            const { contracts: { inch, feeBank }, accounts: { owner, alice }, others: { totalDepositAmount } } = await loadFixture(initContratsAndDeposit);
            const amount = ether('10');
            const aliceBalanceBefore = await inch.balanceOf(alice.address);

            await feeBank.withdrawTo(alice.address, amount);

            expect(await feeBank.availableCredit(owner.address)).to.equal(totalDepositAmount - amount);
            expect(await inch.balanceOf(alice.address)).to.equal(aliceBalanceBefore.add(amount));
        });

        it('should not withdrawal more than account have', async function () {
            const { contracts: { feeBank }, others: { totalDepositAmount } } = await loadFixture(initContratsAndDeposit);
            await expect(feeBank.withdraw(totalDepositAmount + 1n)).to.be.revertedWithPanic(PANIC_CODES.UNDERFLOW);
        });
    });

    describe('gatherFees', function () {
        it('should correct withdrawal fee for 1 account', async function () {
            const { contracts: { inch, feeBank, matcher }, accounts: { owner, alice } } = await loadFixture(initContracts);
            const amount = ether('10');
            const subCreditAmount = ether('2');
            await feeBank.connect(alice).deposit(amount);
            await matcher.decreaseAvailableCreditMock(alice.address, subCreditAmount);

            const balanceBefore = await inch.balanceOf(owner.address);
            expect(await feeBank.availableCredit(alice.address)).to.equal(amount - subCreditAmount);
            await feeBank.gatherFees([alice.address]);

            expect(await feeBank.availableCredit(alice.address)).to.equal(amount - subCreditAmount);
            expect(await inch.balanceOf(owner.address)).to.equal(balanceBefore.toBigInt() + subCreditAmount);
        });

        it('should correct withdrawal fee for 2 account', async function () {
            const { contracts: { inch, feeBank, matcher }, accounts: { owner, alice } } = await loadFixture(initContracts);
            const ownerAmount = ether('10');
            const aliceAmount = ether('25');
            const subCreditownerAmount = ether('2');
            const subCreditaliceAmount = ether('11');
            await feeBank.deposit(ownerAmount);
            await feeBank.connect(alice).deposit(aliceAmount);
            await matcher.decreaseAvailableCreditMock(owner.address, subCreditownerAmount);
            await matcher.decreaseAvailableCreditMock(alice.address, subCreditaliceAmount);

            const balanceBefore = await inch.balanceOf(owner.address);
            expect(await feeBank.availableCredit(owner.address)).to.equal(ownerAmount - subCreditownerAmount);
            expect(await feeBank.availableCredit(alice.address)).to.equal(aliceAmount - subCreditaliceAmount);
            await feeBank.gatherFees([owner.address, alice.address]);

            expect(await feeBank.availableCredit(owner.address)).to.equal(ownerAmount - subCreditownerAmount);
            expect(await feeBank.availableCredit(alice.address)).to.equal(aliceAmount - subCreditaliceAmount);
            expect(await inch.balanceOf(owner.address)).to.equal(
                balanceBefore.add(subCreditownerAmount).add(subCreditaliceAmount),
            );
        });

        it('should correct withdrawal fee for several account', async function () {
            const { contracts: { inch, feeBank, matcher }, accounts: { owner } } = await loadFixture(initContracts);
            const accounts = [];
            const wallets = await ethers.getSigners();
            for (const wallet of wallets) {
                accounts.push(wallet.address);
            }
            const amounts = [];
            const subCreditAmounts = [];
            let totalSubCreditAmounts = ether('0');
            for (let i = 1; i < accounts.length; i++) {
                amounts[i] = BN.from(ethers.utils.randomBytes(8));
                subCreditAmounts[i] = BN.from(ethers.utils.randomBytes(2)).toBigInt();
                totalSubCreditAmounts = totalSubCreditAmounts + subCreditAmounts[i];
                await feeBank.depositFor(accounts[i], amounts[i]);
            }
            for (let i = 1; i < accounts.length; i++) {
                await matcher.decreaseAvailableCreditMock(accounts[i], subCreditAmounts[i]);
            }

            const balanceBefore = await inch.balanceOf(owner.address);
            for (let i = 1; i < accounts.length; i++) {
                expect(await feeBank.availableCredit(accounts[i])).to.equal(amounts[i].sub(subCreditAmounts[i]));
            }

            await feeBank.gatherFees(accounts);
            for (let i = 1; i < accounts.length; i++) {
                expect(await feeBank.availableCredit(accounts[i])).to.equal(amounts[i].sub(subCreditAmounts[i]));
            }
            expect(await inch.balanceOf(owner.address)).to.equal(balanceBefore.add(totalSubCreditAmounts));
        });

        it('should not work by non-owner', async function () {
            const { contracts: { feeBank }, accounts: { owner, alice } } = await loadFixture(initContracts);
            await expect(feeBank.connect(alice).gatherFees([owner.address, alice.address])).to.be.revertedWith(
                'Ownable: caller is not the owner',
            );
        });
    });
});
