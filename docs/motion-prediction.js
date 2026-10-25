'use strict';
(() => {
  const core=window.GalaxyPhysicsCore,STEP=1000/60;
  const delta=(a,b,size)=>(b-a+size*1.5)%size-size/2;
  const neutral=()=>({turn:0,thrust:false,fire:false,directFire:false});
  class GalaxyMotionPrediction{
    constructor(){this.reset();}
    reset(){
      this.ready=false;this.epoch=0;this.tick=0;this.ack=0;this.history=[];
      this.pose=null;this.input=neutral();this.firePulse=false;this.lastAt=0;this.accumulator=0;
      this.offset={x:0,y:0,r:0};this.lastSnapshot=null;
      this.stats={correction:0,replayed:0,droppedTime:0};
      this.clearProjectiles();
    }
    clearProjectiles(){
      this.shots=[];this.seenProjectiles=new Map();this.weaponAmmo=0;
      this.weaponKnown=false;this.nextShotTick=Infinity;this.lastNormalTick=null;
    }
    weaponSnapshot(p){
      let available=Math.max(0,Math.floor(Number(p.ammo)||0));
      this.shots=this.shots.filter(s=>s.tick<=this.ack||s.confirmedId!==null||
        (!p.mira&&!Number(p.ma)&&(s.direct||!Number(p.flare)&&!p.shock)&&available-->0));
      const pending=this.shots.filter(s=>s.tick>this.ack);
      this.weaponAmmo=Math.max(0,(Number(p.ammo)||0)-pending.length);
      if(p.armed===true){
        this.weaponKnown=true;
        this.nextShotTick=pending.length?Math.max(...pending.map(s=>s.nextTick)):this.ack;
      }else if(this.lastNormalTick===null||this.nextShotTick<=this.ack)this.weaponKnown=false;
    }
    captureProjectile(frame,p,now){
      const [tick,,,fire,direct]=frame;
      if(!fire||!this.weaponKnown||!this.weaponAmmo||tick<this.nextShotTick)return;
      // A legacy press can instead launch a missile or a held special action.
      // Do not invent a normal round when that intention is ambiguous.
      if(p.mira||Number(p.ma)>0||!direct&&(Number(p.flare)>0||p.shock)){
        this.weaponKnown=false;this.nextShotTick=Infinity;return;
      }
      const direction=rotation=>{const r=rotation*Math.PI/180;return{x:-Math.sin(r),y:-Math.cos(r)};};
      const local={...this.pose,index:p.i,bullets:this.weaponAmmo,cadence:Number(p.cad)||30,reload:0,guided:false,guidedAmmo:0};
      const id='local-shot:'+p.i+':'+this.epoch+':'+tick;
      const shot=core.tryFireProjectile(local,direction(local.rot),true,false,true,false,[],direction,()=>id);
      if(!shot)return;
      // Use the actual fixed-step subtraction, including its rounding, rather
      // than rounding a cadence to a different host tick.
      let cooldown=local.reload,ticks=0;
      while(cooldown>0&&ticks<600){cooldown=Math.max(0,cooldown-1/60);ticks++;}
      this.weaponAmmo=local.bullets;this.nextShotTick=tick+ticks;this.lastNormalTick=tick;
      const visual=direction(local.rot+this.offset.r),speed=Math.hypot(shot.vx,shot.vy);
      this.shots.push({tick,direct:!!direct,nextTick:this.nextShotTick,createdAt:now,id,confirmedId:null,
        rawX:shot.x,rawY:shot.y,rawVx:shot.vx,rawVy:shot.vy,expectedAmmoAfter:this.weaponAmmo,
        x:(local.x+this.offset.x+1920)%1920+visual.x*35,y:(local.y+this.offset.y+1080)%1080+visual.y*35,
        vx:visual.x*speed,vy:visual.y*speed});
      if(this.shots.length>32)this.shots.shift();
    }
    fromPlayer(p){const m=p.motion;return{x:m.x,y:m.y,rot:m.rot,vx:m.vx,vy:m.vy,speed:Number(p.spd)||1};}
    valid(p){
      const m=p&&p.motion;
      return !!(m&&m.v===1&&Number.isSafeInteger(m.epoch)&&Number.isSafeInteger(m.ack)&&m.ack>=0&&
        ['x','y','rot','vx','vy'].every(k=>Number.isFinite(m[k]))&&!p.dead&&!(p.spawnFx>0));
    }
    reconcile(p){
      const m=p.motion;
      if(m.ack<this.ack)return;
      const old=this.pose;
      this.ack=m.ack;this.tick=Math.max(this.tick,this.ack);
      this.history=this.history.filter(f=>f[0]>this.ack);
      const next=this.fromPlayer(p);
      for(const f of this.history)core.stepShipMovement(next,{turn:f[1],thrust:!!f[2]});
      this.stats.replayed=this.history.length;
      const dx=delta(next.x,old.x,1920),dy=delta(next.y,old.y,1080),dr=delta(next.rot,old.rot,360);
      this.stats.correction=Math.hypot(dx,dy);
      // Correction is display-only: never feed it back into the next physics tick.
      if(this.stats.correction>48||Math.abs(dr)>55)this.offset={x:0,y:0,r:0};
      else{
        this.offset.x+=dx;this.offset.y+=dy;this.offset.r+=dr;
        if(Math.hypot(this.offset.x,this.offset.y)>48||Math.abs(this.offset.r)>55)this.offset={x:0,y:0,r:0};
      }
      this.pose=next;
      this.weaponSnapshot(p);
    }
    advance(now,p,input){
      if(!this.valid(p)){this.reset();return;}
      if(!this.ready||this.epoch!==p.motion.epoch){
        this.reset();this.ready=true;this.epoch=p.motion.epoch;this.tick=this.ack=p.motion.ack;
        this.pose=this.fromPlayer(p);this.lastAt=now;this.lastSnapshot=p;
        this.weaponSnapshot(p);
        this.input={...input};this.firePulse=!!input.fire;return;
      }
      // Input events use performance.now(); an already scheduled RAF may carry
      // an older timestamp. Never move the prediction clock backwards.
      const elapsed=Math.max(0,now-this.lastAt);this.lastAt=Math.max(this.lastAt,now);
      if(elapsed>250)this.clearProjectiles();
      const decay=Math.exp(-12*elapsed/1000);
      this.offset.x*=decay;this.offset.y*=decay;this.offset.r*=decay;
      this.accumulator+=Math.min(100,elapsed);
      if(elapsed>100)this.stats.droppedTime+=elapsed-100;
      let count=0;
      while(this.accumulator+1e-7>=STEP&&count<6&&this.history.length<120){
        const f=[++this.tick,this.input.turn,this.input.thrust?1:0,(this.input.fire||this.firePulse)?1:0,this.input.directFire?1:0];
        this.firePulse=false;this.history.push(f);
        core.stepShipMovement(this.pose,{turn:f[1],thrust:!!f[2]});
        this.captureProjectile(f,this.lastSnapshot,now);
        this.accumulator=Math.max(0,this.accumulator-STEP);count++;
      }
      if(this.accumulator>=STEP){this.stats.droppedTime+=this.accumulator;this.accumulator=0;}
      if(p!==this.lastSnapshot){this.reconcile(p);this.lastSnapshot=p;}
      if(input.fire&&!this.input.fire)this.firePulse=true;
      this.input={...input};
    }
    packet(){return {v:1,epoch:this.epoch,frames:this.history.slice(-60)};}
    projectiles(player,authoritativeBullets,now){
      const own=(Array.isArray(authoritativeBullets)?authoritativeBullets:[]).filter(b=>b&&Number(b.o??b.owner)===Number(player?.i)&&!b.g&&!b.guided&&['x','y','vx','vy'].every(k=>Number.isFinite(b[k])));
      if(!this.ready||!this.valid(player)||player.motion.epoch!==this.epoch){this.clearProjectiles();return own.map(b=>({...b}));}
      const time=Number.isFinite(now)?Math.max(now,this.lastAt):this.lastAt,ack=player.motion.ack;
      const fraction=this.accumulator/STEP,lead=Math.max(0,Math.min(.25,(this.tick-ack+fraction)/60));
      const byId=new Map(own.map(b=>[b.id,b])),fresh=[];
      for(const b of own)if(!this.seenProjectiles.has(b.id)){this.seenProjectiles.set(b.id,time);fresh.push(b);}
      for(const [id,at] of this.seenProjectiles)if(!byId.has(id)&&time-at>3000||this.seenProjectiles.size>128)this.seenProjectiles.delete(id);
      const used=new Set(this.shots.filter(s=>s.confirmedId!==null).map(s=>s.confirmedId));
      let denied=false;
      this.shots=this.shots.filter(s=>{
        const age=(this.tick-s.tick+1+fraction)/60;
        if(age>=3||time-s.createdAt>3000)return false;
        if(s.confirmedId!==null)return byId.has(s.confirmedId);
        if(s.tick>ack)return true;
        const confirmedAge=(ack-s.tick+1)/60,ex=s.rawX+s.rawVx*confirmedAge,ey=s.rawY+s.rawVy*confirmedAge;
        let match=null,best=24;
        for(const b of fresh){
          if(used.has(b.id))continue;
          const speed=Math.hypot(b.vx,b.vy),rawSpeed=Math.hypot(s.rawVx,s.rawVy);
          if(Math.abs(speed-rawSpeed)>1||(b.vx*s.rawVx+b.vy*s.rawVy)<speed*rawSpeed*.9994)continue;
          const error=Math.hypot(b.x-ex,b.y-ey);if(error<best){best=error;match=b;}
        }
        if(match){s.confirmedId=match.id;used.add(match.id);return true;}
        // An accepted shot may already have hit an obstacle. Ammo confirms its
        // cooldown, but no predicted projectile or impact survives the ACK.
        if(Number(player.ammo)>s.expectedAmmoAfter)denied=true;
        return false;
      });
      if(denied){
        this.shots=this.shots.filter(s=>s.confirmedId!==null);
        this.weaponKnown=player.armed===true;this.nextShotTick=this.weaponKnown?ack:Infinity;
        this.weaponAmmo=Math.max(0,Number(player.ammo)||0);
      }
      const result=own.filter(b=>time-(this.seenProjectiles.get(b.id)??time)<=3000).map(b=>({...b,x:b.x+b.vx*lead,y:b.y+b.vy*lead}));
      for(const s of this.shots)if(s.confirmedId===null){
        const age=(this.tick-s.tick+1+fraction)/60;
        result.push({id:s.id,o:player.i,owner:player.i,x:s.x+s.vx*age,y:s.y+s.vy*age,vx:s.vx,vy:s.vy,g:false,guided:false,gt:-1,target:-1,wt:-1,predicted:true});
      }
      return result;
    }
    sample(){
      if(!this.ready)return null;
      const pose={...this.pose};
      if(this.accumulator>0)core.stepShipMovement(pose,this.input,this.accumulator/1000);
      return{x:(pose.x+this.offset.x+1920)%1920,y:(pose.y+this.offset.y+1080)%1080,
        r:(pose.rot+this.offset.r+360)%360,vx:pose.vx,vy:pose.vy};
    }
  }
  const normalOwn=(b,owner)=>!!b&&Number(b.o??b.owner)===Number(owner)&&!b.g&&!b.guided;
  const point=o=>!!o&&Number.isFinite(o.x)&&Number.isFinite(o.y);
  function circleShotTime(body,obstacle,radius){
    const x=body.px-obstacle.x,y=body.py-obstacle.y,dx=body.x-body.px,dy=body.y-body.py;
    const c=x*x+y*y-radius*radius;if(c<=0)return 0;
    const a=dx*dx+dy*dy;if(a<=1e-18)return Infinity;
    const b=2*(x*dx+y*dy),disc=b*b-4*a*c;if(disc<0)return Infinity;
    const t=(-b-Math.sqrt(disc))/(2*a);return t>=0&&t<=1?t:Infinity;
  }
  // A separate presentation mask survives movement-prediction resets in
  // fallback. It never consumes ammunition, changes the shot ledger or emits FX.
  class GalaxyShotOcclusion{
    constructor(){this.reset();}
    reset(){this.context=null;this.owner=null;this.epoch=null;this.records=new Map();this.aliases=new Map();this.lastNow=null;}
    forget(record){
      this.records.delete(record.key);
      for(const id of record.ids)if(this.aliases.get(id)===record)this.aliases.delete(id);
    }
    bind(record,id){if(id!==undefined&&id!==null){record.ids.add(id);this.aliases.set(id,record);}}
    join(a,b){
      if(!a)return b;if(!b||a===b)return a;
      const keep=a.blocked?a:b.blocked?b:a,drop=keep===a?b:a;
      for(const id of drop.ids)this.bind(keep,id);
      this.records.delete(drop.key);return keep;
    }
    geometry(scene,owner,playerVisible){
      const result=[],circle=(body,radius)=>{if(point(body)&&radius>0)result.push({kind:'circle',body,radius});};
      for(const a of scene.asteroids||[]){
        if(!point(a))continue;
        const spin=Number.isFinite(a.s)?a.s:a.spin;
        const pinned={...a,px:a.x,py:a.y,spin,pspin:spin};
        if(core.isMediumRock(pinned))result.push({kind:'medium',body:pinned});
        else circle(pinned,Number(a.r)||17);
      }
      if(point(scene.giant))result.push({kind:'giant',body:{...scene.giant,px:scene.giant.x,py:scene.giant.y}});
      for(const m of scene.meteors||[])circle(m,14);
      const ufos=Array.isArray(scene.ufos)?scene.ufos:scene.ufo?[scene.ufo]:[];
      for(const u of ufos)circle(u,30);
      for(const p of scene.pickups||[])circle(p,22);
      for(const f of scene.flares||[])circle(f,12);
      for(const b of scene.bullets||[])if((b.g||b.guided)&&Number(b.o??b.owner)!==Number(owner))circle(b,12);
      for(const p of scene.players||[]){
        if(!point(p)||Number(p.i)===Number(owner)||p.dead||Number(p.prot??p.protection)>0||Number(p.spawnFx)>0||
          typeof playerVisible==='function'&&!playerVisible(p))continue;
        const bank=Number(p.b??p.bank)||0,rotation=Number(p.r??p.rot)||0,time=Number(scene.simTime)||0;
        result.push({kind:'ship',body:{...p,index:p.i,rot:rotation,pr:rotation,bank,pbank:bank,px:p.x,py:p.y,
          poseTime:time,previousPoseTime:time,motionSpeed:Math.hypot(Number(p.vx)||0,Number(p.vy)||0)}});
      }
      return result;
    }
    contact(geometry,body,radius){
      // Existing outline queries discard arena-wrap jumps. Shots never wrap,
      // so split unusually long first samples into ordinary linear segments.
      const pieces=Math.max(1,Math.min(64,Math.ceil(Math.max(Math.abs(body.x-body.px)/900,Math.abs(body.y-body.py)/500))));
      for(let i=0;i<pieces;i++){
        const a=i/pieces,b=(i+1)/pieces,segment={px:body.px+(body.x-body.px)*a,py:body.py+(body.y-body.py)*a,
          x:body.px+(body.x-body.px)*b,y:body.py+(body.y-body.py)*b};
        let first=Infinity;
        for(const obstacle of geometry){
          let t=Infinity;
          if(obstacle.kind==='circle')t=circleShotTime(segment,obstacle.body,obstacle.radius+radius);
          else{
            const hit=obstacle.kind==='giant'?core.giantHitsCircle(obstacle.body,segment,radius):
              obstacle.kind==='ship'?core.shipHitsCircle(obstacle.body,segment,radius):
                core.asteroidHitsCircle(obstacle.body,segment,radius,()=>false);
            if(hit)t=Number.isFinite(hit.t)?hit.t:0;
          }
          first=Math.min(first,t);
        }
        if(Number.isFinite(first))return (i+first)/pieces;
      }
      return Infinity;
    }
    filter(visibleState,ownerIndex,now,{prediction,authoritative=visibleState,front=4,tail=7.5,radius=4,playerVisible}={}){
      const bullets=Array.isArray(visibleState?.bullets)?visibleState.bullets:[],authority=authoritative||visibleState||{};
      const owner=(authority.players||[]).find(p=>Number(p.i)===Number(ownerIndex));
      const epoch=owner?.motion?.epoch??null,context=[authority.code,authority.seriesId,authority.hostEpoch,authority.round??authority.rankRound].join(':');
      const time=Number.isFinite(now)?now:0;
      if(this.context!==context||this.owner!==ownerIndex||this.epoch!==epoch||this.lastNow!==null&&time<this.lastNow)this.reset();
      this.context=context;this.owner=ownerIndex;this.epoch=epoch;this.lastNow=time;
      const predicted=!!(prediction?.ready&&Number.isFinite(prediction.tick)&&Number.isFinite(owner?.motion?.ack)&&
        (!Number.isFinite(prediction.epoch)||!Number.isFinite(epoch)||prediction.epoch===epoch));
      const simClock=(Number(authority.simTime)||0)*60,ack=Number(owner?.motion?.ack)||0;
      const clock=predicted?prediction.tick+Math.max(0,Math.min(1,(Number(prediction.accumulator)||0)/STEP)):simClock;
      const confirm=predicted?ack:simClock,mode=predicted?'command':'sim';
      const actual=new Map((authority.bullets||[]).filter(b=>normalOwn(b,ownerIndex)&&!b.predicted).map(b=>[b.id,b]));
      const shots=Array.isArray(prediction?.shots)?prediction.shots:[];
      for(const shot of shots){
        let record=this.join(this.aliases.get(shot.id),this.aliases.get(shot.confirmedId));
        if(!record)continue;
        this.bind(record,shot.id);this.bind(record,shot.confirmedId);
        if(shot.confirmedId!==null&&shot.confirmedId!==undefined)record.realId=shot.confirmedId;
      }
      for(const record of this.records.values())if(time-record.lastSeen>3500)this.forget(record);
      if(!bullets.some(b=>normalOwn(b,ownerIndex))){
        for(const record of this.records.values())if(![...record.ids].some(id=>actual.has(id)||shots.some(s=>s.id===id||s.confirmedId===id)))this.forget(record);
        return bullets;
      }
      front=Math.max(0,Number(front)||0);tail=Math.max(0,Number(tail)||0);radius=Math.max(0,Number(radius)||0);
      let obstacles=null;
      const hit=body=>this.contact(obstacles||(obstacles=this.geometry(visibleState,ownerIndex,playerVisible)),body,radius);
      const keep=[];
      for(const bullet of bullets){
        if(!normalOwn(bullet,ownerIndex)||!point(bullet)||!Number.isFinite(bullet.vx)||!Number.isFinite(bullet.vy)){keep.push(bullet);continue;}
        const shot=shots.find(s=>s.id===bullet.id||s.confirmedId===bullet.id);
        let record=this.aliases.get(bullet.id)||(shot&&this.aliases.get(shot.id));
        if(!record){record={key:shot?.id??bullet.id,ids:new Set(),blocked:false,previous:null,lastSeen:time,realId:null,shotTick:null};this.records.set(record.key,record);}
        this.bind(record,bullet.id);
        if(shot){this.bind(record,shot.id);this.bind(record,shot.confirmedId);if(Number.isFinite(shot.tick))record.shotTick=shot.tick;}
        if(actual.has(bullet.id))record.realId=bullet.id;
        record.lastSeen=time;
        const speed=Math.hypot(bullet.vx,bullet.vy)||1,nx=bullet.vx/speed,ny=bullet.vy/speed;
        const end={x:bullet.x+nx*front,y:bullet.y+ny*front};
        const stroke={px:bullet.x-nx*tail,py:bullet.y-ny*tail,...end};
        const previous=record.previous;
        if(record.blocked){
          const raw=actual.get(record.realId),fresh=Number(authority.seq)>record.blockSeq||simClock>record.blockSim||ack>record.blockAck;
          const contactClock=record.contactMode===mode?record.contactTick:record.contactSimTick;
          const confirmedClock=record.contactMode===mode?confirm:simClock;
          if(raw&&point(raw)&&fresh&&confirmedClock+1e-7>=contactClock&&
            !Number.isFinite(hit({px:raw.x,py:raw.y,...end}))&&!Number.isFinite(hit(stroke))){
            record.blocked=false;keep.push(bullet);
          }
        }else{
          const raw=actual.get(record.realId);
          const birth=shot&&Number.isFinite(shot.x)&&Number.isFinite(shot.y)?shot:null;
          const start=previous||birth&&{x:birth.x,y:birth.y,clock:(Number(shot.tick)||clock)-1,mode}||raw&&{x:raw.x,y:raw.y,clock:confirm,mode}||{x:bullet.x,y:bullet.y,clock,mode};
          let startClock=start.clock;
          if(start.mode!==mode)startClock=mode==='sim'?start.simClock+start.clock-start.ack:ack+start.clock-simClock;
          startClock=Math.min(clock,Number.isFinite(startClock)?startClock:clock);
          const sweep=hit({px:start.x,py:start.y,...end}),trace=hit(stroke);
          if(Number.isFinite(sweep)||Number.isFinite(trace)){
            let contactTick=Number.isFinite(sweep)?Math.ceil(startClock+(clock-startClock)*sweep-1e-7):Math.ceil(clock-1e-7);
            if(Number.isFinite(record.shotTick))contactTick=Math.max(contactTick,record.shotTick);
            record.blocked=true;record.contactTick=contactTick;record.contactMode=mode;
            record.contactSimTick=predicted?simClock+contactTick-ack:contactTick;
            record.blockSeq=Number(authority.seq)||0;record.blockSim=simClock;record.blockAck=ack;
          }else keep.push(bullet);
        }
        // A successful recovery starts a new incremental segment here, never
        // another ray from the original muzzle through an old obstacle pose.
        record.previous={x:bullet.x,y:bullet.y,clock,mode,simClock,ack};
      }
      while(this.records.size>128)this.forget(this.records.values().next().value);
      return keep;
    }
  }
  window.GalaxyMotionPrediction=GalaxyMotionPrediction;
  window.GalaxyShotOcclusion=GalaxyShotOcclusion;
})();
