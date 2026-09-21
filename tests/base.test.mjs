import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, ContractFactory, Contract, Interface, parseEther } from 'ethers';
import { quote, BASE_SUPPLY } from '../web/math.js';

let rpc, provider, owner, alice, factory, artifacts, adversaries;
const TREASURY = '0x0de7fdcc798f7fac6b03b366c529133a9c60794d';
async function deploy(artifact, args = [], signer = owner, overrides = {}) {
  const c = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args, overrides);
  await c.waitForDeployment(); return c;
}
async function transact(promise) { const tx = await promise; return tx.wait(); }
async function deadline() { return (await provider.getBlock('latest')).timestamp + 180; }
async function fixture() {
  const receipt = await transact(factory.createMarket('Test Token', 'TEST', 'ipfs://test'));
  const event = receipt.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } }).find(e => e?.name === 'MarketCreated');
  const market = new Contract(event.args.market, artifacts.CurveMarket.abi, alice);
  const token = new Contract(event.args.token, artifacts.LaunchToken.abi, alice);
  return { market, token, receipt };
}
async function reserves(market) { return { nativeReserve: await market.nativeReserve(), tokenReserve: await market.tokenReserve(), virtualNative: parseEther('1'), supply: BASE_SUPPLY }; }
async function balance(address) { return BigInt(await rpc.request({ method: 'eth_getBalance', params: [address, 'latest'] })); }

before(async () => {
  // Isolated in-memory test chain only. No fork, RPC listener, wallet export, or persisted keys.
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, wallet: { totalAccounts: 3 } });
  provider = new BrowserProvider(rpc); provider.pollingInterval = 10;
  owner = await provider.getSigner(0); alice = await provider.getSigner(1);
  artifacts = Object.fromEntries(await Promise.all(['LaunchFactory','CurveMarket','LaunchToken'].map(async n => [n, JSON.parse(await readFile('build/base/' + n + '.json', 'utf8'))])));
  factory = await deploy(artifacts.LaunchFactory);
  const content = await readFile('tests/fixtures/Adversaries.sol', 'utf8');
  const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Adversaries.sol': { content } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi','evm.bytecode.object'] } } } })));
  assert.ok(!out.errors?.some(e => e.severity === 'error'));
  adversaries = out.contracts['Adversaries.sol'];
});
after(async () => { provider?.destroy(); await rpc?.disconnect(); });

test('factory records real contracts, fixed supply and immutable treasury', async () => {
  const { market, token } = await fixture();
  assert.equal(await factory.isMarket(await market.getAddress()), true);
  assert.equal(await token.totalSupply(), BASE_SUPPLY);
  assert.equal(await token.balanceOf(await market.getAddress()), BASE_SUPPLY);
  assert.equal((await market.TREASURY()).toLowerCase(), TREASURY);
  assert.equal(await market.nativeReserve(), 0n);
  const mint = new Interface(['function mint(address,uint256)']);
  await assert.rejects(() => transact(alice.sendTransaction({ to: token.target, data: mint.encodeFunctionData('mint', [alice.address, 1]) })));
  assert.equal(await token.totalSupply(), BASE_SUPPLY);
});
test('buy/sell route fees and return actual inventory without burning', async () => {
  const { market, token } = await fixture();
  const input = parseEther('0.1'), treasuryBefore = await balance(TREASURY);
  const [out, fee] = await market.quoteBuy(input);
  const receipt = await transact(market.buy(out, await deadline(), { value: input }));
  assert.ok(receipt.logs.some(l => { try { return market.interface.parseLog(l)?.name === 'Trade'; } catch { return false; } }));
  assert.equal(await market.nativeReserve(), input-fee);
  assert.equal(await balance(market.target), input-fee);
  assert.equal(await balance(TREASURY)-treasuryBefore, fee);
  assert.equal(await token.balanceOf(alice.address), out);
  await transact(token.approve(market.target, out));
  const [net, sellFee] = await market.quoteSell(out);
  const treasuryMid = await balance(TREASURY);
  await transact(market.sell(out, net, await deadline()));
  assert.equal(await token.balanceOf(market.target), BASE_SUPPLY);
  assert.equal(await token.totalSupply(), BASE_SUPPLY);
  assert.equal(await market.tokenReserve(), BASE_SUPPLY);
  assert.equal(await market.nativeReserve(), input-fee-net-sellFee);
  assert.equal(await balance(market.target), await market.nativeReserve());
  assert.equal(await balance(TREASURY)-treasuryMid, sellFee);
  assert.ok(net < input);
});
test('slippage, deadlines, zero minimum and unbacked sells revert atomically', async () => {
  const { market } = await fixture();
  const input = parseEther('0.01'), [out] = await market.quoteBuy(input), d = await deadline();
  await assert.rejects(() => transact(market.buy(out+1n, d, { value: input })));
  await assert.rejects(() => transact(market.buy(0, d, { value: input })));
  await assert.rejects(() => transact(market.buy(1, 1, { value: input })));
  await assert.rejects(() => transact(market.buy(1, d+1000, { value: input })));
  await assert.rejects(() => market.quoteSell(1));
  assert.equal(await market.nativeReserve(), 0n);
  assert.equal(await market.tokenReserve(), BASE_SUPPLY);
});
test('quotes match integer model through varied round trips', async () => {
  const { market, token } = await fixture();
  for (let i = 1n; i <= 12n; i++) {
    const input = i * 10n ** 14n;
    const before = await reserves(market), q = quote(before, 'buy', input);
    const chain = await market.quoteBuy(input);
    assert.equal(chain[0], q.output); assert.equal(chain[1], q.fee);
    await transact(market.buy(q.output, await deadline(), { value: input }));
    const sellAmount = (await token.balanceOf(alice.address))/2n;
    await transact(token.approve(market.target, sellAmount));
    const sellQ = quote(await reserves(market), 'sell', sellAmount);
    const chainSell = await market.quoteSell(sellAmount);
    assert.equal(chainSell[0], sellQ.output); assert.equal(chainSell[1], sellQ.fee);
    await transact(market.sell(sellAmount, sellQ.output, await deadline()));
    assert.equal(await token.balanceOf(market.target), await market.tokenReserve());
    assert.equal(await balance(market.target), await market.nativeReserve());
    assert.equal(await token.totalSupply(), BASE_SUPPLY);
  }
});
test('donations cannot move quotes or create spendable accounting', async () => {
  const { market, token } = await fixture();
  await transact(market.buy(1, await deadline(), { value: parseEther('0.1') }));
  const before = await market.quoteBuy(parseEther('0.01')), reserve = await market.nativeReserve(), inventory = await market.tokenReserve();
  await deploy(adversaries.ForceDonation, [market.target], owner, { value: parseEther('0.2') });
  await transact(token.transfer(market.target, 1000n));
  const after = await market.quoteBuy(parseEther('0.01'));
  assert.deepEqual([...before], [...after]);
  assert.equal(await market.nativeReserve(), reserve);
  assert.equal(await market.tokenReserve(), inventory);
  assert.equal(await balance(market.target), reserve + parseEther('0.2'));
  assert.equal(await token.balanceOf(market.target), inventory + 1000n);
});
test('reentrant seller cannot enter market again during payout', async () => {
  const { market, token } = await fixture();
  const attacker = await deploy(adversaries.ReenterTrader);
  await transact(attacker.enter(market.target, { value: parseEther('0.1') }));
  await transact(attacker.exit(token.target, false));
  assert.equal(await attacker.blocked(), true);
  assert.equal(await token.balanceOf(market.target), BASE_SUPPLY);
  assert.equal(await balance(market.target), await market.nativeReserve());
});
test('failed native payout rolls back reserve changes and token transfer', async () => {
  const { market, token } = await fixture(), receiver = await deploy(adversaries.ReenterTrader);
  await transact(receiver.enter(market.target, { value: parseEther('0.1') }));
  const before = await reserves(market), held = await token.balanceOf(receiver.target);
  await assert.rejects(() => transact(receiver.exit(token.target, true)));
  assert.deepEqual(await reserves(market), before);
  assert.equal(await token.balanceOf(receiver.target), held);
});
test('rejecting treasury makes the entire buy revert rather than losing funds', async () => {
  const { market, token } = await fixture();
  // EVM-only fault injection at the fixed treasury; never used in product code.
  const d = await deadline();
  await rpc.request({ method: 'evm_setAccountCode', params: [TREASURY, '0x60006000fd'] });
  try {
    await assert.rejects(() => transact(market.buy(1, d, { value: parseEther('0.1') })));
    assert.equal(await market.nativeReserve(), 0n);
    assert.equal(await token.balanceOf(market.target), BASE_SUPPLY);
  } finally { await rpc.request({ method: 'evm_setAccountCode', params: [TREASURY, '0x'] }); }
});
test('metadata rejects invalid names, symbols, lengths and protocols', async () => {
  for (const args of [['', 'A', ''], ['Token','bad',''], ['😀'.repeat(9),'A',''], ['Token','A','javascript:bad']]) {
    await assert.rejects(() => factory.createMarket(...args));
  }
});

function normalizedRuntime(bytes, artifact) {
  const data = Buffer.from(bytes.replace(/^0x/, ''), 'hex');
  for (const ranges of Object.values(artifact.evm.deployedBytecode.immutableReferences ?? {})) {
    for (const { start, length } of ranges) data.fill(0, start, start + length);
  }
  return data;
}
test('VM bytecode matches compiled source; immutable values and gas budgets are verified', async () => {
  const estimate = await factory.createMarket.estimateGas('Test Token', 'TEST', 'ipfs://test');
  const { market, token, receipt } = await fixture();
  assert.ok(estimate >= receipt.gasUsed && estimate < 3_000_000n);
  for (const [contract, artifact] of [[factory, artifacts.LaunchFactory], [market, artifacts.CurveMarket], [token, artifacts.LaunchToken]]) {
    assert.deepEqual(normalizedRuntime(await provider.getCode(contract.target), artifact), normalizedRuntime(artifact.evm.deployedBytecode.object, artifact));
  }
  assert.equal(await market.creator(), owner.address); assert.equal(await market.token(), token.target);
  const d = await deadline(), input = parseEther('0.01');
  const buyEstimate = await market.buy.estimateGas(1, d, { value: input });
  const buy = await transact(market.buy(1, d, { value: input }));
  const held = await token.balanceOf(alice.address);
  const approval = await transact(token.approve(market.target, held));
  const sellEstimate = await market.sell.estimateGas(held, 1, d);
  const sell = await transact(market.sell(held, 1, d));
  assert.ok(buyEstimate >= buy.gasUsed && buyEstimate < 200_000n);
  assert.ok(sellEstimate >= sell.gasUsed && sellEstimate < 200_000n);
  assert.equal(await token.allowance(alice.address, market.target), 0n);
  console.log('Local EVM gas: create=' + receipt.gasUsed + ', buy=' + buy.gasUsed + ', approve=' + approval.gasUsed + ', sell=' + sell.gasUsed);
});
test('rejecting treasury rolls back sell inventory, reserves, allowance and fees', async () => {
  const { market, token } = await fixture();
  await transact(market.buy(1, await deadline(), { value: parseEther('0.1') }));
  const held = await token.balanceOf(alice.address); await transact(token.approve(market.target, held));
  const before = await reserves(market), treasury = await balance(TREASURY);
  await rpc.request({ method: 'evm_setAccountCode', params: [TREASURY, '0x60006000fd'] });
  try {
    await assert.rejects(() => transact(market.sell(held, 1, deadline())));
    assert.deepEqual(await reserves(market), before);
    assert.equal(await token.balanceOf(alice.address), held);
    assert.equal(await token.allowance(alice.address, market.target), held);
    assert.equal(await balance(TREASURY), treasury);
  } finally { await rpc.request({ method: 'evm_setAccountCode', params: [TREASURY, '0x'] }); }
});
test('three-user seeded trades preserve exact fees, balances, supply, volume and invariant', { timeout: 120_000 }, async () => {
  const users = [owner, alice, await provider.getSigner(2)];
  for (const seed of [17n, 239n]) {
    const { market, token } = await fixture(); let state = seed, native = 0n, inventory = BASE_SUPPLY, volume = 0n;
    const next = () => state = (state * 1664525n + 1013904223n) & 0xffffffffn;
    for (let i = 0; i < 32; i++) {
      const trader = users[Number(next() % 3n)], curve = market.connect(trader), coin = token.connect(trader);
      const held = await token.balanceOf(trader.address), selling = held > 1000000n && ((next() >> 9n) & 1n) === 1n;
      const input = selling ? held / 3n : (next() % 1000n + 1n) * 1000000000000n;
      const gross = selling ? (10n ** 18n + native) * input / (inventory + input) : input;
      const fee = gross * 25n / 10000n, net = gross - fee;
      const output = selling ? net : inventory * net / (10n ** 18n + native + net);
      const treasury = await balance(TREASURY), beforeNative = await balance(trader.address), invariant = (10n ** 18n + native) * inventory;
      if (i % 8 === 0) {
        const prior = await reserves(market);
        await assert.rejects(() => curve.buy.staticCall(BASE_SUPPLY, deadline(), { value: input }));
        assert.deepEqual(await reserves(market), prior);
      }
      if (selling) await transact(coin.approve(market.target, input));
      const afterApprovalNative = await balance(trader.address);
      const receipt = await transact(selling ? curve.sell(input, output, deadline()) : curve.buy(output, deadline(), { value: input }));
      assert.equal(await balance(trader.address), (selling ? afterApprovalNative + output : beforeNative - input) - receipt.fee);
      native += selling ? -gross : net; inventory += selling ? input : -output; volume += gross;
      assert.equal(await market.nativeReserve(), native); assert.equal(await market.tokenReserve(), inventory);
      assert.equal(await market.volume(), volume); assert.equal(await balance(market.target), native);
      assert.equal(await token.balanceOf(market.target), inventory); assert.equal(await token.totalSupply(), BASE_SUPPLY);
      assert.equal(await balance(TREASURY) - treasury, fee);
      assert.ok((10n ** 18n + native) * inventory >= invariant);
      const event = receipt.logs.map(l => { try { return market.interface.parseLog(l); } catch { return null; } }).find(e => e?.name === 'Trade');
      assert.equal(event.args.trader, trader.address); assert.equal(event.args.output, output); assert.equal(event.args.fee, fee);
    }
  }
});
test('integer extremes, missing allowance and insufficient balances fail without accounting changes', async () => {
  const { market, token } = await fixture();
  await transact(market.buy(1, await deadline(), { value: parseEther('0.01') }));
  const prior = await reserves(market), held = await token.balanceOf(alice.address);
  const [hugeOutput] = await market.quoteBuy((1n << 256n) - 1n);
  assert.equal(hugeOutput, prior.tokenReserve - 1n, 'Full-precision mulDiv must handle a uint256 maximum quote without wrapping');
  await assert.rejects(() => market.quoteSell(BASE_SUPPLY));
  await assert.rejects(() => market.sell.staticCall(held, 1, deadline()));
  await transact(token.approve(market.target, held));
  await assert.rejects(() => market.connect(owner).sell.staticCall(held, 1, deadline()));
  assert.deepEqual(await reserves(market), prior);
});
