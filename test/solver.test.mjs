import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDistribution, minimumForPriority, nextQuoteTicks, priorityAt, marginalCurve, recommendRate, recommendCumulative } from '../public/solver.mjs';
import { applyProjectedBlock } from '../public/protocol.mjs';

const data=groups=>groups.map(([rate,weight])=>({rate,weight}));

test('priority thresholds can select different quotes or share one tier',()=>{
  const different=buildDistribution(data([[.11,200],[.12,300],[.13,100],[.29,200],[.59,100],[.99,100]]));
  assert.equal(minimumForPriority(different,50).feeRate,.13);
  assert.equal(minimumForPriority(different,60).feeRate,.14);
  const shared=buildDistribution(data([[.11,200],[.13,400],[.29,200],[.59,100],[.99,100]]));
  assert.equal(minimumForPriority(shared,50).feeRate,.14);
  assert.equal(minimumForPriority(shared,60).feeRate,.14);
});
test('strict fee comparison and quote rounding handle tick boundaries',()=>{
  const d=buildDistribution(data([[.29,1000],[.30,1000]]));
  assert.equal(nextQuoteTicks(.29),30);assert.equal(priorityAt(d,.29),0);
  assert.equal(priorityAt(d,.30),50);assert.equal(minimumForPriority(d,100).feeRate,.31);
  assert.equal(nextQuoteTicks(.123),13);assert.equal(nextQuoteTicks(0),11);
});
test('empty or invalid observations do not become zero-price recommendations',()=>{
  assert.equal(buildDistribution([]),null);assert.equal(recommendRate(null),null);
  assert.throws(()=>buildDistribution(data([[NaN,1]])));
  assert.throws(()=>buildDistribution(data([[.1,-1]])));
});
test('minimum quotes match exhaustive search for every priority requirement',()=>{
  let seed=517;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(let sample=0;sample<50;sample++){
    const txs=Array.from({length:20},()=>({rate:Math.floor(random()*100)/100,weight:1+Math.floor(random()*10000)}));
    const d=buildDistribution(txs),grid=[];
    for(let tick=11;tick<=nextQuoteTicks(Math.max(...txs.map(t=>t.rate)));tick++){
      const weight=txs.filter(t=>t.rate<tick/100).reduce((sum,t)=>sum+t.weight,0);
      grid.push({tick,weight});
    }
    for(let target=1;target<=100;target++)assert.equal(minimumForPriority(d,target).ticks,grid.find(q=>q.weight*100>=target*d.totalWeight).tick);
  }
});
test('marginal windows include the starting fee and exclude the ending fee',()=>{
  const d=buildDistribution(data([[.13,600],[.99,200],[1.00,100],[1.99,100]]));
  const m=marginalCurve(d,1);
  assert.equal(m.peak.start.feeRate,.13);assert.equal(m.peak.end.feeRate,.14);
  assert.equal(m.peak.gain,60);assert.equal(m.peak.efficiency,6000);
  const r=recommendRate(d,{minimumPriority:80});
  assert.equal(r.recommended.feeRate,1);assert.equal(r.recommended.priority,80);
  assert.equal(r.marginal.peak.gain,20);
});
test('event sweep matches all grid windows, including quotes at the minimum floor',()=>{
  let seed=912;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(let sample=0;sample<30;sample++){
    const txs=Array.from({length:25},()=>({rate:Math.floor(random()*150)/100,weight:1+Math.floor(random()*10000)}));
    const d=buildDistribution(txs);
    for(const step of [1,5,10])for(const lower of [11-step,minimumForPriority(d,50).ticks-step]){
      const m=marginalCurve(d,step,lower);let best=0,start=null;
      for(let tick=m.startTicks;tick<m.endTicks;tick++){
        const weight=txs.filter(t=>t.rate>=tick/100&&t.rate<(tick+step)/100).reduce((a,t)=>a+t.weight,0);
        const segment=m.segments.find(s=>s.startTicks<=tick&&s.endTicks>tick);
        assert.equal(segment.gainedWeight,weight);
        if(weight>best){best=weight;start=tick;}
      }
      assert.equal(m.peak?.gainedWeight||0,best);assert.equal(m.peak?.start.ticks??null,start);
      if(m.peak)assert.ok(Math.abs(m.peak.end.priority-m.peak.start.priority-m.peak.gain)<1e-10);
    }
  }
});
test('recommendation includes the step that first reaches the target',()=>{
  const d=buildDistribution(data([[.11,200],[.13,400],[.29,200],[.59,100],[.99,100]]));
  const r=recommendRate(d);
  assert.equal(r.baseline.feeRate,.14);assert.equal(r.recommended.feeRate,.14);
  assert.equal(r.marginal.peak.start.feeRate,.13);assert.equal(r.marginal.peak.gain,40);
});
test('minimum relay-tier weight is included at the lowest permissible quote',()=>{
  const r=recommendRate(buildDistribution(data([[.10,900],[.20,100]])));
  assert.equal(r.recommended.feeRate,.11);assert.equal(r.marginal.peak.gain,90);
});
test('a far larger marginal jump is selected without an extra-fee cap',()=>{
  const d=buildDistribution(data([[.11,200],[.12,200],[.13,200],[.99,350],[1.99,50]]));
  const r=recommendRate(d);
  assert.equal(r.baseline.feeRate,.14);assert.equal(r.recommended.feeRate,1);
  assert.equal(r.marginal.peak.gain,35);
});
test('marginal gains below five percentage points are eligible',()=>{
  const groups=[...Array.from({length:20},(_,i)=>[Number((.10+i*.01).toFixed(2)),30]),...Array.from({length:10},(_,i)=>[Number((1+i*.01).toFixed(2)),40])];
  const r=recommendRate(buildDistribution(data(groups)));
  assert.equal(r.baseline.feeRate,.30);assert.equal(r.recommended.feeRate,1.01);
  assert.equal(r.marginal.peak.gain,4);
});
test('uniform marginal gains choose the lowest eligible ending quote',()=>{
  const d=buildDistribution(data(Array.from({length:10},(_,i)=>[Number((.10+i*.01).toFixed(2)),100])));
  assert.equal(recommendRate(d).recommended.feeRate,.16);
  assert.equal(recommendRate(d,{stepTicks:10}).recommended.feeRate,.20);
});
test('no additional weight falls back to the minimum qualifying quote',()=>{
  const r=recommendRate(buildDistribution(data([[.01,1000]])),{minimumPriority:95});
  assert.equal(r.reason,'no_gain');assert.equal(r.recommended.feeRate,.11);
});
test('recommendation matches exhaustive eligible-endpoint marginal maximization',()=>{
  let seed=119;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(let sample=0;sample<60;sample++){
    const txs=Array.from({length:25},()=>({rate:Math.floor(random()*180)/100,weight:1+Math.floor(random()*2000)}));
    const d=buildDistribution(txs),last=nextQuoteTicks(Math.max(...txs.map(t=>t.rate)));
    for(const step of [1,5,10])for(const target of [1,60,80,95]){
      const r=recommendRate(d,{minimumPriority:target,stepTicks:step});
      let bestWeight=0,bestTicks=r.baseline.ticks;
      for(let tick=r.baseline.ticks;tick<=r.searchLimit.ticks;tick++){
        const weight=txs.filter(t=>t.rate>=(tick-step)/100&&t.rate<tick/100).reduce((a,t)=>a+t.weight,0);
        if(weight>bestWeight){bestWeight=weight;bestTicks=tick;}
      }
      assert.equal(r.recommended.ticks,bestTicks);assert.ok(r.recommended.priority>=target);
    }
  }
});
test('invalid steps and priority requirements are rejected',()=>{
  const d=buildDistribution(data([[.13,1000]]));
  assert.throws(()=>marginalCurve(d,0));assert.throws(()=>marginalCurve(d,1.2));
  assert.throws(()=>marginalCurve(d,1,9));assert.throws(()=>recommendRate(d,{stepTicks:11}));
  assert.throws(()=>recommendRate(d,{minimumPriority:NaN}));
  assert.throws(()=>recommendRate(d,{minimumPriority:96}));
});
test('the 95% boundary includes an entire fee tier crossing the percentile',()=>{
  const r=recommendRate(buildDistribution(data([[.13,980],[100,20]])));
  assert.equal(r.searchLimit.feeRate,.14);assert.equal(r.recommended.feeRate,.14);
  assert.equal(r.recommended.priority,98);assert.equal(r.marginal.peak.gain,98);
});
test('marginal search excludes fee bands beyond the first 95% quote',()=>{
  const groups=[...Array.from({length:95},(_,i)=>[Number((.10+i*.01).toFixed(2)),10]),[100,50]];
  const d=buildDistribution(data(groups)),r=recommendRate(d);
  assert.equal(r.searchLimit.feeRate,1.05);assert.equal(r.recommended.feeRate,.70);
  assert.equal(r.marginal.peak.gain,1);
  assert.ok(r.marginal.segments.every(s=>s.startTicks+r.policy.stepTicks<=r.searchLimit.ticks));
});
test('cumulative average can prefer several gains over the largest single gain',()=>{
  const d=buildDistribution(data([[.01,600],[.11,40],[.12,120],[.13,90],[.14,10],[.49,70],[.99,70]]));
  const old=recommendRate(d),next=recommendCumulative(d);
  assert.equal(old.recommended.feeRate,.13);
  assert.equal(next.baseline.feeRate,.11);assert.equal(next.recommended.feeRate,.14);
  assert.equal(next.peak.gain,25);assert.equal(next.peak.extraTicks,3);
  assert.ok(Math.abs(next.peak.efficiency-25/.03)<1e-10);
});
test('cumulative search continues after an average declines',()=>{
  const d=buildDistribution(data([[.10,500],[.11,100],[.13,300],[.99,100]]));
  const r=recommendCumulative(d,{minimumPriority:50});
  assert.equal(r.recommended.feeRate,.14);assert.equal(r.peak.gain,40);
  assert.equal(r.peak.extraTicks,3);
});
test('cumulative cost includes fee gaps and may reject an expensive isolated peak',()=>{
  const d=buildDistribution(data([[.01,600],[.11,40],[.99,310],[1.99,50]]));
  assert.equal(recommendRate(d).recommended.feeRate,1);
  const r=recommendCumulative(d);
  assert.equal(r.recommended.feeRate,.12);assert.equal(r.peak.efficiency,400);
  const late=r.candidates.find(q=>q.feeRate===1);
  assert.equal(late.extraTicks,89);assert.equal(late.gain,35);
});
test('cumulative ties select the lowest positive-cost quote',()=>{
  const d=buildDistribution(data([[.10,600],[.11,100],[.12,100],[.13,100],[.14,100]]));
  const r=recommendCumulative(d);
  assert.equal(r.recommended.feeRate,.12);assert.equal(r.peak.efficiency,1000);
  assert.ok(r.candidates.every(q=>q.extraTicks>0&&Number.isFinite(q.efficiency)));
});
test('a baseline already reaching the search limit has no cumulative gain',()=>{
  const d=buildDistribution(data([[.13,980],[100,20]]));
  const r=recommendCumulative(d);
  assert.equal(r.baseline.feeRate,.14);assert.equal(r.recommended.feeRate,.14);
  assert.equal(r.recommended.priority,98);assert.equal(r.peak,null);
  assert.deepEqual(r.candidates,[]);assert.equal(r.reason,'no_gain');
});
test('cumulative search includes the full tier at 95% and excludes the tail',()=>{
  const d=buildDistribution(data([[.10,600],[.11,10],[.12,350],[100,40]]));
  const r=recommendCumulative(d);
  assert.equal(r.searchLimit.feeRate,.13);assert.equal(r.recommended.feeRate,.13);
  assert.equal(r.recommended.priority,96);assert.equal(r.peak.gain,36);
  assert.ok(r.candidates.every(q=>q.ticks<=r.searchLimit.ticks));
});
test('cumulative sparse scan matches exhaustive 0.01 grid search',()=>{
  let seed=587;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(let sample=0;sample<60;sample++){
    const txs=Array.from({length:30},()=>({rate:Math.floor(random()*1800)/1000,weight:1+Math.floor(random()*2000)}));
    const d=buildDistribution(txs);
    for(const target of [1,50,60,80,95]){
      const r=recommendCumulative(d,{minimumPriority:target});
      const baseWeight=txs.filter(t=>t.rate<r.baseline.feeRate).reduce((n,t)=>n+t.weight,0);
      let bestTicks=r.baseline.ticks,bestGain=0,bestCost=1;
      for(let ticks=r.baseline.ticks+1;ticks<=r.searchLimit.ticks;ticks++){
        const gain=txs.filter(t=>t.rate<ticks/100).reduce((n,t)=>n+t.weight,0)-baseWeight;
        const cost=ticks-r.baseline.ticks;
        if(BigInt(gain)*BigInt(bestCost)>BigInt(bestGain)*BigInt(cost)){
          bestTicks=ticks;bestGain=gain;bestCost=cost;
        }
      }
      assert.equal(r.recommended.ticks,bestTicks);
      assert.ok(r.recommended.priority>=target);
    }
  }
});
test('cumulative policy rejects invalid bounds and handles missing observations',()=>{
  assert.equal(recommendCumulative(null),null);
  const d=buildDistribution(data([[.13,1000]]));
  for(const policy of [{minimumPriority:NaN},{minimumPriority:-1},{minimumPriority:96},{maximumSearchPriority:0},{maximumSearchPriority:101}]){
    assert.throws(()=>recommendCumulative(d,policy),/invalid_cumulative_policy/);
  }
});
const tx=(id,rate=.13)=>[id.toString(16).padStart(64,'0'),130,1000,0,rate,0,0];
test('snapshots and ordered deltas preserve consistent transaction state',()=>{
  const original=applyProjectedBlock(null,{index:0,sequence:10,blockTransactions:[tx(1),tx(2)]});
  const next=applyProjectedBlock(original,{index:0,sequence:11,delta:{added:[tx(3)],removed:[tx(2)[0]],changed:[[tx(1)[0],.12,0]]}});
  assert.equal(next.transactions.size,2);assert.equal(next.transactions.get(tx(1)[0]).rate,.12);
  assert.equal(original.transactions.get(tx(1)[0]).rate,.13);
  assert.throws(()=>applyProjectedBlock(next,{index:0,sequence:13,delta:{added:[],removed:[],changed:[]}}),/sequence_gap/);
  assert.throws(()=>applyProjectedBlock(next,{index:0,sequence:12,delta:{added:[],removed:[],changed:[[tx(9)[0],.2]]}}));
  assert.equal(applyProjectedBlock(next,{index:0,sequence:100,blockTransactions:[tx(4)]}).transactions.size,1);
});
