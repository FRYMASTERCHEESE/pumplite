import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderTokenDetailCard} from '../web/token-detail-card.js';
import {tokenDetailRows,UNAVAILABLE} from '../web/token-detail-model.js';

const market={
  protocol:'tiny',mode:'legacy',name:'Mayhem Monday',symbol:'MAYM',
  token:'FEofu2h5RY4yyuoZJKT4VhwWqJ78ScEy6WjoFCyQ1Xqe',
  marketAddress:'D9QU5f1dsqFDSt5YGrxUkUgcM47Aj4UxYYRD1TCn294R',
  decimals:6,actualSupply:33248894474n,circulating:33248894474n,
  maximumSupply:1000000000000000n,tokenReserve:999966751105526n,
  nativeReserve:997500n,virtualNative:30000000000n
};

function fakeDocument() {
  const nodes=[];
  return {
    nodes,
    createElement(tag) {
      const item={
        tag,children:[],dataset:{},textContent:'',
        append(...children){this.children.push(...children);},
        addEventListener(){},
        closest(){return {after(){}};}
      };
      nodes.push(item);
      return item;
    },
    getElementById(id) {
      return id==='market-name' ? this.createElement('h1') : null;
    }
  };
}

test('Solana token details expose holder field without inventing an unindexed count',()=>{
  const doc=fakeDocument();
  renderTokenDetailCard(market,doc);
  const holder=doc.nodes.find(node=>node.id==='token-detail-holders');
  assert.ok(holder,'Live holder scan needs a dedicated detail field');
  assert.equal(holder.textContent,UNAVAILABLE);
  const rows=m=>Object.fromEntries(tokenDetailRows(m));
  assert.equal(rows({...market,holderCount:1}).Holders,UNAVAILABLE);
  assert.equal(rows({...market,holderCountVerified:true,holderCount:1}).Holders,'1');
  assert.equal(rows({...market,holderCountVerified:true,holderCount:NaN}).Holders,UNAVAILABLE);
  assert.equal(rows(market).Created,UNAVAILABLE,'Unknown launch timestamp must not be invented');
  assert.ok(doc.nodes.some(node=>String(node.textContent).includes('direct Solana token-account scan')));
});

test('Solana holder summary synchronizes only valid observed count to token details',async()=>{
  const app=await readFile('web/app.js','utf8');
  const begin=app.indexOf('async function loadMarketTokenSummary(m)');
  const end=app.indexOf('\nfunction row(m)',begin);
  assert.ok(begin>=0&&end>begin);
  const method=app.slice(begin,end);
  assert.match(method,/await adapter\.holderStats\(m\)/);
  assert.match(method,/request !== marketSummaryRequest \|\| state\.market\?\.id !== m\.id/);
  assert.match(method,/Number\.isSafeInteger\(holders\)/);
  assert.match(method,/Number\.isSafeInteger\(positiveAccounts\)/);
  assert.match(method,/positiveAccounts < holders/);
  assert.match(method,/getElementById\('token-detail-holders'\)/);
  assert.match(method,/detailHolderCount\.textContent = String\(holders\)/);
  assert.doesNotMatch(method,/Number\(stats\.holders\)/,'Never turn missing RPC data into a fake zero');
});

test('Chart price number appears once next to native token pair',async()=>{
  const app=await readFile('web/app.js','utf8');
  assert.match(app,/function chartPriceText\(value, symbol, unit = state\.market\?\.unit \|\| 'ETH', showPair = true\)/);
  assert.match(app,/showPair \? text \+ ' ' \+ unit \+ '\/' \+ symbol : text/);
  assert.match(app,/\$\('price-chart-pair'\)\.textContent\s*=\s*market\.unit \+ ' \/ ' \+ market\.symbol/);
  assert.match(app,/\$\('price-chart-current'\)\.textContent\s*=\s*chartPriceText\(summary\.latestPrice, market\.symbol, market\.unit, false\)/);
  assert.match(app,/chartPriceText\(summary\.highPrice, market\.symbol\)/);
});
