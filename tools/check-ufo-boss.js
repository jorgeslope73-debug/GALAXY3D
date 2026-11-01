'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  let seed=13;const math=Object.create(Math);math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const events=[],ctx=vm.createContext({window:{},Math:math,console,Date,performance,setTimeout,clearTimeout});
  for(const name of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','shot-history','host-physics','local-cpu'])vm.runInContext(fs.readFileSync('docs/'+name+'.js','utf8'),ctx,{filename:name+'.js'});
  const e=new ctx.window.GalaxyLocalCpu({onEvent:m=>events.push(m)});e.start('P','medio',3,null,false,2);e.asteroids=[];e.updateAsteroids=()=>{};
  for(const p of e.players){p.spawnFx=0;p.shield=0;p.protection=0;}
  const made=[],spawn=e.spawnUfo;
  e.spawnUfo=function(options){const before=new Set(ufos(e));const ok=spawn.call(this,options);if(ok){const u=ufos(e).find(u=>!before.has(u));made.push({id:u.id,born:e.fxClock,ordinal:u.bossOrdinal});}return ok;};
  return {e,events,made,ctx};
}
function ufos(e){return e.ufo?[e.ufo,...e.ufoExtras]:[...e.ufoExtras];}
function begin(f){const e=f.e,p=e.players[0];assert.equal(e.ufoLimit(),0,'Level two has no ambient UFOs during rival combat');p.kills=4;e.destroyShip(e.players[1],p);p.protection=1e6;p.x=p.px=100;p.y=p.py=100;assert.equal(e.finished,false);assert.equal(e.bossEncounter.type,'ufo-wave');assert.equal(e.bossEncounter.total,10);assert.equal(e.publicState().players.length,1);assert.equal(f.events.filter(m=>m.t==='victory').length,0);}
function step(e,seconds,dt=1/60){for(let t=0;t<seconds-dt/2&&!e.finished;t+=dt)e.update(dt);}
for(const dt of [1/30,1/60,1/120]){
  const f=fixture(),e=f.e;
  e.nextUfo=0;e.updateUfo(dt);assert.equal(ufos(e).length,0,'No UFO arrives before winning against rivals');begin(f);
  const births=[];let last=0;
  for(let t=0;t<60-dt/2;t+=dt){e.update(dt);if(f.made.length!==last){last=f.made.length;births.push(e.ufoActiveCount());}}
  assert.deepEqual(births,[1,2,3,4,5,6,7,8,9,10],'Each scheduled entry adds exactly one unique UFO');
  assert.equal(f.made.length,10);assert.equal(new Set(f.made.map(u=>u.id)).size,10);assert.deepEqual(f.made.map(u=>u.ordinal),[1,2,3,4,5,6,7,8,9,10]);
  for(let i=1;i<f.made.length;i++)assert.ok(f.made[i].born-f.made[i-1].born>=4-1e-7,'New enemies are four seconds apart, without catch-up swarms');
  assert.equal(e.ufoActiveCount(),10);assert.equal(e.finished,false);assert.equal(e.bossEncounter.defeated,0);assert.ok(ufos(e).every(u=>!u.exiting));
  const ids=ufos(e).map(u=>u.id).sort((a,b)=>a-b);step(e,60,dt);assert.deepEqual(ufos(e).map(u=>u.id).sort((a,b)=>a-b),ids,'The same survivors remain beyond their old 24-second retirement');assert.equal(f.made.length,10);
  const victims=ufos(e).slice(0,3);for(const u of victims)assert.equal(e.destroyUfo(0,u),true);assert.equal(e.bossEncounter.defeated,3);assert.equal(e.ufoActiveCount(),7);assert.equal(e.destroyUfo(0,victims[0]),false);assert.equal(e.bossEncounter.defeated,3,'A dead UFO cannot be counted twice');
  step(e,30,dt);assert.equal(f.made.length,10);assert.equal(e.ufoActiveCount(),7,'Killed UFOs are never replaced');assert.equal(e.publicState().boss.spawned,10);assert.equal(e.publicState().boss.defeated,3);
  e.handleMessage({t:'restart',level:3});assert.equal(e.campaignLevel,2);assert.equal(e.finished,false,'Survivors block the next world');
  for(const u of ufos(e))e.destroyUfo(0,u);assert.equal(e.bossEncounter.defeated,10);assert.equal(e.finished,true);assert.equal(e.winner,0);assert.equal(e.bossEncounter.phase,'won');assert.equal(e.ufoActiveCount(),0);assert.equal(f.events.filter(m=>m.t==='victory').length,1);assert.equal(e.players[0].kills,5);
  e.handleMessage({t:'restart',level:3});assert.equal(e.campaignLevel,3);assert.equal(e.finished,false);assert.equal(e.bossEncounter,null);assert.equal(e.ufoLimit(),2,'Later levels keep their existing ambient encounters');
}
{
  const f=fixture(),e=f.e;begin(f);
  for(let t=0;t<60&&!e.finished;t+=1/60){e.update(1/60);for(const u of ufos(e))e.destroyUfo(0,u);if(f.made.length<10)assert.equal(e.finished,false,'Clearing an early entry does not win before the remaining scheduled UFOs');}
  assert.equal(f.made.length,10);assert.equal(e.bossEncounter.defeated,10);assert.equal(e.finished,true);assert.equal(f.events.filter(m=>m.t==='victory').length,1);
}
{
  const f=fixture(),e=f.e;begin(f);step(e,42);
  function place(target){for(const [i,u]of ufos(e).entries()){u.x=u.px=1500;u.y=u.py=100+i*70;u.vx=u.vy=0;}target.x=target.px=960;target.y=target.py=540;e.bullets=[];e.flares=[];}
  function fire(target,guided){place(target);e.bullets=[{id:999,owner:0,x:700,y:540,vx:24000,vy:0,guided,target:-1,age:0,travel:0}];e.updateBullets(1/60);e.updateExtraUfoProjectileHits();assert.equal(e.isUfoActive(target),false);assert.equal(e.bullets.length,0,'A swept shot is consumed once by its UFO hit');}
  fire(e.ufo,false);assert.equal(e.bossEncounter.defeated,1,'Canonical primary-UFO bullet impacts count');fire(e.ufoExtras[e.ufoExtras.length-1],true);assert.equal(e.bossEncounter.defeated,2,'Extra-UFO missile impacts count');
  const target=e.ufoExtras[1];place(target);e.flares=[{id:998,owner:0,x:960,y:540,px:960,py:540,life:3}];e.updateSingleUfo(target,0);assert.equal(e.isUfoActive(target),false);assert.equal(e.bossEncounter.defeated,3,'Flare impacts use the same permanent kill counter');
  const first=e.ufo,second=e.ufoExtras[0];first.x=960;first.y=540;second.x=1100;second.y=540;
  const roster=e.bossCombatTargets(e.players[0]),firstIndex=roster.find(p=>p.x===960).index,secondIndex=roster.find(p=>p.x===1100).index;
  e.destroyUfo(0,first);const promoted=e.bossCombatTargets(e.players[0]);assert.ok(!promoted.some(p=>p.index===firstIndex));assert.equal(promoted.find(p=>p.x===1100).index,secondIndex,'Missile target identity is stable when another UFO becomes primary');
  const b={guided:true,target:secondIndex,decoyed:false,flareTarget:-1,x:900,y:200,vx:400,vy:0};e.bullets=[b];e.guideBossMissiles(1/60);assert.ok(b.vy>0);assert.ok(Math.abs(Math.hypot(b.vx,b.vy)-400)<1e-7);
}
{
  const f=fixture(),e=f.e;e.players[1].kills=4;e.destroyShip(e.players[0],e.players[1]);assert.equal(e.finished,true);assert.equal(e.bossEncounter,null,'A CPU victory does not start a human boss encounter');
  e.startTraining();assert.equal(e.ufoLimit(),0);assert.equal(e.needsUfoBoss(),false);assert.equal(e.bossEncounter,null);
}
// The existing automatic travel mechanism advances the completed UFO stage to level three.
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
function source(name){const a=game.indexOf('  function '+name+'('),b=game.indexOf('\n  }',a);assert.ok(a>=0&&b>a);return game.slice(a,b+4);}
{
  let callback,clicks=0;const engine={},button={disabled:false,click(){clicks++;}},c=vm.createContext({localCpuActive:true,localCpu:engine,state:{boss:{type:'ufo-wave',phase:'won'}},localCampaignAwaitingContinue:true,localCampaignLevel:2,roomCode:'LOCAL',inGame:false,victory:{classList:{contains:()=>false}},bossTravelTimer:null,setTimeout:fn=>{callback=fn;return 1;},clearTimeout(){}});
  vm.runInContext(source('scheduleBossTravel'),c);c.scheduleBossTravel(button);assert.ok(callback);callback();assert.equal(clicks,1);
  const labels=[],hud=vm.createContext({ctx:{save(){},restore(){},strokeText(){},fillText:(...args)=>labels.push(args)},isMobile:false,W:1920,tr:(key,v)=>`${v.count}/${v.total}`});vm.runInContext(source('drawUfoBossProgress'),hud);hud.drawUfoBossProgress({type:'ufo-wave',total:10,defeated:3});assert.equal(labels[0][0],'3/10');assert.equal(labels[0][1],960);
}
console.log('UFO boss OK: level-two win gate, 10 unique staggered entries, persistent survivors, no replacements after kills, real bullet/missile/flare counts, stable missile targets, progression lock, HUD and existing automatic travel; 30/60/120Hz.');
