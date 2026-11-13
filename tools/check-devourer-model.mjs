import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareDevourerTemplate,createDevourerFactory,DEVOURER_RADII} from '../docs/devourer-model.js';
const bytes=fs.readFileSync('docs/assets/models/devorador.glb'),length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<150000);
assert.ok(json.buffers.every(b=>!b.uri));assert.equal(json.images?.length||0,0);assert.equal(json.cameras?.length||0,0);assert.equal(json.animations?.length||0,0);
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const templates=Object.fromEntries(['head','segment','joint'].map(kind=>[kind,prepareDevourerTemplate(T,gltf.scene,kind)]));
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/devourer-core.js','utf8'),context);const S=context.window.GalaxyDevourer;
assert.equal(DEVOURER_RADII.head,S.HEAD_RADIUS);assert.equal(DEVOURER_RADII.segment,S.SEGMENT_RADIUS);assert.equal(DEVOURER_RADII.joint,S.JOINT_RADIUS);
for(const [kind,template]of Object.entries(templates)){
  assert.equal(template.getObjectByName('Cube'),undefined,'default Blender objects are not part of the runtime templates');
  assert.ok(!template.children[0].children[0].position.length(),'the authoring preview position does not move the gameplay template');
  template.traverse(o=>assert.ok(!o.name.startsWith('PREVIEW_'),'preview instances are excluded from gameplay'));
  template.updateMatrixWorld(true);const v=new T.Vector3();let r=0;
  template.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);r=Math.max(r,Math.hypot(v.x,v.y));}});
  assert.ok(Math.abs(r-DEVOURER_RADII[kind])<1e-5,'closed GLB envelope matches the authority radius');
}
// Different Blender staging positions/rest poses must produce the same gameplay envelope.
for(const kind of ['head','segment','joint']){
  const authored=gltf.scene.clone(true),node=authored.getObjectByName('DEVOURER_'+kind.toUpperCase());node.position.set(100,20,-50);
  for(let i=0;i<3;i++)node.getObjectByName('JAW_'+i)?.rotation.set(0,.6,0);
  const normal=prepareDevourerTemplate(T,authored,kind);
  assert.ok(Math.abs(normal.scale.x-templates[kind].scale.x)<1e-8,'preview placement and jaw rest rotation do not change the gameplay scale');
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
  pose.attack='charge-warning';
  for(const [x,y] of [[350,700],[1919,1079],[1,1],[960,540]]){
    pose.warning={x:1000,y:200,targetX:x,targetY:y,locked:true};actor.update(pose);
    assert.equal(actor.target.visible,true);
    assert.equal(actor.target.position.x+pose.x,x,'the reticle marks the pilot, independently of the charge endpoint');
    assert.equal(pose.y-actor.target.position.y,y,'screen/world Y conversion preserves the pilot position, including screen wraps');
  }
  pose.warning=null;actor.update(pose);assert.equal(actor.target.visible,false);
  pose.attack='recover';pose.vulnerable=true;actor.update(pose);assert.equal(actor.target.visible,false);assert.ok(actor.jaws.every(j=>j.rotation.y>.5));
  if(!reducedMotion)actor.root.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;draws+=Array.isArray(o.material)?o.material.length:1;}});
  factory.dispose();
}
assert.ok(triangles<6000,'the full articulated enemy remains low poly');assert.ok(draws<100,'draw calls are bounded and independent of encounter duration');
// The shortened, connected neck is checked with the real GLB silhouettes,
// including the open jaws, rather than an oversized circular jaw envelope.
function silhouette(root){
  const points=[],v=new T.Vector3();root.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;
    for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);points.push({x:v.x,y:v.y});}
  });
  points.sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),lo=[],hi=[];
  for(const p of points){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}
  for(const p of points.toReversed()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}
  lo.pop();hi.pop();return lo.concat(hi);
}
function separation(a,b){
  let best=-Infinity;
  for(const polygon of [a,b])for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],length=Math.hypot(q.x-p.x,q.y-p.y),nx=-(q.y-p.y)/length,ny=(q.x-p.x)/length;
    const aa=a.map(v=>v.x*nx+v.y*ny),bb=b.map(v=>v.x*nx+v.y*ny);
    best=Math.max(best,Math.min(...bb)-Math.max(...aa),Math.min(...aa)-Math.max(...bb));
  }
  return best;
}
const neckFactory=createDevourerFactory(T,{templates}),neckActor=neckFactory(),neckBody=S.create('neck');let neckGap=Infinity;
for(let i=0;i<2400;i++){
  S.step(neckBody,1/30,{x:960+800*Math.sin(i*.027),y:540+450*Math.cos(i*.033)},()=>1);
  neckActor.update(S.snapshot(neckBody));neckActor.root.updateMatrixWorld(true);
  const gap=separation(silhouette(neckActor.root.children[0]),silhouette(neckActor.segments[0].shell));
  neckGap=Math.min(neckGap,gap);assert.ok(gap>.1,'the real head and first segment never intersect while turning/charging');
}
neckFactory.dispose();
const practice=fs.readFileSync('docs/prueba-nucleo.js','utf8');
for(const name of ['devourer-core','local-cpu','campaign-config','render-3d','i18n'])assert.ok(practice.includes(fs.readFileSync('docs/'+name+'.js','utf8').trim()),name+' is synchronized in the shared practice bundle');
assert.ok(fs.readFileSync('docs/prueba-devorador.html','utf8').includes('data-practice-level="4"'));
for(const p of ['docs/index.html','docs/build-version.js']){const s=fs.readFileSync(p,'utf8');assert.ok(s.indexOf('devourer-core.js')<s.indexOf('local-cpu.js'));}
console.log('Devourer GLB OK: '+bytes.length+' bytes, '+triangles+' actor triangles, '+draws+' bounded draws; shortened neck clear in 2400 real-mesh poses (minimum '+neckGap.toFixed(2)+'px); shared resources, jaw pivots, weak joints and synchronized practice.');
