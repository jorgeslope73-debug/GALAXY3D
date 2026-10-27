import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareMeteorTemplate} from '../docs/meteor-model.js';
const {engineContext}=createRequire(import.meta.url)('./check-session-regressions.js');
const context=engineContext(),core=context.window.GalaxyPhysicsCore;
// Legacy PNG exports are retired; all contact checks below use the actual GLB.
const data=await readFile(new URL('../docs/assets/models/asteroidemediano.glb',import.meta.url));
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
const template=prepareMeteorTemplate(gltf.scene,'medium'),geometry=template.children[0].geometry;
const points=geometry.attributes.position,index=geometry.index,triangles=[];
for(let i=0;i<index.count;i+=3){const t=[];for(let j=0;j<3;j++){const n=index.getX(i+j);t.push(points.getX(n)*45,-points.getY(n)*45);}triangles.push(t);}
function inMesh(x,y){
  for(const [ax,ay,bx,by,cx,cy] of triangles){
    const a=(bx-ax)*(y-ay)-(by-ay)*(x-ax),b=(cx-bx)*(y-by)-(cy-by)*(x-bx),c=(ax-cx)*(y-cy)-(ay-cy)*(x-cx);
    if((a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0))return true;
  }return false;
}
const origin={x:0,y:0,r:45};let meshSamples=0,emptyCircle=0;
for(let y=-44;y<=44;y+=1.5)for(let x=-44;x<=44;x+=1.5){
  const edge=core.mediumSurface(origin,x,y);
  if(Math.abs(edge.distance)>.8){assert.equal(edge.distance<0,inMesh(x,y),'medium contour matches actual projected mesh within 0.8 arena units');meshSamples++;}
  if(Math.hypot(x,y)<44&&edge.distance>4.1){assert.equal(core.asteroidCircleContact(origin,{x,y},4),null,'an empty area of the old circle cannot cause a hit');emptyCircle++;}
}
assert.ok(meshSamples>3000&&emptyCircle>100);
const top=Math.min(...core.MEDIUM_OUTLINE.map(p=>p[1]))*45;
assert.equal(core.asteroidHitsCircle(origin,{px:-100,py:top-5,x:100,y:top-5},4,()=>true),null,'a grazing shot outside the artwork passes even if the old circle says hit');
const fast=core.projectileAsteroidHit({px:-100,py:0,x:100,y:0,owner:2,guided:true},[origin],()=>false);
assert.ok(fast&&fast.fracture&&fast.owner===2&&fast.impactX<0,'a fast missile hits the entry side and preserves fracture behaviour');
assert.ok(Math.abs(core.mediumSurface(origin,fast.impactX,fast.impactY).distance)<1e-6);
assert.equal(core.asteroidHitsCircle({x:960,y:540,r:45},{px:1915,py:540,x:5,y:540},4,()=>true),null,'wrapping never sweeps through the whole arena');
function polygon(body,outline,radius,rotation){const a=rotation(body.x,body.y,body.id),c=Math.cos(a),s=Math.sin(a);return outline.map(([x,y])=>[body.x+radius*(x*c+y*s),body.y+radius*(-x*s+y*c)]);}
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function overlap(a,b){
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    if(cross(p,q,r)*cross(p,q,s)<0&&cross(r,s,p)*cross(r,s,q)<0)return true;
  }return inside(a[0],b)||inside(b[0],a);
}
let seed=0x98765432;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
let pairSamples=0,hits=0,giantHits=0;
for(let i=0;i<1500;i++){
  const a={id:i+1,x:300+random()*1200,y:200+random()*650,r:45,vx:random()*200-100,vy:random()*200-100};
  const b={id:i+3000,x:a.x+random()*180-90,y:a.y+random()*180-90,r:45,vx:random()*200-100,vy:random()*200-100};
  const expected=overlap(polygon(a,core.MEDIUM_OUTLINE,45,core.mediumRotation),polygon(b,core.MEDIUM_OUTLINE,45,core.mediumRotation));
  assert.equal(!!core.rockContact(a,b),expected,'convex pieces must preserve the full concave polygon without extra hits');pairSamples++;
  if(expected){
    assert.equal(core.resolveAsteroidPairCollision(a,b),true);assert.equal(core.rockContact(a,b),null,'medium rocks fully separate after collision');hits++;
    for(const body of [a,b])for(const key of ['x','y','vx','vy'])assert.ok(Number.isFinite(body[key]));
  }
  const g={x:900,y:500,r:core.GIANT_RADIUS,vx:45,vy:-5},range=core.GIANT_RADIUS+25,m={id:i+1,x:900+(random()*2-1)*range,y:500+(random()*2-1)*range,r:45,vx:0,vy:0};
  const expectedGiant=overlap(polygon(g,core.GIANT_OUTLINE,core.GIANT_RADIUS,core.giantRotation),polygon(m,core.MEDIUM_OUTLINE,45,core.mediumRotation));
  assert.equal(!!core.rockContact(g,m,core.GIANT_RADIUS,45,'giant'),expectedGiant,'giant/medium contact uses both actual outlines');
  if(expectedGiant){
    assert.equal(core.resolveGiantAsteroidCollision(g,m,core.GIANT_RADIUS),true);assert.equal(core.rockContact(g,m,core.GIANT_RADIUS,45,'giant'),null,'the giant leaves no embedded medium rock');
    assert.deepEqual([g.x,g.y,g.vx,g.vy],[900,500,45,-5]);giantHits++;
  }
}
let surfaceContacts=0;
for(const id of [1,17,294])for(let i=0;i<48;i++)for(const radius of [14,24,30,60]){
  const a={id,x:700,y:500,r:45,vx:70,vy:0},angle=i*Math.PI/24,edge=core.mediumSurface(a,a.x+300*Math.cos(angle),a.y+300*Math.sin(angle));
  const b={x:edge.x+edge.nx*(radius-.5),y:edge.y+edge.ny*(radius-.5),r:radius,fragment:true,vx:0,vy:0};
  assert.ok(core.asteroidCircleContact(a,b,radius));core.resolveAsteroidPairCollision(a,b,14,240);
  assert.equal(core.rockContact(a,b,45,radius),null,'round fragments/rain/contacts stay outside the medium outline');surfaceContacts++;
}
for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
  const engine=new context.window[name]({onEvent:()=>{}}),a={id:19,x:700,y:500,r:45,vx:0,vy:0};
  Object.assign(engine,{players:[],asteroids:[a],meteors:[],pickups:[],flares:[],giant:null,bullets:[{id:1,x:600,y:500,vx:12000,vy:0,age:0,travel:100,owner:0,guided:false}]});
  engine.updateBullets(1/60);assert.equal(engine.bullets.length,0,name+': high-speed shots cannot tunnel through the medium');
}
const source=await readFile(new URL('../docs/render-3d.js',import.meta.url),'utf8'),method=source.match(/      rock\([^\n]+\{[\s\S]*?\n      \},/)[0];
const record={root:new T.Group(),rock:template.clone(true)};
const draw=vm.runInNewContext('({'+method+'}).rock',{take:()=>record,place:()=>{},now:987654,Math,Number,String,window:{GalaxyPhysicsCore:core}});
draw('a19',700,500,90,1,0,'medium');assert.ok(Math.abs(record.rock.rotation.x)<1e-10);assert.ok(Math.abs(record.rock.rotation.y)<1e-10);const yawDelta=record.rock.rotation.z-core.mediumRotation(700,500,19);assert.ok(Math.abs(Math.atan2(Math.sin(yawDelta),Math.cos(yawDelta)))<1e-10,'authority and visual pose use the same per-ID orientation');
draw('a19',700,500,103.5,1,0,'medium',1.234);
const pose=core.mediumQuaternion(1.234,core.mediumRotation(700,500,19));
assert.ok(record.rock.quaternion.angleTo(new T.Quaternion(pose.x,pose.y,pose.z,pose.w))<1e-7,'renderer consumes the authoritative 3D spin');
console.log(`Medium outline OK: ${meshSamples} mesh samples, ${emptyCircle} empty-circle passes, ${pairSamples} polygon comparisons, ${hits} medium pairs, ${giantHits} giant/medium pairs, ${surfaceContacts} round contacts; concave CCD and per-ID pose.`);
