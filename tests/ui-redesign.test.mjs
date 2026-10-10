import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chartPoints,candleSeries} from '../web/chart-series.js';
const make = (timestamp,price,index=0) => ({timestamp,price,index});
test('candles use exact observed OHLC and do not fill gaps',()=>{
 const candles=candleSeries([make(121,4),make(123,9,1),make(129,2,2),make(130,6,3),make(301,7,4)]);
 assert.deepEqual(candles,[{time:120,open:4,high:9,low:2,close:6,count:4},{time:300,open:7,high:7,low:7,close:7,count:1}]);
});
test('candles unavailable without real timestamps',()=>{
 assert.deepEqual(candleSeries([make(0,4)]),[]);
 assert.deepEqual(candleSeries([make(12.2,4)]),[]);
 assert.deepEqual(candleSeries([]),[]);
});
test('invalid prices never become real chart data',()=>{
 assert.equal(chartPoints([{price:'bad'},{price:-1},{price:0},{price:NaN}],Number).length,0);
 assert.equal(chartPoints([{price:'bad'}],()=>{throw Error('invalid')} ).length,0);
});
test('chart points preserve execution order within a block',()=>{
 const data=chartPoints([{timestamp:20,blockNumber:2,price:5},{timestamp:10,blockNumber:1,price:7},{timestamp:20,blockNumber:2,price:3}],Number);
 assert.deepEqual(data.map(p=>p.price),[7,5,3]);
});
test('each supported time range uses genuine observations only',()=>{
 for(const range of ['LIVE','1D','1W','1M','1Y','ALL']) {
  const candles=candleSeries([make(1700000000,2),make(1700000100,1,1)],range);
  assert.equal(candles.reduce((n,c)=>n+c.count,0),2);
  assert.equal(candles[0].open,2);
  assert.equal(candles.at(-1).close,1);
 }
});
test('redesign preserves wallet entry point and accessible navigation',async()=>{
 const html=await readFile('index.html','utf8');
 for(const id of ['connect','chain','create-form','trade-form','status','portfolio-section']) assert.ok(html.includes('id="'+id+'"'));
 for(const page of ['home','markets','create','portfolio','help']) assert.ok(html.includes('data-page="'+page+'"'));
 assert.match(html,/Includes agent activity/);
 assert.match(html,/data-chart-style="candles"/);
});
test('portfolio reads are bounded and discard wallet/network changes',async()=>{
 const app=await readFile('web/app.js','utf8');
 const source=app.slice(app.indexOf('async function readPortfolio()'),app.indexOf("$('portfolio-refresh').addEventListener"));
 assert.match(source,/slice\(0, 12\)/);
 assert.match(source,/wallet !== state.wallet/);
 assert.match(source,/chain !== state.chain/);
 assert.match(source,/adapter.balances\(market\)/);
 assert.doesNotMatch(source,/signTransaction|sendTransaction|\.buy\(|\.sell\(/);
});
