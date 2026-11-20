'use strict';
// Exercise the complete local engine with real turn/thrust/fire commands.
// Only the encounter and already-destroyed generators are test fixtures;
// the pilot never teleports and no projectile is created by the test.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function fixture(){
 const c=vm.createContext({window:{},console,Date,Math,performance,setTimeout,clearTimeout});
 for(const n of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','storm-core','devourer-core','void-core','shot-history','host-physics','local-cpu'])vm.runInContext(fs.readFileSync('docs/'+n+'.js','utf8'),c);
 const e=new c.window.GalaxyLocalCpu({});e.start('P','medio',3,null,false,5);
 for(const p of e.players){p.spawnFx=0;p.protection=0;p.shield=0;}
 const p=e.players[0];p.kills=4;e.destroyShip(e.players[1],p);
 for(let i=0;i<180;i++)e.update(1/60);
 assert.ok(e.voidSphere);assert.equal(p.x,180,'the real boss entry provides the outside spawn');
 const b=e.voidSphere;for(const g of b.generators)g.hp=0;
 p.protection=1e5;e.nextPickup=1e9;
 const hits=[],damage=e.damageVoidPart.bind(e);
 e.damageVoidPart=(body,hit,weapon,owner)=>{hits.push({kind:hit.kind,weapon,owner});return damage(body,hit,weapon,owner);};
 return {e,p,b,S:c.window.GalaxyVoidCore,hits};
}
const evidence=[];
for(const dt of [1/30,1/60,1/120])for(const shielded of [false,true]){
 const {e,p,b,S,hits}=fixture();p.shield=shielded?1000:0;
 const firingRadius=S.INNER-50;
 assert.ok(Number.isFinite(S.CORRIDOR),'the actual authority exports its corridor center');
 let phase='outer',thrustBudget=0,insidePose=null,entryRadius=null,shot=false,shotTime=0,done=false;
 for(let tick=0;tick<Math.ceil(70/dt)&&!e.finished;tick++){
  const dx=p.x-b.x,dy=p.y-b.y,r=Math.hypot(dx,dy),bearing=Math.atan2(dy,dx);
  let targetAngle=Math.PI+b.outerAngle,targetRadius=S.CORRIDOR,fire=false,thrust=false,turn=0;
  if(phase==='outer'&&r<S.OUTER-S.WALL-60-4)phase='corridor';
  if(phase==='corridor'){
   const err=delta(b.innerAngle,bearing);targetAngle=bearing+clamp(err,-.25,.25);
   if(Math.abs(err)<.08)phase='inner';
  }
  if(phase==='inner'){
   targetAngle=b.innerAngle;targetRadius=firingRadius;
   if(b.inside&&entryRadius===null)entryRadius=r;
   if(Math.abs(r-firingRadius)<2&&Math.abs(delta(b.innerAngle,bearing))<.25){
    assert.equal(b.inside,true,'a real pilot at R'+firingRadius+' through the opening is already in the chamber');
    assert.equal(e.publicState().boss.stage,'core','the public HUD reports vulnerability at that same pose');
    assert.ok(entryRadius>firingRadius-2,'entry uses the chamber threshold, before the ship reaches its firing distance');
    insidePose={...p};phase='fire-inside';shot=false;
   }
  }
  if(phase==='exit'){
   targetAngle=b.innerAngle;targetRadius=S.CORRIDOR;
   if(r>S.INNER+S.WALL+60+3){assert.equal(b.inside,false);assert.equal(b.hp,11);phase='fire-outside';shot=false;}
  }
  if(phase==='fire-inside'||phase==='fire-outside'){
   const aim=Math.atan2(dx,dy),err=delta(aim,p.rot*Math.PI/180);turn=clamp(err/(20*Math.PI/180),-1,1);
   if(!shot&&Math.abs(err)<.035){
    if(phase==='fire-outside')assert.ok(r>S.INNER+S.WALL&&r<S.OUTER-S.WALL,'the protected test shot really starts between the two rings');
    fire=true;shot=true;shotTime=tick*dt;
   }
  }else{
   const tx=b.x+targetRadius*Math.cos(targetAngle),ty=b.y+targetRadius*Math.sin(targetAngle);
   const desiredVx=clamp((tx-p.x)*1.4,-130,130),desiredVy=clamp((ty-p.y)*1.4,-130,130);
   const ax=(desiredVx-p.vx)*3+p.vx*1.05,ay=(desiredVy-p.vy)*3+p.vy*1.05;
   const aim=Math.atan2(-ax,-ay),err=delta(aim,p.rot*Math.PI/180);turn=clamp(err/(20*Math.PI/180),-1,1);
   thrustBudget+=Math.min(1,Math.hypot(ax,ay)/240);thrust=Math.abs(err)<.3&&thrustBudget>=1;
   if(thrust)thrustBudget-=1;else thrustBudget=Math.min(1,thrustBudget);
  }
  e.setControl(turn,thrust,fire,{directFire:true});e.update(dt);
  if(phase==='fire-inside'&&shot&&tick*dt-shotTime>1){
   assert.equal(b.hp,11,'a normal projectile fired through the real input pipeline damages the exposed core');
   assert.ok(hits.some(h=>h.kind==='core'&&h.weapon==='bullet'));phase='exit';
  }
  if(phase==='fire-outside'&&shot&&tick*dt-shotTime>1.5){
   assert.equal(b.hp,11,'leaving restores the shield while retaining damage');
   assert.ok(hits.some(h=>h.kind==='shield'&&h.weapon==='bullet'),'the real outside bullet is absorbed by the restored shield');
   done=true;break;
  }
 }
 assert.equal(done,true,'real controls complete entry/fire/exit: '+JSON.stringify({phase,dt,shielded,r:Math.hypot(p.x-b.x,p.y-b.y),bearing:Math.atan2(p.y-b.y,p.x-b.x),inner:b.innerAngle,inside:b.inside}));
 assert.ok(insidePose);
 for(const patch of [{dead:true},{spawnFx:.5}]){const copy=S.snapshot(b);S.syncPresence(copy,{...insidePose,...patch},shielded?60:49);assert.equal(copy.inside,false,'dead/materializing pilots cannot unlock the core');}
 const locked=S.snapshot(b);locked.generators[0].hp=1;S.syncPresence(locked,insidePose,shielded?60:49);assert.equal(locked.inside,false,'all generators must be destroyed');
 evidence.push({hz:Math.round(1/dt),shielded,entryRadius:+entryRadius.toFixed(2),firingRadius,hp:b.hp});
}
console.log('Void real-control entry OK: no teleport, visible chamber entry, normal-fire core damage, shield restoration, retained damage and live/generator guards.');
console.log(JSON.stringify(evidence));
