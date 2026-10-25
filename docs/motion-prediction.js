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
  window.GalaxyMotionPrediction=GalaxyMotionPrediction;
})();
