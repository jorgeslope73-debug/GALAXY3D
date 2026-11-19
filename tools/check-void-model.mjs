import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {createVoidFactory} from '../docs/void-model.js';
const bytes=fs.readFileSync('docs/assets/models/esfera-vacio.glb'),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<350000);assert.equal(json.scenes.length,1);assert.ok(!json.nodes.some(n=>['Cube','Camera','Light'].includes(n.name)));
assert.equal(json.images?.length||0,0);assert.equal(json.animations?.length||0,0);assert.ok(json.buffers.every(b=>!b.uri));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/void-core.js','utf8'),c);const S=c.window.GalaxyVoidCore;
let triangles=0,draws=0;
gltf.scene.traverse(o=>{if(o.isMesh){draws++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});
assert.ok(triangles<6500);assert.ok(draws<45);
for(const reducedMotion of [false,true]){
 const factory=createVoidFactory(T,{template:gltf.scene,reducedMotion}),a=factory(),b=S.create(1);a.update(b);a.root.updateMatrixWorld(true);
 const closed=new T.Box3().setFromObject(a.outer),v=new T.Vector3();a.outer.getWorldPosition(v);
 b.outerGate=b.innerGate=1;b.inside=true;b.roofOpen=true;b.age=4;a.update(b);a.root.updateMatrixWorld(true);
 const opened=new T.Box3().setFromObject(a.outer);
 assert.ok(Math.abs(opened.max.z-closed.max.z+95)<.01,'gate retracts below the flight deck');
 assert.equal(a.roof.visible,false);assert.equal(a.shield.visible,false);
 // Real GLB wall vertices retain the authority footprint and aperture.
 for(const [name,radius,portal,half] of [['VOID_OUTER_WALL',410,Math.PI,20],['VOID_INNER_WALL',235,0,30]]){
   const wall=a.root.getObjectByName(name);let maximum=0;wall.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);maximum=Math.max(maximum,Math.hypot(v.x,v.y));}});
   assert.ok(Math.abs(maximum-(radius+12))<.01,'authored wall matches collision radius');
 }
 b.stage='escape';b.hp=0;a.update(b);assert.equal(a.core.visible,false);assert.equal(a.shield.visible,false);assert.equal(a.roof.visible,false);
 factory.dispose();
}
console.log('Void GLB OK: '+bytes.length+' bytes, '+triangles+' triangles, '+draws+' draws, exact wall radii and 95-unit retractable gates.');
