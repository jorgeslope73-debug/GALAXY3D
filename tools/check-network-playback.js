'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/network-playback.js','utf8'),ctx);const Playback=ctx.window.GalaxyNetworkPlayback;
const packet=(seq,time,extra={})=>({code:'TEST',seriesId:'a'.repeat(32),hostEpoch:1,round:1,seq,simTime:time,players:[{i:0,x:500+330*time,y:500,r:time*40,b:time*.2,dead:false}],asteroids:[{id:1,x:300+190*time,y:400,s:time*.18,r:51.75}],...extra});
let maxJump=0;
for(const fps of [30,60,120]){
  const p=new Playback(),arrivals=[];let next=0,last=null;
  for(let n=0;n<120;n++)arrivals.push({at:n*50+[0,0,-30,0,-20,0][n%6]+1000,state:packet(n+1,n*.05)});
  arrivals.sort((a,b)=>a.at-b.at);
  for(let now=1000;now<=7200;now+=1000/fps){
    const before=p.sample(now);
    while(next<arrivals.length&&arrivals[next].at<=now){p.push(arrivals[next].state,arrivals[next].at);next++;}
    const sample=p.sample(now);if(!sample)continue;
    if(before){const jump=Math.abs(before.state.players[0].x-sample.state.players[0].x);assert.ok(jump<1e-8,'receiving an early packet cannot reset the visible pose');maxJump=Math.max(maxJump,jump);}
    if(last)assert.ok(sample.simTime>=last.simTime,'render clock is monotonic');
    assert.ok(sample.simTime<=p.snapshots.at(-1).time/1000+1e-9,'never extrapolate past authority');
    assert.ok(p.snapshots.length<=12,'bounded buffer');last=sample;
  }
  const held=p.sample(20000);assert.equal(held.state.players[0].x,last.state.players[0].x,'long loss freezes at the last authoritative pose');
}
const p=new Playback();assert(p.push(packet(1,1),1000));assert(!p.push(packet(1,1),1001));assert(!p.push(packet(2,.9),1002));assert(!p.push(packet(2,NaN),1002));
p.push(packet(2,1.05,{players:[{i:0,x:1820,y:500,r:359,b:0,dead:true},{i:1,x:50,y:50,r:0}]}),1050);
const early=p.sample(1080);assert.equal(early.state.players.length,1,'new topology is delayed to its simulation tick');assert.equal(early.state.players[0].dead,false,'death is not shown ahead of its visual tick');
p.sample(1300);const final=p.sample(1400);assert.equal(final.state.players.length,2);assert.equal(final.state.players[0].dead,true);
const w=new Playback({delayMs:40});w.push(packet(1,0,{players:[{i:0,x:1918,y:1078,r:359,b:-.5}],asteroids:[{id:1,x:100,y:500,s:Math.PI*2-.01}]}),1000);w.push(packet(2,.1,{players:[{i:0,x:2,y:2,r:1,b:.5}],asteroids:[{id:1,x:110,y:500,s:.01}]}),1100);
const mid=w.sample(1100);assert.ok(mid.state.players[0].x>1918||mid.state.players[0].x<2,'screen wrap takes the short path');assert.ok(mid.state.players[0].r>=359&&mid.state.players[0].r<=361,'heading wraps along the short arc');assert.ok(mid.state.asteroids[0].s>6,'spin wraps along the short arc');
const original=packet(1,5);const saved=JSON.stringify(original);const a=new Playback();a.push(original,1000);a.push(packet(2,5.05),1050);a.sample(1070);assert.equal(JSON.stringify(original),saved,'authority objects are immutable to the playback');
assert(a.push(packet(1,0,{hostEpoch:2}),1100),'host migration resets sequence and simulation clock');assert.equal(a.sample(1100).state.hostEpoch,2);assert.equal(a.snapshots.length,1);a.reset();assert.equal(a.sample(1200),null);
const bounded=new Playback();bounded.push(packet(1,0),1000);bounded.sample(1050);bounded.push(packet(2,.8),1800);const resumed=bounded.sample(1800);assert.ok(resumed.buffered<=180,'a loss burst cannot accumulate seconds of playback delay');assert.equal(resumed.resynced,true,'large loss recovery is explicitly marked');
assert(bounded.push(packet(1,0,{hostEpoch:2,round:2}),1900));assert(!bounded.push(packet(99,.85),1950),'old hosts cannot reset the playback after migration');assert(!bounded.push(packet(99,.85,{hostEpoch:2,round:1}),1950),'old rounds cannot reset playback');
console.log('Network playback OK: monotonic simulation clock, zero arrival jumps under 20/50/80 ms jitter at 30/60/120 Hz, bounded memory, loss freeze, topology/death timing, wrap, migration and immutable authority. Max arrival jump '+maxJump.toFixed(9));
