// Public explorer data is used ONLY to discover possible transaction hashes.
// All claim events returned here are re-read from Base Mainnet transaction
// receipts. Incomplete, inconsistent, or unverifiable discovery fails closed.
import assert from 'node:assert/strict';
import { getAddress } from 'ethers';

export const CLAIM_CREATION_TRANSACTION =
  '0x3646c011898e01931891b9e9e7c277ab958042bb0f1dd2a801aacf6cd59e282c';

const EXPLORER = 'https://base.blockscout.com';
const MAX_PAGES = 12;
const MAX_RESPONSE_BYTES = 256_000;

export async function verifiedClaimCreationBlock(provider, contractAddress) {
  const claim = getAddress(contractAddress);
  const receipt = await provider.getTransactionReceipt(CLAIM_CREATION_TRANSACTION);
  assert.ok(receipt, 'Claim creation transaction receipt is unavailable');
  assert.equal(receipt.status, 1, 'Claim deployment transaction did not succeed');
  assert.ok(receipt.contractAddress, 'Claim deployment receipt has no contract');
  assert.equal(
    getAddress(receipt.contractAddress), claim,
    'Claim creation receipt targets a different contract'
  );
  assert.ok(
    Number.isSafeInteger(receipt.blockNumber) && receipt.blockNumber > 0,
    'Claim creation receipt has invalid block number'
  );
  return receipt.blockNumber;
}

function requireEventRow(row, expectedAddress, claimedTopic) {
  assert.ok(row && typeof row === 'object', 'Malformed explorer log row');
  assert.equal(
    getAddress(row.address?.hash), expectedAddress,
    'Explorer returned a log from another contract'
  );
  assert.equal(
    String(row.topics?.[0]).toLowerCase(), claimedTopic.toLowerCase(),
    'Explorer returned an unexpected event topic'
  );
  assert.match(row.transaction_hash, /^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash');
  assert.ok(Number.isSafeInteger(row.index) && row.index >= 0, 'Invalid event log index');
  assert.ok(Number.isSafeInteger(row.block_number) && row.block_number > 0, 'Invalid event block');
  assert.match(row.data, /^0x(?:[0-9a-fA-F]{2})*$/, 'Invalid event payload');
}

async function fetchPage(url, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    assert.equal(response.ok, true, 'Indexed claim event source unavailable (HTTP ' + response.status + ')');
    const body = await response.text();
    assert.ok(body.length <= MAX_RESPONSE_BYTES, 'Indexed claim response exceeds size limit');
    const decoded = JSON.parse(body);
    assert.ok(decoded && Array.isArray(decoded.items), 'Indexed claim response missing items');
    return decoded;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverReceiptVerifiedClaimLogs({
  provider,
  contractAddress,
  claimedTopic,
  creationBlock,
  snapshotBlock,
  expectedCount,
  fetcher = fetch
}) {
  const claim = getAddress(contractAddress);
  assert.match(claimedTopic, /^0x[0-9a-fA-F]{64}$/);
  assert.ok(Number.isSafeInteger(creationBlock) && creationBlock > 0);
  assert.ok(Number.isSafeInteger(snapshotBlock) && snapshotBlock >= creationBlock);
  assert.ok(Number.isSafeInteger(expectedCount) && expectedCount >= 0 && expectedCount <= 50);
  const logs = [];
  const seenIndexes = new Set();
  const nextSeen = new Set();
  let next = null;
  let completed = false;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const url = new URL('/api/v2/addresses/' + claim + '/logs', EXPLORER);
    if (next) {
      for (const [key, value] of Object.entries(next)) {
        assert.match(key, /^[a-z_]{1,32}$/, 'Invalid indexed pagination key');
        assert.ok(
          typeof value === 'string' || typeof value === 'number',
          'Invalid indexed pagination value'
        );
        const text = String(value);
        assert.match(text, /^[-A-Za-z0-9_:.]{1,80}$/, 'Invalid indexed pagination value');
        url.searchParams.set(key, text);
      }
    }

    const payload = await fetchPage(url.href, fetcher);
    for (const row of payload.items) {
      // A claim contract can emit other events in the future; never interpret
      // those as Claimed, but reject malformed values for the Claimed topic.
      if (String(row?.topics?.[0]).toLowerCase() !== claimedTopic.toLowerCase()) continue;
      requireEventRow(row, claim, claimedTopic);
      assert.ok(
        row.block_number >= creationBlock && row.block_number <= snapshotBlock,
        'Indexed claim event is outside the verified snapshot'
      );

      const id = row.transaction_hash.toLowerCase() + ':' + row.index;
      assert.equal(seenIndexes.has(id), false, 'Duplicate indexed claim event');
      seenIndexes.add(id);

      const receipt = await provider.getTransactionReceipt(row.transaction_hash);
      assert.ok(receipt && receipt.status === 1, 'Claim event transaction receipt is unavailable or failed');
      assert.equal(receipt.blockNumber, row.block_number, 'Indexed event block differs from on-chain receipt');
      assert.ok(receipt.blockNumber <= snapshotBlock, 'Claim receipt is outside the on-chain snapshot');
      const match = receipt.logs.find(log =>
        log.index === row.index &&
        getAddress(log.address) === claim &&
        String(log.topics?.[0]).toLowerCase() === claimedTopic.toLowerCase()
      );
      assert.ok(match, 'Indexed claim event is absent from its on-chain receipt');
      assert.equal(match.data.toLowerCase(), row.data.toLowerCase(), 'Indexed claim data differs from on-chain receipt');
      assert.equal(
        String(match.topics?.[1]).toLowerCase(),
        String(row.topics?.[1]).toLowerCase(),
        'Indexed claim account differs from on-chain receipt'
      );
      logs.push(match);
      assert.ok(logs.length <= expectedCount, 'Indexed events exceed on-chain claim count');
    }

    if (payload.next_page_params === null) {
      completed = true;
      break;
    }
    assert.ok(
      payload.next_page_params && typeof payload.next_page_params === 'object' &&
      !Array.isArray(payload.next_page_params),
      'Indexed claims did not supply valid pagination'
    );
    next = payload.next_page_params;
    const cursor = JSON.stringify(next);
    assert.equal(nextSeen.has(cursor), false, 'Indexed claim pagination loop detected');
    nextSeen.add(cursor);
  }

  assert.equal(completed, true, 'Indexed claim pagination did not finish within bound');
  assert.equal(
    logs.length, expectedCount,
    'Indexed claim event count differs from live on-chain claimCount'
  );
  return logs.sort((a, b) =>
    a.blockNumber - b.blockNumber ||
    (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0) ||
    a.index - b.index
  );
}
