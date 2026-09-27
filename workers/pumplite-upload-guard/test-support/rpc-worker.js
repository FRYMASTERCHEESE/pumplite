// TEST ONLY: run the actual private RPC Worker against the loopback synthetic EVM.
// No production code/config uses this interception or localhost endpoint.
import privateRpc from '../../pumplite-base-signature-rpc/worker.js';
const networkFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, options) => {
  if (String(url) !== 'https://base-fixture.invalid/') throw Error('External network blocked in local test');
  return networkFetch('http://127.0.0.1:18545', options);
};
export default {
  fetch(request) { return privateRpc.fetch(request, { BASE_RPC_URL: 'https://base-fixture.invalid/' }); }
};
