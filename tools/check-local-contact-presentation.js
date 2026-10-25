'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const context=engineContext(),core=context.window.GalaxyPhysicsCore;
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');

function functionSource(name){
  const start=game.indexOf('  function '+name+'(');
  const next=game.indexOf('\n  function ',start+1);
  assert.ok(start>=0&&next>start,'locate the production '+name+' function');
  return game.slice(start,next);
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const interpolationContext=vm.createContext({localCpuActive:true,previousState:{},state:{},lastStateTime:1000,smoothedStateInterval:50,clamp});
vm.runInContext(functionSource('interpolationAlpha'),interpolationContext);
assert.equal(interpolationContext.interpolationAlpha(1000),1,'CPU displays the newest collision state as soon as it is published');
assert.equal(interpolationContext.interpolationAlpha(1025),1,'CPU does not drift from the previous rock pose after a confirmed contact');
interpolationContext.localCpuActive=false;
assert.equal(interpolationContext.interpolationAlpha(1000),0,'the network interpolation path is preserved');
assert.equal(interpolationContext.interpolationAlpha(1025),.5,'the network interpolation path keeps its existing clock');

// Run the real position/orientation selection, stopping before artwork and DOM.
const drawStart=game.indexOf('  function drawShip('),drawEnd=game.indexOf('    // The short explosion',drawStart);
assert.ok(drawStart>=0&&drawEnd>drawStart);
const drawContext=vm.createContext({
  localCpuActive:true,myIndex:0,localVisual:{ready:true,index:0,x:20,y:30,r:40,lastAt:2000},
  guestMotion:{ready:true,sample:()=>({x:100,y:200,r:300})},
  W:1920,H:1080,perfStats:null
});
vm.runInContext(game.slice(drawStart,drawEnd)+'    return {x,y,r};\n  }',drawContext);
for(const i of [0,1,2,3]){
  const p={i,x:500+i*70,y:450+i*20,r:67+i*30};
  const old={...p,x:p.x-40,y:p.y+30,r:p.r-55};
  for(const blend of [0,.5,1]){
    const pose=drawContext.drawShip(p,old,blend,2020);
    assert.deepEqual(JSON.parse(JSON.stringify(pose)),{x:p.x,y:p.y,r:p.r},'every local CPU ship uses the same final tick as its meteorites, not an independently predicted pose');
  }
}
assert.match(game,/new window\.GalaxyLocalCpu\(\{[^}]*renderEveryStep\s*:\s*true/s,'normal CPU matches opt into per-frame state publication');

const distance=(p,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
  const t=Math.max(0,Math.min(1,len?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len:0));
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);
};
function edgesCross(a,b,c,d){
  const cross=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
  return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
}
function polygonGap(a,b){
  let best=Infinity;
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(edgesCross(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))return 0;
  for(let side=0;side<2;side++){
    const points=side?a:b,edges=side?b:a;
    for(const p of points)for(let i=0;i<edges.length;i++)best=Math.min(best,distance(p,edges[i],edges[(i+1)%edges.length]));
  }
  return best;
}
function shipPolygon(ship){
  const pose=core.shipPose(ship),c=Math.cos(pose.rot),s=Math.sin(pose.rot);
  return core.shipProfile(pose).outline.map(([x,y])=>[ship.x+x*c+y*s,ship.y-x*s+y*c]);
}
function rockPolygon(rock){
  const angle=core.mediumRotation(rock.x,rock.y,rock.id),c=Math.cos(angle),s=Math.sin(angle);
  return core.mediumProfile(rock).outline.map(([x,y])=>[rock.x+rock.r*(x*c+y*s),rock.y+rock.r*(-x*s+y*c)]);
}
const ship={x:500,y:500,px:500,py:500,rot:0,pr:0,bank:0,shield:0,index:0};
let reproduction;
// Vary only the spawn offset so the regression remains about presentation,
// independently of small future adjustments to the collider's contact skin.
for(let offset=0;offset<10&&!reproduction;offset+=.5){
  const rock={id:1,x:350+offset,y:500,r:51.75,spin:1,vx:190,vy:0};let previous={...rock};
  for(let tick=1;tick<120;tick++){
    rock.px=rock.x;rock.py=rock.y;core.advanceRockPose(rock,1/60);rock.x+=rock.vx/60;
    if(core.asteroidShipContact(rock,ship,false,false)){
      const legacyGap=polygonGap(rockPolygon(previous),shipPolygon(ship));
      if(legacyGap>3){
        reproduction={legacyGap,currentGap:polygonGap(rockPolygon(rock),shipPolygon(ship)),tick,rock:{...rock},previous};
        break;
      }
    }
    if(tick%3===0)previous={...rock};
  }
}
assert.ok(reproduction,'reproduce a confirmed medium contact while a 20 Hz previous snapshot still leaves a visible gap');
assert.ok(reproduction.currentGap<1,'the current collider is at the ship surface');
assert.ok(reproduction.legacyGap>reproduction.currentGap+3,'old interpolation could show a gap larger than the collision tolerance');
interpolationContext.localCpuActive=true;
const blend=interpolationContext.interpolationAlpha(1000),r=reproduction.rock,old=reproduction.previous;
const visible={...r,x:old.x+(r.x-old.x)*blend,y:old.y+(r.y-old.y)*blend,spin:old.spin+(r.spin-old.spin)*blend};
assert.ok(polygonGap(rockPolygon(visible),shipPolygon(ship))<1,'the CPU impact frame now displays the actual touching silhouette');

let publicationFrames=0;
const publicationRates=[];
for(const hz of [30,60,120])for(const renderEveryStep of [false,true]){
  let updates=0;const snapshots=[];
  const options={onState:s=>snapshots.push(s)};if(renderEveryStep)options.renderEveryStep=true;
  const engine=new context.window.GalaxyLocalCpu(options);
  const p=Object.assign(engine.makePlayer(0,'Pilot',false),{x:500,y:500,rot:0,speed:1,bank:0,spawnFx:0});
  engine.players=[p];engine.asteroids=[{id:1,x:1000,y:500,r:51.75,spin:1,vx:80,vy:0}];
  Object.assign(engine,{started:true,finished:false,lastNow:1000,accumulator:0,tickCount:0});
  // Keep the fixed-step integrator and actual publicState serialization, while
  // isolating the publisher from campaign randomness and unrelated hazards.
  engine.update=dt=>{
    updates++;engine.fxClock+=dt;p.previousPoseTime=p.poseTime;p.poseTime=engine.fxClock;
    core.stepShipMovement(p,{turn:.6,thrust:true},dt);
    const a=engine.asteroids[0];core.advanceRockPose(a,dt);a.x+=a.vx*dt;
  };
  for(let frame=1;frame<=hz*2;frame++){
    const before=updates,count=snapshots.length;
    engine.advance(1000+frame*1000/hz);
    const stepped=updates>before,published=snapshots.length-count;
    assert.ok(published<=1,'catch-up steps publish a single final state per animation frame');
    if(renderEveryStep)assert.equal(published,stepped?1:0,'a visible CPU frame publishes its final simulated tick immediately');
    if(published){
      const s=snapshots.at(-1),a=engine.asteroids[0];
      assert.ok(Math.abs(s.players[0].x-p.x)<=.051&&Math.abs(s.players[0].y-p.y)<=.051,'ship and snapshots use the final tick');
      assert.ok(Math.abs(s.players[0].r-p.rot)<=.051&&Math.abs(s.players[0].b-p.bank)<=.00051,'heading and bank share the final tick');
      assert.ok(Math.abs(s.asteroids[0].x-a.x)<=.051&&Math.abs(s.asteroids[0].s-a.spin)<=.00051,'meteor position and phase share the final tick');
      assert.ok(Math.abs(s.simTime-engine.fxClock)<=.00051,'all poses share simulation time');publicationFrames++;
    }
    const after=snapshots.length;engine.advance(1000+frame*1000/hz);
    assert.equal(snapshots.length,after,'a repeated RAF timestamp with no physics step does not allocate a duplicate state');
  }
  assert.equal(updates,120,'the simulation stays at exactly 60 Hz across display rates, without float-induced skipped ticks');
  if(!renderEveryStep)assert.equal(snapshots.length,40,'training/default publication stays at 20 Hz');
  else assert.equal(snapshots.length,Math.min(hz,60)*2,'visible CPU matches publish every new physics pose at each display rate');
  publicationRates.push({hz,renderEveryStep,snapshots:snapshots.length,ticks:updates});
}
console.log(`Local contact presentation OK: legacy visible gap ${reproduction.legacyGap.toFixed(3)} -> ${reproduction.currentGap.toFixed(3)} arena units; CPU poses stay on the same tick, ${publicationFrames} published frames at 30/60/120 Hz, no duplicate snapshots; training remains 20 Hz.`);
console.log(JSON.stringify(publicationRates));
