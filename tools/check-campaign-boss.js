'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function world(){
  const random=Object.create(Math),events=[];
  const ctx=vm.createContext({window:{},console,Math:random,Date,performance,setTimeout,clearTimeout});
  for(const name of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','shot-history','host-physics','local-cpu'])vm.runInContext(fs.readFileSync('docs/'+name+'.js','utf8'),ctx,{filename:name+'.js'});
  const engine=new ctx.window.GalaxyLocalCpu({onEvent:e=>events.push(e)});engine.start('PILOT','medio',3,null,false,1);
  engine.updateAsteroids=()=>{};engine.asteroids=[];
  for(const p of engine.players){p.spawnFx=0;p.protection=0;p.shield=0;}
  return {ctx,engine,events,random,M:ctx.window.GalaxyMothership};
}
function winRivals(f){
  const {engine:e}=f,human=e.players[0],victim=e.players[1];human.kills=4;
  e.destroyShip(victim,human);
  assert.equal(human.kills,5);assert.equal(e.finished,false,'The fifth rival kill cannot complete level one');
  assert.equal(e.winner,null);assert.equal(e.bossEncounter.phase,'entering');assert.equal(e.mothership,null);
  assert.equal(e.publicState().players.length,1,'Every rival disappears from the rendered local world');
  assert.ok(e.players.slice(1).every(p=>p.dead&&!p.pendingSpawn));
  assert.equal(f.events.filter(m=>m.t==='victory').length,0);
  human.protection=1e6;human.x=human.px=160;human.y=human.py=100;
  for(let i=0;i<100;i++)e.update(1/60);
  assert.equal(e.bossEncounter.phase,'fighting');assert.equal(e.bossEncounter.pass,1);assert.equal(e.mothership.hp,6);
  return e.mothership;
}
function escapePass(f,dt=1/60){const {engine:e}=f;const id=e.mothership.id;for(let i=0;i<6000&&!e.finished&&e.mothership?.id===id;i++)e.update(dt);assert.ok(e.finished||!e.mothership,'A complete pass retires the entire hull');}
function shoot(f,guided=false){const e=f.engine,m=e.mothership;e.bullets.push({id:9000,owner:0,x:m.x-600,y:m.y,vx:60000,vy:0,guided});e.absorbMothershipShots(1/60);}
const entries=new Set();
for(const dt of [1/30,1/60,1/120])for(const roll of [0,.5,.999]){
  const f=world(),e=f.engine;assert.equal(e.mothership,null);assert.equal(e.bossEncounter,null);
  const first=winRivals(f);shoot(f,true);assert.equal(first.hp,3);
  e.firstShower=.001;e.nextGiant=.001;e.giant=null;e.meteors=[];e.showerLeft=0;
  escapePass(f,dt);assert.equal(e.finished,false);assert.equal(e.bossEncounter.phase,'between');assert.equal(e.bossEncounter.hp,3);
  assert.equal(e.giant,null);assert.equal(e.showerLeft,0,'Heavy hazards remain suppressed between boss passes');
  const before=e.players.slice(1).map(p=>[p.x,p.y,p.deaths]);f.random.random=()=>roll;
  for(let i=0;i<180&&!e.mothership;i++)e.update(1/60);
  assert.equal(e.bossEncounter.pass,2);assert.equal(e.mothership.hp,3,'The second pass retains all prior damage');
  assert.notEqual(e.mothership.entry,first.entry);entries.add(e.mothership.entry);
  assert.deepEqual(e.players.slice(1).map(p=>[p.x,p.y,p.deaths]),before,'Rivals cannot respawn, move or fire during the boss');
  escapePass(f,dt);assert.equal(e.finished,true);assert.equal(e.winner,-1);assert.equal(e.bossEncounter.phase,'failed');assert.equal(e.mothership,null);
  assert.equal(f.events.filter(m=>m.t==='victory').length,1);e.finishCampaignBoss(false);assert.equal(f.events.filter(m=>m.t==='victory').length,1);
  e.handleMessage({t:'restart',level:2});assert.equal(e.campaignLevel,1);assert.equal(e.finished,true,'An escaped boss cannot unlock level two');
  e.handleMessage({t:'restart',level:1});assert.equal(e.finished,false);assert.equal(e.bossEncounter,null);assert.equal(e.mothership,null);assert.equal(e.publicState().players.length,4);assert.ok(e.players.every(p=>!p.dead&&p.kills===0),'Start over restores all rivals and scores');
}
assert.deepEqual([...entries].sort(),['bottom','right','top']);
for(const pass of [1,2]){
  const f=world(),e=f.engine;winRivals(f);
  e.handleMessage({t:'restart',level:2});assert.equal(e.campaignLevel,1,'A live boss cannot be bypassed by a restart packet');
  if(pass===2){shoot(f,true);escapePass(f);for(let i=0;i<180&&!e.mothership;i++)e.update(1/60);}
  const hp=e.mothership.hp,shots=Math.ceil(hp/3);for(let i=0;i<shots;i++)shoot(f,true);
  assert.equal(e.finished,true);assert.equal(e.winner,0);assert.equal(e.bossEncounter.phase,'won');assert.equal(e.mothership,null);assert.equal(e.bossEncounter.hp,0);
  assert.equal(f.events.filter(m=>m.t==='victory').length,1,'Only destroying the boss emits human victory');
  e.handleMessage({t:'restart',level:3});assert.equal(e.campaignLevel,1,'Victory cannot skip the next world');
  e.handleMessage({t:'restart',level:2});assert.equal(e.campaignLevel,2);assert.equal(e.finished,false);assert.equal(e.bossEncounter,null);assert.equal(e.mothership,null);
}
{
  const f=world(),e=f.engine;winRivals(f);const p=e.players[0],m=e.mothership;
  m.x=m.px=960;m.y=m.py=540;p.x=500;p.y=540;p.rot=90;p.guidedAmmo=2;p.reload=0;
  const targets=e.bossCombatTargets(p),d={x:1,y:0};
  f.ctx.window.GalaxyPhysicsCore.refreshGuidedState(p,targets,()=>d);assert.equal(p.guidedTarget,4,'The mothership can be locked without any rival alive');
  const b=f.ctx.window.GalaxyPhysicsCore.tryFireProjectile(p,d,true,true,false,false,targets,()=>d,()=>99);assert.ok(b.guided);assert.equal(b.target,4);assert.equal(p.guidedAmmo,1);
  b.y=300;b.vx=400;b.vy=0;e.bullets=[b];e.guideBossMissiles(1/60);assert.ok(b.vy>0,'Boss missiles home using the existing steering strength');assert.ok(Math.abs(Math.hypot(b.vx,b.vy)-400)<1e-7);
  p.protection=0;p.shield=0;e.destroyShip(p,null);assert.equal(p.kills,5,'Boss deaths do not erase the already completed rival score');
  for(const edge of ['left','right','top','bottom']){const body=f.M.create(100,edge);let active=true,ticks=0;while(active&&ticks++<4000)active=f.M.step(body,1/60,[],()=>1).active;assert.ok(!active);assert.ok(edge==='top'?body.y>1080+f.M.data.radius:edge==='bottom'?body.y< -f.M.data.radius:edge==='left'?body.x>1920+f.M.data.radius:body.x< -f.M.data.radius);}
}
for(const level of [1,2,3]){
  const f=world(),e=f.engine;e.start('P','facil',1,null,false,level);e.players[0].kills=4;e.players[1].protection=0;e.players[1].shield=0;e.destroyShip(e.players[1],e.players[0]);assert.equal(e.finished,level>2);
  e.startTraining();assert.equal(e.needsMothershipBoss(),false);assert.equal(e.bossEncounter,null);
}
// Exercise the actual client failure screen and automatic trip callback without timers or WebGL.
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
function source(name){let start=game.indexOf('  function '+name+'(');if(start<0)start=game.indexOf('  async function '+name+'(');const end=game.indexOf('\n  }',start);assert.ok(start>=0&&end>start);return game.slice(start,end+4);}
function client(f){
  let id=0;const timers=new Map(),travel=[],wire=[];
  const ui=()=>{const hidden=new Set();return {textContent:'',disabled:false,style:{setProperty(){}},classList:{add(...xs){xs.forEach(x=>hidden.add(x));},remove(...xs){xs.forEach(x=>hidden.delete(x));},contains:x=>hidden.has(x)}};};
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,ui());return elements.get(id);},button=get('restartMatch'),victory=ui();
  const c=vm.createContext({console,roomCode:'LOCAL',localCpuActive:true,localCpu:f.engine,state:f.engine.publicState(),localCampaignLevel:1,LOCAL_CAMPAIGN_LEVELS:5,localCampaignAwaitingContinue:false,localCampaignComplete:false,localCampaignGameOver:false,inGame:true,leaderAnnouncement:null,bossTravelTimer:null,
    document:{getElementById:get},lobbyPlayers:[],playerColors:['blue'],topbar:ui(),mobileControls:ui(),mobileExit:null,victory,resetMobileTouchControls(){},resetVictoryJoystickControls(){},clearSeriesChampionPresentation(){},sinTildes:s=>s,localCampaignWorldName:()=> 'FRONTERA',tr:key=>({bossMissionFailed:'MISIÓN FALLIDA · LA NAVE CONSIGUIÓ SOBREVIVIR',restartCampaign:'VOLVER A EMPEZAR'}[key]||key),
    setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout:i=>timers.delete(i),onlineRoomUnavailable:false,showShareToast(){},runInterstellarTravel:async level=>{travel.push(level);return true;},send:message=>{wire.push(message);f.engine.handleMessage(message);return true;}});
  for(const name of ['scheduleBossTravel','showVictory'])vm.runInContext(source(name),c);
  const at=game.indexOf("if(restartMatchBtn)restartMatchBtn.addEventListener('click',async()=>{"),start=game.indexOf('{',at),end=game.lastIndexOf('  });',game.indexOf("document.getElementById('back').addEventListener",start));assert.ok(at>0&&end>start);
  vm.runInContext('async function continueRound()'+game.slice(start,end)+'}',c);c.restartMatchBtn=button;button.click=()=>{c.trip=c.continueRound();};
  return {c,button,get,timers,travel,wire,show:index=>c.showVictory(index)};
}
(async()=>{
  const failed=world();winRivals(failed);failed.engine.bossEncounter.pass=2;failed.engine.finishCampaignBoss(false);const fail=client(failed);fail.show(-1);assert.equal(fail.get('victoryText').textContent,'MISIÓN FALLIDA · LA NAVE CONSIGUIÓ SOBREVIVIR');assert.equal(fail.button.textContent,'VOLVER A EMPEZAR');assert.equal(fail.c.localCampaignGameOver,true);assert.equal(fail.timers.size,0,'Failure never schedules interstellar travel');await fail.c.continueRound();assert.equal(failed.engine.campaignLevel,1);assert.equal(failed.engine.bossEncounter,null);assert.equal(fail.travel.length,0);
  const won=world();winRivals(won);shoot(won,true);shoot(won,true);const win=client(won);win.show(0);assert.equal(win.c.localCampaignAwaitingContinue,true);assert.equal(win.travel.length,0);assert.equal(win.timers.size,1);[...win.timers.values()][0]();await win.c.trip;assert.deepEqual(win.travel,[2]);assert.equal(won.engine.campaignLevel,2);assert.equal(won.engine.bossEncounter,null);
  const stale=world();winRivals(stale);shoot(stale,true);shoot(stale,true);const old=client(stale);old.show(0);old.c.roomCode='';[...old.timers.values()][0]();assert.equal(old.travel.length,0,'Leaving the result screen invalidates the automatic trip');
  console.log('Campaign boss OK: fifth-kill gate, hidden/inactive rivals, retained HP, all four entry edges, exactly two passes at 30/60/120Hz, boss missile lock, success/failure, guarded restart, translated failure UI and automatic existing interstellar travel.');
})().catch(error=>{console.error(error);process.exitCode=1;});
