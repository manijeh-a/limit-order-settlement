const { expect, ether, deployContract } = require('@1inch/solidity-utils');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('FeeBankCharger', function () {
    async function initContracts() {
        const [owner, alice] = await ethers.getSigners();
        const inch = await deployContract('ERC20PermitMock', ['1INCH', '1INCH', owner.address, ether('1000')]);

        const charger = await deployContract('FeeBankCharger', [inch.address]);

        const FeeBank = await ethers.getContractFactory('FeeBank');
        const feeBank = FeeBank.attach(await charger.feeBank());

        await inch.transfer(alice.address, ether('100'));
        await inch.approve(feeBank.address, ether('1000'));
        await inch.connect(alice).approve(feeBank.address, ether('1000'));

        return {
            contracts: { inch, charger, feeBank },
            accounts: { owner, alice },
        };
    }

    describe('increaseAvailableCredit', function () {
        it('should increase credit', async function () {
            const { contracts: { charger, feeBank }, accounts: { alice } } = await loadFixture(initContracts);
            const amount = ether('100');
            expect(await charger.availableCredit(alice.address)).to.equal('0');
            await feeBank.depositFor(alice.address, amount);
            expect(await charger.availableCredit(alice.address)).to.equal(amount);
        });

        it('should not increase credit by non-feeBank address', async function () {
            const { contracts: { charger }, accounts: { alice } } = await loadFixture(initContracts);
            await expect(charger.increaseAvailableCredit(alice.address, ether('100'))).to.be.revertedWithCustomError(
                charger,
                'OnlyFeeBankAccess',
            );
        });
    });

    describe('decreaseAvailableCredit', function () {
        async function initContractsAndAllowance() {
            const data = await initContracts();
            const { contracts: { feeBank } } = data;
            const creditAmount = ether('100');
            await feeBank.deposit(creditAmount);
            return { ...data, others: { creditAmount } };
        }

        it('should decrease credit', async function () {
            const { contracts: { charger, feeBank }, accounts: { owner, alice }, others: { creditAmount } } = await loadFixture(initContractsAndAllowance);
            const amount = ether('10');
            expect(await charger.availableCredit(owner.address)).to.equal(creditAmount);
            await feeBank.withdrawTo(alice.address, amount);
            expect(await charger.availableCredit(owner.address)).to.equal(creditAmount - amount);
        });

        it('should not deccrease credit by non-feeBank address', async function () {
            const { contracts: { charger }, accounts: { alice } } = await loadFixture(initContractsAndAllowance);
            await expect(charger.decreaseAvailableCredit(alice.address, ether('10'))).to.be.revertedWithCustomError(
                charger,
                'OnlyFeeBankAccess',
            );
        });
    });
});
