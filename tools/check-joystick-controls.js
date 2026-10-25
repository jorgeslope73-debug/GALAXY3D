'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const game=fs.readFileSync('docs/game.js','utf8');
function source(name){
  const start=game.indexOf('  function '+name+'('),end=game.indexOf('\n  }',start);
  assert.ok(start>=0&&end>start,'find production '+name);
  return game.slice(start,end+4);
}
const mapping=game.match(/  const DEFAULT_JOYSTICK_MAP=Object\.freeze\(\{[\s\S]*?\n  \}\);/);
assert.ok(mapping,'load the actual default controller mapping');
let pad={axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
const input=vm.createContext({isMobile:false,findJoystick:()=>pad});
vm.runInContext(mapping[0]+'\nlet joystickMap={...DEFAULT_JOYSTICK_MAP};\n'+source('joystickButtonPressed')+'\n'+source('joystickControls'),input);
const defaults=vm.runInContext('({...DEFAULT_JOYSTICK_MAP})',input);
const read=()=>vm.runInContext('joystickControls()',input);
for(const action of ['thrust','fire','rocket','flare','shock','ptt']){
  const index=defaults[action];
  pad.buttons[index]={pressed:true,value:1};
  const control=read();
  for(const key of ['thrust','fire','rocket','flare','shock','ptt'])assert.equal(control[key],key===action);
  pad.buttons[index]={pressed:false,value:0};
}
pad.buttons[defaults.thrust].value=.36;assert.equal(read().thrust,true);
pad.buttons[defaults.thrust].value=.35;assert.equal(read().thrust,false);pad.buttons[defaults.thrust].value=0;
pad.axes[0]=-1;assert.equal(read().turn,1);
pad.axes[0]=1;assert.equal(read().turn,-1);
pad.axes[0]=.1;assert.equal(read().turn,0);
pad.axes[0]=0;pad.buttons[defaults.turnLeft].pressed=true;assert.equal(read().turn,1);pad.buttons[defaults.turnLeft].pressed=false;
pad.buttons[defaults.turnRight].pressed=true;assert.equal(read().turn,-1);pad.buttons[defaults.turnRight].pressed=false;
vm.runInContext('joystickMap={...joystickMap,turnAxis:-1,turnLeft:9,turnRight:8,thrust:1}',input);
pad.axes[0]=1;pad.buttons[9].pressed=true;pad.buttons[1].pressed=true;
assert.equal(read().turn,1,'a configured D-pad overrides the unused axis');assert.equal(read().thrust,true,'configured action buttons are used');
pad.buttons[9].pressed=false;pad.buttons[1].pressed=false;pad.buttons[8].pressed=true;
assert.equal(read().turn,-1);pad.buttons[8].pressed=false;
pad=null;assert.equal(read().active,false);

const engines=engineContext();
for(const [name,host] of [['GalaxyLocalCpu',false],['GalaxyHostPhysics',true]]){
  // Load the same protocol, profiles and shared physics as actual game engines.
  const engine=new engines.window[name]({});
  const p=Object.assign(engine.makePlayer(0,'Pilot',false),{index:0,cpu:false,dead:false,flare:3,shockwave:true,spawnFx:0});
  engine.players=[p];engine.controls=new Map();
  let flareCount=0,shockCount=0;
  engine.deployFlares=player=>{if(!player.flare)return false;player.flare--;flareCount++;return true;};
  engine.deployShockwave=player=>{if(!player.shockwave)return false;player.shockwave=false;shockCount++;return true;};
  const set=(fire,actions={})=>host?engine.setControl(0,0,false,fire,actions):engine.setControl(0,false,fire,actions);
  const tick=()=>engine.resolveFireWithFlare(p,engine.controls.get(0),1/60);
  set(true,{directFire:true});
  for(let i=0;i<60;i++)assert.equal(tick(),true);
  assert.equal(flareCount,0);assert.equal(shockCount,0);
  set(false,{flare:true});
  for(let i=0;i<60;i++)tick();
  assert.equal(flareCount,1);assert.equal(shockCount,0);assert.equal(p.shockwave,true);
  set(false);tick();set(false,{flare:true});tick();assert.equal(flareCount,2);
  set(false,{shock:true});tick();assert.equal(shockCount,1);assert.equal(p.flare,1);
  for(let i=0;i<60;i++)tick();assert.equal(shockCount,1);
  set(false);tick();p.shockwave=true;
  set(true);assert.equal(tick(),false);
  for(let i=0;i<20;i++)tick();
  assert.equal(shockCount,2);assert.equal(p.flare,1);
  set(false);tick();
  set(true,{directFire:true,flare:true});assert.equal(tick(),true);assert.equal(flareCount,3);
}
const context=vm.createContext({window:{},console});
vm.runInContext(fs.readFileSync('docs/net-protocol.js','utf8'),context);
vm.runInContext(fs.readFileSync('docs/p2p-network.js','utf8'),context);
let received;
const net=new context.window.GalaxyP2P({onControl:(i,m)=>{received=m;}});
Object.assign(net,{isHost:true,myIndex:0,hostIndex:0,seriesId:'a'.repeat(32),hostEpoch:1,rankRound:1,inputSessionId:'b'.repeat(32)});
assert.equal(net.sendControl(0,true,true,{directFire:true,flare:true,shock:true},1),true);
assert.equal(received.flare,true);assert.equal(received.shock,true);assert.equal(received.directFire,true);
net.isHost=false;net.myIndex=1;net.peers=new Map([[0,{open:true,fastDc:{readyState:'open',bufferedAmount:0,send:raw=>{received=JSON.parse(raw);}}}]]);
assert.equal(net.sendControl(0,true,true,{directFire:true,flare:true,shock:true},2),true);
assert.equal(received.flare,true);assert.equal(received.shock,true);assert.equal(received.directFire,true);
assert.equal(received.controlSeq,2);assert.equal(received.inputSessionId,net.inputSessionId);
assert.equal(net.sendControl(0,false,false,{},0),false,'the harness respects the current protocol control sequence contract');
console.log('Joystick OK: mapa actual y personalizado, stick/cruceta, disparo continuo, habilidades independientes y transporte P2P validado.');
