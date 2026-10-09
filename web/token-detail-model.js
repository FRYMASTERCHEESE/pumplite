import {formatUnits} from './math.js';
export const UNAVAILABLE='Not available yet';
// Spot curve valuation is not a DEX quote or a promise of exit liquidity.
export function curveMarketCap(m){
 return typeof m.actualSupply==='bigint' && typeof m.circulating==='bigint' && m.actualSupply>=0n && m.circulating>=0n && m.circulating<=m.actualSupply && m.tokenReserve>0n && m.nativeReserve>=0n && m.virtualNative>=0n ? (m.nativeReserve+m.virtualNative)*m.circulating/m.tokenReserve : null;
}
export function tokenDetailRows(m) {
 const valid=typeof m.actualSupply==='bigint' && typeof m.circulating==='bigint' && m.actualSupply>=0n && m.circulating>=0n && m.circulating<=m.actualSupply;
 const quantity=v=>typeof v==='bigint'?formatUnits(v,m.decimals,6)+' '+m.symbol:UNAVAILABLE;
 const backing=typeof m.nativeReserve==='bigint'&&m.nativeReserve>=0n?formatUnits(m.nativeReserve,9,9)+' SOL':UNAVAILABLE;
 const cap=curveMarketCap(m);
 const progress=typeof m.maximumSupply==='bigint'&&m.maximumSupply>0n&&m.tokenReserve>=0n&&m.tokenReserve<=m.maximumSupply?Number((m.maximumSupply-m.tokenReserve)*10000n/m.maximumSupply)/100:null;
 return [
 ['Name',m.name],['Symbol',m.symbol],['Network','Solana Mainnet'],['Mint Address',m.token],
 ['Estimated Curve Market Cap',cap===null?UNAVAILABLE:formatUnits(cap,9,9)+' SOL'],
 ['Total Minted Supply',valid?quantity(m.actualSupply):UNAVAILABLE],
 ['Wallet-held Supply (outside market vault)',valid?quantity(m.circulating):UNAVAILABLE],
 ['Verified Circulating Supply',UNAVAILABLE],['Maximum Curve Supply',quantity(m.maximumSupply)],
 ['Holders',m.holderCountVerified===true&&Number.isSafeInteger(m.holderCount)&&m.holderCount>=0?String(m.holderCount):UNAVAILABLE],
 ['Bonding Curve Progress',progress===null?UNAVAILABLE:progress.toFixed(2)+'% of curve inventory distributed; not DEX graduation'],
 ['Created',Number.isSafeInteger(m.createdAt)&&m.createdAt>0?new Date(m.createdAt).toISOString():UNAVAILABLE],
 ['Real Curve Backing',backing],['Virtual Reserves (not withdrawable)',quantitySol(m.virtualNative)],
 ['Creator Minting',['legacy','sealed'].includes(m.mode)?'Renounced':UNAVAILABLE],
 ['Curve Minting',m.mode==='legacy'?'Active — market PDA':m.mode==='sealed'?'Disabled — mint authority None':UNAVAILABLE],
 ['Mint Authority',m.mode==='legacy'?m.marketAddress:m.mode==='sealed'?'None':UNAVAILABLE],
 ['Metadata Update Authority',m.metadataUpdateAuthority||UNAVAILABLE],
 ['Metadata',m.metadataMutable===false?'Immutable':m.metadataMutable===true?'Mutable':UNAVAILABLE],
 ['Ownership Renounced',m.metadataMutable===false&&['legacy','sealed'].includes(m.mode)?'Mint/metadata creator controls removed; program upgrade authority is separate':m.metadataMutable===true?'No — metadata update authority remains':UNAVAILABLE],
 ['Manual Mayhem','See Mayhem Agent status below; agent volume is separate'],
 ['Organic Volume',UNAVAILABLE]
 ];
}
function quantitySol(v){return typeof v==='bigint'&&v>=0n?formatUnits(v,9,9)+' SOL':UNAVAILABLE;}
