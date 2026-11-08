'use strict';
// Campaign-only authority. Rendering consumes snapshots and never advances combat.
(() => {
  const TAU=Math.PI*2,CORE_RADIUS=122,SHIELD_RADIUS=170,SATELLITE_RADIUS=42,ORBIT=280;
  const GUNS={"sha256":"6710fc8051c4ecfab6561730c35781779981d9dbd24de78ed50408ce9a936601","scale":32.32911124521129,"duration":0.4166666567325592,"lead":0.0833333358168602,"times":[0,0.0416666679084301,0.0833333358168602,0.125,0.1666666716337204,0.2083333283662796,0.25,0.2916666567325592,0.3333333432674408,0.375,0.4166666567325592],"weights":[0,0.5,1,0.95703125,0.84375,0.68359375,0.5,0.31640625,0.15625,0.04296875,0],"guns":[{"pivot":[0,0.30000001192092896,-2.7200000286102295],"forward":1.5870981749277941,"rest":-1.5870981749277941,"muzzles":[{"base":[-0.21953938061460693,0.3199999965727329,-1.0331409325812733],"delta":[0.004515712326011481,0,0.27698161980677627]},{"base":[0.1904061400787328,0.3199999965727329,-1.039824394256743],"delta":[0.00451571232601148,0,0.27698161980677605]}]},{"pivot":[-2.3555891513824463,0.30000001192092896,-1.3600000143051147],"forward":1.5707963267948966,"rest":-2.617993792790977,"muzzles":[{"base":[-0.2049999991431829,0.3199999965727329,-1.0310647487640379],"delta":[-8.673617379884035e-19,0,0.27701842784881586]},{"base":[0.20499999914318334,0.3199999965727329,-1.0310647487640379],"delta":[-8.673617379884035e-19,0,0.27701842784881586]}]},{"pivot":[-2.3555891513824463,0.30000001192092896,1.3600000143051147],"forward":1.5707963267948966,"rest":2.6179939168505566,"muzzles":[{"base":[-0.20499999914318334,0.3199999965727329,-1.0310647487640383],"delta":[0,0,0.2770184278488159]},{"base":[0.20499999914318315,0.3199999965727329,-1.0310647487640383],"delta":[0,0,0.2770184278488159]}]},{"pivot":[0,0.30000001192092896,2.7200000286102295],"forward":1.5707963267948966,"rest":1.57079623937212,"muzzles":[{"base":[-0.20499999914318323,0.3199999965727329,-1.031064748764038],"delta":[0,0,0.2770184278488159]},{"base":[0.20499999914318323,0.3199999965727329,-1.031064748764038],"delta":[0,0,0.2770184278488159]}]},{"pivot":[2.3555891513824463,0.30000001192092896,1.3600000143051147],"forward":1.5707963267948966,"rest":0.523598685120107,"muzzles":[{"base":[-0.20499999914318318,0.3199999965727329,-1.031064748764038],"delta":[0,0,0.2770184278488159]},{"base":[0.20499999914318326,0.3199999965727329,-1.031064748764038],"delta":[0,0,0.2770184278488159]}]},{"pivot":[2.3555891513824463,0.30000001192092896,-1.3600000143051147],"forward":1.5707963267948966,"rest":-0.5235988607988163,"muzzles":[{"base":[-0.2049999991431834,0.3199999965727329,-1.0310647487640379],"delta":[8.673617379884035e-19,0,0.27701842784881586]},{"base":[0.2049999991431829,0.3199999965727329,-1.0310647487640379],"delta":[8.673617379884035e-19,0,0.27701842784881586]}]}]};
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
      phase:'satellites',attack:'cooldown',nextAt:1.2,cursor:0,warning:null,clipTime:GUNS.duration,
      turrets:GUNS.guns.map(g=>({angle:g.rest})),
      satellites:Array.from({length:3},(_,slot)=>({slot,hp:satelliteHp,maxHp:satelliteHp,x:0,y:0,px:0,py:0,vx:0,vy:0}))};
    pose(body);body.px=body.x;body.py=body.y;
    for(const part of body.satellites){part.px=part.x;part.py=part.y;}
    return body;
  }
  const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  function shotWeight(time){
    if(time<=0||time>=GUNS.duration)return 0;
    let i=1;while(i<GUNS.times.length-1&&GUNS.times[i]<time)i++;
    const t=(time-GUNS.times[i-1])/(GUNS.times[i]-GUNS.times[i-1]);
    return GUNS.weights[i-1]+(GUNS.weights[i]-GUNS.weights[i-1])*t;
  }
  function gunYaw(body,index){return -body.turrets[index].angle-body.age*.08-GUNS.guns[index].forward;}
  function gunPose(body,index,side=0,angle=body.turrets[index].angle){
    const g=GUNS.guns[index],spin=body.age*.08,yaw=-angle-spin-g.forward;
    const weight=shotWeight(body.clipTime),m=g.muzzles[side],lx=m.base[0]+m.delta[0]*weight,lz=m.base[2]+m.delta[2]*weight;
    const c=Math.cos(yaw),s=Math.sin(yaw),cs=Math.cos(spin),sn=Math.sin(spin);
    const mx=g.pivot[0]+c*lx+s*lz,my=-(g.pivot[2]-s*lx+c*lz);
    return {x:body.x+(cs*mx-sn*my)*GUNS.scale,y:body.y-(sn*mx+cs*my)*GUNS.scale,z:10+(g.pivot[1]+m.base[1]+m.delta[1]*weight)*GUNS.scale,angle,yaw};
  }
  function updateGuns(body,dt){
    const warning=body.warning?.slot===-1?body.warning:null,spin=body.age*.08;
    const cs=Math.cos(spin),sn=Math.sin(spin);
    const lane=index=>{const p=GUNS.guns[index].pivot,x=(cs*p[0]+sn*p[2])*GUNS.scale,y=-(sn*p[0]-cs*p[2])*GUNS.scale;
      return -Math.sin(warning.angle)*x+Math.cos(warning.angle)*y;};
    const spread=body.hp<=2?.22:.18;
    for(let i=0;i<6;i++){
      // A shallow outward fan follows the live target, including the release frame.
      // The central barrel stays on target; the others cover its flanks.
      const desired=warning?warning.angle+(i===warning.central.turret?0:Math.max(-1,Math.min(1,lane(i)/80))*spread):GUNS.guns[i].rest-spin;
      const error=wrap(desired-body.turrets[i].angle),limit=2.8*dt;
      body.turrets[i].angle+=Math.max(-limit,Math.min(limit,error));
    }
  }
  function volleyMuzzles(body,angle,count,central=null,aligned=false){
    const nx=-Math.sin(angle),ny=Math.cos(angle),available=[];
    for(let turret=0;turret<6;turret++)for(let side=0;side<2;side++){
      const p=gunPose(body,turret,side,aligned?angle:body.turrets[turret].angle);
      available.push({turret,side,p,lane:(p.x-body.x)*nx+(p.y-body.y)*ny+(aligned?0:Math.sin(p.angle-angle)*780)});
    }
    // Keep one central lane, then use the widest gaps across the entire hull.
    // Selecting the nearest turrets instead clusters their twin barrels together.
    available.sort((a,b)=>Math.abs(a.lane)-Math.abs(b.lane)||Math.hypot(a.p.x-body.x,a.p.y-body.y)-Math.hypot(b.p.x-body.x,b.p.y-body.y));
    if(central){const i=available.findIndex(m=>m.turret===central.turret&&m.side===central.side);available.unshift(...available.splice(i,1));}
    const selected=[available.shift()];
    while(selected.length<count){
      let best=0,distance=-1;
      for(let i=0;i<available.length;i++){
        const gap=Math.min(...selected.map(m=>Math.abs(m.lane-available[i].lane)));
        if(gap>distance){best=i;distance=gap;}
      }
      selected.push(available.splice(best,1)[0]);
    }
    return selected;
  }
  function step(body,dt,target,uid){
    if(!(body.hp>0)||!(dt>0))return [];
    body.age+=dt;body.clipTime=Math.min(GUNS.duration,body.clipTime+dt);
    body.orbit+=dt*(.33+(3-alive(body).length)*.1);pose(body,dt);
    const shots=[];
    if(!target||target.dead||target.spawnFx>0){body.warning=null;body.attack='cooldown';body.nextAt=body.age+1.2;updateGuns(body,dt);return shots;}
    if(!body.warning&&body.age+1e-8>=body.nextAt){
      const parts=alive(body),part=parts.length?parts[body.cursor++%parts.length]:body,duration=parts.length?.85:1.25;
      body.warning={slot:parts.length?part.slot:-1,angle:Math.atan2(target.y-part.y,target.x-part.x),targetX:target.x,targetY:target.y,remaining:duration,duration,at:body.age+duration};
      if(!parts.length){
        const [{turret,side}]=volleyMuzzles(body,body.warning.angle,1,null,true);
        body.warning.central={turret,side};
      }
      body.attack='charging';
    }
    const warning=body.warning;
    if(warning){
      const source=warning.slot<0?body:body.satellites[warning.slot];
      if(warning.slot<0){warning.targetX=target.x;warning.targetY=target.y;}
      else{
        // Follow the pilot throughout the defensive charge, with a modest lead.
        // Use authoritative velocity so wrapping/respawning cannot fake a sprint.
        const time=Math.min(.3,Math.hypot(target.x-source.x,target.y-source.y)/330*.2);
        const vx=Number.isFinite(target.vx)?target.vx:0,vy=Number.isFinite(target.vy)?target.vy:0;
        const scale=Math.min(1,75/(Math.hypot(vx,vy)*time||1));
        warning.targetX=target.x+vx*time*scale;warning.targetY=target.y+vy*time*scale;
      }
      warning.remaining=Math.max(0,warning.at-body.age);
      warning.angle=Math.atan2(warning.targetY-source.y,warning.targetX-source.x);
      if(warning.slot<0&&Math.hypot(warning.targetX-body.x,warning.targetY-body.y)>SHIELD_RADIUS+20){
        // Recompute the central aim from the current target every frame.
        for(let i=0;i<4;i++){
          const p=gunPose(body,warning.central.turret,warning.central.side,warning.angle);
          warning.angle=Math.atan2(warning.targetY-p.y,warning.targetX-p.x);
        }
      }
      if(warning.slot<0&&body.age>=warning.at-GUNS.lead)body.clipTime=Math.min(GUNS.duration,Math.max(0,body.age-warning.at+GUNS.lead));
    }
    updateGuns(body,dt);
    if(!warning||body.age+1e-8<warning.at)return shots;
    const source=warning.slot<0?body:body.satellites[warning.slot];
    if(source.hp>0){
      if(warning.slot<0){
        for(const {turret,side,p} of volleyMuzzles(body,warning.angle,body.hp<=2?7:5,warning.central)){
          const dx=Math.cos(p.angle),dy=Math.sin(p.angle);
          shots.push({id:uid(),owner:-3,storm:true,turret,side,x:p.x,y:p.y,z:p.z,px:p.x,py:p.y,vx:dx*330,vy:dy*330,age:0,travel:0,guided:false});
        }
      }else{
        const dx=Math.cos(warning.angle),dy=Math.sin(warning.angle),x=source.x+dx*(SATELLITE_RADIUS+8),y=source.y+dy*(SATELLITE_RADIUS+8);
        shots.push({id:uid(),owner:-3,storm:true,x,y,px:x,py:y,vx:dx*330,vy:dy*330,age:0,travel:0,guided:false});
      }
    }
    body.warning=null;body.attack='cooldown';body.nextAt=body.age+(body.phase==='core'?(body.hp<=2?2.8:3.8):1.5+alive(body).length*.3);
    return shots;
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
    return {id:body.id,x:body.x,y:body.y,age:body.age,hp:body.hp,maxHp:body.maxHp,phase:body.phase,attack:body.attack,clipTime:body.clipTime,spin:body.age*.08,turrets:body.turrets.map(t=>({angle:t.angle})),
      vulnerable:vulnerable(body),enraged:body.phase==='core'&&body.hp<=2,
      warning:body.warning?{slot:body.warning.slot,angle:body.warning.angle,targetX:body.warning.targetX,targetY:body.warning.targetY,remaining:body.warning.remaining,duration:body.warning.duration}:null,
      satellites:body.satellites.map(p=>({slot:p.slot,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp}))};
  }
  window.GalaxyStormCore=Object.freeze({create,step,firstHit,damage,snapshot,vulnerable,CORE_RADIUS,SHIELD_RADIUS,SATELLITE_RADIUS,ORBIT,DAMAGE,GUNS,gunPose,gunYaw,shotWeight});
})();
