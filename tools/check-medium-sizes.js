'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const ctx=engineContext(),core=ctx.window.GalaxyPhysicsCore,DT=1/60;
const clean=value=>JSON.parse(JSON.stringify(value));
const radii=Array.from(core.MEDIUM_ROCK_RADII);
const rock=(id,r,x=800,y=500)=>({id,r,x,y,px:x,py:y,spin:1.2,pspin:1.2,vx:40,vy:0,type:1,exitDelay:-1});
function check(label,fn){fn();console.log('OK: '+label);}
function fixture(name,state={}){
  const engine=new ctx.window[name]({});
  Object.assign(engine,{players:[],asteroids:[],meteors:[],pickups:[],flares:[],bullets:[],giant:null,ufo:null},state);
  engine.updateAsteroidPopulation=()=>{};return engine;
}

check('current size is the minimum and larger variants stay in the medium collision class',()=>{
  assert.ok(Object.isFrozen(core.MEDIUM_ROCK_RADII));assert.equal(radii.length,3);
  assert.equal(radii[0],51.75);
  assert.ok(Math.abs(radii[1]/radii[0]-1.15)<.00002);
  assert.ok(Math.abs(radii[2]/radii[0]-1.30)<.00002);
  const counts=new Map(radii.map(r=>[r,0]));
  vm.runInContext('globalThis.sizeSavedRandom=Math.random;Math.random=()=>{throw Error("size consumed random");};',ctx);
  try{
    for(let id=1;id<=10000;id++){
      const radius=core.mediumRockRadius(id);
      assert.ok(counts.has(radius));counts.set(radius,counts.get(radius)+1);
      assert.equal(core.mediumRockRadius(id),radius);
    }
  }finally{vm.runInContext('Math.random=globalThis.sizeSavedRandom;delete globalThis.sizeSavedRandom;',ctx);}
  for(const [i,weight]of [.55,.30,.15].entries())assert.ok(Math.abs(counts.get(radii[i])/10000-weight)<.003);
  for(const r of radii){assert.ok(r>=51.75&&r<100);assert.ok(core.isMediumRock(rock(1,r)));}
});

check('host and CPU spawn exactly the same variants without extra random draws',()=>{
  const results=[];
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const c=engineContext(),engine=new c.window[name]({});engine.asteroids=[];
    vm.runInContext('let sizeSeed=123456;globalThis.sizeDraws=0;Math.random=()=>{sizeDraws++;sizeSeed=(Math.imul(sizeSeed,1664525)+1013904223)>>>0;return sizeSeed/4294967296;};',c);
    let expectedDraws=0;
    for(let i=0;i<24;i++){
      const random=i%2===1;engine.spawnAsteroidFromEdge(i%5,random);expectedDraws+=random?6:5;
      const a=engine.asteroids.at(-1);
      assert.equal(a.r,c.window.GalaxyPhysicsCore.mediumRockRadius(a.id));
      assert.ok(a.x+a.r<0||a.x-a.r>1920||a.y+a.r<0||a.y-a.r>1080,'every size enters from fully offscreen');
      assert.ok(Math.abs(Math.hypot(a.vx,a.vy)-80)<1e-8);
      assert.ok(a.spin>=0&&a.spin<Math.PI*2);
      assert.equal(a.exiting,false);assert.equal(a.exitDelay,-1);
    }
    assert.equal(vm.runInContext('sizeDraws',c),expectedDraws,'the calendar RNG sequence is preserved');
    assert.equal(new Set(engine.asteroids.map(a=>a.r)).size,3);
    results.push(clean(engine.asteroids));
  }
  assert.deepEqual(results[0],results[1]);
});

check('actual outlines, continuous bullet contact and mixed-size rock/giant separation',()=>{
  for(const r of radii){
    const a=rock(0,r,0,0);a.vx=0;
    for(let i=0;i<24;i++){
      const angle=i*Math.PI/12,edge=core.mediumSurface(a,300*Math.cos(angle),300*Math.sin(angle));
      assert.equal(core.asteroidCircleContact(a,{x:edge.x+edge.nx*4.6,y:edge.y+edge.ny*4.6},4),null,'a shot outside the scaled surface passes');
      assert.ok(core.asteroidCircleContact(a,{x:edge.x+edge.nx*3.4,y:edge.y+edge.ny*3.4},4),'the scaled visible edge is hittable');
    }
    const hit=core.asteroidHitsCircle(a,{px:-200,py:0,x:200,y:0},4,()=>false);
    assert.ok(hit&&hit.t>=0&&hit.t<=1);assert.ok(Math.abs(core.mediumSurface(a,hit.x,hit.y).distance)<1e-6);
    for(const other of radii){
      const first=rock(11,r,800,500),second=rock(12,other,820,500);second.vx=-40;
      assert.ok(core.rockContact(first,second));assert.equal(core.resolveAsteroidPairCollision(first,second),true);
      assert.equal(core.rockContact(first,second),null);
      assert.equal(first.r,r);assert.equal(second.r,other);
      for(const body of [first,second])for(const key of ['x','y','vx','vy'])assert.ok(Number.isFinite(body[key]));
    }
    const giant={x:900,y:500,vx:45,vy:0},surface=core.giantSurface(giant,1400,500);
    const medium=rock(7,r,surface.x+surface.nx*r*.3,surface.y+surface.ny*r*.3);
    assert.ok(core.rockContact(giant,medium,core.GIANT_RADIUS,r,'giant'));
    core.resolveGiantAsteroidContacts(giant,[medium],core.GIANT_RADIUS,51.75);
    assert.equal(core.rockContact(giant,medium,core.GIANT_RADIUS,r,'giant'),null);
    assert.deepEqual(clean(giant),{x:900,y:500,vx:45,vy:0});
  }
});

check('size is stable in flight; population units, exit and missile fragments stay compatible',()=>{
  const results=[];
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const engine=fixture(name,{asteroids:radii.map((r,i)=>rock(i+1,r,400+i*450,500))});
    assert.equal(engine.asteroidPopulationUnits(),3,'a larger model is still one population unit');
    for(let i=0;i<120;i++)engine.updateAsteroids(DT);
    assert.deepEqual(Array.from(engine.asteroids,a=>a.r),radii);
    for(const a of engine.asteroids){
      const result=core.asteroidMissileFracture(a,a.x+a.r,a.y,{fragmentRadius:28,rand:(a,b)=>(a+b)/2,uid:()=>1});
      assert.equal(result.fragments.length,2);
      assert.ok(result.fragments.every(f=>f.r===28&&f.fragment===true&&!core.isMediumRock(f)));
    }
    results.push(clean(engine.asteroids));
  }
  assert.deepEqual(results[0],results[1]);
});

check('existing r field carries each size exactly through codec and renderer',()=>{
  vm.runInContext(fs.readFileSync('docs/net-state-codec.js','utf8'),ctx);
  const codec=ctx.window.GalaxyStateCodec,keys=['fragment','id','r','s','type','x','y'];
  const game=fs.readFileSync('docs/game.js','utf8');
  assert.ok(game.includes('Math.max(56,(Number(a.r)||45)*2)'),'game derives visible diameter from the existing radius');
  const source=fs.readFileSync('docs/render-3d.js','utf8'),method=source.match(/      rock\([^\n]+\{[\s\S]*?\n      \},/)[0];
  let visibleRadius=0;
  const record={root:{scale:{setScalar:value=>{visibleRadius=value;}}},rock:{quaternion:{set:()=>{}},rotation:{set:()=>{}}}};
  const draw=vm.runInNewContext('({'+method+'}).rock',{take:()=>record,place:()=>{},now:1000,window:{GalaxyPhysicsCore:core},Math,Number,String});
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const engine=fixture(name,{asteroids:radii.map((r,i)=>rock(i+1,r,400+i*450,500))});
    const state=engine.publicState(),packet=codec.encode(state,0);assert.ok(packet);
    const restored=codec.decode(clean(packet));assert.ok(restored);
    assert.deepEqual(Array.from(restored.asteroids,a=>a.r),radii);
    for(const a of restored.asteroids){
      assert.deepEqual(Object.keys(a).sort(),keys,'no new network field');
      draw('a'+a.id,a.x,a.y,a.r*2,a.type,0,'medium',a.s);
      assert.equal(visibleRadius,a.r,'visible scale equals the collision radius');
    }
  }
});
console.log('Medium sizes OK: current minimum, +15%, +30%; same birth flow, scaled contacts, population and wire format.');
