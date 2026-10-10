import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_CREATION_TRANSACTION,
  PINNED_BASE_CLAIM_TRANSACTIONS,
  discoverPinnedReceiptClaimLogs,
  discoverReceiptVerifiedClaimLogs,
  verifiedClaimCreationBlock
} from '../scripts/base-claim-receipt-discovery.mjs';

const claim = '0xeCe2B0494f3010D3bd37ba4C3eF39faCe228c5c2';
const topic = '0x987d620f307ff6b94d58743cb7a7509f24071586a77759b77c2d4e29f75a2f9a';
const account = '0x0000000000000000000000000de7fdcc798f7fac6b03b366c529133a9c60794d';
const hash = '0xdff57d674bce2a2ca77d955ecdfa5ad926253b5c73c1bf15088f0abe0876b692';
const data = '0x' + '0'.repeat(48) + '0de0b6b3a7640000' + '0'.repeat(63) + '1';

function harness(overrides = {}) {
  const chainLog = {
    address: claim,
    topics: [topic, account],
    data,
    blockNumber: 52034101,
    index: 1316,
    transactionIndex: 1,
    transactionHash: hash,
    ...overrides.chainLog
  };
  const row = {
    address: { hash: claim },
    topics: [topic, account],
    data,
    block_number: 52034101,
    index: 1316,
    transaction_hash: hash,
    ...overrides.row
  };
  const provider = {
    async getTransactionReceipt(value) {
      if (value.toLowerCase() === CLAIM_CREATION_TRANSACTION) {
        return {
          status: 1,
          contractAddress: claim,
          blockNumber: 52033932,
          ...(overrides.creationReceipt || {})
        };
      }
      return {
        hash,
        status: 1,
        blockNumber: 52034101,
        logs: [chainLog],
        ...(overrides.claimReceipt || {})
      };
    }
  };
  const fetcher = async (url, init) => {
    assert.match(url, /^https:\/\/base\.blockscout\.com\/api\/v2\/addresses\//);
    assert.equal(init.method, 'GET');
    return new Response(JSON.stringify(overrides.page || {
      items: [row],
      next_page_params: null
    }), { status: 200 });
  };
  return { provider, fetcher };
}

async function discover(overrides = {}, count = 1) {
  const { provider, fetcher } = harness(overrides);
  const creationBlock = await verifiedClaimCreationBlock(provider, claim);
  return discoverReceiptVerifiedClaimLogs({
    provider, fetcher, contractAddress: claim,
    claimedTopic: topic,
    creationBlock,
    snapshotBlock: 52034102,
    expectedCount: count
  });
}

test('claim deployment is pinned to a real receipt, not a guessed deployment block', async () => {
  assert.equal(await verifiedClaimCreationBlock(harness().provider, claim), 52033932);
  await assert.rejects(
    verifiedClaimCreationBlock(harness({
      creationReceipt: { contractAddress: '0x1111111111111111111111111111111111111111' }
    }).provider, claim),
    /different contract/
  );
});

test('indexed discovery uses authentic receipt logs rather than trusting indexed events', async () => {
  const logs = await discover();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].transactionHash, hash);
  assert.equal(logs[0].blockNumber, 52034101);
});

test('missing or extra historical events fail closed against on-chain claim count', async () => {
  await assert.rejects(discover({page: {items: [], next_page_params: null}}), /event count differs/);
  await assert.rejects(discover({}, 0), /events exceed on-chain claim count/);
});

test('forged, moved or duplicated explorer events cannot establish claim history', async () => {
  await assert.rejects(discover({row:{ index: 1315 }}), /absent from its on-chain receipt/);
  await assert.rejects(discover({row:{ block_number: 52034000 }}), /block differs/);
  await assert.rejects(discover({row:{ data: '0x00' }}), /data differs/);
  const {fetcher} = harness();
  const dataWithTwo = await (await fetcher('https://base.blockscout.com/api/v2/addresses/'+claim+'/logs',{method:'GET'})).json();
  await assert.rejects(discover({page:{items:[dataWithTwo.items[0],dataWithTwo.items[0]],next_page_params:null}},2),/Duplicate indexed claim event/);
});

test('indexer pagination must complete and cannot loop or silently truncate', async () => {
  await assert.rejects(discover({page:{items:[], next_page_params:{index:1}}}), /pagination loop detected/);
  await assert.rejects(discover({page:{items:[], next_page_params:{bad:'/url'}}}), /Invalid indexed pagination value/);
});

test('failed, missing and mismatched chain receipts are never accepted', async () => {
  await assert.rejects(discover({claimReceipt:{status:0}}), /unavailable or failed/);
  await assert.rejects(discover({claimReceipt:{logs:[]}}), /absent from its on-chain receipt/);
});

test('known claim receipts are independently proven against live count and chain receipt', async () => {
  assert.equal(PINNED_BASE_CLAIM_TRANSACTIONS.length, 1);
  const {provider} = harness();
  const logs = await discoverPinnedReceiptClaimLogs({
    provider,
    contractAddress: claim,
    claimedTopic: topic,
    creationBlock: 52033932,
    snapshotBlock: 52034102,
    expectedCount: 1
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].transactionHash, hash);
});

test('pinned history cannot claim a complete proof after a new claim appears', async () => {
  const {provider} = harness();
  await assert.rejects(discoverPinnedReceiptClaimLogs({
    provider, contractAddress: claim, claimedTopic: topic,
    creationBlock: 52033932, snapshotBlock: 52034102, expectedCount: 2
  }), /new claim evidence needed/);
});

test('failed or fabricated pinned receipts cannot pass the historical gate', async () => {
  for (const overrides of [
    {claimReceipt:{status:0}},
    {claimReceipt:{logs:[]}},
    {claimReceipt:{hash:'0x'+'f'.repeat(64)}},
    {claimReceipt:{blockNumber:52033931}}
  ]) {
    await assert.rejects(discoverPinnedReceiptClaimLogs({
      provider:harness(overrides).provider,
      contractAddress:claim, claimedTopic:topic,
      creationBlock:52033932, snapshotBlock:52034102, expectedCount:1
    }));
  }
});
