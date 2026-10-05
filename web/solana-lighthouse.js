import { Buffer } from 'buffer';
export const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
// Layout source pinned to Jac0xb/lighthouse 4c579479c98635e419b1b167f08be02a71604a71:
// instruction.rs, types/assert/{account_info,token_account,operator}.rs,
// lighthouse-common/src/types/leb128_vector.rs. Only read-only multi assertions.
export function validateLighthouseData(input) {
  const data=Buffer.from(input); let offset=0;
  const fail=()=>{throw Error('Malformed or unsupported Lighthouse assertion');};
  const take=n=>{if(offset+n>data.length)fail();const v=data.subarray(offset,offset+n);offset+=n;return v;};
  const byte=()=>take(1)[0];
  const bounded=max=>{const v=byte();if(v>max)fail();return v;};
  const compact=()=>{let v=0n;for(let i=0;i<10;i++){const b=byte();if(i===9&&b>1)fail();v|=BigInt(b&127)<<BigInt(7*i);if(!(b&128)){if(i>0&&b===0)fail();return v;}}fail();};
  if(data.length>512)fail();
  const variant=byte();if(variant!==6&&variant!==10)fail();bounded(6); // LogLevel
  const count=compact();if(count<1n||count>16n)fail();
  const seen=new Set();
  for(let i=0n;i<count;i++) {
    const start=offset,field=byte();
    if(variant===6) {
      if([0,1,4].includes(field)){take(8);bounded(7);}
      else if(field===2){take(32);bounded(1);}
      else if(field===3){bounded(8);bounded(1);}
      else if([5,6,7].includes(field)){bounded(1);bounded(1);}
      else if(field===8){take(32);compact();compact();}
      else fail();
    } else {
      if(field===0||field===1){take(32);bounded(1);}
      else if(field===2||field===6){take(8);bounded(7);}
      else if(field===3||field===7){if(bounded(1)===1)take(32);bounded(1);}
      else if(field===4){byte();bounded(7);}
      else if(field===5){if(bounded(1)===1)take(8);bounded(1);}
      else if(field!==8)fail();
    }
    const encoded=data.subarray(start,offset).toString('hex');
    if(seen.has(encoded))throw Error('Duplicate Lighthouse assertion');seen.add(encoded);
  }
  if(offset!==data.length)fail();
}
