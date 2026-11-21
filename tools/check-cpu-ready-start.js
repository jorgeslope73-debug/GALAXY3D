'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const clock={now:1000000},c=engineContext(clock),events=[],states=[];
 vm.runInContext('let readySeed=72831;Math.random=()=>{readySeed=(Math.imul(readySeed,1664525)+1013904223)>>>0;return readySeed/4294967296;};',c);
 const e=new c.window.GalaxyLocalCpu({onState:s=>states.push(s),onEvent:s=>events.push(s),renderEveryStep:true});
 e.start('READY','medio',1,null,false,1);
 return {e,p:e.players[0],c,clock,events,states};
}
for(const hz of [30,60,120]){
 const {e,p,states}=fixture(),start=1000,from={x:p.x,y:p.y,r:p.rot};
 assert.ok(e.players.every(p=>p.spawnFx===1.15));
 assert.equal(e.releasePreparedStart(start),true);
 assert.ok(e.players.every(p=>p.spawnFx===0&&p.protection===3),'all initial ships are ready with their full protection');
 assert.equal(e.lastNow,start);assert.equal(e.accumulator,0);assert.equal(e.fxClock,0);assert.equal(states.length,0,'the engine release does not publish or advance physics itself');
 e.setControl(1,true,true,{directFire:true});
 // At 120 Hz the first RAF has no 60 Hz physics tick. The first actual tick
 // must already apply the held movement and shot, rather than waiting 1.15s.
 for(let frame=1;frame<=4&&e.tickCount===0;frame++)e.advance(start+frame*1000/hz);
 assert.ok(e.tickCount>0);assert.ok(e.tickCount<=2);assert.equal(p.spawnFx,0);
 assert.ok(Math.hypot(p.vx,p.vy)>0&&Math.hypot(p.x-from.x,p.y-from.y)>0,'thrust moves on the first post-GO physics tick at '+hz+' Hz');
 assert.notEqual(p.rot,from.r,'held turn applies immediately');assert.equal(p.bullets,4,'held direct fire consumes a bullet immediately');
 assert.ok(states.length>0&&states.at(-1).players[0].spawnFx===0);
 const last=e.lastNow,accumulator=e.accumulator;assert.equal(e.releasePreparedStart(last+5000),false,'duplicate release cannot rewind the clock');assert.equal(e.lastNow,last);assert.equal(e.accumulator,accumulator);
}
{
 const test=fixture(),control=fixture(),e=test.e,p=test.p;
 Object.assign(p,{bullets:9,reload:.7,shield:8,camo:6,flare:2,guidedAmmo:2,guided:true,speed:1.5});
 Object.assign(control.p,{bullets:9,reload:.7,shield:8,camo:6,flare:2,guidedAmmo:2,guided:true,speed:1.5});
 e.lastNow=80;e.accumulator=11;
 const before=copy(e),controls=copy([...e.controls]);
 assert.equal(e.releasePreparedStart(6000),true);
 const after=copy(e);
 for(const value of [before,after]){delete value.preparedStartReleased;delete value.lastNow;delete value.accumulator;for(const player of value.players)delete player.spawnFx;}
 assert.deepEqual(after,before,'release changes only initial materialization and the frame-clock baseline');
 assert.deepEqual(copy([...e.controls]),controls);assert.equal(test.events.length,0);assert.equal(test.states.length,0);
 e.deployFlares(p);control.e.deployFlares(control.p);
 assert.deepEqual(copy(e.flares),copy(control.e.flares),'release consumes neither entity IDs nor random numbers');
 assert.equal(vm.runInContext('Math.random()',test.c),vm.runInContext('Math.random()',control.c));
}
{
 const {e,p}=fixture();
 for(const now of [NaN,Infinity,-1,0])assert.equal(e.releasePreparedStart(now),false,'invalid frame clocks cannot release initial controls');
 assert.equal(p.spawnFx,1.15);
 e.update(1/60);const fx=p.spawnFx,last=e.lastNow;assert.equal(e.releasePreparedStart(1000),false,'a late caller cannot skip materialization after simulation has begun');assert.equal(p.spawnFx,fx);assert.equal(e.lastNow,last);
}
{
 const {e,p}=fixture();e.releasePreparedStart(1000);p.protection=0;e.destroyShip(p);
 assert.equal(p.dead,true);assert.equal(e.releasePreparedStart(2000),false);
 for(let tick=0;tick<180;tick++)e.update(1/60);
 assert.equal(p.dead,false);assert.equal(p.spawnFx,1.15,'normal deaths retain the existing materialization after their three-second countdown');
 assert.equal(e.releasePreparedStart(5000),false);assert.equal(p.spawnFx,1.15);
 e.setControl(1,true,false);const x=p.x,y=p.y,r=p.rot;e.update(1/60);assert.equal(p.x,x);assert.equal(p.y,y);assert.equal(p.rot,r,'respawn still blocks inputs while materializing');
 e.finished=true;assert.equal(e.restart(),true);assert.equal(e.preparedStartReleased,false);assert.equal(p.deaths,0);
 assert.equal(e.releasePreparedStart(10000),true,'a new round gets its own one-time release');assert.equal(p.spawnFx,0);
}
{
 const {e}=fixture();e.startTraining();assert.equal(e.releasePreparedStart(1000),false,'CPU training keeps its existing spawn rules');assert.ok(e.players.every(p=>p.spawnFx===1.15));
 e.stop();assert.equal(e.releasePreparedStart(2000),false);
}
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
const a=game.indexOf('  function launchOnlineAfterReady('),b=game.indexOf('  function publishStartPreparation(',a);assert.ok(a>=0&&b>a);
for(const phase of ['preparing','countdown','go']){
 const f=fixture(),published=[],ui=[],scope={inGame:true,onlineGoAt:1000,onlineStartTimer:1,roomCode:'LOCAL',localCpuActive:true,localCpu:f.e,matchStartGate:{phase},performance:{now:()=>1000},isHost:false,hostPhysics:null,
  activeHostClient:()=>false,activateGameUi:()=>ui.push('ready'),playSound:kind=>ui.push(kind),handle:(snapshot,engine)=>published.push({snapshot,engine})};
 vm.runInNewContext(game.slice(a,b),scope);scope.launchOnlineAfterReady();
 if(phase==='go'){
  assert.equal(published.length,1);assert.equal(published[0].engine,f.e);assert.ok(published[0].snapshot.players.every(p=>p.spawnFx===0&&p.prot===3),'the first visible GO snapshot is already controllable');
  scope.launchOnlineAfterReady();assert.equal(published.length,1,'duplicate GO callbacks do not republish a second release');
 }else{assert.equal(published.length,0);assert.ok(f.e.players.every(p=>p.spawnFx===1.15),'preparing/countdown callers cannot release controls');}
}
{
 const f=fixture(),scope={inGame:true,onlineGoAt:1000,onlineStartTimer:1,roomCode:'ROOM',localCpuActive:false,localCpu:{releasePreparedStart(){assert.fail('online must not use local startup release');}},isHost:false,hostPhysics:null,activeHostClient:()=>false,activateGameUi(){},playSound(){}};
 vm.runInNewContext(game.slice(a,b),scope);scope.launchOnlineAfterReady();assert.equal(f.p.spawnFx,1.15);
}
console.log('CPU ready start OK: held thrust/turn/fire work on the first post-GO tick at 30/60/120Hz; one-time round release preserves protection, equipment, RNG/IDs, respawns, training and online startup.');
