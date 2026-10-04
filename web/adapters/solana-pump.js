/*
 * Legacy Pump/PumpSwap compatibility has been retired.
 *
 * PumpLite Solana production uses only the reviewed tiny
 * program and adapter.
 */

export function adapter() {
  throw Error(
    'Legacy Pump compatibility is retired; PumpLite uses the reviewed tiny Solana adapter.'
  );
}
