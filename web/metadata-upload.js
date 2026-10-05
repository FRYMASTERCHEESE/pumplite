// Prepared client only: no automatic upload, credential storage or wallet access.
// Authorization is a short-lived upload grant, NEVER a Pinata/Helius credential.
const BASE = 'https://pumplite-rpc.coreyedge123.workers.dev';
export async function uploadMetadataPart(config, kind, body, authorization) {
  if(config?.enabled!==true) throw Error('Metadata uploads are not enabled');
  if(!['image','json'].includes(kind)) throw Error('Invalid metadata upload');
  if(!/^Bearer [A-Za-z0-9._~-]{16,2048}$/.test(authorization||'')) throw Error('Upload authorization required');
  const bytes=kind==='image'?body:JSON.stringify(body);
  if(kind==='image' && (!(body instanceof Blob) || body.type!=='image/png' || body.size>512*1024)) throw Error('Use a PNG no larger than 512 KiB');
  if(kind==='json' && new TextEncoder().encode(bytes).length>4096) throw Error('Metadata too large');
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      20000
    );

  let response;

  try {
    response =
      await fetch(
        BASE + '/metadata/' + kind,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              kind === 'image'
                ? 'image/png'
                : 'application/json',
            Authorization:
              authorization
          },
          body: bytes,
          credentials: 'omit',
          redirect: 'error',
          signal:
            controller.signal
        }
      );
  } finally {
    clearTimeout(timer);
  }

  const text =
    await response.text();

  if (
    new TextEncoder()
      .encode(text)
      .length > 2048
  ) {
    throw Error(
      'Metadata upload service returned an oversized response'
    );
  }

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    throw Error(
      'Metadata upload service returned an invalid response'
    );
  }

  if (!response.ok) {
    const message =
      typeof result?.error === 'string'
        ? result.error
        : 'Metadata upload failed';

    throw Error(
      message +
      ' (HTTP ' +
      response.status +
      ')'
    );
  }

  if(typeof result.cid!=='string' || !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})$/.test(result.cid) || result.uri!=='ipfs://'+result.cid) throw Error('Invalid metadata response');
  return {cid:result.cid,uri:result.uri};
}
