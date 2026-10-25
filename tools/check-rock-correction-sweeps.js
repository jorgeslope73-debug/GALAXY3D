'use strict';
const assert=require('node:assert/strict');
const {engineContext}=require('./check-session-regressions.js');
const ctx=engineContext(),core=ctx.window.GalaxyPhysicsCore;
const emptySwept=()=>false;
function stationaryPair(engine){
  const a={id:1,x:900,y:500,px:900,py:500,r:51.75,spin:2.1205750411731104,pspin:2.1205750411731104,vx:0,vy:0};
  const b={id:2,x:900+Math.cos(963*.13)*75,y:500+Math.sin(963*.13)*75,r:51.75,spin:298.53,pspin:298.53,vx:0,vy:0};
  b.px=b.x;b.py=b.y;
  const before={...a};core.captureRockMotion(a);core.captureRockMotion(b);
  assert.equal(engine?engine.resolveAsteroidPairCollision(a,b):core.resolveAsteroidPairCollision(a,b),true);
  assert.ok(Math.hypot(a.x-before.x,a.y-before.y)>22,'fixture has a substantial correction without physical movement');
  return {a,b,before};
}
const target={x:860.5,y:515.5},radius=4;
const ghostShip=()=>({x:854.3244036361639,y:568.7373021739588,px:854.3244036361639,py:568.7373021739588,
  rot:0,pr:0,bank:-Math.PI/3,pbank:-Math.PI/3,shield:0,protection:0,spawnFx:0,dead:false});
{
  const {a,b,before}=stationaryPair();
  assert.ok(core.mediumSurface(before,target.x,target.y).distance>4.6,'the shot misses the real stationary rock before separation');
  assert.ok(core.mediumSurface(a,target.x,target.y).distance>7.6,'the shot also misses its corrected final position');
  assert.equal(core.asteroidHitsCircle(a,target,radius,emptySwept),null,'instantaneous separation cannot consume a shot along a fictitious path');
  assert.ok(core.asteroidHitsCircle({...a},target,radius,emptySwept),'discarding the saved real path reproduces the old ghost hit');
  assert.equal(core.asteroidHitsCircle(b,target,radius,emptySwept),null);
  assert.ok(core.asteroidHitsCircle(a,{x:980,y:500,px:780,py:500},radius,emptySwept),'a genuine fast shot still hits the separated rock');
  const ship=ghostShip();
  assert.equal(core.asteroidShipContact(before,ship,false,false),null,'the complete banked hull is clear before correction');
  assert.equal(core.asteroidShipContact(a,ship,false,false),null,'the complete banked hull is clear after correction');
  assert.equal(core.asteroidShipContact(b,ship,false,false),null,'the other rock is clear too');
  assert.ok(core.asteroidShipContact({...a},ship),'the old correction sweep reproduces the phantom ship collision');
  assert.equal(core.asteroidShipContact(a,ship),null,'a stationary banked ship cannot be killed by a separation jump');
}
{
  const a={id:1,x:800,y:500,px:600,py:500,r:51.75,spin:1.1,pspin:1.1,vx:12000,vy:0};
  const g={x:800,y:500,px:800,py:500,vx:0,vy:0};
  const shot={x:700,y:500},ship={x:700,y:500,px:700,py:500,rot:0,pr:0,bank:0,pbank:0,shield:0};
  core.captureRockMotion(a);
  assert.equal(core.resolveGiantAsteroidCollision(g,a,135,51.75),true);
  assert.equal(core.asteroidShipContact(a,ship,false,false),null,'the corrected final rock is clear of the ship');
  const realBulletHit=core.asteroidHitsCircle(a,shot,radius,emptySwept),realHullHit=core.asteroidShipContact(a,ship);
  assert.ok(realBulletHit&&realBulletHit.t>0&&realBulletHit.t<1,'real rock flight before correction remains continuous against bullets');
  assert.ok(realHullHit&&realHullHit.t<1,'real rock flight before correction remains continuous against hulls');
  const firstEnd={...a};
  assert.equal(core.resolveGiantAsteroidCollision({...g,x:a.x,y:a.y},a,135,51.75),true,'a second correction is applied in the same tick');
  assert.ok(core.asteroidHitsCircle(a,shot,radius,emptySwept),'multiple corrections preserve the original integrated path');
  const jumpOnly={x:(firstEnd.x+a.x)*.5,y:(firstEnd.y+a.y)*.5};
  assert.ok(core.mediumSurface(firstEnd,jumpOnly.x,jumpOnly.y).distance>radius);
  assert.ok(core.mediumSurface(a,jumpOnly.x,jumpOnly.y).distance>radius);
  assert.equal(core.asteroidHitsCircle(a,jumpOnly,radius,emptySwept),null,'a new correction does not append a new swept flight');
  const finalBody={x:a.x,y:a.y};
  assert.equal(core.asteroidHitsCircle(a,finalBody,radius,emptySwept)?.t,1,'the corrected final position is still solid');
  assert.equal(core.asteroidShipContact(a,{...ship,x:a.x,y:a.y,px:a.x,py:a.y})?.t,1,'final hull overlaps are still detected');
  a.px=a.x;a.py=a.y;a.pspin=a.spin;core.captureRockMotion(a);
  assert.equal(core.asteroidHitsCircle(a,shot,radius,emptySwept),null,'the next stationary tick must not reuse the previous real flight');
  assert.equal(core.asteroidShipContact(a,ship),null,'the next stationary tick must not reuse an old hull sweep');
  a.px=a.x;a.py=a.y;core.advanceRockPose(a,1/60);core.captureRockMotion(a);
  assert.equal(core.asteroidHitsCircle(a,shot,radius,emptySwept),null,'the next rotated tick has its own path');
}
for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
  const engine=new ctx.window[name]({onEvent:()=>{}});
  const {a,b}=stationaryPair(engine);
  Object.assign(engine,{players:[],asteroids:[a,b],meteors:[],pickups:[],flares:[],giant:null,ufo:null,bullets:[{id:9,owner:99,...target,vx:0,vy:0,age:0,travel:100,guided:false}]});
  engine.updateBullets(1/60);assert.equal(engine.bullets.length,1,name+': the real update keeps a shot clear of a separation jump');
  engine.bullets=[{id:10,owner:99,x:780,y:500,vx:12000,vy:0,age:0,travel:100,guided:false}];
  engine.updateBullets(1/60);assert.equal(engine.bullets.length,0,name+': the real update retains fast physical impacts');
  const corrected=stationaryPair(engine);
  engine.players=[Object.assign(engine.makePlayer(0,'Pilot',false),ghostShip())];engine.asteroids=[corrected.a,corrected.b];engine.flares=[];
  engine.shipCollisions();assert.equal(engine.players[0].dead,false,name+': the real collision loop preserves the banked ship clear of both rocks');
}
console.log('Rock correction sweeps OK: no ghost bullet or banked-hull hit along depenetration, genuine fast motion retained, final overlaps solid, repeated corrections and consecutive ticks isolated; host/local engines agree.');
