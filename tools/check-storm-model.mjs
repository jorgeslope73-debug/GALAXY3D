import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {createStormFactory,prepareStormTemplate,STORM_VISUAL_RADII} from '../docs/storm-model.js';
const templates={};
for(const [kind,file,expected] of [['core','nucleo.glb',5364],['satellite','satelite.glb',1060]]){
  const bytes=fs.readFileSync('docs/assets/models/'+file),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
  assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<2*1024*1024);
  assert.equal(json.images.length,2);assert.ok(json.images.every(image=>image.mimeType==='image/png'&&Number.isInteger(image.bufferView)&&!image.uri));
  assert.ok(json.buffers.every(buffer=>!buffer.uri));assert.equal(json.animations?.length||0,0);assert.equal(json.cameras?.length||0,0);
  const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  let triangles=0;gltf.scene.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});assert.equal(triangles,expected);
  templates[kind]=prepareStormTemplate(T,gltf.scene,kind);templates[kind].updateMatrixWorld(true);
  let radius=0;const v=new T.Vector3();templates[kind].traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);radius=Math.max(radius,Math.hypot(v.x,v.y));}}});
  assert.ok(Math.abs(radius-STORM_VISUAL_RADII[kind])<1e-5,'rendered hull radius matches authority contacts');
  const front=new T.Vector3(0,1,0).transformDirection(templates[kind].children[0].matrix);assert.ok(front.z>.9999,'front faces the orthographic game camera');
}
const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/storm-core.js','utf8'),ctx);
const S=ctx.window.GalaxyStormCore;
assert.equal(STORM_VISUAL_RADII.core,S.CORE_RADIUS);assert.equal(STORM_VISUAL_RADII.satellite,S.SATELLITE_RADIUS);
for(const reducedMotion of [false,true]){
  const environment=new T.Texture(),create=createStormFactory(T,{templates,environment,mobile:true,reducedMotion}),visual=create(),second=create(),body=S.create(1);
  assert.equal(visual.root.getObjectByName('CORE_Hull').geometry,second.root.getObjectByName('CORE_Hull').geometry);
  assert.notEqual(visual.root.getObjectByName('CORE_Energy_Panels').material,second.root.getObjectByName('CORE_Energy_Panels').material);
  assert.equal(visual.root.getObjectByName('CORE_Hull').material.map,templates.core.getObjectByName('CORE_Hull').material.map);
  assert.equal(visual.root.getObjectByName('CORE_Hull').material.envMap,environment);
  for(let i=2;i<=6;i++)assert.equal(visual.root.getObjectByName('TURRET_01_Hull').geometry,visual.root.getObjectByName('TURRET_0'+i+'_Hull').geometry);
  const geometries=new Set(),materials=new Set();visual.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
  const before=JSON.stringify(S.snapshot(body)),target={x:230,y:400};let id=0;
  for(let frame=0;frame<720;frame++){
    if(frame===200)for(let i=0;i<3;i++)S.damage(body,i,'missile');
    if(frame===400)S.damage(body,-1,'missile');
    S.step(body,1/60,target,()=>++id);const state=S.snapshot(body),serialized=JSON.stringify(state);visual.update(state);second.update(state);
    assert.equal(JSON.stringify(state),serialized,'presentation never mutates the authority snapshot');
    visual.root.updateMatrixWorld(true);
    visual.root.traverse(o=>{if(o.geometry)assert.ok(geometries.has(o.geometry),'all frames reuse geometry');assert.ok(o.matrixWorld.elements.every(Number.isFinite));});
  }
  assert.notEqual(JSON.stringify(S.snapshot(body)),before);assert.ok(geometries.size<=17);assert.ok(materials.size<=13);
  const box=new T.Box3().setFromObject(visual.root);assert.ok(!box.isEmpty());assert.ok(box.max.z<150,'the model remains on the gameplay plane');
  visual.update(null);assert.equal(visual.root.visible,false);
  let disposed=0;for(const material of materials)material.addEventListener('dispose',()=>disposed++);create.dispose();assert.equal(disposed,materials.size,'owned animated materials and effects are released');
}
const render=fs.readFileSync('docs/render-3d.js','utf8');assert.ok(render.includes('api.storm({id:\'warm-storm\''),'all attack and material variants are part of shader prewarming');
assert.ok(render.includes("+(createStorm?':storm':'')"),'loading the CPU model invalidates the previously warmed viewport');
assert.ok(!render.includes("modelLoads.push(import('./storm-model.js"),'online/menu startup does not download phase-three GLBs');
console.log('Storm GLBs OK: embedded textures, exact contact radii, camera orientation, shared torrets/satellites, isolated materials, finite transforms, reduced motion, immutable snapshots, disposal and deferred GPU prewarming.');
