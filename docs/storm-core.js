'use strict';
// Campaign-only authority. Rendering consumes snapshots and never advances combat.
(() => {
  const TAU=Math.PI*2,CORE_RADIUS=122,SHIELD_RADIUS=170,SATELLITE_RADIUS=42,ORBIT=280;
  const DAMAGE=Object.freeze({bullet:1,missile:3,flare:2});
  const alive=body=>body.satellites.filter(part=>part.hp>0);
  const vulnerable=body=>body.hp>0&&body.phase==='core'&&body.attack==='cooldown';
  function pose(body,dt=0){
    body.px=body.x;body.py=body.y;
    body.x=960+130*Math.sin(body.age*.31);body.y=525+65*Math.sin(body.age*.47);
    body.vx=dt?(body.x-body.px)/dt:0;body.vy=dt?(body.y-body.py)/dt:0;
    for(const part of body.satellites){
      part.px=part.x;part.py=part.y;
      const angle=body.orbit+part.slot*TAU/3;
      part.x=body.x+Math.cos(angle)*ORBIT;part.y=body.y+Math.sin(angle)*ORBIT;
      part.vx=dt?(part.x-part.px)/dt:0;part.vy=dt?(part.y-part.py)/dt:0;
    }
  }
  function create(id,config={}){
    const maxHp=config.coreHp||6,satelliteHp=config.satelliteHp||2;
    const body={id,x:960,y:525,px:960,py:525,vx:0,vy:0,age:0,orbit:0,hp:maxHp,maxHp,
      phase:'satellites',attack:'cooldown',nextAt:1.2,cursor:0,warning:null,
      satellites:Array.from({length:3},(_,slot)=>({slot,hp:satelliteHp,maxHp:satelliteHp,x:0,y:0,px:0,py:0,vx:0,vy:0}))};
    pose(body);body.px=body.x;body.py=body.y;
    for(const part of body.satellites){part.px=part.x;part.py=part.y;}
    return body;
  }
  function step(body,dt,target,uid){
    if(!(body.hp>0)||!(dt>0))return [];
    body.age+=dt;
    body.orbit+=dt*(.33+(3-alive(body).length)*.1);pose(body,dt);
    const shots=[];
    // A respawning pilot cannot be targeted. Restart the tell instead of firing unseen.
    if(!target||target.dead||target.spawnFx>0){body.warning=null;body.attack='cooldown';body.nextAt=body.age+1.2;return shots;}
    if(body.warning){
      const warning=body.warning;
      warning.remaining=Math.max(0,warning.at-body.age);
      if(body.age+1e-8<warning.at)return shots;
      const source=warning.slot<0?body:body.satellites[warning.slot];
      if(source.hp>0){
        const offsets=warning.slot<0?(body.hp<=2?[-.84,-.56,-.28,0,.28,.56,.84]:[-.66,-.33,0,.33,.66]):[0];
        const radius=warning.slot<0?SHIELD_RADIUS:SATELLITE_RADIUS;
        for(const offset of offsets){
          const angle=warning.angle+offset,dx=Math.cos(angle),dy=Math.sin(angle),x=source.x+dx*(radius+8),y=source.y+dy*(radius+8);
          shots.push({id:uid(),owner:-3,storm:true,x,y,px:x,py:y,vx:dx*330,vy:dy*330,age:0,travel:0,guided:false});
        }
      }
      body.warning=null;body.attack='cooldown';
      body.nextAt=body.age+(body.phase==='core'?(body.hp<=2?2.8:3.8):1.5+alive(body).length*.3);
      return shots;
    }
    if(body.age+1e-8<body.nextAt)return shots;
    const parts=alive(body),part=parts.length?parts[body.cursor++%parts.length]:body;
    const duration=parts.length?.85:1.25;
    body.warning={slot:parts.length?part.slot:-1,angle:Math.atan2(target.y-part.y,target.x-part.x),remaining:duration,duration,at:body.age+duration};
    body.attack='charging';return shots;
  }
  // Swept relative circles prevent fast missiles and moving satellites tunnelling.
  function circleHit(segment,part,radius){
    const ax=segment.px-part.px,ay=segment.py-part.py;
    const dx=segment.x-segment.px-(part.x-part.px),dy=segment.y-segment.py-(part.y-part.py);
    const c=ax*ax+ay*ay-radius*radius,a=dx*dx+dy*dy;
    if(c<=0)return 0;
    if(a<1e-12)return null;
    const b=2*(ax*dx+ay*dy),disc=b*b-4*a*c;
    if(disc<0)return null;
    const t=(-b-Math.sqrt(disc))/(2*a);
    return t>=0&&t<=1?t:null;
  }
  function firstHit(body,segment,radius=0,{hullOnly=false}={}){
    let best=null;
    for(const part of [...alive(body),body]){
      const core=part===body,r=(core?(hullOnly||vulnerable(body)?CORE_RADIUS:SHIELD_RADIUS):SATELLITE_RADIUS)+radius;
      const t=circleHit(segment,part,r);
      if(t!==null&&(!best||t<best.t))best={slot:core?-1:part.slot,t,x:segment.px+(segment.x-segment.px)*t,y:segment.py+(segment.y-segment.py)*t};
    }
    return best;
  }
  function damage(body,slot,weapon){
    const amount=DAMAGE[weapon];if(!amount||!(body.hp>0))return null;
    if(slot<0){
      if(!vulnerable(body))return {shielded:true,destroyed:false,won:false};
      body.hp=Math.max(0,body.hp-amount);
      return {shielded:false,destroyed:body.hp===0,won:body.hp===0};
    }
    const part=body.satellites[slot];if(!part||!(part.hp>0))return null;
    part.hp=Math.max(0,part.hp-amount);
    if(body.warning?.slot===slot&&part.hp===0){body.warning=null;body.attack='cooldown';body.nextAt=body.age+1.2;}
    if(alive(body).length===0){body.phase='core';body.attack='cooldown';body.warning=null;body.nextAt=body.age+3.8;}
    return {shielded:false,destroyed:part.hp===0,won:false};
  }
  function snapshot(body){
    if(!body)return null;
    return {id:body.id,x:body.x,y:body.y,age:body.age,hp:body.hp,maxHp:body.maxHp,phase:body.phase,attack:body.attack,
      vulnerable:vulnerable(body),enraged:body.phase==='core'&&body.hp<=2,
      warning:body.warning?{slot:body.warning.slot,angle:body.warning.angle,remaining:body.warning.remaining,duration:body.warning.duration}:null,
      satellites:body.satellites.map(p=>({slot:p.slot,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp}))};
  }
  window.GalaxyStormCore=Object.freeze({create,step,firstHit,damage,snapshot,vulnerable,CORE_RADIUS,SHIELD_RADIUS,SATELLITE_RADIUS,ORBIT,DAMAGE});
})();
