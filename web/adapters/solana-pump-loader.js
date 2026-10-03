import { Buffer as BrowserBuffer } from 'buffer';

if (
  !BrowserBuffer ||
  typeof BrowserBuffer.from !== 'function'
) {
  throw Error(
    'Browser Buffer implementation is unavailable'
  );
}

globalThis.Buffer =
  BrowserBuffer;

if (
  !globalThis.Buffer ||
  typeof globalThis.Buffer.from !== 'function'
) {
  throw Error(
    'Browser Buffer global could not initialize'
  );
}

const pump =
  await import(
    './solana-pump.js'
  );

if (
  typeof pump.adapter !== 'function'
) {
  throw Error(
    'Pump adapter export is unavailable'
  );
}

export const adapter =
  pump.adapter;
