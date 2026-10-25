'use strict';
// Compare conservative broad-phase pruning with the same narrow phase unpruned.
// This checks geometry/results rather than asserting machine-specific timings.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/physics-core.js','utf8');
const profiles=fs.readFileSync('docs/collision-profiles.js','utf8');
const bounds=/  function separatedBounds\(a,b,skin=0\)\{[\s\S]*?\n  \}/;
const outer=/  function outerOverlap\(a,b,skin=0\)\{[\s\S]*?\n  \}/;
assert.ok(bounds.test(source),'locate the independent conservative bounds filter');
assert.ok(outer.test(source),'locate the independent outer-envelope filter');
function context(prune,aabbOnly=false){
  const c=vm.createContext({window:{},console,performance});
  vm.runInContext(profiles,c);
  let code=prune?source:source.replace(bounds,'  function separatedBounds(a,b,skin=0){return false;}');
  if(!prune)code=code.replace(outer,'  function outerOverlap(a,b,skin=0){return true;}');
  if(aabbOnly)code=code.replace(outer,'  function outerOverlap(a,b,skin=0){return !separatedBounds(a,b,skin);}');
  code=code.replace('  function convexContact(a,b,skin=0){','  function convexContact(a,b,skin=0){window.convexChecks=(window.convexChecks||0)+1;');
  vm.runInContext(code,c);
  return c;
}
const fast=context(true),reference=context(false),core=fast.window.GalaxyPhysicsCore,slow=reference.window.GalaxyPhysicsCore;
const copy=o=>JSON.parse(JSON.stringify(o));
const clean=o=>o==null?null:copy(o);
let seed=0x61f8d42;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function ship(x,y){
  const bank=(random()*120-60)*Math.PI/180,rot=random()*360;
  return {x,y,px:x+(random()-.5)*10,py:y+(random()-.5)*10,rot,pr:rot+(random()-.5)*8,bank,pbank:Math.max(-Math.PI/3,Math.min(Math.PI/3,bank+(random()-.5)*.15)),poseTime:41.6,previousPoseTime:41.6-1/60,index:Math.floor(random()*4),shield:random()<.08?10:0,dead:false,vx:0,vy:0};
}
function rock(x,y,r=51.75){const spin=random()*Math.PI*2;return {id:Math.floor(random()*100),x,y,px:x+(random()-.5)*6,py:y+(random()-.5)*6,r,spin,pspin:spin-.003,vx:(random()-.5)*200,vy:(random()-.5)*200};}
let comparisons=0;
function same(name,a,b){assert.deepEqual(clean(a),clean(b),name+' must preserve exact narrow-phase result');comparisons++;}
for(let i=0;i<320;i++){
  const angle=random()*Math.PI*2,d=35+random()*100,a=ship(800,500),b=ship(800+Math.cos(angle)*d,500+Math.sin(angle)*d);
  same('banked ship pair',core.shipPairContact(copy(a),copy(b)),slow.shipPairContact(copy(a),copy(b)));
}
for(let i=0;i<240;i++){
  const giant=i%3===0,r=giant?core.GIANT_RADIUS:51.75,angle=random()*Math.PI*2,d=r+random()*85-30,a=rock(800,500,r),b=ship(800+Math.cos(angle)*d,500+Math.sin(angle)*d);
  same('moving rock / banked hull',core.asteroidShipContact(copy(a),copy(b),giant),slow.asteroidShipContact(copy(a),copy(b),giant));
}
for(let i=0;i<240;i++){
  const giant=i%3===0,ra=giant?core.GIANT_RADIUS:51.75,rb=51.75,angle=random()*Math.PI*2,d=ra+rb+(random()-.7)*90,a=rock(800,500,ra),b=rock(800+Math.cos(angle)*d,500+Math.sin(angle)*d,rb);
  same('concave rock pair',core.rockContact(copy(a),copy(b),ra,rb,giant?'giant':undefined),slow.rockContact(copy(a),copy(b),ra,rb,giant?'giant':undefined));
  const fa=copy(a),fb=copy(b),sa=copy(a),sb=copy(b);
  const hitFast=giant?core.resolveGiantAsteroidCollision(fa,fb,ra,rb):core.resolveAsteroidPairCollision(fa,fb,rb);
  const hitSlow=giant?slow.resolveGiantAsteroidCollision(sa,sb,ra,rb):slow.resolveAsteroidPairCollision(sa,sb,rb);
  same('separation decision',hitFast,hitSlow);same('separated body A',fa,sa);same('separated body B',fb,sb);
}
// A real high-cost near miss captured from a 4-player online host. Both the
// yaw and the bank change within the tick, so the full CCD path is exercised.
const hotRock={id:1,x:1364.304529233701,y:423.22631848453824,px:1364.236509120609,py:423.96291503516807,r:core.GIANT_RADIUS};
const hotShip={x:1500.3801944239613,y:375.4832837355016,px:1500.4015924751166,py:375.40101411075284,rot:188.9474419822409,pr:184.9474419822409,bank:.587135407001762,pbank:.6873707314512206,shield:0,protection:0};
// Preserve the captured approach direction when enlarging the original r=135
// obstacle. The hull keeps its real size, rotation, bank and CCD motion.
const capturedScale=core.GIANT_RADIUS/135;
for(const key of ['x','y','px','py'])hotShip[key]=hotRock[key]+(hotShip[key]-hotRock[key])*capturedScale;
fast.window.convexChecks=0;reference.window.convexChecks=0;
const hotFast=core.asteroidShipContact(copy(hotRock),copy(hotShip),true),hotSlow=slow.asteroidShipContact(copy(hotRock),copy(hotShip),true);
same('giant near-miss sweep',hotFast,hotSlow);assert.equal(hotFast,null,'the resized fixture remains a real near miss');
const prunedChecks=fast.window.convexChecks,unprunedChecks=reference.window.convexChecks;
assert.ok(unprunedChecks>10000,'fixture reaches the expensive unpruned piece-combination loop');
assert.ok(prunedChecks<unprunedChecks*.25,'bounds pruning removes at least 75 percent of narrow-phase calls in the captured hot path');
// A second near miss has overlapping whole AABBs; only the true convex
// envelope can cheaply reject it before testing all the concave pieces.
const boxes=context(true,true),boxCore=boxes.window.GalaxyPhysicsCore;
const cornerRock={id:1,x:800,y:500,px:800,py:500,r:core.GIANT_RADIUS};
// Repositioned against the r=189 outline with the same real hull/rotation:
// its whole boxes overlap, while the convex envelopes remain separated.
const cornerShip={x:784.6839222994231,y:290.80994224421204,px:784.6839222994231,py:290.80994224421204,rot:278.03069145418704,pr:274.03069145418704,bank:-.3393080002068256,pbank:-.3893080002068256,shield:0};
fast.window.convexChecks=0;boxes.window.convexChecks=0;
const cornerFast=core.asteroidShipContact(copy(cornerRock),copy(cornerShip),true),cornerBoxes=boxCore.asteroidShipContact(copy(cornerRock),copy(cornerShip),true);
same('convex-envelope near miss',cornerFast,cornerBoxes);assert.equal(cornerFast,null,'overlapping AABBs still have a genuine gap');
const envelopeChecks=fast.window.convexChecks,boxOnlyChecks=boxes.window.convexChecks;
assert.ok(boxOnlyChecks>300,'fixture retains substantial work when only boxes are tested');
assert.ok(envelopeChecks<boxOnlyChecks*.25,'convex envelopes reject overlapping-box near misses conservatively');
console.log(`Physics hot paths OK: ${comparisons} exact equivalence checks across banked hulls, CCD and concave rock separation; hot-path convex calls ${unprunedChecks} -> ${prunedChecks}, ${(100*(1-prunedChecks/unprunedChecks)).toFixed(1)}% removed; overlapping-box case ${boxOnlyChecks} -> ${envelopeChecks}. Geometry, tolerance and outcomes unchanged.`);
