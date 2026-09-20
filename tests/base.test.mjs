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
  return { market, token };
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
