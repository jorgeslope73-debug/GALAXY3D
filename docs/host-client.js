/* Local transport for the online host's player. The authoritative engine never waits. */
'use strict';
(() => {
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const median=values=>{const sorted=values.slice().sort((a,b)=>a-b),at=Math.floor(sorted.length/2);return sorted.length%2?sorted[at]:(sorted[at-1]+sorted[at])/2;};
  const key=p=>[p?.seriesId,p?.hostEpoch,p?.rankRound??p?.round].join(':');
  let probeSequence=0;
  class GalaxyHostClient {
    constructor({context,peers=[],now=()=>performance.now(),onControl=()=>{},onAction=()=>{},onState=()=>{},onEvent=()=>{},initialRtt=80,maxRtt=180}={}){
      Object.assign(this,{now,onControl,onAction,onState,onEvent});
      this.initialRtt=clamp(Number(initialRtt)||80,0,180);this.maxRtt=clamp(Number(maxRtt)||180,40,240);
      this.active=true;this.peers=new Set(peers.map(Number));this.samples=new Map();this.probes=new Map();
      this.delayMs=this.peers.size?this.initialRtt/2:0;this.lastUpdate=now();this.nextProbeAt=0;this.probe=null;
      this.stats={rttMs:this.peers.size?this.initialRtt:0,measuredPeers:0,deliveredControls:0,deliveredStates:0,staleInputs:0};
      this.setContext(context||{});
    }
    setContext(context){
      const next=key(context);if(this.contextKey===next)return;
      this.context={...context};this.contextKey=next;this.inputs=[];this.views=[];this.actions=new Map();
      this.controlSeq=-1;this.inputDue=0;this.viewDue=0;this.viewGate=null;this.startUiPending=false;this.probes.clear();this.probe=null;this.nextProbeAt=0;
    }
    matches(packet){return this.active&&key(packet)===this.contextKey;}
    setPeers(peers){
      this.peers=new Set(peers.map(Number).filter(Number.isInteger));
      for(const index of this.samples.keys())if(!this.peers.has(index))this.samples.delete(index);
      for(const index of this.probes.keys())if(!this.peers.has(index))this.probes.delete(index);
    }
    update(now=this.now()){
      const elapsed=clamp(now-this.lastUpdate,0,250);this.lastUpdate=Math.max(now,this.lastUpdate);
      const values=[];
      for(const index of this.peers){
        const fresh=(this.samples.get(index)||[]).filter(s=>now-s.at<=10000);
        this.samples.set(index,fresh);if(fresh.length)values.push(median(fresh.map(s=>s.rtt)));
      }
      const rtt=this.peers.size?(values.length?median(values):this.initialRtt):0;
      this.stats.rttMs=rtt;this.stats.measuredPeers=values.length;
      const target=clamp(rtt,0,this.maxRtt)/2;
      // Smooth changes instead of moving the client's clock when a probe arrives.
      const step=elapsed*.02;
      this.delayMs=this.peers.size?this.delayMs+clamp(target-this.delayMs,-step,step):0;
      if(this.viewGate?.phase==='countdown'&&now>=this.viewGate.deadline){
        this.viewGate.phase='go';this.viewGate.goAt=this.viewGate.deadline;this.viewGate.blocked=false;
      }
      return this.delayMs;
    }
    decorateState(packet,now=this.now()){
      if(!this.active)return packet;
      this.update(now);
      if(this.peers.size&&now>=this.nextProbeAt){
        const id=++probeSequence;this.probe={v:1,id,until:now+200};this.nextProbeAt=now+2000;
        for(const index of this.peers)this.probes.set(index,{id,at:now});
      }
      return this.probe&&now<=this.probe.until?{...packet,linkProbe:{v:1,id:this.probe.id}}:packet;
    }
    pong(index,id,now=this.now()){
      const pending=this.probes.get(Number(index));
      if(!this.active||!this.peers.has(Number(index))||!Number.isSafeInteger(id)||!pending||pending.id!==id)return false;
      const rtt=now-pending.at;if(!Number.isFinite(rtt)||rtt<0||rtt>3000)return false;
      this.probes.delete(Number(index));
      const samples=this.samples.get(Number(index))||[];samples.push({at:now,rtt});
      this.samples.set(Number(index),samples.slice(-5));this.update(now);return true;
    }
    enqueueInput(kind,packet,now=this.now()){
      if(!this.matches(packet)||!['control','action'].includes(kind))return false;
      if(kind==='control'){
        if(!Number.isSafeInteger(packet.controlSeq)||packet.controlSeq<=this.controlSeq)return false;
      }else{
        const actionKey=packet.inputSessionId+':'+packet.kind,last=this.actions.get(actionKey)||0;
        if(!Number.isSafeInteger(packet.actionId)||packet.actionId<1)return false;
        if(packet.actionId<=last)return true;
      }
      if(this.inputs.length>=64)return false;
      this.update(now);this.inputDue=Math.max(this.inputDue,now+this.delayMs);
      this.inputs.push({kind,packet,at:now,due:this.inputDue});
      if(kind==='control')this.controlSeq=packet.controlSeq;
      else this.actions.set(packet.inputSessionId+':'+packet.kind,packet.actionId);
      return true;
    }
    flushInputs(now=this.now()){
      if(!this.active)return;this.update(now);
      while(this.active&&this.inputs.length&&this.inputs[0].due<=now){
        const entry=this.inputs.shift();
        if(!this.matches(entry.packet))continue;
        // A background tab must never revive old held keys or expired actions.
        if(now-entry.at>(entry.kind==='control'?300:2000)){this.stats.staleInputs++;continue;}
        if(entry.kind==='control'){this.stats.deliveredControls++;this.onControl(entry.packet);}
        else this.onAction(entry.packet);
      }
    }
    enqueueView(kind,packet,now=this.now()){
      if(!this.matches(packet)||!['state','event'].includes(kind))return false;
      if(this.views.length>=64){
        const at=this.views.findIndex(entry=>entry.kind==='state');if(at<0)return false;this.views.splice(at,1);
      }
      this.update(now);this.viewDue=Math.max(this.viewDue,now+this.delayMs);
      this.views.push({kind,packet,due:this.viewDue});return true;
    }
    applyGate(packet,now){
      const gate=packet.startGate;
      if(!gate||gate.v!==1||!['preparing','countdown','go'].includes(gate.phase)||!Number.isFinite(gate.remainingMs)||gate.remainingMs<0||gate.remainingMs>3000)return;
      const old=this.viewGate;
      if(old&&old.key===gate.key&&old.phase==='go')return;
      const deadline=gate.phase==='countdown'?now+gate.remainingMs:Infinity;
      this.viewGate={key:gate.key,phase:gate.phase,deadline:old?.key===gate.key&&old.phase==='countdown'?Math.min(old.deadline,deadline):deadline,
        goAt:gate.phase==='go'?now:0,localReady:true,blocked:gate.phase!=='go'};
    }
    preparing(now=this.now()){this.update(now);return !this.viewGate||this.viewGate.blocked;}
    flushView(now=this.now()){
      if(!this.active)return;this.update(now);let latest=null;
      const state=()=>{if(!latest||!this.active)return;this.applyGate(latest,now);this.stats.deliveredStates++;this.onState(latest);latest=null;};
      while(this.active&&this.views.length&&this.views[0].due<=now){
        const entry=this.views.shift();if(!this.matches(entry.packet))continue;
        if(entry.kind==='state'){
          // Phase packets cannot disappear behind a newer ordinary snapshot.
          if(latest?.startGate)state();latest=entry.packet;
        }else{state();if(this.active)this.onEvent(entry.packet);}
      }
      state();
    }
    close(){this.active=false;this.inputs=[];this.views=[];this.probes.clear();this.samples.clear();this.actions.clear();this.viewGate=null;}
  }
  window.GalaxyHostClient=GalaxyHostClient;
})();
