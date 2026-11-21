'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const events=[],c=vm.createContext({window:{},console,Date,Math,performance,setTimeout,clearTimeout});
 for(const n of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','storm-core','devourer-core','void-core','shot-history','host-physics','local-cpu'])vm.runInContext(fs.readFileSync('docs/'+n+'.js','utf8'),c);
 const e=new c.window.GalaxyLocalCpu({onEvent:m=>events.push(m)});e.start('P','medio',3,null,false,5);
 for(const p of e.players){p.spawnFx=0;p.protection=0;p.shield=0;}
 return {e,S:c.window.GalaxyVoidCore,p:e.players[0],events};
}
function enter(f,dt){const {e,p}=f;p.kills=4;e.destroyShip(e.players[1],p);assert.equal(e.bossEncounter.type,'void-sphere');assert.equal(e.finished,false);e.handleMessage({t:'restart',level:1});assert.equal(e.campaignLevel,5);p.protection=1e5;for(let t=0;t<10&&e.bossEncounter.phase!=='fighting';t+=dt)e.update(dt);assert.equal(e.bossEncounter.phase,'fighting');assert.ok(e.voidSphere);assert.equal(e.players.filter(p=>!p.dead).length,1);assert.equal(e.asteroids.length,0);assert.equal(p.x,180);return e.voidSphere;}
function shoot(f,target,weapon='bullet',from=null){
 const {e}=f,b=e.voidSphere,dx=target.x-b.x,dy=target.y-b.y,d=Math.hypot(dx,dy)||1;
 const x=from?.x??target.x+dx/d*65,y=from?.y??target.y+dy/d*65;
 const vx=target.x-x,vy=target.y-y,l=Math.hypot(vx,vy)||1;
 e.bullets.push({id:99999,owner:0,x,y,vx:vx/l*24000,vy:vy/l*24000,guided:weapon==='missile',age:0,travel:0});e.absorbVoidShots(1/60);
}
function move(f,x,y){f.e.voidSphere.outerAngle=f.e.voidSphere.pOuterAngle=f.e.voidSphere.innerAngle=f.e.voidSphere.pInnerAngle=0;const {p,e}=f;p.px=p.x;p.py=p.y;p.x=x;p.y=y;p.vx=(x-p.px)*60;p.vy=(y-p.py)*60;e.resolveVoidContacts();}
function corridor(f,from,to){for(let i=1;i<=100;i++){const a=from+(to-from)*i/100;move(f,960+f.S.CORRIDOR*Math.cos(a),540+f.S.CORRIDOR*Math.sin(a));}}
for(const dt of [1/30,1/60,1/120]){
 const f=fixture(),b=enter(f,dt),{e,S,p}=f;
 // Locked exterior portal and thin walls stop fast bullets and the hull.
 assert.equal(S.firstHit(b,{px:400,py:540,x:800,y:540},4).kind,'generator');
 const hp=b.hp;shoot(f,b,'missile',{x:1200,y:540});assert.equal(b.hp,hp);
 move(f,600,540);assert.ok(p.x<550,'closed outer portal stops the nose');
 for(const g of b.generators){shoot(f,g);assert.equal(g.hp,1);shoot(f,g);assert.equal(g.hp,0);}
 assert.equal(S.remaining(b),0);for(let i=0;i<90;i++)S.step(b,dt,p,()=>1);assert.equal(b.outerGate,1);
 // No shield shortcut even through both open doors.
 b.outerAngle=b.pOuterAngle=b.innerAngle=b.pInnerAngle=0;b.innerGate=1;shoot(f,b,'missile',{x:1090,y:540});assert.equal(b.hp,hp);assert.equal(b.inside,false);
 move(f,605,540);assert.ok(Math.abs(p.x-605)<1);corridor(f,Math.PI,0);
 Object.assign(p,{x:960,y:185,px:960,py:185});move(f,960,400);assert.ok(p.y<240,'solid inner arc blocks entry');assert.equal(b.inside,false);Object.assign(p,{x:1315,y:540,px:1315,py:540});
 b.innerGate=1;move(f,1090,540);assert.equal(b.inside,true);assert.equal(b.everEntered,true);
 shoot(f,b,'missile',{x:p.x,y:p.y});assert.equal(b.hp,9);
 move(f,1315,540);assert.equal(b.inside,false);shoot(f,b,'missile',{x:1090,y:540});assert.equal(b.hp,9,'shield restores on leaving chamber');
 move(f,1090,540);p.protection=0;e.destroyShip(p);assert.equal(p.kills,4);assert.equal(b.hp,9);assert.equal(b.inside,false);assert.equal(p.pendingSpawn.x,180);
 e.respawnPlayer(p);assert.equal(p.x,180);assert.equal(p.y,540);
 p.spawnFx=0;p.protection=1e5;b.innerGate=1;move(f,605,540);corridor(f,Math.PI,0);move(f,1090,540);assert.equal(b.inside,true);
 for(let i=0;i<3;i++)shoot(f,b,'missile',{x:p.x,y:p.y});
 assert.equal(b.stage,'escape');assert.equal(e.finished,false,'core destruction is not victory');assert.equal(b.escapeLeft,18);
 move(f,1315,540);corridor(f,0,Math.PI);move(f,380,540);
 assert.equal(e.finished,true);assert.equal(e.winner,0);assert.equal(e.bossEncounter.phase,'won');assert.equal(e.voidSphere,null);assert.equal(e.bullets.length,0);assert.equal(f.events.filter(m=>m.t==='victory').length,1);
 e.finishCampaignBoss(true);assert.equal(f.events.filter(m=>m.t==='victory').length,1);
}
{
 const f=fixture(),b=enter(f,1/60),{e,S,p}=f;
 // A protected overlap still cannot open the core from outside a closed wall.
 p.x=960;p.y=540;p.px=180;p.py=540;e.resolveVoidContacts();assert.equal(b.inside,false);
 for(const g of b.generators)g.hp=0;b.innerGate=1;b.outerGate=1;
 p.x=p.px=1090;p.y=p.py=540;e.resolveVoidContacts();b.hp=1;shoot(f,b,'bullet',{x:p.x,y:p.y});assert.equal(b.stage,'escape');
 b.escapeLeft=.001;e.update(1/60);assert.equal(e.winner,-1);assert.equal(e.bossEncounter.phase,'failed');
}
{
 const f=fixture(),b=enter(f,1/60),{e,S,p}=f;
 b.stage='escape';b.escapeLeft=10;p.protection=0;e.destroyShip(p);assert.equal(e.finished,true);assert.equal(e.winner,-1,'death cannot respawn outside and count as escape');
}
{
 const f=fixture(),b=enter(f,1/60),{e,S,p}=f;
 for(let i=0;i<5;i++){p.dead=false;p.protection=0;p.spawnFx=0;e.destroyShip(p);assert.equal(p.kills,4-i);if(i<4)assert.equal(e.finished,false);}
 assert.equal(e.winner,-1);assert.equal(e.voidSphere,null);
}
// Sweep angular profiles, directions and high velocities: no tunneling and no
// false impacts in the middle of the roomy corridor.
const sweepCore=fixture().S;
for(const dt of [1/30,1/60,1/120])for(let i=0;i<360;i++){
 const S=sweepCore,b=S.create(1),a=i*Math.PI/180,nx=Math.cos(a),ny=Math.sin(a);
 const h=S.firstHit(b,{px:b.x+nx*(S.OUTER+45),py:b.y+ny*(S.OUTER+45),x:b.x+nx*S.CORRIDOR,y:b.y+ny*S.CORRIDOR},4);assert.ok(h,'outer shell closed at every angle');
 const p={x:b.x+nx*S.CORRIDOR,y:b.y+ny*S.CORRIDOR,px:b.x+nx*S.CORRIDOR,py:b.y+ny*S.CORRIDOR,vx:0,vy:0};assert.equal(S.firstHit(b,p,49,{hullOnly:true}),null);
 b.generators.forEach(g=>g.hp=0);b.outerGate=b.innerGate=1;b.age=4;
 const pilot={x:1195,y:540,dead:false,spawnFx:0};S.step(b,dt,pilot,()=>1);assert.equal(b.innerGate,1,'gate cannot close onto a traversing pilot');
}
{
 const f=fixture(),b=enter(f,1/60),{e}=f;
 for(let i=0;i<1800;i++){e.update(1/60);assert.ok(e.bullets.filter(s=>s.voidShot).length<=32);assert.ok(e.fxEvents.length<=32);}
 const snap=e.publicState().voidSphere;snap.generators[0].hp=100;assert.notEqual(b.generators[0].hp,100);
 e.stop();assert.equal(e.voidSphere,null);e.startTraining();assert.equal(e.needsVoidBoss(),false);
}
{
 const f=fixture(),b=enter(f,1/60),{e,p}=f;p.protection=0;p.spawnFx=0;p.x=p.px=300;p.y=p.py=540;
 e.bullets=[{id:1234,owner:-5,voidShot:true,x:200,y:540,px:200,py:540,vx:6000,vy:0,age:0,travel:0,guided:false}];e.updateBullets(1/60);assert.equal(p.dead,true,'real defense shots damage the pilot');
 e.respawnPlayer(p);p.bullets=0;p.x=p.px=260;p.y=p.py=540;e.nextPickup=0;e.updatePickups(1/60);assert.equal(p.bullets,6,'safe outside supply avoids an empty-ammo dead end');
}
for(const name of ['void-core','local-cpu','campaign-config','i18n','render-3d'])assert.ok(fs.readFileSync('docs/prueba-nucleo.js','utf8').includes(fs.readFileSync('docs/'+name+'.js','utf8').trim()),'practice synchronized: '+name);
console.log('Void boss OK: generators, two physical gates, swept walls, internal-only damage, persistent lives/damage, timed escape, timeout/death loss, 30/60/120Hz and bounded FX.');
