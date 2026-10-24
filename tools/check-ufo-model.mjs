import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareUfoTemplate,createUfoFactory,setUfoPose,setUfoLights,UFO_DIAMETER,UFO_LEAN_LIMIT,UFO_LEAN_FULL_SPEED,UFO_LIGHT_PERIOD_MS} from '../docs/ufo-model.js';

const bytes=await readFile(new URL('../docs/assets/models/ovni.glb',import.meta.url));
const gameSource=await readFile(new URL('../docs/game.js',import.meta.url),'utf8');
const spinSource=gameSource.match(/function ufoSpinAngle\([^)]*\)\{[\s\S]*?\n  \}/);
assert.ok(spinSource,'The game must use the shared visual spin helper');
const spin=vm.runInNewContext('('+spinSource[0]+')');
const angleDelta=(a,b)=>(b-a+540)%360-180;
for(const id of [0,1,2,37,99999]){
  let previous=spin(0,id),previousSpeed=null,minSpeed=Infinity,maxSpeed=-Infinity;
  for(let time=16;time<=60000;time+=16){
    const angle=spin(time,id),speed=angleDelta(previous,angle)/.016;
    assert.ok(angle>=0&&angle<360);
    assert.ok(speed>=29.99&&speed<=114.01,'Spin keeps a smooth forward angular speed');
    if(previousSpeed!==null)assert.ok(Math.abs(speed-previousSpeed)<.405,'Acceleration changes gradually without jumps');
    minSpeed=Math.min(minSpeed,speed);maxSpeed=Math.max(maxSpeed,speed);previous=angle;previousSpeed=speed;
  }
  assert.ok(minSpeed<30.1&&maxSpeed>113.9,'Each UFO visibly accelerates and slows down');
  const at=spin(12345,id);spin(987654,id);assert.equal(spin(12345,id),at,'Spin does not depend on previous frames');
}
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
assert.equal(ma.geometry,mb.geometry);assert.notEqual(ma.material,mb.material);
assert.equal(ma.material.map,mb.material.map);assert.equal(ma.material.normalMap,mb.material.normalMap);
const shaderA={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <emissivemap_fragment>'};
const shaderB={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <emissivemap_fragment>'};
ma.material.onBeforeCompile(shaderA);mb.material.onBeforeCompile(shaderB);
assert.ok(shaderA.fragmentShader.includes('ufoLampMask')&&shaderA.vertexShader.includes('ufoLampXY=position.xy'));
setUfoLights(a,0);assert.ok(Math.abs(shaderA.uniforms.ufoLampPower.value-.1)<1e-9);
assert.equal(shaderB.uniforms.ufoLampPower.value,1,'The other UFO keeps its independent light state');
setUfoLights(a,UFO_LIGHT_PERIOD_MS/2);assert.equal(shaderA.uniforms.ufoLampPower.value,1);
let previousPower=null;
for(let time=0;time<=UFO_LIGHT_PERIOD_MS*2;time+=16){
  setUfoLights(a,time);const power=shaderA.uniforms.ufoLampPower.value;
  assert.ok(power>=.1-1e-9&&power<=1);
  if(previousPower!==null)assert.ok(Math.abs(power-previousPower)<.018,'Light intensity changes gradually at 60 Hz');
  previousPower=power;
}
const root=new T.Group();root.position.set(100,200,13);root.add(a);const origin=root.position.clone();
assert.ok(Math.abs(UFO_LEAN_LIMIT-Math.PI/4)<1e-9);
const up=new T.Vector3(0,0,1),normal=()=>up.clone().applyQuaternion(root.quaternion);
for(let ms=0;ms<=16000;ms+=16){
  setUfoPose(root,spin(ms,1),ms,.7,0,0);
  assert.ok(normal().distanceTo(up)<1e-9,'A stationary UFO stays level without automatic rocking');
}
for(const [vx,vy] of [[145,0],[-145,0],[0,-145],[0,145],[120,-80],[-120,80],[310,310],[10000,10000]]){
  setUfoPose(root,37,0,.7,vx,vy,true);
  const n=normal(),direction=new T.Vector3(vx,-vy,0).normalize(),projected=new T.Vector3(n.x,n.y,0).normalize();
  assert.ok(projected.distanceTo(direction)<1e-8,'The bank follows world travel even while the disc rotates');
  const lean=Math.acos(n.z),expected=UFO_LEAN_LIMIT*Math.min(1,Math.hypot(vx,vy)/UFO_LEAN_FULL_SPEED);
  assert.ok(Math.abs(lean-expected)<1e-8&&lean<=UFO_LEAN_LIMIT+1e-9,'Total tilt follows speed and stays within 45 degrees on diagonals');
  for(const angle of [0,90,180,270,359]){
    setUfoPose(root,angle,0,.7,vx,vy);
    assert.ok(normal().distanceTo(n)<1e-8,'Spinning never turns the bank away from the direction of travel');
  }
  assert.equal(root.position.distanceTo(origin),0,'Visual leaning never moves the collision centre');
}
setUfoPose(root,0,0,0,145,0,true);
let previousNormal=normal();
for(let ms=16;ms<=1600;ms+=16){
  setUfoPose(root,spin(ms),ms,0,-145,0);
  const n=normal();assert.ok(n.angleTo(previousNormal)<.06,'Direction reversal eases smoothly without a bank jump');previousNormal=n;
}
assert.ok(normal().x<-.35,'The bank reverses to the left with leftward motion');
for(let ms=1616;ms<=4000;ms+=16)setUfoPose(root,spin(ms),ms,0,0,0);
assert.ok(normal().angleTo(up)<.0001,'Stopping eases back to level');
const settled=[];
for(const step of [10,40]){
  setUfoPose(root,0,0,0,145,0,true);
  for(let ms=step;ms<=1000;ms+=step)setUfoPose(root,0,ms,0,-145,80);
  settled.push(normal());
}
assert.ok(settled[0].distanceTo(settled[1])<1e-9,'Bank smoothing is independent of frame rate');
setUfoPose(root,0,1016,0,0,0,true);assert.ok(normal().distanceTo(up)<1e-9,'A reused UFO or new round clears the old bank');
setUfoPose(root,72,1000);assert.ok(Math.abs(root.rotation.z-72*Math.PI/180)<1e-9);
setUfoPose(root,0,0);assert.ok(Math.abs(shaderA.uniforms.ufoLampPower.value-.1)<1e-9);
setUfoPose(root,0,UFO_LIGHT_PERIOD_MS/2);assert.equal(shaderA.uniforms.ufoLampPower.value,1,'The game pose update also animates the lights');
assert.ok(b.rotation.x===0&&b.rotation.y===0&&b.rotation.z===0,'One UFO pose never rotates another instance');
console.log(`UFO GLB OK: ${triangles} triangles, 3 embedded 1024px maps, shared geometry/textures, independent soft lamp pulses, smooth variable-speed spin and travel-directed bank up to 45 degrees.`);
