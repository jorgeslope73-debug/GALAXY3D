'use strict';
(() => {
  const TARGET_MIN_ALIGN=.8660254038; // cos(30 grados)
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
  function pointSegmentDistance2(x,y,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay,length2=dx*dx+dy*dy;
    const t=length2>1e-12?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length2)):0;
    const qx=x-ax-dx*t,qy=y-ay-dy*t;return qx*qx+qy*qy;
  }
  function projectileHitsShipHull(projectile,ship,radius=4){
    const px=Number.isFinite(projectile.px)?projectile.px:projectile.x,py=Number.isFinite(projectile.py)?projectile.py:projectile.y;
    const sx=Number.isFinite(ship.px)?ship.px:ship.x,sy=Number.isFinite(ship.py)?ship.py:ship.y;
    const angle=(Number(ship.rot)||0)*Math.PI/180,oldAngle=(Number.isFinite(ship.pr)?ship.pr:Number(ship.rot)||0)*Math.PI/180;
    const c=Math.cos(angle),s=Math.sin(angle),oc=Math.cos(oldAngle),os=Math.sin(oldAngle);
    const dx=projectile.x-ship.x,dy=projectile.y-ship.y;
    const x1=dx*c-dy*s,y1=dx*s+dy*c;
    let x0=(px-sx)*oc-(py-sy)*os,y0=(px-sx)*os+(py-sy)*oc;
    // A wrap is a teleport at the visible edge, not a shot through the whole arena.
    if(Math.abs(projectile.x-px)>960||Math.abs(projectile.y-py)>540||Math.abs(ship.x-sx)>960||Math.abs(ship.y-sy)>540){x0=x1;y0=y1;}
    const ux=x1-x0,uy=y1-y0,r2=radius*radius;
    let inside=false;
    for(let i=0,j=SHIP_PROJECTILE_HULL.length-1;i<SHIP_PROJECTILE_HULL.length;j=i++){
      const a=SHIP_PROJECTILE_HULL[j],b=SHIP_PROJECTILE_HULL[i],ax=a[0],ay=a[1],bx=b[0],by=b[1];
      if((ay>y1)!==(by>y1)&&x1<(bx-ax)*(y1-ay)/(by-ay)+ax)inside=!inside;
      const vx=bx-ax,vy=by-ay,denominator=ux*vy-uy*vx;
      if(Math.abs(denominator)>1e-12){
        const qx=ax-x0,qy=ay-y0,t=(qx*vy-qy*vx)/denominator,u=(qx*uy-qy*ux)/denominator;
        if(t>=0&&t<=1&&u>=0&&u<=1)return true;
      }
      if(pointSegmentDistance2(x0,y0,ax,ay,bx,by)<=r2||pointSegmentDistance2(x1,y1,ax,ay,bx,by)<=r2||
        pointSegmentDistance2(ax,ay,x0,y0,x1,y1)<=r2||pointSegmentDistance2(bx,by,x0,y0,x1,y1)<=r2)return true;
    }
    return inside;
  }
  // Rocky_Asteroid_5.glb: XY silhouette extracted from its normalized mesh.
  // 111 concave contour points; raster/RDP tolerance <0.7 arena units at r=135.
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
  function giantRotation(x,y){return (Number(x)||0)*.0015+(Number(y)||0)*.001;}
  function giantSurface(g,x,y,radius=135){
    const angle=giantRotation(g.x,g.y),c=Math.cos(angle),s=Math.sin(angle);
    const dx=(x-g.x)/radius,dy=(y-g.y)/radius;
    // Three is Y-up; arena coordinates are Y-down, so the visible yaw is -angle.
    const qx=dx*c-dy*s,qy=dx*s+dy*c;
    let inside=false,best=Infinity,px=0,py=0,nx=1,ny=0;
    for(let i=0,j=GIANT_OUTLINE.length-1;i<GIANT_OUTLINE.length;j=i++){
      const a=GIANT_OUTLINE[j],b=GIANT_OUTLINE[i],vx=b[0]-a[0],vy=b[1]-a[1],len=vx*vx+vy*vy;
      if((a[1]>qy)!==(b[1]>qy)&&qx<vx*(qy-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      const t=len?Math.max(0,Math.min(1,((qx-a[0])*vx+(qy-a[1])*vy)/len)):0;
      const ex=a[0]+t*vx,ey=a[1]+t*vy,d2=(qx-ex)**2+(qy-ey)**2;
      if(d2<best){best=d2;px=ex;py=ey;const length=Math.sqrt(len)||1;nx=vy/length;ny=-vx/length;}
    }
    const d=Math.sqrt(best);
    if(d>1e-9){nx=(qx-px)/d*(inside?-1:1);ny=(qy-py)/d*(inside?-1:1);}
    return {x:g.x+radius*(px*c+py*s),y:g.y+radius*(-px*s+py*c),nx:nx*c+ny*s,ny:-nx*s+ny*c,distance:(inside?-d:d)*radius};
  }
  function giantCircleContact(g,body,bodyRadius,radius=135){
    if(!g||!body)return null;
    if(Math.hypot(body.x-g.x,body.y-g.y)>radius+bodyRadius+1)return null;
    const hit=giantSurface(g,body.x,body.y,radius);
    return hit.distance<=bodyRadius+1e-6?{...hit,depth:bodyRadius-hit.distance}:null;
  }
  function giantSegmentTime(x0,y0,x1,y1,r){
    const ux=x1-x0,uy=y1-y0,speed2=ux*ux+uy*uy;let inside=false,first=Infinity;
    for(let i=0,j=GIANT_OUTLINE.length-1;i<GIANT_OUTLINE.length;j=i++){
      const a=GIANT_OUTLINE[j],b=GIANT_OUTLINE[i],ax=a[0],ay=a[1],vx=b[0]-ax,vy=b[1]-ay,length=Math.hypot(vx,vy);
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
  function giantHitsCircle(g,body,bodyRadius,radius=135){
    if(!g||!body)return null;
    let bx=Number.isFinite(body.px)?body.px:body.x,by=Number.isFinite(body.py)?body.py:body.y;
    if(Math.abs(body.x-bx)>960||Math.abs(body.y-by)>540){bx=body.x;by=body.y;}
    const gx=Number.isFinite(g.px)?g.px:g.x,gy=Number.isFinite(g.py)?g.py:g.y;
    // Cheap broad phase around the relative motion segment, then concave contour sweep.
    if(pointSegmentDistance2(0,0,bx-gx,by-gy,body.x-g.x,body.y-g.y)>(radius+bodyRadius+1)**2)return null;
    const oldAngle=giantRotation(gx,gy),angle=giantRotation(g.x,g.y);
    const pieces=Math.max(1,Math.ceil(Math.abs(angle-oldAngle)/.04));
    const local=t=>{const a=oldAngle+(angle-oldAngle)*t,c=Math.cos(a),s=Math.sin(a),dx=(bx+(body.x-bx)*t-gx-(g.x-gx)*t)/radius,dy=(by+(body.y-by)*t-gy-(g.y-gy)*t)/radius;return [dx*c-dy*s,dx*s+dy*c];};
    let start=local(0);
    for(let i=1;i<=pieces;i++){
      const end=local(i/pieces),t=giantSegmentTime(...start,...end,bodyRadius/radius);
      if(Number.isFinite(t)){
        const at=(i-1+t)/pieces,pose={x:gx+(g.x-gx)*at,y:gy+(g.y-gy)*at};
        return {...giantSurface(pose,bx+(body.x-bx)*at,by+(body.y-by)*at,radius),t:at};
      }
      start=end;
    }
    return null;
  }
  function separateGiantShipContact(ship,giant,contact){
    const hit=contact||giantHitsCircle(giant,ship,shipCollisionRadius(ship));
    if(!hit)return {x:1,y:0};
    const gx=Number.isFinite(giant.px)?giant.px:giant.x,gy=Number.isFinite(giant.py)?giant.py:giant.y;
    const radius=shipCollisionRadius(ship)+.1;
    ship.x=hit.x+hit.nx*radius+(giant.x-gx)*(1-hit.t);
    ship.y=hit.y+hit.ny*radius+(giant.y-gy)*(1-hit.t);
    return {x:hit.nx,y:hit.ny};
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
    return true;
  }

  function resolveGiantAsteroidCollision(g,a,giantRadius,defaultRadius=45,maxSpeed=190){
    if(!g||!a||a.exiting)return false;
    const ar=Number(a.r)||defaultRadius;
    if(giantRadius===135&&!g.exiting){
      const hit=giantCircleContact(g,a,ar,giantRadius);if(!hit)return false;
      a.x+=hit.nx*(hit.depth+1.2);a.y+=hit.ny*(hit.depth+1.2);
      const closing=(a.vx-g.vx)*hit.nx+(a.vy-g.vy)*hit.ny;
      const impulse=closing<0?-1.58*closing:12;
      a.vx+=hit.nx*impulse;a.vy+=hit.ny*impulse;limitRockSpeed(a,maxSpeed);return true;
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

    a.x+=nx*(overlap+1.2);a.y+=ny*(overlap+1.2);
    const rvx=a.vx-g.vx,rvy=a.vy-g.vy,closing=rvx*nx+rvy*ny;
    if(closing<0){
      const bounce=-(1.58)*closing;
      a.vx+=nx*bounce;a.vy+=ny*bounce;
    }else{
      a.vx+=nx*12;a.vy+=ny*12;
    }

    limitRockSpeed(a,maxSpeed);
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
      if(!sweptCircles(projectile,projectileRadius,asteroid,asteroidRadius,false))continue;
      return {
        asteroid,
        index:i,
        fracture:!!projectile.guided,
        owner:Number(projectile.owner),
        impactX:Number(projectile.x)||0,
        impactY:Number(projectile.y)||0
      };
    }
    return null;
  }


  function projectileGiantHit(projectile,giant,sweptCircles,projectileRadius=4,giantRadius=135){
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
    let nx=(Number(body.x)||0)-(Number(flare.x)||0);
    let ny=(Number(body.y)||0)-(Number(flare.y)||0);
    let distance=Math.hypot(nx,ny);
    if(distance<.001){
      nx=-(Number(flare.vx)||1);ny=-(Number(flare.vy)||0);
      distance=Math.hypot(nx,ny)||1;
    }
    nx/=distance;ny/=distance;

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

    const overlap=(Number(bodyRadius)||0)+(Number(flareRadius)||0)-distance;
    if(overlap>0){
      body.x=(Number(body.x)||0)+nx*(overlap+2);
      body.y=(Number(body.y)||0)+ny*(overlap+2);
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
    GIANT_OUTLINE,giantRotation,giantSurface,giantCircleContact,giantHitsCircle,separateGiantShipContact,
    chooseSpawnSector,
    SHIELD_RADIUS,shipCollisionRadius,shipImpactPoint,separateShipContact,
    MOVEMENT_DT,stepShipMovement,createMotionStream,acceptMotionFrames,consumeMotionFrame,
    cpuSpawnEscapeControl,
    TARGET_MIN_ALIGN,
    resolveAsteroidPairCollision,
    resolveGiantAsteroidCollision,
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

