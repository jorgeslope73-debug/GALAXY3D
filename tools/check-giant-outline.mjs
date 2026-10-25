import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareMeteorTemplate} from '../docs/meteor-model.js';
const {engineContext}=createRequire(import.meta.url)('./check-session-regressions.js');
const context=engineContext(),core=context.window.GalaxyPhysicsCore;
const data=await readFile(new URL('../docs/assets/models/Rocky_Asteroid_5.glb',import.meta.url));
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
const template=prepareMeteorTemplate(gltf.scene,'large'),geometry=template.children[0].geometry;
const points=geometry.attributes.position,index=geometry.index;
const triangles=[];
for(let i=0;i<index.count;i+=3){const t=[];for(let j=0;j<3;j++){const n=index.getX(i+j);t.push(points.getX(n)*135,-points.getY(n)*135);}triangles.push(t);}
function inMesh(x,y){
  for(const [ax,ay,bx,by,cx,cy] of triangles){
    const a=(bx-ax)*(y-ay)-(by-ay)*(x-ax),b=(cx-bx)*(y-by)-(cy-by)*(x-bx),c=(ax-cx)*(y-cy)-(ay-cy)*(x-cx);
    if((a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0))return true;
  }return false;
}
let checked=0,emptyCircle=0;
const origin={x:0,y:0};
for(let y=-130;y<=130;y+=5)for(let x=-130;x<=130;x+=5){
  const surface=core.giantSurface(origin,x,y);
  if(Math.abs(surface.distance)>1){assert.equal(surface.distance<0,inMesh(x,y),'collision contour follows projected mesh within 1 arena unit');checked++;}
  if(Math.hypot(x,y)<130&&surface.distance>6){assert.equal(core.giantCircleContact(origin,{x,y},4),null,'empty parts of the old collision circle stay empty');emptyCircle++;}
}
assert.ok(checked>2000&&emptyCircle>300);
const top=Math.min(...core.GIANT_OUTLINE.map(p=>p[1]))*135;
assert.equal(core.giantHitsCircle(origin,{px:-200,py:top-5,x:200,y:top-5},4),null,'a fast grazing shot outside the real edge passes');
const fast=core.projectileGiantHit({px:-200,py:0,x:200,y:0,owner:2,guided:true},origin,()=>false);
assert.ok(fast&&fast.guided&&fast.owner===2&&fast.impactX<0,'a fast missile hits the entry side even if it ends beyond the rock');
assert.ok(Math.abs(core.giantSurface(origin,fast.impactX,fast.impactY).distance)<1e-6);
assert.equal(core.giantHitsCircle({x:960,y:540},{px:1915,py:540,x:5,y:540},4),null,'wrapping is not a projectile sweeping through the middle');
let contacts=0;
for(const centre of [{x:500,y:500},{x:1200,y:250},{x:50,y:900}])for(let i=0;i<48;i++)for(const radius of [14,24,45,60]){
  const angle=i*Math.PI/24,edge=core.giantSurface(centre,centre.x+300*Math.cos(angle),centre.y+300*Math.sin(angle));
  const body={x:edge.x+edge.nx*(radius-.5),y:edge.y+edge.ny*(radius-.5),r:radius,fragment:true,vx:0,vy:0};
  const giant={...centre,vx:30,vy:-10};
  assert.ok(core.giantCircleContact(giant,body,radius),'surface fixtures begin in contact');
  assert.equal(core.resolveGiantAsteroidCollision(giant,body,135,radius,240),true);
  assert.ok(core.giantSurface(giant,body.x,body.y).distance>=radius-1e-6,'rock contact leaves the circle outside the actual silhouette');
  assert.deepEqual([giant.x,giant.y,giant.vx,giant.vy],[centre.x,centre.y,30,-10]);contacts++;
}
for(const shield of [0,10]){
  const g={x:600,y:500,px:599.5,py:500,vx:30,vy:0},radius=shield?60:24;
  const edge=core.giantSurface(g,300,500),p={x:edge.x+edge.nx*(radius-.5),y:edge.y+edge.ny*(radius-.5),shield};
  const hit=core.giantHitsCircle(g,p,radius);assert.ok(hit);core.separateGiantShipContact(p,g,hit);
  assert.ok(core.giantSurface(g,p.x,p.y).distance>=radius-.001,'shield/hull remains outside after the moving shape contact');
}
for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
  const engine=new context.window[name]({onEvent:()=>{}});
  Object.assign(engine,{players:[],asteroids:[],meteors:[],pickups:[],flares:[],giant:{x:700,y:500,vx:0,vy:0,r:135,entered:true},bullets:[{id:1,x:450,y:500,vx:30000,vy:0,age:0,travel:100,owner:0,guided:false}]});
  engine.updateBullets(1/60);assert.equal(engine.bullets.length,0,name+': fast projectile cannot tunnel through the giant');
}
const source=await readFile(new URL('../docs/render-3d.js',import.meta.url),'utf8');
const method=source.match(/      rock\([^\n]+\{[\s\S]*?\n      \},/)[0];
const record={root:new T.Group(),rock:template.clone(true)};
const draw=vm.runInNewContext('({'+method+'}).rock',{take:()=>record,place:()=>{},now:987654,Math,Number,String,window:{GalaxyPhysicsCore:core}});
draw('giant',700,500,270,3,0,'large');
assert.equal(record.rock.rotation.x,0);assert.equal(record.rock.rotation.y,0);assert.equal(record.rock.rotation.z,core.giantRotation(700,500),'rendered yaw matches authority and is independent of client clock');
console.log(`Giant outline OK: ${checked} mesh/contour samples, ${emptyCircle} empty-circle passes, ${contacts} surface contacts; concave sweep, fast shots, wrap handling, shield, local/online parity and matching visual rotation.`);
