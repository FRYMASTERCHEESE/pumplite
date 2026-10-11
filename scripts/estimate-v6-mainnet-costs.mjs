// Read-only public RPC estimation. No signer, key generation, wallet, or submission.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ContractFactory, Contract, JsonRpcProvider, FetchRequest, Transaction, formatEther } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { feeMessages } from './v6-solana-fee-messages.mjs';
const config = JSON.parse(await readFile('config.json', 'utf8'));
const artifact = JSON.parse(await readFile('web/generated/base-v6-deploy.json', 'utf8'));
const controller = process.env.V6_PUBLIC_CONTROLLER || config.base.treasury;
const limits = { minBuy: 10n**15n, maxBuy: 10n**16n, maxTotalBuy: 10n**17n, maxTotalSell: 10n**17n,
  pauseBelowNativeReserve: 10n**15n, minInterval: 300, maxTrades: 48, minSellBps: 100, maxSellBps: 500 };
const request = new FetchRequest(config.base.rpcUrl); request.timeout = 20000;
const provider = new JsonRpcProvider(request, undefined, {batchMaxCount:1});
const report = { observedAt: new Date().toISOString(), deployed: false, approved: false,
  caveat: 'Current read-only estimates, not a final charge or approval. Costs must be refreshed after the exact release and public identities are approved.' };
try {
  if (await provider.send('eth_chainId',[]) !== '0x2105') throw Error('Wrong Base chain');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const {data} = await factory.getDeployTransaction(controller, config.base.treasury, config.base.treasury, limits);
  const block = await provider.getBlockNumber();
  const gas = await provider.estimateGas({from:config.base.treasury,data,value:0n});
  const price = BigInt(await provider.send('eth_gasPrice',[]));
  const nonce = await provider.getTransactionCount(config.base.treasury);
  const tx = Transaction.from({type:2,chainId:8453,nonce,gasLimit:gas,maxFeePerGas:price,
    maxPriorityFeePerGas:0n,data,value:0n});
  // Size of a possible signed envelope, without creating any signature or signing material.
  const signedSizeUpperBound = (tx.unsignedSerialized.length-2)/2 + 68;
  const oracle = new Contract('0x420000000000000000000000000000000000000F',
    ['function getL1FeeUpperBound(uint256) view returns (uint256)'],provider);
  const l1Upper = await oracle.getL1FeeUpperBound(signedSizeUpperBound,{blockTag:block});
  report.base = {block,controller,controllerIsOnlyAnEstimatePlaceholder:!process.env.V6_PUBLIC_CONTROLLER,
    constructorTreasury:config.base.treasury,feeTreasury:config.base.treasury,
    bytecodeSha256:createHash('sha256').update(Buffer.from(artifact.bytecode.slice(2),'hex')).digest('hex'),
    deploymentGas:gas.toString(),gasPriceWei:price.toString(),executionETH:formatEther(gas*price),
    l1DataFeeUpperBoundETH:formatEther(l1Upper),currentExecutionPlusL1UpperBoundETH:formatEther(gas*price+l1Upper),
    excludes:'Later coin launches, keeper transactions, liquidity contributions and changes in fees or approved constructor addresses.'};
} finally { provider.destroy(); }
const binary = await readFile('target/deploy-v6/pumplite_v6.so');
if (!binary.subarray(0,4).equals(Buffer.from([127,69,76,70]))) throw Error('Expected real SBF ELF');
const rpcUrl = config.solana.rpcFallbackUrls[0];
async function rpc(method,params=[]) {
  const response = await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw Error('Solana RPC HTTP '+response.status);
  const reply = await response.json(); if(reply.error) throw Error(JSON.stringify(reply.error)); return reply.result;
}
if(await rpc('getGenesisHash') !== config.solana.genesisHash) throw Error('Wrong Solana chain');
const [slot,programRent,dataRent,bufferRent,doubleDataRent] = await Promise.all([
  rpc('getSlot',[{commitment:'finalized'}]),rpc('getMinimumBalanceForRentExemption',[36]),
  rpc('getMinimumBalanceForRentExemption',[binary.length+45]),
  rpc('getMinimumBalanceForRentExemption',[binary.length+37]),
  rpc('getMinimumBalanceForRentExemption',[binary.length*2+45])]);
const latest = await rpc('getLatestBlockhash',[{commitment:'finalized'}]);
const messages = feeMessages(binary,new PublicKey(config.solana.treasury),latest.value.blockhash);
const fee = async message => {
  const result = await rpc('getFeeForMessage',[message,{commitment:'finalized'}]);
  if (!Number.isSafeInteger(result.value) || result.value < 0) throw Error('Unavailable exact unsigned-message fee');
  return result.value;
};
const [bufferFee,deployFee,writeFee,lastWriteFee] = await Promise.all([
  fee(messages.createBuffer),fee(messages.deploy),fee(messages.writes[0]),fee(messages.writes.at(-1))]);
const uploadFees = bufferFee+deployFee+writeFee*(messages.writes.length-1)+lastWriteFee;
report.solana = {slot,rpc:rpcUrl,binaryBytes:binary.length,
  binarySha256:createHash('sha256').update(binary).digest('hex'),
  minimumAllocationBytes:binary.length,programAccountRentLamports:programRent,
  programDataRentLamports:dataRent,temporaryBufferRentLamports:bufferRent,
  minimumRetainedRentSOL:(programRent+dataRent)/1e9,
  normalLoaderReusesBufferRent:true,
  minimumExpectedFundingWithScenarioFeesSOL:(programRent+dataRent+uploadFees)/1e9,
  conservativeTemporaryRentFundingSOL:(programRent+dataRent+bufferRent)/1e9,
  twiceSizeAllocationRetainedRentSOL:(programRent+doubleDataRent)/1e9,
  feeScenario:{publicAuthorityPlaceholder:config.solana.treasury,writeBytesPerTransaction:900,
    writeTransactions:messages.writes.length,bufferCreationFeeLamports:bufferFee,deployFeeLamports:deployFee,
    ordinaryWriteFeeLamports:writeFee,lastWriteFeeLamports:lastWriteFee,priorityFeeLamports:0,
    estimatedNetworkFeesSOL:uploadFees/1e9,
    retainedRentPlusScenarioFeesSOL:(programRent+dataRent+uploadFees)/1e9,
    conservativeTemporaryFundingPlusScenarioFeesSOL:(programRent+dataRent+bufferRent+uploadFees)/1e9},
  networkTransactionFees:'Current getFeeForMessage values for unsigned estimation-only messages; 900-byte writes, no priority fee or retries. Final deployer/messages and priority fee remain unapproved. CLI chunk batching/allocation can change this estimate.',
  warning:'No deployment key exists. The current program ID is an unassigned build ID. Rebuild and re-estimate after selecting a new user-controlled public program ID. Loader-v3 drains buffer rent to the payer before paying for ProgramData, so the normal deployment reuses these funds. The conservative sum assumes unnecessary separate prefunding of both accounts; it is not the normal minimum. Failed buffer recovery and settlement still require verification.'};
await writeFile(process.argv[2] || 'build/v6-mainnet-costs.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
