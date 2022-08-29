const { expect, ether } = require('@1inch/solidity-utils');
const { artifacts } = require('hardhat');
const { addr0Wallet, addr1Wallet } = require('./helpers/utils');
const { getPermit } = require('@1inch/solidity-utils');

const FeeBank = artifacts.require('FeeBank');
const TokenMock = artifacts.require('ERC20PermitMock');
const WrappedTokenMock = artifacts.require('WrappedTokenMock');
const LimitOrderProtocol = artifacts.require('LimitOrderProtocol');
const WhitelistRegistrySimple = artifacts.require('WhitelistRegistrySimple');
const Settlement = artifacts.require('Settlement');

describe('FeeBank', async () => {
    const [addr0, addr1] = [addr0Wallet.getAddressString(), addr1Wallet.getAddressString()];

    before(async () => {
        this.chainId = await web3.eth.getChainId();
        this.whitelistRegistrySimple = await WhitelistRegistrySimple.new();
    });

    beforeEach(async () => {
        // this.inch = await TokenMock.new('1INCH', '1INCH');
        this.inch = await TokenMock.new('1INCH', '1INCH', addr0, ether('200'));
        this.weth = await WrappedTokenMock.new('WETH', 'WETH');

        this.swap = await LimitOrderProtocol.new(this.weth.address);
        this.matcher = await Settlement.new(this.whitelistRegistrySimple.address, this.swap.address);
        this.feeBank = await FeeBank.new(this.matcher.address, this.inch.address);

        await this.matcher.setFeeBank(this.feeBank.address);
        // await this.inch.mint(addr0, ether('100'));
        // await this.inch.mint(addr1, ether('100'));
        await this.inch.transfer(addr1, ether('100'), { from: addr0 });
        await this.inch.approve(this.feeBank.address, ether('1000'), { from: addr0 });
        await this.inch.approve(this.feeBank.address, ether('1000'), { from: addr1 });
    });

    describe('deposits', async () => {
        it('should increase accountDeposits and creditAllowance with deposit()', async () => {
            const addr0Amount = ether('1');
            const addr1Amount = ether('10');
            await this.feeBank.deposit(addr0Amount, { from: addr0 });
            await this.feeBank.deposit(addr1Amount, { from: addr1 });
            expect(await this.feeBank.accountDeposits(addr0)).to.be.bignumber.eq(addr0Amount);
            expect(await this.feeBank.accountDeposits(addr1)).to.be.bignumber.eq(addr1Amount);
            expect(await this.matcher.creditAllowance(addr0)).to.be.bignumber.eq(addr0Amount);
            expect(await this.matcher.creditAllowance(addr1)).to.be.bignumber.eq(addr1Amount);
        });

        it('should increase accountDeposits and creditAllowance with depositFor()', async () => {
            const addr0Amount = ether('1');
            const addr1Amount = ether('10');
            await this.feeBank.depositFor(addr0, addr0Amount, { from: addr1 });
            await this.feeBank.depositFor(addr1, addr1Amount, { from: addr0 });
            expect(await this.feeBank.accountDeposits(addr0)).to.be.bignumber.eq(addr0Amount);
            expect(await this.feeBank.accountDeposits(addr1)).to.be.bignumber.eq(addr1Amount);
            expect(await this.matcher.creditAllowance(addr0)).to.be.bignumber.eq(addr0Amount);
            expect(await this.matcher.creditAllowance(addr1)).to.be.bignumber.eq(addr1Amount);
        });

        it('should increase accountDeposits and creditAllowance without approve with depositWithPermit()', async () => {
            const addr0Amount = ether('1');
            await this.inch.approve(this.feeBank.address, '0', { from: addr0 });
            const permit = await getPermit(addr0, addr0Wallet.getPrivateKey(), this.inch, '1', this.chainId, this.feeBank.address, addr0Amount);
            await this.feeBank.depositWithPermit(addr0Amount, permit, { from: addr0 });
            expect(await this.feeBank.accountDeposits(addr0)).to.be.bignumber.eq(addr0Amount);
            expect(await this.matcher.creditAllowance(addr0)).to.be.bignumber.eq(addr0Amount);
        });

        it('should increase accountDeposits and creditAllowance without approve with depositForWithPermit()', async () => {
            const addr0Amount = ether('1');
            await this.inch.approve(this.feeBank.address, '0', { from: addr0 });
            const permit = await getPermit(addr0, addr0Wallet.getPrivateKey(), this.inch, '1', this.chainId, this.feeBank.address, addr0Amount);
            await this.feeBank.depositForWithPermit(addr1, addr0Amount, permit, { from: addr0 });
            expect(await this.feeBank.accountDeposits(addr1)).to.be.bignumber.eq(addr0Amount);
            expect(await this.matcher.creditAllowance(addr1)).to.be.bignumber.eq(addr0Amount);
        });
    });
});
