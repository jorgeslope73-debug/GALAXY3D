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
assert.ok(bytes.length<1.5*1024*1024);assert.equal(D.turrets.length,5);
assert.ok(D.profiles[0].outline.length>20,'Use the real concave hull, not a circle or bounding box');
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const original=gltf.scene.getObjectByName('AEGIS_Hull').material;
const template=prepareMothershipTemplate(gltf.scene,D),environment=new T.Texture(),factory=createMothershipFactory(template,D,environment),a=factory(),b=factory();
let triangles=0,meshes=0;a.traverse(o=>{if(!o.isMesh)return;meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;assert.equal(o.material.map,original.map);assert.equal(o.material.metalnessMap,original.metalnessMap);assert.equal(o.material.emissiveMap,original.emissiveMap);assert.equal(o.material.emissiveIntensity,original.emissiveIntensity);assert.equal(o.material.envMap,environment);});
assert.equal(meshes,6);assert.equal(triangles,14188);
const body=M.create(99);body.x=960;body.y=540;
for(const direction of [1,-1])for(const angle of [0,.7,2.2,4.9]){
  body.angle=direction*Math.PI/2;
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
body.angle=Math.PI/2;body.vx=0;body.age=10;
const player={index:0,x:1400,y:100,vx:0,vy:0,protection:0,spawnFx:0,camo:0,dead:false};
body.turrets.forEach((t,i)=>{const p=M.pivot(body,i);t.angle=Math.atan2(player.y-p.y,player.x-p.x);t.nextShot=0;});
let id=1;const volley=M.step(body,1/60,[player],()=>id++).shots;
assert.equal(volley.length,10,'Five turrets each fire exactly two bullets');
for(let i=0;i<5;i++)assert.ok(Math.hypot(volley[i*2].x-volley[i*2+1].x,volley[i*2].y-volley[i*2+1].y)>18,'Twin barrels stay visibly separated');
assert.equal(M.step(body,1/60,[player],()=>id++).shots.length,0,'Cadence is bounded, not a volley every frame');
assert.equal(M.step(body,4,[{...player,dead:true}],()=>id++).shots.length,0);
assert.ok(volley.every(s=>s.owner===-2&&s.guided===false));
// A swept projectile crosses the complete ship in one tick; near misses remain misses.
body.px=body.x;body.py=body.y;
assert.ok(M.circleSweep(body,{px:300,py:540,x:1600,y:540},4));
assert.equal(M.circleSweep(body,{px:300,py:950,x:1600,y:950},4),null);
assert.equal(M.contact(body,{id:71,x:body.x+300,y:body.y+280,r:51.75,spin:0}),null,'Empty bounding-box corners must not produce ghost collisions');
let contacts=0;
for(const r of P.MEDIUM_ROCK_RADII)for(const spin of [0,.7,1.8,3.4,5.6])for(const direction of [-1,1]){
  const mother=M.create(99,direction);mother.x=960;mother.y=540;mother.vx=direction*90;
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
console.log(`Mothership OK: exact GLB, five independent nulls, 10 calibrated muzzle shots, cadence, ${contacts} irregular medium contacts, swept hull/player hits, hazard pause/resume, exit/reset/training and unchanged online state.`);
