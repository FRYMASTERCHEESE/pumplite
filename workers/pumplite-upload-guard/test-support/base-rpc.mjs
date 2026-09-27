// Loopback-only synthetic EVM: no accounts, signing, transactions or deployment.
import ganache from 'ganache';
import solc from 'solc';
const source=`pragma solidity ^0.8.30;
contract Fixture { function isValidSignature(bytes32 digest, bytes calldata signature) external pure returns(bytes4) {
 if(signature.length!=32) return 0xffffffff;
 bytes32 supplied; assembly { supplied := calldataload(signature.offset) }
 return supplied==digest ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
} }`;
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Fixture.sol':{content:source}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['evm.deployedBytecode.object']}}}})));
if(output.errors?.some(e=>e.severity==='error'))throw Error('Fixture compilation failed');
const server=ganache.server({chain:{chainId:8453,hardfork:'shanghai'},wallet:{totalAccounts:0},logging:{quiet:true}});
await server.provider.request({method:'evm_setAccountCode',params:['0x1111111111111111111111111111111111111111','0x'+output.contracts['Fixture.sol'].Fixture.evm.deployedBytecode.object]});
await server.listen(18545,'127.0.0.1');
console.log('Synthetic Base RPC listening on loopback; no wallets or deployments');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
