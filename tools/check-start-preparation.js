'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Gate=require('../docs/startup-preparation.js');
function clock(){let now=1000,id=0;const tasks=new Map();return {now:()=>now,schedule:(fn,ms)=>{tasks.set(++id,{fn,at:now+ms});return id;},cancel:i=>tasks.delete(i),advance(ms){const end=now+ms;while(true){const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();}now=end;},get pending(){return tasks.size;}};}
{
  const c=clock(),phases=[];let released=0;const gate=new Gate({...c,key:'LOCAL:1',authority:true,onChange:g=>phases.push(g.phase),onGo:()=>released++});gate.start();
  c.advance(6000);assert.equal(gate.phase,'preparing');assert.equal(released,0,'a long preparation cannot be bypassed by the timer');
  gate.markLocalReady();assert.equal(gate.phase,'countdown');c.advance(2999);assert.equal(gate.blocked,true);c.advance(1);assert.equal(gate.phase,'go');assert.equal(released,1);
  gate.release();assert.equal(released,1);assert.deepEqual(phases,['preparing','countdown','go'],'there are phase changes, not per-number messages');
}
{
  const c=clock(),gate=new Gate({...c,key:'ROOM:2',authority:true,peers:[1,3]});gate.markLocalReady();gate.peerReady(1);gate.peerReady(2);
  c.advance(15000);assert.equal(gate.phase,'preparing','a missing human keeps everyone in PREPARADOS');
  gate.peerReady(3);assert.equal(gate.phase,'countdown');c.advance(3000);assert.equal(gate.phase,'go');
}
{
  const c=clock(),gate=new Gate({...c,key:'ROOM:3',authority:true,peers:[1,2]});gate.markLocalReady();gate.peerReady(1);c.advance(3000);gate.setPeers([1]);assert.equal(gate.phase,'countdown','a departed player does not leave the room stuck');
  gate.cancel();c.advance(10000);assert.equal(gate.phase,'cancelled');assert.equal(c.pending,0,'leaving cancels the scheduled release');
}
{
  const c=clock(),guest=new Gate({...c,key:'ROOM:4'});guest.start();
  assert.equal(guest.apply({v:1,key:'OLD',phase:'go',remainingMs:0}),false);
  for(const remainingMs of [-1,Infinity,NaN,4000])assert.equal(guest.apply({v:1,key:'ROOM:4',phase:'countdown',remainingMs}),false);
  guest.markLocalReady();assert.equal(guest.apply({v:1,key:'ROOM:4',phase:'countdown',remainingMs:3000}),true);
  const deadline=guest.deadline;c.advance(1000);guest.apply({v:1,key:'ROOM:4',phase:'countdown',remainingMs:3000});assert.equal(guest.deadline,deadline,'a duplicate cannot restart a digit');
  c.advance(3000);assert.equal(guest.blocked,true,'the guest waits at zero until authority confirms GO');
  guest.apply({v:1,key:'ROOM:4',phase:'go',remainingMs:0});assert.equal(guest.phase,'go');assert.equal(guest.blocked,false);
  guest.apply({v:1,key:'ROOM:4',phase:'preparing',remainingMs:0});assert.equal(guest.phase,'go');
}
{
  const c=clock(),guest=new Gate({...c,key:'ROOM:5'});guest.apply({v:1,key:'ROOM:5',phase:'go',remainingMs:0});assert.equal(guest.phase,'preparing');guest.markLocalReady();assert.equal(guest.phase,'go','a delayed local load still finishes before controls are released');
}
const source=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
function extract(name){const a=source.indexOf('  function '+name+'('),b=source.indexOf('\n  function ',a+1);assert.ok(a>=0&&b>a);return source.slice(a,b);}
for(const index of [0,1]){
  const text=[],points=[],ctx={save(){},restore(){},translate(x,y){points.push([x,y]);},scale(){},beginPath(){},arc(){},stroke(){},strokeText(){},measureText(){return {width:80};},fillText(v){text.push(v);}};
  const players=[{i:0,x:450,y:400},{i:1,x:1450,y:750}],snapshot={players,finished:false};
  const view=vm.createContext({ctx,W:1920,H:1080,inGame:true,myIndex:index,state:snapshot,localEntryVisual:null,isMobile:false,playerRgb:[[0,180,255],[255,30,180]],clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),matchStartGate:{key:'ROOM:6',phase:'countdown',deadline:4000,goAt:0}});
  vm.runInContext(extract('drawSpawnCountdownMarker')+extract('drawLocalEntryCountdown'),view);
  for(const t of [1000,2000,3000,4000])view.drawLocalEntryCountdown(t);
  assert.deepEqual(text,['3','2','1','0']);assert.ok(points.every(([x,y])=>x===players[index].x&&y===players[index].y),'each machine draws only its own initial position');
  view.matchStartGate.phase='go';view.matchStartGate.goAt=4000;const previous=text.length;view.drawLocalEntryCountdown(4280);assert.equal(text.length,previous);
}
const build=fs.readFileSync('docs/build-version.js','utf8'),index=fs.readFileSync('docs/index.html','utf8');
// Run the real online background selector/compositor on both rendering paths.
for(const mobile of [false,true])for(const reduced of [false,true]){
  const draws=[],snapshots=[];
  const backgrounds=Array.from({length:5},(_,i)=>({file:'world'+i+'.jpg',mobileKey:'bg'+i}));
  const images=Object.fromEntries(backgrounds.map((b,i)=>[b.mobileKey,{id:i,complete:true}]));
  const c=vm.createContext({MATCH_BACKGROUNDS:backgrounds,images,roomCode:'ROOM',onlineStartPending:true,
    currentMatchBackground:0,currentMatchBackgroundRound:0,matchBackgroundCursor:0,
    useStaticPcBackground:!mobile,canvas:{width:1280,height:720,style:{}},W:1920,H:1080,
    backgroundCache:null,backgroundCacheW:0,backgroundCacheH:0,rebuildBackgroundCache(){},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),imageReady:im=>!!im?.complete,
    ctx:{save(){},restore(){},drawImage(im,...args){draws.push({im,args,alpha:this.globalAlpha});}},
    window:{matchMedia:()=>({matches:reduced})},document:{createElement(){
      const calls=[],g={drawImage(im){calls.push({im,alpha:this.globalAlpha??1});}};
      const layer={calls,getContext:()=>g};snapshots.push(layer);return layer;
    }}
  });
  vm.runInContext('let onlineBackgroundTransition=null;'+extract('beginOnlineBackgroundTransition')+extract('drawOnlineBackgroundTransition')+extract('applyMatchBackground')+extract('selectMatchBackgroundForRound'),c);
  c.selectMatchBackgroundForRound(1);assert.equal(snapshots.length,0,'first entry does not cover the lobby');
  c.selectMatchBackgroundForRound(2);assert.equal(snapshots.length,1);assert.equal(c.currentMatchBackground,1);
  c.drawOnlineBackgroundTransition(0);c.drawOnlineBackgroundTransition(8000);
  assert.equal(draws.at(-1).alpha,1,'a slow local/peer preparation keeps the previous background visible');
  c.selectMatchBackgroundForRound(2);assert.equal(snapshots.length,1,'duplicate starts/snapshots do not restart the blend');
  c.onlineStartPending=false;c.drawOnlineBackgroundTransition(9000);
  const duration=reduced?300:600;c.drawOnlineBackgroundTransition(9000+duration/2);
  assert.equal(draws.at(-1).alpha,.5,'old and new backgrounds blend at half opacity');
  c.selectMatchBackgroundForRound(3);assert.equal(snapshots[1].calls[1].alpha,.5,'an interrupted fade captures its visible mixture');
  c.drawOnlineBackgroundTransition(10000);c.drawOnlineBackgroundTransition(10000+duration);
  const count=draws.length;c.drawOnlineBackgroundTransition(20000);assert.equal(draws.length,count,'no background copy remains after the fade');
  c.selectMatchBackgroundForRound(4);c.roomCode='';c.drawOnlineBackgroundTransition(21000);
  assert.equal(vm.runInContext('onlineBackgroundTransition',c),null,'leaving discards the previous online background');
  c.roomCode='LOCAL';c.selectMatchBackgroundForRound(5);assert.equal(snapshots.length,3,'CPU travel keeps its own transition');
}
{
  const a=source.indexOf('      const incomingEpoch=Number(m.hostEpoch)'),b=source.indexOf('      const now=performance.now();',a);
  const selected=[],c=vm.createContext({lastAcceptedStateEpoch:2,lastAcceptedStateRound:3,lastAcceptedStateSeq:10,state:{round:3},roomCode:'ROOM',currentMatchBackgroundRound:3,
    handle(){assert.fail('stale snapshots cannot restart a round');},selectMatchBackgroundForRound:r=>selected.push(r)});
  vm.runInContext('function receive(m){'+source.slice(a,b)+'}',c);
  for(const [epoch,round,seq]of [[2,2,999],[2,3,9],[1,4,1]])c.receive({hostEpoch:epoch,round,seq});
  assert.deepEqual(selected,[],'out-of-order snapshots cannot restore an old background');
}
assert.ok(build.indexOf("'startup-preparation.js'")<build.indexOf("'game.js'"));assert.ok(index.indexOf('src="startup-preparation.js')<index.indexOf('src="game.js'));
(async()=>{
  // Exercise the real travel/fade lifecycle, including slow preparation and exit races.
  for(const mobile of [false,true])for(const reduced of [false,true]){
    let now=0,id=0;const frames=new Map(),loads=[],fills=[];
    const g={setTransform(){},save(){},restore(){},translate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},fillText(){},fillRect(){fills.push(this.fillStyle);}};
    const layer={style:{},dataset:{},setAttribute(){},getContext:()=>g};
    const c=vm.createContext({isMobile:mobile,performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:i=>frames.delete(i),clearTimeout(){},
      document:{createElement:()=>layer,body:{appendChild(){}},documentElement:{clientWidth:1280,clientHeight:720}},window:{innerWidth:1280,innerHeight:720,devicePixelRatio:1,matchMedia:()=>({matches:reduced})},
      victory:{classList:{add(){}}},localCampaignConfig:()=>({background:{mobileKey:'bg04',file:'world4.jpg'}}),assetList:{},loadGameImage:(...args)=>{loads.push(args);return Promise.resolve(true);},tr:()=> 'DESTINO',localCampaignWorldName:()=> 'ABISMO'});
    const stateAt=source.indexOf('  let interstellarTravelCanvas='),stateEnd=source.indexOf('  function scheduleBossTravel(',stateAt);
    vm.runInContext(source.slice(stateAt,stateEnd)+extract('ensureInterstellarTravelCanvas')+extract('cancelInterstellarTravel')+extract('revealInterstellarTravel')+extract('runInterstellarTravel'),c);
    const advance=ms=>{now+=ms;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(now);};
    const travel=c.runInterstellarTravel(4);assert.equal(layer.style.opacity,'0','travel enters by fading over the old scene');
    advance(reduced?35:100);assert.ok(Number(layer.style.opacity)>0&&Number(layer.style.opacity)<1);
    advance(3000);assert.equal(await travel,true);assert.equal(layer.dataset.phase,'waiting');assert.equal(layer.style.display,'block');assert.equal(layer.style.opacity,'1');
    advance(8000);assert.equal(layer.style.display,'block','a slow destination stays covered until readiness');
    assert.deepEqual(loads[0],['bg04','world4.jpg'],'destination preload starts during travel');assert.ok(!fills.includes('#ffffff'),'no hard white flash at the handoff');
    c.revealInterstellarTravel();const duration=reduced?300:600;advance(duration/2);
    assert.ok(Number(layer.style.opacity)>.49&&Number(layer.style.opacity)<.51,'the destination is visible halfway through the blend');
    c.revealInterstellarTravel();assert.equal(frames.size,1,'duplicate readiness cannot restart the fade');
    advance(duration/2);assert.equal(layer.style.display,'none');assert.equal(layer.style.willChange,'');assert.equal(frames.size,0);
    const cancelled=c.runInterstellarTravel(4),stale=[...frames.values()][0];c.cancelInterstellarTravel();assert.equal(await cancelled,false);
    const next=c.runInterstellarTravel(4);stale(now+5000);assert.equal(layer.dataset.phase,'travel');assert.equal(frames.size,1,'stale callbacks cannot cancel a newer scene transition');
    advance(3000);assert.equal(await next,true);c.revealInterstellarTravel();advance(duration/4);
    const staleFade=[...frames.values()][0];c.cancelInterstellarTravel();assert.equal(layer.style.display,'none');assert.equal(frames.size,0);
    const last=c.runInterstellarTravel(4);staleFade(now+5000);assert.equal(layer.dataset.phase,'travel','a cancelled reveal cannot hide the next transition');c.cancelInterstellarTravel();assert.equal(await last,false);
  }
  const {engineContext}=require('./check-session-regressions.js');
  for(const [name,mode] of [['GalaxyLocalCpu','cpu'],['GalaxyHostPhysics','host']]){
    const contexts=[engineContext(),engineContext()];
    for(const c of contexts){
      vm.runInContext('let seed=123456; Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};',c);
      vm.runInContext(fs.readFileSync('docs/startup-preparation.js','utf8'),c);
      c.Engine=c.window[name];
      vm.runInContext("var real=new Engine({}); if('"+mode+"'==='host')real.start([{i:0,n:'REAL'},{i:1,n:'CPU',cpu:true}]);else real.start('REAL','facil',1,null,false,1);",c);
    }
    const [test,control]=contexts,before=JSON.stringify(test.real),random=vm.runInContext('Math.random',test);
    let frames=0;
    const task=test.GalaxyStartPreparation.warmSimulation(test.Engine,{mode,frame:async()=>{frames++;}});
    assert.equal(test.GalaxyStartPreparation.warmSimulation(test.Engine,{mode}),task,'reuse one warmup per engine and difficulty');
    assert.equal(await task,true);assert.equal(frames,12);
    assert.equal(JSON.stringify(test.real),before,'shadow warmup cannot advance the real match');
    assert.equal(vm.runInContext('Math.random',test),random,'restore RNG after each synchronous batch');
    for(const c of contexts)vm.runInContext('real.spawnAsteroidFromEdge(2,true);',c);
    assert.equal(JSON.stringify(test.real.asteroids),JSON.stringify(control.real.asteroids),'real entity IDs, positions and random draws are untouched');
    assert.equal(test.real.fxClock,0);assert.equal(test.real.tickCount,0);
  }
  let stopped=0,ticks=0,frames=0;
  class Shadow{
    static withPreparationIds(cursor,work){return {value:work(),cursor};}
    start(){this.players=[];}update(){ticks++;}stop(){stopped++;}
  }
  assert.equal(await Gate.warmSimulation(Shadow,{valid:()=>frames===0,frame:async()=>{frames++;}}),false);
  assert.equal(ticks,10);assert.equal(stopped,1,'leaving cancels and stops the shadow motor');
  await assert.rejects(Gate.warmSimulation(Shadow,{frame:async()=>{throw Error('frame cancelled');}}));
  assert.equal(stopped,2,'errors also stop the motor and invalidate the cache');
  assert.equal(await Gate.warmSimulation(Shadow,{frame:async()=>{}}),true);
  console.log('Start preparation OK: long loads, phase crossfades, stale-frame/exit cancellation, human readiness, confirmed authority, private initial countdown, runtime/cache ordering and isolated simulation warmup preserving state, IDs and RNG.');
})().catch(error=>{console.error(error);process.exitCode=1;});
