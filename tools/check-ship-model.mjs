import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareShipTemplate} from '../docs/ship-model.js';

for(const file of ['naveazul.jpg','navefuxia.jpg']){
  const image=await readFile(new URL('../docs/assets/models/'+file,import.meta.url));
  assert.equal(image.readUInt16BE(0),0xffd8,file+' must be a JPEG');
  assert.equal(image.readUInt16BE(image.length-2),0xffd9,file+' must be complete');
}

for(const file of ['naveazul-cupula-oscura.png','naveverde.png','naveroja.png','naveazul-sin-balas.png','navefuxia-sin-balas.png','naveverde-sin-balas.png','naveroja-sin-balas.png']){
  const paint=await readFile(new URL('../docs/assets/models/'+file,import.meta.url));
  assert.equal(paint.subarray(0,8).toString('hex'),'89504e470d0a1a0a',file+' must be a PNG');
  assert.equal(paint.readUInt32BE(16),1014,file+' UV atlas width must stay unchanged');
  assert.equal(paint.readUInt32BE(20),1014,file+' UV atlas height must stay unchanged');
}

const bytes=await readFile(new URL('../docs/assets/models/nave.glb',import.meta.url));
assert.equal(bytes.toString('ascii',0,4),'glTF','The asset must be a GLB');
assert.equal(bytes.readUInt32LE(4),2,'Expected glTF 2');
assert.equal(bytes.readUInt32LE(8),bytes.length,'GLB length must match its header');
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
assert.ok(json.images.every(image=>Number.isInteger(image.bufferView)),'Textures must be embedded');
assert.ok(json.buffers.every(buffer=>!buffer.uri),'The model must not need external buffers');
assert.ok(!json.skins?.length,'This static ship must not need skeleton cloning');

// Decode the real geometry with the production loader; image decoding is verified in browser.
const loader=new GLTFLoader();
loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const template=prepareShipTemplate(gltf.scene);
const bounds=new T.Box3().setFromObject(template),size=bounds.getSize(new T.Vector3());
assert.ok(bounds.getCenter(new T.Vector3()).length()<1e-5,'Rotation must use the ship centre');
assert.ok(Math.abs(size.y-62)<1e-4&&size.x<size.y,'The nose must point along the game Y axis');
assert.ok(size.z>0&&size.z<32,'The mesh must have depth and fit its effects');
let triangles=0,frontWidth=0,backWidth=0,deckLocalZ=Infinity,deckWorldZ=0;
template.traverse(object=>{
  if(!object.isMesh)return;
  triangles+=(object.geometry.index?.count||object.geometry.attributes.position.count)/3;
  const points=object.geometry.attributes.position;
  for(let i=0;i<points.count;i++){
    const point=new T.Vector3().fromBufferAttribute(points,i).applyMatrix4(object.matrixWorld);
    // The raised upper deck is the negative local-Z side in this specific GLB.
    if(points.getZ(i)<deckLocalZ){deckLocalZ=points.getZ(i);deckWorldZ=point.z;}
    if(point.y>size.y*.35)frontWidth=Math.max(frontWidth,Math.abs(point.x));
    if(point.y< -size.y*.35)backWidth=Math.max(backWidth,Math.abs(point.x));
  }
});
assert.ok(frontWidth<backWidth,'The narrow nose must face forwards and the engines backwards');
assert.ok(deckWorldZ>0,'The upper deck must face the overhead camera, not the underside');
assert.ok(triangles>0&&triangles<=10000,'Unexpected ship geometry cost');
console.log(`Ship GLB OK: ${triangles} triangles; centred, forwards, embedded textures; ${size.toArray().map(x=>x.toFixed(2)).join(' × ')}`);
