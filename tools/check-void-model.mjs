import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {createVoidFactory,voidPresentation} from '../docs/void-model.js';
import {createVoidDecorFactory} from '../docs/void-decor.js';
const bytes=fs.readFileSync('docs/assets/models/esfera-vacio.glb'),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<350000);assert.equal(json.scenes.length,1);assert.ok(!json.nodes.some(n=>['Cube','Camera','Light'].includes(n.name)));
assert.equal(json.images?.length||0,0);assert.equal(json.animations?.length||0,0);assert.ok(json.buffers.every(b=>!b.uri));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const kit=fs.readFileSync('docs/assets/models/esfera-interior.glb'),detail=await new GLTFLoader().parseAsync(kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength),'');
const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/void-core.js','utf8'),c);const S=c.window.GalaxyVoidCore;
let triangles=0,draws=0;
gltf.scene.traverse(o=>{if(o.isMesh){draws++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});
assert.ok(triangles<6500);assert.ok(draws<45);
for(const reducedMotion of [false,true]){
 const factory=createVoidFactory(T,{template:{station:gltf.scene,detail:detail.scene,createDecor:createVoidDecorFactory},reducedMotion,combat:S}),a=factory(),b=S.create(1),v=new T.Vector3();
 assert.ok(a.decor,'the detailed kit is part of the real station factory');assert.ok(a.turrets.every(t=>!t.visible),'legacy guns are hidden');
 const neutral=voidPresentation(b,reducedMotion);assert.equal(neutral.active,false);assert.equal(neutral.tilt,0,'asset warm-up stays in its normal pose without intro fields');
 const roofRest=a.roof.scale.clone(),underside=a.root.getObjectByName('VOID_UNDERSIDE'),undersideRest=underside.scale.clone();
 b.introAge=0;b.introDuration=8;
 const initialBody=JSON.stringify(b);a.update(b);a.root.updateMatrixWorld(true);
 assert.equal(JSON.stringify(b),initialBody,'rendering the perspective pose never changes the authority snapshot');
 assert.ok(a.presentation.rotation.x>0);assert.ok(a.presentation.rotation.x<(reducedMotion?.17:1.1));
 assert.ok(reducedMotion?a.presentation.rotation.x<.2:a.presentation.rotation.x>.9,'reduced-motion presentation uses a small tilt');
 assert.equal(a.roof.visible,false,'legacy transparent roof cannot draw over the closed armor');assert.equal(a.introHull.visible,true);assert.equal(a.introHull.material.opacity,1,'closed armor covers the legacy cutaway while tilted');assert.equal(a.shield.visible,false);assert.equal(a.outerShield.visible,false);
 assert.equal(a.entryArrow.visible,false);assert.equal(a.innerArrow.visible,false);assert.equal(a.health.visible,false,'combat markers stay hidden while the sealed sphere is introduced');
 assert.ok(a.roof.scale.y>roofRest.y,'the introductory shell has a spherical silhouette');
 b.introAge=4;a.update(b);
 assert.ok(a.presentation.rotation.x===0&&a.presentation.rotation.y===0&&a.presentation.rotation.z===0,'rotation reaches the exact top view before shields form');
 const roofOpacity=()=>{let opacity;a.roof.traverse(o=>{if(o.isMesh)opacity=(Array.isArray(o.material)?o.material[0]:o.material).opacity;});return opacity;};
 assert.ok(roofOpacity()>0&&roofOpacity()<1,'the upper shell fades while revealing the interior');
 assert.equal(a.introHull.visible,true);assert.equal(a.introHull.material.opacity,roofOpacity(),'closed armor dissolves with the cutaway roof');
 assert.equal(a.outerShield.visible,false);
 b.introAge=5.4;a.update(b);assert.equal(a.roof.visible,false);assert.equal(a.introHull.visible,false,'closed armor is absent throughout gameplay');assert.equal(a.outerShield.visible,false,'the interior is revealed before the shield starts');
 assert.deepEqual(a.roof.scale.toArray(),roofRest.toArray());assert.deepEqual(underside.scale.toArray(),undersideRest.toArray(),'shell scale is restored before combat');
 b.introAge=6.75;a.update(b);assert.equal(a.shield.visible,true);assert.equal(a.outerShield.visible,true);
 assert.ok(Math.abs(a.shield.material.uniforms.formation.value-.5)<1e-10,'core shield fills progressively');
 assert.ok(Math.abs(a.outerShield.material.uniforms.formation.value-.5)<1e-10,'outer shield forms with the same sweep');
 const other=factory(),otherBody=S.create(2);otherBody.introAge=0;other.update(otherBody);
 assert.equal(a.introHull.geometry,other.introHull.geometry,'actors share the introductory hull geometry');
 const armorTexture=a.introHull.material.map;
 assert.equal(armorTexture,other.introHull.material.map,'actors share one locally generated armor texture');
 assert.equal(armorTexture.image.width,384);assert.equal(armorTexture.image.height,192);assert.equal(armorTexture.image.data.byteLength,384*192*4,'armor pixels stay below 300 KB and have no network asset');
 assert.notEqual(a.introHull.material,other.introHull.material,'actors keep independent armor opacity');assert.equal(a.introHull.visible,false);assert.equal(other.introHull.visible,true);
 assert.notEqual(a.shield.material,other.shield.material);assert.notEqual(a.outerShield.material,other.outerShield.material);
 assert.equal(a.outerShield.material.uniforms.formation.value,.5,'another actor cannot reset this shield formation');
 otherBody.introAge=7.5;other.update(otherBody);assert.equal(other.outerShield.material.uniforms.formation.value,1);
 assert.equal(a.outerShield.material.uniforms.formation.value,.5,'actors keep independent shader uniforms');
 b.introAge=8;b.introComplete=true;a.update(b);a.root.updateMatrixWorld(true);
 assert.equal(a.presentation.quaternion.angleTo(new T.Quaternion()),0,'presentation transform is exactly neutral when play starts');
 assert.equal(a.roof.visible,false,'the cutaway stays open after presentation');assert.equal(a.introHull.visible,false);assert.equal(a.outerShield.material.uniforms.formation.value,1);
 assert.equal(a.entryArrow.visible,true);assert.equal(a.health.visible,true);
 for(const [gate,visible] of [[0,true],[.97,true],[.98,false],[1,false]]){b.outerGate=gate;a.update(b);assert.equal(a.outerShield.visible,visible,'outer energy shield follows the authoritative gate threshold');}
 b.generators.forEach(g=>g.hp=0);b.outerGate=1;b.inside=true;b.roofOpen=true;
 for(let frame=0;frame<8;frame++){
  b.outerAngle=frame*.4;b.innerAngle=-frame*.7;b.pOuterAngle=b.outerAngle;b.pInnerAngle=b.innerAngle;a.update(b);a.root.updateMatrixWorld(true);
  assert.equal(a.outer.visible,false);assert.equal(a.inner.visible,false);assert.equal(a.roof.visible,false);assert.equal(a.shield.visible,false);assert.equal(a.outerShield.visible,false,'destroyed generators remove the exterior energy shield');
  for(const [group,radius,portal] of [[a.outerRing,S.OUTER,Math.PI+b.outerAngle],[a.innerRing,S.INNER,b.innerAngle]]){
   let max=0;group.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);max=Math.max(max,Math.hypot(v.x,v.y));}});
   assert.ok(Math.abs(max-(radius+S.WALL))<.01,'visible moving wall has the collision radius');
   const ray=at=>new T.Raycaster(new T.Vector3(Math.cos(at)*radius,-Math.sin(at)*radius,100),new T.Vector3(0,0,-1),0,200).intersectObject(group,true);
   assert.equal(ray(portal).length,0,'rotating opening has no invisible GLB shutter');assert.ok(ray(portal+Math.PI+.013).length>0,'the opposite solid wall is visible at '+frame+' radius '+radius);
  }
  for(let i=0;i<2;i++){a.turrets[i].getWorldPosition(v);const gun=S.turretPosition(b,i);assert.ok(Math.abs(v.x-(gun.x-b.x))<1e-6);assert.ok(Math.abs(v.y+(gun.y-b.y))<1e-6,'visible gun and firing source agree');assert.ok(Math.abs(Math.hypot(v.x,v.y)-S.INNER)<1e-6,'gun bases are on the inner wall');}
  assert.equal(a.root.getObjectByName('VOID_NAVIGATION').visible,false,'white guide circle is removed');
 }
 const lamp=()=>{let m;a.core.traverse(o=>{if(o.isMesh&&o.material.name==='VOID_VIOLET')m=o.material;});return m;};assert.ok(lamp(),'core lamp material found');const original=gltf.scene.getObjectByName('VOID_CORE').material;
 b.inside=false;a.update(b);assert.equal(a.shield.visible,true);assert.equal(a.health.material.color.getHex(),0x667185);
 b.inside=true;b.hp=11;a.update(b);assert.equal(a.shield.visible,false);assert.equal(lamp().color.getHex(),0x18b858);assert.equal(a.health.material.color.getHex(),0x80ffbc);assert.ok(Math.abs(a.health.scale.x-11/12)<1e-9,'real HP loss shortens the green bar');
 b.stage='escape';b.hp=0;a.update(b);a.root.updateMatrixWorld(true);assert.equal(a.core.visible,false);assert.equal(a.shield.visible,false);assert.equal(a.roof.visible,false);
 for(const arrow of [a.entryArrow,a.innerArrow]){const forward=new T.Vector3(1,0,0).transformDirection(arrow.matrixWorld),outward=new T.Vector3(arrow.position.x,arrow.position.y,0).normalize();assert.ok(forward.dot(outward)>.999,'both moving arrows point outward during escape');}
 let visibleDraws=0;a.root.traverseVisible(o=>{if(o.isMesh)visibleDraws++;});assert.ok(visibleDraws<80,'detailed moving walls stay batched');
 const disposals={texture:0,geometry:0,firstMaterial:0,secondMaterial:0};
 armorTexture.addEventListener('dispose',()=>disposals.texture++);a.introHull.geometry.addEventListener('dispose',()=>disposals.geometry++);
 a.introHull.material.addEventListener('dispose',()=>disposals.firstMaterial++);other.introHull.material.addEventListener('dispose',()=>disposals.secondMaterial++);
 factory.dispose();assert.deepEqual(disposals,{texture:1,geometry:1,firstMaterial:1,secondMaterial:1},'factory teardown releases the shared armor texture/geometry and both actor materials exactly once');
}
console.log('Void model OK: perspective-to-top cutaway, delayed independent shield formation, reduced motion, restored combat geometry and visible rotating gaps.');
