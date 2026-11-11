import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareDevourerTemplate,createDevourerFactory,DEVOURER_RADII} from '../docs/devourer-model.js';
const bytes=fs.readFileSync('docs/assets/models/devorador.glb'),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<150000);
assert.ok(json.buffers.every(b=>!b.uri));assert.equal(json.images?.length||0,0);assert.equal(json.cameras?.length||0,0);assert.equal(json.animations?.length||0,0);
assert.ok(!json.nodes.some(n=>n.name==='Cube'||n.name.startsWith('PREVIEW_')),'export excludes Blender defaults and staging objects');
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const templates=Object.fromEntries(['head','segment','joint'].map(kind=>[kind,prepareDevourerTemplate(T,gltf.scene,kind)]));
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/devourer-core.js','utf8'),context);const S=context.window.GalaxyDevourer;
assert.equal(DEVOURER_RADII.head,S.HEAD_RADIUS);assert.equal(DEVOURER_RADII.segment,S.SEGMENT_RADIUS);assert.equal(DEVOURER_RADII.joint,S.JOINT_RADIUS);
for(const [kind,template]of Object.entries(templates)){
  template.updateMatrixWorld(true);const v=new T.Vector3();let r=0;
  template.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);r=Math.max(r,Math.hypot(v.x,v.y));}});
  assert.ok(Math.abs(r-DEVOURER_RADII[kind])<1e-5,'closed GLB envelope matches the authority radius');
}
let triangles=0,draws=0;
for(const reducedMotion of [false,true]){
  const factory=createDevourerFactory(T,{templates,reducedMotion}),actor=factory(),second=factory();
  assert.equal(actor.root.getObjectByName('DEV_HEAD_ARMOR').geometry,second.root.getObjectByName('DEV_HEAD_ARMOR').geometry,'instances share authored geometry');
  const body=S.create('qa');S.step(body,.016,{x:300,y:600},()=>1);let pose=S.snapshot(body);actor.update(pose);
  assert.ok(actor.segments.every(s=>s.shell.visible));assert.ok(actor.jaws.every(j=>j.rotation.y>0));
  const materialOf=root=>{let material;root.traverse(o=>{if(o.isMesh)material=o.material;});return material;};
  const first=materialOf(actor.segments[4].joint);
  const locked=materialOf(actor.segments[3].joint);
  assert.notEqual(first,locked,'the exposed connector has a distinct visible material');
  S.damage(body,{slot:4},'missile');pose=S.snapshot(body);actor.update(pose);assert.equal(actor.segments[4].shell.visible,false);assert.equal(actor.segments[4].joint.visible,false);
  pose.attack='charge-warning';pose.warning={x:350,y:700};actor.update(pose);assert.equal(actor.target.visible,true);assert.equal(actor.target.position.x,350-pose.x);
  pose.attack='recover';pose.vulnerable=true;actor.update(pose);assert.equal(actor.target.visible,false);assert.ok(actor.jaws.every(j=>j.rotation.y>.5));
  if(!reducedMotion)actor.root.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;draws+=Array.isArray(o.material)?o.material.length:1;}});
  factory.dispose();
}
assert.ok(triangles<6000,'the full articulated enemy remains low poly');assert.ok(draws<100,'draw calls are bounded and independent of encounter duration');
const practice=fs.readFileSync('docs/prueba-nucleo.js','utf8');
for(const name of ['devourer-core','local-cpu','campaign-config','render-3d','i18n'])assert.ok(practice.includes(fs.readFileSync('docs/'+name+'.js','utf8').trim()),name+' is synchronized in the shared practice bundle');
assert.ok(fs.readFileSync('docs/prueba-devorador.html','utf8').includes('data-practice-level="4"'));
for(const p of ['docs/index.html','docs/build-version.js']){const s=fs.readFileSync(p,'utf8');assert.ok(s.indexOf('devourer-core.js')<s.indexOf('local-cpu.js'));}
console.log('Devourer GLB OK: '+bytes.length+' bytes, '+triangles+' actor triangles, '+draws+' bounded draws, shared resources, axis/radii, three jaw pivots, weak joints, severed segments, charge marker, reduced motion and synchronized direct practice.');
