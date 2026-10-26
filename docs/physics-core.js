'use strict';
(() => {
  const TARGET_MIN_ALIGN=.8660254038; // cos(30 grados)
  // Shared linear scale for the giant artwork, its concave contacts and rendering.
  const GIANT_RADIUS=189,GIANT_DIAMETER=GIANT_RADIUS*2;
  const MEDIUM_ROCK_RADII=Object.freeze([51.75,59.513,67.275]);
  function mediumRockRadius(id){
    // Stable birth variation uses the existing ID, without consuming another
    // random number or changing the spawn/calendar random sequence.
    const roll=(Math.imul((Number(id)||0)>>>0,0x9e3779b1)>>>0)/4294967296;
    return MEDIUM_ROCK_RADII[Math.floor(roll*MEDIUM_ROCK_RADII.length)];
  }
  const PROFILE_DATA=window.GalaxyCollisionProfiles;
  if(!PROFILE_DATA)throw new Error('Collision profiles not loaded');
  const profileCache={ship:[],medium:[]},SHIP_BANK_LIMIT=Math.PI/3;
  function collisionProfile(kind,index){
    const list=PROFILE_DATA[kind];index=Math.max(0,Math.min(list.length-1,index));
    if(!profileCache[kind][index]){
      const [flat,pieces]=list[index],scale=kind==='ship'?.01:.0001,outline=[];
      for(let i=0;i<flat.length;i+=2)outline.push([flat[i]*scale,flat[i+1]*scale]);
      profileCache[kind][index]={outline,pieces};
    }
    return profileCache[kind][index];
  }
  function shipTilt(bank=0,time,index=0,motionSpeed=0){
    if(!Number.isFinite(time))return {pitch:0,roll:bank};
    const phase=(Number(index)||0)*1.7,weight=1-Math.min(1,Math.abs(bank)/SHIP_BANK_LIMIT);
    const moving=Math.max(0,Math.min(1,((Number(motionSpeed)||0)-2)/70)),blend=moving*moving*(3-2*moving);
    const sway=Math.sin(time*.7+phase)*5*(1-blend)+Math.sin(time+phase)*1.2*blend;
    return {pitch:Math.sin(time*.8+phase+.7)*.6*Math.PI/180*weight,roll:bank+sway*Math.PI/180*weight};
  }
  function shipProfile(pose){
    const tilt=shipTilt(pose.bank,pose.time,pose.index,pose.motionSpeed);
    return collisionProfile('ship',Math.round(tilt.roll*180/Math.PI)+60);
  }
  const outerHulls=new WeakMap(),outerShips=new WeakMap(),outerRocks=new WeakMap();
  function outerHull(outline){
    let hull=outerHulls.get(outline);if(hull)return hull;
    const sorted=outline.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=points=>{const result=[];for(const p of points){while(result.length>1&&cross(result[result.length-2],result[result.length-1],p)<=0)result.pop();result.push(p);}return result;};
    const lower=half(sorted),upper=half(sorted.slice().reverse());lower.pop();upper.pop();
    const points=lower.concat(upper),axes=points.map((a,i)=>{const b=points[(i+1)%points.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1;return {x:dy/length,y:-dx/length};});
    hull={points,axes};outerHulls.set(outline,hull);return hull;
  }
  function outerShape(cache,body,outline,x,y,radius,angle){
    let shape=cache.get(body);
    if(!shape||shape.outline!==outline){
      const hull=outerHull(outline);
      if(!shape){shape={points:[],axes:[]};cache.set(body,shape);}
      shape.outline=outline;shape.hull=hull;shape.x=undefined;
      while(shape.points.length<hull.points.length)shape.points.push({x:0,y:0});
      while(shape.axes.length<hull.axes.length)shape.axes.push({x:0,y:0});
      shape.points.length=hull.points.length;shape.axes.length=hull.axes.length;
    }
    if(shape.x===x&&shape.y===y&&shape.radius===radius&&shape.angle===angle)return shape;
    shape.x=x;shape.y=y;shape.radius=radius;shape.angle=angle;shape.minX=shape.minY=Infinity;shape.maxX=shape.maxY=-Infinity;
    const c=Math.cos(angle),s=Math.sin(angle);
    for(let i=0;i<shape.points.length;i++){
      const [px,py]=shape.hull.points[i],p=shape.points[i],n=shape.hull.axes[i],axis=shape.axes[i];
      p.x=x+radius*(px*c+py*s);p.y=y+radius*(-px*s+py*c);axis.x=n.x*c+n.y*s;axis.y=-n.x*s+n.y*c;
      if(p.x<shape.minX)shape.minX=p.x;if(p.x>shape.maxX)shape.maxX=p.x;if(p.y<shape.minY)shape.minY=p.y;if(p.y>shape.maxY)shape.maxY=p.y;
    }
    return shape;
  }
  function outerShip(ship,pose){return outerShape(outerShips,ship,shipProfile(pose).outline,pose.x,pose.y,1,pose.rot);}
  function outerRock(rock,radius,kind){
    if(!kind&&!isMediumRock(rock,radius))return null;
    const giant=kind==='giant',outline=giant?GIANT_OUTLINE:mediumProfile(rock).outline,angle=giant?giantRotation(rock.x,rock.y):mediumRotation(rock.x,rock.y,rock.id);
    return outerShape(outerRocks,rock,outline,rock.x,rock.y,radius,angle);
  }
  function outerOverlap(a,b,skin=0){
    if(separatedBounds(a,b,skin))return false;
    // With one box completely inside the other, let the original narrow
    // phase handle the likely contact instead of projecting a second hull.
    if((a.minX<=b.minX&&a.maxX>=b.maxX&&a.minY<=b.minY&&a.maxY>=b.maxY)||
       (b.minX<=a.minX&&b.maxX>=a.maxX&&b.minY<=a.minY&&b.maxY>=a.maxY))return true;
    // True convex envelopes contain every concave piece. Reject only a clear
    // separating axis; the original narrow phase decides contact and response.
    for(const axes of [a.axes,b.axes])for(const n of axes){
      let minA=Infinity,maxA=-Infinity,minB=Infinity,maxB=-Infinity;
      for(const p of a.points){const d=p.x*n.x+p.y*n.y;if(d<minA)minA=d;if(d>maxA)maxA=d;}
      for(const p of b.points){const d=p.x*n.x+p.y*n.y;if(d<minB)minB=d;if(d>maxB)maxB=d;}
      if(maxA<minB-skin-1e-7||maxB<minA-skin-1e-7)return false;
    }
    return true;
  }
  function mediumProfile(rock){
    if(!Number.isFinite(rock.spin))return {outline:MEDIUM_OUTLINE,pieces:MEDIUM_PIECES};
    const phase=((rock.spin%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
    return collisionProfile('medium',Math.round(phase/(Math.PI*2)*PROFILE_DATA.mediumSteps)%PROFILE_DATA.mediumSteps);
  }
  function mediumQuaternion(spin,yaw){
    const length=Math.hypot(.61,.73,.31),s=Math.sin(spin*.5),c=Math.cos(spin*.5),z=Math.sin(yaw*.5),w=Math.cos(yaw*.5);
    const x=.61/length*s,y=.73/length*s;
    return {x:w*x-z*y,y:w*y+z*x,z:w*.31/length*s+z*c,w:w*c-z*.31/length*s};
  }
  function advanceRockPose(rock,dt){
    rock.pspin=Number.isFinite(rock.spin)?rock.spin:((Number(rock.id)||0)*.61803398875)%(Math.PI*2);
    rock.spin=(rock.pspin+.18*dt)%(Math.PI*2);
  }
  function stepAsteroidExit(rock,dt,width=1920,height=1080){
    if(!rock||!rock.exiting||!Number.isFinite(dt)||dt<=0)return;
    const vx=Number.isFinite(rock.vx)?rock.vx:0,vy=Number.isFinite(rock.vy)?rock.vy:0,speed=Math.hypot(vx,vy);
    let nx,ny;
    if(speed>1e-8){nx=vx/speed;ny=vy/speed;}
    else{
      // A stationary rock has no heading to preserve. Choose its nearest edge
      // deterministically and start with the same bounded acceleration.
      const distances=[rock.x,width-rock.x,rock.y,height-rock.y],edge=distances.indexOf(Math.min(...distances));
      nx=edge===0?-1:edge===1?1:0;ny=edge===2?-1:edge===3?1:0;
    }
    const change=30*dt,next=speed<90?Math.min(90,speed+change):Math.max(90,speed-change);
    rock.vx=nx*next;rock.vy=ny*next;
  }
  const rockMotionPaths=new WeakMap();
  function captureRockMotion(rock){
    // Called once after integration. Separating overlapping bodies is an
    // instantaneous correction, not a flight through every intervening point.
    const path={px:rock.px,py:rock.py,pspin:rock.pspin,spin:rock.spin,
      startX:Number.isFinite(rock.px)?rock.px:rock.x,startY:Number.isFinite(rock.py)?rock.py:rock.y,
      endX:rock.x,endY:rock.y,finalX:rock.x,finalY:rock.y};
    rockMotionPaths.set(rock,path);return path;
  }
  function rockMotionPath(rock){
    const path=rockMotionPaths.get(rock);
    if(path&&path.px===rock.px&&path.py===rock.py&&path.pspin===rock.pspin&&path.spin===rock.spin&&path.finalX===rock.x&&path.finalY===rock.y)return path;
    return {startX:Number.isFinite(rock.px)?rock.px:rock.x,startY:Number.isFinite(rock.py)?rock.py:rock.y,endX:rock.x,endY:rock.y,finalX:rock.x,finalY:rock.y};
  }
  function beginRockCorrection(rock){
    const path=rockMotionPath(rock);
    if(path===rockMotionPaths.get(rock))return;
    captureRockMotion(rock);
  }
  function finishRockCorrection(rock){
    const path=rockMotionPaths.get(rock);
    if(path){path.finalX=rock.x;path.finalY=rock.y;}
  }
  // Unbanked silhouette of nave.glb, normalized by ship-model.js and drawn at 1.5x.
  // Model blob 260239810997421b964a1613d7b58d88461b3170; outline tolerance <1 unit.
  const SHIP_DRAW_SIZE=72,SHIP_PROJECTILE_RADIUS=49;
  const SHIP_PROJECTILE_HULL=Object.freeze([
    [-.5,-46.5],[.5,-46.5],[1.5,-45.25],[4,-39],[6.75,-27.25],
    [10.75,-15],[11,-12],[14.25,-3.5],[16.5,5.75],[28.25,11.5],
    [36.5,13.75],[37.75,14.5],[38.5,16],[37.75,22],[36.5,23.25],
    [31.75,25.25],[23.75,27.25],[17.25,30],[16,31.5],[15,31.75],
    [15,37.5],[14.75,38.5],[13.25,39.25],[13.75,45.5],[13.25,46.25],
    [11.5,46.5],[7.25,46],[-13.25,46.25],[-14,44.5],[-13.25,39.25],
    [-14.75,38.5],[-15.25,31.5],[-17.5,29.75],[-23.25,27.5],[-35.25,24],
    [-37.25,22.75],[-38.5,19.5],[-38.5,17],[-37.5,14.25],[-28,11.25],
    [-16.75,6],[-14.25,-3.25],[-11,-11.75],[-10.25,-16.5],[-7.5,-24.25],[-3.75,-39.75]
  ].map(Object.freeze));
  const SHIP_CONTACT_SKIN=.9; // less than one arena unit; covers the GLB outline rounding
  function pointSegmentDistance2(x,y,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay,length2=dx*dx+dy*dy;
    const t=length2>1e-12?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length2)):0;
    const qx=x-ax-dx*t,qy=y-ay-dy*t;return qx*qx+qy*qy;
  }
  function projectileHitsShipHull(projectile,ship,radius=4){
    return !!shipHitsCircle(ship,projectile,radius);
  }

  const shipShapeCache=new WeakMap();
  function shipPose(ship){return {x:ship.x,y:ship.y,rot:(Number(ship.rot)||0)*Math.PI/180,bank:Number(ship.bank)||0,time:ship.poseTime,index:ship.index,motionSpeed:Math.hypot(Number(ship.vx)||0,Number(ship.vy)||0)};}
  function shipShape(ship,pose){
    const profile=shipProfile(pose),outline=profile.outline;
    let shape=shipShapeCache.get(ship);
    if(!shape||shape.profile!==profile){
      const points=outline.map(()=>({x:0,y:0}));
      const part=list=>({points:list.map(i=>points[i]),axes:list.map(()=>({x:0,y:0}))});
      shape={profile,points,parts:profile.pieces.map(part),full:part(points.map((_,i)=>i))};
      shape.allParts=[...shape.parts,shape.full];shipShapeCache.set(ship,shape);
    }
    if(shape.x===pose.x&&shape.y===pose.y&&shape.rot===pose.rot)return shape;
    shape.x=pose.x;shape.y=pose.y;shape.rot=pose.rot;
    const c=Math.cos(pose.rot),s=Math.sin(pose.rot);
    for(let i=0;i<shape.points.length;i++){
      const [x,y]=outline[i];shape.points[i].x=pose.x+x*c+y*s;shape.points[i].y=pose.y-x*s+y*c;
    }
    for(const part of shape.allParts){
      part.minX=part.minY=Infinity;part.maxX=part.maxY=-Infinity;
      for(let i=0;i<part.points.length;i++){
        const a=part.points[i],b=part.points[(i+1)%part.points.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
        part.axes[i].x=dy/length;part.axes[i].y=-dx/length;
        part.minX=Math.min(part.minX,a.x);part.maxX=Math.max(part.maxX,a.x);part.minY=Math.min(part.minY,a.y);part.maxY=Math.max(part.maxY,a.y);
      }
    }
    return shape;
  }
  function shipSurface(pose,x,y){return outlineSurface(pose,x,y,1,shipProfile(pose).outline,()=>pose.rot);}
  function shipPartContact(a,b,skin){
    const contact=convexContact(a,b,skin);if(!contact||contact.depth>0)return contact;
    // A padded SAT alone would lengthen a very sharp nose. Check Euclidean
    // distance so the tolerance stays below one unit even at those tips.
    let best=skin*skin,first=null,second=null;
    for(let side=0;side<2;side++){
      const vertices=side?b.points:a.points,edges=side?a.points:b.points;
      for(const p of vertices)for(let i=0;i<edges.length;i++){
        const u=edges[i],v=edges[(i+1)%edges.length],dx=v.x-u.x,dy=v.y-u.y,len=dx*dx+dy*dy;
        const t=len?Math.max(0,Math.min(1,((p.x-u.x)*dx+(p.y-u.y)*dy)/len)):0,q={x:u.x+dx*t,y:u.y+dy*t};
        const distance=(p.x-q.x)**2+(p.y-q.y)**2;
        if(distance<=best){best=distance;first=side?q:p;second=side?p:q;}
      }
    }
    if(!first)return null;
    const length=Math.sqrt(best);
    return {depth:0,nx:length>1e-8?(second.x-first.x)/length:contact.nx,ny:length>1e-8?(second.y-first.y)/length:contact.ny,x:(first.x+second.x)/2,y:(first.y+second.y)/2};
  }
  function shipContactAt(a,pa,b,pb,skin=SHIP_CONTACT_SKIN){
    const shieldA=Number(a.shield)>0,shieldB=Number(b.shield)>0;
    const ra=shieldA?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS,rb=shieldB?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS;
    const dx=pb.x-pa.x,dy=pb.y-pa.y,d=Math.hypot(dx,dy);
    if(d>ra+rb+skin)return null;
    if(shieldA&&shieldB){
      const nx=d?dx/d:1,ny=d?dy/d:0;
      return {nx,ny,depth:Math.max(0,ra+rb-d),x:pa.x+nx*ra,y:pa.y+ny*ra};
    }
    if(shieldA||shieldB){
      const circle=shieldA?pa:pb,hull=shieldA?pb:pa,hit=shipSurface(hull,circle.x,circle.y),radius=SHIELD_RADIUS;
      if(hit.distance>radius+skin)return null;
      return {...hit,nx:hit.nx*(shieldA?-1:1),ny:hit.ny*(shieldA?-1:1),depth:Math.max(0,radius-hit.distance)};
    }
    if(!outerOverlap(outerShip(a,pa),outerShip(b,pb),skin))return null;
    const sa=shipShape(a,pa),sb=shipShape(b,pb);let best=null;
    if(separatedBounds(sa.full,sb.full,skin))return null;
    for(const ca of sa.parts){
      if(separatedBounds(ca,sb.full,skin))continue;
      for(const cb of sb.parts){const hit=shipPartContact(ca,cb,skin);if(hit&&(!best||hit.depth>best.depth))best=hit;}
    }
    return best?{...best,depth:Math.max(0,best.depth)}:null;
  }
  function shipMotion(ship){
    const current=shipPose(ship);
    let x=Number.isFinite(ship.px)?ship.px:ship.x,y=Number.isFinite(ship.py)?ship.py:ship.y;
    let rot=(Number.isFinite(ship.pr)?ship.pr:Number(ship.rot)||0)*Math.PI/180;
    // Crossing the screen edge is a teleport, never a collision sweep across the arena.
    if(Math.abs(ship.x-x)>960||Math.abs(ship.y-y)>540){x=ship.x;y=ship.y;rot=current.rot;}
    const turn=Math.atan2(Math.sin(current.rot-rot),Math.cos(current.rot-rot));
    const bank=Number.isFinite(ship.pbank)?ship.pbank:current.bank;
    const time=Number.isFinite(ship.previousPoseTime)?ship.previousPoseTime:ship.poseTime;
    return {x,y,rot,bank,time,index:ship.index,motionSpeed:current.motionSpeed,dx:ship.x-x,dy:ship.y-y,turn,dBank:current.bank-bank,dTime:Number.isFinite(time)?(Number(ship.poseTime)||0)-time:0};
  }
  function shipMotionPose(m,t){return {x:m.x+m.dx*t,y:m.y+m.dy*t,rot:m.rot+m.turn*t,bank:m.bank+m.dBank*t,time:Number.isFinite(m.time)?m.time+m.dTime*t:undefined,index:m.index,motionSpeed:m.motionSpeed};}
  function shipHitsCircle(ship,body,radius,swept=true){
    if(!ship||!body)return null;
    const motion=shipMotion(ship);
    let bx=Number.isFinite(body.px)?body.px:body.x,by=Number.isFinite(body.py)?body.py:body.y;
    if(Math.abs(body.x-bx)>960||Math.abs(body.y-by)>540){bx=body.x;by=body.y;}
    const shield=Number(ship.shield)>0,bound=shield?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS;
    if(pointSegmentDistance2(0,0,bx-motion.x,by-motion.y,body.x-ship.x,body.y-ship.y)>(bound+radius+1)**2)return null;
    const steps=swept?Math.max(1,Math.ceil(bound*(Math.abs(motion.turn)+Math.abs(motion.dBank))/.35)):1;
    for(let i=0;i<steps;i++){
      const t0=swept?i/steps:1,t1=swept?(i+1)/steps:1,mid=shipMotionPose(motion,(t0+t1)*.5),c=Math.cos(mid.rot),s=Math.sin(mid.rot);
      const local=t=>{const p=shipMotionPose(motion,t),x=bx+(body.x-bx)*t-p.x,y=by+(body.y-by)*t-p.y;return [x*c-y*s,x*s+y*c];};
      const start=local(t0),end=local(t1);let t;
      if(shield){
        const dx=end[0]-start[0],dy=end[1]-start[1],rr=bound+radius,a=dx*dx+dy*dy,b=2*(start[0]*dx+start[1]*dy),cc=start[0]**2+start[1]**2-rr*rr,disc=b*b-4*a*cc;
        t=cc<=0?0:a>1e-15&&disc>=0?(-b-Math.sqrt(disc))/(2*a):Infinity;
        if(t<0||t>1)t=Infinity;
      }else t=outlineSegmentTime(...start,...end,radius+.65,shipProfile(mid).outline);
      if(Number.isFinite(t)){
        const at=t0+(t1-t0)*t,pose=shipMotionPose(motion,at),x=bx+(body.x-bx)*at,y=by+(body.y-by)*at;
        if(shield){const d=Math.hypot(x-pose.x,y-pose.y)||1,nx=(x-pose.x)/d,ny=(y-pose.y)/d;return {x:pose.x+nx*bound,y:pose.y+ny*bound,nx,ny,t:at};}
        return {...shipSurface(pose,x,y),t:at};
      }
    }
    return null;
  }
  function shipPairContact(a,b,swept=true){
    if(!a||!b||a.dead||b.dead)return null;
    const ma=shipMotion(a),mb=shipMotion(b);
    const ra=Number(a.shield)>0?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS,rb=Number(b.shield)>0?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS;
    if(pointSegmentDistance2(0,0,ma.x-mb.x,ma.y-mb.y,a.x-b.x,a.y-b.y)>(ra+rb+SHIP_CONTACT_SKIN)**2)return null;
    const current=shipContactAt(a,shipPose(a),b,shipPose(b));if(current)return {...current,t:1};
    if(!swept)return null;
    const motion=Math.hypot(ma.dx-mb.dx,ma.dy-mb.dy)+(a.shield>0?0:ra*(Math.abs(ma.turn)+Math.abs(ma.dBank)))+(b.shield>0?0:rb*(Math.abs(mb.turn)+Math.abs(mb.dBank)));
    // Vertex motion stays below half a unit; the contact skin also covers the
    // <0.3-unit rounding error of each outline, including the very narrow nose.
    const steps=Math.ceil(motion/.5);
    for(let i=0;i<steps;i++){
      const t=i/steps,hit=shipContactAt(a,shipMotionPose(ma,t),b,shipMotionPose(mb,t));
      if(hit)return {...hit,t};
    }
    return null;
  }
  function moveShipsToContact(a,b,contact){
    if(!contact||contact.t>=1)return;
    const pa=shipMotionPose(shipMotion(a),contact.t),pb=shipMotionPose(shipMotion(b),contact.t);
    a.x=pa.x;a.y=pa.y;b.x=pb.x;b.y=pb.y;
  }
  function separateShipPair(a,b,contact){
    const initial=contact||shipPairContact(a,b);if(!initial)return {x:1,y:0};
    let hit=shipContactAt(a,shipPose(a),b,shipPose(b)),nx=initial.nx,ny=initial.ny;
    for(let pass=0;pass<12&&hit;pass++){
      const correction=(hit.depth+SHIP_CONTACT_SKIN+.2)*.5;nx=hit.nx;ny=hit.ny;
      a.x-=nx*correction;a.y-=ny*correction;b.x+=nx*correction;b.y+=ny*correction;
      hit=shipContactAt(a,shipPose(a),b,shipPose(b));
    }
    if(hit){
      const sa=a.shield>0?null:shipShape(a,shipPose(a)),sb=b.shield>0?null:shipShape(b,shipPose(b));
      const full=sa&&sb?convexContact(sa.full,sb.full):null;
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
      nx=full?full.nx:d?dx/d:1;ny=full?full.ny:d?dy/d:0;
      const correction=((full?full.depth:2*SHIELD_RADIUS-d)+SHIP_CONTACT_SKIN+1)*.5;
      a.x-=nx*correction;a.y-=ny*correction;b.x+=nx*correction;b.y+=ny*correction;
    }
    return {x:-nx,y:-ny};
  }

  // Rocky_Asteroid_5.glb: XY silhouette extracted from its normalized mesh.
  // 111 concave contour points; raster/RDP tolerance <1 arena unit at GIANT_RADIUS.
  // Fixed out-of-plane pose lets authority, clients and 2D fallback share the exact outline.
  const GIANT_OUTLINE=Object.freeze([
    [0.131429,-0.62],[0.261429,-0.605714],[0.275714,-0.595714],[0.312857,-0.587143],
    [0.334286,-0.575714],[0.405714,-0.522857],[0.471429,-0.445714],[0.482857,-0.424286],
    [0.58,-0.445714],[0.597143,-0.445714],[0.634286,-0.422857],[0.68,-0.422857],
    [0.705714,-0.431429],[0.738571,-0.387143],[0.79,-0.361429],[0.808571,-0.344286],
    [0.81,-0.335714],[0.807143,-0.282857],[0.801429,-0.267143],[0.807143,-0.235714],
    [0.804286,-0.098571],[0.837143,-0.061429],[0.847143,-0.058571],[0.862857,-0.041429],
    [0.877143,-0.01],[0.907143,0.025714],[0.9,0.041429],[0.875714,0.07],
    [0.842857,0.092857],[0.811429,0.134286],[0.77,0.14],[0.694286,0.12],
    [0.674286,0.122857],[0.671429,0.134286],[0.641429,0.161429],[0.601429,0.215714],
    [0.575714,0.24],[0.537143,0.298571],[0.502857,0.314286],[0.49,0.327143],
    [0.481429,0.371429],[0.5,0.385714],[0.502857,0.412857],[0.501429,0.435714],
    [0.49,0.447143],[0.461429,0.451429],[0.421429,0.41],[0.378571,0.378571],
    [0.338571,0.38],[0.18,0.485714],[0.171429,0.5],[0.174286,0.564286],
    [0.147143,0.581429],[0.094286,0.582857],[0.038571,0.554286],[-0.02,0.565714],
    [-0.04,0.578571],[-0.098571,0.594286],[-0.147143,0.6],[-0.174286,0.62],
    [-0.197143,0.598571],[-0.208571,0.577143],[-0.211429,0.56],[-0.234286,0.512857],
    [-0.242857,0.452857],[-0.257143,0.44],[-0.277143,0.457143],[-0.285714,0.497143],
    [-0.301429,0.512857],[-0.341429,0.528571],[-0.375714,0.522857],[-0.407143,0.53],
    [-0.471429,0.531429],[-0.491429,0.54],[-0.504286,0.53],[-0.515714,0.53],
    [-0.535714,0.507143],[-0.591429,0.477143],[-0.602857,0.41],[-0.71,0.358571],
    [-0.75,0.324286],[-0.777143,0.288571],[-0.811429,0.217143],[-0.811429,0.19],
    [-0.847143,0.124286],[-0.848571,0.077143],[-0.838571,0.007143],[-0.854286,0.001429],
    [-0.891429,-0.057143],[-0.887143,-0.128571],[-0.907143,-0.184286],[-0.868571,-0.325714],
    [-0.842857,-0.344286],[-0.828571,-0.374286],[-0.767143,-0.374286],[-0.76,-0.404286],
    [-0.748571,-0.415714],[-0.74,-0.441429],[-0.705714,-0.445714],[-0.672857,-0.461429],
    [-0.658571,-0.481429],[-0.541429,-0.545714],[-0.474286,-0.561429],[-0.408571,-0.555714],
    [-0.362857,-0.542857],[-0.337143,-0.544286],[-0.247143,-0.557143],[-0.19,-0.575714],
    [-0.135714,-0.581429],[-0.031429,-0.61],[0.07,-0.611429]
  ].map(Object.freeze));
  // asteroidemediano.glb: normalized XY outline, <0.7 arena-unit extraction tolerance at r=45.
  const MEDIUM_OUTLINE=Object.freeze([
    [0.02,-0.764286],[0.152857,-0.721429],[0.35,-0.538571],[0.715714,-0.305714],
    [0.821429,-0.16],[0.882857,-0.035714],[0.905714,0.074286],[0.882857,0.157143],
    [0.692857,0.377143],[0.621429,0.374286],[0.501429,0.548571],[0.265714,0.71],
    [0.08,0.762857],[-0.045714,0.745714],[-0.102857,0.764286],[-0.2,0.76],
    [-0.457143,0.677143],[-0.621429,0.41],[-0.735714,0.315714],[-0.772857,0.231429],
    [-0.881429,0.168571],[-0.907143,0.09],[-0.872857,-0.144286],[-0.84,-0.242857],
    [-0.768571,-0.331429],[-0.691429,-0.498571],[-0.557143,-0.628571],[-0.472857,-0.675714],
    [-0.318571,-0.677143],[-0.218571,-0.704286],[-0.145714,-0.748571]
  ].map(Object.freeze));
  const MEDIUM_PIECES=[[30,0,1,2],[30,2,3,4,5,6,7,8,9],[30,9,10,11,12,13],[30,13,14,15,16,17],[30,17,18,19],[30,19,20,21,22,23,24,29],[24,25,26,27,28],[24,28,29]];
  const GIANT_PIECES=[[110,0,1,2],[110,2,3,4,5,6,7],[7,8,9,10],[11,12,13],[10,11,13],[7,10,13,14,15,16,17,18],[110,7,18,19,20],[110,20,21],[21,22,23],[110,21,23,24],[110,24,25,26,27,28],[110,28,29,30,31],[110,31,32],[110,32,33,34],[110,34,35,36],[110,36,37,38],[110,38,39],[110,39,40],[40,41,42,43],[110,40,43,44,45,46],[110,46,47],[110,47,48],[110,48,49],[110,49,50],[110,50,51,52,53,54],[110,54,55],[110,55,56,57,58],[110,58,59,60,61,62],[110,62,63,64],[110,64,65],[110,65,66],[66,67,68],[110,66,68,69,70],[110,70,71,72],[110,72,73,74],[110,74,75,76],[110,76,77,78],[110,78,79,80,81,82,83],[110,83,84,85,86],[110,86,87,88,89],[110,89,90,91,92,94],[92,93,94],[110,94,95,96,98,99],[96,97,98],[110,99,100,106],[100,101,102,103,104],[100,104,105],[100,105,106],[106,107,108],[110,106,108],[108,109,110]];
  function mediumRotation(x,y,id=0){return (Number(x)||0)*.003+(Number(y)||0)*.002+(Number(id)||0)*.71;}
  function giantRotation(x,y){return (Number(x)||0)*.0015+(Number(y)||0)*.001;}
  function outlineSurface(g,x,y,radius,outline,angleAt){
    if(typeof outline==='function')outline=outline(g).outline;
    const angle=angleAt(g.x,g.y,g.id),c=Math.cos(angle),s=Math.sin(angle);
    const dx=(x-g.x)/radius,dy=(y-g.y)/radius;
    // Three is Y-up; arena coordinates are Y-down, so the visible yaw is -angle.
    const qx=dx*c-dy*s,qy=dx*s+dy*c;
    let inside=false,best=Infinity,px=0,py=0,nx=1,ny=0;
    for(let i=0,j=outline.length-1;i<outline.length;j=i++){
      const a=outline[j],b=outline[i],vx=b[0]-a[0],vy=b[1]-a[1],len=vx*vx+vy*vy;
      if((a[1]>qy)!==(b[1]>qy)&&qx<vx*(qy-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      const t=len?Math.max(0,Math.min(1,((qx-a[0])*vx+(qy-a[1])*vy)/len)):0;
      const ex=a[0]+t*vx,ey=a[1]+t*vy,d2=(qx-ex)**2+(qy-ey)**2;
      if(d2<best){best=d2;px=ex;py=ey;const length=Math.sqrt(len)||1;nx=vy/length;ny=-vx/length;}
    }
    const d=Math.sqrt(best);
    if(d>1e-9){nx=(qx-px)/d*(inside?-1:1);ny=(qy-py)/d*(inside?-1:1);}
    return {x:g.x+radius*(px*c+py*s),y:g.y+radius*(-px*s+py*c),nx:nx*c+ny*s,ny:-nx*s+ny*c,distance:(inside?-d:d)*radius};
  }
  function giantSurface(g,x,y,radius=GIANT_RADIUS){return outlineSurface(g,x,y,radius,GIANT_OUTLINE,giantRotation);}
  function giantCircleContact(g,body,bodyRadius,radius=GIANT_RADIUS){
    if(!g||!body)return null;
    if(Math.hypot(body.x-g.x,body.y-g.y)>radius+bodyRadius+1)return null;
    const hit=giantSurface(g,body.x,body.y,radius);
    return hit.distance<=bodyRadius+1e-6?{...hit,depth:bodyRadius-hit.distance}:null;
  }
  function outlineSegmentTime(x0,y0,x1,y1,r,outline){
    const ux=x1-x0,uy=y1-y0,speed2=ux*ux+uy*uy;let inside=false,first=Infinity;
    for(let i=0,j=outline.length-1;i<outline.length;j=i++){
      const a=outline[j],b=outline[i],ax=a[0],ay=a[1],vx=b[0]-ax,vy=b[1]-ay,length=Math.hypot(vx,vy);
      if((ay>y0)!==(b[1]>y0)&&x0<vx*(y0-ay)/vy+ax)inside=!inside;
      if(pointSegmentDistance2(x0,y0,ax,ay,b[0],b[1])<=r*r)return 0;
      if(length>1e-12){
        const nx=vy/length,ny=-vx/length,d0=(x0-ax)*nx+(y0-ay)*ny,dv=ux*nx+uy*ny;
        if(Math.abs(dv)>1e-12)for(const sign of [-1,1]){
          const t=(sign*r-d0)/dv,u=((x0+ux*t-ax)*vx+(y0+uy*t-ay)*vy)/(length*length);
          if(t>=0&&t<=1&&u>=0&&u<=1)first=Math.min(first,t);
        }
      }
      if(speed2>1e-18){
        const dx=x0-ax,dy=y0-ay,bq=2*(dx*ux+dy*uy),cq=dx*dx+dy*dy-r*r,disc=bq*bq-4*speed2*cq;
        if(disc>=0){const t=(-bq-Math.sqrt(disc))/(2*speed2);if(t>=0&&t<=1)first=Math.min(first,t);}
      }
    }
    return inside?0:first;
  }
  function outlineHitsCircle(g,body,bodyRadius,radius,outline,angleAt){
    if(!g||!body)return null;
    let bx=Number.isFinite(body.px)?body.px:body.x,by=Number.isFinite(body.py)?body.py:body.y;
    if(Math.abs(body.x-bx)>960||Math.abs(body.y-by)>540){bx=body.x;by=body.y;}
    const motion=rockMotionPath(g),gx=motion.startX,gy=motion.startY,ex=motion.endX,ey=motion.endY;
    const corrected=ex!==g.x||ey!==g.y;
    const finalContact=()=>{
      if(!corrected)return null;
      const hit=outlineSurface(g,body.x,body.y,radius,outline,angleAt);
      const skin=Number.isFinite(g.spin)?.35:0;
      return hit.distance<=bodyRadius+skin?{...hit,t:1}:null;
    };
    // Cheap broad phase around the relative motion segment, then concave contour sweep.
    if(pointSegmentDistance2(0,0,bx-gx,by-gy,body.x-ex,body.y-ey)>(radius+bodyRadius+1)**2)return finalContact();
    const oldAngle=angleAt(gx,gy,g.id),angle=angleAt(ex,ey,g.id);
    const spin=Number.isFinite(g.spin)?g.spin:undefined,oldSpin=Number.isFinite(g.pspin)?g.pspin:spin;
    const turn=Number.isFinite(spin)?Math.atan2(Math.sin(spin-oldSpin),Math.cos(spin-oldSpin)):0;
    const pieces=Math.max(1,Math.ceil((Math.abs(angle-oldAngle)+Math.abs(turn))/.008));
    const local=t=>{const a=oldAngle+(angle-oldAngle)*t,c=Math.cos(a),s=Math.sin(a),dx=(bx+(body.x-bx)*t-gx-(ex-gx)*t)/radius,dy=(by+(body.y-by)*t-gy-(ey-gy)*t)/radius;return [dx*c-dy*s,dx*s+dy*c];};
    let start=local(0);
    for(let i=1;i<=pieces;i++){
      const end=local(i/pieces),profilePose={...g,spin:Number.isFinite(spin)?oldSpin+turn*(i-.5)/pieces:undefined};
      const active=typeof outline==='function'?outline(profilePose).outline:outline;
      const t=outlineSegmentTime(...start,...end,(bodyRadius+(Number.isFinite(spin)?.35:0))/radius,active);
      if(Number.isFinite(t)){
        const at=(i-1+t)/pieces,pose={x:gx+(ex-gx)*at,y:gy+(ey-gy)*at,id:g.id,spin:Number.isFinite(spin)?oldSpin+turn*at:undefined};
        return {...outlineSurface(pose,bx+(body.x-bx)*at,by+(body.y-by)*at,radius,outline,angleAt),t:at};
      }
      start=end;
    }
    return finalContact();
  }
  function giantHitsCircle(g,body,bodyRadius,radius=GIANT_RADIUS){return outlineHitsCircle(g,body,bodyRadius,radius,GIANT_OUTLINE,giantRotation);}
  function separateGiantShipContact(ship,giant,contact){return separateRockShipContact(ship,giant,contact,true);}

  function isMediumRock(rock,defaultRadius=45){
    const radius=Number(rock&&rock.r)||defaultRadius;
    return !!rock&&rock.fragment!==true&&radius>30&&radius<100;
  }
  function mediumSurface(rock,x,y,radius=Number(rock.r)||45){return outlineSurface(rock,x,y,radius,mediumProfile,mediumRotation);}
  function rockShipContactAt(rock,ship,giant=false){
    const radius=giant?GIANT_RADIUS:Number(rock.r)||45;
    if(ship.shield>0)return giant?giantCircleContact(rock,ship,SHIELD_RADIUS):asteroidCircleContact(rock,ship,SHIELD_RADIUS);
    if(Math.hypot(rock.x-ship.x,rock.y-ship.y)>radius+SHIP_PROJECTILE_RADIUS+1)return null;
    const pose=shipPose(ship),kind=giant?'giant':undefined,outer=outerRock(rock,radius,kind);
    if(outer&&!outerOverlap(outer,outerShip(ship,pose),.75))return null;
    const rs=rockShape(rock,radius,kind),ss=shipShape(ship,pose);
    if(rs){
      if(separatedBounds(rs.full,ss.full,.75))return null;
      let best=null;
      for(const a of rs.parts){
        if(separatedBounds(a,ss.full,.75))continue;
        for(const b of ss.parts){const hit=shipPartContact(a,b,.75);if(hit&&(!best||hit.depth>best.depth))best=hit;}
      }
      return best?{...best,depth:Math.max(0,best.depth)}:null;
    }
    const hit=shipSurface(shipPose(ship),rock.x,rock.y);
    return hit.distance<=radius+.65?{...hit,nx:-hit.nx,ny:-hit.ny,depth:Math.max(0,radius-hit.distance)}:null;
  }
  function asteroidShipContact(rock,ship,giant=false,swept=true){
    if(!rock||!ship||ship.dead)return null;
    const m=shipMotion(ship),radius=giant?GIANT_RADIUS:Number(rock.r)||45,bound=ship.shield>0?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS;
    const current=rockShipContactAt(rock,ship,giant);if(current)return {...current,t:1};
    if(!swept)return null;
    const path=rockMotionPath(rock),rx=path.startX,ry=path.startY,ex=path.endX,ey=path.endY;
    if(pointSegmentDistance2(0,0,m.x-rx,m.y-ry,ship.x-ex,ship.y-ey)>(radius+bound+1)**2)return null;
    const spin=Number.isFinite(rock.spin)?rock.spin:undefined,oldSpin=Number.isFinite(rock.pspin)?rock.pspin:spin;
    const turn=Number.isFinite(spin)?Math.atan2(Math.sin(spin-oldSpin),Math.cos(spin-oldSpin)):0;
    const drx=ex-rx,dry=ey-ry,yawTurn=Math.abs((giant?giantRotation:mediumRotation)(ex,ey,rock.id)-(giant?giantRotation:mediumRotation)(rx,ry,rock.id));
    const travel=Math.hypot(m.dx-drx,m.dy-dry)+bound*(Math.abs(m.turn)+Math.abs(m.dBank))+radius*(Math.abs(turn)+yawTurn);
    const steps=Math.max(1,Math.ceil(travel/.4)),r={...rock},s={...ship};
    for(let i=0;i<steps;i++){
      const t=i/steps,pose=shipMotionPose(m,t);
      Object.assign(s,{x:pose.x,y:pose.y,rot:pose.rot*180/Math.PI,bank:pose.bank,poseTime:pose.time});
      Object.assign(r,{x:rx+drx*t,y:ry+dry*t,spin:Number.isFinite(spin)?oldSpin+turn*t:undefined});
      const hit=rockShipContactAt(r,s,giant);if(hit)return {...hit,t};
    }
    return null;
  }
  function separateRockShipContact(ship,rock,contact,giant=false){
    let hit=contact||asteroidShipContact(rock,ship,giant),nx=hit?hit.nx:1,ny=hit?hit.ny:0;
    if(!hit)return {x:nx,y:ny};
    if(hit.t<1){
      const pose=shipMotionPose(shipMotion(ship),hit.t),path=rockMotionPath(rock);
      ship.x=pose.x+(path.endX-path.startX)*(1-hit.t);ship.y=pose.y+(path.endY-path.startY)*(1-hit.t);
    }
    for(let pass=0;pass<20;pass++){
      hit=rockShipContactAt(rock,ship,giant);if(!hit)break;
      ship.x+=hit.nx*(hit.depth+.35);ship.y+=hit.ny*(hit.depth+.35);nx=hit.nx;ny=hit.ny;
    }
    // Fully separate unusual deep concave starting overlaps, without changing the rock.
    if(rockShipContactAt(rock,ship,giant)){
      const dx=ship.x-rock.x,dy=ship.y-rock.y,d=Math.hypot(dx,dy),bound=(giant?GIANT_RADIUS:Number(rock.r)||45)+(ship.shield>0?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS)+1;
      nx=d?dx/d:1;ny=d?dy/d:0;ship.x=rock.x+nx*bound;ship.y=rock.y+ny*bound;
    }
    return {x:nx,y:ny};
  }
  function mediumCircleContact(rock,body,bodyRadius){
    const radius=Number(rock.r)||45;
    if(Math.hypot(body.x-rock.x,body.y-rock.y)>radius+bodyRadius+1)return null;
    const hit=mediumSurface(rock,body.x,body.y,radius);
    return hit.distance<=bodyRadius+1e-6?{...hit,depth:bodyRadius-hit.distance}:null;
  }
  function asteroidCircleContact(rock,body,bodyRadius){
    if(!rock||!body)return null;
    if(isMediumRock(rock))return mediumCircleContact(rock,body,bodyRadius);
    const radius=Number(rock.r)||45,dx=body.x-rock.x,dy=body.y-rock.y,distance=Math.hypot(dx,dy);
    if(distance>radius+bodyRadius)return null;
    const nx=distance>1e-8?dx/distance:1,ny=distance>1e-8?dy/distance:0;
    return {x:rock.x+nx*radius,y:rock.y+ny*radius,nx,ny,distance:distance-radius,depth:radius+bodyRadius-distance};
  }
  function asteroidHitsCircle(rock,body,bodyRadius,sweptCircles){
    if(!rock||!body)return null;
    if(isMediumRock(rock))return outlineHitsCircle(rock,body,bodyRadius,Number(rock.r)||45,mediumProfile,mediumRotation);
    if(!sweptCircles(body,bodyRadius,rock,Number(rock.r)||45,false))return null;
    return asteroidCircleContact(rock,body,bodyRadius)||{x:body.x,y:body.y};
  }
  function separateAsteroidShipContact(ship,rock,contact){return separateRockShipContact(ship,rock,contact);}

  const rockShapeCache=new WeakMap();
  function rockShape(rock,radius,kind){
    if(!kind&&!isMediumRock(rock,radius))return null;
    const giant=kind==='giant',profile=giant?null:mediumProfile(rock),outline=giant?GIANT_OUTLINE:profile.outline,indices=giant?GIANT_PIECES:profile.pieces;
    const angle=giant?giantRotation(rock.x,rock.y):mediumRotation(rock.x,rock.y,rock.id);
    let shape=rockShapeCache.get(rock);
    if(!shape||shape.outline!==outline){
      const points=outline.map(()=>({x:0,y:0}));
      const part=list=>({points:list.map(i=>points[i]),axes:list.map(()=>({x:0,y:0}))});
      shape={outline,points,parts:indices.map(part),full:part(outline.map((_,i)=>i))};rockShapeCache.set(rock,shape);
    }
    if(shape.x===rock.x&&shape.y===rock.y&&shape.radius===radius&&shape.angle===angle)return shape;
    shape.x=rock.x;shape.y=rock.y;shape.radius=radius;shape.angle=angle;
    const c=Math.cos(angle),s=Math.sin(angle);
    for(let i=0;i<outline.length;i++){const [x,y]=outline[i];shape.points[i].x=rock.x+radius*(x*c+y*s);shape.points[i].y=rock.y+radius*(-x*s+y*c);}
    for(const part of [...shape.parts,shape.full]){
      part.minX=part.minY=Infinity;part.maxX=part.maxY=-Infinity;
      for(let i=0;i<part.points.length;i++){
        const a=part.points[i],b=part.points[(i+1)%part.points.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
        part.axes[i].x=dy/length;part.axes[i].y=-dx/length;
        part.minX=Math.min(part.minX,a.x);part.maxX=Math.max(part.maxX,a.x);part.minY=Math.min(part.minY,a.y);part.maxY=Math.max(part.maxY,a.y);
      }
    }
    return shape;
  }
  function separatedBounds(a,b,skin=0){
    // Bounds contain every concave piece: rejection is conservative, including
    // the existing contact skin. The narrow phase still decides every hit.
    return a.maxX+skin<=b.minX||b.maxX+skin<=a.minX||a.maxY+skin<=b.minY||b.maxY+skin<=a.minY;
  }
  function convexContact(a,b,skin=0){
    if(a.maxX+skin<=b.minX||b.maxX+skin<=a.minX||a.maxY+skin<=b.minY||b.maxY+skin<=a.minY)return null;
    let depth=Infinity,nx=1,ny=0;
    for(const axes of [a.axes,b.axes])for(const n of axes){
      let minA=Infinity,maxA=-Infinity,minB=Infinity,maxB=-Infinity;
      for(const p of a.points){const d=p.x*n.x+p.y*n.y;minA=Math.min(minA,d);maxA=Math.max(maxA,d);}
      for(const p of b.points){const d=p.x*n.x+p.y*n.y;minB=Math.min(minB,d);maxB=Math.max(maxB,d);}
      const forward=maxA-minB,backward=maxB-minA;
      if(forward<=1e-7-skin||backward<=1e-7-skin)return null;
      if(Math.min(forward,backward)<depth){depth=Math.min(forward,backward);const sign=forward<backward?1:-1;nx=n.x*sign;ny=n.y*sign;}
    }
    let pa=a.points[0],pb=b.points[0];
    for(const p of a.points)if(p.x*nx+p.y*ny>pa.x*nx+pa.y*ny)pa=p;
    for(const p of b.points)if(p.x*nx+p.y*ny<pb.x*nx+pb.y*ny)pb=p;
    return {depth,nx,ny,x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2};
  }
  function rockContact(a,b,ra=Number(a.r)||45,rb=Number(b.r)||45,aKind){
    if(Math.hypot(b.x-a.x,b.y-a.y)>ra+rb+1)return null;
    const oa=outerRock(a,ra,aKind),ob=outerRock(b,rb);
    if(oa&&ob&&!outerOverlap(oa,ob))return null;
    const sa=rockShape(a,ra,aKind),sb=rockShape(b,rb);
    if(sa&&sb){
      if(separatedBounds(sa.full,sb.full))return null;
      let best=null;
      for(const pa of sa.parts){
        if(separatedBounds(pa,sb.full))continue;
        for(const pb of sb.parts){const hit=convexContact(pa,pb);if(hit&&(!best||hit.depth>best.depth))best=hit;}
      }
      return best;
    }
    if(sa||sb){
      const rock=sa?a:b,body=sa?b:a,radius=sa?ra:rb,bodyRadius=sa?rb:ra;
      const hit=sa&&aKind==='giant'?giantSurface(rock,body.x,body.y,radius):mediumSurface(rock,body.x,body.y,radius);
      return hit.distance<bodyRadius?{...hit,depth:bodyRadius-hit.distance,nx:hit.nx*(sa?1:-1),ny:hit.ny*(sa?1:-1)}:null;
    }
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
    return d<ra+rb?{depth:ra+rb-d,nx:d?dx/d:1,ny:d?dy/d:0,x:(a.x+b.x)/2,y:(a.y+b.y)/2}:null;
  }
  function resolveShapePair(a,b,ra,rb,maxSpeed,fixedA=false,aKind,positionAnchor=0){
    let contact=rockContact(a,b,ra,rb,aKind);if(!contact)return false;
    const invA=fixedA||a.exiting?0:1/Math.max(1,ra*ra),invB=b.exiting&&!(fixedA&&aKind==='giant')?0:1/Math.max(1,rb*rb),sum=invA+invB;
    if(!sum)return false;
    // A rock supported by the giant stays put during positional correction,
    // while the impulse below still uses the two bodies' original masses.
    // A retiring neighbour can be displaced to clear that support while its
    // existing fixed-path velocity/impulse rule remains unchanged.
    const posA=positionAnchor===1?0:positionAnchor===-1?1/Math.max(1,ra*ra):invA;
    const posB=positionAnchor===-1?0:positionAnchor===1?1/Math.max(1,rb*rb):invB,posSum=posA+posB;
    beginRockCorrection(a);beginRockCorrection(b);
    let nx=contact.nx,ny=contact.ny,totalX=0,totalY=0;
    for(let pass=0;pass<10&&contact;pass++){
      const correction=(contact.depth+.15)/posSum;
      a.x-=contact.nx*correction*posA;a.y-=contact.ny*correction*posA;
      b.x+=contact.nx*correction*posB;b.y+=contact.ny*correction*posB;
      totalX+=contact.nx*contact.depth;totalY+=contact.ny*contact.depth;
      contact=rockContact(a,b,ra,rb,aKind);
    }
    for(let pass=0;pass<6&&contact;pass++){
      // Deep initial overlaps can cross several concave pieces. A final separating
      // projection settles the whole outline without leaving a trapped body.
      const sa=rockShape(a,ra,aKind),sb=rockShape(b,rb),full=sa&&sb?convexContact(sa.full,sb.full):null;
      const d=Math.hypot(b.x-a.x,b.y-a.y),hit=full||{depth:ra+rb-d+.5,nx:d?(b.x-a.x)/d:1,ny:d?(b.y-a.y)/d:0};
      const correction=(Math.max(0,hit.depth)+.5)/posSum;
      a.x-=hit.nx*correction*posA;a.y-=hit.ny*correction*posA;b.x+=hit.nx*correction*posB;b.y+=hit.ny*correction*posB;
      totalX+=hit.nx*hit.depth;totalY+=hit.ny*hit.depth;
      contact=rockContact(a,b,ra,rb,aKind);
    }
    if(contact){
      // Last resort for an initially trapped body: the bounding circles also
      // contain every silhouette after any rotation caused by the separation.
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),nx=d?dx/d:1,ny=d?dy/d:0;
      const depth=Math.max(0,ra+rb-d)+1,correction=depth/posSum;
      a.x-=nx*correction*posA;a.y-=ny*correction*posA;b.x+=nx*correction*posB;b.y+=ny*correction*posB;
      totalX+=nx*depth;totalY+=ny*depth;
    }
    const length=Math.hypot(totalX,totalY);if(length>1e-8){nx=totalX/length;ny=totalY/length;}
    const closing=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
    if(closing<0){const impulse=-(fixedA||!invA||!invB?1.58:1.84)*closing/sum;a.vx-=impulse*invA*nx;a.vy-=impulse*invA*ny;b.vx+=impulse*invB*nx;b.vy+=impulse*invB*ny;}
    if(invA)limitRockSpeed(a,maxSpeed);if(invB)limitRockSpeed(b,maxSpeed);
    finishRockCorrection(a);finishRockCorrection(b);return true;
  }

  function chooseSpawnSector(player,players,width=1920,height=1080){
    const occupied=new Set();
    for(const other of players){
      if(!other||other.dead||Number(other.index)===Number(player.index)||!Number.isFinite(other.x)||!Number.isFinite(other.y))continue;
      occupied.add((other.x<width/2?0:1)+(other.y<height/2?0:2));
    }
    const free=[0,1,2,3].filter(sector=>!occupied.has(sector));
    // A four-player roster always leaves at least one sector for this ship.
    return free[Math.floor(Math.random()*free.length)];
  }
  // Arena units: the visible shield and every damaging contact share this edge.
  const SHIELD_RADIUS=60;
  function shipCollisionRadius(ship,hullRadius=24){
    return Number(ship&&ship.shield)>0?SHIELD_RADIUS:hullRadius;
  }
  function shipImpactPoint(ship,source,sourceRadius=0){
    if(!(ship.shield>0)){
      const hit=shipHitsCircle(ship,source,sourceRadius)||shipSurface(shipPose(ship),source.x,source.y);
      return {x:hit.x,y:hit.y};
    }
    const radius=shipCollisionRadius(ship);
    let dx=source.x-ship.x,dy=source.y-ship.y;
    const sx=Number.isFinite(source.px)?source.px:source.x,sy=Number.isFinite(source.py)?source.py:source.y;
    const tx=Number.isFinite(ship.px)?ship.px:ship.x,ty=Number.isFinite(ship.py)?ship.py:ship.y;
    const x0=sx-tx,y0=sy-ty,vx=dx-x0,vy=dy-y0,a=vx*vx+vy*vy;
    const r=radius+sourceRadius,c=x0*x0+y0*y0-r*r,b=2*(x0*vx+y0*vy);
    const discriminant=b*b-4*a*c;
    // Use the entry side for a fast projectile, never a line across a wrapped edge.
    if(a>1e-9&&c>=0&&discriminant>=0&&Math.abs(source.x-sx)<960&&Math.abs(source.y-sy)<540&&Math.abs(ship.x-tx)<960&&Math.abs(ship.y-ty)<540){
      const t=(-b-Math.sqrt(discriminant))/(2*a);
      if(t>=0&&t<=1){dx=x0+vx*t;dy=y0+vy*t;}
    }
    let length=Math.hypot(dx,dy);
    if(length<1e-8){dx=x0;dy=y0;length=Math.hypot(dx,dy);}
    if(length<1e-8){dx=1;dy=0;length=1;}
    return {x:ship.x+dx/length*radius,y:ship.y+dy/length*radius};
  }
  function separateShipContact(ship,obstacle,obstacleRadius,shipShare=1){
    const dx=ship.x-obstacle.x,dy=ship.y-obstacle.y,d=Math.hypot(dx,dy);
    let nx,ny;
    if(d>1e-8){nx=dx/d;ny=dy/d;}
    else{
      const vx=(Number(ship.vx)||0)-(Number(obstacle.vx)||0),vy=(Number(ship.vy)||0)-(Number(obstacle.vy)||0),speed=Math.hypot(vx,vy);
      nx=speed>1e-8?-vx/speed:1;ny=speed>1e-8?-vy/speed:0;
    }
    const overlap=shipCollisionRadius(ship)+obstacleRadius-d;
    if(overlap>=0){
      const correction=overlap+.1;
      ship.x+=nx*correction*shipShare;ship.y+=ny*correction*shipShare;
      obstacle.x-=nx*correction*(1-shipShare);obstacle.y-=ny*correction*(1-shipShare);
    }
    return {x:nx,y:ny};
  }

  // Un unico integrador para autoridad y prediccion. Un comando = un tick.
  const MOVEMENT_DT=1/60;
  const MOVEMENT_DRAG=Math.pow(.35,MOVEMENT_DT);
  function stepShipMovement(p,c,dt=MOVEMENT_DT,width=1920,height=1080){
    p.pbank=Number(p.bank)||0;
    const turn=Math.max(-1,Math.min(1,Number(c.turn)||0)),target=-turn*Math.abs(turn)*SHIP_BANK_LIMIT;
    p.bank=p.pbank+(target-p.pbank)*(1-Math.exp(-dt/(target===0?.24:.28)));
    if(Math.abs(p.bank)<.0001)p.bank=0;
    p.rot=(p.rot+c.turn*240*dt+360)%360;
    const radians=p.rot*Math.PI/180,dx=-Math.sin(radians),dy=-Math.cos(radians);
    if(c.thrust){p.vx+=dx*(240*p.speed)*dt;p.vy+=dy*(240*p.speed)*dt;}
    const drag=dt===MOVEMENT_DT?MOVEMENT_DRAG:Math.pow(.35,dt);
    p.vx*=drag;p.vy*=drag;
    const vmax=330*p.speed,speed=Math.hypot(p.vx,p.vy);
    if(speed>vmax){p.vx=p.vx/speed*vmax;p.vy=p.vy/speed*vmax;}
    p.x=(p.x+p.vx*dt+width)%width;p.y=(p.y+p.vy*dt+height)%height;
  }
  function createMotionStream(epoch){
    return {epoch,ack:0,active:false,requested:false,queue:new Map(),missing:0,last:{turn:0,thrust:false,fire:false,directFire:false}};
  }
  function acceptMotionFrames(stream,packet){
    if(!packet||packet.v!==1||packet.epoch!==stream.epoch||!Array.isArray(packet.frames)||packet.frames.length>60)return false;
    // Validate the complete batch before changing any state. No client positions or dt.
    let previous=0;
    for(const f of packet.frames){
      if(!Array.isArray(f)||f.length!==5||!Number.isSafeInteger(f[0])||f[0]<=previous||f[0]>stream.ack+120||
        !Number.isFinite(f[1])||Math.abs(f[1])>1||![0,1].includes(f[2])||![0,1].includes(f[3])||![0,1].includes(f[4]))return false;
      previous=f[0];
    }
    stream.requested=true;
    if(!stream.active&&stream.queue.size===0&&packet.frames.length)stream.ack=packet.frames[0][0]-1;
    for(const f of packet.frames)if(f[0]>stream.ack&&!stream.queue.has(f[0])){
      stream.queue.set(f[0],{turn:f[1],thrust:!!f[2],fire:!!f[3],directFire:!!f[4]});
    }
    // Start with three consecutive commands. Starting at the first command
    // lets the 60 Hz consumer overtake the 30 Hz sender between packets,
    // retiring releases before they arrive. Local prediction remains immediate.
    if(!stream.active&&[1,2,3].every(n=>stream.queue.has(stream.ack+n)))stream.active=true;
    return true;
  }
  function consumeMotionFrame(stream){
    if(!stream||!stream.active)return null;
    const tick=++stream.ack,frame=stream.queue.get(tick);
    stream.queue.delete(tick);
    if(frame){stream.last=frame;stream.missing=0;}
    else stream.missing++;
    // Deadline passed: a late frame is retired, never applied a second time.
    // A short gap holds the last input; a long gap releases controls.
    return stream.missing<=6?stream.last:{turn:0,thrust:false,fire:false,directFire:false};
  }

  function limitRockSpeed(rock,maxSpeed){
    const speed=Math.hypot(Number(rock.vx)||0,Number(rock.vy)||0);
    if(speed>maxSpeed&&speed>0){
      rock.vx*=maxSpeed/speed;
      rock.vy*=maxSpeed/speed;
    }
  }

  function resolveAsteroidPairCollision(a,b,defaultRadius=45,maxSpeed=190){
    if(!a||!b||(a.exiting&&b.exiting))return false;
    const ra=Number(a.r)||defaultRadius,rb=Number(b.r)||defaultRadius;
    if(isMediumRock(a,defaultRadius)||isMediumRock(b,defaultRadius))return resolveShapePair(a,b,ra,rb,maxSpeed);
    // Retiring rocks keep their exit trajectory, but remain solid to other rocks.
    if(a.exiting)return resolveGiantAsteroidCollision(a,b,ra,rb,maxSpeed);
    if(b.exiting)return resolveGiantAsteroidCollision(b,a,rb,ra,maxSpeed);
    const dx=b.x-a.x,dy=b.y-a.y,minDist=ra+rb,d2=dx*dx+dy*dy;

    // Los dos fragmentos de una misma rotura se dejan separar por el impulso
    // inicial. Cuando ya han alcanzado distancia normal vuelven a comportarse
    // como dos asteroides independientes.
    if(a.fragmentGroup&&a.fragmentGroup===b.fragmentGroup){
      if(!a.fragmentPairReleased||!b.fragmentPairReleased){
        const separating=dx*(b.vx-a.vx)+dy*(b.vy-a.vy)>0;
        if(d2>=(minDist+2)*(minDist+2)||!separating){
          a.fragmentPairReleased=true;
          b.fragmentPairReleased=true;
        }else return false;
      }
    }

    if(d2>=minDist*minDist)return false;
    const d=Math.sqrt(d2);
    let nx,ny;
    if(d>1e-8){nx=dx/d;ny=dy/d;}
    else{
      const rvx=(Number(b.vx)||0)-(Number(a.vx)||0),rvy=(Number(b.vy)||0)-(Number(a.vy)||0),speed=Math.hypot(rvx,rvy);
      nx=speed>1e-8?-rvx/speed:1;ny=speed>1e-8?-rvy/speed:0;
    }
    const overlap=minDist-d;
    const massA=Math.max(1,ra*ra),massB=Math.max(1,rb*rb);
    const invA=1/massA,invB=1/massB,invSum=invA+invB;

    const correction=(overlap+.6)/invSum;
    beginRockCorrection(a);beginRockCorrection(b);
    a.x-=nx*correction*invA;a.y-=ny*correction*invA;
    b.x+=nx*correction*invB;b.y+=ny*correction*invB;

    const rvx=b.vx-a.vx,rvy=b.vy-a.vy;
    const closing=rvx*nx+rvy*ny;
    if(closing<0){
      const restitution=.84;
      const impulse=-(1+restitution)*closing/invSum;
      a.vx-=impulse*invA*nx;a.vy-=impulse*invA*ny;
      b.vx+=impulse*invB*nx;b.vy+=impulse*invB*ny;
    }

    limitRockSpeed(a,maxSpeed);
    limitRockSpeed(b,maxSpeed);
    finishRockCorrection(a);finishRockCorrection(b);
    return true;
  }

  function resolveGiantAsteroidCollision(g,a,giantRadius=GIANT_RADIUS,defaultRadius=45,maxSpeed=190){
    if(!g||!a)return false;
    // Retiring medium rocks are still visible and solid against the giant.
    // Other retiring bodies retain their existing environmental behaviour.
    if(a.exiting&&!isMediumRock(a,defaultRadius))return false;
    const ar=Number(a.r)||defaultRadius;
    if(isMediumRock(a,defaultRadius)||(g.exiting&&isMediumRock(g,giantRadius)))return resolveShapePair(g,a,giantRadius,ar,maxSpeed,true,giantRadius===GIANT_RADIUS?'giant':undefined);
    if(giantRadius===GIANT_RADIUS&&!g.exiting){
      const hit=giantCircleContact(g,a,ar,giantRadius);if(!hit)return false;
      beginRockCorrection(a);
      a.x+=hit.nx*(hit.depth+1.2);a.y+=hit.ny*(hit.depth+1.2);
      const closing=(a.vx-g.vx)*hit.nx+(a.vy-g.vy)*hit.ny;
      const impulse=closing<0?-1.58*closing:12;
      a.vx+=hit.nx*impulse;a.vy+=hit.ny*impulse;limitRockSpeed(a,maxSpeed);finishRockCorrection(a);return true;
    }
    const dx=a.x-g.x,dy=a.y-g.y,minDist=giantRadius+ar,d2=dx*dx+dy*dy;
    if(d2>=minDist*minDist)return false;
    const d=Math.sqrt(d2);
    let nx,ny;
    if(d>1e-8){nx=dx/d;ny=dy/d;}
    else{
      const rvx=(Number(a.vx)||0)-(Number(g.vx)||0),rvy=(Number(a.vy)||0)-(Number(g.vy)||0),speed=Math.hypot(rvx,rvy);
      nx=speed>1e-8?-rvx/speed:1;ny=speed>1e-8?-rvy/speed:0;
    }
    const overlap=minDist-d;

    beginRockCorrection(a);
    a.x+=nx*(overlap+1.2);a.y+=ny*(overlap+1.2);
    const rvx=a.vx-g.vx,rvy=a.vy-g.vy,closing=rvx*nx+rvy*ny;
    if(closing<0){
      const bounce=-(1.58)*closing;
      a.vx+=nx*bounce;a.vy+=ny*bounce;
    }else{
      a.vx+=nx*12;a.vy+=ny*12;
    }

    limitRockSpeed(a,maxSpeed);
    finishRockCorrection(a);
    return true;
  }

  function resolveGiantAsteroidContacts(g,asteroids,giantRadius=GIANT_RADIUS,defaultRadius=45,maxSpeed=190){
    if(!g||!Array.isArray(asteroids))return false;
    let queue=null,rank=null;
    for(let i=0;i<asteroids.length;i++)if(resolveGiantAsteroidCollision(g,asteroids[i],giantRadius,defaultRadius,maxSpeed)){
      if(!queue){queue=[];rank=new Map();}
      queue.push(i);rank.set(i,0);
    }
    if(!queue)return false;
    // Propagate support outward instead of pushing each neighbour back into
    // the giant and iterating the same expensive concave contacts repeatedly.
    const visited=new Set();let fallback=false;
    const pair=(i,j,anchor)=>{
      const a=asteroids[i],b=asteroids[j];
      if(isMediumRock(a,defaultRadius)&&isMediumRock(b,defaultRadius))return resolveShapePair(a,b,Number(a.r)||defaultRadius,Number(b.r)||defaultRadius,maxSpeed,false,undefined,anchor);
      return resolveAsteroidPairCollision(a,b,defaultRadius,maxSpeed);
    };
    for(let head=0;head<queue.length;head++){
      const i=queue[head],level=rank.get(i);
      for(let j=0;j<asteroids.length;j++){
        if(i===j)continue;
        const key=Math.min(i,j)*asteroids.length+Math.max(i,j);if(visited.has(key))continue;
        const other=rank.get(j),anchor=other===undefined||level<=other?1:-1;
        if(!pair(i,j,anchor))continue;
        visited.add(key);
        if(other===undefined){rank.set(j,level+1);queue.push(j);}
        else if(other===level)fallback=true;
      }
    }
    for(const a of asteroids)if(resolveGiantAsteroidCollision(g,a,giantRadius,defaultRadius,maxSpeed))fallback=true;
    // Two independently supported rocks, or a fixed retiring neighbour, may
    // need a short final adjustment. This fallback has a fixed two-pass cap.
    for(let pass=0;fallback&&pass<2;pass++){
      let changed=false;
      for(let i=0;i<asteroids.length;i++)for(let j=i+1;j<asteroids.length;j++){
        const a=rank.get(i),b=rank.get(j);if(a===undefined&&b===undefined)continue;
        if(pair(i,j,b===undefined||a!==undefined&&a<=b?1:-1))changed=true;
      }
      fallback=false;
      for(const a of asteroids)if(resolveGiantAsteroidCollision(g,a,giantRadius,defaultRadius,maxSpeed))fallback=true;
      if(!changed&&!fallback)break;
    }
    return true;
  }

  function resolveMeteorCollisions(meteors,asteroids,meteorRadius=14,asteroidMaxSpeed=190,meteorMaxSpeed=240){
    // Call after every meteor has moved, so both sides use the same tick.
    // A second pass settles contacts involving more than two rocks.
    for(let pass=0;pass<2;pass++)for(let i=0;i<meteors.length;i++){
      const m=meteors[i];
      for(let j=i+1;j<meteors.length;j++)resolveAsteroidPairCollision(m,meteors[j],meteorRadius,meteorMaxSpeed);
      for(const a of asteroids){
        if(resolveAsteroidPairCollision(m,a,meteorRadius,meteorMaxSpeed)&&!a.exiting)limitRockSpeed(a,asteroidMaxSpeed);
      }
    }
  }

  function guidedTargetFor(p,players,dirFromRot,minAlign=TARGET_MIN_ALIGN){
    if(!p||p.dead||!Array.isArray(players)||typeof dirFromRot!=='function')return -1;
    const forward=dirFromRot(p.rot);
    let bestIndex=-1,bestAlign=-2,bestDistance=Infinity;

    for(const target of players){
      if(!target||target.index===p.index||target.dead)continue;
      const dx=target.x-p.x,dy=target.y-p.y,distance=Math.hypot(dx,dy);
      if(distance<1)continue;
      const align=(forward.x*dx+forward.y*dy)/distance;
      if(align<minAlign)continue;
      if(align>bestAlign+1e-6||(Math.abs(align-bestAlign)<=1e-6&&distance<bestDistance)){
        bestAlign=align;
        bestDistance=distance;
        bestIndex=target.index;
      }
    }
    return bestIndex;
  }


  function reloadTimeFor(p){
    const cadence=Number(p&&p.cadence)||30;
    return Math.max(.5,cadence/8)*.5;
  }

  function bulletSpeedFor(p){
    const cadence=Number(p&&p.cadence)||30;
    return cadence>=30?500:(cadence>=20?750:(cadence>=10?900:1000));
  }

  function guidedProjectileSpeedFor(p){
    const cadence=Number(p&&p.cadence)||30;
    return cadence>=30?400:(cadence>=20?460:(cadence>=10?520:580));
  }

  function refreshGuidedState(p,players,dirFromRot){
    if(!p)return -1;
    p.guided=Number(p.guidedAmmo)>0;
    p.guidedTarget=p.guided?guidedTargetFor(p,players,dirFromRot):-1;
    return p.guidedTarget;
  }

  function tryFireProjectile(p,d,fireNow,rocketNow,directFire,cpuBlocked,players,dirFromRot,uid,cpuFireDelaySeconds=0){
    if(!p||!d)return null;

    const rocketReady=!!rocketNow&&Number(p.guidedAmmo)>0;
    const guided=rocketReady?true:(directFire?false:!!p.guided);
    const hasAmmo=guided?Number(p.guidedAmmo)>0:Number(p.bullets)>0;

    // Mantener exactamente la misma puerta de disparo en local y online:
    // accion valida, municion de su reserva, recarga terminada y CPU armada.
    if((!fireNow&&!rocketReady)||!hasAmmo||!(Number(p.reload)<=0)||cpuBlocked)return null;

    const projectileSpeed=guided?guidedProjectileSpeedFor(p):bulletSpeedFor(p);
    const makeId=typeof uid==='function'?uid:(()=>Math.floor(Math.random()*1e9));
    const projectile={
      id:makeId(),owner:p.index,
      x:p.x+d.x*35,y:p.y+d.y*35,
      vx:d.x*projectileSpeed,vy:d.y*projectileSpeed,
      age:0,travel:0,guided,
      leavingOwnerShield:guided&&Number(p.shield)>0,
      leavingOwnerShip:guided,
      target:guided?p.guidedTarget:-1,
      flareTarget:-1,decoyed:false,
      baseSpeed:projectileSpeed
    };

    // V22.06: balas y misiles consumen siempre su contador independiente.
    if(guided){
      p.guidedAmmo=Math.max(0,(Number(p.guidedAmmo)||0)-1);
      refreshGuidedState(p,players,dirFromRot);
    }else{
      p.bullets=Math.max(0,(Number(p.bullets)||0)-1);
    }

    // Una sola cadencia comun para ambos tipos de proyectil.
    p.reload=reloadTimeFor(p);
    if(p.cpu)p.cpuFireDelay=Number(cpuFireDelaySeconds)||0;
    return projectile;
  }


  function projectileAsteroidHit(projectile,asteroids,sweptCircles,projectileRadius=4){
    if(!projectile||!Array.isArray(asteroids)||typeof sweptCircles!=='function')return null;
    for(let i=asteroids.length-1;i>=0;i--){
      const asteroid=asteroids[i];
      if(!asteroid)continue;
      const asteroidRadius=Number(asteroid.r)||45;
      const contact=asteroidHitsCircle(asteroid,projectile,projectileRadius,sweptCircles);if(!contact)continue;
      return {
        asteroid,
        index:i,
        fracture:!!projectile.guided,
        owner:Number(projectile.owner),
        impactX:isMediumRock(asteroid)?contact.x:Number(projectile.x)||0,
        impactY:isMediumRock(asteroid)?contact.y:Number(projectile.y)||0
      };
    }
    return null;
  }


  function projectileGiantHit(projectile,giant,sweptCircles,projectileRadius=4,giantRadius=GIANT_RADIUS){
    if(!projectile||!giant||typeof sweptCircles!=='function')return null;
    const contact=giantHitsCircle(giant,projectile,projectileRadius,giantRadius);if(!contact)return null;
    return {
      giant,
      guided:!!projectile.guided,
      owner:Number(projectile.owner),
      impactX:contact.x,
      impactY:contact.y
    };
  }


  function projectileMeteorHit(projectile,meteors,sweptCircles,projectileRadius=4,meteorRadius=14){
    if(!projectile||!Array.isArray(meteors)||typeof sweptCircles!=='function')return null;
    for(let i=meteors.length-1;i>=0;i--){
      const meteor=meteors[i];
      if(!meteor)continue;
      if(!sweptCircles(projectile,projectileRadius,meteor,meteorRadius,false))continue;
      return {
        meteor,
        index:i,
        guided:!!projectile.guided,
        owner:Number(projectile.owner),
        impactX:Number(projectile.x)||0,
        impactY:Number(projectile.y)||0
      };
    }
    return null;
  }


  function projectilePickupHit(projectile,pickups,sweptCircles,projectileRadius=4,pickupRadius=22){
    if(!projectile||!Array.isArray(pickups)||typeof sweptCircles!=='function')return null;

    // V22.10: los misiles atraviesan cualquier pickup y no se consumen.
    if(projectile.guided)return null;

    for(let i=pickups.length-1;i>=0;i--){
      const pickup=pickups[i];
      if(!pickup)continue;
      if(!sweptCircles(projectile,projectileRadius,pickup,pickupRadius,false))continue;
      return {pickup,index:i};
    }
    return null;
  }


  function projectileFlareHit(projectile,flares,sweptCircles,projectileRadius=4,flareRadius=12){
    if(!projectile||!Array.isArray(flares)||typeof sweptCircles!=='function')return null;
    for(let i=flares.length-1;i>=0;i--){
      const flare=flares[i];
      if(!flare)continue;
      if(!sweptCircles(projectile,projectileRadius,flare,flareRadius,false))continue;
      const projectileOwner=Number(projectile.owner);
      const flareOwner=Number(flare.owner);
      return {
        flare,
        index:i,
        guided:!!projectile.guided,
        projectileOwner,
        flareOwner,
        intercept:flareOwner!==projectileOwner,
        impactX:Number(projectile.x)||0,
        impactY:Number(projectile.y)||0
      };
    }
    return null;
  }


  function bounceBodyFromFlare(body,flare,bodyRadius=45,flareRadius=12,maxSpeed=190,minBounceSpeed=105){
    if(!body||!flare)return false;
    const surface=isMediumRock(body,bodyRadius)?mediumSurface(body,flare.x,flare.y,bodyRadius):null;
    let nx=(Number(body.x)||0)-(Number(flare.x)||0);
    let ny=(Number(body.y)||0)-(Number(flare.y)||0);
    let distance=Math.hypot(nx,ny);
    if(distance<.001){
      nx=-(Number(flare.vx)||1);ny=-(Number(flare.vy)||0);
      distance=Math.hypot(nx,ny)||1;
    }
    nx/=distance;ny/=distance;
    if(surface){nx=-surface.nx;ny=-surface.ny;}

    const vx=Number(body.vx)||0,vy=Number(body.vy)||0;
    const normalSpeed=vx*nx+vy*ny;
    const tx=vx-normalSpeed*nx,ty=vy-normalSpeed*ny;
    const flareSpeed=Math.hypot(Number(flare.vx)||0,Number(flare.vy)||0);
    const rebound=Math.max(Math.abs(normalSpeed)*.9,Number(minBounceSpeed)||0,Math.min((Number(minBounceSpeed)||0)+flareSpeed*.12,(Number(maxSpeed)||190)*.82));

    // La componente normal siempre queda alejandose del punto de impacto.
    // Conservamos parte de la componente tangencial para que el rebote no
    // parezca un cambio artificial a una direccion fija.
    body.vx=tx*.88+nx*rebound;
    body.vy=ty*.88+ny*rebound;

    const speed=Math.hypot(body.vx,body.vy);
    const limit=Math.max(1,Number(maxSpeed)||190);
    if(speed>limit){body.vx=body.vx/speed*limit;body.vy=body.vy/speed*limit;}

    const overlap=surface?flareRadius-surface.distance:(Number(bodyRadius)||0)+(Number(flareRadius)||0)-distance;
    if(overlap>0){
      beginRockCorrection(body);
      body.x=(Number(body.x)||0)+nx*(overlap+2);
      body.y=(Number(body.y)||0)+ny*(overlap+2);
      finishRockCorrection(body);
    }
    return true;
  }


  function resolveProjectileInterceptions(projectiles,destroyed,sweptCircles,bulletRadius=4,missileRadius=12,onHit){
    if(!Array.isArray(projectiles)||projectiles.length<2||!destroyed||typeof destroyed.add!=='function'||typeof sweptCircles!=='function')return 0;
    const hitCallback=typeof onHit==='function'?onHit:null;
    let hits=0;

    for(let i=0;i<projectiles.length;i++){
      const a=projectiles[i];
      if(!a||destroyed.has(a))continue;
      for(let j=i+1;j<projectiles.length;j++){
        const b=projectiles[j];
        if(!b||destroyed.has(b))continue;

        // Proyectiles del mismo jugador nunca se autointerceptan.
        if(Number(a.owner)===Number(b.owner))continue;

        const aMissile=!!a.guided,bMissile=!!b.guided;
        // Dos balas normales se atraviesan.
        if(!aMissile&&!bMissile)continue;

        let missile=null,hit=false;
        if(aMissile&&bMissile){
          hit=sweptCircles(a,missileRadius,b,missileRadius,false);
          missile=a;
        }else{
          missile=aMissile?a:b;
          const bullet=aMissile?b:a;
          hit=sweptCircles(missile,missileRadius,bullet,bulletRadius,false);
        }
        if(!hit)continue;

        destroyed.add(a);
        destroyed.add(b);
        hits++;

        if(hitCallback){
          hitCallback(
            (Number(a.x)+Number(b.x))*.5,
            (Number(a.y)+Number(b.y))*.5,
            Number(missile&&missile.owner)||0
          );
        }
        break;
      }
    }
    return hits;
  }



  function projectileShipHit(projectile,players,sweptCircles,projectileRadius=4,shipRadius=24,brutalDistance=850,pointBlankDistance=260){
    if(!projectile||!Array.isArray(players)||typeof sweptCircles!=='function')return null;

    const guided=!!projectile.guided;
    const owner=Number(projectile.owner);
    const travel=Number(projectile.travel)||0;
    let attacker=null;
    for(const candidate of players){
      if(candidate&&Number(candidate.index)===owner){attacker=candidate;break;}
    }

    for(const target of players){
      if(!target)continue;

      if(Number(target.index)===owner&&(projectile.leavingOwnerShield||projectile.leavingOwnerShip)){
        const dx=projectile.x-target.x,dy=projectile.y-target.y,r=(Number(target.shield)>0?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS)+projectileRadius;
        if(dx*dx+dy*dy>r*r){projectile.leavingOwnerShield=false;projectile.leavingOwnerShip=false;}
        // Let a new missile leave its own hull/field; a later return can still hit it.
        continue;
      }
      // Bala normal: nunca hiere al tirador. Misil: sí puede regresar y dañarlo.
      if((Number(target.index)===owner&&!guided)||target.dead||Number(target.protection)>0)continue;
      const shielded=Number(target.shield)>0;
      if(!sweptCircles(projectile,projectileRadius,target,shielded?SHIELD_RADIUS:SHIP_PROJECTILE_RADIUS,false))continue;
      if(!shielded&&!projectileHitsShipHull(projectile,target,projectileRadius))continue;
      const enemyHit=!!attacker&&attacker!==target;
      const longShot=enemyHit&&travel>=brutalDistance;
      const pointBlank=enemyHit&&!guided&&travel<=pointBlankDistance;
      const impact=shielded?shipImpactPoint(target,projectile,projectileRadius):projectile;

      let reward='none';
      if(!shielded){
        if(longShot)reward=guided?'goodShot':'brutal';
        else if(guided&&enemyHit)reward='hunter';
      }

      return {
        target,
        attacker,
        guided,
        shielded,
        longShot,
        pointBlank,
        reward,
        owner,
        travel,
        impactX:Number(impact.x)||0,
        impactY:Number(impact.y)||0
      };
    }
    return null;
  }

  function projectileUfoHit(projectile,ufo,sweptCircles,projectileRadius=4,ufoRadius=30,ufoHp=1){
    if(!projectile||!ufo||typeof sweptCircles!=='function')return null;
    if(!sweptCircles(projectile,projectileRadius,ufo,ufoRadius,false))return null;

    const guided=!!projectile.guided;
    const damage=guided?2:1;
    const hp=Math.max(0,(Number(ufo.hp)||ufoHp)-damage);
    ufo.hp=hp;

    return {
      ufo,
      guided,
      damage,
      hp,
      destroyed:hp<=0,
      owner:Number(projectile.owner),
      impactX:Number(projectile.x)||0,
      impactY:Number(projectile.y)||0
    };
  }

  function asteroidMissileFracture(asteroid,impactX,impactY,opts={}){
    if(!asteroid)return null;
    const defaultRadius=Number(opts.defaultRadius)||45;
    const fragmentRadius=Number(opts.fragmentRadius)||28;
    const rand=typeof opts.rand==='function'?opts.rand:((a,b)=>a+Math.random()*(b-a));
    const uid=typeof opts.uid==='function'?opts.uid:(()=>Math.floor(Math.random()*1e9));

    const radius=Number(asteroid.r)||defaultRadius;
    const x=Number(asteroid.x)||0,y=Number(asteroid.y)||0;
    const vx=Number(asteroid.vx)||0,vy=Number(asteroid.vy)||0;
    const hitX=Number.isFinite(Number(impactX))?Number(impactX):x;
    const hitY=Number.isFinite(Number(impactY))?Number(impactY):y;
    const isSmall=radius<=30||asteroid.fragment===true;

    if(isSmall){
      return {destroyOnly:true,x,y,hitX,hitY,fragments:[]};
    }

    let nx=hitX-x,ny=hitY-y;
    let len=Math.hypot(nx,ny);
    if(len<.001){
      nx=-(vx||1);ny=-(vy||0);
      len=Math.hypot(nx,ny)||1;
    }
    nx/=len;ny/=len;

    const splitX=-ny,splitY=nx;
    const fragmentGroup='split-'+uid();
    const fragments=[];

    for(const sign of [-1,1]){
      const sideSpeed=sign*rand(70,100);
      const impactKick=rand(34,58);
      const fx=x+splitX*sign*fragmentRadius-nx*5;
      const fy=y+splitY*sign*fragmentRadius-ny*5;
      fragments.push({
        id:uid(),x:fx,y:fy,px:fx,py:fy,rot:rand(0,360),
        type:Number(asteroid.type)||1,
        vx:vx*.62+splitX*sideSpeed-nx*impactKick,
        vy:vy*.62+splitY*sideSpeed-ny*impactKick,
        r:fragmentRadius,fragment:true,fragmentGroup,
        fragmentPairReleased:false,exiting:false,exitDelay:-1
      });
    }

    return {destroyOnly:false,x,y,hitX,hitY,fragments};
  }

  function cpuSpawnEscapeControl(cpu,players,now,width,height){
    if(!cpu||cpu.dead)return null;
    let threat=null,nearest=null,best=Infinity,nearestDistance=Infinity;
    for(const other of players){
      if(other===cpu||other.index===cpu.index||other.dead)continue;
      // La distancia debe respetar el mundo que envuelve sus bordes.
      let dx=cpu.x-other.x,dy=cpu.y-other.y;
      dx-=Math.round(dx/width)*width;dy-=Math.round(dy/height)*height;
      const distance=Math.hypot(dx,dy);
      const candidate={dx,dy,distance};
      if(distance<nearestDistance){nearest=candidate;nearestDistance=distance;}
      if((other.protection>0||other.spawnFx>0)&&distance<320&&distance<best){
        threat=candidate;best=distance;
      }
    }
    const opening=now<(Number(cpu.openingFleeUntil)||0);
    if(!threat&&!opening)return null;
    const away=threat||nearest;
    let desired=cpu.rot;
    if(away&&away.distance>.001)desired=(Math.atan2(-away.dx,-away.dy)*180/Math.PI+360)%360;
    else if(away)desired=(cpu.index*137.508)%360;
    const err=((desired-cpu.rot+540)%360)-180;
    return{turn:Math.max(-1,Math.min(1,err/30)),thrust:Math.abs(err)<65,fire:false};
  }

  window.GalaxyPhysicsCore=Object.freeze({
    SHIP_DRAW_SIZE,SHIP_PROJECTILE_HULL,SHIP_PROJECTILE_RADIUS,projectileHitsShipHull,
    SHIP_CONTACT_SKIN,shipPairContact,moveShipsToContact,separateShipPair,
    shipTilt,shipHitsCircle,shipSurface,shipPose,shipProfile,mediumProfile,mediumQuaternion,advanceRockPose,captureRockMotion,asteroidShipContact,separateRockShipContact,
    GIANT_RADIUS,GIANT_DIAMETER,GIANT_OUTLINE,giantRotation,giantSurface,giantCircleContact,giantHitsCircle,separateGiantShipContact,
    MEDIUM_ROCK_RADII,mediumRockRadius,MEDIUM_OUTLINE,mediumRotation,mediumSurface,isMediumRock,asteroidCircleContact,asteroidHitsCircle,separateAsteroidShipContact,rockContact,
    chooseSpawnSector,
    SHIELD_RADIUS,shipCollisionRadius,shipImpactPoint,separateShipContact,
    MOVEMENT_DT,stepShipMovement,stepAsteroidExit,createMotionStream,acceptMotionFrames,consumeMotionFrame,
    cpuSpawnEscapeControl,
    TARGET_MIN_ALIGN,
    resolveAsteroidPairCollision,
    resolveGiantAsteroidCollision,
    resolveGiantAsteroidContacts,
    resolveMeteorCollisions,
    guidedTargetFor,
    reloadTimeFor,
    bulletSpeedFor,
    guidedProjectileSpeedFor,
    refreshGuidedState,
    tryFireProjectile,
    projectileAsteroidHit,
    projectileGiantHit,
    projectileMeteorHit,
    projectilePickupHit,
    projectileFlareHit,
    bounceBodyFromFlare,
    resolveProjectileInterceptions,
    projectileShipHit,
    projectileUfoHit,
    asteroidMissileFracture
  });
})();

