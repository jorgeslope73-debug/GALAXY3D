import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareMeteorTemplate,createMeteorFactory,METEOR_VISUAL_SCALE} from '../docs/meteor-model.js';

const bytes=await readFile(new URL('../docs/assets/models/meteor.glb',import.meta.url));
assert.equal(bytes.toString('ascii',0,4),'glTF');
assert.equal(bytes.readUInt32LE(4),2);
assert.equal(bytes.readUInt32LE(8),bytes.length);
assert.deepEqual(bytes,await readFile(new URL('../mas/final/meteor.glb',import.meta.url)),'published and source copies must match');
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
assert.ok(json.buffers.every(b=>!b.uri),'buffers must be embedded');
assert.ok(json.images.every(i=>Number.isInteger(i.bufferView)),'images must be embedded');
assert.ok(!json.skins?.length&&!json.animations?.length,'the meteor must be static');
assert.ok(!json.extensionsRequired?.length,'no additional decoder should be required');
const paints=json.materials.map(m=>m.pbrMetallicRoughness);
assert.equal(new Set(paints.map(p=>json.textures[p.baseColorTexture.index].source)).size,1,'both pieces must share the same artwork');
assert.equal(new Set(paints.map(p=>json.textures[p.baseColorTexture.index].sampler)).size,1);
assert.ok(paints.every(p=>p.metallicFactor===paints[0].metallicFactor&&p.roughnessFactor===paints[0].roughnessFactor));
const loader=new GLTFLoader();
loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const template=prepareMeteorTemplate(gltf.scene),factory=createMeteorFactory(template),first=factory(),second=factory();
assert.equal(template.children.length,1,'both authored pieces should use a single draw call');
const mesh=first.children[0],other=second.children[0],geometry=mesh.geometry;
const triangles=geometry.index.count/3;
assert.equal(triangles,21978,'preserve every triangle of the uploaded artwork');
assert.ok(geometry.boundingSphere.center.length()<1e-5,'rotation must be centred');
assert.ok(Math.abs(geometry.boundingSphere.radius-1)<1e-5,'radius must match the existing size mapping');
assert.equal(geometry.attributes.uv.count,geometry.attributes.position.count,'preserve the authored UVs');
assert.equal(geometry.attributes.normal.count,geometry.attributes.position.count);
assert.equal(mesh.geometry,other.geometry,'instances must reuse geometry');
assert.equal(mesh.material,other.material,'instances must reuse their immutable material');
assert.notEqual(first,second,'each meteor needs an independent pose');
first.rotation.set(.3,.7,1);first.scale.setScalar(135);
assert.ok(Math.abs(second.rotation.z)<1e-8);assert.equal(second.scale.x,METEOR_VISUAL_SCALE);
// Compare the projected silhouette with the gameplay circle across many poses.
const vertex=new T.Vector3(),pose=new T.Quaternion(),rotation=new T.Euler(),radii=[];
for(let frame=0;frame<16;frame++){
  pose.setFromEuler(rotation.set(frame*.31,frame*.47,frame*.23));
  const support=Array(24).fill(-Infinity);
  for(let i=0;i<geometry.attributes.position.count;i++){
    vertex.fromBufferAttribute(geometry.attributes.position,i).applyQuaternion(pose).multiplyScalar(second.scale.x);
    for(let d=0;d<24;d++){const angle=d*Math.PI/12;support[d]=Math.max(support[d],vertex.x*Math.cos(angle)+vertex.y*Math.sin(angle));}
  }
  radii.push(...support);
}
const meanRadius=radii.reduce((sum,r)=>sum+r,0)/radii.length;
assert.ok(Math.abs(meanRadius-1)<.03,'the visible outline should match the collision radius on average');
assert.ok(Math.min(...radii)>.90&&Math.max(...radii)<1.12,'rotation must not open a large gap or cause excessive overlap');
console.log('Projected radius / collision radius:',meanRadius.toFixed(3));
console.log(`Meteor GLB OK: 2 parts -> 1 mesh, ${triangles} triangles, embedded texture, radius 1, shared geometry/material and independent poses`);
