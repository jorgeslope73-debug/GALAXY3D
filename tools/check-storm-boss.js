'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(level=3){
  const events=[],ctx=vm.createContext({window:{},console,Date,Math,performance,setTimeout,clearTimeout});
  for(const name of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','storm-core','shot-history','host-physics','local-cpu'])vm.runInContext(fs.readFileSync('docs/'+name+'.js','utf8'),ctx,{filename:name+'.js'});
  const e=new ctx.window.GalaxyLocalCpu({onEvent:event=>events.push(event)});e.start('P','medio',3,null,false,level);
  for(const p of e.players){p.spawnFx=0;p.protection=0;p.shield=0;}
  return {e,ctx,events,S:ctx.window.GalaxyStormCore};
}
function enter(f,dt=1/60){
  const e=f.e,p=e.players[0];p.kills=4;e.destroyShip(e.players[1],p);
  assert.equal(e.finished,false);assert.equal(e.bossEncounter.type,'storm-core');assert.equal(e.bossEncounter.phase,'entering');
  assert.equal(e.publicState().players.length,1);assert.ok(e.players.slice(1).every(q=>q.dead&&!q.pendingSpawn));
  e.handleMessage({t:'restart',level:4});assert.equal(e.campaignLevel,3,'five rival kills cannot bypass the boss');
  for(let t=0;t<1.7;t+=dt)e.update(dt);
  assert.equal(e.bossEncounter.phase,'fighting');assert.ok(e.stormCore);assert.equal(e.stormCore.hp,6);
  return e.stormCore;
}
function hit(f,slot,weapon='bullet'){
  const {e}=f,b=e.stormCore,part=slot<0?b:b.satellites[slot];
  // A real fast projectile from outside the target, heading inward, not a direct HP assignment.
  const dx=slot<0?1:(part.x-b.x)/f.S.ORBIT,dy=slot<0?0:(part.y-b.y)/f.S.ORBIT;
  if(weapon==='flare'){
    e.flares.push({id:9000,owner:0,x:part.x,y:part.y,px:part.x,py:part.y,life:3});e.absorbStormFlares();
  }else{
    const distance=(slot<0?f.S.SHIELD_RADIUS:f.S.SATELLITE_RADIUS)+30;
    e.bullets.push({id:9000,owner:0,x:part.x+dx*distance,y:part.y+dy*distance,vx:-dx*12000,vy:-dy*12000,guided:weapon==='missile',age:0});
    e.absorbStormShots(1/60);
  }
}
for(const dt of [1/30,1/60,1/120]){
  const f=fixture(),b=enter(f,dt),e=f.e;
  assert.equal(f.S.CORE_RADIUS,122);assert.equal(f.S.SATELLITE_RADIUS,42);assert.equal(f.S.ORBIT,280);
  assert.ok(f.S.ORBIT>f.S.SHIELD_RADIUS+f.S.SATELLITE_RADIUS,'larger satellites retain clearance from the shield');
  hit(f,-1,'missile');assert.equal(b.hp,6,'shield absorbs shots before satellites are destroyed');assert.equal(e.bullets.filter(q=>q.owner===0).length,0);
  hit(f,0);assert.equal(b.satellites[0].hp,1);hit(f,0);assert.equal(b.satellites[0].hp,0);
  hit(f,1,'missile');hit(f,2,'flare');assert.equal(b.phase,'core');assert.equal(f.S.vulnerable(b),true);assert.equal(e.finished,false);
  const target=e.bossCombatTargets(e.players[0]);assert.deepEqual(Array.from(target,p=>p.index),[4]);
  hit(f,-1);assert.equal(b.hp,5);const saved=b.hp;
  e.players[0].protection=0;e.players[0].shield=0;e.destroyShip(e.players[0]);assert.equal(e.players[0].kills,4);assert.equal(b.hp,saved,'respawn retains boss damage');
  const before=JSON.stringify(e.publicState().stormCore);const snap=e.publicState().stormCore;snap.satellites[0].hp=900;assert.equal(JSON.stringify(e.publicState().stormCore),before,'snapshots cannot mutate authority');
  e.players[0].dead=false;e.players[0].spawnFx=0;e.players[0].protection=100;e.players[0].x=250;e.players[0].y=300;
  let firstVolley=0,tell=0,uid=0;
  for(let t=0;t<10;t+=dt){
    const shots=f.S.step(b,dt,e.players[0],()=>++uid);
    if(b.warning&&tell===0)tell=b.age;
    if(shots.length){firstVolley=shots.length;assert.ok(b.age-tell>=1.25-dt-1e-6,'core gives a full warning before firing');break;}
  }
  assert.equal(firstVolley,5);assert.equal(b.attack,'cooldown');hit(f,-1,'missile');assert.equal(b.hp,2);
  while(!b.warning)f.S.step(b,dt,e.players[0],()=>++uid);
  hit(f,-1);assert.equal(b.hp,2,'charging core is visibly shielded');
  let rageShots=[];while(!rageShots.length)rageShots=f.S.step(b,dt,e.players[0],()=>++uid);assert.equal(rageShots.length,7);
  hit(f,-1,'flare');assert.equal(e.finished,true);assert.equal(e.winner,0);assert.equal(e.bossEncounter.phase,'won');assert.equal(e.stormCore,null);assert.equal(e.bullets.length,0);
  assert.equal(f.events.filter(m=>m.t==='victory').length,1);e.finishCampaignBoss(true);assert.equal(f.events.filter(m=>m.t==='victory').length,1);
  e.handleMessage({t:'restart',level:5});assert.equal(e.campaignLevel,3,'cannot skip the next world');
  e.handleMessage({t:'restart',level:4});assert.equal(e.campaignLevel,4);assert.equal(e.stormCore,null);assert.equal(e.bossEncounter,null);
}
{
  const f=fixture(),b=enter(f),{e,S}=f;let id=0,volleys=0;
  const player={x:200,y:200,dead:false,spawnFx:0};
  for(let i=0;i<300;i++){const previous=!!b.warning,shots=S.step(b,1/60,player,()=>++id);if(shots.length){assert.equal(previous,true);assert.equal(shots.length,1);volleys++;}}
  assert.ok(volleys>0);const original=JSON.stringify(S.snapshot(b));
  const targets=e.bossCombatTargets(e.players[0]);assert.deepEqual(Array.from(targets,p=>p.index),[5,6,7]);
  S.damage(b,0,'missile');assert.deepEqual(Array.from(e.bossCombatTargets(e.players[0]),p=>p.index),[6,7],'missile identities do not shift when a satellite dies');
  const missile={guided:true,target:6,decoyed:false,flareTarget:-1,x:400,y:100,vx:400,vy:0};e.bullets=[missile];e.guideBossMissiles(1/60);assert.ok(missile.vy>0);assert.ok(Math.abs(Math.hypot(missile.vx,missile.vy)-400)<1e-7);
  const p=e.players[0];p.x=b.x;p.y=b.y;p.px=p.x;p.py=p.y;p.protection=10;p.shield=0;e.resolveStormContacts();assert.equal(p.dead,false);assert.ok(Math.hypot(p.x-b.x,p.y-b.y)>S.CORE_RADIUS);
  p.x=p.px=b.x+S.SHIELD_RADIUS+20;p.y=p.py=b.y;p.protection=0;e.resolveStormContacts();assert.equal(p.dead,false,'a charging shield cannot create a sudden lethal hull around the pilot');
  p.x=b.x;p.y=b.y;p.px=p.x;p.py=p.y;p.protection=0;e.resolveStormContacts();assert.equal(p.dead,true,'unprotected hull contact is dangerous');
  const aliveBody=S.create(123);S.step(aliveBody,.1,player,()=>++id);S.step(aliveBody,2,player,()=>++id);assert.ok(aliveBody.warning);player.dead=true;
  assert.equal(S.step(aliveBody,2,player,()=>++id).length,0);assert.equal(aliveBody.warning,null,'a dead pilot is not targeted through the respawn');
  const segment={px:aliveBody.x-500,py:aliveBody.y,x:aliveBody.x+500,y:aliveBody.y};assert.ok(S.firstHit(aliveBody,segment,4),'fast projectile crossing the entire shield is caught');
  assert.notEqual(original,JSON.stringify(S.snapshot(b)));e.stop();assert.equal(e.stormCore,null);assert.equal(e.bossEncounter,null);
  e.startTraining();assert.equal(e.needsStormBoss(),false);assert.equal(e.stormCore,null);
}
{
  const f=fixture(),e=f.e;e.players[1].kills=4;e.destroyShip(e.players[0],e.players[1]);assert.equal(e.finished,true);assert.equal(e.bossEncounter,null,'CPU victory does not create the human encounter');
  for(const level of [1,2,4,5]){e.start('P','medio',1,null,false,level);assert.equal(e.needsStormBoss(),false);}
}
{
  const f=fixture(),body=enter(f),e=f.e,p=e.players[0];
  p.x=p.px=300;p.y=p.py=500;p.protection=0;p.shield=0;p.spawnFx=0;
  e.bullets=[{id:99,owner:-3,storm:true,x:200,y:500,px:200,py:500,vx:6000,vy:0,age:0,travel:0,guided:false}];
  e.updateBullets(1/60);assert.equal(p.dead,true,'storm volleys use real ship impacts, not harmless visual bullets');assert.equal(p.kills,4);
  p.dead=false;p.spawnFx=0;p.protection=1e6;p.x=p.px=200;p.y=p.py=200;
  for(let i=0;i<3600;i++){e.update(1/60);assert.ok(e.bullets.filter(b=>b.storm).length<=48);assert.ok(e.fxEvents.length<=32);}
  assert.equal(e.stormCore,body);assert.equal(e.finished,false,'a long encounter keeps its authority and bounded queues');
}
for(const dt of [1/30,1/60,1/120]){
  const f=fixture(),body=enter(f,dt),{e,S}=f,p=e.players[0];
  S.damage(body,0,'bullet');const hp=body.satellites[0].hp;
  assert.equal(e.publicState().boss.lives,5);assert.equal(e.publicState().boss.maxLives,5);
  p.protection=3;e.destroyShip(p);assert.equal(p.kills,5,'protected contacts never cost a life');p.protection=0;
  p.shield=3;e.destroyShip(p);assert.equal(p.kills,5,'a shield prevents life loss');p.shield=0;
  for(let remaining=4;remaining>=0;remaining--){
    p.protection=0;p.shield=0;p.spawnFx=0;e.destroyShip(p);assert.equal(p.kills,remaining);assert.equal(e.publicState().boss.lives,remaining);
    e.destroyShip(p);assert.equal(p.kills,remaining,'duplicate damage during death cannot cost another life');
    if(remaining){
      assert.equal(e.finished,false);while(p.dead)e.update(dt);
      assert.equal(p.kills,remaining,'respawn does not restore earned lives');assert.equal(body.satellites[0].hp,hp,'enemy damage survives every respawn');
    }
  }
  assert.equal(e.finished,true);assert.equal(e.winner,-1);assert.equal(e.bossEncounter.phase,'failed');assert.equal(e.stormCore,null);
  assert.equal(p.pendingSpawn,null);assert.equal(p.respawn,0);assert.equal(e.bullets.length,0);assert.equal(e.flares.length,0);
  e.update(30);e.finishCampaignBoss(false);assert.equal(f.events.filter(event=>event.t==='victory').length,1,'exactly one game-over event');
  e.handleMessage({t:'restart',level:4});assert.equal(e.campaignLevel,3,'zero lives cannot unlock level four');
  e.handleMessage({t:'restart',level:1});assert.equal(e.campaignLevel,1);assert.equal(e.finished,false);
}
{
  const f=fixture();enter(f);const {e}=f,p=e.players[0];p.kills=1;p.x=p.px=300;p.y=p.py=500;p.protection=0;p.shield=0;p.spawnFx=0;
  e.bullets=[0,1,2].map(id=>({id:100+id,owner:-3,storm:true,x:200,y:500,px:200,py:500,vx:6000,vy:0,age:0,travel:0,guided:false}));
  assert.doesNotThrow(()=>e.updateBullets(1/60),'a lethal volley can clear the queue while processing its final-life hit');
  assert.equal(p.kills,0);assert.equal(e.bossEncounter.phase,'failed');assert.equal(e.bullets.length,0);
  assert.equal(f.events.filter(event=>event.t==='victory').length,1);
}
{
  const f=fixture(),body=enter(f),{e}=f,p=e.players[0];p.kills=1;p.protection=0;p.shield=0;p.spawnFx=0;p.x=p.px=body.x;p.y=p.py=body.y;
  e.resolveStormContacts();assert.equal(p.kills,0);assert.equal(e.finished,true,'enlarged hull collision also consumes the final life');
}
// Actual HUD, translations and existing automatic-travel callback.
const game=fs.readFileSync('docs/game.js','utf8');
function source(name){const a=game.indexOf('  function '+name+'('),b=game.indexOf('\n  }',a);assert.ok(a>=0&&b>a);return game.slice(a,b+4);}
const i18n=vm.createContext({window:{},localStorage:{getItem:()=> 'es'},document:{querySelectorAll:()=>[],getElementById:()=>null,documentElement:{}}});vm.runInContext(fs.readFileSync('docs/i18n.js','utf8'),i18n);
const tr=i18n.window.GalaxyI18n.t,labels=[];
const hud=vm.createContext({ctx:{save(){},restore(){},strokeText(){},fillText:t=>labels.push(t)},W:1920,isMobile:true,tr});vm.runInContext(source('drawStormBossProgress'),hud);
hud.drawStormBossProgress({type:'storm-core',phase:'fighting',satellites:2,attack:'cooldown',hp:6,maxHp:6,lives:4,maxLives:5});assert.ok(labels.includes('SATÉLITES DESTRUIDOS: 1/3'));assert.ok(labels.includes('VIDAS: 4/5'));
hud.drawStormBossProgress({type:'storm-core',phase:'fighting',satellites:0,attack:'charging',hp:2,maxHp:6});assert.ok(labels.includes('CARGANDO · ESQUIVA LA RÁFAGA'));
let callback,clicks=0;const button={disabled:false,click(){clicks++;}},c=vm.createContext({localCpuActive:true,localCpu:{},state:{boss:{type:'storm-core',phase:'won'}},localCampaignAwaitingContinue:true,localCampaignLevel:3,roomCode:'LOCAL',inGame:false,victory:{classList:{contains:()=>false}},bossTravelTimer:null,setTimeout:fn=>{callback=fn;return 1;},clearTimeout(){}});
vm.runInContext(source('scheduleBossTravel'),c);c.scheduleBossTravel(button);callback();assert.equal(clicks,1,'victory uses automatic travel to the next world');
for(const path of ['docs/index.html','docs/build-version.js'])assert.ok(fs.readFileSync(path,'utf8').indexOf('storm-core.js')<fs.readFileSync(path,'utf8').indexOf('local-cpu.js'),'authority loads before the local engine');
// Exercise the real result queue as well as the actual continue-button handler.
// A won boss can retain fewer than five kills because these are now its lives.
function travelClient(f){
  let now=0,id=0;const timers=new Map(),trips=[],wire=[];
  const ui=()=>{const hidden=new Set();return {disabled:false,textContent:'',style:{setProperty(){}},classList:{add(...xs){xs.forEach(x=>hidden.add(x));},remove(...xs){xs.forEach(x=>hidden.delete(x));},contains:x=>hidden.has(x)}};};
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,ui());return elements.get(id);},button=get('restartMatch');
  const c=vm.createContext({console,roomCode:'LOCAL',myIndex:0,localCpuActive:true,localCpu:f.e,state:f.e.publicState(),localCampaignLevel:3,LOCAL_CAMPAIGN_LEVELS:5,localCampaignAwaitingContinue:false,localCampaignComplete:false,localCampaignGameOver:false,inGame:true,leaderAnnouncement:null,bossTravelTimer:null,
    pendingVictoryIndex:null,victoryShowTimer:null,victoryHudScoreShownAt:null,killScorePendingValue:null,killScoreFxStart:0,performance:{now:()=>now},
    document:{getElementById:get},lobbyPlayers:[],playerColors:['blue'],topbar:ui(),mobileControls:ui(),mobileExit:null,victory:ui(),resetMobileTouchControls(){},resetVictoryJoystickControls(){},clearSeriesChampionPresentation(){},sinTildes:s=>s,localCampaignWorldName:()=> 'TORMENTA',tr:key=>key,
    setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:i=>timers.delete(i),onlineRoomUnavailable:false,showShareToast(){},runInterstellarTravel:async level=>{trips.push(level);return true;},send:message=>{wire.push(message);f.e.handleMessage(message);return true;}});
  const names=['queueVictory','victoryDisplayDelay','maybeScheduleVictory','scheduleBossTravel','showVictory'];
  if(game.includes('  function isLocalBossVictory('))names.unshift('isLocalBossVictory');
  for(const name of names)vm.runInContext(source(name),c);
  const at=game.indexOf("if(restartMatchBtn)restartMatchBtn.addEventListener('click',async()=>{"),start=game.indexOf('{',at),end=game.lastIndexOf('  });',game.indexOf("document.getElementById('back').addEventListener",start));assert.ok(at>0&&end>start);
  vm.runInContext('async function continueRound()'+game.slice(start,end)+'}',c);c.restartMatchBtn=button;button.click=()=>{c.trip=c.continueRound();};
  async function advance(ms){const until=now+ms;let count=0;while(true){const due=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert.ok(++count<100,'result queue must not spin forever');now=due[1].at;timers.delete(due[0]);due[1].fn();for(let n=0;n<4;n++)await Promise.resolve();}now=until;}
  return {c,timers,trips,wire,advance};
}
(async()=>{
  for(const lives of [1,2,3,4,5]){
    const f=fixture();enter(f);const p=f.e.players[0];
    for(let i=5;i>lives;i--){p.protection=0;p.shield=0;p.spawnFx=0;f.e.destroyShip(p);f.e.respawnPlayer(p);}
    for(let slot=0;slot<3;slot++)hit(f,slot,'missile');hit(f,-1,'missile');hit(f,-1,'missile');
    assert.equal(p.kills,lives);assert.equal(f.e.bossEncounter.phase,'won');
    const client=travelClient(f);client.c.queueVictory(0);await client.advance(3500);
    assert.deepEqual(client.trips,[4],`a boss won with ${lives} lives automatically travels to level four`);
    assert.equal(client.wire.length,1);assert.equal(f.e.campaignLevel,4);assert.equal(f.e.finished,false);assert.equal(f.e.bossEncounter,null);assert.equal(f.e.stormCore,null);
    assert.ok(f.e.players.slice(1).every(p=>!p.dead),'rivals return in the next phase');
  }
  const failed=fixture();enter(failed);failed.e.finishCampaignBoss(false);const loss=travelClient(failed);loss.c.queueVictory(-1);await loss.advance(3500);assert.equal(loss.trips.length,0);assert.equal(failed.e.campaignLevel,3);
  const normal=fixture();normal.e.bossEncounter=null;const match=travelClient(normal);match.c.queueVictory(0);await match.advance(1200);assert.equal(match.c.inGame,true,'normal CPU victories still wait for their final HUD score');assert.equal(match.trips.length,0);
  console.log('Storm boss OK: combat/lives at 30/60/120 Hz, actual result queue and automatic level-four restart with 1/2/3/4/5 lives, normal score gate and no travel after defeat.');
})().catch(error=>{console.error(error);process.exitCode=1;});
