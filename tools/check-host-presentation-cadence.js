'use strict';
const assert=require('node:assert/strict');
const {engineContext}=require('./check-session-regressions.js');
const ctx=engineContext(),results=[];
for(const fps of [30,60,120])for(const renderEveryStep of [false,true]){
  const sent=[],drawn=[];let ticks=0,serializations=0;
  const host=new ctx.window.GalaxyHostPhysics({renderEveryStep,onState:s=>sent.push(s),onRenderState:s=>drawn.push(s)});
  Object.assign(host,{started:true,finished:false,lastNow:1000,accumulator:0,tickCount:0});
  host.update=()=>{ticks++;};host.publicState=()=>({seq:++serializations,ticks});
  for(let f=1;f<=fps*2;f++){
    const beforeTicks=ticks,beforeSent=sent.length,beforeDrawn=drawn.length;
    host.advance(1000+f*1000/fps);
    assert.ok(sent.length-beforeSent<=1&&drawn.length-beforeDrawn<=1,'catch-up publishes only the final tick');
    assert.equal(drawn.length-beforeDrawn,renderEveryStep&&ticks>beforeTicks?1:0);
    if(sent.length>beforeSent&&drawn.length>beforeDrawn)assert.equal(sent.at(-1),drawn.at(-1),'same object serves network and host view');
    const count=serializations;host.advance(1000+f*1000/fps);assert.equal(serializations,count,'duplicate frame does not allocate a snapshot');
  }
  assert.equal(ticks,120,'fixed step must not alternate zero and double ticks at 60 Hz');
  assert.equal(sent.length,40,'network remains at 20 Hz');
  assert.equal(drawn.length,renderEveryStep?Math.min(fps,60)*2:0,'host view can follow every new simulated frame');
  assert.equal(serializations,renderEveryStep?drawn.length:sent.length,'no duplicate serialization');
  results.push({fps,renderEveryStep,ticks,network:sent.length,drawn:drawn.length});
}
const sent=[],drawn=[],host=new ctx.window.GalaxyHostPhysics({renderEveryStep:true,onState:s=>sent.push(s),onRenderState:s=>drawn.push(s)});
Object.assign(host,{started:true,finished:false,lastNow:1000,accumulator:0,tickCount:0});host.publicState=()=>({tick:host.tickCount});host.update=()=>{host.humanShotPending=true;};host.advance(1017);
assert.equal(sent.length,1,'a human shot still publishes immediately');assert.equal(sent[0],drawn[0]);
console.log('Host presentation cadence OK: exact 60 Hz simulation, separate local frames and 20 Hz network snapshots, one shared allocation, catch-up and immediate shots.');console.log(JSON.stringify(results));
