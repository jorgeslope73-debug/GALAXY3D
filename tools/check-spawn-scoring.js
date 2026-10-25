'use strict';
const assert=require('node:assert/strict');
global.window=global;
require('../docs/net-protocol.js');
require('../docs/collision-profiles.js');
require('../docs/physics-core.js');
require('../docs/host-physics.js');
require('../docs/local-cpu.js');
let seed=42;
Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(const Engine of [GalaxyHostPhysics,GalaxyLocalCpu]){
  const engine=Object.create(Engine.prototype);
  Object.assign(engine,{finished:false,activeShockwaves:[],players:[],asteroids:[],meteors:[],giant:null,fxClock:0});
  for(const method of ['noteCpuLoopDeath','emitShipImpact','dropDefeatedLoadout','emit','flushLearning','reportRankedVictory'])engine[method]=()=>{};
  const player=(index,kills)=>({index,kills,deaths:0,dead:false,protection:0,shield:0,cpu:false});
  let victim=player(0,3),attacker=player(1,1);
  engine.destroyShip(victim,attacker);
  assert.equal(victim.kills,2);assert.equal(attacker.kills,2);assert.equal(victim.deaths,1);
  engine.destroyShip(victim,attacker);
  assert.equal(victim.kills,2);assert.equal(attacker.kills,2);
  victim=player(0,0);engine.destroyShip(victim,attacker);assert.equal(victim.kills,0);
  victim=player(0,2);engine.destroyShip(victim);assert.equal(victim.kills,1);
  victim=player(0,2);engine.destroyShip(victim,victim);assert.equal(victim.kills,1);
  victim=player(0,2);victim.protection=3;engine.destroyShip(victim,attacker);
  assert.equal(victim.dead,false);assert.equal(victim.kills,2);
  const sectors=new Set(),choices=new Set();
  const cpu={index:0,cpu:true};
  for(let i=0;i<80;i++){
    engine.placeAtSpawn(cpu);
    sectors.add((cpu.x<960?'L':'R')+(cpu.y<540?'T':'B'));
    choices.add(cpu.openingFleeUntil>0);
    assert.ok(cpu.x>=0&&cpu.x<=1920&&cpu.y>=0&&cpu.y<=1080);
  }
  assert.equal(sectors.size,4);assert.equal(choices.size,2);
  Object.assign(cpu,{x:500,y:500,rot:90,dead:false,openingFleeUntil:0});
  const immune={index:1,x:600,y:500,protection:3,spawnFx:0,dead:false};
  engine.players=[cpu,immune];
  let c=engine.chooseCpuControls(cpu);
  assert.equal(c.fire,false);assert.equal(c.thrust,true);assert.equal(c.turn,0);
  immune.protection=0;immune.spawnFx=1;
  assert.equal(engine.chooseCpuControls(cpu).fire,false);
  // A traves del borde tambien se considera cercano.
  cpu.x=10;cpu.rot=270;immune.x=1910;
  c=engine.chooseCpuControls(cpu);assert.equal(c.turn,0);assert.equal(c.thrust,true);
  immune.spawnFx=0;
  assert.equal(GalaxyPhysicsCore.cpuSpawnEscapeControl(cpu,engine.players,10,1920,1080),null);
  victim=player(0,2);attacker=player(1,4);engine.destroyShip(victim,attacker);
  assert.equal(attacker.kills,5);assert.equal(engine.finished,true);
}
// Exercise real starts/restarts/respawns, including the worst RNG that used
// to put every player in the same corner. The same rule covers late joins.
const vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const sector=p=>(p.x<960?0:1)+(p.y<540?0:2);
function distinctSpawns(players,label){
  assert.equal(new Set(players.map(sector)).size,players.length,label+': zona repetida');
  for(let i=0;i<players.length;i++){
    const p=players[i];
    assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y),label+': posicion no finita');
    assert.equal(p.spawnAnchorX,p.x);assert.equal(p.spawnAnchorY,p.y);
    for(let j=i+1;j<players.length;j++){
      assert.ok(Math.hypot(p.x-players[j].x,p.y-players[j].y)>240,label+': naves demasiado proximas');
    }
  }
}
let spawnBatches=0;
for(const random of ['()=>0','()=>.999999','(()=>{let seed=42;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};})()']){
  const ctx=engineContext();vm.runInContext('Math.random='+random,ctx);
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu'])for(const count of [2,3,4]){
    const engine=new ctx.window[name]({});
    if(name==='GalaxyHostPhysics')engine.start(Array.from({length:count},(_,i)=>({i,n:'J'+i})));
    else engine.start('J0','facil',count-1,null,false,1);
    distinctSpawns(engine.players,name+' inicio '+count);spawnBatches++;
    for(let round=0;round<25;round++){
      // All ships die in one tick and then materialize in different orders.
      for(const p of engine.players)p.dead=true;
      const order=round%2?engine.players.slice().reverse():engine.players;
      for(const p of order)engine.respawnPlayer(p);
      distinctSpawns(engine.players,name+' reaparicion '+round);spawnBatches++;
      engine.restart();
      distinctSpawns(engine.players,name+' reinicio '+round);spawnBatches++;
    }
    // Starting from an old overlapping snapshot must also recover unique zones.
    for(const p of engine.players){p.x=74;p.y=350;p.px=p.x;p.py=p.y;}
    for(const p of engine.players){
      engine.respawnPlayer(p);
      assert.ok(engine.players.every(other=>other===p||other.dead||sector(other)!==sector(p)),name+': reaparece en zona ocupada');
    }
    distinctSpawns(engine.players,name+' recuperacion');spawnBatches++;
  }
  const engine=new ctx.window.GalaxyHostPhysics({});
  // Sparse player slots and a join during a running match use actual index values.
  engine.start([{i:3,n:'J3'},{i:1,n:'J1'}]);
  const joined=engine.makePlayer(2,'J2',false);
  engine.placeAtSpawn(joined);engine.players.push(joined);
  distinctSpawns(engine.players,'incorporacion a partida');spawnBatches++;
}
console.log('Bajas y apariciones OK en CPU local y host online; '+spawnBatches+' tandas con zonas distintas, RNG extremo, reapariciones y reinicios.');
