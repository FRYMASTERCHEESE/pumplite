import test from 'node:test';
import assert from 'node:assert/strict';
import {rentSupport,requireRentConsent,minimumActivationGross} from '../web/solana-rent.js';
test('full sale dust requires exact rent support; partial sale and closed account do not',()=>{
 assert.equal(rentSupport(1995000n,1994999n,650240n),650239n);
 assert.equal(rentSupport(1995000n,997533n,650240n),0n);
 assert.equal(rentSupport(1995000n,1995000n,650240n),0n);
 assert.equal(rentSupport(650240n,0n,650240n),0n);
});
test('invalid amounts/backing fail closed',()=>{for(const args of [[1n,2n,1n],[-1n,0n,1n],[1,0n,1n],[1n,0n,18446744073709551616n]])assert.throws(()=>rentSupport(...args));});
test('rent consent is explicit, capped and must leave positive minimum proceeds',()=>{
 for(const consent of [undefined,{accepted:false,maximum:650239n},{accepted:true,maximum:650238n},{accepted:true,maximum:650239}])assert.throws(()=>requireRentConsent(650239n,1900000n,consent));
 requireRentConsent(650239n,1900000n,{accepted:true,maximum:650239n});
 assert.throws(()=>requireRentConsent(650239n,650239n,{accepted:true,maximum:650239n}));
 requireRentConsent(0n,1n,undefined);
});
test('Manual Mayhem activation gross covers the market rent floor after the 0.25% fee',()=>{
 assert.equal(minimumActivationGross(890880n),893113n);
 const gross=minimumActivationGross(890880n), fee=gross/400n;
 assert.ok(gross-fee>=890880n);
 assert.ok((gross-1n)-((gross-1n)/400n)<890880n);
 assert.throws(()=>minimumActivationGross(0n));
});
