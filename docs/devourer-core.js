'use strict';
// Phase-four authority. The renderer consumes these poses, never runs combat.
(() => {
  const HEAD_RADIUS=68,SEGMENT_RADIUS=39,JOINT_RADIUS=23,SPACING=96;
  const DAMAGE=Object.freeze({bullet:1,missile:3,flare:2});
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const remaining=b=>b.segments.reduce((n,p)=>n+(p.hp>0?1:0),0);
  function weakSlot(body){for(let i=body.segments.length-1;i>=0;i--)if(body.segments[i].hp>0)return i;return -1;}
  const vulnerable=b=>weakSlot(b)<0&&['volley-warning','volley','recover'].includes(b.attack);
  function create(id,config={}){
    const count=clamp(Math.round(config.segments||5),1,5),hp=config.headHp||8,segmentHp=config.segmentHp||3;
    const body={id,x:1660,y:260,px:1660,py:260,vx:0,vy:0,angle:Math.PI,age:0,hp,maxHp:hp,
      attack:'patrol',until:4,cycle:0,nextVolley:0,volleys:0,warning:null,charge:null,
      segments:Array.from({length:count},(_,slot)=>({slot,hp:segmentHp,maxHp:segmentHp,x:1660+(slot+1)*SPACING+60,y:260,px:0,py:260,angle:Math.PI,joint:{x:0,y:260,px:0,py:260}}))};
    let lead=body;
    for(const p of body.segments){p.px=p.x;p.joint.x=p.joint.px=(p.x+lead.x)/2;lead=p;}
    return body;
  }
  function follow(body){
    let lead=body;
    for(const p of body.segments){
      if(p.hp<=0)continue;
      p.px=p.x;p.py=p.y;p.joint.px=p.joint.x;p.joint.py=p.joint.y;
      const dx=lead.x-p.x,dy=lead.y-p.y,length=Math.hypot(dx,dy)||1;
      const spacing=lead===body?SPACING+60:SPACING;
      p.x=lead.x-dx/length*spacing;p.y=lead.y-dy/length*spacing;p.angle=Math.atan2(dy,dx);
      p.joint.x=(p.x+lead.x)/2;p.joint.y=(p.y+lead.y)/2;lead=p;
    }
  }
  function step(body,dt,target,uid){
    if(!body||body.hp<=0||!(dt>0))return [];
    body.age+=dt;body.px=body.x;body.py=body.y;
    const count=remaining(body),speed=142+(body.segments.length-count)*19+(count===0?30:0),shots=[];
    const active=target&&!target.dead&&!(target.spawnFx>0);
    if(!active){body.warning=null;body.charge=null;body.attack='patrol';body.until=body.age+2;}
    if(active&&body.age+1e-8>=body.until){
      if(body.attack==='patrol'){
        const volley=body.cycle++%2===0;
        body.attack=volley?'volley-warning':'charge-warning';body.until=body.age+(volley?1.15:1.35);
        body.warning={x:target.x,y:target.y,locked:false};
      }else if(body.attack==='volley-warning'){
        body.attack='volley';body.volleys=0;body.nextVolley=body.age;body.until=body.age+.75;
      }else if(body.attack==='charge-warning'){
        const angle=Math.atan2(body.warning.y-body.y,body.warning.x-body.x),distance=Math.min(780,Math.hypot(body.warning.x-body.x,body.warning.y-body.y)+180);
        const ex=clamp(body.x+Math.cos(angle)*distance,100,1820),ey=clamp(body.y+Math.sin(angle)*distance,120,960);
        body.charge={x:body.x,y:body.y,ex,ey,start:body.age,duration:1.05};body.attack='charge';body.until=body.age+1.05;body.warning=null;
      }else if(body.attack==='volley'||body.attack==='charge'){
        body.attack='recover';body.until=body.age+(count?1.8:2.4);body.warning=null;body.charge=null;
      }else{body.attack='patrol';body.until=body.age+(count?3.6:2.4);}
    }
    if(body.warning){
      // The final quarter-second fixes the charge destination so it can be dodged.
      if(body.attack!=='charge-warning'||body.until-body.age>.25){
        const lead=body.attack==='charge-warning'?.2:0;
        body.warning.x=clamp(target.x+(Number(target.vx)||0)*lead,70,1850);
        body.warning.y=clamp(target.y+(Number(target.vy)||0)*lead,90,990);
      }else body.warning.locked=true;
    }
    if(body.attack==='charge'&&body.charge){
      const c=body.charge,t=clamp((body.age-c.start)/c.duration,0,1),ease=t*t*(3-2*t);
      body.x=c.x+(c.ex-c.x)*ease;body.y=c.y+(c.ey-c.y)*ease;
    }else{
      const tx=960+580*Math.sin(body.age*.23),ty=540+290*Math.sin(body.age*.39+.7);
      let desired=Math.atan2(ty-body.y,tx-body.x);
      if(body.attack==='volley-warning'||body.attack==='volley')desired=Math.atan2(target.y-body.y,target.x-body.x);
      if(body.attack==='charge-warning')desired=Math.atan2(body.warning.y-body.y,body.warning.x-body.x);
      const turn=clamp(angleDelta(desired,body.angle),-2.2*dt,2.2*dt);body.angle+=turn;
      const factor=body.attack==='patrol'?1:body.attack==='recover'?.55:.22;
      body.x=clamp(body.x+Math.cos(body.angle)*speed*factor*dt,92,1828);
      body.y=clamp(body.y+Math.sin(body.angle)*speed*factor*dt,112,968);
    }
    body.vx=(body.x-body.px)/dt;body.vy=(body.y-body.py)/dt;
    if(body.attack==='charge'&&Math.hypot(body.vx,body.vy)>1)body.angle=Math.atan2(body.vy,body.vx);
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
