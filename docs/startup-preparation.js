'use strict';
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.GalaxyStartPreparation=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const warmups=new WeakMap();
  // Only the authority releases play. Guests animate a local clock but wait
  // for the confirmed GO; no message is sent for individual digits.
  return class GalaxyStartPreparation{
    static warmSimulation(Engine,{mode='cpu',difficulty='facil',frame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),valid=()=>true}={}){
      if(!Engine?.withPreparationIds)return Promise.resolve(true);
      let cache=warmups.get(Engine);if(!cache){cache=new Map();warmups.set(Engine,cache);}
      const key=mode+':'+difficulty;if(cache.has(key))return cache.get(key);
      const task=(async()=>{
        let cursor=1,seed=0x6d2b79f5,motor;
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
            run(()=>{for(let tick=0;tick<10;tick++)motor.update(1/60);});
            await frame();
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
