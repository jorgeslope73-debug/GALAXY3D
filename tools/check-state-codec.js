'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const ctx=engineContext();vm.runInContext(fs.readFileSync('docs/net-state-codec.js','utf8'),ctx);vm.runInContext(fs.readFileSync('docs/p2p-network.js','utf8'),ctx);
const Codec=ctx.window.GalaxyStateCodec,Protocol=ctx.window.GalaxyNetProtocol;
const json=value=>JSON.parse(JSON.stringify(value));
const engine=new ctx.window.GalaxyHostPhysics({code:'TEST',seriesId:'a'.repeat(32),hostEpoch:1,rankRound:1});
engine.start([0,1,2,3].map(i=>({i,n:'PILOTO '+i,inputSessionId:String(i+1).repeat(32)})));
for(const p of engine.players){p.spawnFx=0;p.protection=0;p.bank=.12345678901234567;}
engine.asteroids=[{id:1,x:400.1234567890123,y:500.9876543210987,r:51.75,spin:1.23456789012345,type:1,fragment:false}];
engine.bullets=Array.from({length:40},(_,i)=>({id:i+1,owner:i%4,x:300+i*12,y:500+i*4,vx:123.456789,vy:-321.987654,guided:i%2===0,target:i%4}));
engine.meteors=Array.from({length:40},(_,i)=>({id:100+i,type:i%4,x:400+i*9,y:200+i*7,angle:i*7}));
engine.flares=Array.from({length:16},(_,i)=>({id:200+i,owner:i%4,x:900+i,y:500+i,angle:i*30,life:1.5}));
engine.pickups=Array.from({length:12},(_,i)=>({id:300+i,type:i%2?'ammo1':'shield',x:900+i,y:600+i,phase:.7}));
engine.fxEvents=Array.from({length:8},(_,i)=>({id:i+1,i:i%4,x:400+i,y:500+i,kind:i%2?'asteroidDust':'explosion',hidden:false,at:engine.fxClock}));
let original=json(engine.publicState());original.customMetadata={future:true,exact:Math.PI};original.players[0].customField='preserved';original.asteroids[0].customShape={v:2};
function expected(state,recipient){const result=json(state);for(const p of result.players||[])if(p.i!==recipient)delete p.motion;for(const b of result.bullets||[]){if(b.o===undefined&&b.owner!==undefined)b.o=b.owner;if(b.g===undefined&&b.guided!==undefined)b.g=b.guided;if(b.gt===undefined&&b.target!==undefined)b.gt=b.target;if(b.owner===undefined&&b.o!==undefined)b.owner=b.o;if(b.guided===undefined&&b.g!==undefined)b.guided=b.g;if(b.target===undefined&&b.gt!==undefined)b.target=b.gt;}return result;}
const before=JSON.stringify(original),sizes=[];
for(const recipient of [0,1,2,3]){
  const wire=json(Codec.encode(original,recipient)),decoded=Codec.decode(wire);
  assert.deepEqual(json(decoded),expected(original,recipient),'round-trip real snapshot without rounding or dropping metadata');
  assert.ok(decoded.players[recipient].motion,'recipient keeps its input replay basis');
  assert.ok(decoded.players.filter(p=>p.i!==recipient).every(p=>!('motion' in p)),'other input streams never travel to this recipient');
  for(const key of ['protocolVersion','seriesId','hostEpoch','rankRound','round','seq','simTime'])assert.equal(wire[key],original[key],'normal header remains readable: '+key);
  const full=Buffer.byteLength(JSON.stringify({t:'state',state:original})),compact=Buffer.byteLength(JSON.stringify({t:'state',state:wire}));
  assert.ok(compact<full*.65,'representative snapshot saves at least 35 percent');sizes.push({recipient,legacy:full,compact,saved:+(100*(1-compact/full)).toFixed(1)});
}
assert.equal(JSON.stringify(original),before,'packing must not modify authority');
const prepared=Codec.prepare(original),forOne=prepared.encodeFor(1),forTwo=prepared.encodeFor(2);
const shared=prepared.encodeForRecipients([1,2,3]),sharedDecoded=json(Codec.decode(json(shared))),sharedExpected=expected(original,1);
for(const p of sharedExpected.players)if([2,3].includes(p.i))p.motion=original.players.find(player=>player.i===p.i).motion;
assert.deepEqual(sharedDecoded,sharedExpected,'one relay upload contains exact replay bases only for its recipients');
const relayLegacy=Buffer.byteLength(JSON.stringify({t:'fallback-state',to:[1,2,3],state:original})),relayCompact=Buffer.byteLength(JSON.stringify({t:'fallback-state',to:[1,2,3],state:shared}));
assert.ok(relayCompact<relayLegacy*.65,'grouped relay compaction also saves at least 35 percent without three uploads');
console.log(JSON.stringify({relayLegacy,relayCompact,savedPercent:+(100*(1-relayCompact/relayLegacy)).toFixed(1)}));
assert.equal(forOne.entities.a,forTwo.entities.a,'asteroid rows are prepared once for all recipients');assert.equal(forOne.entities.b,forTwo.entities.b,'bullet rows are prepared once for all recipients');assert.notEqual(forOne.entities.p,forTwo.entities.p,'recipient input replay rows remain separate');
for(const recipient of [1,2,3])assert.deepEqual(json(Codec.decode(json(prepared.encodeFor(recipient)))),expected(original,recipient),'prepared and standalone encoders preserve identical data');
const changed={...original,winner:2};assert.equal(Codec.prepare(changed).encodeFor(1).winner,2,'a later broadcast reads the new header, without a stale cross-frame cache');
const aliasOnly={...original,bullets:[{id:1,owner:2,guided:true,target:3,x:Math.PI,y:Math.E,vx:1.2345678901234567,vy:-Math.PI}]};
assert.deepEqual(json(Codec.decode(json(Codec.encode(aliasOnly,2)))),expected(aliasOnly,2),'only-alias inputs reconstruct the names used by local rendering');
const mismatched={...original,bullets:[{id:1,o:1,owner:2,g:false,guided:true,gt:0,target:3,x:1,y:2,vx:0,vy:0}]};
assert.deepEqual(json(Codec.decode(json(Codec.encode(mismatched,2)))),expected(mismatched,2),'future alias mismatches are preserved in extras');
const packed=json(Codec.encode(original,1));
const withRows=(tag,rows)=>({...packed,entities:{...packed.entities,[tag]:rows}});
for(const broken of [null,{}, {...packed,entities:[]},{...packed,stateCodec:2},{...packed,entities:{}},{...packed,simTime:null},{...packed,seq:-1},{...packed,giant:{x:1,y:null}},{...packed,ufo:{id:3,x:'bad',y:2}}, {...packed,entities:{...packed.entities,unknown:[]}}, withRows('p',Array.from({length:5},()=>packed.entities.p[0])),withRows('p',[[0,0,1]]),withRows('p',[[1,0,null]]),withRows('p',[[0,3]]),withRows('p',[[1<<23,0,{x:'bad'}]])])assert.equal(Codec.decode(broken),null,'invalid packed rows are rejected safely');
for(const tag of ['p','a','b','k','m']){const wire=json(packed);delete wire.entities[tag];assert.equal(Codec.decode(wire),null,'required collection cannot be omitted: '+tag);}
function withoutField(tag,index){
  const wire=json(packed),row=wire.entities[tag][0],bit=1<<index;assert.ok(row[0]&bit,'fixture contains the removed field');
  let at=2;for(let i=0;i<index;i++)if(row[0]&(1<<i))at++;
  row.splice(at,1);row[0]&=~bit;return wire;
}
for(const [tag,index] of [['p',1],['p',2],['p',3],['p',5],['a',1],['a',4],['b',2],['b',4],['k',1],['m',4],['f',5],['e',4]])assert.equal(Codec.decode(withoutField(tag,index)),null,'a well-shaped row still needs every rendering field: '+tag+'/'+index);
const future=json(packed);future.futureRenderingHint={v:3};assert.deepEqual(json(Codec.decode(future)).futureRenderingHint,{v:3},'future metadata stays intact');
assert.equal(Codec.encode({...original,simTime:undefined},1),null,'an older producer without a replay clock must use legacy rather than emitting an unreadable compact state');

let raf=0;const transportContext=vm.createContext({window:{GalaxyNetProtocol:Protocol,GalaxyStateCodec:Codec},console,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>++raf,cancelAnimationFrame(){}});
vm.runInContext(fs.readFileSync('docs/p2p-network.js','utf8'),transportContext);
function network(isHost,onState=()=>{}){const n=new transportContext.window.GalaxyP2P({onState});Object.assign(n,{isHost,myIndex:isHost?0:1,hostIndex:0,hostEpoch:1,rankRound:1,seriesId:'a'.repeat(32),inputSessionId:'1'.repeat(32)});return n;}
function peer(net,index,{reliableFirst=false}={}){const fast=[],reliable=[],rec={pc:{connectionState:'connected'},open:false,stateCodec:0};net.peers.set(index,rec);
  const channels=[['galaxy-fast',fast],['galaxy-reliable',reliable]];if(reliableFirst)channels.reverse();
  for(const [label,messages] of channels){const dc={label,readyState:'open',bufferedAmount:0,send:raw=>messages.push(raw),close(){}};net.bindChannel(index,dc);dc.onopen();}
  return {rec,fast,reliable};
}
const host=network(true),modern=peer(host,1),legacy=peer(host,2);
const reverse=peer(network(true),3,{reliableFirst:true});assert.equal(reverse.reliable.filter(raw=>JSON.parse(raw).t==='capabilities').length,1,'reliable-first opening negotiates once even before fast is ready');assert.equal(reverse.rec.open,true);
assert.ok(modern.reliable.some(raw=>JSON.parse(raw).t==='capabilities'),'reliable open announces local decoder');
host.broadcastState(original);host.flushBroadcastState();assert.equal(JSON.parse(modern.fast.at(-1)).state.stateCodec,undefined,'advertising alone does not enable compact packets');
const capabilities=Protocol.stamp(host,{t:'capabilities',capabilities:1});
modern.rec.reliableDc.onmessage({data:JSON.stringify({...capabilities,seriesId:'b'.repeat(32)})});assert.equal(modern.rec.stateCodec,0,'a different session cannot negotiate');
modern.rec.fastDc.onmessage({data:JSON.stringify(capabilities)});assert.equal(modern.rec.stateCodec,0,'only the reliable channel negotiates a decoder');
modern.rec.reliableDc.onmessage({data:JSON.stringify(capabilities)});assert.equal(modern.rec.stateCodec,1);
host.broadcastState(original);host.flushBroadcastState();assert.equal(JSON.parse(modern.fast.at(-1)).state.stateCodec,1,'only confirmed peer receives compact');assert.equal(JSON.parse(legacy.fast.at(-1)).state.stateCodec,undefined,'legacy peer still receives ordinary JSON');
const received=[],client=network(false,s=>received.push(s)),connection=peer(client,0);
const message=seq=>JSON.stringify({t:'state',state:Codec.encode({...original,seq},1)});
connection.rec.fastDc.onmessage({data:message(3)});connection.rec.fastDc.onmessage({data:message(2)});client.flushPendingState();assert.equal(received.at(-1).seq,3,'loss/reorder filtering uses the normal packed header');
assert.deepEqual(json(received.at(-1)),expected({...original,seq:3},1),'decoder runs before onState');
const malformed={...packed,seq:4,entities:{p:[[0,3]]}};connection.rec.fastDc.onmessage({data:JSON.stringify({t:'state',state:malformed})});assert.equal(client.flushPendingState(),false);assert.equal(client.closed,false,'malformed state does not close transport');
connection.rec.fastDc.onmessage({data:JSON.stringify({t:'state',state:{...packed,seq:5,stateCodec:2}})});assert.equal(client.flushPendingState(),false,'unsupported codec version must not reach onState as a legacy snapshot');assert.equal(client.closed,false);assert.equal(received.at(-1).seq,3);
connection.rec.fastDc.onmessage({data:JSON.stringify({t:'state',state:{...packed,seq:6,entities:{}}})});assert.equal(client.flushPendingState(),false,'empty compact header must not replace the last usable state');assert.equal(received.at(-1).seq,3);
connection.rec.fastDc.onmessage({data:message(7)});client.flushPendingState();assert.equal(received.at(-1).seq,7,'later packet is complete without the lost/malformed baselines');
modern.rec.reliableDc.onmessage({data:JSON.stringify({...capabilities,capabilities:0})});host.broadcastState({...original,seq:8});host.flushBroadcastState();assert.equal(JSON.parse(modern.fast.at(-1)).state.stateCodec,undefined,'capability revoke returns to legacy');
const oldContext=vm.createContext({window:{GalaxyNetProtocol:Protocol},console,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});vm.runInContext(fs.readFileSync('docs/p2p-network.js','utf8'),oldContext);const old=new oldContext.window.GalaxyP2P({onState:s=>received.push(s)});Object.assign(old,{isHost:false,myIndex:2,hostIndex:0,hostEpoch:1,rankRound:1,seriesId:'a'.repeat(32)});const oldPeer=peer(old,0);assert.equal(oldPeer.reliable.length,0,'missing codec never advertises it');oldPeer.rec.fastDc.onmessage({data:legacy.fast.at(-1)});old.flushPendingState();assert.equal(received.at(-1).seq,8,'legacy client remains fully functional');
let preparations=0;transportContext.window.GalaxyStateCodec={...Codec,prepare:s=>{preparations++;return Codec.prepare(s);}};
const third=peer(host,3);for(const link of [modern,legacy,third])link.rec.reliableDc.onmessage({data:JSON.stringify(capabilities)});
host.broadcastState({...original,seq:9});host.flushBroadcastState();assert.equal(preparations,1,'three recipients share a single preparation per broadcast');for(const [recipient,link] of [[1,modern],[2,legacy],[3,third]])assert.deepEqual(json(Codec.decode(JSON.parse(link.fast.at(-1)).state)),expected({...original,seq:9},recipient));
console.log('State codec OK: exact real-snapshot round-trip, own motion only, aliases, metadata, malformed isolation, stateless loss/reorder recovery, negotiated per-peer compatibility.');console.log(JSON.stringify(sizes));

(async()=>{
  let now=0,closed=0;
  class Pc{
    constructor(){this.connectionState='new';}
    createDataChannel(label){return {label,readyState:'connecting',bufferedAmount:0,close(){},send(){}};}
    async createOffer(){return {type:'offer',sdp:'test'};}
    async setLocalDescription(offer){this.localDescription=offer;}
    close(){this.connectionState='closed';closed++;}
  }
  const env=vm.createContext({window:{GalaxyNetProtocol:Protocol},RTCPeerConnection:Pc,performance:{now:()=>now},console,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
  vm.runInContext(fs.readFileSync('docs/p2p-network.js','utf8'),env);
  const net=new env.window.GalaxyP2P({});Object.assign(net,{isHost:true,myIndex:0,hostIndex:0,hostEpoch:1,rankRound:1,seriesId:'a'.repeat(32)});
  await net.reconnectPeer(1);const first=net.peers.get(1),staleCallback=first.pc.onconnectionstatechange;
  for(now=3000;now<=6000;now+=3000){await net.reconnectPeer(1);assert.equal(net.peers.get(1),first,'repeated fallback requests preserve a recent ICE attempt');}
  assert.equal(closed,0,'a new connection gets eight seconds to establish');
  now=8100;await net.reconnectPeer(1);const second=net.peers.get(1);assert.notEqual(second,first);assert.equal(closed,1,'stalled old attempt can be replaced');
  first.pc.connectionState='failed';staleCallback();assert.equal(net.peers.get(1),second,'callback from retired connection cannot alter replacement');assert.equal(closed,1);
  now=8200;second.pc.connectionState='failed';await net.reconnectPeer(1);const third=net.peers.get(1);assert.notEqual(third,second,'failed attempt can restart immediately');assert.equal(closed,2);
  now=8300;await net.reconnectPeer(1,{force:true});assert.notEqual(net.peers.get(1),third,'explicit force may replace a recent attempt');assert.equal(closed,3);
  console.log('P2P reconnect guard OK: repeated fallback keeps recent ICE, failed/expired attempts recover, explicit force and stale callback isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
