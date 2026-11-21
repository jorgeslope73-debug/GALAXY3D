'use strict';
// Verify the presentation through the actual local engine. Controls may arrive
// continuously while it plays, including one-shot weapon pulses.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const c=vm.createContext({window:{},console,Date,Math,performance,setTimeout,clearTimeout});
 for(const n of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','storm-core','devourer-core','void-core','shot-history','host-physics','local-cpu'])vm.runInContext(fs.readFileSync('docs/'+n+'.js','utf8'),c);
 const e=new c.window.GalaxyLocalCpu({});e.start('P','medio',3,null,false,5);
 for(const p of e.players){p.spawnFx=0;p.protection=0;p.shield=0;}
 const p=e.players[0];p.kills=4;e.destroyShip(e.players[1],p);
 return {e,p};
}
for(const dt of [1/30,1/60,1/120]){
 const {e,p}=fixture();
 for(let n=0;n<Math.ceil(2/dt)&&!e.voidSphere;n++)e.update(dt);
 const b=e.voidSphere;assert.ok(b);assert.equal(e.bossEncounter.phase,'presenting');assert.equal(b.introDuration,8);
 Object.assign(p,{bullets:30,guidedAmmo:3,flare:3,reload:.8,shield:12,camo:10,protection:0});
 const timers={noDeathTime:e.noDeathTime,nextPickup:e.nextPickup};
 let pulse=0,frames=0;
 while(e.bossEncounter.phase==='presenting'){
  const before=b.introAge;
  e.setControl(1,true,true,{directFire:true,rocket:true,flare:true,shock:true});
  for(const kind of ['rocket','flare','shock'])e.applyInputAction(kind,++pulse);
  e.damageVoidPart(b,{kind:'generator',slot:0,x:b.generators[0].x,y:b.generators[0].y},'missile',0);
  e.destroyShip(p);assert.equal(p.dead,false,'the paused pilot cannot be destroyed');
  e.resolveVoidContacts();e.updateVoidSphere(dt);
  assert.equal(b.age,0);assert.equal(b.generators[0].hp,2,'damage cannot skip the presentation');
  e.update(dt);frames++;
  assert.ok(b.introAge>before&&b.introAge<=8);
  assert.equal(p.x,180);assert.equal(p.y,540);assert.equal(p.rot,90);assert.equal(p.vx,0);assert.equal(p.vy,0);
  assert.equal(p.bullets,30);assert.equal(p.guidedAmmo,3);assert.equal(p.flare,3);assert.equal(p.reload,.8);assert.equal(p.shield,12);assert.equal(p.camo,10);
  assert.equal(e.bullets.length,0);assert.equal(e.flares.length,0);assert.equal(e.activeShockwaves.length,0);
  assert.equal(e.noDeathTime,timers.noDeathTime);assert.equal(e.nextPickup,timers.nextPickup);assert.equal(b.age,0);assert.equal(b.nextShot,8);
  assert.equal(b.outerAngle,0);assert.equal(b.innerAngle,0);
  assert.ok(frames<Math.ceil(9/dt),'presentation always finishes');
 }
 assert.equal(b.introAge,8);assert.equal(b.introComplete,true);assert.equal(e.bossEncounter.phase,'fighting');assert.equal(p.protection,3);
 const snap=e.publicState();assert.equal(snap.voidSphere.introComplete,true);assert.equal(snap.voidSphere.introAge,8);assert.equal(snap.boss.phase,'fighting');assert.equal(snap.boss.introAge,8);assert.equal(snap.boss.introDuration,8);assert.equal(snap.boss.introComplete,true);
 e.update(dt);
 assert.equal(e.bullets.length,0,'queued presentation fire does not escape into combat');assert.equal(e.flares.length,0);
 assert.equal(p.x,180);assert.equal(p.y,540);assert.equal(p.rot,90);assert.ok(p.reload<.8&&p.shield<12&&p.camo<10,'equipment timers resume on the next combat tick');
 assert.ok(b.age>0&&b.outerAngle>0&&b.innerAngle<0,'authority physics begins only after the shield forms');
 e.stop();assert.equal(e.voidSphere,null);
 e.start('P','medio',3,null,false,5);assert.equal(e.voidSphere,null,'restarting clears presentation state');
}
// Run the real HUD in its own scope: render() locals are not available here.
const game=fs.readFileSync('docs/game.js','utf8'),hud=game.slice(game.indexOf('  function drawVoidProgress('),game.indexOf('  function drawDevourerProgress('));
assert.ok(hud.includes('function drawVoidProgress'));
for(const isMobile of [false,true])for(const [introAge,key] of [[0,'voidIncoming'],[4.5,'voidReveal'],[6.75,'voidShieldForming']]){
 const labels=[],ctx={save(){},restore(){},strokeText(text){labels.push(text);},fillText(){}};
 const scope={ctx,isMobile,W:1920,tr:key=>key,boss:{type:'void-sphere',phase:'presenting',introAge}};
 vm.runInNewContext(hud+'\ndrawVoidProgress(boss);',scope);
 assert.deepEqual(labels,[key],'presentation HUD reads its supplied boss snapshot');
}
console.log('Void introduction OK: eight-second local sequence, frozen controls/weapons/physics/timers, no damage or stale input, clean resume/snapshot/reset at 30/60/120Hz; desktop/mobile HUD phases.');
