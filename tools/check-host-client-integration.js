'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const PROTOCOL=require('../server/net-protocol.js');
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
function fn(name){const a=game.indexOf('  function '+name+'('),b=game.indexOf('\n  }',a);assert.ok(a>=0&&b>a,name);return game.slice(a,b+4);}
const helpers=['onlineContext','onlinePacket','isCurrentOnlinePacket','activeHostClient','closeHostClient','routeHostSnapshot','pumpHostClient','startPreparationPeers','startHostPhysics','sendControl','sendInputAction','acknowledgeInputAction','receiveOnlineEvent','applyOnlineInputAction','replyLinkProbe','receiveLinkPong','updateGuestPrediction'];
const series='a'.repeat(32),sessions=['b'.repeat(32),'c'.repeat(32),'d'.repeat(32),'e'.repeat(32)];
const clone=x=>JSON.parse(JSON.stringify(x));
function scenario({fps=60,latency=40,hostIndex=0,fair=true,relay=false}={}){
  let now=1000,states=0,hostDirect=0,guestDirect=0,peerActions=0;
  const wire=[],clock={now:1000000},host=engineContext(clock),guest=engineContext(clock),guestIndex=hostIndex===0?1:0;
  const roster=[hostIndex,guestIndex].map(i=>({i,n:'J'+i,inputSessionId:sessions[i]}));
  for(const c of [host,guest]){
    c.performance={now:()=>now+(c===guest?500000:0)};
    for(const file of ['host-client','motion-prediction','network-playback','net-state-codec'])vm.runInContext(fs.readFileSync('docs/'+file+'.js','utf8'),c);
    Object.assign(c,{PROTOCOL,roomCode:'TEST',onlineSeriesId:series,onlineSeriesPhase:'playing',hostEpoch:1,onlineSeriesRound:1,hostPhysics:null,hostClientLink:null,
      localCpuActive:false,localCpu:null,inGame:true,inputSuspended:false,hostIndex,lobbyPlayers:roster,playerToken:'test',onlineTestProfile:'standard',
      lastLinkProbeKey:'',controlSeq:0,lastMotionControlSeq:0,lastTurnControlSeq:0,lastSubmittedTurn:NaN,lastSubmittedThrust:false,
      fallbackActive:relay,clientNeedsFallback:()=>relay,relayPredictionAvailable:()=>true,onlineContextRound:1,
      guestMotion:new c.window.GalaxyMotionPrediction(),guestMotionContext:'',networkPlayback:new c.window.GalaxyNetworkPlayback(),
      matchStartGate:{blocked:false,phase:'go'},pendingInputActions:[],onlineEvents:new PROTOCOL.ReplayWindow(32),onlineEventContext:'',sendHostFallbackState(){},submitOnlineSeriesRound(){},
      receiveOnlineEvent(){},applyOnlineInputAction(){},activateGameUi(){},playSound(){},
      WebSocket:{OPEN:1},ws:null,sendSocketRaw(){return false;},currentOnlineSeriesRound:()=>1});
    vm.runInContext(helpers.map(fn).join('\n'),c);
    c.handle=packet=>{if(packet.t==='state'){c.state=packet;c.networkPlayback.push(packet,c.performance.now());c.replyLinkProbe(packet);}};
  }
  Object.assign(host,{isHost:true,myIndex:hostIndex,inputSessionId:sessions[hostIndex],state:null});
  Object.assign(guest,{isHost:false,myIndex:guestIndex,inputSessionId:sessions[guestIndex],state:null});
  if(!fair)delete host.window.GalaxyHostClient;
  const schedule=(delay,work)=>wire.push({due:now+delay,work});
  host.p2p={broadcastState:packet=>{
    states++;
    const packed=host.window.GalaxyStateCodec.encode(packet,guestIndex);assert.ok(packed);
    schedule(latency,()=>{const decoded=guest.window.GalaxyStateCodec.decode(clone(packed));assert.ok(decoded);guest.handle(decoded);});
  },broadcastEvent(){},sendControl(){hostDirect++;return true;},sendInputAction(){hostDirect++;return true;}};
  guest.p2p={sendControl:(turn,thrust,fire,actions,controlSeq)=>{
    const packet=PROTOCOL.stamp({seriesId:series,hostEpoch:1,rankRound:1},{turn,thrust,fire,...clone(actions),controlSeq,inputSessionId:guest.inputSessionId});
    schedule(latency,()=>{guestDirect++;host.hostPhysics.setControl(guestIndex,turn,thrust,fire,packet);});return true;
  },sendAction:(action,rankRound)=>{
    peerActions++;schedule(latency,()=>host.receiveLinkPong(guestIndex,PROTOCOL.stamp({seriesId:series,hostEpoch:1,rankRound},{action})));return true;
  }};
  if(relay){
    guest.ws={readyState:1,bufferedAmount:0};
    guest.sendSocketRaw=(_ws,raw)=>{
      const packet=JSON.parse(raw);
      if(packet.action?.startsWith('gc-link:1:')){
        peerActions++;schedule(latency,()=>host.receiveLinkPong(guestIndex,PROTOCOL.stamp({seriesId:series,hostEpoch:1,rankRound:1},{action:packet.action})));return true;
      }
      if(packet.action?.startsWith('gc-ctrl:1:')){
        const decoded=host.window.GalaxyStateCodec.decodeRelayControl(packet.action);assert.ok(decoded);
        schedule(latency,()=>{guestDirect++;host.hostPhysics.setControl(guestIndex,decoded.turn,decoded.thrust,decoded.fire,decoded);});return true;
      }
      return false;
    };
    guest.requestFallback=()=>{};
  }
  assert.equal(host.startHostPhysics(roster,1),true);
  const engine=host.hostPhysics;
  engine.asteroids=[];
  for(const method of ['updateAsteroids','updatePickups','updateShower','updateMeteors','updateGiant','updateUfo','shipCollisions'])engine[method]=()=>{};
  for(const p of engine.players)Object.assign(p,{x:p.index===hostIndex?400:1400,y:800,rot:0,vx:0,vy:0,spawnFx:0,protection:100,bullets:3,reload:0,cadence:30});
  const phase={...engine.publicState(),startGate:{v:1,key:'START',phase:'go',remainingMs:0}};
  const outgoing=host.routeHostSnapshot(phase);host.p2p.broadcastState(outgoing);
  assert.equal(fair?host.state===null:host.state!==null,true,'first authority state cannot bypass the local client link');
  const moved={},applied={},shot={},worldAges={host:[],guest:[]};
  const start=4000,fireAt=4500,frames=Math.round(fps*7);
  for(let frame=0;frame<=frames;frame++){
    now=1000+frame*1000/fps;clock.now=1000000+now;
    for(let i=0;i<wire.length;){if(wire[i].due<=now+1e-6){const task=wire.splice(i,1)[0];task.work();}else i++;}
    host.pumpHostClient(now);
    const input={turn:0,thrust:now>=start&&now<5500,fire:now>=fireAt&&now<4600,directFire:true};
    for(const [label,c] of [['host',host],['guest',guest]]){
      c.updateGuestPrediction(c.performance.now(),input);
      if(frame%Math.max(1,Math.round(fps/30))===0){
        if(!fair&&c===host){const seq=++c.controlSeq;engine.setControl(hostIndex,input.turn,input.thrust,input.fire,{controlSeq:seq,inputSessionId:c.inputSessionId,directFire:true});}
        else c.sendControl(input.turn,input.thrust,input.fire,{directFire:true});
      }
      const local=c.guestMotion.sample();
      if(local?.vy<-.01&&moved[label]===undefined)moved[label]=now-start;
    }
    if(fair)host.hostClientLink.flushInputs(now);
    engine.advance(now);host.pumpHostClient(now);
    for(const [label,index,c] of [['host',hostIndex,host],['guest',guestIndex,guest]]){
      if(engine.players.find(p=>p.index===index).vy<-.01&&applied[label]===undefined)applied[label]=now-start;
      const player=c.state?.players.find(p=>p.i===index);
      if(player&&c.guestMotion.projectiles(player,c.state.bullets,c.performance.now()).some(b=>b.predicted)&&shot[label]===undefined)shot[label]=now-fireAt;
      const sample=c.networkPlayback.sample(c.performance.now());
      if(sample&&now>5500)worldAges[label].push((engine.fxClock-sample.simTime)*1000);
    }
  }
  if(fair){
    assert.equal(hostDirect,0,'host controls and special actions have no direct authority shortcut');
    assert.ok(Math.abs(moved.host-moved.guest)<=1000/fps+.01,'host and guest own movement react within one display frame');
    assert.ok(Math.abs(applied.host-applied.guest)<=Math.max(1000/fps,1000/60)+.1,'authority applies both peers after comparable transit '+JSON.stringify({fps,latency,applied,delay:host.hostClientLink.delayMs,rtt:host.hostClientLink.stats.rttMs}));
    assert.ok(Number.isFinite(shot.host)&&Number.isFinite(shot.guest));
    assert.ok(Math.abs(shot.host-shot.guest)<=1000/fps+.01,'predicted shots appear on the same local command clock');
    const mean=a=>a.reduce((n,x)=>n+x,0)/a.length;
    assert.ok(Math.abs(mean(worldAges.host)-mean(worldAges.guest))<=1000/fps+10,'both views use comparable buffered world clocks '+JSON.stringify({fps,latency,hostIndex,host:mean(worldAges.host),guest:mean(worldAges.guest),delay:host.hostClientLink.delayMs,rtt:host.hostClientLink.stats.rttMs}));
    assert.ok(peerActions<=5,'RTT probes do not become a per-frame stream');
    const action=PROTOCOL.stamp({seriesId:series,hostEpoch:1,rankRound:1},{kind:'flare',actionId:1,inputSessionId:host.inputSessionId,simTime:engine.fxClock});
    host.pendingInputActions.push(action);const sentAt=now,delay=host.hostClientLink.delayMs;
    assert.equal(host.sendInputAction('flare',1,action),true);
    if(delay>1){now=sentAt+delay-1;host.hostClientLink.flushInputs(now);assert.equal(engine.controls.get(hostIndex).actionIds?.flare||0,0,'special actions cannot bypass the inbound queue');}
    now=sentAt+delay+.001;host.hostClientLink.flushInputs(now);
    assert.equal(engine.controls.get(hostIndex).actionIds.flare,1,'the normal authoritative action validator applies the delayed pulse');
    assert.equal(host.pendingInputActions.length,1,'a local action ACK also waits for outbound transport');
    now+=host.hostClientLink.delayMs+.001;host.hostClientLink.flushView(now);
    assert.equal(host.pendingInputActions.length,0,'the delivered ACK clears the normal client retry queue');
  }
  assert.ok(guestDirect>0);assert.ok(states<160,'authority snapshots stay near20Hz, including immediate shot states');
  return {fps,latency,hostIndex,fair,relay,moved,applied,shot,states,probes:peerActions,delay:host.hostClientLink?.delayMs};
}
// The real fallback publisher must tolerate frame jitter without halving20Hz.
{
 let time=1000;const sent=[];
 const relay=vm.createContext({fallbackPeers:new Set([1]),fallbackCodecPeers:new Map(),hostPhysics:{players:[{index:1,inputSessionId:'b'.repeat(32)}]},
  onlineSeriesId:series,hostEpoch:1,lastFallbackStateSentAt:0,FALLBACK_STATE_MS:50,performance:{now:()=>time},
  ws:{readyState:1,bufferedAmount:0},WebSocket:{OPEN:1},window:{},onlinePacket:p=>p,sendSocketRaw:(_ws,raw)=>{sent.push({at:time,body:JSON.parse(raw)});return true;}});
 vm.runInContext(fn('sendHostFallbackState'),relay);
 for(let i=0;i<200;i++){time=1000+i*50+(i%2?-1:1);relay.sendHostFallbackState({seq:i+1});}
 assert.ok(sent.length>=198&&sent.length<=200,'48/52ms arrival jitter must retain approximately20states/s');
 sent.length=0;relay.lastFallbackStateSentAt=0;
 for(let i=0;i<600;i++){time=20000+i*1000/60;relay.sendHostFallbackState({seq:i+1});}
 assert.ok(sent.length>=198&&sent.length<=202,'immediate shot publications must not increase sustained relay traffic beyond20Hz');
 relay.ws.bufferedAmount=200*1024;const count=sent.length;time+=500;assert.equal(relay.sendHostFallbackState({seq:999}),false);assert.equal(sent.length,count,'the existing backpressure bound remains enforced');
}
const cases=[];
for(const fps of [30,60,120])for(const latency of [0,40,75])cases.push(scenario({fps,latency}));
cases.push(scenario({fps:60,latency:40,hostIndex:2}));cases.push(scenario({fps:60,latency:40,relay:true}));
const baseline=scenario({fps:60,latency:40,fair:false});
assert.ok(baseline.applied.guest-baseline.applied.host>=33,'the fixture reproduces the old host input advantage');
console.log('Host client integration OK: real host engine and production routing, predicted motion/shots, local transport in both directions, metadata through compact packets, sparse RTT echoes over P2P/relay, migrated host index,20Hz states and old advantage reproduced.');
console.log(JSON.stringify({baseline,cases}));
