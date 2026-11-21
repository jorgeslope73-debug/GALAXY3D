'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
const a=game.indexOf('  function drawCollectibleOverlays('),b=game.indexOf('  function drawDeployedFlare(',a);
assert.ok(a>=0&&b>a);
// Exercise the real frame's compositing boundary with an opaque floor. A
// sprite painted before the WebGL flush would be replaced by this world pass.
const frameStart=game.indexOf('    window.Galaxy3D.flush(ctx);'),frameEnd=game.indexOf('    if(shockwaveFx.length)',frameStart);
assert.ok(frameStart>0&&frameEnd>frameStart);
const pickupPass=game.slice(game.indexOf('    for(const pk of renderState.pickups){'),game.indexOf('    for(const m of renderState.meteors){'));
assert.ok(!pickupPass.includes('drawPickup(')&&!pickupPass.includes('drawDeployedFlare('),'sprites have one final paint pass');
for(const blend of [0,.25,1]){
 const pixels=new Map(),events=[],view={pickups:[{id:1,type:'flare',x:100,y:120},{id:2,type:'ammo3',x:210,y:220}],flares:[{id:3,x:300,y:340,life:2.7,a:15}]};
 const oldPickups=new Map([[1,{x:60,y:80}]]),oldFlares=new Map([[3,{x:260,y:300}]]);
 const mark=(kind,item,x,y,time)=>{pixels.set(kind+item.id,kind);events.push({kind,id:item.id,x,y,time});};
 const scope={ctx:{},renderState:view,blend,nowSec:7,previousLookup:{pickups:oldPickups,flares:oldFlares},lerp:(a,b,t)=>a+(b-a)*t,
  drawPickup:(...args)=>mark('icon',...args),drawDeployedFlare:(...args)=>mark('flare',...args),
  window:{Galaxy3D:{flush(){pixels.clear();events.push({kind:'opaque-world'});}}}};
 vm.runInNewContext(game.slice(a,b)+'\n'+game.slice(frameStart,frameEnd),scope);
 assert.equal(events[0].kind,'opaque-world');assert.equal(pixels.size,3,'icons and launched flares remain above the station floor');
 assert.deepEqual(events.slice(1),[
  {kind:'icon',id:1,x:60+40*blend,y:80+40*blend,time:7},
  {kind:'icon',id:2,x:210,y:220,time:7},
  {kind:'flare',id:3,x:260+40*blend,y:300+40*blend,time:7}
 ],'the existing snapshot interpolation and animation clock are preserved');
 scope.renderState={pickups:[]};events.length=0;vm.runInNewContext(game.slice(frameStart,frameEnd),scope);assert.equal(events.length,1,'empty or absent flare lists are safe');
}
console.log('World overlays OK: real frame paints pickup icons and deployed flares after opaque WebGL, once each, with unchanged snapshot interpolation and safe empty lists.');
