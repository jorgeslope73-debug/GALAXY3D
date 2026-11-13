'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/devourer-core.js','utf8'),context);const S=context.window.GalaxyDevourer;
const direction=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const crosses=(a,b,c,d)=>direction(a,b,c)*direction(a,b,d)<-1e-8&&direction(c,d,a)*direction(c,d,b)<-1e-8;
let samples=0,clearance=Infinity,waves=0;
for(const fps of [30,60,120])for(const style of ['still','circling','reversing']){
  const dt=1/fps,body=S.create('motion'),target={x:400,y:850,vx:0,vy:0};let id=0,lastCurve=0,lastTurn=0;
  for(let tick=0;tick<fps*180;tick++){
    const time=tick*dt;
    if(style==='circling'){target.x=960+820*Math.cos(time*.8);target.y=540+450*Math.sin(time*.8);target.vx=-656*Math.sin(time*.8);target.vy=360*Math.cos(time*.8);}
    if(style==='reversing'){target.x=tick%2?5:1915;target.y=tick%3?20:1060;target.vx=tick%2?-600:600;target.vy=tick%3?500:-500;}
    target.dead=time>=34&&time<40;target.spawnFx=time>=40&&time<43?1:0;
    // Cover shorter bodies, recovery windows, charge acceleration and respawn cancellation.
    if(tick===fps*75)S.damage(body,{slot:4},'bullet');
    if(tick===fps*100){S.damage(body,{slot:3},'bullet');S.damage(body,{slot:2},'bullet');}
    if(tick===fps*135){S.damage(body,{slot:1},'bullet');S.damage(body,{slot:0},'bullet');}
    const distance=body.pathDistance,angle=body.angle;
    S.step(body,dt,target,()=>++id);assert.ok(body.pathDistance>=distance-1e-8,'the body always advances along its own trail');
    assert.ok(Math.abs(Math.atan2(Math.sin(body.angle-angle),Math.cos(body.angle-angle)))<=2.2*dt+1e-8,'the head never snaps around to aim');
    const parts=[body,...body.segments.filter(p=>p.hp>0)];
    for(let i=0;i<parts.length;i++){
      const p=parts[i];assert.ok(p.x>=230&&p.x<=1690&&p.y>=190&&p.y<=890,'the whole boss stays inside the arena');
      assert.ok(Math.hypot(p.x-p.px,p.y-p.py)<850*dt,'changing attacks never teleports a segment');
      for(let j=i+1;j<parts.length;j++){
        // The connected neck is checked against the real GLB in the model test.
        // Other pairs keep the conservative extra 18px around the open jaws.
        const headRadius=i===0?S.HEAD_RADIUS+(j===1?0:18):S.SEGMENT_RADIUS;
        const margin=Math.hypot(p.x-parts[j].x,p.y-parts[j].y)-headRadius-S.SEGMENT_RADIUS;
        clearance=Math.min(clearance,margin);assert.ok(margin>6,'no segment overlaps another segment or the open head');
        if(i===0&&j===1){
          assert.ok(Math.hypot(p.x-parts[j].x,p.y-parts[j].y)<=120.001,'the neck does not reopen its old 156px gap');
          assert.ok(Math.abs(parts[j].joint.x-(p.x+(parts[j].x-p.x)*.65))<1e-8,'the neck joint stays attached at its calibrated position');
        }
      }
      for(let j=i+2;j<parts.length-1;j++)assert.equal(crosses(parts[i],parts[i+1],parts[j],parts[j+1]),false,'the centerline never crosses itself');
    }
    if(parts.length>=4){
      const turn=Math.atan2(Math.sin(parts[1].angle-parts[3].angle),Math.cos(parts[1].angle-parts[3].angle));
      if(lastTurn*turn<0&&time-lastCurve>1){waves++;lastCurve=time;}lastTurn=turn;
    }
    samples++;
  }
}
assert.ok(waves>=3,'the body visibly changes its curvature while following the wave');
console.log('Devourer motion OK: '+samples+' poses at 30/60/120 Hz, three target patterns, body shortening, respawns and repeated charges; no self-overlap or crossing, minimum open-jaw/hull clearance '+clearance.toFixed(2)+'px.');
