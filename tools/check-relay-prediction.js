'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext,onlineRoom}=require('./check-session-regressions.js');
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
const json=value=>JSON.parse(JSON.stringify(value));
function source(name){const a=game.indexOf('  function '+name+'('),b=game.indexOf('\n  function ',a+1);assert.ok(a>=0&&b>a,name);return game.slice(a,b);}
function environment(clock={now:1000000}){
  const c=engineContext(clock);
  for(const file of ['net-state-codec','motion-prediction'])vm.runInContext(fs.readFileSync('docs/'+file+'.js','utf8'),c);
  return c;
}
const env=environment(),Codec=env.window.GalaxyStateCodec,Protocol=env.window.GalaxyNetProtocol;
const context={protocolVersion:Protocol.VERSION,seriesId:'a'.repeat(32),hostEpoch:2,rankRound:1};
const control={...context,inputSessionId:'b'.repeat(32),controlSeq:1,turn:1,thrust:true,fire:false,directFire:false};
for(const style of ['hold','changes','gaps']){
  const frames=Array.from({length:60},(_,i)=>[style==='gaps'?i*2+1:i+1,style==='changes'?(i%3-1)/2:1,1,i===15?1:0,i===15?1:0]);
  const original={...control,motion:{v:1,epoch:7,frames}},wire=Codec.encodeRelayControl(original);
  assert.deepEqual(json(Codec.decodeRelayControl(wire)),original,'all ticks, gaps, analog turns and short pulses survive '+style);
  if(style==='hold')assert.ok(wire.length<JSON.stringify(original).length*.5,'held controls use bounded run lengths');
}
for(const patch of [{turn:Infinity},{turn:2},{controlSeq:0},{inputSessionId:'bad'},{thrust:1},{motion:{v:1,epoch:7,frames:[[1,0,1,0,0],[1,0,1,0,0]]}},{motion:{v:1,epoch:7,frames:[[1,0,2,0,0]]}},{motion:{v:1,epoch:7,frames:Array.from({length:61},(_,i)=>[i+1,0,0,0,0])}}])assert.equal(Codec.encodeRelayControl({...control,...patch}),null);
const validRow=[2,context.seriesId,2,1,control.inputSessionId,1,0,0];
for(const motion of [[7,[[1,61,0,0]]],[7,[[1,1,0,8]]],[7,[[1,1,NaN,0]]],[7,[[Number.MAX_SAFE_INTEGER,2,0,0]]],[7,[[2,2,0,0],[3,1,0,0]]]])assert.equal(Codec.decodeRelayControl(Codec.relayControlPrefix+JSON.stringify([...validRow,motion])),null);
for(const wire of ['other',Codec.relayControlPrefix+'{',Codec.relayControlPrefix+'x'.repeat(17000)])assert.equal(Codec.decodeRelayControl(wire),null);

async function fixture(){
  const backend=await onlineRoom(),clock={now:1000000},engines=environment(clock),room=backend.room(backend.code),out=[];
  const h=new engines.window.GalaxyHostPhysics({...Protocol.context(room),code:backend.code});h.start(room.players);
  for(const p of h.players)Object.assign(p,{x:p.index?500:1600,y:p.index?500:900,rot:0,vx:0,vy:0,spawnFx:0,protection:100,bullets:0});
  for(const name of ['updateAsteroids','updateFlares','updateBullets','updatePickups','updateShower','updateMeteors','updateGiant','updateUfo','shipCollisions'])h[name]=()=>{};
  const common={window:engines.window,PROTOCOL:Protocol,hostEpoch:room.hostEpoch,onlineSeriesId:room.seriesId,onlineSeriesPhase:'playing',currentOnlineSeriesRound:()=>1,WebSocket:{OPEN:1},matchStartGate:null,roomCode:backend.code,networkPlayback:{cursor:0}};
  const host=vm.createContext({...common,isHost:true,hostPhysics:h,ws:{readyState:1,bufferedAmount:0},fallbackPeers:new Set([1]),fallbackCodecPeers:new Map(),lastFallbackStateSentAt:0,FALLBACK_STATE_MS:50,performance:{now:()=>clock.now},sendSocketRaw:(ws,raw)=>{out.push(JSON.parse(raw));return true;}});
  const sent=[],pred=new engines.window.GalaxyMotionPrediction();
  const guest=vm.createContext({...common,state:h.publicState(),isHost:false,localCpuActive:false,inGame:true,inputSuspended:false,inputSessionId:backend.guest.inputSessionId,myIndex:1,guestMotion:pred,guestMotionContext:'',fallbackActive:true,clientNeedsFallback:()=>true,requestFallback(){},controlSeq:0,lastSubmittedTurn:NaN,lastSubmittedThrust:false,lastTurnControlSeq:0,lastMotionControlSeq:0,ws:{readyState:1,bufferedAmount:0},p2p:{sendControl(){return false;}},performance:{now:()=>clock.now},sendSocketRaw:(ws,raw)=>{sent.push(JSON.parse(raw));return true;},handle:m=>{guest.state=m;},receiveOnlineEvent(){}});
  for(const c of [host,guest])for(const name of ['onlineContext','onlinePacket','isCurrentOnlinePacket','relayPredictionAvailable'])vm.runInContext(source(name),c);
  for(const name of ['receiveRelayControl','sendHostFallbackState'])vm.runInContext(source(name),host);
  for(const name of ['sendControl','updateGuestPrediction'])vm.runInContext(source(name),guest);
  const a=game.indexOf("      if(m&&m.t==='fallback-state'){"),b=game.indexOf("      if(m&&m.t==='fallback-event'){",a);
  vm.runInContext('function receive(m){'+game.slice(a,b)+'}',guest);
  const actionA=game.indexOf("      if(m&&m.t==='fallback-action'){"),actionB=game.indexOf("      if(m&&m.t==='critical-ack'){",actionA);
  vm.runInContext('function receiveAction(m){'+game.slice(actionA,actionB)+'}',host);
  return {backend,clock,engines,h,host,guest,pred,sent,out};
}

async function exercise(fps,latency,jitter=0,switches=false,loss=0){
  const f=await fixture(),{backend,clock,h,host,guest,pred,sent,out}=f;
  let now=0,inputCursor=0,stateCursor=0,hostCursor=backend.host.messages.length,guestCursor=backend.guest.messages.length,nextInput=0,nextState=0,maxCorrection=0,maxBankError=0,compact=0,legacy=0;
  const toHost=[],toGuest=[];
  for(let frame=0;frame<=6*240;frame++){
    now=frame*1000/240;clock.now=1000000+now;
    const relay=!switches||now>=1500&&now<3500;
    guest.fallbackActive=relay;guest.clientNeedsFallback=()=>relay;
    guest.p2p.sendControl=(turn,thrust,fire,actions,seq)=>{if(!loss||seq%loss)toHost.push({at:now+latency,control:{turn,thrust,fire,...actions,controlSeq:seq,inputSessionId:guest.inputSessionId}});return true;};
    const input={turn:now>=300&&now<1000?1:now>=1800&&now<2700?-.5:0,thrust:now>=200&&now<2800,fire:false,directFire:false};
    if(frame%(240/fps)===0){
      guest.updateGuestPrediction(now,input);assert.equal(pred.ready,true,'prediction stays active across relay/P2P switches');
      if(now+1e-6>=nextInput){assert.equal(guest.sendControl(input.turn,input.thrust,false,{directFire:false}),true);nextInput=now+1000/30;}
    }
    while(inputCursor<sent.length){const packet=sent[inputCursor++];assert.equal(packet.t,'fallback-action');toHost.push({at:now+Math.max(0,latency+[0,1,-.5][inputCursor%3]*jitter),packet});}
    toHost.sort((a,b)=>a.at-b.at);
    while(toHost.length&&toHost[0].at<=now+1e-6){
      const message=toHost.shift();
      if(message.control)h.setControl(1,message.control.turn,message.control.thrust,message.control.fire,message.control);
      else{
        await backend.receive(backend.guest,message.packet,{raw:true});
        for(const m of backend.host.messages.slice(hostCursor))if(m.t==='fallback-action')host.receiveAction(m);
        hostCursor=backend.host.messages.length;
      }
    }
    if(frame&&frame%4===0){h.update(1/60);h.tickCount++;}
    if(now+1e-6>=nextState){
      const state=h.publicState();nextState=now+50;
      if(relay){host.sendHostFallbackState(state);while(stateCursor<out.length){const packet=out[stateCursor++];if(packet.state.stateCodec===1)compact++;else legacy++;await backend.receive(backend.host,packet,{raw:true});for(const m of backend.guest.messages.slice(guestCursor))if(m.t==='fallback-state')toGuest.push({at:now+latency,packet:m});guestCursor=backend.guest.messages.length;}}
      else if(!loss||state.seq%loss)toGuest.push({at:now+latency,state});
    }
    while(toGuest.length&&toGuest[0].at<=now+1e-6){const message=toGuest.shift();if(message.state)guest.state=message.state;else guest.receive(message.packet);}
    if(pred.ready){maxCorrection=Math.max(maxCorrection,pred.stats.correction);assert.ok(pred.history.length<=120);assert.ok(Number.isFinite(pred.sample().bank));}
    if(pred.ready&&pred.lastSnapshot?.motion){const basis=pred.fromPlayer(pred.lastSnapshot);for(const tick of pred.history)enginesStep(f,basis,tick);maxBankError=Math.max(maxBankError,Math.abs(basis.bank-pred.pose.bank));}
  }
  assert.equal(backend.host.readyState,1);assert.equal(backend.guest.readyState,1,'real relay rate guard remains satisfied');
  assert.ok(compact>0);assert.ok(maxCorrection<4,'correction remains bounded');assert.ok(maxBankError<1e-9,'bank uses the same replay basis as translation and heading');
  assert.equal(h.players[1].thrust,false,'release reaches the actual authority');
  return {fps,latency,jitter,switches,loss,compact,legacy,maxCorrection:+maxCorrection.toFixed(5)};
}
function enginesStep(f,pose,tick){f.engines.window.GalaxyPhysicsCore.stepShipMovement(pose,{turn:tick[1],thrust:!!tick[2]});}

async function main(){
  const f=await fixture(),{backend,h,host,guest,pred,out}=f;
  guest.updateGuestPrediction(0,{turn:0,thrust:false,fire:false});guest.updateGuestPrediction(17,{turn:1,thrust:true,fire:false});guest.sendControl(1,true,false);
  const action=f.sent.at(-1),beforeInvalid=backend.host.messages.length;
  await backend.receive(backend.guest,{...action,inputSessionId:undefined},{raw:true});assert.equal(backend.host.messages.length,beforeInvalid,'the actual relay rejects a missing outer input session');
  await backend.receive(backend.guest,action,{raw:true});host.receiveAction(backend.host.last('fallback-action'));assert.equal(host.fallbackCodecPeers.size,1);
  const original=h.publicState();host.sendHostFallbackState(original);const packed=out.at(-1);assert.equal(packed.state.stateCodec,1);
  await backend.receive(backend.host,packed,{raw:true});guest.receive(backend.guest.last('fallback-state'));assert.ok(guest.state.players.find(p=>p.i===1).motion);assert.equal(guest.state.relayCaps,1);
  const before=h.controls.get(1).controlSeq;
  host.receiveAction({...backend.host.last('fallback-action'),action:Codec.encodeRelayControl({...control,...Protocol.context(h),inputSessionId:'e'.repeat(32),controlSeq:999})});assert.equal(h.controls.get(1).controlSeq,before,'an envelope cannot claim another input session');
  const snapshot=guest.state;guest.receive({t:'fallback-state',state:{...packed.state,entities:{}}});assert.equal(guest.state,snapshot,'malformed compact state leaves the last usable state intact');
  const delayed=Codec.encodeRelayControl({...control,...Protocol.context(h),hostEpoch:h.hostEpoch-1,inputSessionId:backend.guest.inputSessionId,controlSeq:999});
  assert.equal(host.receiveRelayControl({...Protocol.context(h),from:1,action:delayed}),false,'a relay-stamped outer header cannot revive old inner authority');
  const beforeDeath=h.publicState().players.find(p=>p.i===1);h.players[1].protection=0;h.destroyShip(h.players[1]);guest.state=h.publicState();guest.updateGuestPrediction(34,{turn:0,thrust:false,fire:false});assert.equal(pred.ready,false,'authoritative death clears local movement immediately');
  h.respawnPlayer(h.players[1]);h.players[1].spawnFx=0;guest.state=h.publicState();guest.updateGuestPrediction(35,{turn:0,thrust:false,fire:false});assert.notEqual(pred.epoch,beforeDeath.motion.epoch,'authoritative respawn starts a new command stream');
  guest.state={...snapshot,relayCaps:undefined};guest.updateGuestPrediction(35,{turn:0,thrust:false,fire:false});assert.equal(pred.ready,false,'old host retains legacy fallback');guest.sendControl(0,false,false);assert.equal(f.sent.at(-1).t,'fallback-ctrl');
  host.fallbackCodecPeers.clear();f.clock.now+=60;host.sendHostFallbackState(h.publicState());assert.equal(out.at(-1).state.stateCodec,undefined,'old guest receives legacy state until it proves support');
  host.fallbackCodecPeers.set(1,{seriesId:h.seriesId,hostEpoch:h.hostEpoch,inputSessionId:backend.guest.inputSessionId});h.players[1].inputSessionId='c'.repeat(32);f.clock.now+=60;host.sendHostFallbackState(h.publicState());assert.equal(out.at(-1).state.stateCodec,undefined,'a replacement session cannot inherit decoder capability');
  const state=h.publicState(),group=Codec.prepare(state).encodeForRecipients([0,1]),restored=Codec.decode(json(group));assert.ok(restored.players.every(p=>p.cpu||p.motion),'a shared relay packet retains each recipient replay basis');
  h.start([0,1,2,3].map(i=>({i,n:'Pilot '+i,inputSessionId:(i+1).toString().repeat(32)})));
  host.fallbackPeers=new Set([1,2,3]);host.fallbackCodecPeers=new Map([1,2,3].map(i=>[i,{seriesId:h.seriesId,hostEpoch:h.hostEpoch,inputSessionId:h.players[i].inputSessionId}]));
  let count=out.length;f.clock.now+=60;host.sendHostFallbackState(h.publicState());assert.equal(out.length-count,1,'three modern guests share one upload');assert.deepEqual(json(out.at(-1).to),[1,2,3]);
  const grouped=Codec.decode(json(out.at(-1).state));assert.equal(grouped.players.filter(p=>p.motion).length,3);assert.equal(grouped.players[0].motion,undefined);
  host.fallbackCodecPeers.delete(2);count=out.length;f.clock.now+=60;host.sendHostFallbackState(h.publicState());assert.equal(out.length-count,2,'a mixed room gets one compact group and one legacy group');
  assert.deepEqual(out.slice(count).map(m=>json(m.to)),[[1,3],[2]]);
  const results=[];for(const options of [[30,50],[60,100],[120,50,20],[60,75,15,true,7]])results.push(await exercise(...options));
  console.log('Relay prediction OK: actual unchanged server forwarding, compact grouped snapshots, exact run-length controls, short pulses, session isolation, old clients, corrupt packets, local bank replay and 30/60/120 Hz transport switches.');console.log(JSON.stringify(results));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixture,exercise};
