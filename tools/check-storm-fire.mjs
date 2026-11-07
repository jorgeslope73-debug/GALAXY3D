import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareStormTemplate,createStormFactory} from '../docs/storm-model.js';
import {readStormGunData} from './build-storm-guns.mjs';
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/storm-core.js','utf8'),context);const S=context.window.GalaxyStormCore;
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
for(const dt of [1/30,1/60,1/120])for(const reducedMotion of [false,true])for(const angle of [-Math.PI,-2,-.1,0,1.5,3.13]){
 const body=S.create(1),factory=createStormFactory(T,{templates,combat:S,reducedMotion}),visual=factory();
 for(let i=0;i<3;i++)S.damage(body,i,'missile');body.nextAt=0;
 const target={x:body.x+Math.cos(angle)*800,y:body.y+Math.sin(angle)*800};let fired=[],id=0,seenLead=false;
 for(let tick=0;tick<Math.ceil(2/dt)&&!fired.length;tick++){
  const previous=body.turrets.map(t=>t.angle);fired=S.step(body,dt,target,()=>++id);
  body.turrets.forEach((t,i)=>assert.ok(Math.abs(t.angle-previous[i])<=2.8*dt+1e-9,'bounded angular speed, including +/-PI'));
  visual.update(S.snapshot(body));visual.root.position.set(body.x,-body.y,0);visual.root.updateMatrixWorld(true);
  if(body.warning&&body.warning.remaining>S.GUNS.lead+1e-6)assert.equal(S.shotWeight(body.clipTime),0,'animation does not run early');
  if(body.warning&&S.shotWeight(body.clipTime)>0)seenLead=true;
 }
 assert.equal(fired.length,5);assert.ok(seenLead);assert.ok(S.shotWeight(body.clipTime)>.9,'recoil peak coincides with release');
 const morphs=[];visual.root.traverse(o=>{if(o.morphTargetInfluences)morphs.push(o);});assert.equal(morphs.length,12);for(const m of morphs)assert.ok(Math.abs(m.morphTargetInfluences[0]-S.shotWeight(body.clipTime))<1e-5,'every linked primitive animates');
 for(const shot of fired){
  const pivot=visual.root.getObjectByName('TURRET_'+String(shot.turret+1).padStart(2,'0')+'_PIVOT'),point=measuredMuzzle(pivot,shot.side);
  assert.ok(Math.hypot(point.x-shot.x,-point.y-shot.y,point.z-shot.z)<1e-4,'bullet starts at the deformed GLB muzzle');
  const hull=pivot.children.find(o=>o.name.includes('Hull')),forward=new T.Vector3(0,0,-1).transformDirection(hull.matrixWorld);
  assert.ok((forward.x*shot.vx-forward.y*shot.vy)/330>.999999,'bullet follows the real barrel direction');
  assert.ok(Math.abs(Math.atan2(Math.sin(Math.atan2(target.y-shot.y,target.x-shot.x)-Math.atan2(shot.vy,shot.vx)),Math.cos(Math.atan2(target.y-shot.y,target.x-shot.x)-Math.atan2(shot.vy,shot.vx))))<.03,'aim converges on the announced point');
 }
 for(let tick=0;tick<Math.ceil(.6/dt);tick++){const previous=body.turrets.map(t=>t.angle);S.step(body,dt,target,()=>++id);body.turrets.forEach((t,i)=>assert.ok(Math.abs(t.angle-previous[i])<=2.8*dt+1e-9,'return to idle cannot snap'));}
 visual.update(S.snapshot(body));visual.root.traverse(o=>{if(o.morphTargetInfluences)assert.equal(o.morphTargetInfluences[0],0,'recoil returns to rest');});factory.dispose();cases++;
}
console.log('Storm fire OK: '+cases+' frame-rate/aim/reduced-motion cases, authored recoil, twelve morph instances, exact muzzle origins, real barrel directions and continuous aim/return.');
