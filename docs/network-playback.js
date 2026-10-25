/* Presentation only. Authoritative states, inputs and collisions are never changed. */
'use strict';
(() => {
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const wrapDelta=(a,b,size)=>(b-a+size*1.5)%size-size*.5;
  const turn=(a,b,size)=>a+wrapDelta(a,b,size);
  const fields={players:['i',true,'r'],asteroids:['id',false,'s'],bullets:['id',true],flares:['id',false,'a'],pickups:['id'],meteors:['id',false,'a'],ufos:['id']};
  class GalaxyNetworkPlayback{
    constructor({delayMs=80,maxDelayMs=180,maxSnapshots=12}={}){
      this.delayMs=clamp(Number(delayMs)||80,40,180);
      this.maxDelayMs=Math.max(this.delayMs,clamp(Number(maxDelayMs)||180,80,500));
      this.maxSnapshots=clamp(Math.round(Number(maxSnapshots)||12),4,24);this.reset();
    }
    reset(){this.snapshots=[];this.context='';this.cursor=null;this.lastNow=null;this.lastArrival=null;this.rate=1;this.lookups=new WeakMap();this.resynced=false;}
    push(state,arrivalNow){
      if(!state||!Number.isFinite(state.simTime)||!Number.isFinite(arrivalNow))return false;
      const time=state.simTime*1000,context=[state.code,state.seriesId,state.hostEpoch,state.round??state.rankRound].join(':');
      const prior=this.snapshots.at(-1)?.state;
      if(prior&&prior.code===state.code&&prior.seriesId===state.seriesId){
        if(Number.isFinite(prior.hostEpoch)&&Number.isFinite(state.hostEpoch)&&state.hostEpoch<prior.hostEpoch)return false;
        if(state.hostEpoch===prior.hostEpoch&&Number.isFinite(prior.round??prior.rankRound)&&Number.isFinite(state.round??state.rankRound)&&(state.round??state.rankRound)<(prior.round??prior.rankRound))return false;
      }
      if(this.context!==context){this.reset();this.context=context;}
      const last=this.snapshots.at(-1);
      if(last&&((Number.isFinite(state.seq)&&Number.isFinite(last.state.seq)&&state.seq<=last.state.seq)||time<last.time))return false;
      // Suspension/rejoin or a large simulation jump starts a fresh playback
      // window; ordinary jitter never repositions the rendering clock.
      if(last&&(arrivalNow-this.lastArrival>1500||time-last.time>1500)){this.reset();this.context=context;this.resynced=true;}
      const current=this.snapshots.at(-1);
      if(current&&current.time===time)this.snapshots[this.snapshots.length-1]={state,time};
      else this.snapshots.push({state,time});
      this.lastArrival=arrivalNow;
      if(this.cursor===null){this.cursor=time-this.delayMs;this.lastNow=arrivalNow;}
      // Large loss bursts require a bounded resynchronization rather than
      // replaying seconds of obsolete action. Callers can clear cosmetic trails
      // when resynced is returned. Normal jitter stays inside the 180 ms window.
      if(time-this.cursor>this.maxDelayMs){this.cursor=time-this.maxDelayMs;this.rate=1;this.resynced=true;}
      if(this.snapshots.length>this.maxSnapshots){
        this.snapshots.splice(0,this.snapshots.length-this.maxSnapshots);
        if(this.cursor<this.snapshots[0].time){this.cursor=this.snapshots[0].time;this.resynced=true;}
      }
      return true;
    }
    lookup(state,field,key){
      let cached=this.lookups.get(state);if(!cached){cached={};this.lookups.set(state,cached);}
      if(!cached[field])cached[field]=new Map((state[field]||[]).map(item=>[item[key],item]));
      return cached[field];
    }
    entity(a,b,alpha,wrapped=false,angle){
      if(!a||!b)return a;
      const result={...a};
      for(const [field,size] of [['x',1920],['y',1080]])if(Number.isFinite(a[field])&&Number.isFinite(b[field])){
        const delta=wrapped?wrapDelta(a[field],b[field],size):b[field]-a[field];
        const value=a[field]+delta*alpha;result[field]=wrapped?(value+size)%size:value;
      }
      if(angle&&Number.isFinite(a[angle])&&Number.isFinite(b[angle])){
        const period=angle==='s'?Math.PI*2:360;result[angle]=a[angle]+(turn(a[angle],b[angle],period)-a[angle])*alpha;
      }
      // Bank is bounded to +/-60 degrees, so it never crosses a period boundary.
      if(Number.isFinite(a.b)&&Number.isFinite(b.b))result.b=a.b+(b.b-a.b)*alpha;
      return result;
    }
    sample(now){
      if(!this.snapshots.length||!Number.isFinite(now))return null;
      const latest=this.snapshots.at(-1),elapsed=Math.max(0,now-this.lastNow);
      if(elapsed>500){this.cursor=Math.max(this.cursor,latest.time-this.delayMs);this.rate=1;this.resynced=true;}
      const dt=Math.min(100,elapsed);this.lastNow=Math.max(this.lastNow,now);
      const error=latest.time-this.delayMs-this.cursor;
      // Recover buffer depth by a small speed adjustment, never an arrival-time
      // alpha reset. A stalled connection stops at the last known pose.
      const wanted=1+clamp(error/1000,-.06,error>this.maxDelayMs?.15:.08);
      this.rate+=(wanted-this.rate)*(1-Math.exp(-dt/200));
      this.cursor=Math.min(latest.time,this.cursor+dt*this.rate);
      while(this.snapshots.length>2&&this.snapshots[1].time<=this.cursor)this.snapshots.shift();
      let lower=this.snapshots[0],upper=lower;
      for(let i=1;i<this.snapshots.length;i++){
        upper=this.snapshots[i];if(upper.time>this.cursor)break;lower=upper;
      }
      const time=clamp(this.cursor,lower.time,upper.time),span=upper.time-lower.time,alpha=span?clamp((time-lower.time)/span,0,1):0;
      const state={...lower.state,simTime:time/1000};
      // Metadata/topology comes from the lower simulation tick. A new object,
      // death or ammunition change becomes visible when playback reaches it.
      for(const [field,[key,wrapped,angle]] of Object.entries(fields))if(Array.isArray(lower.state[field])){
        const next=this.lookup(upper.state,field,key);
        state[field]=lower.state[field].map(a=>this.entity(a,next.get(a[key]),alpha,wrapped,angle));
      }
      for(const field of ['giant','ufo'])if(lower.state[field]&&upper.state[field]&&(!lower.state[field].id||lower.state[field].id===upper.state[field].id))state[field]=this.entity(lower.state[field],upper.state[field],alpha);
      const result={state,previous:lower.state,next:upper.state,alpha,simTime:state.simTime,buffered:Math.max(0,latest.time-time),stalled:this.cursor>=latest.time,resynced:this.resynced};
      this.resynced=false;return result;
    }
  }
  window.GalaxyNetworkPlayback=GalaxyNetworkPlayback;
})();
