'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
const dataStart=source.indexOf('  const ENGINE_FX_MAX='),dataEnd=source.indexOf('  // V20.3 LocalFX:',dataStart);
const fnStart=source.indexOf('  function clearEngineTrailOwner('),fnEnd=source.indexOf('  function emitRockDebris(',fnStart);
assert.ok(dataStart>=0&&dataEnd>dataStart&&fnStart>=0&&fnEnd>fnStart);
function fixture(mobile){
  const fills=[],ctx={save(){},restore(){},beginPath(){},arc(){},fill(){fills.push({color:this.fillStyle,alpha:this.globalAlpha});},createRadialGradient(){throw Error('per-frame gradient');}};
  const c=vm.createContext({isMobile:mobile,SHIP_DRAW_SIZE:72,scene3D:{shipScale:1.5},ctx});
  vm.runInContext('let seed=12345;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};'+source.slice(dataStart,dataEnd)+source.slice(fnStart,fnEnd)+`
    globalThis.fx={emit:emitEngineParticle,draw:drawEngineParticles,hide:suppressEngineTrail,
      particles:engineParticles,palettes:ENGINE_FIRE_PALETTES,limit:ENGINE_FX_MAX,
      get cursor(){return engineFxCursor;}};`,c);
  return {fx:c.fx,fills};
}
const live=fx=>fx.particles.filter(p=>p.life>0).length;
function density(mobile,spd,thrust=true){
  const {fx}=fixture(mobile),p=Object.freeze({i:0,spd});let emitted=0;
  for(let frame=0;frame<120;frame++){
    const now=1000+frame*1000/60;fx.draw(now);const before=fx.cursor;
    fx.emit(p,960,540,0,now,0,-330*spd,thrust);
    emitted+=(fx.cursor-before+fx.limit)%fx.limit;
  }
  return emitted;
}
for(const mobile of [false,true]){
  const thrust=[1,1.5,2].map(s=>density(mobile,s)),turn=[1,1.5,2].map(s=>density(mobile,s,false));
  assert.ok(thrust[0]>0&&thrust[0]<thrust[1]&&thrust[1]<thrust[2],'each speed upgrade increases sustained full-speed thrust density');
  assert.ok(turn[0]>0&&turn[0]<turn[1]&&turn[1]<turn[2],'turn-only exhaust remains active and scales with upgrades');
  for(let i=0;i<3;i++)assert.ok(thrust[i]>turn[i],'thrust remains denser than a turn');
  assert.equal(density(mobile,100),thrust[2],'unexpected speed values cannot exceed the maximum density');
  {
    const {fx}=fixture(mobile),p=Object.freeze({i:0,spd:2});
    fx.emit(p,960,540,90,1000,-660,0,true);
    assert.ok(fx.particles.filter(p=>p.life>0).every(p=>p.life===p.maxLife),'starting after an idle gap creates no old trail');
    const start=fx.cursor;fx.emit(p,920,540,90,1060,-660,0,true);
    const born=fx.particles.slice(start,fx.cursor),xs=born.map(p=>p.x);
    assert.ok(Math.max(...xs)-Math.min(...xs)>20,'full-speed emissions fill the travelled interval');
    assert.ok(born.every(p=>p.life>0&&p.maxLife-p.life<=.08),'distributed births retain bounded ages');
  }
  for(const fps of [30,60,144]){
    const {fx}=fixture(mobile),refs=Array.from(fx.particles),players=[0,1,2,3].map(i=>Object.freeze({i,spd:2}));
    let peak=0,replacedLive=0;
    for(let frame=0;frame<fps*5;frame++){
      const now=1000+frame*1000/fps;fx.draw(now);
      for(const p of players){
        const before=fx.cursor,wasLive=fx.particles.map(v=>v.life>0);
        fx.emit(p,300+p.i*400,540,0,now,0,-660,true);
        const amount=(fx.cursor-before+fx.limit)%fx.limit;
        for(let i=0;i<amount;i++)if(wasLive[(before+i)%fx.limit])replacedLive++;
      }
      peak=Math.max(peak,live(fx));assert.ok(peak<=fx.limit);
    }
    assert.equal(replacedLive,0,'four fully upgraded ships do not overwrite living trails');
    assert.equal(fx.particles.length,refs.length);assert.ok(refs.every((p,i)=>p===fx.particles[i]),'the pool reuses its original particles');
    fx.draw(8000);assert.equal(live(fx),0,'a background/menu gap clears stale particles');
    console.log('OK: '+(mobile?'mobile':'desktop')+' '+fps+'Hz, peak '+peak+'/'+fx.limit+', no live recycling');
  }
  const {fx,fills}=fixture(mobile);fx.draw(1000);fx.emit({i:0,spd:2},960,540,0,1000,0,0,true);
  for(let t=1016;t<=1848;t+=16)fx.draw(t);
  assert.equal(live(fx),0,'particles finish their lifetime');assert.ok(fills.length>0);
  const rgb=color=>color.slice(1).match(/../g).map(x=>parseInt(x,16));
  for(const fill of fills){const [r,g,b]=rgb(fill.color);assert.ok(b>=g&&g>=r,'all lifecycle colors stay blue/cyan');assert.ok(fill.alpha>=0&&fill.alpha<=1);}
  assert.ok(fills.some(f=>rgb(f.color).every(n=>n>180)),'light blue is visible at birth');
  assert.ok(fills.some(f=>{const [r,g,b]=rgb(f.color);return b<65&&b>g&&g>r;}),'dark blue is visible before fading');
  fx.emit({i:0,spd:2},960,540,0,2000,0,0,true);fx.emit({i:1,spd:2},1200,540,0,2000,0,0,true);
  fx.hide(0,true);assert.equal(fx.particles.some(p=>p.life>0&&p.owner===0),false);assert.ok(fx.particles.some(p=>p.life>0&&p.owner===1));
  const before=fx.cursor;fx.emit({i:0,spd:2},960,540,0,2100,0,0,true);assert.equal(fx.cursor,before,'an invisible rival cannot leak a new trail');
  fx.hide(0,false);fx.emit({i:0,spd:2},960,540,0,2200,0,0,true);assert.ok(fx.particles.some(p=>p.life>0&&p.owner===0));
  console.log('OK: '+(mobile?'mobile':'desktop')+' density '+thrust.join('/')+'; turn '+turn.join('/')+'; blue lifecycle, invisibility and cleanup');
}
console.log('Engine particles OK: increasing upgrade density at sustained top speed; fixed reusable pools, blue-to-dark-blue lifetime, local-only inputs.');
