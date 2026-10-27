'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/host-client.js','utf8'),c=vm.createContext({window:{},performance});vm.runInContext(source,c);
const Link=c.window.GalaxyHostClient,context={seriesId:'a'.repeat(32),hostEpoch:1,rankRound:1};
function fixture(peers=[1],extra={}){
  let clock=1000;const log=[];
  const link=new Link({context,peers,now:()=>clock,onControl:p=>log.push(['control',clock,p]),onAction:p=>log.push(['action',clock,p]),onState:p=>log.push(['state',clock,p]),onEvent:p=>log.push(['event',clock,p]),...extra});
  return {link,log,at(now){clock=now;link.flushInputs(now);link.flushView(now);},packet:p=>({...context,...p})};
}
{
  const f=fixture(),control=f.packet({controlSeq:1,turn:1}),state=f.packet({seq:1});
  assert.equal(f.link.enqueueInput('control',control),true);assert.equal(f.link.enqueueView('state',state),true);
  f.at(1039);assert.deepEqual(f.log,[],'neither controls nor authority states bypass the local transport');
  f.at(1040);assert.deepEqual(f.log.map(x=>[x[0],x[1]]),[['control',1040],['state',1040]]);
  assert.strictEqual(f.log[1][2],state,'snapshots are immutable shared data; no redundant serialization');
  assert.equal(f.link.enqueueInput('control',control),false,'a duplicate/out-of-order control cannot reapply');
  const action=f.packet({kind:'rocket',actionId:1,inputSessionId:'b'.repeat(32)});
  assert.equal(f.link.enqueueInput('action',action),true);assert.equal(f.link.enqueueInput('action',action),true);
  f.at(1080);assert.equal(f.log.filter(x=>x[0]==='action').length,1,'reliable retries cannot duplicate a missile');
}
{
  const f=fixture(),p=f.packet;
  f.link.enqueueView('state',p({seq:1}));f.link.enqueueView('state',p({seq:2}));
  f.link.enqueueView('event',p({t:'sound',eventId:1}));f.link.enqueueView('state',p({seq:3}));
  f.at(1040);assert.deepEqual(f.log.map(x=>x[0]==='state'?x[2].seq:x[2].t),[2,'sound',3],'coalesce stale snapshots while retaining event order');
}
{
  const f=fixture([1,2,3]);let packet=f.link.decorateState(f.packet({seq:1}));
  assert.ok(packet.linkProbe);const id=packet.linkProbe.id;
  assert.equal(f.link.pong(9,id,1010),false);assert.equal(f.link.pong(1,id+1,1010),false);
  assert.equal(f.link.pong(1,id,1080),true);assert.equal(f.link.pong(1,id,1081),false,'duplicate pong cannot bias RTT');
  assert.equal(f.link.pong(2,id,1100),true);assert.equal(f.link.pong(3,id,1800),true);
  f.link.update(1800);assert.equal(f.link.stats.rttMs,100,'use the group median instead of the slowest player');
  for(let now=1800;now<=4000;now+=50)f.link.update(now);assert.equal(f.link.delayMs,50);
  const recent=f.link.decorateState(f.packet({seq:2}),3000);assert.ok(recent.linkProbe.id>id);
  assert.equal(f.link.pong(1,id,3010),false,'a late echo of a retired probe is ignored');
  const huge=fixture();packet=huge.link.decorateState(huge.packet({seq:1}));huge.link.pong(1,packet.linkProbe.id,2000);
  for(let now=2000;now<=7000;now+=50)huge.link.update(now);assert.equal(huge.link.delayMs,90,'artificial round trip is capped at180ms');
  huge.link.update(13000);assert.equal(huge.link.stats.measuredPeers,0,'old measurements expire');
  const empty=fixture([]);empty.link.update(5000);assert.equal(empty.link.delayMs,0);assert.equal(empty.link.decorateState(empty.packet({seq:1})).linkProbe,undefined,'CPU fill creates no artificial peer or probing traffic');
}
{
  const f=fixture();
  f.link.enqueueInput('control',f.packet({controlSeq:1}));f.link.enqueueInput('action',f.packet({kind:'flare',actionId:1}));
  f.at(4001);assert.deepEqual(f.log,[],'a suspended tab cannot revive held keys or old special actions');
  assert.equal(f.link.stats.staleInputs,2);
  for(let seq=2;seq<=65;seq++)assert.equal(f.link.enqueueInput('control',f.packet({controlSeq:seq}),4001),true);
  assert.equal(f.link.enqueueInput('control',f.packet({controlSeq:66}),4001),false,'input memory is bounded and retryable');
  f.link.setContext({...context,rankRound:2});f.at(9999);assert.deepEqual(f.log,[],'round changes discard all queued old work');
  assert.equal(f.link.enqueueView('state',f.packet({seq:99})),false);
  f.link.close();assert.equal(f.link.enqueueView('event',{...context,rankRound:2}),false);
}
{
  const f=fixture(),gate=(phase,remainingMs)=>f.packet({seq:1,startGate:{v:1,key:'READY',phase,remainingMs}});
  f.link.enqueueView('state',gate('preparing',0));f.at(1040);assert.equal(f.link.preparing(),true);
  f.link.enqueueView('state',gate('countdown',3000));f.at(1080);assert.equal(f.link.viewGate.deadline,4080);
  f.at(4079);assert.equal(f.link.preparing(),true);f.at(4080);assert.equal(f.link.preparing(),false);
  assert.equal(f.link.viewGate.goAt,4080,'client entry countdown releases on its delivered timeline, not authority time');
  f.link.enqueueView('state',gate('go',0));f.at(4120);assert.equal(f.link.viewGate.goAt,4080,'a late GO cannot restart the private countdown');
}
console.log('Host client link OK: symmetric bounded queues, ordered/coalesced states and events, action deduplication, measured median RTT, sparse probes,180ms cap, fresh contexts, suspension and a separate start-view clock.');
