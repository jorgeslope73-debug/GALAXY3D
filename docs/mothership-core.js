/* CPU encounter only. The GLB hull, muzzle positions and turret nulls share one calibration. */
'use strict';
(() => {
  const data=window.GalaxyMothershipData,physics=window.GalaxyPhysicsCore;
  if(!data||!physics)throw new Error('Falta la geometria de la nodriza');
  const W=1920,H=1080,SPEED=90,SHOT_SPEED=400,SHOT_INTERVAL=8,VOLLEY_GAP=4;
  const BANK_LIMIT=Math.PI/12,BANK_PERIOD=10;
  const YAW_LIMIT=8*Math.PI/180,YAW_PERIOD=14;
  const firingTurrets=data.turrets.map((turret,index)=>turret.name==='AEGIS_Yaw_Centre'?-1:index).filter(index=>index>=0);
  const hullCache=new WeakMap(),rockCache=new WeakMap(),shipCache=new WeakMap();
  const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
  function rotate(x,y,a){const c=Math.cos(a),s=Math.sin(a);return {x:x*c-y*s,y:x*s+y*c};}
  function create(id,direction=1){
    const dir=direction<0?-1:1;
    return {id,x:dir>0?-240:W+240,y:H*.5,px:dir>0?-240:W+240,py:H*.5,vx:dir*SPEED,vy:0,heading:dir*Math.PI/2,angle:dir*Math.PI/2,age:0,bank:0,nextVolley:5.5,fireCursor:0,
      turrets:data.turrets.map(()=>({angle:dir>0?0:Math.PI,nextShot:0,target:-1}))};
  }
  function bankAt(seconds){return Math.sin(seconds*Math.PI*2/BANK_PERIOD)*BANK_LIMIT;}
  function yawAt(seconds){return Math.sin(seconds*Math.PI*2/YAW_PERIOD)*YAW_LIMIT;}
  function yawFor(body,angle){const local=angle-body.angle;return Math.atan2(Math.cos(local)/Math.cos(Number(body.bank)||0),Math.sin(local));}
  function project(body,x,y,z){
    const bank=Number(body.bank)||0,q=rotate(((x-data.center[0])*Math.cos(bank)+(y-data.center[1])*Math.sin(bank))*data.scale,(z-data.center[2])*data.scale,body.angle);
    return {x:body.x+q.x,y:body.y+q.y};
  }
  function pivot(body,index){
    return project(body,...data.turrets[index].pivot);
  }
  function muzzle(body,index,barrel=0){
    const turret=body.turrets[index],p=data.turrets[index].pivot,q=data.turrets[index].muzzles[barrel];
    // Model barrels point along +Z; yaw is around the supplied Y-axis null.
    const yaw=yawFor(body,turret.angle),c=Math.cos(yaw),s=Math.sin(yaw);
    return project(body,p[0]+q[0]*c+q[2]*s,p[1]+q[1],p[2]-q[0]*s+q[2]*c);
  }
  function canTarget(body,index,target){
    if(!firingTurrets.includes(index))return false;
    const local=rotate(target.x-body.x,target.y-body.y,-body.angle),mount=data.turrets[index].pivot;
    const side=local.x*(mount[0]-data.center[0]),fore=local.y*(mount[2]-data.center[2]);
    // +Z in the GLB is aft. Each arrival sector has the two guns on that side.
    if(Math.abs(local.y)>Math.abs(local.x)+1e-6)return fore>=-1e-6;
    if(Math.abs(local.x)>Math.abs(local.y)+1e-6)return side>=-1e-6;
    return side>=-1e-6&&fore>=-1e-6;
  }
  function assignTargets(body,players){
    const eligible=players.filter(p=>!p.dead&&!(p.spawnFx>0)&&!(p.protection>0)&&!(p.camo>0)).sort((a,b)=>a.index-b.index);
    const costs=firingTurrets.map(index=>{const p=pivot(body,index);return eligible.map(target=>canTarget(body,index,target)?Math.hypot(target.x-p.x,target.y-p.y):Infinity);});
    const plan=Array(firingTurrets.length).fill(-1);let best=plan.slice(),bestCount=-1,bestCost=Infinity;
    // Four guns/four players: find the closest valid matching without stealing
    // the only suitable gun from another target or assigning a player twice.
    function visit(slot,used,count,cost){
      if(count+firingTurrets.length-slot<bestCount)return;
      if(slot===firingTurrets.length){
        if(count>bestCount||(count===bestCount&&cost<bestCost)){bestCount=count;bestCost=cost;best=plan.slice();}
        return;
      }
      plan[slot]=-1;visit(slot+1,used,count,cost);
      for(let j=0;j<eligible.length;j++)if(!(used&(1<<j))&&Number.isFinite(costs[slot][j])){plan[slot]=j;visit(slot+1,used|(1<<j),count+1,cost+costs[slot][j]);}
    }
    visit(0,0,0,0);
    for(const turret of body.turrets)turret.target=-1;
    for(let slot=0;slot<firingTurrets.length;slot++)if(best[slot]>=0)body.turrets[firingTurrets[slot]].target=eligible[best[slot]].index;
    return eligible;
  }
  function step(body,dt,players,uid){
    body.px=body.x;body.py=body.y;body.x+=body.vx*dt;body.y+=body.vy*dt;body.age+=dt;
    body.bank=bankAt(body.age);
    body.angle=body.heading+yawAt(body.age);
    const shots=[],eligible=assignTargets(body,players);
    for(let i=0;i<body.turrets.length;i++){
      const turret=body.turrets[i],p=pivot(body,i),target=eligible.find(p=>p.index===turret.target);
      const distance=target?Math.hypot(target.x-p.x,target.y-p.y):0,lead=Math.min(1.25,distance/SHOT_SPEED);
      let aim=target;
      if(target){const predicted={x:target.x+(Number(target.vx)||0)*lead,y:target.y+(Number(target.vy)||0)*lead};if(canTarget(body,i,predicted))aim=predicted;}
      const desired=aim?Math.atan2(aim.y-p.y,aim.x-p.x):Math.atan2(p.y-body.y,p.x-body.x)+Math.sin(body.age*.32+i)*.12;
      const turn=angleDelta(turret.angle,desired),limit=1.65*dt;
      turret.angle+=Math.max(-limit,Math.min(limit,turn));
      turret.aligned=!!target&&Math.abs(angleDelta(turret.angle,desired))<=.10;
    }
    if(body.age>=body.nextVolley)for(let offset=0;offset<firingTurrets.length;offset++){
      const slot=(body.fireCursor+offset)%firingTurrets.length,i=firingTurrets[slot],turret=body.turrets[i];
      if(!turret.aligned||body.age<turret.nextShot)continue;
      const origins=[muzzle(body,i,0),muzzle(body,i,1)];
      if(origins.some(o=>o.x<4||o.x>W-4||o.y<4||o.y>H-4))continue;
      for(const origin of origins)shots.push({id:uid(),owner:-2,mothership:true,x:origin.x,y:origin.y,px:origin.x,py:origin.y,vx:Math.cos(turret.angle)*SHOT_SPEED,vy:Math.sin(turret.angle)*SHOT_SPEED,age:0,travel:0,guided:false});
      turret.nextShot=body.age+SHOT_INTERVAL;body.nextVolley=body.age+VOLLEY_GAP;body.fireCursor=(slot+1)%firingTurrets.length;
      break;
    }
    return {shots,active:body.vx>0?body.x<W+data.radius+40:body.x>-data.radius-40};
  }
  function shape(cache,key,profile,x,y,scale,angle){
    let value=cache.get(key);
    if(!value||value.profile!==profile){
      const points=profile.outline.map(()=>({x:0,y:0}));
      const part=ids=>({points:ids.map(i=>points[i]),axes:ids.map(()=>({x:0,y:0}))});
      value={profile,points,parts:profile.pieces.map(part),full:part(points.map((_,i)=>i))};value.all=[value.full,...value.parts];cache.set(key,value);
    }
    if(value.x===x&&value.y===y&&value.scale===scale&&value.angle===angle)return value;
    value.x=x;value.y=y;value.scale=scale;value.angle=angle;const c=Math.cos(angle),s=Math.sin(angle);
    for(let i=0;i<value.points.length;i++){const p=profile.outline[i];value.points[i].x=x+scale*(p[0]*c-p[1]*s);value.points[i].y=y+scale*(p[0]*s+p[1]*c);}
    for(const part of value.all){
      part.minX=part.minY=Infinity;part.maxX=part.maxY=-Infinity;
      for(let i=0;i<part.points.length;i++){
        const a=part.points[i],b=part.points[(i+1)%part.points.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
        part.axes[i].x=dy/len;part.axes[i].y=-dx/len;
        part.minX=Math.min(part.minX,a.x);part.maxX=Math.max(part.maxX,a.x);part.minY=Math.min(part.minY,a.y);part.maxY=Math.max(part.maxY,a.y);
      }
    }
    return value;
  }
  function apart(a,b){return a.maxX<=b.minX||b.maxX<=a.minX||a.maxY<=b.minY||b.maxY<=a.minY;}
  function convexContact(a,b){
    if(apart(a,b))return null;let depth=Infinity,nx=1,ny=0;
    for(const axes of [a.axes,b.axes])for(const n of axes){
      let minA=Infinity,maxA=-Infinity,minB=Infinity,maxB=-Infinity;
      for(const p of a.points){const d=p.x*n.x+p.y*n.y;minA=Math.min(minA,d);maxA=Math.max(maxA,d);}
      for(const p of b.points){const d=p.x*n.x+p.y*n.y;minB=Math.min(minB,d);maxB=Math.max(maxB,d);}
      const forward=maxA-minB,backward=maxB-minA;
      if(forward<=1e-7||backward<=1e-7)return null;
      if(Math.min(forward,backward)<depth){depth=Math.min(forward,backward);const sign=forward<backward?1:-1;nx=n.x*sign;ny=n.y*sign;}
    }
    return {depth,nx,ny};
  }
  function hullProfile(body){return data.bankProfiles?data.bankProfiles[Math.max(0,Math.min(data.bankProfiles.length-1,Math.round((Number(body.bank)||0)*180/Math.PI)+Math.floor(data.bankProfiles.length/2)))]:data.profiles[0];}
  function hullShape(body){return shape(hullCache,body,hullProfile(body),body.x,body.y,1,body.angle);}
  function contact(body,other,kind='rock'){
    const radius=kind==='ship'?physics.shipCollisionRadius(other):Number(other.r)||45;
    if(Math.hypot(other.x-body.x,other.y-body.y)>data.radius+radius+1)return null;
    if(kind==='ship'&&other.shield>0)return circleContact(body,other,radius);
    if(kind==='rock'&&!physics.isMediumRock(other))return circleContact(body,other,radius);
    const a=hullShape(body),pose=kind==='ship'?physics.shipPose(other):null;
    const profile=pose?physics.shipProfile(pose):physics.mediumProfile(other);
    const angle=pose?-pose.rot:-physics.mediumRotation(other.x,other.y,other.id);
    const b=shape(pose?shipCache:rockCache,other,profile,other.x,other.y,pose?1:radius,angle);
    if(apart(a.full,b.full))return null;let best=null;
    for(const pa of a.parts){
      if(apart(pa,b.full))continue;
      for(const pb of b.parts){const hit=convexContact(pa,pb);if(hit&&(!best||hit.depth>best.depth))best=hit;}
    }
    return best;
  }
  function surface(body,x,y){
    const points=hullShape(body).points;let inside=false,best=Infinity,px=0,py=0,nx=1,ny=0;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
      if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(len||1))),qx=a.x+dx*t,qy=a.y+dy*t,d2=(x-qx)**2+(y-qy)**2;
      if(d2<best){best=d2;px=qx;py=qy;const l=Math.sqrt(len)||1;nx=dy/l;ny=-dx/l;}
    }
    const d=Math.sqrt(best);if(d>1e-9){nx=(x-px)/d*(inside?-1:1);ny=(y-py)/d*(inside?-1:1);}
    return {x:px,y:py,nx,ny,distance:(inside?-d:d)};
  }
  function circleContact(body,other,radius){
    if(Math.hypot(other.x-body.x,other.y-body.y)>data.radius+radius+1)return null;
    const hit=surface(body,other.x,other.y);return hit.distance<radius?{...hit,depth:radius-hit.distance}:null;
  }
  function separate(body,other,kind='rock'){
    let hit=contact(body,other,kind);if(!hit)return null;
    let nx=hit.nx,ny=hit.ny;
    for(let pass=0;pass<16&&hit;pass++){
      nx=hit.nx;ny=hit.ny;other.x+=nx*(hit.depth+.3);other.y+=ny*(hit.depth+.3);hit=contact(body,other,kind);
    }
    // Pathological initial overlaps use the true hull boundary, never the bounding circle.
    if(hit){const edge=surface(body,other.x,other.y),radius=kind==='ship'?physics.shipCollisionRadius(other):Number(other.r)||45;nx=edge.nx;ny=edge.ny;other.x=edge.x+nx*(radius+1);other.y=edge.y+ny*(radius+1);}
    const closing=((Number(other.vx)||0)-body.vx)*nx+((Number(other.vy)||0)-body.vy)*ny;
    if(closing<0){other.vx-=1.84*closing*nx;other.vy-=1.84*closing*ny;}
    const max=kind==='ship'?350:190,speed=Math.hypot(other.vx,other.vy);if(speed>max){other.vx*=max/speed;other.vy*=max/speed;}
    // A correction is not a travelled sweep through unrelated objects.
    other.px=other.x;other.py=other.y;if(kind==='rock')physics.captureRockMotion(other);
    return {nx,ny,x:other.x,y:other.y};
  }
  function circleSweep(body,projectile,radius=4){
    const x0=Number.isFinite(projectile.px)?projectile.px:projectile.x,y0=Number.isFinite(projectile.py)?projectile.py:projectile.y;
    const gx=Number.isFinite(body.px)?body.px:body.x,gy=Number.isFinite(body.py)?body.py:body.y;
    const dx=projectile.x-x0-(body.x-gx),dy=projectile.y-y0-(body.y-gy),r=data.radius+radius;
    const bx=x0-gx,by=y0-gy,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,-(bx*dx+by*dy)/len)):0;
    if((bx+dx*t)**2+(by+dy*t)**2>r*r)return null;
    // Exact swept circle against each projected hull segment and endpoint.
    const a=rotate(bx,by,-body.angle),b=rotate(projectile.x-body.x,projectile.y-body.y,-body.angle),ux=b.x-a.x,uy=b.y-a.y,speed2=ux*ux+uy*uy;
    let first=Infinity,inside=false;const outline=hullProfile(body).outline;
    for(let i=0,j=outline.length-1;i<outline.length;j=i++){
      const p=outline[j],q=outline[i],vx=q[0]-p[0],vy=q[1]-p[1],length=Math.hypot(vx,vy);
      if((p[1]>a.y)!==(q[1]>a.y)&&a.x<vx*(a.y-p[1])/vy+p[0])inside=!inside;
      const along=Math.max(0,Math.min(1,((a.x-p[0])*vx+(a.y-p[1])*vy)/(length*length||1)));
      if(Math.hypot(a.x-p[0]-vx*along,a.y-p[1]-vy*along)<=radius)first=0;
      if(length>1e-9){const nx=vy/length,ny=-vx/length,d0=(a.x-p[0])*nx+(a.y-p[1])*ny,dv=ux*nx+uy*ny;if(Math.abs(dv)>1e-9)for(const side of [-1,1]){const at=(side*radius-d0)/dv,u=((a.x+ux*at-p[0])*vx+(a.y+uy*at-p[1])*vy)/(length*length);if(at>=0&&at<=1&&u>=0&&u<=1)first=Math.min(first,at);}}
      if(speed2>1e-9){const qx=a.x-p[0],qy=a.y-p[1],bb=2*(qx*ux+qy*uy),cc=qx*qx+qy*qy-radius*radius,disc=bb*bb-4*speed2*cc;if(disc>=0){const at=(-bb-Math.sqrt(disc))/(2*speed2);if(at>=0&&at<=1)first=Math.min(first,at);}}
    }
    if(inside)first=0;
    return Number.isFinite(first)?{t:first,x:x0+(projectile.x-x0)*first,y:y0+(projectile.y-y0)*first}:null;
  }
  window.GalaxyMothership=Object.freeze({data,create,pivot,muzzle,step,contact,separate,surface,circleSweep,hullProfile,bankAt,yawAt,yawFor,canTarget,assignTargets,BANK_LIMIT,BANK_PERIOD,YAW_LIMIT,YAW_PERIOD,SHOT_SPEED,SHOT_INTERVAL,VOLLEY_GAP});
})();
