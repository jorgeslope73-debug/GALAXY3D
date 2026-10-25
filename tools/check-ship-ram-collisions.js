'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {engineContext}=require('./check-session-regressions.js');
const context=engineContext(),core=context.window.GalaxyPhysicsCore;
const names=['GalaxyHostPhysics','GalaxyLocalCpu'],angles=[0,30,45,90,135,180,225,270,315,359];
const place=(x,y,rot=0,extra={})=>({x,y,px:x,py:y,rot,pr:rot,vx:0,vy:0,shield:0,protection:0,dead:false,...extra});
const rotate=(x,y,rot)=>{const a=rot*Math.PI/180;return {x:500+x*Math.cos(a)+y*Math.sin(a),y:500-x*Math.sin(a)+y*Math.cos(a)};};
function fixture(name,a,b){
  const engine=new context.window[name]({onEvent:()=>{}});
  engine.players=[a,b].map((pose,i)=>Object.assign(engine.makePlayer(i,'J'+i,false),pose,{index:i,spawnFx:0,kills:0,dead:false}));
  Object.assign(engine,{asteroids:[],meteors:[],pickups:[],flares:[],bullets:[],giant:null,ufo:null,activeShockwaves:[],fxClock:10});
  return engine;
}
let scenarios=0;
for(const name of names){
  for(const rot of angles)for(const [label,dx,dy,relative,hit] of [
    ['morro contra morro',0,-92,180,true],['punta de ala',76,0,0,true],['motor contra morro',10,92,0,true],
    ['hueco delante del morro',0,-96,180,false],['paso fuera del ala',80,0,0,false]
  ]){
    const b=rotate(dx,dy,rot),engine=fixture(name,place(500,500,rot),place(b.x,b.y,(rot+relative)%360));
    engine.shipCollisions();assert.equal(engine.players[0].dead,hit,name+' '+label+' rot='+rot);assert.equal(engine.players[1].dead,hit);
    assert.deepEqual(engine.players.map(p=>p.kills),[0,0],'unarmed mutual collisions preserve scoring');scenarios++;
  }
  {
    const engine=fixture(name,place(500,500),place(420,540,180,{px:580,py:540}));
    engine.shipCollisions();assert.ok(engine.players.every(p=>p.dead),'fast wing contact cannot pass between frames');
    assert.ok(engine.players[1].x>500,'death stays on the actual entry side');scenarios++;
  }
  {
    const engine=fixture(name,place(500,500),place(548,454,180,{pr:0}));
    assert.equal(core.shipPairContact(...engine.players,false),null,'rotation fixture ends without overlap');
    engine.shipCollisions();assert.ok(engine.players.every(p=>p.dead),'the swept turning wing causes collision');scenarios++;
  }
  {
    const engine=fixture(name,place(500,500),place(548,454,1,{pr:359}));
    engine.shipCollisions();assert.ok(engine.players.every(p=>!p.dead),'359 to 1 uses the short turn, not a whole revolution');scenarios++;
  }
  for(const [ax,bx,oldX] of [[5,1915,1915],[960,1910,10]]){
    const engine=fixture(name,place(ax,500),place(bx,500,0,{px:oldX}));
    engine.shipCollisions();assert.ok(engine.players.every(p=>!p.dead),'opposite edges and wraps never sweep across the arena');scenarios++;
  }
  for(const hit of [false,true]){
    const engine=fixture(name,place(500,500,0,{shield:10}),place(500,hit?394:392,180));
    engine.shipCollisions();assert.equal(engine.players[0].dead,false);assert.equal(engine.players[1].dead,hit,'nose contacts the shield perimeter');
    assert.equal(engine.players[0].kills,hit?1:0);engine.shipCollisions();assert.equal(engine.players[0].kills,hit?1:0,'one contact cannot award two kills');scenarios++;
  }
  for(const shield of [0,10]){
    const engine=fixture(name,place(500,500,0,{protection:3,shield}),place(576,500,0,{protection:3,shield}));
    engine.shipCollisions();assert.ok(engine.players.every(p=>!p.dead),'protected hulls and shields bounce');
    assert.equal(core.shipPairContact(...engine.players,false),null,'both complete silhouettes separate');
    for(const p of engine.players)for(const key of ['x','y','vx','vy'])assert.ok(Number.isFinite(p[key]));scenarios++;
  }
  {
    const engine=fixture(name,place(500,500,0,{shield:10}),place(500,500,0,{shield:10}));
    engine.shipCollisions();assert.ok(engine.players.every(p=>!p.dead));assert.equal(core.shipPairContact(...engine.players,false),null,'coincident shield centres separate without NaN');scenarios++;
  }
}
// Independent polygon checks catch false hits in the empty areas between wings.
function hull(ship){const a=ship.rot*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return core.SHIP_PROJECTILE_HULL.map(([x,y])=>[ship.x+x*c+y*s,ship.y-x*s+y*c]);}
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function gap(a,b){let best=Infinity;for(let side=0;side<2;side++){const p=side?b:a,q=side?a:b;for(const v of p)for(let i=0;i<q.length;i++){const u=q[i],w=q[(i+1)%q.length],dx=w[0]-u[0],dy=w[1]-u[1],t=Math.max(0,Math.min(1,((v[0]-u[0])*dx+(v[1]-u[1])*dy)/(dx*dx+dy*dy)));best=Math.min(best,Math.hypot(v[0]-u[0]-t*dx,v[1]-u[1]-t*dy));}}return best;}
function overlap(a,b){for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];if(cross(p,q,r)*cross(p,q,s)<0&&cross(r,s,p)*cross(r,s,q)<0)return true;}return inside(a[0],b)||inside(b[0],a);}
let seed=0x7321abcd,compared=0;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<1200;i++){
  const a=place(500,500,random()*360),b=place(500+random()*210-105,500+random()*210-105,random()*360),pa=hull(a),pb=hull(b),hit=core.shipPairContact(a,b,false);
  if(overlap(pa,pb))assert.ok(hit,'all overlaps of the true concave hulls must hit');
  else if(gap(pa,pb)>core.SHIP_CONTACT_SKIN+.00001)assert.equal(hit,null,'empty space beyond the small contact tolerance must stay empty');
  compared++;
}
async function realModel(){
  const url=file=>pathToFileURL(path.resolve(__dirname,'../docs/'+file)).href;
  const T=await import(url('vendor/three.module.min.js')),{GLTFLoader}=await import(url('vendor/GLTFLoader.js')),{prepareShipTemplate}=await import(url('ship-model.js'));
  const bytes=fs.readFileSync(path.resolve(__dirname,'../docs/assets/models/nave.glb')),loader=new GLTFLoader();
  loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
  const model=prepareShipTemplate((await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene),vertices=[];
  model.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);vertices.push([v.x*1.5,-v.y*1.5]);}});
  const support=(rot,nx,ny,sign)=>{const a=rot*Math.PI/180,c=Math.cos(a),s=Math.sin(a);let best=-Infinity,chosen;for(const [x,y] of vertices){const p=[x*c+y*s,-x*s+y*c],score=(p[0]*nx+p[1]*ny)*sign;if(score>best){best=score;chosen=p;}}return chosen;};
  let contacts=0;
  for(const rot of angles)for(let i=0;i<16;i++){
    const nx=Math.cos(i*Math.PI/8),ny=Math.sin(i*Math.PI/8),other=(rot+137)%360,pa=support(rot,nx,ny,1),pb=support(other,nx,ny,-1);
    const a=place(500,500,rot),b=place(500+pa[0]-pb[0],500+pa[1]-pb[1],other);
    assert.ok(core.shipPairContact(a,b,false),'touching actual GLB extremities must hit, including nose, wings and engines');contacts++;
  }
  console.log(`Ship ramming OK: ${scenarios} engine scenarios, ${compared} independent concave polygon checks, ${contacts} contacts at actual GLB extremities; shields, protection, scoring, rotation/motion CCD and screen wraps.`);
}
realModel().catch(error=>{console.error(error);process.exitCode=1;});
