import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareUfoTemplate,createUfoFactory,setUfoPose,UFO_DIAMETER} from '../docs/ufo-model.js';

const bytes=await readFile(new URL('../docs/assets/models/ovni.glb',import.meta.url));
assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(8),bytes.length);
assert.ok(bytes.length<3*1024*1024,'The web copy must stay small enough for mobile startup');
const jsonSize=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonSize).toString());
assert.equal(json.meshes.length,1,'Only the supplied UFO, without scene helpers');
assert.ok(!json.animations?.length&&!json.skins?.length);
assert.ok(json.images.length===3&&json.images.every(i=>Number.isInteger(i.bufferView)));
assert.ok(json.buffers.every(b=>!b.uri));
function jpegSize(b){
  assert.equal(b.readUInt16BE(0),0xffd8);let at=2;
  while(at<b.length){
    assert.equal(b[at],255);const marker=b[at+1],length=b.readUInt16BE(at+2);
    if([0xc0,0xc1,0xc2].includes(marker))return [b.readUInt16BE(at+7),b.readUInt16BE(at+5)];
    at+=length+2;
  }
  throw Error('Missing JPEG size');
}
for(const image of json.images){
  const v=json.bufferViews[image.bufferView],start=28+jsonSize+(v.byteOffset||0);
  assert.equal(image.mimeType,'image/jpeg');
  assert.deepEqual(jpegSize(bytes.subarray(start,start+v.byteLength)),[1024,1024]);
}
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const template=prepareUfoTemplate(gltf.scene),bounds=new T.Box3().setFromObject(template),size=bounds.getSize(new T.Vector3());
assert.ok(bounds.getCenter(new T.Vector3()).length()<1e-5);
assert.ok(Math.abs(Math.max(size.x,size.y)-UFO_DIAMETER)<1e-4);
assert.ok(Math.abs(size.x-size.y)<1&&size.z>8&&size.z<30,'The disc lies in the arena plane');
let triangles=0,top=-Infinity,topRadius=0,maxRadius=0,meshes=0;
template.traverse(o=>{
  if(!o.isMesh)return;meshes++;
  assert.ok(o.material.map&&o.material.normalMap&&o.material.metalnessMap&&o.material.roughnessMap,'Keep every authored PBR texture');
  triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;
  const a=o.geometry.attributes.position;
  for(let i=0;i<a.count;i++){
    const p=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);
    maxRadius=Math.max(maxRadius,Math.hypot(p.x,p.y));
    if(p.z>top){top=p.z;topRadius=Math.hypot(p.x,p.y);}
  }
});
assert.equal(meshes,1);assert.equal(triangles,50000);
assert.ok(maxRadius<31&&maxRadius>29,'The artwork fits the existing radius-30 collision');
assert.ok(top>0&&topRadius<18,'The upper dome faces the overhead camera');
const factory=createUfoFactory(template),a=factory(),b=factory();let ma,mb;
a.traverse(o=>{if(o.isMesh)ma=o;});b.traverse(o=>{if(o.isMesh)mb=o;});
assert.equal(ma.geometry,mb.geometry);assert.equal(ma.material,mb.material);
const root=new T.Group();root.position.set(100,200,13);root.add(a);const origin=root.position.clone();
for(let ms=0;ms<=10000;ms+=16){
  setUfoPose(root,ms*.072,ms,.7);
  assert.ok(Math.abs(root.rotation.x)<=.035001&&Math.abs(root.rotation.y)<=.080001);
  assert.ok(root.position.distanceTo(origin)===0,'Visual rocking never shifts the collision centre');
}
setUfoPose(root,72,1000);assert.ok(Math.abs(root.rotation.z-72*Math.PI/180)<1e-9);
assert.ok(b.rotation.x===0&&b.rotation.y===0&&b.rotation.z===0,'One UFO pose never rotates another instance');
console.log(`UFO GLB OK: ${triangles} triangles, 3 embedded 1024px maps, dome up, radius 30, shared buffers, continuous spin and gentle rocking.`);
