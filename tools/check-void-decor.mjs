import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {createVoidDecorFactory} from '../docs/void-decor.js';

const path='docs/assets/models/esfera-interior.glb',bytes=fs.readFileSync(path);
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<550000,'the interior remains a small campaign-only asset');
assert.equal(json.images?.length||0,0,'authored PBR colours need no texture downloads');
assert.ok(json.buffers.every(b=>!b.uri));assert.equal(json.cameras?.length||0,0);assert.equal(json.animations?.length||0,0);
assert.ok(!json.nodes.some(n=>['Cube','Camera','Light'].includes(n.name)));
const template=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/void-core.js','utf8'),c);const S=c.window.GalaxyVoidCore;
for(const name of ['WALL','TURRET_BASE','TURRET_HEAD','GATE_PYLON'])assert.ok(template.getObjectByName('VOID_DETAIL_'+name),'semantic kit root '+name);
let totalTriangles=0;template.traverse(o=>{if(o.isMesh)totalTriangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});
assert.ok(totalTriangles<10000,'modular kit has a modest shared geometry budget');

const matrix=new T.Matrix4(),vertex=new T.Vector3(),point=new T.Vector3();
let maxDraws=0,instances=0;
for(const reducedMotion of [false,true]){
 const factory=createVoidDecorFactory(T,{template,combat:S,reducedMotion}),a=factory(),b=factory(),state=S.create('decor-test');
 const firstA=a.wallBatches[0].mesh,firstB=b.wallBatches[0].mesh;
 assert.equal(firstA.geometry,firstB.geometry,'encounters share the baked panel geometry');
 assert.equal(firstA.material,firstB.material,'encounters share PBR materials');
 assert.ok(firstA.isInstancedMesh,'wall sections are instanced, not hundreds of object draws');
 const panelBounds=new T.Box3();for(const batch of a.wallBatches)panelBounds.union(batch.mesh.geometry.boundingBox);
 const panelSize=panelBounds.getSize(new T.Vector3());assert.ok(panelSize.x>=38&&panelSize.x<=41,'panel tangential length keeps the authored 40-unit scale');
 assert.ok(panelSize.y>=20&&panelSize.y<=24.1,'panel width matches the 24-unit collision strip');assert.ok(panelSize.z>=68&&panelSize.z<90);
 for(const batch of a.gateFrames){const p=batch.mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){vertex.fromBufferAttribute(p,i);if(vertex.z<30)assert.ok(Math.hypot(vertex.x,vertex.y)<=S.WALL+.1,'lower pylon stays inside the real rounded endpost');}}
 for(const [group,segments] of [[a.outerRing,S.walls.outer],[a.innerRing,S.walls.inner]]){
  group.traverse(o=>{if(o.isInstancedMesh&&o.name.includes('_WALL_')){assert.equal(o.count,segments.filter(s=>!s.gate).length);instances+=o.count;}});
 }
 assert.ok(a.deck.geometry.boundingBox.max.z< -45,'the decorative deck stays below the flight plane');
 const actuator=a.gateFrames.find(batch=>batch.part.moving);assert.ok(actuator,'the open gate includes a movable shutter or piston');
 state.age=0;a.update(state);actuator.mesh.getMatrixAt(0,matrix);const rest=matrix.clone();
 state.age=3;a.update(state);actuator.mesh.getMatrixAt(0,matrix);
 assert.ok(Math.abs(matrix.elements[12]-rest.elements[12])<1e-8&&Math.abs(matrix.elements[13]-rest.elements[13])<1e-8,'gate mechanisms never move into the opening');
 if(reducedMotion)assert.equal(matrix.elements[14],rest.elements[14]);else assert.ok(Math.abs(matrix.elements[14]-rest.elements[14])>.1,'open gate mechanisms have visible local motion');
 for(let frame=0;frame<16;frame++){
  state.outerAngle=frame*.2;state.innerAngle=-frame*.3;state.age=frame*.6;state.aims=[frame*.17,-frame*.23];
  a.update(state);a.root.updateMatrixWorld(true);
  assert.ok(Math.abs(a.outerRing.rotation.z+state.outerAngle)<1e-9);assert.ok(Math.abs(a.innerRing.rotation.z+state.innerAngle)<1e-9);
  for(const [group,radius,portal] of [[a.outerRing,S.OUTER,Math.PI+state.outerAngle],[a.innerRing,S.INNER,state.innerAngle]]){
   const ray=new T.Raycaster(new T.Vector3(Math.cos(portal)*radius,-Math.sin(portal)*radius,120),new T.Vector3(0,0,-1),0,130);
   assert.equal(ray.intersectObject(group,true).length,0,'openings stay visually clear at every ring pose');
  }
  for(const gun of a.turrets){
   const source=S.turretPosition(state,gun.slot);gun.base.getWorldPosition(point);
   assert.ok(Math.abs(point.x-(source.x-state.x))<1e-6&&Math.abs(point.y-(state.y-source.y))<1e-6,'base tracks the real authority mount');
   assert.equal(point.z,20);gun.head.getWorldPosition(point);assert.equal(point.z,30);
   assert.ok(Math.abs(gun.head.rotation.z+state.aims[gun.slot]+Math.PI/2)<1e-8,'barrel yaw points at the actual target');
  }
 }
 // Detail panels fit the same strip as the collision capsules. Tangential
 // scaling is per-segment; radial width remains independent of either radius.
 for(const batch of a.wallBatches){
  const mesh=batch.mesh,p=mesh.geometry.attributes.position;
  for(let i=0;i<mesh.count;i++){
   mesh.getMatrixAt(i,matrix);const centre=new T.Vector3().setFromMatrixPosition(matrix),normal=new T.Vector3(centre.x,centre.y,0).normalize();
   for(let j=0;j<p.count;j++){
    vertex.fromBufferAttribute(p,j).applyMatrix4(matrix).sub(centre);
    assert.ok(Math.abs(vertex.dot(normal))<=S.WALL+.05,'wall detail does not steal corridor width');
   }
  }
 }
 let drawCalls=0;a.root.traverseVisible(o=>{if(o.isMesh)drawCalls+=Array.isArray(o.material)?Math.max(1,o.geometry.groups.length):1;});
 maxDraws=Math.max(maxDraws,drawCalls);assert.ok(drawCalls<=55,'the detailed scene stays batched');
 factory.dispose();
}
console.log('Void interior kit OK: '+bytes.length+' bytes, '+totalTriangles+' shared triangles, '+maxDraws+' bounded decoration draws; instanced panels, open rotating gates, shared materials and exact gun mounts.');
