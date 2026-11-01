import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareMothershipTemplate,createMothershipFactory,setMothershipPose,createMothershipExhaust,createMothershipHealth,MOTHERSHIP_NOZZLES} from '../docs/mothership-model.js';
const source=async name=>readFile(new URL('../docs/'+name+'.js',import.meta.url),'utf8');
const ctx=vm.createContext({window:{},console,Date,performance,setTimeout,clearTimeout});
for(const name of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','shot-history','host-physics','local-cpu'])vm.runInContext(await source(name),ctx,{filename:name+'.js'});
const M=ctx.window.GalaxyMothership,P=ctx.window.GalaxyPhysicsCore,D=M.data;
// The cheap lookahead must describe the same banked concave hull as contacts.
for(const direction of [-1,1])for(const yaw of [-8,0,8])for(const bank of [-15,0,15]){
  const mother=M.create(88,direction);mother.x=960;mother.y=540;mother.angle+=yaw*Math.PI/180;mother.bank=bank*Math.PI/180;
  for(const [x,y]of [[960,540],[600,540],[1350,540],[950,340],[950,740],[1250,800],[700,300]])assert.ok(Math.abs(M.clearance(mother,x,y)-M.surface(mother,x,y).distance)<1e-8,'Read-only AI clearance matches the real rotated silhouette');
}
const avoid=ctx.window.GalaxyLocalCpu.prototype.cpuMothershipSafetyControl;
const chase=(p,goal)=>{const error=((Math.atan2(-(goal.x-p.x),-(goal.y-p.y))*180/Math.PI-p.rot+540)%360)-180;return {turn:Math.max(-1,Math.min(1,error/38)),thrust:Math.abs(error)<68,fire:false};};
function avoidancePass(direction,angle,velocity,enabled){
  const mother=M.create(90,direction);mother.x=mother.px=960;mother.y=mother.py=540;
  const dx=Math.cos(angle)*500,dy=Math.sin(angle)*500;
  const p={cpu:true,index:1,dead:false,spawnFx:0,protection:0,shield:0,bank:0,x:960+dx,y:540+dy,vx:-Math.cos(angle)*velocity,vy:-Math.sin(angle)*velocity,speed:velocity>200?2:1,rot:(Math.atan2(dx,dy)*180/Math.PI+360)%360};
  const goal={x:960-dx,y:540-dy},engine={mothership:mother};
  for(let tick=0;tick<300;tick++){
    if(tick%2===0||!p.aiControl){const intent=chase(p,goal);p.aiControl=(enabled?avoid.call(engine,p,intent):null)||intent;}
    assert.ok(Number.isFinite(p.aiControl.turn)&&Math.abs(p.aiControl.turn)<=1);
    P.stepShipMovement(p,p.aiControl,1/60,1920,1080);M.step(mother,1/60,[],()=>0);
    if(M.contact(mother,p,'ship'))return true;
  }
  return false;
}
let unguardedContacts=0,guardedContacts=0,avoidanceCases=0;
for(const direction of [-1,1])for(const angle of [0,.65,1.25,2.05,2.65,Math.PI])for(const velocity of [0,180,360]){
  unguardedContacts+=Number(avoidancePass(direction,angle,velocity,false));guardedContacts+=Number(avoidancePass(direction,angle,velocity,true));avoidanceCases++;
}
assert.ok(unguardedContacts>=30);assert.ok(guardedContacts<=unguardedContacts*.25,'Anticipation avoids at least three quarters of otherwise certain collisions, including speed upgrades and both crossing directions');
for(const difficulty of ['facil','medio','dificil']){
  const engine=new ctx.window.GalaxyLocalCpu({});engine.start('AVOID',difficulty,1,null,false,1);
  engine.startMothershipPass();
  const p=engine.players[1];Object.assign(p,{x:1450,y:540,vx:-140,vy:0,rot:90,speed:1,spawnFx:0,protection:2,shield:0});engine.mothership.x=engine.mothership.px=960;
  const intent={turn:0,thrust:true,fire:true};engine.chooseCpuIntent=()=>intent;
  const before=JSON.stringify(p),bodyBefore=JSON.stringify(engine.mothership),control=engine.chooseCpuControls(p);
  assert.notEqual(control,intent,'Avoidance overrides every difficulty and higher pursuit/spawn tactics');assert.equal(control.fire,false);
  assert.equal(JSON.stringify(p),before);assert.equal(JSON.stringify(engine.mothership),bodyBefore,'Lookahead cannot advance authoritative bodies');
  engine.mothership.age+=.1;assert.equal(engine.chooseCpuControls(p),control,'A short commitment prevents left/right jitter');
  assert.equal(avoid.call(engine,{...p,cpu:false},intent),null,'Human controls are never overridden');
  assert.equal(avoid.call(engine,{...p,dead:true},intent),null);
  engine.mothership=null;assert.equal(engine.chooseCpuControls(p),intent,'Normal decisions resume as soon as the mothership leaves');
  assert.ok(!('mothershipAvoidanceScratch' in engine.publicState())&&!('mothershipAvoidanceMemory' in engine.publicState()),'AI probes stay local and outside snapshots');
}
console.log(`Mothership avoidance OK: ${avoidanceCases} closed-loop pursuit cases, contacts ${unguardedContacts} -> ${guardedContacts}; all difficulties, immutable probes, stable turns and no network fields.`);
const bytes=await readFile(new URL('../docs/assets/models/nodriza.glb',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),D.sha256,'Physics calibration must match the exact supplied GLB');
assert.equal(D.length,540,'The calibrated ship is ten percent smaller than its previous 600-unit length');
assert.ok(bytes.length<3*1024*1024,'The authored hull and baked finish stay below 3 MiB');assert.equal(D.turrets.length,4);
assert.deepEqual(Array.from(D.turrets,t=>t.name),['AEGIS_Yaw_Aft_L','AEGIS_Yaw_Aft_R','AEGIS_Yaw_Forward_L','AEGIS_Yaw_Forward_R']);
assert.ok(D.profiles[0].outline.length>20,'Use the real concave hull, not a circle or bounding box');
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const original=gltf.scene.getObjectByName('AEGIS_Hull').material;
const template=prepareMothershipTemplate(gltf.scene,D),environment=new T.Texture(),factory=createMothershipFactory(template,D,environment),a=factory(),b=factory();
let triangles=0,meshes=0;a.traverse(o=>{if(!o.isMesh)return;meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;assert.equal(o.material.map,original.map);assert.equal(o.material.metalnessMap,original.metalnessMap);assert.equal(o.material.emissiveMap,original.emissiveMap);assert.equal(o.material.normalMap,original.normalMap);assert.deepEqual(o.material.normalScale,original.normalScale);assert.equal(o.material.emissiveIntensity,original.emissiveIntensity);assert.equal(o.material.envMap,environment);});
assert.equal(meshes,5);assert.equal(triangles,13437);
assert.ok(original.normalMap,'The updated ship keeps its baked surface detail');
assert.equal(original.map.channel,0);assert.equal(original.normalMap.channel,0);assert.equal(original.emissiveMap.channel,1,'Lights retain their separate original UV palette');
assert.equal(a.getObjectByName('AEGIS_Turret_Centre'),undefined,'The replacement GLB has no central gun geometry');
for(const direction of [-1,1])for(const yaw of [-8,0,8])for(const bank of [-15,0,15]){
  const body=M.create(87,direction),visual=factory();body.angle+=yaw*Math.PI/180;body.bank=bank*Math.PI/180;
  setMothershipPose(visual,body);visual.position.x=body.x;
  const bounds=new T.Box3().setFromObject(visual);
  assert.ok(direction>0?bounds.max.x<0:bounds.min.x>1920,'The complete encounter hull starts outside the screen in every orientation');
  assert.equal(body.px,body.x,'The first collision sweep starts at the same offscreen point');
}
// All five jets originate in the authored rear rims, including reversed travel
// and the full bank/yaw. Their world-space trails do not turn with the hull.
for(const mobile of [false,true]){
  const root=new T.Group(),visual=factory(),fx=createMothershipExhaust({mobile});root.add(visual,fx.points);
  const attributes=fx.points.geometry.attributes,position=attributes.position,life=attributes.life;
  const live=()=>Array.from(life.array).filter(n=>n>0).length;
  assert.equal(position.count,mobile?144:256);assert.equal(fx.points.material.depthWrite,false);
  assert.equal(fx.points.material.blending,T.AdditiveBlending);assert.equal(fx.points.material.uniforms.pointScale.value,1);
  let cases=0;
  for(const direction of [-1,1])for(const yaw of [-8,0,8])for(const bank of [-15,0,15]){
    const body=M.create(30,direction);body.x=960;body.y=540;body.angle+=yaw*Math.PI/180;body.bank=bank*Math.PI/180;
    root.position.set(body.x,-body.y,0);setMothershipPose(visual,body);fx.update(visual,body,1000,'pose-'+cases++,2/3);
    assert.equal(live(),5,'Each real nozzle emits, without a stale previous trail');
    const hull=visual.getObjectByName('AEGIS_Hull');
    const frame=new T.Matrix4().copy(root.matrixWorld).invert().multiply(hull.matrixWorld);
    const outward=new T.Vector3(0,0,1).transformDirection(frame);
    for(let i=0;i<5;i++){
      const n=MOTHERSHIP_NOZZLES[i],origin=new T.Vector3(n[0],n[1],n[2]).applyMatrix4(frame);
      const offset=new T.Vector3().fromBufferAttribute(position,i).sub(origin);
      assert.ok(Math.abs(offset.dot(outward))<.001,'Birth lies on the rotated nozzle plane');
      assert.ok(offset.length()<=n[3]*D.scale+.001,'Birth stays inside the nozzle mouth');
    }
    const old=new T.Vector3().fromBufferAttribute(position,0).add(root.position);
    body.x+=.09;body.angle+=.001;root.position.x=body.x;setMothershipPose(visual,body);
    fx.update(visual,body,1001,'pose-'+(cases-1),2/3);
    const delta=new T.Vector3().fromBufferAttribute(position,0).add(root.position).sub(old);
    assert.ok(delta.dot(outward)>.15&&delta.length()<.3,'Existing particles keep travelling aft rather than following hull yaw');
  }
  for(const fps of [30,60,144]){
    const body=M.create(50);body.x=300;body.y=540;
    for(let frame=0;frame<fps*4;frame++){
      body.x+=90/fps;body.angle=body.heading+M.yawAt(frame/fps);body.bank=M.bankAt(frame/fps);
      root.position.set(body.x,-body.y,0);setMothershipPose(visual,body);fx.update(visual,body,2000+frame*1000/fps,'fps-'+fps,.75);
      assert.ok(Array.from(life.array).every(n=>n>=0&&n<=1),'Particle lifetimes stay bounded at every refresh rate');
    }
    assert.ok(live()>40&&live()<position.count,'Sustained propulsion has a bounded, non-saturated reusable pool');
    assert.equal(fx.points.geometry.attributes.position,position,'No per-frame geometry or buffer allocation');
    fx.update(visual,body,8000,'fps-'+fps,.75);assert.equal(live(),5,'A background gap drops the old trail');
    fx.update(visual,body,8016,'next-match',.75);assert.equal(live(),5,'A new match clears pooled exhaust');
    body.id++;fx.update(visual,body,8032,'next-match',.75);assert.equal(live(),5,'A different mothership clears pooled exhaust');
  }
  assert.equal(fx.points.material.uniforms.pointScale.value,.75,'Point size tracks the actual render resolution');
}
console.log('Mothership exhaust OK: five authored rear nozzles, blue particle shader, bank/yaw alignment, independent world trails, fixed mobile/desktop pools, 30/60/144Hz and match/background cleanup.');
const body=M.create(99);body.x=960;body.y=540;
for(const direction of [1,-1])for(const yaw of [-8,0,8])for(const bank of [-15,-7.5,0,7.5,15])for(const angle of [0,.7,2.2,4.9]){
  body.angle=direction*Math.PI/2+yaw*Math.PI/180;
  body.bank=bank*Math.PI/180;
  body.turrets.forEach((t,i)=>t.angle=angle+i*.23);
  setMothershipPose(a,body);a.position.set(body.x,-body.y,0);a.updateMatrixWorld(true);
  for(let i=0;i<D.turrets.length;i++){
    const pivot=a.getObjectByName(D.turrets[i].name);
    assert.ok(pivot&&!pivot.isMesh,'The authored null drives the turret');
    for(let barrel=0;barrel<2;barrel++){
      const rendered=pivot.localToWorld(new T.Vector3(...D.turrets[i].muzzles[barrel])),shot=M.muzzle(body,i,barrel);
      assert.ok(Math.hypot(rendered.x-shot.x,-rendered.y-shot.y)<.001,'Both bullets must start at the rendered cannon tips in either crossing direction');
    }
    const base=pivot.localToWorld(new T.Vector3()),tip=pivot.localToWorld(new T.Vector3(0,0,1));
    assert.ok(Math.abs(Math.atan2(Math.sin(Math.atan2(-(tip.y-base.y),tip.x-base.x)-body.turrets[i].angle),Math.cos(Math.atan2(-(tip.y-base.y),tip.x-base.x)-body.turrets[i].angle)))<1e-6,'Null yaw points at the same target as its bullets');
    assert.equal(b.getObjectByName(D.turrets[i].name).rotation.y,0,'Independent clones do not rotate each other');
  }
}
assert.equal(D.bankProfiles.length,31,'Every integer bank from -15 to +15 has a projected GLB hull');
for(let degrees=-15;degrees<=15;degrees++){
  body.angle=0;body.bank=degrees*Math.PI/180;
  setMothershipPose(a,body);a.position.set(body.x,-body.y,0);a.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(a.getObjectByName('AEGIS_Hull'),true),outline=M.hullProfile(body).outline;
  const actual=[bounds.min.x-body.x,bounds.max.x-body.x,-bounds.max.y-body.y,-bounds.min.y-body.y];
  const projected=[Math.min(...outline.map(p=>p[0])),Math.max(...outline.map(p=>p[0])),Math.min(...outline.map(p=>p[1])),Math.max(...outline.map(p=>p[1]))];
  actual.forEach((value,i)=>assert.ok(Math.abs(value-projected[i])<1.4,'Banked contact bounds follow the actual mesh, not the old flat hull'));
  if(degrees===0)assert.ok(Math.abs(bounds.max.y-bounds.min.y-540)<1e-4,'The rendered hull uses the same reduced length as its collision data');
}
assert.ok(Math.abs(M.bankAt(2.5)-M.BANK_LIMIT)<1e-12);assert.ok(Math.abs(M.bankAt(7.5)+M.BANK_LIMIT)<1e-12);
assert.ok(Math.abs(M.yawAt(3.5)-8*Math.PI/180)<1e-12);assert.ok(Math.abs(M.yawAt(10.5)+8*Math.PI/180)<1e-12);
for(let tick=0;tick<600;tick++){
  const t=tick/60;assert.ok(Math.abs(M.bankAt(t))<=M.BANK_LIMIT+1e-12);
  assert.ok(Math.abs(M.bankAt(t+1/60)-M.bankAt(t))<.0028,'The lateral bank changes smoothly');
  assert.ok(Math.abs(M.bankAt(t+M.BANK_PERIOD)-M.bankAt(t))<1e-12,'Banking repeats without drift');
  assert.ok(Math.abs(M.yawAt(t))<=M.YAW_LIMIT+1e-12);
  assert.ok(Math.abs(M.yawAt(t+1/60)-M.yawAt(t))<.0011,'The eight-degree heading change remains smooth');
  assert.ok(Math.abs(M.yawAt(t+M.YAW_PERIOD)-M.yawAt(t))<1e-12,'Heading does not accumulate a full turn');
}
body.angle=Math.PI/2;body.vx=0;body.age=10;body.bank=0;
const player={index:0,x:1400,y:100,vx:0,vy:0,protection:0,spawnFx:0,camo:0,dead:false};
body.turrets.forEach((t,i)=>{const p=M.pivot(body,i);t.angle=Math.atan2(player.y-p.y,player.x-p.x);t.nextShot=0;});
let id=1;const volley=M.step(body,1/60,[player],()=>id++).shots;
assert.equal(volley.length,2,'Only one turret fires its twin barrels per turn');
assert.ok(Math.hypot(volley[0].x-volley[1].x,volley[0].y-volley[1].y)>16,'Twin barrels stay visibly separated at the reduced scale');
assert.equal(M.step(body,1/60,[player],()=>id++).shots.length,0,'Cadence is bounded, not a volley every frame');
assert.equal(M.step(body,4,[{...player,dead:true}],()=>id++).shots.length,0);
assert.ok(volley.every(s=>s.owner===-2&&s.guided===false));
// Select the closest suitable mount in front, aft and both side sectors,
// including the mothership's heading and bank rather than fixed screen axes.
function targetAt(mother,index,x,y,extra={}){const c=Math.cos(mother.angle),s=Math.sin(mother.angle);return {...player,index,x:mother.x+x*c-y*s,y:mother.y+x*s+y*c,...extra};}
function assignedGun(mother,index){return mother.turrets.findIndex(t=>t.target===index);}
let sectorCases=0;
for(const direction of [-1,1])for(const yaw of [-8,0,8])for(const bank of [-15,0,15]){
  const mother=M.create(91,direction);mother.x=960;mother.y=540;mother.angle+=yaw*Math.PI/180;mother.bank=bank*Math.PI/180;
  for(const [x,y,allowed]of [[0,-650,[2,3]],[0,650,[0,1]],[-650,0,[0,2]],[650,0,[1,3]]]){
    const target=targetAt(mother,7,x,y);M.assignTargets(mother,[target]);
    const gun=assignedGun(mother,7);assert.ok(allowed.includes(gun),'The arrival direction chooses the front, aft, upper or lower pair');
    const distance=index=>{const p=M.pivot(mother,index);return Math.hypot(target.x-p.x,target.y-p.y);};
    assert.ok(Math.abs(distance(gun)-Math.min(...allowed.map(distance)))<1e-8,'The nearest valid turret is selected');
    assert.equal(mother.turrets.filter(t=>t.target>=0).length,1);sectorCases++;
  }
  const corners=[targetAt(mother,0,-650,-650),targetAt(mother,1,650,-650),targetAt(mother,2,-650,650),targetAt(mother,3,650,650)];
  M.assignTargets(mother,corners);assert.deepEqual([0,1,2,3].map(i=>assignedGun(mother,i)),[2,3,0,1],'The four diagonal objectives use their own corner guns');
  M.assignTargets(mother,[targetAt(mother,10,0,-650),targetAt(mother,11,-650,-650)]);
  assert.equal(assignedGun(mother,10),3);assert.equal(assignedGun(mother,11),2,'A shared front-axis target cannot steal the only suitable mount of another objective');
  for(const [x,y,expected]of [[-650,-650,2],[-650,650,0],[650,650,1],[650,-650,3]]){
    M.assignTargets(mother,[targetAt(mother,25,x,y)]);assert.equal(assignedGun(mother,25),expected,'Sector changes transfer the target immediately, without the old seven-second wait');
  }
}
const crossing=M.create(92);crossing.x=crossing.px=960;crossing.vx=0;crossing.age=-1/60;
const crossingTarget={...player,x:1400,y:540,vx:-1000,vy:0};
crossing.turrets.forEach((t,i)=>{const p=M.pivot(crossing,i);t.angle=Math.atan2(crossingTarget.y-p.y,crossingTarget.x-p.x);});
M.step(crossing,1/60,[crossingTarget],()=>id++);
const crossingGun=assignedGun(crossing,0),crossingPivot=M.pivot(crossing,crossingGun);
assert.ok(Math.abs(crossing.turrets[crossingGun].angle-Math.atan2(crossingTarget.y-crossingPivot.y,crossingTarget.x-crossingPivot.x))<1e-8,'Prediction cannot make a front gun aim into the opposite sector');
// No two active guns share a player. Spare sectors stay idle.
let totalVolleys=0;
for(const count of [1,2,4]){
  const mother=M.create(100);mother.x=mother.px=960;mother.vx=0;
  const targets=Array.from({length:count},(_,i)=>({...player,index:i,x:[300,1500,400,1450][i],y:[150,900,900,120][i]}));
  let lastVolley=-Infinity;const lastGun=new Map(),seenGuns=new Set();
  for(let tick=0;tick<32*60;tick++){
    const before=mother.turrets.map(t=>t.nextShot),result=M.step(mother,1/60,targets,()=>id++);
    assert.ok(Math.abs(mother.angle-mother.heading-M.yawAt(mother.age))<1e-12,'Simulation and drawing receive the same gently changing heading');
    const assigned=mother.turrets.filter(t=>t.target>=0).map(t=>t.target);
    assert.equal(assigned.length,count);assert.equal(new Set(assigned).size,count,'Each active turret has a distinct objective');
    mother.turrets.forEach((t,i)=>{if(t.target>=0)assert.ok(M.canTarget(mother,i,targets.find(p=>p.index===t.target)),'Every active target remains inside its mount sector');});
    assert.ok(result.shots.length===0||result.shots.length===2,'No simultaneous mass volleys or catch-up bursts');
    if(!result.shots.length)continue;
    const guns=mother.turrets.map((t,i)=>t.nextShot!==before[i]?i:-1).filter(i=>i>=0);
    assert.equal(guns.length,1);assert.ok(guns[0]>=0&&guns[0]<4,'Only one of the four remaining turrets fires');
    assert.ok(mother.age-lastVolley>=M.VOLLEY_GAP-1e-8,'There is a full pause between twin shots');
    assert.ok(mother.age-(lastGun.get(guns[0])??-Infinity)>=M.SHOT_INTERVAL-1e-8,'Each gun also respects its slow individual cooldown');
    lastGun.set(guns[0],mother.age);lastVolley=mother.age;seenGuns.add(guns[0]);totalVolleys++;
    result.shots.forEach((shot,barrel)=>{const muzzle=M.muzzle(mother,guns[0],barrel);assert.ok(Math.hypot(shot.x-muzzle.x,shot.y-muzzle.y)<1e-7);assert.ok(Math.abs(Math.hypot(shot.vx,shot.vy)-400)<1e-8,'Enemy bullets are slower than the previous 600 units/s');});
  }
  assert.equal(seenGuns.size,count,'Only mounts covering these separated target sectors fire');
  targets[0].dead=true;M.step(mother,1/60,targets,()=>id++);
  assert.ok(mother.turrets.every(t=>t.target!==0),'Dead targets are released immediately');
}
// A swept projectile crosses the complete ship in one tick; near misses remain misses.
body.px=body.x;body.py=body.y;body.bank=0;
assert.ok(M.circleSweep(body,{px:300,py:540,x:1600,y:540},4));
assert.equal(M.circleSweep(body,{px:300,py:950,x:1600,y:950},4),null);
assert.equal(M.contact(body,{id:71,x:body.x+300,y:body.y+280,r:51.75,spin:0}),null,'Empty bounding-box corners must not produce ghost collisions');
let contacts=0;
for(const yaw of [-8,0,8])for(const bank of [-15,0,15])for(const r of P.MEDIUM_ROCK_RADII)for(const spin of [0,.7,1.8,3.4,5.6])for(const direction of [-1,1]){
  const mother=M.create(99,direction);mother.x=960;mother.y=540;mother.vx=direction*90;
  mother.angle+=yaw*Math.PI/180;
  mother.bank=bank*Math.PI/180;
  const rock={id:17,r,spin,x:960,y:540+direction*340,vx:0,vy:-direction*100};
  let collided=false;
  for(let tick=0;tick<300;tick++){
    rock.x+=rock.vx/60;rock.y+=rock.vy/60;
    if(!M.contact(mother,rock))continue;
    const old={x:mother.x,y:mother.y,vx:mother.vx},hit=M.separate(mother,rock);
    assert.ok(hit);assert.equal(M.contact(mother,rock),null,'The medium must be separated from the real concave hull');
    assert.ok(Math.hypot(rock.vx,rock.vy)<=190.000001);assert.equal(mother.x,old.x);assert.equal(mother.vx,old.vx,'The heavy ship keeps its crossing route');
    assert.ok((rock.vx-mother.vx)*hit.nx+(rock.vy-mother.vy)*hit.ny>=-1e-5,'Relative velocity leaves the collision surface');
    collided=true;contacts++;break;
  }
  assert.ok(collided,'Every medium size and sampled 3D pose can hit the mothership');
}
const engine=new ctx.window.GalaxyLocalCpu({});engine.start('TEST','facil',1,null,false,1);
assert.equal(engine.mothership,null,'A new CPU match begins with rival combat, not the boss');
assert.equal(engine.needsMothershipBoss(),true,'The level-one boss assets are prepared ahead of the duel');
engine.startMothershipPass();assert.equal(engine.mothership.hp,6);assert.equal(engine.publicState().mothership.hp,6);assert.equal(engine.publicState().mode,'cpu');
assert.ok(engine.mothership.x+M.data.radius<0,'The test ship still enters completely from outside the screen');
const showerAt=engine.firstShower,giantAt=engine.nextGiant;
engine.firstShower=.01;engine.nextGiant=.01;
engine.updateShower(1);engine.updateGiant(1);assert.equal(engine.meteors.length,0);assert.equal(engine.giant,null);assert.equal(engine.firstShower,.01);assert.equal(engine.nextGiant,.01);
for(let tick=0;tick<1900&&engine.mothership;tick++)engine.updateMothership(1/60);
assert.equal(engine.mothership,null,'The whole ship leaves the far edge');
engine.updateShower(1);engine.updateGiant(1);assert.ok(engine.showerLeft>0);assert.ok(engine.giant,'Paused hazards resume after the pass');
engine.stop();assert.equal(engine.mothership,null);
engine.start('TEST','facil',1,null,false,2);assert.equal(engine.mothership,null,'Later levels do not acquire an automatic test encounter');
engine.startTraining();assert.equal(engine.mothership,null,'Private CPU training excludes the encounter');
const host=new ctx.window.GalaxyHostPhysics({});host.start([{i:0,n:'A'},{i:1,n:'B'}]);assert.ok(!('mothership'in host.publicState()),'Online simulation and wire format stay unchanged');
// Enemy hits use the same continuous triangular player/shield profile as normal bullets.
engine.start('TEST','facil',1,null,false,1);engine.mothership=null;engine.asteroids=[];engine.flares=[];
const victim=engine.players[0];victim.x=960;victim.y=540;victim.px=960;victim.py=540;victim.rot=0;victim.protection=0;victim.spawnFx=0;victim.shield=0;
engine.bullets=[{id:7001,owner:-2,x:960,y:350,px:960,py:350,vx:0,vy:24000,age:0,travel:0,guided:false}];
engine.updateBullets(1/60);assert.equal(victim.dead,true);assert.equal(engine.bullets.length,0,'Fast enemy shots cannot cross the nose without damage');
assert.equal(engine.players[1].kills,0,'Mothership damage never credits an unrelated CPU');
engine.bullets=[
  {id:7002,owner:-2,mothership:true,x:850,y:100,vx:6000,vy:0,age:.5,travel:0,guided:false},
  {id:7003,owner:0,x:1050,y:100,vx:-6000,vy:0,age:.5,travel:0,guided:true,target:-1}
];
engine.updateBullets(1/60);assert.equal(engine.bullets.length,0,'An enemy bullet and a player missile follow the original interception rules');
engine.mothership=M.create(811);engine.mothership.x=engine.mothership.px=960;
engine.fxEvents=[];
engine.bullets=[
  {id:7004,owner:-2,mothership:true,x:960,y:540,vx:600,vy:0,guided:false},
  {id:7005,owner:0,x:300,y:540,vx:60000,vy:0,guided:false}
];
const impact=M.circleSweep(engine.mothership,{px:300,py:540,x:1300,y:540},4);
engine.absorbMothershipShots(1/60);assert.equal(engine.bullets.length,1);assert.equal(engine.bullets[0].owner,-2,'Mounted guns can fire over their own deck; player shots stop at the real hull');
assert.equal(engine.fxEvents.length,1,'A normal bullet produces one existing local particle explosion');
assert.equal(engine.fxEvents[0].kind,'explosion');
assert.ok(Math.hypot(engine.fxEvents[0].x-impact.x,engine.fxEvents[0].y-impact.y)<.08,'The effect starts at the swept contact point, not the end of a fast bullet');
engine.absorbMothershipShots(1/60);assert.equal(engine.fxEvents.length,1,'Consumed bullets and own mounted guns cannot repeat an impact');
engine.fxEvents=[];engine.bullets=[{id:7100,owner:0,x:300,y:950,vx:60000,vy:0,guided:false}];
engine.absorbMothershipShots(1/60);assert.equal(engine.bullets.length,1);assert.equal(engine.fxEvents.length,0,'A near miss has no phantom explosion');
engine.bullets=[{id:7101,owner:1,x:300,y:540,vx:60000,vy:0,guided:true}];
engine.absorbMothershipShots(1/60);assert.equal(engine.fxEvents.length,1);assert.equal(engine.fxEvents[0].kind,'disintegrate','Missiles retain their original particle effect');
engine.mothership.hp=engine.mothership.maxHp=100; // Synthetic endurance target for the existing bounded-FX stress case.
engine.fxEvents=[];engine.bullets=Array.from({length:80},(_,i)=>({id:7200+i,owner:i%2,x:300,y:540,vx:60000,vy:0,guided:false}));
engine.absorbMothershipShots(1/60);assert.equal(engine.bullets.length,0);assert.equal(engine.fxEvents.length,32,'High cadence reuses the existing bounded local FX queue');
assert.ok(engine.publicState().fx.every(e=>e.kind==='explosion'),'The normal CPU renderer receives the existing explosion effect without a new event type');
engine.finished=true;assert.equal(engine.restart(),true);assert.equal(engine.mothership,null,'Repeating starts rival combat again');assert.equal(engine.bossEncounter,null);
assert.equal(engine.bullets.length,0,'Repeating clears the prior volley');
const gameSource=await source('game');assert.ok(gameSource.includes("if(roomCode==='LOCAL'&&localCpu?.needsMothershipBoss())await window.Galaxy3D.prepareMothership();"),'Startup prepares the level boss before rival combat');
// Six bullet-equivalent HP, exercised through real projectile/flare collision paths.
assert.equal(M.MAX_HP,6);assert.equal(M.DAMAGE.bullet,1);assert.equal(M.DAMAGE.missile,3);assert.equal(M.DAMAGE.flare,2);
const resetHealthTarget=(direction=1)=>{
  engine.mothership=M.create(820,direction);engine.mothership.x=engine.mothership.px=960;
  engine.fxEvents=[];engine.bullets=[];engine.flares=[];engine.asteroids=[];return engine.mothership;
};
const healthHit=(weapon,direction=1)=>{
  if(weapon==='flare'){
    engine.flares=[{id:830,owner:0,x:960,y:540,vx:0,vy:0,angle:0,life:3,ownerSafe:1}];engine.updateFlares(1/60);engine.absorbMothershipFlares();
    assert.equal(engine.flares.length,0,'Each colliding flare is consumed once');
  }else{
    engine.bullets=[{id:831,owner:0,x:direction>0?300:1600,y:540,vx:direction*60000,vy:0,guided:weapon==='missile'}];
    engine.absorbMothershipShots(1/60);assert.equal(engine.bullets.length,0,'Each colliding player shot is consumed once');
  }
};
let healthCombinations=0;
for(const direction of [-1,1])for(let bullets=0;bullets<=6;bullets++)for(let missiles=0;missiles<=2;missiles++)for(let flares=0;flares<=3;flares++){
  if(bullets+missiles*3+flares*2!==6)continue;
  const mother=resetHealthTarget(direction),kills=engine.players.map(p=>p.kills),weapons=[...Array(bullets).fill('bullet'),...Array(missiles).fill('missile'),...Array(flares).fill('flare')];
  assert.equal(mother.hp,6);assert.equal(mother.maxHp,6);let expected=6;
  for(const weapon of weapons){
    healthHit(weapon,direction);expected-=M.DAMAGE[weapon];assert.equal(mother.hp,expected);
    if(expected>0){assert.equal(engine.mothership,mother);assert.equal(engine.publicState().mothership.hp,expected);assert.equal(engine.publicState().mothership.maxHp,6);}
    else {assert.equal(engine.mothership,null);assert.equal(engine.publicState().mothership,null);}
  }
  assert.deepEqual(engine.players.map(p=>p.kills),kills,'A boss destruction does not invent player kills or finish the PvP score');
  const effects=engine.fxEvents.length;assert.equal(engine.damageMothership(mother,'missile',0),false);assert.equal(engine.fxEvents.length,effects,'A dead hull cannot explode twice');
  engine.updateMothership(10);assert.equal(engine.bullets.length,0,'Destroyed turrets cannot fire another volley');healthCombinations++;
}
let mother=resetHealthTarget();
engine.bullets=[{id:840,owner:-2,mothership:true,x:960,y:540,vx:600,vy:0,guided:false}];engine.absorbMothershipShots(1/60);assert.equal(mother.hp,6,'Mounted guns do not damage their own hull');
engine.bullets=[{id:841,owner:0,x:300,y:950,vx:60000,vy:0,guided:true}];engine.absorbMothershipShots(1/60);assert.equal(mother.hp,6,'A missile near miss cannot damage the hull');
engine.flares=[{id:842,owner:0,x:960,y:950,vx:0,vy:0,angle:0,life:3}];engine.updateFlares(1/60);engine.absorbMothershipFlares();assert.equal(mother.hp,6,'A flare near miss remains a miss');
engine.flares=[{id:843,owner:0,x:960,y:540,vx:0,vy:0,angle:0,life:.001}];engine.updateFlares(1/60);engine.absorbMothershipFlares();assert.equal(mother.hp,6,'An expired flare cannot damage the boss');
for(const direction of [-1,1]){
  mother=resetHealthTarget(direction);mother.px=direction>0?450:1470;mother.x=direction>0?1470:450;
  healthHit('flare',direction);assert.equal(mother.hp,4,'The moving hull sweeps stationary flares between snapshots');
}
mother=resetHealthTarget();engine.bullets=Array.from({length:80},(_,i)=>({id:850+i,owner:0,x:300,y:540,vx:60000,vy:0,guided:false}));
engine.absorbMothershipShots(1/60);assert.equal(mother.hp,0);assert.equal(engine.mothership,null);assert.equal(engine.bullets.length,74,'Only the first six hits are absorbed; the destroyed hull cannot eat the rest');
assert.ok(engine.fxEvents.length<=32,'The destruction uses the existing bounded local effect queue');
engine.firstShower=.01;engine.nextGiant=.01;engine.giant=null;engine.meteors=[];engine.showerLeft=0;
engine.updateShower(1);engine.updateGiant(1);assert.ok(engine.giant);assert.ok(engine.showerLeft>0,'Paused hazards resume when the boss is destroyed too');
// The panel is inside the actual recessed floor and inherits the complete 3D pose.
const fills=[],texts=[],healthContext={fillRect(...args){fills.push(args);},strokeRect(){},strokeText(){},fillText(...args){texts.push(args);}};
const canvas={getContext:()=>healthContext},healthVisual=factory(),health=createMothershipHealth(healthVisual,canvas),healthRoot=new T.Group();healthRoot.add(healthVisual);
assert.equal(canvas.width,384);assert.equal(canvas.height,48);assert.equal(health.mesh.parent.name,'AEGIS_Hull');assert.equal(health.mesh.material.depthTest,true);assert.equal(health.mesh.material.toneMapped,false);
const texture=health.mesh.material.map;
for(let hp=1;hp<=6;hp++){fills.length=0;texts.length=0;health.update({hp,maxHp:6});assert.equal(health.mesh.visible,true);assert.ok(Math.abs(fills[1][2]-374*hp/6)<1e-9);assert.equal(texts[0][0],hp+' / 6');const version=texture.version;health.update({hp,maxHp:6});assert.equal(texture.version,version,'Unchanged life does not repaint/upload the texture every frame');}
for(const body of [null,{hp:0,maxHp:6},{hp:6,maxHp:0},{}]){health.update(body);assert.equal(health.mesh.visible,false,'The panel hides when its health is absent/dead');}
health.update({hp:6,maxHp:6});assert.equal(health.mesh.visible,true,'Reusing a pooled model restores its panel');
for(const direction of [-1,1])for(const yaw of [-8,0,8])for(const bank of [-15,0,15]){
  const body=M.create(950,direction);body.x=1234;body.y=456;body.angle+=yaw*Math.PI/180;body.bank=bank*Math.PI/180;
  healthRoot.position.set(body.x-960,540-body.y,0);setMothershipPose(healthVisual,body);healthRoot.updateMatrixWorld(true);
  const at=health.mesh.getWorldPosition(new T.Vector3()),u=new T.Vector3(1,0,0).transformDirection(health.mesh.matrixWorld),normal=new T.Vector3(0,0,1).transformDirection(health.mesh.matrixWorld);
  const localX=((0-D.center[0])*Math.cos(body.bank)+(1.06-D.center[1])*Math.sin(body.bank))*D.scale,localY=(1-D.center[2])*D.scale;
  const expected=new T.Vector3(body.x-960+localX*Math.cos(body.angle)-localY*Math.sin(body.angle),540-body.y-localX*Math.sin(body.angle)-localY*Math.cos(body.angle),at.z);
  assert.ok(at.distanceTo(expected)<1e-7,'The inset anchor follows the same projection as the calibrated hull');
  assert.ok(u.dot(new T.Vector3(Math.sin(body.angle),Math.cos(body.angle),0))>1-1e-10,'The bar rotates along the ship length, not screen horizontal');
  assert.ok(normal.dot(new T.Vector3(Math.sin(body.bank)*Math.cos(body.angle),-Math.sin(body.bank)*Math.sin(body.angle),Math.cos(body.bank)))>1-1e-10,'The panel follows bank/perspective instead of facing the camera');
}
const healthHull=health.mesh.parent,ray=new T.Raycaster();
for(const x of [-.25,0,.25])for(const z of [-1.3,1,3.3]){
  const origin=healthHull.localToWorld(new T.Vector3(x,10,z)),direction=new T.Vector3(0,-1,0).transformDirection(healthHull.matrixWorld);ray.set(origin,direction);
  const hit=ray.intersectObject(healthHull,false)[0];assert.ok(hit);const floor=healthHull.worldToLocal(hit.point);
  assert.ok(floor.y>.9&&floor.y<1.01,'The full panel footprint fits the recessed floor, away from the surrounding deck');assert.ok(1.06-floor.y>.04,'A small physical gap prevents z-fighting');
}
assert.equal(factory().getObjectByName('nodriza-vida'),undefined,'Decorative menu factories do not inherit gameplay panels');
assert.ok(!gameSource.includes('drawMothershipHealth'),'The old fixed screen HUD is removed');
console.log(`Mothership health OK: ${healthCombinations} lethal weapon combinations, 6 HP, bullet/missile/flare 1/3/2 damage, continuous impacts, one-time destruction, inset 3D panel with full pose, conditional texture uploads and no network authority changes.`);
console.log(`Mothership OK: replacement GLB at 540 units, four turrets and no central gun, smooth +/-15 bank and +/-8 heading, 31 matching hulls, calibrated turning muzzles, ${sectorCases} nearest-sector cases, unique targets, ${totalVolleys} spaced twin volleys at 400 units/s, ${contacts} irregular contacts, shield/missile rules and CPU-only lifecycle.`);
