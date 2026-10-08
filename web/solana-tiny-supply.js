import { TINY_SUPPLY } from './solana-tiny-instructions.js';
const units=n=>{const whole=n/1000000n, fraction=(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return whole.toLocaleString('en-US')+(fraction?'.'+fraction:'');};
export function tinySupplyLines(m){
 if(m?.protocol!=='tiny'||typeof m.actualSupply!=='bigint')return [];
 const lines=['Maximum supply: '+units(TINY_SUPPLY)+' '+m.symbol,'Current total supply: '+units(m.actualSupply)+' '+m.symbol];
 if(m.mode==='sealed')lines.push('PumpLite vault inventory: '+units(m.tokenReserve)+' '+m.symbol,'Outside PumpLite vault: '+units(m.actualSupply-m.tokenReserve)+' '+m.symbol+' (not independently verified circulating supply)');
 else lines.push('Legacy supply is minted on buys and burned on sells; no sealed vault yet.');
 return lines;
}
