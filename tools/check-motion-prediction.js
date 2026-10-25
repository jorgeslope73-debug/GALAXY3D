'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const clock={now:1000000},ctx=engineContext(clock);
vm.runInContext(fs.readFileSync('docs/motion-prediction.js','utf8'),ctx);
const core=ctx.window.GalaxyPhysicsCore,Prediction=ctx.window.GalaxyMotionPrediction;
const wrap=(a,b,size)=>(b-a+size*1.5)%size-size/2;
function host(){
  const h=new ctx.window.GalaxyHostPhysics({});h.start([{i:0,n:'Pilot'},{i:1,n:'Other'}]);
  Object.assign(h.players[0],{x:500,y:500,rot:0,vx:0,vy:0,spawnFx:0,protection:100,bullets:0});
  Object.assign(h.players[1],{x:1600,y:900,spawnFx:0,protection:100,bullets:0});
  for(const name of ['updateAsteroids','updateFlares','updateBullets','updatePickups','updateShower','updateMeteors','updateGiant','updateUfo','shipCollisions'])h[name]=()=>{};
  return h;
}
// Independently preserve the exact pre-refactor movement order and constants.
const a={x:1918,y:1078,rot:45,vx:150,vy:-90,speed:1.3},b={...a};
for(let tick=0;tick<3600;tick++){
  const c={turn:tick%180<90?1:-.5,thrust:tick%300<200},dt=1/60;
  a.rot=(a.rot+c.turn*240*dt+360)%360;
  const r=a.rot*Math.PI/180;
  if(c.thrust){a.vx+=-Math.sin(r)*(240*a.speed)*dt;a.vy+=-Math.cos(r)*(240*a.speed)*dt;}
  a.vx*=Math.pow(.35,dt);a.vy*=Math.pow(.35,dt);
  const speed=Math.hypot(a.vx,a.vy),max=330*a.speed;
  if(speed>max){a.vx=a.vx/speed*max;a.vy=a.vy/speed*max;}
  a.x=(a.x+a.vx*dt+1920)%1920;a.y=(a.y+a.vy*dt+1080)%1080;
  core.stepShipMovement(b,c);
  for(const k of ['x','y','rot','vx','vy'])assert.equal(b[k],a[k],'integrator parity '+k);
}
const stream=core.createMotionStream(7);
assert(!core.acceptMotionFrames(stream,{v:1,epoch:6,frames:[[1,0,1,0,0]]}));
assert(!core.acceptMotionFrames(stream,{v:1,epoch:7,frames:[[1,0,1,0,0],[2,Infinity,1,0,0]]}));
assert.equal(stream.queue.size,0,'atomic validation');
assert(!core.acceptMotionFrames(stream,{v:1,epoch:7,frames:[[121,0,1,0,0]]}));
assert(core.acceptMotionFrames(stream,{v:1,epoch:7,frames:[[1,1,1,0,0],[2,0,0,0,0]]}));
assert.equal(core.consumeMotionFrame(stream),null,'wait for a bounded input reserve before starting');
assert.equal(stream.ack,0,'waiting does not acknowledge unprocessed inputs');
core.acceptMotionFrames(stream,{v:1,epoch:7,frames:[[3,0,0,0,0]]});
core.acceptMotionFrames(stream,{v:1,epoch:7,frames:[[1,-1,0,0,0],[2,1,1,0,0]]});
assert.equal(core.consumeMotionFrame(stream).turn,1,'duplicate cannot replace a queued command');
assert.equal(core.consumeMotionFrame(stream).turn,0);
assert.equal(stream.ack,2,'only one tick consumed per call');
for(let i=0;i<8;i++)core.consumeMotionFrame(stream);
assert.equal(stream.last.thrust,false);
assert(core.acceptMotionFrames(stream,{v:1,epoch:7,frames:[[1,1,1,1,0]]}));
assert.equal(stream.queue.size,0,'late command cannot execute again');

function run(fps,up,down,jitter=0,loss=0){
  const h=host(),pred=new Prediction(),ideal={x:500,y:500,rot:0,vx:0,vy:0,speed:1};
  let current=h.publicState().players[0],seq=0,snapshotSeq=0,lastStateSeq=0,nextSend=0,generated=0,maxError=0,maxCorrection=0;
  const inputs=[],states=[];
  for(let frame=0;frame<=240*8;frame++){
    const now=frame*1000/240;clock.now=1000000+now;
    const input={turn:now>=1500&&now<2100?1:now>=3000&&now<3700?-1:0,
      thrust:now>=500&&now<2100||now>=3000&&now<3700,fire:false,directFire:false};
    if(frame%(240/fps)===0){
      pred.advance(now,current,input);
      for(const f of pred.history)if(f[0]>generated){core.stepShipMovement(ideal,{turn:f[1],thrust:!!f[2]});generated=f[0];}
      const error=Math.hypot(wrap(pred.pose.x,ideal.x,1920),wrap(pred.pose.y,ideal.y,1080));
      maxError=Math.max(maxError,error);maxCorrection=Math.max(maxCorrection,pred.stats.correction);
      assert(pred.history.length<=120);assert(Number.isFinite(error));
      if(now+1e-6>=nextSend){
        seq++;nextSend=now+1000/30;
        if(!loss||seq%loss!==0)inputs.push({at:now+Math.max(0,up+[0,1,-.5,.5][seq%4]*jitter),seq,input,motion:pred.packet()});
        inputs.sort((a,b)=>a.at-b.at);
      }
    }
    while(inputs.length&&inputs[0].at<=now+1e-6){const packet=inputs.shift();
      h.setControl(0,packet.input.turn,packet.input.thrust,false,{controlSeq:packet.seq,motion:packet.motion});
    }
    if(frame&&frame%4===0){h.update(1/60);h.tickCount++;
      if(h.tickCount%3===0){snapshotSeq++;
        if(!loss||snapshotSeq%loss!==0)states.push({at:now+Math.max(0,down+[0,-.5,1,.5][snapshotSeq%4]*jitter),seq:snapshotSeq,p:h.publicState().players[0]});
        states.sort((a,b)=>a.at-b.at);
      }
    }
    while(states.length&&states[0].at<=now+1e-6){const s=states.shift();if(s.seq>lastStateSeq){current=s.p;lastStateSeq=s.seq;}}
    assert(h.players[0].motionStream.queue.size<=120);
  }
  if(!jitter&&!loss)assert(maxError<1e-7,'exact replay without starvation '+JSON.stringify({fps,up,down,maxError}));
  assert(maxError<15,'bounded prediction with jitter/loss');
  assert(maxCorrection<4,'corrections remain small in the jitter scenario');
  return {fps,up,down,jitter,loss,maxError:+maxError.toFixed(4),maxCorrection:+maxCorrection.toFixed(4)};
}
const results=[];
for(const fps of [30,60,120])for(const scenario of [[0,0],[50,50],[100,100],[20,120],[100,100,30,7]])results.push(run(fps,...scenario));

const h=host(),p=h.players[0],epoch=p.motionStream.epoch;
h.setControl(0,1,true,false,{controlSeq:1,motion:{v:1,epoch,frames:[[1,1,1,0,0],[2,1,1,0,0],[3,1,1,0,0]]}});
h.update(1/60);assert.equal(p.motionStream.ack,1);
h.setControl(0,0,false,false,{controlSeq:2});
assert.notEqual(p.motionStream.epoch,epoch,'fallback disables old stream');
assert(!p.motionStream.active);
const oldEpoch=p.motionStream.epoch;h.respawnPlayer(p);
assert.notEqual(p.motionStream.epoch,oldEpoch,'respawn retires old commands');
const predictor=new Prediction();p.spawnFx=0;const s=h.publicState().players[0];
predictor.advance(0,s,{turn:0,thrust:false,fire:true});
predictor.advance(5,s,{turn:0,thrust:false,fire:false});
predictor.advance(17,s,{turn:0,thrust:false,fire:false});
assert.equal(predictor.history[0][3],1,'short fire edge survives until a tick');
predictor.advance(34,s,{turn:0,thrust:false,fire:false});
assert.equal(predictor.history[1][3],0,'fire pulse not duplicated');
predictor.advance(40,{...s,dead:true},{turn:0,thrust:false,fire:false});assert(!predictor.ready);
const recovery=new Prediction();
recovery.advance(0,s,{turn:0,thrust:false,fire:false});
recovery.advance(1000,{...s,motion:{...s.motion,ack:60}},{turn:0,thrust:false,fire:false});
assert.equal(recovery.tick,60,'host ahead after suspension rebases the client clock');
assert.equal(recovery.history.length,0);
recovery.advance(1017,{...s,motion:{...s.motion,ack:60}},{turn:0,thrust:false,fire:false});
assert.equal(recovery.history[0][0],61);
const correction=new Prediction();
const monotonic=new Prediction();
monotonic.advance(0,s,{turn:0,thrust:false,fire:false});
monotonic.advance(17,s,{turn:1,thrust:false,fire:false});
monotonic.advance(16,s,{turn:1,thrust:false,fire:false});
monotonic.advance(33,s,{turn:1,thrust:false,fire:false});
assert.equal(monotonic.tick,1,'stale RAF after an input event must not add elapsed time');
correction.advance(0,s,{turn:0,thrust:false,fire:false});
const corrected={...s,motion:{...s.motion,x:s.motion.x+10}};
correction.advance(1,corrected,{turn:0,thrust:false,fire:false});
assert.equal(correction.pose.x,corrected.motion.x,'authority corrected immediately in physics');
assert(Math.abs(correction.sample().x-s.motion.x)<1e-8,'only visual offset preserves continuity');
correction.advance(18,corrected,{turn:0,thrust:false,fire:false});
assert(Math.abs(correction.pose.x-corrected.motion.x)<1e-8,'visual correction never changes future physics');
const resetHost=host(),resetPlayer=resetHost.players[0],resetEpoch=resetPlayer.motionStream.epoch;
resetHost.setControl(0,1,true,false,{controlSeq:1,motion:{v:1,epoch:resetEpoch,frames:Array.from({length:60},(_,i)=>[i+1,1,1,0,0])}});
assert.notEqual(resetPlayer.motionStream.epoch,resetEpoch,'large backlog requests resynchronization, not fast-forward');
assert.equal(resetPlayer.x,500);
resetHost.finished=true;resetHost.restart(2);
assert.notEqual(resetPlayer.motionStream.epoch,resetEpoch,'round restart retires commands');
console.log('Motion prediction OK: integrator parity, replay, bounds, lifecycle and short pulses.');
console.log(JSON.stringify(results));

// Sweep release timing across packet boundaries, with delayed and reordered packets.
function releaseWithIrregularDelivery(release){
 const h=host(),pred=new Prediction(); let state=h.publicState().players[0],seq=0,nextFrame=0,nextSend=0,maxCorrection=0,missing=0;
 const packets=[],snapshots=[];
 for(let ms=0;ms<5000;ms++){
  clock.now=1000000+ms;
  const input={turn:0,thrust:ms>=500&&ms<release,fire:false,directFire:false};
  if(ms>=nextFrame){
   nextFrame+=1000/60; pred.advance(ms,state,input);
   if(ms>=nextSend){nextSend=ms+32;seq++;packets.push({at:ms+10+(seq%5===0?35:0),seq,input,motion:pred.packet()});packets.sort((a,b)=>a.at-b.at);}
   if(ms>=release)maxCorrection=Math.max(maxCorrection,pred.stats.correction);
  }
  while(packets.length&&packets[0].at<=ms){const q=packets.shift();h.setControl(0,0,q.input.thrust,false,{controlSeq:q.seq,motion:q.motion});}
  if(ms>0&&Math.floor(ms*60/1000)>Math.floor((ms-1)*60/1000)){
   h.update(1/60);h.tickCount++;if(h.players[0].motionStream.missing)missing++;
   if(h.tickCount%3===0)snapshots.push({at:ms+10,p:h.publicState().players[0]});
  }
  while(snapshots.length&&snapshots[0].at<=ms)state=snapshots.shift().p;
 }
 
 return {maxCorrection,missing};
}
for(let release=1950;release<2050;release+=5){
  const result=releaseWithIrregularDelivery(release);
  assert.equal(result.missing,0, "30 Hz delivery must not starve the 60 Hz consumer");
  assert(result.maxCorrection<1e-7, "release must coast without a later reconciliation kick");
}

// Projectile presentation uses the same command clock, without ever changing
// authoritative ammo, bullet objects or the five-field movement wire format.
const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
function armedPlayer(extra={}){
 return {i:0,ammo:3,cad:10,armed:true,spd:1,mira:false,ma:0,flare:0,shock:false,dead:false,spawnFx:0,
  motion:{v:1,epoch:7,ack:0,x:500,y:500,rot:0,vx:0,vy:0,active:true},...extra};
}
const held={turn:1,thrust:false,fire:true,directFire:true};
{
 const player=freeze(armedPlayer({cad:30})),prediction=new Prediction();
 prediction.advance(0,player,held);prediction.advance(17,player,held);
 const born=prediction.projectiles(player,[],17),shot=prediction.shots[0];
 assert.equal(born.length,1);assert.equal(born[0].predicted,true);
 assert.ok(Math.abs(wrap(Math.atan2(-born[0].vx,-born[0].vy)*180/Math.PI,4,360))<1e-8,'birth heading follows its own movement tick');
 const real=freeze({id:101,o:0,x:shot.rawX+shot.rawVx/60,y:shot.rawY+shot.rawVy/60,vx:shot.rawVx,vy:shot.rawVy,g:false});
 const acked=freeze({...player,ammo:2,armed:false,motion:{...player.motion,ack:1,rot:4}});
 prediction.advance(34,acked,held);
 const packet=JSON.stringify(prediction.packet()),authority=JSON.stringify([acked,real]);
 const confirmed=prediction.projectiles(acked,[real],34);
 assert.equal(confirmed.length,1);assert.equal(confirmed[0].id,101,'the ACK replaces the ghost with the real ID');
 assert.equal(prediction.projectiles(acked,[real],34).length,1,'duplicate snapshots/paints never duplicate a shot');
 assert.equal(JSON.stringify(prediction.packet()),packet);assert.equal(JSON.stringify([acked,real]),authority);
 assert.ok(prediction.packet().frames.every(f=>f.length===5),'visual weapon state never enters the control packet');
 const direction=[confirmed[0].vx,confirmed[0].vy];
 prediction.advance(51,acked,{...held,turn:-1});
 assert.deepEqual(prediction.projectiles(acked,[real],51).map(b=>[b.vx,b.vy]),[direction],'an old round never turns with the ship');
 assert.equal(prediction.projectiles(acked,[],52).length,0,'an ACKed projectile disappears when authority removes it');
}
{
 for(const accepted of [false,true]){
  const player=armedPlayer(),prediction=new Prediction();prediction.advance(0,player,held);prediction.advance(17,player,held);
  const acked={...player,ammo:accepted?2:3,armed:false,motion:{...player.motion,ack:1,rot:4}};
  prediction.advance(34,acked,held);
  assert.equal(prediction.projectiles(acked,[],34).length,0,'missing at ACK retires rejected or immediately impacted shots');
  if(!accepted){
   for(let now=51;now<2500;now+=17){prediction.advance(now,acked,held);assert.equal(prediction.projectiles(acked,[],now).length,0,'unknown rejected cooldown cannot invent another shot');}
  }
 }
 const empty=armedPlayer({ammo:0}),prediction=new Prediction();prediction.advance(0,empty,held);prediction.advance(17,empty,held);
 assert.equal(prediction.projectiles(empty,[],17).length,0,'no visual shot without ammo');
 const unknown=armedPlayer({armed:false}),blocked=new Prediction();blocked.advance(0,unknown,held);blocked.advance(17,unknown,held);
 assert.equal(blocked.projectiles(unknown,[],17).length,0,'an unknown remaining reload stays authoritative');
 const ready=armedPlayer(),lost=new Prediction();lost.advance(0,ready,held);lost.advance(17,ready,held);
 const disarmed={...ready,ammo:0,armed:false,motion:{...ready.motion,ack:0}};lost.advance(34,disarmed,held);
 assert.equal(lost.projectiles(disarmed,[],34).length,0,'new empty ammo removes impossible unACKed shots');
 const pickup=new Prediction();pickup.advance(0,ready,held);pickup.advance(17,ready,held);
 assert.equal(pickup.projectiles(ready,[],17).length,1);
 const missiles={...ready,mira:true,ma:1,motion:{...ready.motion,ack:0}};pickup.advance(34,missiles,held);
 assert.equal(pickup.projectiles(missiles,[],34).length,0,'a missile pickup removes an ambiguous unACKed direct preview too');
}
for(const special of [{mira:true,ma:1},{flare:1},{shock:true}]){
 const player=armedPlayer(special),prediction=new Prediction(),legacy={...held,directFire:false};
 prediction.advance(0,player,legacy);prediction.advance(17,player,legacy);
 assert.equal(prediction.projectiles(player,[],17).length,0,'ambiguous missile/special gestures do not invent normal bullets');
 const reloading={...player,mira:false,ma:0,flare:0,shock:false,armed:false,motion:{...player.motion,ack:1,rot:4}};
 prediction.advance(34,reloading,legacy);prediction.projectiles(reloading,[],34);prediction.advance(51,reloading,legacy);
 assert.equal(prediction.projectiles(reloading,[],51).length,0,'an ambiguous launch cannot lend its stale armed flag to a normal round');
 const direct=new Prediction();direct.advance(0,player,held);direct.advance(17,player,held);
 assert.equal(direct.projectiles(player,[],17).length,special.mira?0:1,'a possible reliable rocket launch blocks previews even alongside direct fire');
}
{
 const player=armedPlayer(),prediction=new Prediction();prediction.advance(0,player,held);prediction.advance(5,player,{...held,fire:false});prediction.advance(17,player,{...held,fire:false});
 assert.equal(prediction.projectiles(player,[],17).length,1,'a short pulse has a visual birth');
 prediction.advance(34,player,{...held,fire:false});assert.equal(prediction.shots.length,1,'a short pulse is not replayed twice');
 for(const replacement of [{...player,dead:true},{...player,spawnFx:1},{...player,motion:{...player.motion,epoch:8}}]){
  const test=new Prediction();test.advance(0,player,held);test.advance(17,player,held);test.advance(34,replacement,held);
  assert.equal(test.shots.length,0,'death/materialization/epoch clears the visual ledger');
 }
 prediction.reset();assert.equal(prediction.shots.length,0);assert.equal(prediction.seenProjectiles.size,0,'fallback reset clears projectile identities');
 const stalled=new Prediction();stalled.advance(0,player,held);stalled.advance(17,player,held);stalled.advance(1000,player,{...held,fire:false});
 assert.equal(stalled.shots.length,0,'a suspended frame does not preserve or create stale shots');
 const confirmed=new Prediction();confirmed.advance(0,player,{...held,fire:false});
 const bullet=freeze({id:55,o:0,x:1930,y:500,vx:500,vy:0,g:false});
 assert.equal(confirmed.projectiles(player,[bullet],0).length,1);
 assert.equal(confirmed.projectiles(player,[bullet],3001).length,0,'normal rounds expire after three seconds even during a stall');
 assert.equal(confirmed.projectiles(player,[bullet],3010).length,0,'an expired stale ID cannot reappear next paint');
 confirmed.advance(17,player,{...held,fire:false});
 assert.ok(confirmed.projectiles(player,[{...bullet,id:56}],17)[0].x>1920,'projectiles do not wrap at the arena edge');
}

function shotNetwork(fps,up,down,jitter=0,loss=0,cadence=10){
 const h=host(),prediction=new Prediction();h.updateBullets=ctx.window.GalaxyHostPhysics.prototype.updateBullets;
 Object.assign(h.players[0],{bullets:20,cadence,guidedAmmo:0,guided:false,flare:0,shockwave:false});
 let latest=freeze(copy(h.publicState())),sequence=0,stateSequence=0,acceptedState=0,nextSend=0,firstGhost=null;
 const packets=[],snapshots=[],directions=new Map(),counts=[],births=new Set();let maxBirthError=0;
 for(let frame=0;frame<=240*4;frame++){
  const now=frame*1000/240;clock.now=1000000+now;
  const input={turn:now<2000?1:-.5,thrust:true,fire:now>=500&&now<3000,directFire:true};
  if(frame%(240/fps)===0){
   const player=latest.players[0],immutable=JSON.stringify(latest);prediction.advance(now,player,input);
   const wire=JSON.stringify(prediction.packet()),shown=prediction.projectiles(player,latest.bullets,now);
   assert.equal(JSON.stringify(latest),immutable);assert.equal(JSON.stringify(prediction.packet()),wire);
   assert.ok(prediction.history.every(f=>f.length===5));assert.ok(prediction.shots.length<=32);
   for(const bullet of shown){
    if(bullet.predicted)births.add(bullet.id);
    if(directions.has(bullet.id))assert.deepEqual([bullet.vx,bullet.vy],directions.get(bullet.id),'display does not steer old bullets');
    directions.set(bullet.id,[bullet.vx,bullet.vy]);
    if(bullet.predicted&&firstGhost===null){
     firstGhost=now;maxBirthError=Math.abs(wrap(prediction.sample().r,Math.atan2(-bullet.vx,-bullet.vy)*180/Math.PI,360));
    }
   }
   for(let i=0;i<shown.length;i++)for(let j=i+1;j<shown.length;j++)assert.ok(Math.hypot(shown[i].x-shown[j].x,shown[i].y-shown[j].y)>2||Math.hypot(shown[i].vx-shown[j].vx,shown[i].vy-shown[j].vy)>1,'confirmation cannot leave a duplicate ghost');
   counts.push(shown.length);
   if(now+1e-6>=nextSend){
    sequence++;nextSend=now+1000/30;
    if(!loss||sequence%loss)packets.push({at:now+Math.max(0,up+[0,1,-.5,.5][sequence%4]*jitter),sequence,input,motion:prediction.packet()});
    packets.sort((a,b)=>a.at-b.at);
   }
  }
  while(packets.length&&packets[0].at<=now+1e-6){const packet=packets.shift();h.setControl(0,packet.input.turn,packet.input.thrust,packet.input.fire,{controlSeq:packet.sequence,motion:packet.motion,directFire:true});}
  if(frame&&frame%4===0){h.update(1/60);h.tickCount++;
   if(h.tickCount%3===0||h.humanShotPending){
    h.humanShotPending=false;stateSequence++;
    if(!loss||stateSequence%loss)snapshots.push({at:now+Math.max(0,down+[0,-.5,1,.5][stateSequence%4]*jitter),sequence:stateSequence,state:freeze(copy(h.publicState()))});
    snapshots.sort((a,b)=>a.at-b.at);
   }
  }
  while(snapshots.length&&snapshots[0].at<=now+1e-6){const snapshot=snapshots.shift();if(snapshot.sequence>acceptedState){latest=snapshot.state;acceptedState=snapshot.sequence;}}
 }
 assert.ok(firstGhost>=500&&firstGhost<560,'own shot appears from input, without waiting for the roundtrip');
 assert.ok(maxBirthError<8.1,'first shot is aligned with its local birth tick at '+fps+' Hz');
 assert.ok(Math.max(...counts)<=14,'the ledger and cadence bound the number of shown rounds');
 assert.ok(h.players[0].bullets>=0&&h.players[0].bullets<20,'only the real host consumes ammo');
 assert.equal(births.size,20-h.players[0].bullets,'predicted births respect the actual host ammo and cadence, including fixed-step rounding');
 return {fps,up,down,jitter,loss,cadence,firstGhost,births:births.size,maxBirthError:+maxBirthError.toFixed(4)};
}
const shotResults=[];
for(const fps of [30,60,120])for(const scenario of [[0,0],[50,50],[100,100],[100,100,30,7]])shotResults.push(shotNetwork(fps,...scenario));
shotResults.push(shotNetwork(60,50,50,0,0,.5));
console.log('Projectile prediction OK: birth clock, immutable straight trajectories, ACK/IDs/rejection/impacts, unknown reload/special guards, ammo, cadence, pulses, TTL/stalls, lifecycle and unchanged wire.');
console.log(JSON.stringify(shotResults));
