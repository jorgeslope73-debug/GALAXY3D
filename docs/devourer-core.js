'use strict';
// Phase-four authority. The renderer consumes these poses, never runs combat.
(() => {
  const HEAD_RADIUS=68,SEGMENT_RADIUS=39,JOINT_RADIUS=23,SPACING=96,NECK_SPACING=120;
  const DAMAGE=Object.freeze({bullet:1,missile:3,flare:2});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const remaining=b=>b.segments.reduce((n,p)=>n+(p.hp>0?1:0),0);
  function weakSlot(body){for(let i=body.segments.length-1;i>=0;i--)if(body.segments[i].hp>0)return i;return -1;}
  const vulnerable=b=>weakSlot(b)<0&&['volley-warning','volley','recover'].includes(b.attack);
  // One simple, wide, undulating loop. Every segment samples the same trail
  // by travelled distance, so slowing, aiming and charging cannot fold the body.
  const PATH_STEPS=1024,TAU=Math.PI*2,PATH=new Float64Array(PATH_STEPS+1);
  const curve=t=>({x:960+650*Math.cos(t),y:540+300*Math.sin(t)+90*Math.sin(3*t),angle:Math.atan2(300*Math.cos(t)+270*Math.cos(3*t),-650*Math.sin(t))});
  for(let i=1,previous=curve(0);i<=PATH_STEPS;i++){
    const point=curve(i*TAU/PATH_STEPS);PATH[i]=PATH[i-1]+Math.hypot(point.x-previous.x,point.y-previous.y);previous=point;
  }
  function pathPose(distance){
    const at=((distance%PATH[PATH_STEPS])+PATH[PATH_STEPS])%PATH[PATH_STEPS];let low=0,high=PATH_STEPS;
    while(high-low>1){const mid=(low+high)>>1;if(PATH[mid]<=at)low=mid;else high=mid;}
    return curve((low+(at-PATH[low])/(PATH[high]-PATH[low]))*TAU/PATH_STEPS);
  }
  function create(id,config={}){
    const count=clamp(Math.round(config.segments||5),1,5),hp=config.headHp||8,segmentHp=config.segmentHp||1;
    const pathDistance=PATH[PATH_STEPS]-280,pose=pathPose(pathDistance);
    const body={id,x:pose.x,y:pose.y,px:pose.x,py:pose.y,vx:0,vy:0,angle:pose.angle,age:0,hp,maxHp:hp,pathDistance,pathSpeed:142,
      attack:'patrol',until:4,cycle:0,nextVolley:0,volleys:0,warning:null,charge:null,
      segments:Array.from({length:count},(_,slot)=>({slot,hp:segmentHp,maxHp:segmentHp,x:0,y:0,px:0,py:0,angle:0,joint:{x:0,y:0,px:0,py:0}}))};
    follow(body);
    for(const p of body.segments){p.px=p.x;p.py=p.y;p.joint.px=p.joint.x;p.joint.py=p.joint.y;}
    return body;
  }
  function follow(body){
    let lead=body;
    for(const p of body.segments){
      if(p.hp<=0)continue;
      p.px=p.x;p.py=p.y;p.joint.px=p.joint.x;p.joint.py=p.joint.y;
      const point=pathPose(body.pathDistance-NECK_SPACING-p.slot*SPACING);
      p.x=point.x;p.y=point.y;p.angle=Math.atan2(lead.y-p.y,lead.x-p.x);
      // Place the shorter neck's orange weak point clear of the head armor.
      const mix=lead===body?.65:.5;
      p.joint.x=lead.x+(p.x-lead.x)*mix;p.joint.y=lead.y+(p.y-lead.y)*mix;lead=p;
    }
  }
  function chargeTarget(body,target){
    const tx=target.x+(Number(target.vx)||0)*.2,ty=target.y+(Number(target.vy)||0)*.2;
    let best=null,score=Infinity;
    for(let distance=400;distance<=670;distance+=15){
      const point=pathPose(body.pathDistance+distance),d=(point.x-tx)**2+(point.y-ty)**2;
      if(d<score){score=d;best={x:point.x,y:point.y,destination:body.pathDistance+distance,locked:false};}
    }
    return best;
  }
  function step(body,dt,target,uid){
    if(!body||body.hp<=0||!(dt>0))return [];
    body.age+=dt;body.px=body.x;body.py=body.y;
    const count=remaining(body),speed=142+(body.segments.length-count)*19+(count===0?30:0),shots=[];let movementDt=dt;
    const active=target&&!target.dead&&!(target.spawnFx>0);
    if(!active){body.warning=null;body.charge=null;body.attack='patrol';body.until=body.age+2;}
    if(active&&body.age+1e-8>=body.until){
      if(body.attack==='patrol'){
        const volley=body.cycle++%2===0;
        body.attack=volley?'volley-warning':'charge-warning';body.until=body.age+(volley?1.15:1.35);
        body.warning=volley?{x:target.x,y:target.y,locked:false}:chargeTarget(body,target);
      }else if(body.attack==='volley-warning'){
        body.attack='volley';body.volleys=0;body.nextVolley=body.age;body.until=body.age+.75;
      }else if(body.attack==='charge-warning'){
        const duration=1.35,start=body.age-dt,distance=body.warning.destination-body.pathDistance;
        body.charge={start,duration,distance,from:body.pathDistance,entrySpeed:body.pathSpeed,exitSpeed:speed*.55};
        body.attack='charge';body.until=start+duration;body.warning=null;
      }else if(body.attack==='volley'||body.attack==='charge'){
        if(body.charge){
          body.pathDistance=body.charge.from+body.charge.distance;body.pathSpeed=body.charge.exitSpeed;movementDt=Math.max(0,body.age-body.until);
        }
        body.attack='recover';body.until=body.age+(count?1.8:2.4);body.warning=null;body.charge=null;
      }else{body.attack='patrol';body.until=body.age+(count?3.6:2.4);}
    }
    if(body.warning){
      // The final quarter-second fixes the charge destination so it can be dodged.
      if(body.attack!=='charge-warning'||body.until-body.age>.25){
        if(body.attack==='charge-warning')body.warning=chargeTarget(body,target);
        else{body.warning.x=target.x;body.warning.y=target.y;}
      }else body.warning.locked=true;
      // The reticle marks the pilot; the charge destination stays on the safe trail.
      body.warning.targetX=target.x;body.warning.targetY=target.y;
    }
    if(body.attack==='charge'&&body.charge){
      const c=body.charge,t=clamp((body.age-c.start)/c.duration,0,1),t2=t*t,t3=t2*t;
      body.pathDistance=c.from+(3*t2-2*t3)*c.distance+(t3-2*t2+t)*c.entrySpeed*c.duration+(t3-t2)*c.exitSpeed*c.duration;
      body.pathSpeed=((6*t-6*t2)*c.distance+(3*t2-4*t+1)*c.entrySpeed*c.duration+(3*t2-2*t)*c.exitSpeed*c.duration)/c.duration;
    }else{
      const factor=body.attack==='patrol'?1:body.attack==='recover'?.55:.22;
      const goal=speed*factor,decay=Math.exp(-movementDt/.28);
      body.pathDistance+=goal*movementDt+(body.pathSpeed-goal)*.28*(1-decay);body.pathSpeed=goal+(body.pathSpeed-goal)*decay;
    }
    const pose=pathPose(body.pathDistance);body.x=pose.x;body.y=pose.y;
    const aiming=active&&(body.attack==='volley-warning'||body.attack==='volley');
    const desired=pose.angle+(aiming?clamp(angleDelta(Math.atan2(target.y-body.y,target.x-body.x),pose.angle),-1.05,1.05):0);
    body.angle+=clamp(angleDelta(desired,body.angle),-2.2*dt,2.2*dt);
    body.vx=(body.x-body.px)/dt;body.vy=(body.y-body.py)/dt;
    follow(body);
    if(active&&body.attack==='volley'&&body.volleys<3&&body.age+1e-8>=body.nextVolley){
      const aim=body.angle,n=count?5:7;
      for(let i=0;i<n;i++){
        const angle=aim+(i-(n-1)/2)*.14,dx=Math.cos(angle),dy=Math.sin(angle);
        const x=body.x+Math.cos(body.angle)*76,y=body.y+Math.sin(body.angle)*76;
        shots.push({id:uid(),owner:-4,devourer:true,x,y,px:x,py:y,vx:dx*340,vy:dy*340,age:0,travel:0,guided:false});
      }
      body.volleys++;body.nextVolley=body.age+.25;
    }
    return shots;
  }
  function circleHit(s,p,r){
    const ax=s.px-(p.px??p.x),ay=s.py-(p.py??p.y),dx=s.x-s.px-(p.x-(p.px??p.x)),dy=s.y-s.py-(p.y-(p.py??p.y));
    const c=ax*ax+ay*ay-r*r;if(c<=0)return 0;
    const a=dx*dx+dy*dy;if(a<1e-12)return null;
    const b=2*(ax*dx+ay*dy),disc=b*b-4*a*c;if(disc<0)return null;
    const t=(-b-Math.sqrt(disc))/(2*a);return t>=0&&t<=1?t:null;
  }
  function firstHit(body,segment,radius=0,{hullOnly=false}={}){
    let best=null;
    const consider=(part,r,slot,armored=false)=>{
      const t=circleHit(segment,part,r+radius);
      const exposedTie=best&&t===best.t&&!armored&&slot===weakSlot(body)&&(best.armored||best.slot<0&&!vulnerable(body));
      if(t!==null&&(!best||t<best.t||exposedTie))best={slot,armored,t,part,r,x:segment.px+(segment.x-segment.px)*t,y:segment.py+(segment.y-segment.py)*t};
    };
    consider(body,HEAD_RADIUS,-1);
    for(const p of body.segments)if(p.hp>0){consider(p,SEGMENT_RADIUS,p.slot,true);if(!hullOnly)consider(p.joint,JOINT_RADIUS,p.slot);}
    return best;
  }
  function damage(body,hit,weapon){
    const amount=DAMAGE[weapon];if(!amount||body.hp<=0)return null;
    if(hit.armored||hit.slot>=0&&hit.slot!==weakSlot(body)||hit.slot<0&&!vulnerable(body))return {shielded:true};
    const part=hit.slot<0?body:body.segments[hit.slot];if(!part||part.hp<=0)return null;
    part.hp=Math.max(0,part.hp-amount);
    return {shielded:false,destroyed:part.hp===0,won:body.hp===0};
  }
  function snapshot(body){
    if(!body)return null;
    return {id:body.id,x:body.x,y:body.y,angle:body.angle,age:body.age,hp:body.hp,maxHp:body.maxHp,attack:body.attack,
      weakSlot:weakSlot(body),remaining:remaining(body),vulnerable:vulnerable(body),warning:body.warning?{...body.warning}:null,
      segments:body.segments.map(p=>({slot:p.slot,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp,joint:{x:p.joint.x,y:p.joint.y}}))};
  }
  window.GalaxyDevourer=Object.freeze({create,step,firstHit,damage,snapshot,weakSlot,remaining,vulnerable,HEAD_RADIUS,SEGMENT_RADIUS,JOINT_RADIUS,SPACING,DAMAGE});
})();
