import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareUfoTemplate,createUfoFactory,setUfoPose,setUfoLights,UFO_DIAMETER,UFO_LEAN_LIMIT,UFO_LEAN_FULL_SPEED} from '../docs/ufo-model.js';

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
assert.deepEqual(json.scenes[json.scene].nodes,[3],'Use the authored UFO scene; the separate Cube scene is not loaded');
assert.equal(json.animations.length,1);assert.equal(json.animations[0].name,'Luces_Random_Loop');
assert.ok(!json.skins?.length);
assert.ok(json.animations[0].channels.every(c=>c.target.path==='weights'),'The lamp clip must not move the collision centre');
assert.ok(json.images.length===2&&json.images.every(i=>Number.isInteger(i.bufferView)));
assert.ok(json.buffers.every(b=>!b.uri));
for(const image of json.images){
  const v=json.bufferViews[image.bufferView],start=28+jsonSize+(v.byteOffset||0);
  const png=bytes.subarray(start,start+v.byteLength);
  assert.equal(image.mimeType,'image/png');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[2048,1024],'Preserve the supplied UV atlas dimensions');
}
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const clip=gltf.animations[0],duration=clip.duration;
const template=prepareUfoTemplate(gltf.scene,gltf.animations),bounds=new T.Box3().setFromObject(template,true),size=bounds.getSize(new T.Vector3());
assert.ok(bounds.getCenter(new T.Vector3()).length()<1e-5);
assert.ok(Math.abs(Math.max(size.x,size.y)-UFO_DIAMETER)<1e-4);
assert.ok(Math.abs(size.x-size.y)<1&&size.z>8&&size.z<30,'The disc lies in the arena plane');
let triangles=0,top=-Infinity,topRadius=0,maxRadius=0,meshes=0;
template.traverse(o=>{
  if(!o.isMesh)return;meshes++;
  assert.ok(!o.name.includes('Cube'),'Other GLB scenes must stay outside the game');
  if(o.material.map)assert.ok(o.material.normalMap&&o.material.metalness>.9,'Keep the hull PBR maps and authored metal');
  if(o.morphTargetInfluences)assert.equal(o.morphTargetInfluences.length,12);
  triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;
  const a=o.geometry.attributes.position;
  for(let i=0;i<a.count;i++){
    const p=o.getVertexPosition(i,new T.Vector3()).applyMatrix4(o.matrixWorld);
    maxRadius=Math.max(maxRadius,Math.hypot(p.x,p.y));
    if(p.z>top){top=p.z;topRadius=Math.hypot(p.x,p.y);}
  }
});
assert.equal(meshes,6);assert.equal(triangles,1384);assert.ok(triangles<2000,'Keep the supplied low-polygon UFO');
assert.ok(maxRadius<31&&maxRadius>29,'The artwork fits the existing radius-30 collision');
assert.ok(top>0&&topRadius<18,'The upper dome faces the overhead camera');
const environment=new T.Texture(),factory=createUfoFactory(template,environment),a=factory(),b=factory();
const meshMap=root=>{const map=new Map();root.traverse(o=>{if(o.isMesh)map.set(o.name,o);});return map;};
const am=meshMap(a),bm=meshMap(b);
for(const [name,ma]of am){
  const mb=bm.get(name);
  assert.equal(ma.geometry,mb.geometry);assert.notEqual(ma.material,mb.material);
  assert.equal(ma.material.map,mb.material.map);assert.equal(ma.material.normalMap,mb.material.normalMap);
  assert.equal(ma.material.envMap,environment);assert.equal(mb.material.envMap,environment,'Menu and match share one reflection map');
  assert.equal(ma.material.envMapIntensity,mb.material.envMapIntensity);
  if(ma.morphTargetInfluences)assert.notEqual(ma.morphTargetInfluences,mb.morphTargetInfluences,'Each instance owns its lamp weights');
  if(ma.material.name.startsWith('Luces'))assert.equal(ma.material.emissiveIntensity,2,'Use the authored lamp emission');
}
const weights=root=>[...meshMap(root).values()].filter(m=>m.morphTargetInfluences).flatMap(m=>m.morphTargetInfluences);
const initialB=weights(b),seen=new Set();
function checkAuthoredLights(root,time,phase=0,advance=true){
  if(advance)setUfoLights(root,time,phase);
  const clock=((time*.001+phase*duration/(Math.PI*2))%duration+duration)%duration,map=meshMap(root);
  for(const track of clip.tracks){
    const mesh=map.get(track.name.replace('.morphTargetInfluences',''));
    assert.ok(mesh,'The clip binds each cloned lamp primitive');
    const expected=track.createInterpolant().evaluate(clock);
    assert.equal(mesh.morphTargetInfluences.length,expected.length);
    expected.forEach((value,i)=>assert.ok(Math.abs(value-mesh.morphTargetInfluences[i])<1e-6,'Replay the supplied shape-key values'));
  }
}
for(const time of [0,125,375,900,1700,2400,4100,7000,8040,12345,1000000000]){
  checkAuthoredLights(a,time);seen.add(weights(a).join(','));
  assert.deepEqual(weights(b),initialB,'Animating the game UFO must not alter the menu UFO');
}
assert.ok(seen.size>4,'The supplied random lamp sequence actually changes');
checkAuthoredLights(a,1279);const loopPose=weights(a);
for(const loops of [1,2,3,101]){
  checkAuthoredLights(a,1279+loops*duration*1000);
  weights(a).forEach((v,i)=>assert.ok(Math.abs(v-loopPose[i])<1e-6,'The authored light animation repeats indefinitely'));
}
checkAuthoredLights(a,701,.8);checkAuthoredLights(b,701,.8);
assert.deepEqual(weights(a),weights(b),'Frame history and instance creation time do not affect the same local pose');
for(const time of clip.tracks[0].times){
  setUfoLights(a,time*1000);const actual=new T.Box3().setFromObject(a,true);
  assert.ok(actual.getCenter(new T.Vector3()).length()<1e-5,'Blinking must not move the calibrated centre');
  assert.ok(Math.abs(actual.getSize(new T.Vector3()).x-UFO_DIAMETER)<1e-4,'Blinking preserves the diameter and collision radius');
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
setUfoPose(root,0,125);checkAuthoredLights(a,125,0,false);
const poseLights=weights(a);setUfoPose(root,0,2400);checkAuthoredLights(a,2400,0,false);
assert.notDeepEqual(weights(a),poseLights,'The production pose update also advances the authored lamp clip');
assert.ok(b.rotation.x===0&&b.rotation.y===0&&b.rotation.z===0,'One UFO pose never rotates another instance');
console.log(`UFO GLB OK: ${triangles} triangles, 2 embedded 2048x1024 PNG maps, shared geometry/textures, independent authored ${duration.toFixed(3)}s morph loops, exact keyframes across repeated loops, stable radius/centre, smooth variable-speed spin and travel-directed bank up to 45 degrees.`);
