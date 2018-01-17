/* globals artifacts */
import testHelper from '../helpers/test-helper';
import testDataGenerator from '../helpers/test-data-generator';


const EtherRouter = artifacts.require('EtherRouter');
const IColony = artifacts.require('IColony');
const IColonyNetwork = artifacts.require('IColonyNetwork');
const Token = artifacts.require('Token');
const ReputationMiningCycle = artifacts.require('ReputationMiningCycle');

const BigNumber = require('bignumber.js');

BigNumber.config({ ERRORS: false });


contract('ColonyNetwork', (accounts) => {
  const MAIN_ACCOUNT = accounts[0];
  const OTHER_ACCOUNT = accounts[1];


  let commonColony;
  let colonyNetwork;
  let clny;

  before(async () => {
    const etherRouter = await EtherRouter.deployed();
    colonyNetwork = await IColonyNetwork.at(etherRouter.address);
    // await upgradableContracts.setupColonyVersionResolver(colony, colonyFunding, colonyTask, colonyTransactionReviewer, resolver, colonyNetwork);

    const commonColonyAddress = await colonyNetwork.getColony('Common Colony');
    commonColony = IColony.at(commonColonyAddress);
    // console.log('CC address ', commonColonyAddress);
    const clnyAddress = await commonColony.getToken.call();
    // console.log('CLNY address ', clnyAddress);
    clny = Token.at(clnyAddress);
  });

  before(async () => {
    await colonyNetwork.startNextCycle();
  });

  async function giveUserCLNYTokens(address, amount) {
    const mainStartingBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    const targetStartingBalance = await clny.balanceOf.call(address);
    await commonColony.mintTokens(amount * 1.1);
    await commonColony.claimColonyFunds(clny.address);
    const taskId = await testDataGenerator.setupRatedTask(commonColony, undefined, undefined, undefined, undefined, 1.1 * amount, 0);
    await commonColony.finalizeTask(taskId);
    await commonColony.claimPayout(taskId, 0, clny.address);

    let mainBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    clny.transfer(0x0, mainBalance.minus(amount).minus(mainStartingBalance));
    await clny.transfer(address, amount);

    mainBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    if (address !== MAIN_ACCOUNT) {
      await clny.transfer(0x0, mainBalance.minus(mainStartingBalance));
    }

    const userBalance = await clny.balanceOf.call(address);
    assert.equal(targetStartingBalance.add(amount).toNumber(), userBalance.toNumber());
  }

  afterEach(async () => {
    // Withdraw all stakes. Can only do this at the start of a new cycle, if anyone has submitted a hash in this current cycle.
    const addr = await colonyNetwork.getReputationMiningCycle.call();
    const repCycle = ReputationMiningCycle.at(addr);
    const nSubmittedHashes = await repCycle.nSubmittedHashes.call();
    if (nSubmittedHashes > 0) {
      const nInvalidatedHashes = await repCycle.nInvalidatedHashes.call();
      if (nSubmittedHashes - nInvalidatedHashes === 1) {
        await repCycle.confirmNewHash(nSubmittedHashes.equals(1) ? 0 : 1); // Not a general solution - only works for one or two submissions.
        // But for now, that's okay.
      } else {
        // We shouldn't get here. If this fires during a test, you haven't finished writing the test.
        console.log("We're mid dispute process, and can't untangle from here"); // eslint-disable-line no-console
        process.exit(1);
        return;
      }
    }
    let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
    if (stakedBalance.toNumber() > 0) {
      await colonyNetwork.withdraw(stakedBalance.toNumber(), { from: OTHER_ACCOUNT });
    }
    stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
    if (stakedBalance.toNumber() > 0) {
      await colonyNetwork.withdraw(stakedBalance.toNumber(), { from: MAIN_ACCOUNT });
    }
    let userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
    await clny.transfer(0x0, userBalance, { from: OTHER_ACCOUNT });
    userBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    await clny.transfer(0x0, userBalance, { from: MAIN_ACCOUNT });
  });

  describe.only('when initialised', () => {
    it('should allow miners to stake CLNY', async () => {
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 5000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(5000, { from: OTHER_ACCOUNT });
      const userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 4000);
      const stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 5000);
    });

    it('should allow miners to withdraw staked CLNY', async () => {
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 5000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(5000, { from: OTHER_ACCOUNT });
      let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      await colonyNetwork.withdraw(stakedBalance.toNumber(), { from: OTHER_ACCOUNT });
      stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 0);
    });

    it('should not allow miners to deposit more CLNY than they have', async () => {
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 10000, { from: OTHER_ACCOUNT });
      await testHelper.checkErrorRevert(colonyNetwork.deposit(10000, { from: OTHER_ACCOUNT }));
      const userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 9000);
      const stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 0);
    });

    it('should not allow miners to withdraw more CLNY than they staked, even if enough has been staked total', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, 9000);
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 9000, { from: OTHER_ACCOUNT });
      await clny.approve(colonyNetwork.address, 9000, { from: MAIN_ACCOUNT });
      await colonyNetwork.deposit(9000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(9000, { from: MAIN_ACCOUNT });
      await testHelper.checkErrorRevert(colonyNetwork.withdraw(10000, { from: OTHER_ACCOUNT }));
      const stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 9000);
      const userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 0);
    });

    // it('should allow a new cycle to start if there is none currently', async function(){
    //   let addr = await colonyNetwork.getReputationMiningCycle.call();
    //   assert(addr==0x0);
    //   await colonyNetwork.startNextCycle();
    //   addr = await colonyNetwork.getReputationMiningCycle.call();
    //   assert(addr!=0x0);
    // })

    it('should allow a new reputation hash to be submitted', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600, this);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      const submitterAddress = await repCycle.submittedHashes.call('0x12345678', 10, 0);
      assert.equal(submitterAddress, MAIN_ACCOUNT);
    });

    it('should not allow someone to submit a new reputation hash if they are not staking', async () => {
      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600);
      const repCycle = ReputationMiningCycle.at(addr);
      await testHelper.checkErrorRevert(repCycle.submitNewHash('0x12345678', 10, 0));
      const nSubmittedHashes = await repCycle.nSubmittedHashes.call();
      assert(nSubmittedHashes.equals(0));
    });

    it('should not allow someone to withdraw their stake if they have submitted a hash this round', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      let stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
      await testHelper.checkErrorRevert(colonyNetwork.withdraw(stakedBalance.toNumber(), { from: MAIN_ACCOUNT }));
      stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
      assert(stakedBalance.equals('1000000000000000000'));
    });

    it('should allow a new reputation hash to be set if only one was submitted', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600, this);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      await repCycle.confirmNewHash(0);
      const newAddr = await colonyNetwork.getReputationMiningCycle.call();
      assert(newAddr !== 0x0);
      assert(addr !== 0x0);
      assert(newAddr !== addr);
      const rootHash = await colonyNetwork.getReputationRootHash.call();
      assert.equal(rootHash, '0x1234567800000000000000000000000000000000000000000000000000000000');
      const rootHashNNodes = await colonyNetwork.getReputationRootHashNNodes.call();
      assert(rootHashNNodes.equals(10));
    });

    it('should allow a new reputation hash to be set if all but one submitted have been elimintated', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await giveUserCLNYTokens(OTHER_ACCOUNT, new BigNumber('1000000000000000000'));

      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600, this);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      await repCycle.submitNewHash('0x87654321', 10, 10, { from: OTHER_ACCOUNT });
      await repCycle.invalidateHash(0, 1);
      await repCycle.confirmNewHash(1);
      const newAddr = await colonyNetwork.getReputationMiningCycle.call();
      assert(newAddr !== 0x0);
      assert(addr !== 0x0);
      assert(newAddr !== addr);
      const rootHash = await colonyNetwork.getReputationRootHash.call();
      assert.equal(rootHash, '0x1234567800000000000000000000000000000000000000000000000000000000');
      const rootHashNNodes = await colonyNetwork.getReputationRootHashNNodes.call();
      assert(rootHashNNodes.equals(10));
    });


    it('should not allow a new reputation hash to be set if more than one was submitted and they have not been elimintated', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await giveUserCLNYTokens(OTHER_ACCOUNT, new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });
      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600, this);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      await repCycle.submitNewHash('0x87654321', 10, 10, { from: OTHER_ACCOUNT });
      await testHelper.checkErrorRevert(repCycle.confirmNewHash(0));
      const newAddr = await colonyNetwork.getReputationMiningCycle.call();
      assert(newAddr !== 0x0);
      assert(addr !== 0x0);
      assert(newAddr === addr);
      // Eliminate one so that the afterAll works.
      await repCycle.invalidateHash(0, 0);
    });

    it('should not allow the last reputation hash to be eliminated', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await giveUserCLNYTokens(OTHER_ACCOUNT, new BigNumber('1000000000000000000'));

      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600, this);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      await repCycle.submitNewHash('0x87654321', 10, 10, { from: OTHER_ACCOUNT });
      await repCycle.invalidateHash(0, 1);
      await testHelper.checkErrorRevert(repCycle.invalidateHash(1, 0));
    });


    it('should not allow someone to submit a new reputation hash if they are ineligible', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      const repCycle = ReputationMiningCycle.at(addr);
      await testHelper.checkErrorRevert(repCycle.submitNewHash('0x12345678', 10, 10));
      const nSubmittedHashes = await repCycle.nSubmittedHashes.call();
      assert(nSubmittedHashes.equals(0));
    });

    it('should punish all stakers if they misbehave (and report a bad hash)', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await giveUserCLNYTokens(OTHER_ACCOUNT, new BigNumber('1000000000000000000'));
      await giveUserCLNYTokens(accounts[2], new BigNumber('1000000000000000000'));

      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });
      let balance = await colonyNetwork.getStakedBalance(OTHER_ACCOUNT);
      assert(balance.equals('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'), { from: accounts[2] });
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'), { from: accounts[2] });
      let balance2 = await colonyNetwork.getStakedBalance(accounts[2]);
      assert(balance.equals('1000000000000000000'));

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600, this);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      await repCycle.submitNewHash('0x87654321', 10, 10, { from: OTHER_ACCOUNT });
      await repCycle.submitNewHash('0x87654321', 10, 10, { from: accounts[2] });
      await repCycle.invalidateHash(0, 1);
      balance = await colonyNetwork.getStakedBalance(OTHER_ACCOUNT);
      assert.equal(balance.toString(), '0', 'Account was not punished properly');
      balance2 = await colonyNetwork.getStakedBalance(accounts[2]);
      assert.equal(balance2.toString(), '0', 'Account was not punished properly');
    });

    it('should reward all stakers if they submitted the agreed new hash', async () => {
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber('1000000000000000000'));
      await giveUserCLNYTokens(OTHER_ACCOUNT, new BigNumber('1000000000000000000'));
      await giveUserCLNYTokens(accounts[2], new BigNumber('1000000000000000000'));

      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'));
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'));
      await clny.approve(colonyNetwork.address, new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(new BigNumber('1000000000000000000'), { from: OTHER_ACCOUNT });

      const addr = await colonyNetwork.getReputationMiningCycle.call();
      await testHelper.forwardTime(3600, this);
      const repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash('0x12345678', 10, 10);
      await repCycle.submitNewHash('0x12345678', 10, 8, { from: OTHER_ACCOUNT });
      await repCycle.confirmNewHash(0);

      // Check that they have had their staked balance increase
      const balance1Updated = await colonyNetwork.getStakedBalance(MAIN_ACCOUNT);
      assert.equal(balance1Updated.toString(), new BigNumber(2).times(new BigNumber(10).pow(18)).toString(), 'Account was not rewarded properly');
      const balance2Updated = await colonyNetwork.getStakedBalance(OTHER_ACCOUNT);
      assert.equal(balance2Updated.toString(), new BigNumber(2).times(new BigNumber(10).pow(18)).toString(), 'Account was not rewarded properly');

      // Check that they will be getting the reputation owed to them.
      let repLogEntryMiner = await colonyNetwork.getReputationUpdateLogEntry.call(0);
      assert.equal(repLogEntryMiner[0], MAIN_ACCOUNT);
      assert.equal(repLogEntryMiner[1].toString(), new BigNumber(1).times(new BigNumber(10).pow(18)).toString());
      assert.equal(repLogEntryMiner[2].toString(), '0');
      assert.equal(repLogEntryMiner[3], commonColony.address);
      assert.equal(repLogEntryMiner[4].toString(), '4');
      assert.equal(repLogEntryMiner[5].toString(), '0');

      repLogEntryMiner = await colonyNetwork.getReputationUpdateLogEntry.call(1);
      assert.equal(repLogEntryMiner[0], OTHER_ACCOUNT);
      assert.equal(repLogEntryMiner[1].toString(), new BigNumber(1).times(new BigNumber(10).pow(18)).toString());
      assert.equal(repLogEntryMiner[2].toString(), '0');
      assert.equal(repLogEntryMiner[3], commonColony.address);
      assert.equal(repLogEntryMiner[4].toString(), '4');
      assert.equal(repLogEntryMiner[5].toString(), '4');

      const reputationUpdateLogLength = await colonyNetwork.getReputationUpdateLogLength();
      assert.equal(reputationUpdateLogLength.toString(), 2);
    });

    it('should not allow a user to back more than one hash in a single cycle');
    it('should allow a user to back the same hash more than once in a same cycle with different valid entries');
    it('should only allow 12 entries to back a single hash in each cycle');
    it('should cope with many hashes being submitted and eliminated before a winner is assigned');
  });
});
