/* Bounded host-only collision history. No client positions or damage claims. */
'use strict';
(() => {
  const core=window.GalaxyPhysicsCore,MAX_REWIND=.30,HISTORY=.50,DT=1/60;
  const delta=(a,b,size)=>(b-a+size*1.5)%size-size/2;
  const lerp=(a,b,t)=>a+(b-a)*t;
  function interpolate(a,b,t,time){
    const p={...a};
    for(const k of ['x','y','bank','spin'])if(Number.isFinite(a[k])&&Number.isFinite(b[k]))p[k]=lerp(a[k],b[k],t);
    if(Number.isFinite(a.rot)&&Number.isFinite(b.rot))p.rot=a.rot+delta(a.rot,b.rot,360)*t;
    // A wrap is a teleport, never a sweep across the entire arena.
    if(Math.abs(b.x-a.x)>960||Math.abs(b.y-a.y)>540){p.x=t>=1?b.x:a.x;p.y=t>=1?b.y:a.y;}
    p.poseTime=time;return p;
  }
  function circleTime(b,o,r){
    const ox=Number.isFinite(o.px)?o.px:o.x,oy=Number.isFinite(o.py)?o.py:o.y;
    const x=b.px-ox,y=b.py-oy,dx=b.x-b.px-(o.x-ox),dy=b.y-b.py-(o.y-oy),c=x*x+y*y-r*r;
    if(c<=0)return 0;
    const a=dx*dx+dy*dy,bb=2*(x*dx+y*dy),disc=bb*bb-4*a*c;
    if(a<=1e-15||disc<0)return Infinity;
    const t=(-bb-Math.sqrt(disc))/(2*a);return t>=0&&t<=1?t:Infinity;
  }
  class GalaxyShotHistory{
    constructor(){this.reset();}
    reset(){this.frames=[];}
    capture(engine){
      const time=engine.fxClock;
      if(!Number.isFinite(time))return;
      if(this.frames.length&&time<=this.frames.at(-1).time)this.reset();
      const copy=list=>(list||[]).map(p=>({...p,motionStream:undefined,aiControl:undefined}));
      this.frames.push({time,players:copy(engine.players),asteroids:copy(engine.asteroids),meteors:copy(engine.meteors),
        flares:copy(engine.flares),pickups:copy(engine.pickups),ufo:engine.ufo?{...engine.ufo}:null,giant:engine.giant?{...engine.giant}:null});
      while(this.frames.length>32||this.frames.length>2&&time-this.frames[0].time>HISTORY)this.frames.shift();
    }
    sample(time){
      if(this.frames.length<2||time<this.frames[0].time-1e-6||time>this.frames.at(-1).time+1e-6)return null;
      let a=this.frames[0],b=a;
      for(let i=1;i<this.frames.length;i++){b=this.frames[i];if(b.time>=time)break;a=b;}
      const alpha=b.time>a.time?Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time))):0;
      const scene={...a,time};
      for(const field of ['players','asteroids','meteors','flares','pickups']){
        const key=field==='players'?'index':'id',next=new Map(b[field].map(p=>[p[key],p]));
        scene[field]=a[field].map(p=>{
          const q=next.get(p[key]);
          if(!q||field==='players'&&(q.deaths!==p.deaths||q.dead!==p.dead||q.inputSessionId!==p.inputSessionId))return {...(q&&alpha>=1?q:p)};
          return interpolate(p,q,alpha,time);
        });
      }
      for(const field of ['giant','ufo'])if(a[field]&&b[field]&&a[field].id===b[field].id)scene[field]=interpolate(a[field],b[field],alpha,time);
      return scene;
    }
    stamp(projectile,player,control,now){
      if(projectile.guided||player.cpu||!player.motionStream?.active)return;
      projectile.se=player.motionStream.epoch;projectile.st=player.motionStream.ack;
      const view=control.viewTime,offset=now-view;
      if(player.motionStream.missing===0&&Number.isFinite(view)&&view>=0&&offset>=DT&&offset<=MAX_REWIND&&this.sample(view))projectile.lagOffset=offset;
    }
    query(projectile,engine,sweptCircles){
      const ordinary=()=>core.projectileShipHit(projectile,engine.players,sweptCircles,4,24,850,260);
      if(projectile.guided||!(projectile.lagOffset>=DT)||projectile.lagOffset>MAX_REWIND)return ordinary();
      const endTime=engine.fxClock-projectile.lagOffset,startTime=endTime-DT;
      const start=this.sample(startTime),end=this.sample(endTime);
      if(!start||!end)return ordinary();
      const previous=new Map(start.players.map(p=>[p.index,p])),current=new Map(engine.players.map(p=>[p.index,p]));
      const targets=[];
      for(const p of end.players){
        const actual=current.get(p.index),old=previous.get(p.index);
        if(!actual||!old||actual.dead||p.dead||old.dead||actual.deaths!==p.deaths||p.deaths!==old.deaths||actual.inputSessionId!==p.inputSessionId||
          actual.protection>0||actual.spawnFx>0||p.protection>0||p.spawnFx>0||old.protection>0||old.spawnFx>0)continue;
        targets.push({...p,px:old.x,py:old.y,pr:old.rot,pbank:old.bank,previousPoseTime:startTime,poseTime:endTime,
          shield:Math.max(Number(actual.shield)||0,Number(p.shield)||0,Number(old.shield)||0)});
      }
      // Order targets by the first continuous contact, not by player index.
      targets.sort((a,b)=>(core.shipHitsCircle(a,projectile,4)?.t??Infinity)-(core.shipHitsCircle(b,projectile,4)?.t??Infinity));
      const attacker=current.get(projectile.owner);
      if(attacker&&!targets.some(p=>p.index===attacker.index))targets.push(attacker);
      const hit=core.projectileShipHit(projectile,targets,sweptCircles,4,24,850,260);
      const contact=hit&&core.shipHitsCircle(hit.target,projectile,4);
      // Historical geometry must also allow the shot. A rewind never grants a
      // hit through a meteor, rock, flare or pickup visible to the shooter.
      let blocker=Infinity,obstacle=null;
      const block=(t,kind,body)=>{if(Number.isFinite(t)&&t<blocker){blocker=t;obstacle={kind,id:body.id};}};
      const motion=(field,body)=>{
        const old=Array.isArray(start[field])?start[field].find(p=>p.id===body.id):start[field];
        return {...body,px:old?.x??body.x,py:old?.y??body.y,pspin:old?.spin??body.spin,previousPoseTime:startTime,poseTime:endTime};
      };
      for(const rock of end.asteroids){
        const body=motion('asteroids',rock);
        const t=core.isMediumRock(body)?core.asteroidHitsCircle(body,projectile,4,()=>false)?.t:circleTime(projectile,body,(body.r||17)+4);
        block(t,'asteroid',rock);
      }
      if(end.giant)block(core.giantHitsCircle(motion('giant',end.giant),projectile,4)?.t,'giant',end.giant);
      for(const [field,r] of [['meteors',14],['flares',12],['pickups',22]])for(const body of end[field])block(circleTime(projectile,motion(field,body),r+4),field,body);
      if(end.ufo)block(circleTime(projectile,motion('ufo',end.ufo),34),'ufo',end.ufo);
      if(Number.isFinite(blocker)&&(!contact||blocker<=contact.t+1e-6)){
        projectile.historyBlocked=true;
        projectile.historyImpact={...obstacle,x:lerp(projectile.px,projectile.x,blocker),y:lerp(projectile.py,projectile.y,blocker)};
        return null;
      }
      if(!hit||!contact)return null;
      hit.target=current.get(hit.target.index);hit.attacker=current.get(projectile.owner)||null;
      hit.shielded=hit.shielded||hit.target.shield>0;
      hit.impactX=contact.x;hit.impactY=contact.y;return hit;
    }
  }
  window.GalaxyShotHistory=GalaxyShotHistory;
})();
