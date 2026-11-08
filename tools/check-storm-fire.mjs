import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareStormTemplate,createStormFactory} from '../docs/storm-model.js';
import {readStormGunData} from './build-storm-guns.mjs';
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/storm-core.js','utf8'),context);const S=context.window.GalaxyStormCore;
const practice=fs.readFileSync('docs/prueba-nucleo.js','utf8').replaceAll('\r\n','\n'),practiceStart=practice.indexOf('// storm-core.js\n'),practiceEnd=practice.indexOf('// local-cpu.js\n',practiceStart);
assert.ok(practiceStart>=0&&practiceEnd>practiceStart,'direct practice includes the combat authority');
assert.equal(practice.slice(practiceStart,practiceEnd),'// storm-core.js\n'+fs.readFileSync('docs/storm-core.js','utf8').replaceAll('\r\n','\n')+'\n;\n','direct practice and the campaign use the same core firing logic');
const bytes=fs.readFileSync('docs/assets/models/nucleo.glb'),calibration=await readStormGunData(bytes);
assert.equal(S.GUNS.sha256,calibration.sha256);assert.ok(Math.abs(S.GUNS.scale-calibration.scale)<1e-8);
for(let i=0;i<6;i++)for(let side=0;side<2;side++)for(let k=0;k<3;k++)for(const field of ['base','delta'])assert.ok(Math.abs(S.GUNS.guns[i].muzzles[side][field][k]-calibration.guns[i].muzzles[side][field][k])<1e-7);
async function parse(file){const b=fs.readFileSync('docs/assets/models/'+file),loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const core=await parse('nucleo.glb'),satellite=await parse('satelite.glb'),templates={core:prepareStormTemplate(T,core.scene,'core'),satellite:prepareStormTemplate(T,satellite.scene,'satellite'),shotClip:core.animations.find(c=>c.name==='DISPARO')};
function measuredMuzzle(pivot,side){
 const samples=[];pivot.traverse(o=>{if(!o.isMesh||!o.morphTargetInfluences)return;const pos=o.geometry.attributes.position;for(let k=0;k<pos.count;k++){const raw=new T.Vector3().fromBufferAttribute(pos,k);if(Math.abs(raw.x-(side?1:-1)*.205)<.14&&Math.abs(raw.y-.32)<.15)samples.push({o,k,raw});}});
 const front=Math.min(...samples.map(s=>s.raw.z)),seen=new Set(),center=new T.Vector3();let n=0;
 for(const s of samples){if(s.raw.z>front+1e-5)continue;const key=s.raw.toArray().map(x=>x.toFixed(6)).join(',');if(seen.has(key))continue;seen.add(key);const p=new T.Vector3();s.o.getVertexPosition(s.k,p);center.add(p.applyMatrix4(s.o.matrixWorld));n++;}
 return center.divideScalar(n);
}
let cases=0;
for(const dt of [1/30,1/60,1/120])for(const reducedMotion of [false,true])for(const moving of [false,true])for(const hp of [6,2])for(const angle of [-Math.PI,-2,-.1,0,1.5,3.13]){
 const body=S.create(1),factory=createStormFactory(T,{templates,combat:S,reducedMotion}),visual=factory();
 for(let i=0;i<3;i++)S.damage(body,i,'missile');body.nextAt=0;body.hp=hp;
 const target={x:body.x+Math.cos(angle)*800,y:body.y+Math.sin(angle)*800};let fired=[],id=0,seenLead=false;
 for(let tick=0;tick<Math.ceil(2/dt)&&!fired.length;tick++){
  if(moving){target.x=960+Math.cos(angle+.35*tick*dt)*800;target.y=525+Math.sin(angle+.35*tick*dt)*800;}
  const previous=body.turrets.map(t=>t.angle);fired=S.step(body,dt,target,()=>++id);
  body.turrets.forEach((t,i)=>assert.ok(Math.abs(t.angle-previous[i])<=2.8*dt+1e-9,'bounded angular speed, including +/-PI'));
  visual.update(S.snapshot(body));visual.root.position.set(body.x,-body.y,0);visual.root.updateMatrixWorld(true);
  if(body.warning&&body.warning.remaining>S.GUNS.lead+1e-6)assert.equal(S.shotWeight(body.clipTime),0,'animation does not run early');
  if(body.warning&&S.shotWeight(body.clipTime)>0)seenLead=true;
  if(body.warning){assert.equal(body.warning.targetX,target.x,'target X stays live through recoil');assert.equal(body.warning.targetY,target.y,'target Y stays live through recoil');}
 }
 assert.equal(fired.length,hp===2?7:5);assert.ok(seenLead);assert.ok(S.shotWeight(body.clipTime)>.9,'recoil peak coincides with release');
 const morphs=[];visual.root.traverse(o=>{if(o.morphTargetInfluences)morphs.push(o);});assert.equal(morphs.length,12);for(const m of morphs)assert.ok(Math.abs(m.morphTargetInfluences[0]-S.shotWeight(body.clipTime))<1e-5,'every linked primitive animates');
 for(const shot of fired){
  const pivot=visual.root.getObjectByName('TURRET_'+String(shot.turret+1).padStart(2,'0')+'_PIVOT'),point=measuredMuzzle(pivot,shot.side);
  assert.ok(Math.hypot(point.x-shot.x,-point.y-shot.y,point.z-shot.z)<1e-4,'bullet starts at the deformed GLB muzzle');
  const hull=pivot.children.find(o=>o.name.includes('Hull')),forward=new T.Vector3(0,0,-1).transformDirection(hull.matrixWorld);
  assert.ok((forward.x*shot.vx-forward.y*shot.vy)/330>.999999,'bullet follows the real barrel direction');
  const spread=Math.atan2(shot.vy,shot.vx)-Math.atan2(fired[0].vy,fired[0].vx);
  assert.ok(Math.abs(Math.atan2(Math.sin(spread),Math.cos(spread)))<=.221,'fan remains shallow');
 }
 checkLanes(fired,target);
 for(let tick=0;tick<Math.ceil(.6/dt);tick++){const previous=body.turrets.map(t=>t.angle);S.step(body,dt,target,()=>++id);body.turrets.forEach((t,i)=>assert.ok(Math.abs(t.angle-previous[i])<=2.8*dt+1e-9,'return to idle cannot snap'));}
 visual.update(S.snapshot(body));visual.root.traverse(o=>{if(o.morphTargetInfluences)assert.equal(o.morphTargetInfluences[0],0,'recoil returns to rest');});factory.dispose();cases++;
}
function checkLanes(shots,target){
 const center=shots[0],nx=-center.vy/330,ny=center.vx/330;
 assert.ok(Math.abs((target.x-center.x)*nx+(target.y-center.y)*ny)<.02,'central bullet follows the latest target position');
 const lanes=shots.map(s=>(s.x+s.vx-center.x-center.vx)*nx+(s.y+s.vy-center.y-center.vy)*ny);
 assert.ok(Math.min(...lanes)<-30&&Math.max(...lanes)>30,'fan covers both sides of the central lane');
 const width=t=>{const p=shots.map(s=>(s.x+s.vx*t-center.x)*nx+(s.y+s.vy*t-center.y)*ny);return Math.max(...p)-Math.min(...p);};
 assert.ok(width(1)>width(0)+60,'fan expands by covering more space during flight');
 assert.ok(width(2)>width(1),'fan keeps spreading instead of converging');
 for(let i=0;i<shots.length;i++)for(let j=i+1;j<shots.length;j++){
  const a=shots[i],b=shots[j],gap=Math.hypot(a.x-b.x,a.y-b.y);
  assert.ok(gap>12,'individual bullets leave physical space between each other');
 }
}
for(let degrees=0;degrees<360;degrees++)for(const hp of [6,2]){
 const b=S.create(1);for(let slot=0;slot<3;slot++)S.damage(b,slot,'missile');b.hp=hp;b.nextAt=0;
 const angle=degrees*Math.PI/180,target={x:b.x+Math.cos(angle)*800,y:b.y+Math.sin(angle)*800};let shots=[],id=0;
 for(let tick=0;tick<120&&!shots.length;tick++)shots=S.step(b,1/60,target,()=>++id);
 assert.equal(shots.length,hp===2?7:5);checkLanes(shots,target);
}
let satelliteCases=0;
for(const dt of [1/30,1/60,1/120])for(const motion of ['still','moving','reverse','stop','fast','missing']){
 const body=S.create(1),target={x:250,y:350,vx:0,vy:motion==='still'?0:240};body.nextAt=0;
 if(motion==='missing'){delete target.vx;delete target.vy;}
 let shots=[],id=0,sawLead=false,sawChange=false;
 for(let tick=0;tick<Math.ceil(1.2/dt)&&!shots.length;tick++){
  if(motion==='reverse'&&tick*dt>.45){target.vy=-240;sawChange=true;}
  if(motion==='stop'&&tick*dt>.45){target.vy=0;sawChange=true;}
  if(motion==='fast')target.vy=10000;
  if(motion!=='fast')target.y+=(target.vy||0)*dt;
  shots=S.step(body,dt,target,()=>++id);
  if(body.warning){
   const w=S.snapshot(body).warning,dx=w.targetX-target.x,dy=w.targetY-target.y;
   assert.ok(Math.hypot(dx,dy)<=75+1e-7,'satellite lead stays modest even at extreme speeds');
   if(target.vy){assert.ok(dy*target.vy>0,'vector leads in the current movement direction');assert.ok(Math.abs(dx)<1e-8);sawLead=true;}
   else{assert.equal(dx,0);assert.equal(dy,0,'stopping or missing velocity removes anticipation');}
   if(motion==='reverse'&&sawChange)assert.ok(w.targetY<target.y,'reversal updates the defensive vector before release');
  }
 }
 assert.equal(shots.length,1);assert.equal(shots[0].guided,false);
 if(motion!=='still'&&motion!=='missing')assert.ok(sawLead);
 if(motion==='reverse'||motion==='stop')assert.ok(sawChange);
 const shot=shots[0],dx=shot.vx/330,dy=shot.vy/330,along=(target.x-shot.x)*dx+(target.y-shot.y)*dy;
 const closest={x:shot.x+dx*along,y:shot.y+dy*along};
 if(target.vy)assert.ok((closest.y-target.y)*target.vy>0,'released bullet follows the predicted vector');
 else assert.ok(Math.hypot(closest.x-target.x,closest.y-target.y)<1e-6,'stationary target receives no artificial lead');
 satelliteCases++;
}
console.log('Storm fire OK: '+cases+' core visual/frame-rate cases, 720 full-circle volleys and '+satelliteCases+' defensive satellite tracking cases; live bounded prediction, stops/reversals, shallow fan, exact GLB muzzles and continuous aim.');
