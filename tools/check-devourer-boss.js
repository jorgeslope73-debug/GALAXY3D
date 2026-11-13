'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(level=4){
  const events=[],context=vm.createContext({window:{},console,Date,Math,performance,setTimeout,clearTimeout});
  for(const name of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','storm-core','devourer-core','shot-history','host-physics','local-cpu'])vm.runInContext(fs.readFileSync('docs/'+name+'.js','utf8'),context,{filename:name+'.js'});
  const e=new context.window.GalaxyLocalCpu({onEvent:m=>events.push(m)});e.start('P','medio',3,null,false,level);
  for(const p of e.players){p.spawnFx=0;p.protection=0;p.shield=0;}
  return {e,S:context.window.GalaxyDevourer,context,events};
}
function enter(f,dt=1/60){
  const e=f.e,p=e.players[0];p.kills=4;e.destroyShip(e.players[1],p);
  assert.equal(e.finished,false);assert.equal(e.bossEncounter.type,'devourer');assert.equal(e.bossEncounter.phase,'entering');
  assert.equal(e.publicState().players.length,1);assert.ok(e.players.slice(1).every(p=>p.dead&&!p.pendingSpawn));
  e.handleMessage({t:'restart',level:5});assert.equal(e.campaignLevel,4,'cannot skip the boss after five rival kills');
  p.protection=1000;p.x=p.px=200;p.y=p.py=950;
  for(let t=0;t<1.7;t+=dt)e.update(dt);
  assert.equal(e.bossEncounter.phase,'fighting');assert.ok(e.devourer);assert.equal(f.S.remaining(e.devourer),5);return e.devourer;
}
function shotAt(f,slot,weapon='bullet',armored=false){
  const body=f.e.devourer,p=slot<0?body:armored?body.segments[slot]:body.segments[slot].joint;
  // Approach from the side, across the real glowing connector, with swept collision.
  for(const part of [body,...body.segments,...body.segments.map(p=>p.joint)]){part.px=part.x;part.py=part.y;}
  const angle=slot<0?body.angle:body.segments[slot].angle,dx=-Math.sin(angle),dy=Math.cos(angle),distance=slot<0?110:70;
  f.e.bullets.push({id:9000,owner:0,x:p.x+dx*distance,y:p.y+dy*distance,vx:-dx*12000,vy:-dy*12000,guided:weapon==='missile',age:0});
  f.e.absorbDevourerShots(1/60);
}
for(const dt of [1/30,1/60,1/120]){
  const f=fixture(),b=enter(f,dt),{e,S}=f;
  assert.equal(S.weakSlot(b),4);const headHp=b.hp;
  shotAt(f,-1,'missile');assert.equal(b.hp,headHp,'armored head cannot be rushed');
  const saved=b.segments[0].hp;shotAt(f,0,'missile');assert.equal(b.segments[0].hp,saved,'only the illuminated connector is vulnerable');
  shotAt(f,4,'missile',true);assert.equal(b.segments[4].hp,1,'armor is distinct from the glowing joint');
  for(let slot=4;slot>=0;slot--){
    assert.equal(e.bossCombatTargets(e.players[0])[0].index,slot+5);
    shotAt(f,slot,'bullet');assert.equal(b.segments[slot].hp,0,'one normal bullet destroys the illuminated orange joint');assert.equal(S.weakSlot(b),slot-1);
  }
  assert.equal(S.remaining(b),0);let uid=0;const target={x:300,y:500,vx:0,vy:0};
  for(let n=0;n<1200&&!S.vulnerable(b);n++)S.step(b,dt,target,()=>++uid);
  assert.equal(S.vulnerable(b),true,'head exposes its reactor after losing the body');
  shotAt(f,-1,'missile');assert.equal(b.hp,5);const retained=b.hp;
  const p=e.players[0];p.protection=0;p.shield=0;e.destroyShip(p);assert.equal(p.kills,4);assert.equal(b.hp,retained);
  const serial=JSON.stringify(e.publicState().devourer);const copy=e.publicState().devourer;copy.segments[0].joint.x=999;assert.equal(JSON.stringify(e.publicState().devourer),serial,'snapshots do not share mutable body parts');
  p.dead=false;p.spawnFx=0;p.protection=1000;
  shotAt(f,-1,'missile');shotAt(f,-1,'missile');assert.equal(e.finished,true);assert.equal(e.winner,0);assert.equal(e.bossEncounter.phase,'won');assert.equal(e.devourer,null);assert.equal(e.bullets.length,0);
  assert.equal(f.events.filter(m=>m.t==='victory').length,1);e.finishCampaignBoss(true);assert.equal(f.events.filter(m=>m.t==='victory').length,1);
  e.handleMessage({t:'restart',level:5});assert.equal(e.campaignLevel,5);assert.equal(e.bossEncounter,null);assert.equal(e.devourer,null);
}
for(const dt of [1/30,1/60,1/120]){
  const f=fixture(),b=enter(f,dt),{e,S}=f,p=e.players[0];
  for(let lives=4;lives>=0;lives--){
    p.dead=false;p.spawnFx=0;p.protection=0;p.shield=0;e.destroyShip(p);assert.equal(p.kills,lives);assert.equal(e.publicState().boss.lives,lives);
    if(lives>0){assert.equal(e.finished,false);assert.equal(e.devourer,b);}else{assert.equal(e.finished,true);assert.equal(e.winner,-1);assert.equal(e.bossEncounter.phase,'failed');assert.equal(e.devourer,null);}
  }
}
{
  const f=fixture(),b=enter(f),{e,S}=f,p=e.players[0];let id=0,sawWarning=false,sawCharge=false,sawVolley=false,locked=null;
  for(let i=0;i<3600;i++){
    const old=b.attack,shots=S.step(b,1/60,{x:350+Math.sin(i*.01)*250,y:700,vx:70,vy:0},()=>++id);
    if(b.attack==='charge-warning'){sawWarning=true;if(b.warning.locked){const endpoint={x:b.warning.x,y:b.warning.y,destination:b.warning.destination};if(locked)assert.deepEqual(endpoint,locked,'charge destination stays fixed for the last quarter-second');locked=endpoint;}}
    if(b.attack==='charge'){assert.ok(sawWarning);sawCharge=true;}else if(old==='charge')locked=null;
    if(shots.length){sawVolley=true;assert.equal(old==='volley'||old==='volley-warning',true);assert.equal(shots.length,5);assert.ok(shots.every(s=>s.devourer&&s.owner===-4));}
    for(const part of [b,...b.segments]){assert.ok(Number.isFinite(part.x)&&Number.isFinite(part.y));assert.ok(Math.hypot(part.x-part.px,part.y-part.py)<30,'body movement has no screen-wide teleport');}
  }
  assert.ok(sawWarning&&sawCharge&&sawVolley);
  S.step(b,1/60,{dead:true,x:0,y:0},()=>++id);assert.equal(b.warning,null);assert.equal(b.attack,'patrol','dead pilots are not tracked through respawn');
  // A screen wrap must not sweep across the boss, while arrival contacts remain real.
  p.dead=false;p.spawnFx=0;p.protection=0;p.shield=0;p.px=1919;p.py=500;p.x=1;p.y=500;
  b.x=960;b.y=500;b.px=b.x;b.py=b.y;for(const s of b.segments){s.x=s.px=1200;s.y=s.py=100;}
  e.resolveDevourerContacts();assert.equal(p.dead,false);
  p.x=p.px=b.x;p.y=p.py=b.y;p.protection=5;e.resolveDevourerContacts();assert.equal(p.dead,false);assert.ok(Math.hypot(p.x-b.x,p.y-b.y)>S.HEAD_RADIUS);
  p.x=p.px=b.x;p.y=p.py=b.y;p.protection=0;e.resolveDevourerContacts();assert.equal(p.dead,true);
  p.dead=false;p.spawnFx=0;p.protection=1e6;p.x=p.px=100;p.y=p.py=900;
  for(let i=0;i<3600;i++){e.update(1/60);assert.ok(e.bullets.filter(b=>b.devourer).length<=48);assert.ok(e.fxEvents.length<=32);}
  e.stop();assert.equal(e.devourer,null);assert.equal(e.bossEncounter,null);e.startTraining();assert.equal(e.needsDevourerBoss(),false);
}
{
  const f=fixture();f.e.players[1].kills=4;f.e.destroyShip(f.e.players[0],f.e.players[1]);assert.equal(f.e.finished,true);assert.equal(f.e.bossEncounter,null);
  for(const level of [1,2,3,5]){f.e.start('P','medio',1,null,false,level);assert.equal(f.e.needsDevourerBoss(),false);}
}
{
  const f=fixture(),body=enter(f),{e}=f,p=e.players[0];
  p.protection=0;p.spawnFx=0;p.shield=0;p.x=p.px=300;p.y=p.py=800;
  e.bullets=[{id:1234,devourer:true,owner:-4,x:200,y:800,px:200,py:800,vx:6000,vy:0,age:0,travel:0,guided:false}];
  e.updateBullets(1/60);assert.equal(p.dead,true,'boss bullets cause real ship damage');assert.equal(p.kills,4);
  const joint=body.segments[4].joint;
  const missile={guided:true,target:9,decoyed:false,flareTarget:-1,x:joint.x-300,y:joint.y-200,vx:400,vy:0};e.bullets=[missile];e.guideBossMissiles(1/60);assert.ok(missile.vy>0);assert.ok(Math.abs(Math.hypot(missile.vx,missile.vy)-400)<1e-6);
  e.flares=[{id:1235,owner:0,x:joint.x,y:joint.y,px:joint.x,py:joint.y,life:3}];e.absorbDevourerFlares();assert.equal(body.segments[4].hp,0,'one flare also destroys the exposed connector');
}
// The lock freezes the safe charge endpoint, never the pilot's visible reticle.
for(const dt of [1/30,1/60,1/120]){
  const f=fixture(),body=enter(f,dt),{S,e}=f,p=e.players[0];let warnings=0,locked=null;
  for(let i=0;i<Math.round(45/dt);i++){
    const t=i*dt;
    Object.assign(p,{x:t<5?300:((300+t*730)%1920),y:((700-t*310)%1080+1080)%1080,vx:730,vy:-310});
    S.step(body,dt,p,()=>1);
    if(body.warning){
      assert.equal(body.warning.targetX,p.x);assert.equal(body.warning.targetY,p.y);
      const snapshot=e.publicState(),pilot=snapshot.players[0],warning=snapshot.devourer.warning;
      assert.equal(warning.targetX,pilot.x);assert.equal(warning.targetY,pilot.y);
      warning.targetX=-999;assert.equal(body.warning.targetX,p.x,'reticle snapshots are independent');
    }
    if(body.attack==='charge-warning'){
      warnings++;
      if(body.warning.locked){
        const endpoint=[body.warning.x,body.warning.y,body.warning.destination];
        if(locked)assert.deepEqual(endpoint,locked,'moving/wrapping pilot cannot move a locked endpoint');locked=endpoint;
      }
    }else locked=null;
  }
  assert.ok(warnings>20);
  body.attack='charge-warning';body.until=body.age+1;body.warning={x:900,y:200,targetX:1,targetY:1,destination:body.pathDistance+500};
  p.x=345.678;p.y=789.123;const visible=e.publicState();
  assert.equal(visible.devourer.warning.targetX,visible.players[0].x,'post-contact pilot pose is used');
  p.dead=true;assert.equal(e.publicState().devourer.warning,null,'death hides the reticle immediately');
  S.step(body,dt,p,()=>1);assert.equal(body.warning,null);
  p.dead=false;p.spawnFx=1;S.step(body,dt,p,()=>1);assert.equal(body.warning,null,'spawning pilots are not marked');
}
for(const language of ['es','en','it','fr','de','zh']){
  const c=vm.createContext({window:{},localStorage:{getItem:()=>language},document:{querySelectorAll:()=>[],getElementById:()=>null,documentElement:{}}});
  vm.runInContext(fs.readFileSync('docs/i18n.js','utf8'),c);
  for(const key of ['devourerIncoming','devourerJoint','devourerCharge','devourerVolley','devourerOpen','devourerDefeat']){
    const text=c.window.GalaxyI18n.t(key);assert.notEqual(text,key);
    if(language!=='zh'){assert.equal(text,text.toUpperCase());assert.ok(!/[áéíóúÁÉÍÓÚ]/.test(text));}
  }
}
// Reuse the existing actual-result fixture rather than reimplementing game victory logic.
const game=fs.readFileSync('docs/game.js','utf8');
function source(name){const a=game.indexOf('  function '+name+'('),b=game.indexOf('\n  }',a);assert.ok(a>=0&&b>a);return game.slice(a,b+4);}
const stormTest=fs.readFileSync('tools/check-storm-boss.js','utf8'),fixtureStart=stormTest.indexOf('function travelClient(f){'),fixtureEnd=stormTest.indexOf('\n(async()=>{',fixtureStart);
const fixtureContext=vm.createContext({console,vm,assert,game,source});
vm.runInContext(stormTest.slice(fixtureStart,fixtureEnd).replace('localCampaignLevel:3,','localCampaignLevel:f.e.campaignLevel,'),fixtureContext);
(async()=>{
  for(const lives of [1,4,5]){
    const f=fixture(),body=enter(f),{e,S}=f,p=e.players[0];
    while(p.kills>lives){p.protection=0;p.shield=0;p.spawnFx=0;e.destroyShip(p);e.respawnPlayer(p);}
    for(let slot=4;slot>=0;slot--)shotAt(f,slot,'missile');
    let uid=0;for(let n=0;n<1000&&!S.vulnerable(body);n++)S.step(body,1/60,{x:300,y:600},()=>++uid);
    for(let i=0;i<3;i++)shotAt(f,-1,'missile');
    assert.equal(e.bossEncounter.phase,'won');assert.equal(p.kills,lives);
    const client=fixtureContext.travelClient(f);client.c.queueVictory(0);await client.advance(3500);
    assert.deepEqual(Array.from(client.trips),[5]);assert.equal(client.wire.length,1);assert.equal(e.campaignLevel,5);assert.equal(e.finished,false);
  }
  const f=fixture();enter(f);f.e.finishCampaignBoss(false);const failed=fixtureContext.travelClient(f);failed.c.queueVictory(-1);await failed.advance(3500);
  assert.equal(failed.trips.length,0);assert.equal(failed.c.document.getElementById('victoryText').textContent,'devourerDefeat');
  console.log('Devourer boss OK: real projectile/flare/missile contacts, three warned attacks, wrapping, lives, bounded queues, six-language UI and actual automatic level-five travel with retained 1/4/5 lives.');
})().catch(error=>{console.error(error);process.exitCode=1;});
