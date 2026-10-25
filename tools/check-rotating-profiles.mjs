import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import * as T from '../docs/vendor/three.module.min.js';
import {modelGeometry} from './profile-geometry.mjs';
const {engineContext}=createRequire(import.meta.url)('./check-session-regressions.js');
const ctx=engineContext(),core=ctx.window.GalaxyPhysicsCore,data=ctx.window.GalaxyCollisionProfiles;
const index=await readFile(new URL('../docs/index.html',import.meta.url),'utf8');
assert.ok(index.indexOf('src="collision-profiles.js')>0&&index.indexOf('src="collision-profiles.js')<index.indexOf('src="physics-core.js'),'static startup loads profile data before physics');
for(const file of ['build-version.js','cpu-training.html','sw.js'])assert.ok((await readFile(new URL('../docs/'+file,import.meta.url),'utf8')).includes('collision-profiles.js'),file+' includes the shared profile table');
for(const [file,sha] of Object.entries(data.models))assert.equal(createHash('sha256').update(await readFile(new URL('../docs/assets/models/'+file,import.meta.url))).digest('hex'),sha,'regenerate profiles when model geometry changes');
const signedArea=p=>p.reduce((a,v,i)=>{const u=p[(i+1)%p.length];return a+(v[0]*u[1]-u[0]*v[1])*.5;},0);
let partitions=0;
for(const kind of ['ship','medium'])for(const [flat,parts] of data[kind]){
  const p=Array.from({length:flat.length/2},(_,i)=>[flat[i*2],flat[i*2+1]]),total=Math.abs(signedArea(p));
  let sum=0;
  for(const indices of parts){
    const poly=indices.map(i=>p[i]);sum+=Math.abs(signedArea(poly));let sign=0;
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],c=poly[(i+2)%poly.length],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      if(!cross)continue;if(sign)assert.ok(cross*sign>=0,'every SAT piece must be convex');sign=Math.sign(cross);
    }
  }
  assert.ok(Math.abs(total-sum)<1e-4,'convex pieces must cover the complete concave outline without filling its gaps');partitions++;
}
function triangleTester(vertices,indices){
  const tris=indices.map(face=>{
    const [a,b,c]=face.map(i=>vertices[i]);return {a,b,c,minX:Math.min(a[0],b[0],c[0]),maxX:Math.max(a[0],b[0],c[0]),minY:Math.min(a[1],b[1],c[1]),maxY:Math.max(a[1],b[1],c[1])};
  });
  return (x,y)=>tris.some(({a,b,c,minX,maxX,minY,maxY})=>{
    if(x<minX||x>maxX||y<minY||y>maxY)return false;
    const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-12)return false;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d;
    return u>=0&&v>=0&&u+v<=1;
  });
}
let meshChecks=0,vertexChecks=0,maxShipError=0,maxRockError=0;
for(const kind of ['ship','medium']){
  const geometry=await modelGeometry(kind);
  const poses=kind==='ship'?[-60,-59.5,-45.4,-30.5,-15.3,-.5,0,.5,15.5,30.4,45.5,59.5,60]:[0,.0043,.17,.48,.83,1.31,1.9,2.45,3.14,3.73,4.25,4.94,5.69,6.279];
  for(const value of poses){
    const body=kind==='ship'?{x:0,y:0,rot:0,bank:value*Math.PI/180,poseTime:7.123+value*.3}:{id:0,x:0,y:0,r:51.75,spin:value};
    const tilt=kind==='ship'?core.shipTilt(body.bank,body.poseTime,0):null;
    const q=kind==='ship'?new T.Quaternion().setFromEuler(new T.Euler(tilt.pitch,tilt.roll,0)):new T.Quaternion(...Object.values(core.mediumQuaternion(value,0)));
    const radius=kind==='ship'?1:51.75;
    const vertices=geometry.vertices.map(p=>{const v=new T.Vector3(...p).applyQuaternion(q).multiplyScalar(radius);return [v.x,-v.y];});
    const inside=triangleTester(vertices,geometry.triangles);
    const surface=(x,y)=>kind==='ship'?core.shipSurface(core.shipPose(body),x,y):core.mediumSurface(body,x,y);
    for(const p of vertices){const error=surface(...p).distance;if(kind==='ship')maxShipError=Math.max(maxShipError,error);else maxRockError=Math.max(maxRockError,error);assert.ok(error<.72,kind+' projected mesh stays within sub-unit contour tolerance: '+error);vertexChecks++;}
    for(let y=-52;y<52;y+=3.7)for(let x=-52;x<52;x+=3.9){
      const d=surface(x,y).distance;
      if(Math.abs(d)>.75){assert.equal(d<0,inside(x,y),kind+' visible triangles match its collision silhouette');meshChecks++;}
    }
    if(kind==='ship')for(let k=0;k<24;k++){
      const angle=k*Math.PI/12,dx=Math.cos(angle),dy=Math.sin(angle);
      const p=vertices.reduce((best,p)=>p[0]*dx+p[1]*dy>best[0]*dx+best[1]*dy?p:best,vertices[0]);
      assert.ok(core.projectileHitsShipHull({x:p[0],y:p[1]},body,.7),'actual model extremities are hittable at every bank');
      assert.equal(core.projectileHitsShipHull({x:p[0]+dx*3,y:p[1]+dy*3},body,.2),false,'bullets outside the actual banked model must pass');
    }
  }
}
const ship={x:500,y:500,rot:0,bank:0,shield:0},rock={x:537,y:518,r:1,fragment:true};
assert.ok(core.asteroidShipContact(rock,ship,false,false),'a wing tip must collide with a small rock');
ship.bank=Math.PI/3;assert.equal(core.asteroidShipContact(rock,ship,false,false),null,'banking changes the visible wing width and its collision');
ship.pbank=-Math.PI/3;
assert.ok(core.asteroidShipContact(rock,ship),'a wing passing through a rock during bank is detected between frames');
assert.ok(core.projectileHitsShipHull({x:537,y:518},ship,.3),'a bank sweep cannot pass through a stationary bullet');
let sweptPoint;
const spinning={id:0,x:0,y:0,r:51.75,spin:1.8,pspin:0};
for(let y=-48;y<48&&!sweptPoint;y+=2)for(let x=-48;x<48;x+=2){
  if(core.mediumSurface({...spinning,spin:0},x,y).distance>1&&core.mediumSurface(spinning,x,y).distance>1&&core.mediumSurface({...spinning,spin:.9},x,y).distance<-1){sweptPoint={x,y};break;}
}
assert.ok(sweptPoint,'fixture crosses only the intermediate rotated silhouette');
assert.ok(core.asteroidHitsCircle(spinning,sweptPoint,.2,()=>false),'3D rotation sweeps its changing silhouette between frames');
for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
  const engine=new ctx.window[name]({});
  const p=Object.assign(engine.makePlayer(0,'Pilot',false),{x:500,y:500,rot:0,speed:1,bank:0,spawnFx:0});
  engine.players=[p];engine.asteroids=[{id:4,x:1000,y:500,r:51.75,spin:1,vx:0,vy:0,exitDelay:-1}];engine.updateAsteroidPopulation=()=>{};
  for(let i=0;i<180;i++){core.stepShipMovement(p,{turn:1,thrust:false});engine.updateAsteroids(1/60);}
  assert.ok(Math.abs(p.bank+Math.PI/3)<.0001,'authoritative turn reaches progressive 60 degree bank');
  const snapshot=JSON.parse(JSON.stringify(engine.publicState()));
  assert.ok(Math.abs(snapshot.players[0].b-p.bank)<.0006,'ship bank travels in the actual state packet');
  assert.ok(Math.abs(snapshot.asteroids[0].s-engine.asteroids[0].spin)<.0006,'rock phase travels in the actual state packet');
  assert.equal(snapshot.asteroids[0].r,51.75,'the 15 percent enlargement also applies to collision and network size');
  assert.ok(Number.isFinite(snapshot.simTime),'both engines publish simulation time');
  const before=p.bank;for(let i=0;i<120;i++)core.stepShipMovement(p,{turn:0,thrust:false});assert.ok(Math.abs(p.bank)<Math.abs(before)*.001,'bank smoothly returns to level');
}
console.log(`Rotating profiles OK: ${partitions} convex partitions, ${vertexChecks} actual GLB vertices, ${meshChecks} independent projected-mesh checks; max ship error ${maxShipError.toFixed(3)}, rock ${maxRockError.toFixed(3)} arena units. Authority packets, +15% size, banked wing contacts and projectile gaps OK.`);
