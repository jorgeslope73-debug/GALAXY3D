'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const DT=1/60,sector=p=>(p.x<960?0:1)+(p.y<540?0:2);
let batches=0;
for(const random of ['()=>0','()=>.999999','(()=>{let seed=12345;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};})()']){
  const c=engineContext();vm.runInContext('Math.random='+random,c);
  vm.runInContext(fs.readFileSync('docs/net-state-codec.js','utf8'),c);
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu'])for(const count of [2,3,4]){
    const engine=new c.window[name]({});
    if(name==='GalaxyHostPhysics')engine.start(Array.from({length:count},(_,i)=>({i,n:'J'+i})));
    else engine.start('J0','facil',count-1,null,false,1);
    for(const fn of ['updateAsteroids','updateFlares','updateBullets','updatePickups','updateShower','updateMeteors','updateGiant','updateUfo','shipCollisions','updateShockwaves'])engine[fn]=()=>{};
    for(const p of engine.players){p.cpu=false;p.protection=0;p.spawnFx=0;p.shield=0;}
    const deaths=engine.players.map(p=>({x:p.x,y:p.y,epoch:p.motionStream?.epoch}));
    for(const p of engine.players){
      engine.destroyShip(p);
      assert.equal(p.dead,true);assert.equal(p.respawn,3);assert.ok(p.pendingSpawn);
      assert.equal(p.x,deaths[p.index].x);assert.equal(p.y,deaths[p.index].y,'death stays at the original place');
      if(p.motionStream)assert.equal(p.motionStream.epoch,deaths[p.index].epoch,'planning does not reset the command stream early');
    }
    const plans=engine.players.map(p=>Object.freeze({...p.pendingSpawn}));
    assert.equal(new Set(plans.map(sector)).size,count,'simultaneous deaths reserve different sectors');
    const state=engine.publicState(),codec=c.window.GalaxyStateCodec;
    const packet=codec.encode(state,0),restored=codec.decode(JSON.parse(JSON.stringify(packet)));assert.ok(restored);
    for(const p of restored.players){assert.equal(p.spawnX,+plans[p.i].x.toFixed(1));assert.equal(p.spawnY,+plans[p.i].y.toFixed(1));assert.equal(p.respawn,3);}
    for(const p of engine.players){const fx=state.fx.find(f=>f.i===p.index&&f.kind==='explosion');assert.ok(fx);assert.equal(fx.x,+deaths[p.index].x.toFixed(1));assert.equal(fx.y,+deaths[p.index].y.toFixed(1));}
    for(let tick=0;tick<179;tick++)engine.update(DT);
    for(const p of engine.players){assert.equal(p.dead,true,'the ship remains absent before three seconds');assert.ok(p.respawn>0);assert.deepEqual(JSON.parse(JSON.stringify(p.pendingSpawn)),plans[p.index]);}
    engine.update(DT);
    for(const p of engine.players){
      assert.equal(p.dead,false,'the 180th tick completes the three-second delay');assert.equal(p.respawn,0);assert.equal(p.pendingSpawn,null);
      assert.equal(p.x,plans[p.index].x);assert.equal(p.y,plans[p.index].y);assert.equal(p.rot,plans[p.index].rot);
      assert.equal(p.spawnAnchorX,p.x);assert.equal(p.spawnAnchorY,p.y);assert.equal(p.protection,3);assert.equal(p.spawnFx,1.15);
      if(p.motionStream)assert.notEqual(p.motionStream.epoch,deaths[p.index].epoch);
    }
    assert.ok(engine.publicState().players.every(p=>!('spawnX'in p)&&!('spawnY'in p)),'reservation fields disappear after spawning');
    for(const p of engine.players){p.protection=0;p.spawnFx=0;engine.destroyShip(p);}
    engine.finished=true;assert.equal(engine.restart(),true);assert.ok(engine.players.every(p=>!p.dead&&!p.pendingSpawn),'restart discards old reservations');
    batches++;
  }
}
const source=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
const start=source.indexOf('  function drawLocalRespawnCountdown('),end=source.indexOf('\n  function lerp(',start);assert.ok(start>=0&&end>start);
function view(index=0){
  const draws=[],moves=[],scales=[],glyphs=[],ctx={save(){},restore(){},translate(x,y){moves.push([x,y]);},scale(x){scales.push(x);},beginPath(){},arc(){},stroke(){},measureText(){return {width:80,actualBoundingBoxLeft:40,actualBoundingBoxRight:40,actualBoundingBoxAscent:60,actualBoundingBoxDescent:60};},strokeText(){},fillText(t,x,y){draws.push(t);glyphs.push([x,y]);}};
  const c=vm.createContext({W:1920,H:1080,myIndex:index,inGame:true,state:{code:'TEST',round:1,hostEpoch:1,simTime:1,players:[{i:0,d:1,dead:true,respawn:3,spawnX:600,spawnY:700},{i:1,d:0,dead:false}]},localRespawnVisual:null,lastStateTime:1000,localCampaignLevel:0,playerRgb:[[0,180,255],[255,0,180]],isMobile:false,ctx,clamp:(v,a,b)=>Math.max(a,Math.min(b,v))});
  const markerStart=source.indexOf('  function drawSpawnCountdownMarker('),markerEnd=source.indexOf('  function drawLocalRespawnCountdown(',markerStart);vm.runInContext(source.slice(markerStart,markerEnd)+source.slice(start,end).split('  function drawLocalEntryCountdown(')[0],c);return {c,draws,moves,scales,glyphs,ctx};
}
const own=view();
for(const t of [1000,2000,3000,4000])own.c.drawLocalRespawnCountdown(t);
assert.deepEqual(own.draws,['3','2','1','0'],'one snapshot drives the whole local countdown without per-number messages');
assert.ok(own.moves.every(([x,y])=>x===600&&y===700),'numbers stay centred on the reserved point');
const animated=view();animated.c.drawLocalRespawnCountdown(1000);animated.c.drawLocalRespawnCountdown(1250);assert.ok(animated.scales[0]>animated.scales[1],'each digit animates locally');
animated.c.state={...animated.c.state,players:[{...animated.c.state.players[0],respawn:2.9}]};animated.c.lastStateTime=2000;animated.c.drawLocalRespawnCountdown(2000);assert.equal(animated.draws.at(-1),'2','a delayed repeated countdown cannot move backwards');
const edge=view();edge.c.state.players[0].spawnX=57.5;edge.c.drawLocalRespawnCountdown(1000);assert.equal(edge.scales[0],own.scales[0],'an edge spawn keeps the same digit size as a central spawn');assert.deepEqual(edge.moves[0],[57.5,700],'fitting never moves the authoritative point');
// Size is independent of side/edge distance; only the glyph can move inward.
for(const mobile of [false,true])for(const age of [0,.25,.99]){
 const centre=view(),reference=[];centre.c.isMobile=mobile;centre.c.drawSpawnCountdownMarker(960,540,0,3,age,1,1000);
 for(const x of [1,57.5,144,960,1776,1862.5,1919])for(const y of [1,54,540,1026,1079]){
  const sample=view();sample.c.isMobile=mobile;sample.c.drawSpawnCountdownMarker(x,y,0,3,age,1,1000);
  assert.deepEqual(sample.scales,centre.scales,'left/right/top/bottom share the exact same pop');
  assert.equal(sample.ctx.font,centre.ctx.font,'all spawn positions use the same font size');
  assert.deepEqual(sample.moves,[[x,y]],'the marker stays at the reserved spawn');
  const pop=sample.scales[0],[dx,dy]=sample.glyphs[0],px=x+dx*pop,py=y+dy*pop;
  assert.ok(px-40*pop>=0&&px+40*pop<=1920&&py-60*pop>=0&&py+60*pop<=1080,'full-size digits remain inside the viewport');
 }
}
const other=view(1);other.c.drawLocalRespawnCountdown(1000);assert.equal(other.draws.length,0,'another player does not see the private marker or numbers');
own.c.state={...own.c.state,players:[{i:0,d:1,dead:false,x:600,y:700}]};own.c.lastStateTime=4000;
own.c.drawLocalRespawnCountdown(4000);assert.equal(own.draws.at(-1),'0');const before=own.draws.length;own.c.drawLocalRespawnCountdown(4280);assert.equal(own.draws.length,before);assert.equal(own.c.localRespawnVisual,null);
for(const mode of ['finished','missing','menu']){const f=view();if(mode==='finished')f.c.state.finished=true;else if(mode==='menu')f.c.inGame=false;else delete f.c.state.players[0].spawnX;f.c.drawLocalRespawnCountdown(1000);assert.equal(f.draws.length,0);}
assert.ok(source.includes('drawLocalRespawnCountdown(now);'),'the normal render draws the countdown');
console.log('Respawn countdown OK: '+batches+' real host/CPU batches, extreme RNG, reserved distinct points, exact three seconds, codec, original death FX, resets, private animated 3-2-1-0 and local-only interpolation.');
