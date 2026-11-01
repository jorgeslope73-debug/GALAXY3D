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
function begin(f){const e=f.e,p=e.players[0];assert.equal(e.ufoLimit(),0,'Level two has no ambient UFOs during rival combat');p.kills=4;e.destroyShip(e.players[1],p);p.protection=1e6;p.x=p.px=100;p.y=p.py=100;assert.equal(e.finished,false);assert.equal(e.bossEncounter.type,'ufo-wave');assert.equal(e.bossEncounter.total,6);assert.equal(e.publicState().players.length,1);assert.equal(f.events.filter(m=>m.t==='victory').length,0);}
function step(e,seconds,dt=1/60){for(let t=0;t<seconds-dt/2&&!e.finished;t+=dt)e.update(dt);}
for(const dt of [1/30,1/60,1/120]){
  const f=fixture(),e=f.e;e.nextUfo=0;e.updateUfo(dt);assert.equal(ufos(e).length,0);begin(f);
  const births=[];let last=0;
  for(let t=0;t<23-dt/2;t+=dt){e.update(dt);if(f.made.length!==last){last=f.made.length;births.push(e.ufoActiveCount());}}
  assert.deepEqual(births,[1,2,3,4,5,6]);assert.equal(f.made.length,6);assert.equal(new Set(f.made.map(u=>u.id)).size,6);assert.deepEqual(f.made.map(u=>u.ordinal),[1,2,3,4,5,6]);
  assert.ok(Math.abs(e.bossEncounter.deadline-f.made[0].born-30)<1e-7,'Clock starts at the first entry');
  for(let i=1;i<f.made.length;i++)assert.ok(f.made[i].born-f.made[i-1].born>=4-1e-7);
  const victims=ufos(e).slice(0,3);for(const u of victims)assert.equal(e.destroyUfo(0,u),true);assert.equal(e.destroyUfo(0,victims[0]),false);assert.equal(e.bossEncounter.defeated,3);assert.equal(e.ufoActiveCount(),3);
  const ids=ufos(e).map(u=>u.id);step(e,4,dt);assert.deepEqual(ufos(e).map(u=>u.id),ids,'Survivors accumulate without replacements');assert.equal(f.made.length,6);assert.equal(e.finished,false);
  e.handleMessage({t:'restart',level:3});assert.equal(e.campaignLevel,2,'A live wave cannot be skipped');
  while(e.fxClock+dt<e.bossEncounter.deadline-1e-8)e.update(dt);
  assert.equal(e.finished,false);assert.ok(e.publicState().boss.remaining>0);e.update(dt);if(!e.finished)e.update(dt);
  assert.ok(e.fxClock-e.bossEncounter.deadline<dt+1e-7);assert.equal(e.finished,true);assert.equal(e.winner,-1);assert.equal(e.bossEncounter.phase,'failed');assert.equal(e.bossEncounter.escaped,3);assert.equal(e.ufoActiveCount(),0);assert.equal(e.publicState().boss.remaining,0);
  assert.equal(f.events.filter(m=>m.t==='victory').length,1);step(e,60,dt);e.updateCampaignBoss();assert.equal(f.made.length,6);assert.equal(f.events.filter(m=>m.t==='victory').length,1,'Timeout is terminal and emitted once');
  e.handleMessage({t:'restart',level:3});assert.equal(e.campaignLevel,2,'Escape cannot unlock the next world');e.handleMessage({t:'restart',level:1});assert.equal(e.campaignLevel,1);assert.equal(e.finished,false);assert.equal(e.bossEncounter,null);
}

{
  const f=fixture(),e=f.e;begin(f);
  for(let t=0;t<60&&!e.finished;t+=1/60){e.update(1/60);for(const u of ufos(e))e.destroyUfo(0,u);if(f.made.length<6)assert.equal(e.finished,false,'Clearing an early entry does not win before the remaining scheduled UFOs');}
  assert.equal(f.made.length,6);assert.equal(e.bossEncounter.defeated,6);assert.equal(e.finished,true);assert.equal(f.events.filter(m=>m.t==='victory').length,1);
}
{
  const f=fixture(),e=f.e;begin(f);step(e,23);
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
  const labels=[],colors=[],hud=vm.createContext({ctx:{save(){},restore(){},strokeText(){},fillText(...args){labels.push(args);colors.push(this.fillStyle);}},isMobile:false,W:1920,tr:(key,v)=>key==='ufoBossTime'?'TIEMPO: '+v.seconds+' S':v.count+'/'+v.total});vm.runInContext(source('drawUfoBossProgress'),hud);
  hud.drawUfoBossProgress({type:'ufo-wave',total:6,defeated:3,remaining:10.001});assert.deepEqual(labels.map(x=>x[0]),['3/6','TIEMPO: 11 S']);assert.ok(labels.every(x=>x[1]===960));assert.equal(colors[1],'#a5f7ff');labels.length=colors.length=0;
  hud.drawUfoBossProgress({type:'ufo-wave',total:6,defeated:3,remaining:9.1});assert.equal(labels[1][0],'TIEMPO: 10 S');assert.equal(colors[1],'#ff756b');

}
for(const dt of [1/30,1/60,1/120]){
  const f=fixture(),e=f.e;begin(f);
  for(let t=0;t<29&&!e.finished;t+=dt){e.update(dt);for(const u of ufos(e))e.destroyUfo(0,u);}
  assert.equal(e.bossEncounter.defeated,6);assert.equal(e.winner,0);assert.ok(e.fxClock<e.bossEncounter.deadline);
  e.handleMessage({t:'restart',level:3});assert.equal(e.campaignLevel,3);assert.equal(e.ufoLimit(),2);
}
{
  const f=fixture(),e=f.e;begin(f);step(e,23);for(const u of ufos(e).slice(0,5))e.destroyUfo(0,u);e.fxClock=e.bossEncounter.deadline-.001;e.destroyUfo(0,e.ufo);assert.equal(e.winner,0,'Last-moment kill wins before the deadline');e.update(1);assert.equal(e.bossEncounter.phase,'won');
}
{
  const f=fixture(),e=f.e;begin(f);e.players[0].spawnFx=100;e.fxClock+=5;e.updateCampaignBoss();assert.equal(e.bossEncounter.phase,'entering');assert.equal(e.bossEncounter.deadline,null);assert.equal(e.publicState().boss.remaining,30,'Readiness does not consume combat time');e.players[0].spawnFx=0;e.updateCampaignBoss();assert.equal(e.bossEncounter.deadline,e.fxClock+30);
}
const i18n=vm.createContext({window:{},localStorage:{getItem:()=> 'es'},document:{querySelectorAll:()=>[],getElementById:()=>null,documentElement:{}}});vm.runInContext(fs.readFileSync('docs/i18n.js','utf8'),i18n);const tr=i18n.window.GalaxyI18n.t;
assert.equal(tr('ufoBossEscaped'),'DEJASTE ESCAPAR AL ENEMIGO');assert.equal(tr('ufoBossTime',{seconds:30}),'TIEMPO: 30 S');
{
  const ui=()=>({textContent:'',disabled:false,style:{setProperty(){}},classList:{add(){},remove(){},contains:()=>false}}),elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,ui());return elements.get(id);};
  const c=vm.createContext({inGame:true,leaderAnnouncement:null,topbar:ui(),mobileControls:ui(),mobileExit:null,resetMobileTouchControls(){},state:{boss:{type:'ufo-wave',phase:'failed'},players:[]},lobbyPlayers:[],document:{getElementById:get},roomCode:'LOCAL',localCpuActive:true,localCampaignAwaitingContinue:false,localCampaignComplete:false,localCampaignGameOver:false,localCampaignLevel:2,LOCAL_CAMPAIGN_LEVELS:5,tr,playerColors:[],victory:ui(),resetVictoryJoystickControls(){},clearSeriesChampionPresentation(){},scheduleBossTravel(){}});
  vm.runInContext(source('showVictory'),c);c.showVictory(-1);assert.equal(get('victoryText').textContent,'DEJASTE ESCAPAR AL ENEMIGO');assert.equal(get('restartMatch').textContent,'VOLVER A EMPEZAR');assert.equal(c.localCampaignGameOver,true);
}
console.log('UFO boss OK: six unique entries, 30-second deadline from first spawn, no replacements, timed escape and one failure event, guarded restart, real projectile/flare hits, last-moment success, countdown HUD, exact failure message and automatic victory travel at 30/60/120Hz.');
