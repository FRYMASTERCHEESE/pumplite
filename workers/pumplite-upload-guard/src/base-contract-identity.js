import { Interface } from 'ethers';

const ABI = new Interface(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);
const MAGIC_RESULT = '0x1626ba7e' + '0'.repeat(56);
const RPC_URL = 'https://mainnet.base.org';
const MAX_RESPONSE_BYTES = 65536;
export const MAX_BASE_SIGNATURE_BYTES = 512;

export function validBaseSignature(signature) {
  return typeof signature === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(signature) &&
    signature.length <= 2 + MAX_BASE_SIGNATURE_BYTES * 2 &&
    // ERC-6492 deployment/wrapped signatures are deliberately unsupported.
    !signature.toLowerCase().endsWith('6492'.repeat(16));
}

async function readResult(response, id, signal) {
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) throw Error('RPC unavailable');
  const reader = response.body.getReader();
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = []; let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw Error('RPC timeout');
      const { done, value } = await reader.read();
      if (signal.aborted) throw Error('RPC timeout');
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw Error('RPC response too large');
      chunks.push(value);
    }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (body?.jsonrpc !== '2.0' || body.id !== id || Object.hasOwn(body, 'error') || !Object.hasOwn(body, 'result')) throw Error('Invalid RPC response');
  return body.result;
}

// Only a trusted server-side service binding can replace the fixed Base endpoint.
// Never accept an endpoint, block, chain ID or RPC method from the proof body.
export async function verifyBaseContractSignature(subject, digest, signature, rpcBinding) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let id = 0;
  const transport = rpcBinding ? rpcBinding.fetch.bind(rpcBinding) : globalThis.fetch;
  async function rpc(method, params) {
    const requestId = ++id;
    if (controller.signal.aborted) throw Error('RPC timeout');
    let abort;
    try {
      return await Promise.race([
        (async () => {
          const response = await transport(RPC_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
            signal: controller.signal, redirect: 'manual', credentials: 'omit'
          });
          return readResult(response, requestId, controller.signal);
        })(),
        new Promise((_, reject) => {
          abort = () => reject(Error('RPC timeout'));
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) abort();
        })
      ]);
    } finally { controller.signal.removeEventListener('abort', abort); }
  }
  try {
    if (!validBaseSignature(signature)) return false;
    if (await rpc('eth_chainId', []) !== '0x2105') return false;
    const block = await rpc('eth_blockNumber', []);
    if (typeof block !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/.test(block)) return false;
    const code = await rpc('eth_getCode', [subject, block]);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) return false;
    const result = await rpc('eth_call', [{
      to: subject,
      data: ABI.encodeFunctionData('isValidSignature', [digest, signature]),
      // Off-chain resource cap; complex wallets above this budget fail closed.
      gas: '0x7a120'
    }, block]);
    return typeof result === 'string' && result.toLowerCase() === MAGIC_RESULT;
  } catch {
    return false;
  } finally { clearTimeout(timer); controller.abort(); }
}
