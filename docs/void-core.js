'use strict';
// Phase-five authority: geometry, gates and damage share one local simulation.
(() => {
  const OUTER=410,INNER=235,WALL=12,CORE=65,SHIELD=90,GENERATOR=24;
  const DAMAGE=Object.freeze({bullet:1,missile:3,flare:2}),TAU=Math.PI*2;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
  const remaining=b=>b.generators.filter(g=>g.hp>0).length;
  function create(id,config={}){
    const hp=config.coreHp||12;
    return {id,x:960,y:540,age:0,hp,maxHp:hp,stage:'generators',inside:false,everEntered:false,
      outerGate:0,innerGate:0,aims:[0,0],escapeLeft:0,escapeDuration:config.escapeSeconds||18,nextShot:3,
      generators:[Math.PI,-Math.PI/3,Math.PI/3].map((a,slot)=>({slot,x:960+470*Math.cos(a),y:540+470*Math.sin(a),hp:config.generatorHp||2,maxHp:config.generatorHp||2}))};
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
  const outer=ring(OUTER,72,Math.PI,20*Math.PI/180),inner=ring(INNER,48,0,30*Math.PI/180);
  const walls=Object.freeze({outer,inner});
  function firstHit(body,path,r=0,{hullOnly=false,enemy=false}={}){
    let hit=null;
    const take=(h,kind,slot=-1)=>{if(h&&(!hit||h.t<hit.t-1e-9))hit={...h,kind,slot};};
    for(const [segments,open] of [[outer,body.outerGate>.98],[inner,body.innerGate>.98]])for(const s of segments){
      if(s.gate&&open)continue;
      take(capsule(path,body.x+s.ax,body.y+s.ay,body.x+s.bx,body.y+s.by,WALL+r),'wall');
    }
    if(body.stage!=='escape'){
      if(!enemy)for(const g of body.generators)if(g.hp>0)take(capsule(path,g.x,g.y,g.x,g.y,GENERATOR+r),'generator',g.slot);
      if(!enemy||hullOnly)take(capsule(path,body.x,body.y,body.x,body.y,(hullOnly?CORE:body.inside?CORE:SHIELD)+r),body.inside||hullOnly?'core':'shield');
    }
    return hit;
  }
  function resolveShip(body,p,r){
    // Wrapping the arena is a teleport, never a sweep through the station.
    const wrap=Math.abs(p.x-(p.px??p.x))>960||Math.abs(p.y-(p.py??p.y))>540;
    let start={x:wrap?p.x:p.px??p.x,y:wrap?p.y:p.py??p.y},end={x:p.x,y:p.y},contacts=0,coreHit=false;
    for(let i=0;i<4;i++){
      const h=firstHit(body,{px:start.x,py:start.y,...end},r,{hullOnly:true});if(!h)break;
      contacts++;if(h.kind==='core')coreHit=true;
      const left=1-h.t,dx=(end.x-start.x)*left,dy=(end.y-start.y)*left,inward=Math.min(0,dx*h.nx+dy*h.ny);
      start={x:h.x+h.nx*(h.depth+.15),y:h.y+h.ny*(h.depth+.15)};
      end={x:start.x+dx-h.nx*inward,y:start.y+dy-h.ny*inward};
      const velocity=Math.min(0,p.vx*h.nx+p.vy*h.ny);p.vx-=velocity*h.nx;p.vy-=velocity*h.ny;
    }
    p.x=end.x;p.y=end.y;return {contacts,coreHit};
  }
  function syncPresence(body,p,r=35){
    body.inside=!!(p&&!p.dead&&!(p.spawnFx>0)&&Math.hypot(p.x-body.x,p.y-body.y)<INNER-WALL-r);
    if(body.inside)body.everEntered=true;
    if(body.stage!=='escape')body.stage=remaining(body)?'generators':body.inside?'core':'infiltrate';
  }
  function atPortal(body,p,radius,portal,r){
    if(!p||p.dead)return false;
    const dx=p.x-body.x,dy=p.y-body.y;
    return Math.abs(Math.hypot(dx,dy)-radius)<r+WALL+16&&Math.abs(angle(Math.atan2(dy,dx),portal))<(radius===OUTER?20:30)*Math.PI/180+.12;
  }
  function step(body,dt,p,uid){
    body.age+=dt;
    if(body.stage==='escape'){body.escapeLeft=Math.max(0,body.escapeLeft-dt);body.outerGate=body.innerGate=1;return [];}
    const unlocked=remaining(body)===0,cycle=(body.age%6),hold=body.innerGate>.98&&atPortal(body,p,INNER,0,70),goal=unlocked&&(cycle<3.6||hold)?1:0;
    if(p&&!p.dead)for(let i=0;i<2;i++)body.aims[i]=Math.atan2(p.y-(body.y+(i?1:-1)*315),p.x-body.x);
    body.outerGate=unlocked?Math.min(1,body.outerGate+dt*2):0;
    body.innerGate=clamp(body.innerGate+(goal?1:-1)*dt*2,0,1);
    // Never close a moving gate onto a pilot already traversing its throat.
    if(unlocked&&hold)body.innerGate=1;
    const shots=[];
    if(!p||p.dead||p.spawnFx>0||body.age<body.nextShot)return shots;
    body.nextShot=body.age+2.6;
    const sources=remaining(body)?body.generators.filter(g=>g.hp>0):[-1,1].map(sign=>({x:body.x,y:body.y+sign*315}));
    for(const source of sources){
      const dx=p.x-source.x,dy=p.y-source.y,d=Math.hypot(dx,dy)||1,nx=dx/d,ny=dy/d,muzzle={x:source.x+nx*32,y:source.y+ny*32};
      if(firstHit(body,{px:muzzle.x,py:muzzle.y,x:p.x,y:p.y},4,{enemy:true}))continue;
      shots.push({id:uid(),owner:-5,voidShot:true,x:muzzle.x,y:muzzle.y,px:muzzle.x,py:muzzle.y,vx:nx*245,vy:ny*245,age:0,travel:0,guided:false});
    }
    return shots;
  }
  function damage(body,hit,weapon){
    const amount=DAMAGE[weapon];if(!amount||!hit||body.stage==='escape')return {shielded:true};
    if(hit.kind==='generator'){
      const part=body.generators[hit.slot];if(!part||part.hp<=0)return {shielded:true};
      part.hp=Math.max(0,part.hp-amount);return {destroyed:part.hp===0};
    }
    if(hit.kind!=='core'||!body.inside)return {shielded:true};
    body.hp=Math.max(0,body.hp-amount);
    if(body.hp===0){body.stage='escape';body.escapeLeft=body.escapeDuration;body.outerGate=body.innerGate=1;return {escape:true};}
    return {damaged:true};
  }
  const escaped=(body,p,r=35)=>body.stage==='escape'&&body.escapeLeft>0&&!!p&&!p.dead&&Math.hypot(p.x-body.x,p.y-body.y)>OUTER+WALL+r+8;
  function snapshot(body){return body?{...body,aims:body.aims.slice(),generators:body.generators.map(g=>({...g})),remaining:remaining(body)}:null;}
  window.GalaxyVoidCore=Object.freeze({create,step,damage,firstHit,resolveShip,syncPresence,escaped,snapshot,remaining,walls,DAMAGE,OUTER,INNER,WALL,CORE,SHIELD,GENERATOR,capsule});
})();
