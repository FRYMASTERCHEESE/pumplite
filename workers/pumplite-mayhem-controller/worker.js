import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { prepareMayhemTrade } from '../../proposals/mayhem-offchain/controller.mjs';
import {
  createMainnetPreparation,
  createReadOnlyRpc,
  verifyMayhemReceipt,
  RPC_URL,
  TREASURY,
  MAX_NETWORK_FEE
} from '../../proposals/mayhem-offchain/mainnet-readonly.mjs';
import { evaluateMayhemState, MAYHEM } from '../pumplite-upload-guard/src/mayhem.js';
import { tinyTradeInstructions, tinyMarketAddress } from '../../web/solana-tiny-instructions.js';
import { signatureText } from '../../web/solana-signature.js';
import {
  snapshotTransaction,
  validateWalletTransaction
} from '../../web/solana-transaction-validation.js';

const json = (data,status=200) =>
  new Response(JSON.stringify(data),{
    status,
    headers:{
      'Content-Type':'application/json',
      'Cache-Control':'no-store'
    }
  });

async function body(request){
  if(request.headers.get('content-type')?.split(';')[0] !== 'application/json'){
    throw Error('JSON required');
  }

  const reader = request.body?.getReader();
  if(!reader) throw Error('Missing body');

  let count = 0;
  const chunks = [];

  while(true){
    const r = await reader.read();
    if(r.done) break;

    count += r.value.length;

    if(count > 20000){
      await reader.cancel();
      throw Error('Request too large');
    }

    chunks.push(r.value);
  }

  const bytes = new Uint8Array(count);

  let offset = 0;

  for(const chunk of chunks){
    bytes.set(chunk,offset);
    offset += chunk.length;
  }

  return JSON.parse(
    new TextDecoder().decode(bytes)
  );
}

function canBroadcast(env){
  return (
    env.MAYHEM_BROADCAST_ENABLED === 'true' &&
    typeof env.MAYHEM_CONTROLLER === 'string' &&
    typeof env.MAYHEM_SIGNER === 'string'
  );
}

function signer(env){
  if(!canBroadcast(env)){
    throw Error('Controller signer unavailable');
  }

  const value = JSON.parse(env.MAYHEM_SIGNER);

  if(
    !Array.isArray(value) ||
    value.length !== 64 ||
    value.some(
      n =>
        !Number.isInteger(n) ||
        n < 0 ||
        n > 255
    )
  ){
    throw Error('Invalid controller signer');
  }

  const keypair =
    Keypair.fromSecretKey(
      Uint8Array.from(value)
    );

  if(
    keypair.publicKey.toBase58() !==
    env.MAYHEM_CONTROLLER
  ){
    throw Error(
      'Controller signer identity mismatch'
    );
  }

  return keypair;
}

function validateContext(state,action,env){
  if(
    state?.mode !== 'manual' ||
    state.programId !== MAYHEM.programId ||
    state.chain !== MAYHEM.chain ||
    state.controller !== env.MAYHEM_CONTROLLER ||
    !action?.id ||
    action.launchId !== state.launchId ||
    state.pending !== action.id ||
    action.isMayhemAgent !== true
  ){
    throw Error('Invalid controller context');
  }
}

function instructionsFor(state,action,owner){
  if(
    !['buy','sell'].includes(action.side) ||
    !/^[1-9][0-9]{0,19}$/.test(action.amount) ||
    !/^[1-9][0-9]{0,19}$/.test(action.minimum)
  ){
    throw Error('Invalid prepared action');
  }

  const programId =
    new PublicKey(MAYHEM.programId);

  const mint =
    new PublicKey(state.mint);

  return tinyTradeInstructions({
    mode:'legacy',
    programId,
    mint,
    market:
      tinyMarketAddress(
        mint,
        programId
      ),
    owner,
    treasury:
      new PublicKey(TREASURY),
    side:action.side,
    amount:BigInt(action.amount),
    min:BigInt(action.minimum)
  });
}

async function signPrepared(rpc,state,action,env){
  const keypair = signer(env);

  if(
    !['decided','paused'].includes(action.status) ||
    action.preparation !== 'verified-read-only' ||
    !Number.isSafeInteger(action.preparedAt) ||
    Date.now() - action.preparedAt > 30000
  ){
    throw Error('Prepared action expired');
  }

  const genesis =
    await rpc(
      'getGenesisHash'
    );

  if(genesis !== MAYHEM.genesisHash){
    throw Error('Wrong Solana network');
  }

  const block =
    await rpc(
      'getLatestBlockhash',
      [{
        commitment:'confirmed'
      }]
    );

  if(
    !block?.value?.blockhash ||
    !Number.isSafeInteger(
      block.value.lastValidBlockHeight
    )
  ){
    throw Error('Invalid blockhash');
  }

  const tx =
    new Transaction({
      feePayer:keypair.publicKey,
      recentBlockhash:
        block.value.blockhash
    }).add(
      ...instructionsFor(
        state,
        action,
        keypair.publicKey
      )
    );

  const fee =
    await rpc(
      'getFeeForMessage',
      [
        tx.serializeMessage()
          .toString('base64'),
        {
          commitment:'confirmed'
        }
      ]
    );

  if(
    !Number.isSafeInteger(fee?.value) ||
    fee.value < 0 ||
    fee.value > MAX_NETWORK_FEE
  ){
    throw Error(
      'Network fee unavailable or exceeds cap'
    );
  }

  tx.sign(keypair);

  if(!tx.verifySignatures()){
    throw Error('Controller signature failed');
  }

  const signature =
    signatureText(tx.signature);

  if(
    !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/
      .test(signature)
  ){
    throw Error('Invalid transaction signature');
  }

  const wire =
    tx.serialize()
      .toString('base64');

  return {
    requestId:action.id,
    signature,
    transaction:wire,
    lastValidBlockHeight:
      block.value.lastValidBlockHeight,
    broadcastEnabled:true
  };
}

async function broadcastSigned(
  sender,
  state,
  action,
  payload,
  env
){
  const keypair = signer(env);

  if(
    action.status !== 'submitted' ||
    action.signature !== payload.signature ||
    typeof payload.transaction !== 'string' ||
    payload.transaction.length < 100 ||
    payload.transaction.length > 2000
  ){
    throw Error('Invalid submitted transaction');
  }

  const tx =
    Transaction.from(
      Buffer.from(
        payload.transaction,
        'base64'
      )
    );

  if(
    !tx.verifySignatures() ||
    !tx.feePayer?.equals(
      keypair.publicKey
    ) ||
    signatureText(tx.signature) !==
      action.signature
  ){
    throw Error('Signed transaction mismatch');
  }

  const expected =
    new Transaction({
      feePayer:keypair.publicKey,
      recentBlockhash:
        tx.recentBlockhash
    }).add(
      ...instructionsFor(
        state,
        action,
        keypair.publicKey
      )
    );

  const wireExpected =
    Transaction.from(
      expected.serialize({
        requireAllSignatures:false,
        verifySignatures:false
      })
    );

  validateWalletTransaction(
    snapshotTransaction(
      wireExpected
    ),
    tx
  );

  const response =
    await sender(
      RPC_URL,
      {
        method:'POST',
        headers:{
          'Content-Type':
            'application/json',
          Origin:
            'https://frymastercheese.github.io'
        },
        body:JSON.stringify({
          jsonrpc:'2.0',
          id:1,
          method:'sendTransaction',
          params:[
            payload.transaction,
            {
              encoding:'base64',
              skipPreflight:false,
              preflightCommitment:
                'confirmed',
              maxRetries:3
            }
          ]
        }),
        signal:
          AbortSignal.timeout(20000)
      }
    );

  if(!response.ok){
    throw Error(
      'PumpLite transaction relay unavailable'
    );
  }

  const text =
    await response.text();

  if(text.length > 16384){
    throw Error('RPC response too large');
  }

  const result =
    JSON.parse(text);

  if(
    result?.error ||
    result?.result !==
      action.signature
  ){
    throw Error(
      'PumpLite transaction relay rejected'
    );
  }

  return {
    requestId:action.id,
    signature:action.signature,
    submitted:true,
    broadcastEnabled:true
  };
}

export function controllerHandler({
  preparation=createMainnetPreparation,
  receipt=verifyMayhemReceipt,
  rpc=createReadOnlyRpc,
  sender=fetch
}={}){
  return {
    async fetch(request,env){
      const path =
        new URL(request.url).pathname;

      if(
        request.method === 'GET' &&
        path === '/capabilities'
      ){
        return json({
          version:1,
          mode:'manual',
          preparation:true,
          receiptVerification:true,
          controllerConfigured:
            Boolean(env.MAYHEM_CONTROLLER),
          signerConfigured:
            Boolean(env.MAYHEM_SIGNER),
          broadcastEnabled:
            canBroadcast(env)
        });
      }

      if(
        request.method !== 'POST' ||
        ![
          '/prepare',
          '/sign',
          '/broadcast',
          '/verify-receipt'
        ].includes(path)
      ){
        return json(
          {error:'Not found'},
          404
        );
      }

      if(!env.MAYHEM_CONTROLLER){
        return json(
          {
            error:
              'Controller identity not provisioned'
          },
          503
        );
      }

      try{
        const payload =
          await body(request);

        const state =
          structuredClone(
            payload.state
          );

        const action =
          structuredClone(
            payload.action
          );

        validateContext(
          state,
          action,
          env
        );

        if(path === '/verify-receipt'){
          return json({
            evidence:
              await receipt(
                rpc(),
                state,
                action,
                action.signature
              ),
            broadcastEnabled:
              canBroadcast(env)
          });
        }

        if(path === '/sign'){
          if(!canBroadcast(env)){
            return json(
              {
                error:
                  'Controller broadcast disabled',
                broadcastEnabled:false
              },
              503
            );
          }

          return json(
            await signPrepared(
              rpc(),
              state,
              action,
              env
            )
          );
        }

        if(path === '/broadcast'){
          if(!canBroadcast(env)){
            return json(
              {
                error:
                  'Controller broadcast disabled',
                broadcastEnabled:false
              },
              503
            );
          }

          return json(
            await broadcastSigned(
              sender,
              state,
              action,
              payload,
              env
            )
          );
        }

        const localAction =
          structuredClone(action);

        const store = {
          atomic:fn => fn(),

          action:id => {
            if(id !== localAction.id){
              throw Error(
                'Request mismatch'
              );
            }

            return structuredClone(
              localAction
            );
          },

          state:() =>
            structuredClone(state),

          refresh:(_id,now) =>
            evaluateMayhemState(
              state,
              now
            ),

          decide:() =>
            structuredClone(
              localAction
            ),

          saveAction:fresh =>
            Object.assign(
              localAction,
              fresh
            ),

          pause:(_id,reason) => {
            localAction.status =
              'paused';

            localAction.reason =
              reason;
          }
        };

        const result =
          await prepareMayhemTrade(
            store,
            localAction.id,
            preparation()
          );

        if(!result.ready){
          return json({
            ready:false,
            reason:result.reason,
            requestId:
              localAction.id,
            broadcastEnabled:false
          });
        }

        return json({
          ready:true,
          requestId:
            localAction.id,
          minimum:
            localAction.minimum,
          feeBps:25,
          simulation:
            result.simulation,
          instructions:
            result.instructions.map(
              ix => ({
                programId:
                  ix.programId.toBase58(),
                data:
                  Array.from(ix.data),
                keys:
                  ix.keys.map(
                    k => ({
                      pubkey:
                        k.pubkey.toBase58(),
                      isSigner:
                        k.isSigner,
                      isWritable:
                        k.isWritable
                    })
                  )
              })
            ),
          broadcastEnabled:false
        });
      }
      catch{
        return json({
          error:
            'Controller operation rejected',
          broadcastEnabled:false
        },409);
      }
    }
  };
}

export default controllerHandler();