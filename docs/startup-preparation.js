'use strict';
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.GalaxyStartPreparation=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const warmups=new WeakMap();
  function contactWarmup(core){
    if(!core?.shipPairContact||!core?.asteroidShipContact)return null;
    // Owned, stationary fixtures trigger the real narrow phase. Randomly
    // separated shadow players rarely touch anything during the first 2s.
    const a={},b={},rock={},bullet={},flare={};
    return step=>{
      const pose=Math.floor(step/3),kind=step%3;
      if(kind===0){
        const rot=pose*30,bank=(-60+pose*120/11)*Math.PI/180;
        Object.assign(a,{index:0,x:960,y:540,px:960,py:540,rot,pr:rot,bank,previousBank:bank,vx:0,vy:0,dead:false,shield:0,protection:0});
        Object.assign(b,{index:1,x:960,y:560,px:960,py:560,rot,pr:rot,bank:-bank,previousBank:-bank,vx:0,vy:0,dead:false,shield:0,protection:0});
        Object.assign(rock,{id:-1,x:978,y:544,px:978,py:544,r:core.MEDIUM_ROCK_RADII?.[pose%3]||52,spin:pose*Math.PI/6,pspin:pose*Math.PI/6,vx:0,vy:0});
        core.shipPairContact(a,b);
      }else if(kind===1)core.asteroidShipContact(rock,a,false,false);
      else{
        Object.assign(bullet,{x:960,y:590,px:960,py:490});
        Object.assign(flare,{x:975,y:540,px:940,py:540});
        core.projectileHitsShipHull?.(bullet,a,4);
        core.shipHitsCircle?.(a,flare,12);
        core.asteroidHitsCircle?.(rock,flare,12);
      }
    };
  }
  // Only the authority releases play. Guests animate a local clock but wait
  // for the confirmed GO; no message is sent for individual digits.
  return class GalaxyStartPreparation{
    static warmSimulation(Engine,{mode='cpu',difficulty='facil',frame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),valid=()=>true,now=()=>performance.now(),budgetMs=4}={}){
      if(!Engine?.withPreparationIds)return Promise.resolve(true);
      let cache=warmups.get(Engine);if(!cache){cache=new Map();warmups.set(Engine,cache);}
      const key=mode+':'+difficulty;if(cache.has(key))return cache.get(key);
      const task=(async()=>{
        let cursor=1,seed=0x6d2b79f5,motor;
        const contacts=contactWarmup(globalThis.GalaxyPhysicsCore||globalThis.window?.GalaxyPhysicsCore);
        const budget=Math.max(1,Math.min(8,Number(budgetMs)||4));let sliceAt=now();
        const run=work=>{
          const original=Math.random;
          Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
          try{const result=Engine.withPreparationIds(cursor,work);cursor=result.cursor;return result.value;}
          finally{Math.random=original;}
        };
        try{
          motor=run(()=>{
            const shadow=new Engine({code:'',rankHostToken:'',onState(){},onEvent(){},renderEveryStep:false});
            if(mode==='host')shadow.start(Array.from({length:4},(_,i)=>({i,n:'PRELOAD',cpu:true})));
            else shadow.start('PRELOAD',difficulty,3,null,false,1);
            for(const p of shadow.players){p.protection=0;p.spawnFx=0;}
            return shadow;
          });
          for(let batch=0;batch<12;batch++){
            if(!valid())return false;
            for(let tick=0;tick<10;tick++){
              if(!valid())return false;
              // Interactive play serializes a snapshot every physics frame;
              // the previous warm-up exercised update() alone.
              run(()=>{motor.update(1/60);motor.publicState?.();});
              if(now()-sliceAt>=budget){await frame();sliceAt=now();}
            }
            for(let kind=0;contacts&&kind<3;kind++){
              if(!valid())return false;
              run(()=>contacts(batch*3+kind));
              if(now()-sliceAt>=budget){await frame();sliceAt=now();}
            }
            await frame();sliceAt=now();
          }
          return true;
        }finally{motor?.stop();}
      })();
      cache.set(key,task);task.then(ok=>{if(!ok)cache.delete(key);},()=>cache.delete(key));return task;
    }
    constructor({key,authority=false,peers=[],minimum=3000,countdown=3000,now=()=>performance.now(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id),onChange=()=>{},onGo=()=>{}}={}){
      Object.assign(this,{key,authority,minimum,countdown,now,schedule,cancelTimer:cancel,onChange,onGo});
      this.phase='preparing';this.startedAt=now();this.countdownAt=0;this.deadline=Infinity;this.goAt=0;
      this.localReady=false;this.required=new Set(peers);this.ready=new Set();this.timer=null;this.pending=null;
    }
    get blocked(){return this.phase==='preparing'||this.phase==='countdown';}
    start(){this.onChange(this);}
    setPeers(peers){this.required=new Set(peers);this.maybeStart();}
    markLocalReady(){
      if(this.phase==='cancelled'||this.localReady)return;
      this.localReady=true;
      if(this.authority)this.maybeStart();
      else if(this.pending){const p=this.pending;this.pending=null;this.apply({...p.packet,remainingMs:Math.max(0,p.end-this.now())});}
    }
    peerReady(index){if(this.required.has(index)){this.ready.add(index);this.maybeStart();}}
    maybeStart(){
      if(!this.authority||this.phase!=='preparing'||!this.localReady||[...this.required].some(i=>!this.ready.has(i)))return;
      if(this.timer!==null)this.cancelTimer(this.timer);
      const wait=Math.max(0,this.startedAt+this.minimum-this.now());
      if(wait){this.timer=this.schedule(()=>{this.timer=null;this.maybeStart();},wait);return;}
      this.phase='countdown';this.countdownAt=this.now();this.deadline=this.countdownAt+this.countdown;
      this.timer=this.schedule(()=>{this.timer=null;this.release();},this.countdown);
      this.onChange(this);
    }
    release(){
      if(this.phase==='cancelled'||this.phase==='go'||!this.localReady)return;
      if(this.timer!==null){this.cancelTimer(this.timer);this.timer=null;}
      this.phase='go';this.goAt=this.now();this.deadline=Math.min(this.deadline,this.goAt);
      this.onChange(this);this.onGo();
    }
    snapshot(){return {v:1,key:this.key,phase:this.phase,remainingMs:this.phase==='countdown'?Math.max(0,Math.ceil(this.deadline-this.now())):0};}
    apply(packet){
      if(this.authority||this.phase==='cancelled'||!packet||packet.v!==1||packet.key!==this.key||!['preparing','countdown','go'].includes(packet.phase)||!Number.isFinite(packet.remainingMs)||packet.remainingMs<0||packet.remainingMs>this.countdown)return false;
      if(this.phase==='go'||packet.phase==='preparing')return true;
      if(!this.localReady){this.pending={packet,end:this.now()+packet.remainingMs};return true;}
      if(packet.phase==='go'){this.release();return true;}
      const deadline=this.now()+packet.remainingMs;
      if(this.phase==='countdown'){this.deadline=Math.min(this.deadline,deadline);return true;}
      this.phase='countdown';this.countdownAt=this.now();this.deadline=deadline;this.onChange(this);return true;
    }
    cancel(){
      if(this.timer!==null)this.cancelTimer(this.timer);
      this.timer=null;this.phase='cancelled';this.pending=null;
    }
  };
});
