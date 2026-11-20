'use strict';
// Independent geometry/trajectory checks for the moving phase-five labyrinth.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/void-core.js','utf8'),c);
const S=c.window.GalaxyVoidCore,TAU=Math.PI*2,delta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
let nextId=0;const uid=()=>++nextId;
const length=(b,p)=>Math.hypot(p.x-b.x,p.y-b.y);
function body(phase=0){const b=S.create(uid());for(const g of b.generators)g.hp=0;Object.assign(b,{stage:'infiltrate',outerGate:1,innerGate:1,outerAngle:phase,innerAngle:-phase*.7,pOuterAngle:phase,pInnerAngle:-phase*.7});return b;}
function pilot(b,r,a){return {x:b.x+Math.cos(a)*r,y:b.y+Math.sin(a)*r,px:b.x+Math.cos(a)*r,py:b.y+Math.sin(a)*r,vx:0,vy:0,dead:false,spawnFx:0};}
function staticPose(b){return {...b,pOuterAngle:b.outerAngle,pInnerAngle:b.innerAngle};}
function advance(b,p,dt,r,a){
  const previous={x:p.x,y:p.y};S.step(b,dt,p,uid);
  // Evaluate the requested path after advancing the real authority angles.
  const bearing=typeof a==='function'?a():a;
  p.px=previous.x;p.py=previous.y;p.x=b.x+Math.cos(bearing)*r;p.y=b.y+Math.sin(bearing)*r;
  p.vx=(p.x-p.px)/dt;p.vy=(p.y-p.py)/dt;
  const result=S.resolveShip(b,p,60);S.syncPresence(b,p,60);return result;
}
function radial(b,p,dt,from,to,layer,seconds=1.3){
  const n=Math.ceil(seconds/dt);
  for(let i=1;i<=n;i++){
    const bearing=()=>layer==='outer'?Math.PI+b.outerAngle:b.innerAngle;
    const result=advance(b,p,dt,from+(to-from)*i/n,bearing);
    assert.equal(result.contacts,0,'a shielded ship fits through the moving opening');
  }
  assert.ok(Math.abs(length(b,p)-to)<.01,'a full radial crossing reaches the other side');
}
function circleTo(b,p,dt,layer){
  for(let i=0;i<Math.ceil(15/dt);i++){
    const old=Math.atan2(p.y-b.y,p.x-b.x);
    const target=layer==='outer'?Math.PI+b.outerAngle:b.innerAngle;
    const err=delta(target,old);
    if(Math.abs(err)<.006)return;
    const next=old+Math.max(-.85*dt,Math.min(.85*dt,err));
    const result=advance(b,p,dt,S.CORRIDOR,next);assert.equal(result.contacts,0,'the entire widened corridor stays clear');
  }
  assert.fail('the pilot must be able to catch the rotating opening');
}
assert.equal(S.OUTER,450);assert.equal(S.INNER,260);
// Rotating holes remain traversable at every phase, with the full shield radius.
// The route enters the outer shell, navigates the corridor, enters the reactor,
// and physically leaves through both moving openings during the real countdown.
for(const dt of [1/30,1/60,1/120])for(const phase of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
  const b=body(phase),outside=S.OUTER+S.WALL+60+16;
  const p=pilot(b,outside,Math.PI+b.outerAngle);
  radial(b,p,dt,outside,S.CORRIDOR,'outer');circleTo(b,p,dt,'inner');
  radial(b,p,dt,S.CORRIDOR,S.INNER-S.WALL-60-4,'inner');assert.equal(b.inside,true);
  const oldOuter=b.outerAngle,oldInner=b.innerAngle;
  assert.ok(delta(oldOuter,phase)>0);assert.ok(delta(oldInner,-phase*.7)<0,'rings turn in opposite directions');
  b.stage='escape';b.escapeLeft=18;
  radial(b,p,dt,length(b,p),S.CORRIDOR,'inner');circleTo(b,p,dt,'outer');
  radial(b,p,dt,S.CORRIDOR,outside,'outer');
  assert.ok(S.escaped(b,p,60),'a real escape route exists before the countdown ends');
  assert.ok(b.escapeLeft>6,'18 seconds leave steering/acceleration margin beyond this geometric route');
  assert.notEqual(b.outerAngle,oldOuter);assert.notEqual(b.innerAngle,oldInner,'escape preserves the moving labyrinth');
}
// A trailing edge sweeping onto a stationary hull must push it clear rather than
// skipping the contact or teleporting its centre to the other side of the shell.
for(const dt of [1/30,1/60,1/120])for(const layer of ['outer','inner']){
  const b=body(),radius=layer==='outer'?S.OUTER:S.INNER,portal=layer==='outer'?Math.PI:0;
  const points=S.walls[layer].filter(s=>s.gate).flatMap(s=>[Math.atan2(s.ay,s.ax),Math.atan2(s.by,s.bx)]).map(a=>delta(a,portal));
  const edge=layer==='outer'?Math.min(...points):Math.max(...points),d=radius+45,r=60;
  const clearance=Math.acos((radius*radius+d*d-(S.WALL+r)**2)/(2*radius*d));
  const heading=portal+edge+(layer==='outer'?1:-1)*(clearance+.00005);
  const p=pilot(b,d,heading);
  assert.equal(S.firstHit(staticPose(b),p,r,{hullOnly:true}),null,'the ship starts clear of the edge');
  let contacts=0;
  for(let i=0;i<Math.ceil(.8/dt);i++){
    p.px=p.x;p.py=p.y;const before={x:p.x,y:p.y};S.step(b,dt,p,uid);
    const hit=S.resolveShip(b,p,r);contacts+=hit.contacts;
    assert.ok(length(b,p)>=radius+44,'the moving edge does not transfer an outside pilot through solid armor');
    assert.ok(Math.hypot(p.x-before.x,p.y-before.y)<8,'moving-wall separation is gradual, without a jump');
    assert.equal(S.firstHit(staticPose(b),{px:p.x,py:p.y,x:p.x,y:p.y},r-.2,{hullOnly:true}),null,'the final hull is outside the current wall pose');
  }
  assert.ok(contacts>0,'wall motion itself triggers collision for a stationary ship');
}
// Fast projectiles still hit solid arcs and can use the true rotating aperture.
for(const dt of [1/30,1/60,1/120])for(const phase of [0,.7,2.2,4.8]){
  const b=body(phase);S.step(b,dt,null,uid);
  for(const layer of ['outer','inner']){
    const radius=layer==='outer'?S.OUTER:S.INNER,opening=layer==='outer'?Math.PI+b.outerAngle:b.innerAngle;
    const path=a=>({px:b.x+Math.cos(a)*(radius+80),py:b.y+Math.sin(a)*(radius+80),x:b.x+Math.cos(a)*(radius-80),y:b.y+Math.sin(a)*(radius-80)});
    assert.equal(S.firstHit(b,path(opening),4),null,'fast shots pass only through the visible moving opening');
    assert.equal(S.firstHit(b,path(opening+Math.PI),4)?.kind,'wall','thin rotating walls stop fast bullets');
  }
}
// One slow, alternating interior cannon shot, with an initial grace period.
for(const dt of [1/30,1/60,1/120]){
  const b=body(),p=pilot(b,130,0),shots=[];
  for(let i=0;i<Math.ceil(59/dt);i++){
    const next=S.step(b,dt,p,uid);assert.ok(next.length<=1,'interior guns do not fire together');
    for(const shot of next)shots.push({time:b.age,slot:(b.shotSlot-1)%2,speed:Math.hypot(shot.vx,shot.vy)});
  }
  assert.ok(shots.length>=2&&shots.length<=9,'interior fire is sparse over a full minute');
  assert.ok(shots[0].time>=8-dt-.001,'the first cannon waits at least eight seconds');
  for(let i=0;i<shots.length;i++){
    assert.ok(Math.abs(shots[i].speed-200)<.001);
    if(i){assert.ok(shots[i].time-shots[i-1].time>=6.5-dt-.001);assert.notEqual(shots[i].slot,shots[i-1].slot,'the two recessed guns alternate');}
  }
  b.stage='escape';b.escapeLeft=18;for(let i=0;i<30;i++)assert.equal(S.step(b,dt,p,uid).length,0,'no cannon fire during escape');
  const copy=S.snapshot(b);copy.generators[0].hp=500;assert.notEqual(b.generators[0].hp,500);assert.equal(copy.outerAngle,b.outerAngle);assert.equal(copy.innerAngle,b.innerAngle);
}
console.log('Void moving maze OK: opposite rotation, shield-wide passages and complete 18-second escape at 30/60/120Hz; moving edges push without tunneling, swept bullets and sparse alternating interior cannons.');
