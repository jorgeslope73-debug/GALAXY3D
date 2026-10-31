import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareMothershipTemplate,createMothershipFactory,setMothershipPose} from '../docs/mothership-model.js';
const source=async name=>readFile(new URL('../docs/'+name+'.js',import.meta.url),'utf8');
const ctx=vm.createContext({window:{},console,Date,performance,setTimeout,clearTimeout});
for(const name of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','shot-history','host-physics','local-cpu'])vm.runInContext(await source(name),ctx,{filename:name+'.js'});
const M=ctx.window.GalaxyMothership,P=ctx.window.GalaxyPhysicsCore,D=M.data;
const bytes=await readFile(new URL('../docs/assets/models/nodriza.glb',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),D.sha256,'Physics calibration must match the exact supplied GLB');
assert.equal(D.length,540,'The calibrated ship is ten percent smaller than its previous 600-unit length');
assert.ok(bytes.length<1.5*1024*1024);assert.equal(D.turrets.length,5);
assert.ok(D.profiles[0].outline.length>20,'Use the real concave hull, not a circle or bounding box');
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const original=gltf.scene.getObjectByName('AEGIS_Hull').material;
const template=prepareMothershipTemplate(gltf.scene,D),environment=new T.Texture(),factory=createMothershipFactory(template,D,environment),a=factory(),b=factory();
let triangles=0,meshes=0;a.traverse(o=>{if(!o.isMesh)return;meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;assert.equal(o.material.map,original.map);assert.equal(o.material.metalnessMap,original.metalnessMap);assert.equal(o.material.emissiveMap,original.emissiveMap);assert.equal(o.material.emissiveIntensity,original.emissiveIntensity);assert.equal(o.material.envMap,environment);});
assert.equal(meshes,6);assert.equal(triangles,14188);
const body=M.create(99);body.x=960;body.y=540;
for(const direction of [1,-1])for(const yaw of [-8,0,8])for(const bank of [-15,-7.5,0,7.5,15])for(const angle of [0,.7,2.2,4.9]){
  body.angle=direction*Math.PI/2+yaw*Math.PI/180;
  body.bank=bank*Math.PI/180;
  body.turrets.forEach((t,i)=>t.angle=angle+i*.23);
  setMothershipPose(a,body);a.position.set(body.x,-body.y,0);a.updateMatrixWorld(true);
  for(let i=0;i<5;i++){
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
  for(const [x,y,allowed]of [[0,-650,[3,4]],[0,650,[0,1]],[-650,0,[0,3]],[650,0,[1,4]]]){
    const target=targetAt(mother,7,x,y);M.assignTargets(mother,[target]);
    const gun=assignedGun(mother,7);assert.ok(allowed.includes(gun),'The arrival direction chooses the front, aft, upper or lower pair');
    const distance=index=>{const p=M.pivot(mother,index);return Math.hypot(target.x-p.x,target.y-p.y);};
    assert.ok(Math.abs(distance(gun)-Math.min(...allowed.map(distance)))<1e-8,'The nearest valid turret is selected');
    assert.equal(mother.turrets.filter(t=>t.target>=0).length,1);assert.equal(mother.turrets[2].target,-1);sectorCases++;
  }
  const corners=[targetAt(mother,0,-650,-650),targetAt(mother,1,650,-650),targetAt(mother,2,-650,650),targetAt(mother,3,650,650)];
  M.assignTargets(mother,corners);assert.deepEqual([0,1,2,3].map(i=>assignedGun(mother,i)),[3,4,0,1],'The four diagonal objectives use their own corner guns');
  M.assignTargets(mother,[targetAt(mother,10,0,-650),targetAt(mother,11,-650,-650)]);
  assert.equal(assignedGun(mother,10),4);assert.equal(assignedGun(mother,11),3,'A shared front-axis target cannot steal the only suitable mount of another objective');
  for(const [x,y,expected]of [[-650,-650,3],[-650,650,0],[650,650,1],[650,-650,4]]){
    M.assignTargets(mother,[targetAt(mother,25,x,y)]);assert.equal(assignedGun(mother,25),expected,'Sector changes transfer the target immediately, without the old seven-second wait');
  }
}
const crossing=M.create(92);crossing.x=crossing.px=960;crossing.vx=0;crossing.age=-1/60;
const crossingTarget={...player,x:1400,y:540,vx:-1000,vy:0};
crossing.turrets.forEach((t,i)=>{const p=M.pivot(crossing,i);t.angle=Math.atan2(crossingTarget.y-p.y,crossingTarget.x-p.x);});
M.step(crossing,1/60,[crossingTarget],()=>id++);
const crossingGun=assignedGun(crossing,0),crossingPivot=M.pivot(crossing,crossingGun);
assert.ok(Math.abs(crossing.turrets[crossingGun].angle-Math.atan2(crossingTarget.y-crossingPivot.y,crossingTarget.x-crossingPivot.x))<1e-8,'Prediction cannot make a front gun aim into the opposite sector');
// No two active guns share a player. Spare sectors and the centre stay idle.
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
    assert.equal(mother.turrets[2].target,-1,'The central turret remains on standby');
    assert.ok(result.shots.length===0||result.shots.length===2,'No simultaneous mass volleys or catch-up bursts');
    if(!result.shots.length)continue;
    const guns=mother.turrets.map((t,i)=>t.nextShot!==before[i]?i:-1).filter(i=>i>=0);
    assert.equal(guns.length,1);assert.notEqual(guns[0],2,'The central turret never fires');
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
assert.ok(engine.mothership,'A new CPU match starts with the test encounter');
assert.ok(engine.publicState().mothership);assert.equal(engine.publicState().mode,'cpu');
const showerAt=engine.firstShower,giantAt=engine.nextGiant;
engine.firstShower=.01;engine.nextGiant=.01;
engine.updateShower(1);engine.updateGiant(1);assert.equal(engine.meteors.length,0);assert.equal(engine.giant,null);assert.equal(engine.firstShower,.01);assert.equal(engine.nextGiant,.01);
for(let tick=0;tick<1900&&engine.mothership;tick++)engine.updateMothership(1/60);
assert.equal(engine.mothership,null,'The whole ship leaves the far edge');
engine.updateShower(1);engine.updateGiant(1);assert.ok(engine.showerLeft>0);assert.ok(engine.giant,'Paused hazards resume after the pass');
engine.stop();assert.equal(engine.mothership,null);
engine.start('TEST','facil',1,null,false,2);assert.equal(engine.mothership,null,'The temporary test trigger is confined to the opening level');
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
engine.bullets=[
  {id:7004,owner:-2,mothership:true,x:960,y:540,vx:600,vy:0,guided:false},
  {id:7005,owner:0,x:300,y:540,vx:60000,vy:0,guided:false}
];
engine.absorbMothershipShots(1/60);assert.equal(engine.bullets.length,1);assert.equal(engine.bullets[0].owner,-2,'Mounted guns can fire over their own deck; player shots stop at the real hull');
engine.finished=true;assert.equal(engine.restart(),true);assert.ok(engine.mothership,'Repeating the opening level restores the test encounter');
assert.equal(engine.bullets.length,0,'Repeating clears the prior volley');
console.log(`Mothership OK: original GLB at 540 units, smooth +/-15 bank and +/-8 heading, 31 matching hulls, calibrated turning muzzles, ${sectorCases} nearest-sector cases, unique targets, idle centre, ${totalVolleys} spaced twin volleys at 400 units/s, ${contacts} irregular contacts, shield/missile rules and CPU-only lifecycle.`);
