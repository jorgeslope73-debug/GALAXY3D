import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMenuUfoFlight,menuFloaters,MENU_UFO_RADIUS,MENU_UFO_CLEARANCE} from '../docs/menu-ufo.js';
function random(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
let flights=0,minimum=Infinity;
for(const mobile of [false,true])for(let seed=1;seed<=8;seed++){
  const rng=random(seed),flight=createMenuUfoFlight({random:rng});
  let previous=null,first=null,ended=null,targets=new Set(),count=0;
  for(let time=0;time<=480000;time+=40){
    const objects=menuFloaters(time,mobile),pose=flight.update(time,objects);
    if(pose){
      if(!previous){if(first===null){first=time;assert.ok(first>=12000&&first<=22040,'first visit waits for menu dwell');}else assert.ok(time-ended>=60000,'long pauses separate visits');count++;targets=new Set();}
      assert.ok(Number.isFinite(pose.x)&&Number.isFinite(pose.y)&&Number.isFinite(pose.angle));
      assert.ok(Math.abs(pose.bank)<.2&&pose.pitch>-1.4&&pose.pitch< -1,'the disc keeps a gentle lateral profile');
      if(previous)assert.ok(Math.hypot(pose.x-previous.x,pose.y-previous.y)<8.6,'motion is continuous at 25 FPS');
      for(const object of objects){const c=object.safety,clearance=Math.hypot(pose.x-c.x,pose.y-c.y)-c.r-MENU_UFO_RADIUS;minimum=Math.min(minimum,clearance);assert.ok(clearance>=MENU_UFO_CLEARANCE-4,'the full UFO silhouette stays clear of every floating object');}
      if(pose.phase==='observing'){targets.add(pose.target);assert.ok(Math.hypot(pose.vx,pose.vy)===0,'observations are unhurried hovering stops');}
    }else if(previous){assert.equal(targets.size,2,'each visitor observes two different objects');assert.ok(previous.x< -100||previous.x>2020,'the visitor leaves the screen before disappearing');ended=time;}
    previous=pose;
  }
  assert.ok(count>=3&&count<=6,'visits remain occasional during eight minutes');flights+=count;
}
const at=[];
for(const step of [20,50]){const flight=createMenuUfoFlight({random:()=>.5});let pose;for(let time=0;time<=32000;time+=step)pose=flight.update(time,menuFloaters(time));at.push(pose);}
assert.ok(at.every(Boolean));assert.ok(Math.hypot(at[0].x-at[1].x,at[0].y-at[1].y)<1e-7,'the same flight follows the same route at different frame rates');
const paused=createMenuUfoFlight({random:()=>.5});let active;for(let time=0;time<=20000;time+=40)active=paused.update(time,menuFloaters(time));assert.ok(active);
assert.equal(paused.update(500000,menuFloaters(500000)),null,'a hidden tab or match ends the interrupted visit');
for(let time=500040;time<512000;time+=40)assert.equal(paused.update(time,menuFloaters(time)),null,'returning to the menu does not catch up or spawn immediately');
const reduced=createMenuUfoFlight({reducedMotion:true});for(let time=0;time<300000;time+=40)assert.equal(reduced.update(time,menuFloaters(time)),null);
const sw=await readFile(new URL('../docs/sw.js',import.meta.url),'utf8');assert.ok(sw.includes('./menu-ufo.js'),'the flight controller is available offline');
console.log('Menu UFO OK: '+flights+' desktop/mobile visits; two observation stops; complete exits; 60+ second gaps; minimum envelope clearance '+minimum.toFixed(1)+'; smooth lateral motion, pause handling and reduced motion.');
