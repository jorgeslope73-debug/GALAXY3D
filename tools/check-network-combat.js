'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const c=engineContext(),core=c.window.GalaxyPhysicsCore;
vm.runInContext(fs.readFileSync('docs/network-playback.js','utf8'),c);
const Playback=c.window.GalaxyNetworkPlayback,DT=1/60;
const playbackCases=[];
for(const fps of [30,60,120])for(const loss of [0,7]){
 const p=new Playback(),q=[];let next=0,previous=null,maxStep=0,maxBuffer=0,arrivalJump=0;
 for(let n=0;n<200;n++)if(!loss||n%loss!==0)q.push({at:1000+n*50+80+[0,40,-20,80,10,-30,30,120][n%8],state:{code:'TEST',seriesId:'s',hostEpoch:1,round:1,seq:n+1,simTime:n*.05,players:[{i:1,x:100+n*16.5,y:500,r:0}]}});
 q.sort((a,b)=>a.at-b.at);
 for(let now=1000;now<=11200;now+=1000/fps){
  const before=p.sample(now);
  while(next<q.length&&q[next].at<=now){p.push(q[next].state,q[next].at);next++;}
  const shown=p.sample(now);if(!shown)continue;
  if(before)arrivalJump=Math.max(arrivalJump,Math.abs(shown.simTime-before.simTime)*1000);
  if(previous){assert.ok(shown.simTime>=previous.simTime);maxStep=Math.max(maxStep,(shown.simTime-previous.simTime)*1000);}
  maxBuffer=Math.max(maxBuffer,shown.buffered);assert.equal(shown.resynced,false,'ordinary late/reordered/lost states do not teleport the world');
  assert.ok(p.snapshots.length<=12);previous=shown;
 }
 assert.ok(arrivalJump<1e-6,'packet arrival cannot move the visible clock at '+fps+' Hz, loss '+loss);
 assert.ok(maxStep<=1000/fps*1.16+1e-6,'ordinary loss catches up at a bounded speed, not in one large jump');
 assert.ok(maxBuffer<=240+1e-6,'short-gap headroom stays bounded');
 playbackCases.push({fps,loss,maxArrivalJumpMs:+arrivalJump.toFixed(6),maxFrameStepMs:+maxStep.toFixed(3)});
}
// Severe stalls retain a bounded resynchronization, rather than accumulating
// old play for seconds. This does not alter packet or input schemas.
const recovery=new Playback();
const state=(seq,simTime)=>({code:'R',seriesId:'s',hostEpoch:1,round:1,seq,simTime,players:[]});
recovery.push(state(1,0),1000);recovery.sample(1050);recovery.push(state(2,.8),1800);
const resumed=recovery.sample(1800);assert.ok(resumed.buffered<=180);assert.equal(resumed.resynced,true);
let hitCases=0;
for(const owner of [0,1,2,3])for(const missing of [0,1,2])for(const cadence of [30,1]){
 const e=new c.window.GalaxyHostPhysics({code:'TEST',seriesId:'a'.repeat(32)});
 e.players=[0,1,2,3].map(i=>Object.assign(e.makePlayer(i,'J'+i,false),{x:100+i*550,y:900,px:100+i*550,py:900,rot:0,pr:0,bank:0,pbank:0,shield:0,protection:0,spawnFx:0,deaths:0,inputSessionId:String(i),motionStream:core.createMotionStream(4+i)}));
 Object.assign(e,{asteroids:[],meteors:[],flares:[],pickups:[],bullets:[],ufo:null,giant:null,activeShockwaves:[]});
 const target=e.players[(owner+1)%4],pilot=e.players[owner];
 for(let tick=0;tick<=30;tick++){e.fxClock=tick/60;target.x=500+800*(e.fxClock-.4);target.y=500;target.px=target.x;target.py=target.y;e.shotHistory.capture(e);}
 Object.assign(pilot,{x:500,y:560,px:500,py:560,bullets:5,cadence,reload:0,guided:false,guidedAmmo:0});
 const stream=pilot.motionStream,viewTime=.4-missing*DT;
 assert.equal(core.acceptMotionFrames(stream,{v:1,epoch:stream.epoch,frames:[[1,0,0,1,1],[2,0,0,1,1],[3,0,0,1,1]],viewTime}),true);
 let control;for(let tick=0;tick<3+missing;tick++)control=core.consumeMotionFrame(stream);
 assert.equal(stream.missing,missing);
 const shot=core.tryFireProjectile(pilot,{x:0,y:-1},true,false,true,false,e.players,()=>({x:0,y:-1}),()=>42);
 assert.ok(shot);assert.equal(pilot.bullets,4,'only the authority spends ammunition');
 e.shotHistory.stamp(shot,pilot,control,e.fxClock);
 assert.ok(Math.abs(shot.lagOffset-.1)<1e-9,'short missing commands retain the same bounded viewing offset');
 assert.equal(shot.st,3+missing);assert.equal(shot.se,stream.epoch);
 assert.equal(e.queryProjectileShipHit({...shot,lagOffset:undefined}),null,'the moving target has already left the current hit position');
 e.bullets=[shot];e.updateBullets(DT);
 assert.equal(target.dead,true,'the real fired shot hits the visible historical hull for every player, normal/max cadence and brief loss');
 assert.equal(pilot.kills,1);assert.equal(e.bullets.length,0);e.updateBullets(DT);assert.equal(pilot.kills,1,'confirmation never duplicates damage');hitCases++;
 for(const gap of [3,6,7]){stream.missing=gap;const stale={guided:false};e.shotHistory.stamp(stale,pilot,control,e.fxClock);assert.equal(stale.lagOffset,undefined,'long gaps keep the ordinary collision path');}
}
for(const name of ['shot-history','network-playback','startup-preparation'])assert.ok(fs.readFileSync('docs/prueba-nucleo.js','utf8').replaceAll('\r\n','\n').includes(fs.readFileSync('docs/'+name+'.js','utf8').replaceAll('\r\n','\n').trim()),'practice module synchronized: '+name);
console.log('Network combat OK: smooth late/reordered states with one-in-seven loss at30/60/120Hz; severe-loss recovery stays bounded; '+hitCases+' actual authority shots hit a moving hull for all four players at standard/max cadence with0/1/2 missing command ticks.');
console.log(JSON.stringify(playbackCases));
