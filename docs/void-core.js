'use strict';
// Phase-five authority: geometry, gates and damage share one local simulation.
(() => {
  const OUTER=450,INNER=260,WALL=12,CORE=50,SHIELD=75,GENERATOR=24,CORRIDOR=(OUTER+INNER)/2;
  const OUTER_SPEED=6*Math.PI/180,INNER_SPEED=-9*Math.PI/180,OPENING=50*Math.PI/180;
  const DAMAGE=Object.freeze({bullet:1,missile:3,flare:2}),TAU=Math.PI*2;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const remaining=b=>b.generators.filter(g=>g.hp>0).length;
  function turretPosition(body,slot){const a=(body.innerAngle||0)+(slot?1:-1)*Math.PI/2;return {x:body.x+INNER*Math.cos(a),y:body.y+INNER*Math.sin(a)};}
  function create(id,config={}){
    const hp=config.coreHp||12;
    return {id,x:960,y:540,age:0,hp,maxHp:hp,stage:'generators',inside:false,everEntered:false,
      outerGate:0,innerGate:1,outerAngle:0,innerAngle:0,pOuterAngle:0,pInnerAngle:0,stepDt:0,
      aims:[0,0],shotSlot:0,escapeLeft:0,escapeDuration:config.escapeSeconds||18,nextShot:8,
      generators:[Math.PI,-Math.PI/3,Math.PI/3].map((a,slot)=>({slot,x:960+510*Math.cos(a),y:540+510*Math.sin(a),hp:config.generatorHp||2,maxHp:config.generatorHp||2}))};
  }
  // Earliest swept circle versus a capsule. Tests the strip and both end caps,
  // including initial overlaps; fast missiles cannot skip a thin wall.
  function capsule(path,ax,ay,bx,by,r){
    const px=path.px??path.x,py=path.py??path.y,dx=path.x-px,dy=path.y-py;
    if(Math.max(px,path.x)<Math.min(ax,bx)-r||Math.min(px,path.x)>Math.max(ax,bx)+r||Math.max(py,path.y)<Math.min(ay,by)-r||Math.min(py,path.y)>Math.max(ay,by)+r)return null;
    const sx=bx-ax,sy=by-ay,len=Math.hypot(sx,sy),ux=len?sx/len:1,uy=len?sy/len:0;
    const q=clamp((px-ax)*ux+(py-ay)*uy,0,len),cx=ax+q*ux,cy=ay+q*uy,d0=Math.hypot(px-cx,py-cy);
    if(d0<r-1e-7){const nx=d0>1e-7?(px-cx)/d0:-uy,ny=d0>1e-7?(py-cy)/d0:ux;return {t:0,x:px,y:py,nx,ny,depth:r-d0};}
    let best=null;
    const accept=(t,nx,ny)=>{if(t>=-1e-9&&t<=1+1e-9&&dx*nx+dy*ny< -1e-9&&(!best||t<best.t))best={t:clamp(t,0,1),x:px+dx*t,y:py+dy*t,nx,ny,depth:0};};
    const v=dx*(-uy)+dy*ux,offset=(px-ax)*(-uy)+(py-ay)*ux;
    if(Math.abs(v)>1e-9)for(const sign of [-1,1]){const t=(sign*r-offset)/v,k=(px+dx*t-ax)*ux+(py+dy*t-ay)*uy;if(k>=0&&k<=len)accept(t,-uy*sign,ux*sign);}
    const a=dx*dx+dy*dy;
    if(a>1e-12)for(const [x,y] of [[ax,ay],[bx,by]]){const ox=px-x,oy=py-y,b=ox*dx+oy*dy,c=ox*ox+oy*oy-r*r,disc=b*b-a*c;if(disc<0)continue;const t=(-b-Math.sqrt(disc))/a,nx=(px+dx*t-x)/r,ny=(py+dy*t-y)/r;accept(t,nx,ny);}
    return best;
  }
  function ring(radius,steps,portal,half){
    const segments=[];
    for(let i=0;i<steps;i++){const a=i*TAU/steps,b=(i+1)*TAU/steps,mid=(a+b)/2;segments.push({ax:Math.cos(a)*radius,ay:Math.sin(a)*radius,bx:Math.cos(b)*radius,by:Math.sin(b)*radius,gate:Math.abs(angle(mid,portal))<half});}
    return segments;
  }
  const outer=ring(OUTER,72,Math.PI,OPENING),inner=ring(INNER,72,0,OPENING);
  const walls=Object.freeze({outer,inner});
  function firstHit(body,path,r=0,{hullOnly=false,enemy=false,fromTime=0,toTime=1}={}){
    let hit=null;
    const take=(h,kind,slot=-1)=>{if(h&&(!hit||h.t<hit.t-1e-9))hit={...h,kind,slot};};
    // Sweep in each ring's own rotating frame. Subdivide angular motion, not
    // ship speed: straight fast shots are already handled analytically.
    for(const [segments,open,previous,current] of [[outer,body.outerGate>.98,body.pOuterAngle||0,body.outerAngle||0],[inner,true,body.pInnerAngle||0,body.innerAngle||0]]){
      const turn=current-previous,count=Math.max(1,Math.ceil(Math.abs(turn)*(toTime-fromTime)/(.25*Math.PI/180)));
      const px=path.px??path.x,py=path.py??path.y,dx=path.x-px,dy=path.y-py;
      for(let i=0;i<count;i++){
        const u=i/count,v=(i+1)/count,t0=fromTime+(toTime-fromTime)*u,t1=fromTime+(toTime-fromTime)*v,a0=previous+turn*t0,a1=previous+turn*t1;
        const c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1),x0=px+dx*u-body.x,y0=py+dy*u-body.y,x1=px+dx*v-body.x,y1=py+dy*v-body.y;
        const local={px:x0*c0+y0*s0,py:-x0*s0+y0*c0,x:x1*c1+y1*s1,y:-x1*s1+y1*c1};
        for(const segment of segments){
          if(segment.gate&&open)continue;
          const h=capsule(local,segment.ax,segment.ay,segment.bx,segment.by,WALL+r);if(!h)continue;
          const fraction=u+(v-u)*h.t,t=fromTime+(toTime-fromTime)*fraction,a=previous+turn*t,cs=Math.cos(a),sn=Math.sin(a);
          const wx=h.x*cs-h.y*sn,wy=h.x*sn+h.y*cs;
          const surfaceEnd=previous+turn*toTime,ce=Math.cos(surfaceEnd),se=Math.sin(surfaceEnd);
          take({...h,t:fraction,x:body.x+wx,y:body.y+wy,nx:h.nx*cs-h.ny*sn,ny:h.nx*sn+h.ny*cs,
            time:t,wallDx:h.x*ce-h.y*se-wx,wallDy:h.x*se+h.y*ce-wy,wallVx:body.stepDt?-turn*wy/body.stepDt:0,wallVy:body.stepDt?turn*wx/body.stepDt:0},'wall');
        }
      }
    }
    if(body.stage!=='escape'){
      if(!enemy)for(const g of body.generators)if(g.hp>0)take(capsule(path,g.x,g.y,g.x,g.y,GENERATOR+r),'generator',g.slot);
      take(capsule(path,body.x,body.y,body.x,body.y,(enemy||hullOnly?CORE:body.inside?CORE:SHIELD)+r),enemy?'wall':body.inside||hullOnly?'core':'shield');
    }
    return hit;
  }
  function resolveShip(body,p,r){
    // Wrapping the arena is a teleport, never a sweep through the station.
    const wrap=Math.abs(p.x-(p.px??p.x))>960||Math.abs(p.y-(p.py??p.y))>540;
    let start={x:wrap?p.x:p.px??p.x,y:wrap?p.y:p.py??p.y},end={x:p.x,y:p.y},contacts=0,coreHit=false,time=0;
    for(let i=0;i<8;i++){
      const h=firstHit(body,{px:start.x,py:start.y,...end},r,{hullOnly:true,fromTime:time});if(!h)break;
      contacts++;if(h.kind==='core')coreHit=true;
      const left=1-h.t,dx=(end.x-start.x)*left,dy=(end.y-start.y)*left,inward=Math.min(0,(dx-(h.wallDx||0))*h.nx+(dy-(h.wallDy||0))*h.ny);
      start={x:h.x+h.nx*(h.depth+.15),y:h.y+h.ny*(h.depth+.15)};
      end={x:start.x+dx-h.nx*inward,y:start.y+dy-h.ny*inward};
      const velocity=Math.min(0,(p.vx-(h.wallVx||0))*h.nx+(p.vy-(h.wallVy||0))*h.ny);p.vx-=velocity*h.nx;p.vy-=velocity*h.ny;
      time=h.time??(time+(1-time)*h.t);
    }
    p.x=end.x;p.y=end.y;return {contacts,coreHit};
  }
  function syncPresence(body,p,r=35){
    // Contacts already prevent crossing solid walls. Entering through the
    // opening counts when the ship's centre crosses the chamber's inner edge;
    // requiring its whole shield to fit made a visibly entered pilot stay locked.
    body.inside=!!(remaining(body)===0&&p&&!p.dead&&!(p.spawnFx>0)&&Math.hypot(p.x-body.x,p.y-body.y)<INNER-WALL);
    if(body.inside)body.everEntered=true;
    if(body.stage!=='escape')body.stage=remaining(body)?'generators':body.inside?'core':'infiltrate';
  }
  function step(body,dt,p,uid){
    body.age+=dt;
    body.pOuterAngle=body.outerAngle;body.pInnerAngle=body.innerAngle;body.stepDt=dt;
    body.outerAngle+=OUTER_SPEED*dt;body.innerAngle+=INNER_SPEED*dt;
    body.outerGate=remaining(body)===0?1:0;body.innerGate=1;
    if(body.stage==='escape'){body.escapeLeft=Math.max(0,body.escapeLeft-dt);return [];}
    if(p&&!p.dead)for(let i=0;i<2;i++){const gun=turretPosition(body,i);body.aims[i]=Math.atan2(p.y-gun.y,p.x-gun.x);}
    const shots=[];
    if(!p||p.dead||p.spawnFx>0||body.age<body.nextShot)return shots;
    body.nextShot=body.age+6.5;
    // The mounts rotate with solid sections of the inner wall, clear of its
    // opening. Alternate actual shots, including when the reactor blocks aim.
    const sources=[turretPosition(body,body.shotSlot%2)];
    for(const source of sources){
      const dx=p.x-source.x,dy=p.y-source.y,d=Math.hypot(dx,dy)||1,nx=dx/d,ny=dy/d,muzzle={x:source.x+nx*24,y:source.y+ny*24};
      if(firstHit(body,{px:muzzle.x,py:muzzle.y,x:p.x,y:p.y},4,{enemy:true,fromTime:1,toTime:1}))continue;
      shots.push({id:uid(),owner:-5,voidShot:true,x:muzzle.x,y:muzzle.y,px:muzzle.x,py:muzzle.y,vx:nx*200,vy:ny*200,age:0,travel:0,guided:false});
      body.shotSlot++;
    }
    return shots;
  }
  function damage(body,hit,weapon){
    const amount=DAMAGE[weapon];if(!amount||!hit||body.stage==='escape')return {shielded:true};
    if(hit.kind==='generator'){
      const part=body.generators[hit.slot];if(!part||part.hp<=0)return {shielded:true};
      part.hp=Math.max(0,part.hp-amount);return {destroyed:part.hp===0};
    }
    if(hit.kind!=='core'||!body.inside||remaining(body)!==0)return {shielded:true};
    body.hp=Math.max(0,body.hp-amount);
    if(body.hp===0){body.stage='escape';body.escapeLeft=body.escapeDuration;body.outerGate=body.innerGate=1;return {escape:true};}
    return {damaged:true};
  }
  const escaped=(body,p,r=35)=>body.stage==='escape'&&body.escapeLeft>0&&!!p&&!p.dead&&Math.hypot(p.x-body.x,p.y-body.y)>OUTER+WALL+r+8;
  function snapshot(body){return body?{...body,aims:body.aims.slice(),generators:body.generators.map(g=>({...g})),remaining:remaining(body)}:null;}
  window.GalaxyVoidCore=Object.freeze({create,step,damage,firstHit,resolveShip,syncPresence,escaped,snapshot,remaining,turretPosition,walls,DAMAGE,OUTER,INNER,WALL,CORE,SHIELD,GENERATOR,CORRIDOR,OUTER_SPEED,INNER_SPEED,OPENING,capsule});
})();
