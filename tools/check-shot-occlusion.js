'use strict';

// Presentation queries only: exercise the real concave profiles and the guest
// command/playback clocks without applying damage or editing queued snapshots.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const clock={now:1000000},ctx=engineContext(clock),core=ctx.window.GalaxyPhysicsCore;
let querying=false,events=0;
const guarded={...core};
for(const name of ['projectileUfoHit','resolveProjectileInterceptions','resolveAsteroidPairCollision','resolveGiantAsteroidCollision','resolveGiantAsteroidContacts','captureRockMotion','separateShipContact','separateGiantShipContact']){
  guarded[name]=(...args)=>{assert.equal(querying,false,'visual occlusion cannot call the mutating API '+name);return core[name](...args);};
}
ctx.window.GalaxyPhysicsCore=Object.freeze(guarded);
ctx.window.dispatchEvent=()=>{events++;};
vm.runInContext(fs.readFileSync('docs/motion-prediction.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('docs/network-playback.js','utf8'),ctx);
const Occlusion=ctx.window.GalaxyShotOcclusion,Prediction=ctx.window.GalaxyMotionPrediction,Playback=ctx.window.GalaxyNetworkPlayback;
assert.equal(typeof Occlusion,'function','load the independent visual shot occlusion class');
const copy=o=>JSON.parse(JSON.stringify(o));
function freeze(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(freeze);Object.freeze(o);}return o;}
const bolt=(id,x,y=500,extra={})=>({id,o:0,owner:0,x,y,vx:1000,vy:0,g:false,guided:false,predicted:true,...extra});
function scene(bullets,extra={}){
  return {code:'CLIP',seriesId:'a'.repeat(32),hostEpoch:1,round:1,seq:1,simTime:1,
    players:[{i:0,x:500,y:500,r:0,b:0,vx:0,vy:0,ammo:3,armed:true,dead:false,prot:0,shield:0}],
    bullets,asteroids:[],meteors:[],flares:[],pickups:[],ufos:[],giant:null,fx:[],...extra};
}
const options={front:4,tail:7.5,radius:4,playerVisible:()=>true};
function boltRectangle(b){
  const speed=Math.hypot(b.vx,b.vy)||1,dx=b.vx/speed,dy=b.vy/speed;
  return [[-7.5,-1.8],[7.5,-1.8],[7.5,1.8],[-7.5,1.8]].map(([along,side])=>[b.x+dx*along-dy*side,b.y+dy*along+dx*side]);
}
function mediumPolygon(a){
  const rock=pinned(a),angle=core.mediumRotation(a.x,a.y,a.id),c=Math.cos(angle),s=Math.sin(angle);
  return core.mediumProfile(rock).outline.map(([x,y])=>[a.x+a.r*(x*c+y*s),a.y+a.r*(-x*s+y*c)]);
}
function polygonOverlap(a,b){
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const inside=(point,polygon)=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const p=polygon[j],q=polygon[i];if((p[1]>point[1])!==(q[1]>point[1])&&point[0]<(q[0]-p[0])*(point[1]-p[1])/(q[1]-p[1])+p[0])yes=!yes;}return yes;};
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    if(cross(p,q,r)*cross(p,q,s)<-1e-9&&cross(r,s,p)*cross(r,s,q)<-1e-9)return true;
  }
  return a.some(p=>inside(p,b))||b.some(p=>inside(p,a));
}
function filter(instance,state,now,extra={}){
  const before=JSON.stringify(state),other=JSON.stringify(extra),oldEvents=events;
  freeze(state);if(extra.authoritative)freeze(extra.authoritative);
  querying=true;let result;
  try{result=instance.filter(state,0,now,{...options,...extra});}finally{querying=false;}
  assert.ok(Array.isArray(result));
  assert.equal(JSON.stringify(state),before,'occlusion never mutates visible snapshots, effects, ammo or object hit points');
  assert.equal(JSON.stringify(extra),other,'occlusion never edits the weapon ledger or authoritative snapshots');
  assert.equal(events,oldEvents,'visual obstruction emits no effects, sounds or game events');
  return result;
}
const medium={id:7,x:800,y:500,r:51.75,s:1.2};
const pinned=a=>({...a,spin:a.s,pspin:a.s,px:a.x,py:a.y});
const has=(array,id)=>array.some(b=>String(b.id)===String(id));
const checks=[
  ['incremental crossing catches a rock even when the endpoint is clear',()=>{
    const clip=new Occlusion(),first=scene([bolt('cross',680)],{asteroids:[medium]});
    assert.ok(has(filter(clip,first,100),'cross'));
    assert.equal(core.asteroidHitsCircle(pinned(medium),{px:900,py:500,x:900,y:500},4,()=>false),null,'the final point alone really misses the irregular rock');
    const next=scene([bolt('cross',900)],{seq:2,simTime:1.22,asteroids:[medium]});
    assert.equal(has(filter(clip,next,320),'cross'),false,'a skipped visual frame cannot carry the shot through the complete asteroid');
  }],
  ['the complete 3D bolt front and rear cannot stick into the outline',()=>{
    const shape=pinned(medium),left=core.asteroidHitsCircle(shape,{px:600,py:500,x:1000,y:500},4,()=>false);
    const right=core.asteroidHitsCircle(shape,{px:1000,py:500,x:600,y:500},4,()=>false);
    assert.ok(left&&right&&left.t>0&&right.t>0);
    const entry=600+400*left.t,exit=1000-400*right.t;
    const front=scene([bolt('front',entry-2)],{asteroids:[medium]});
    assert.equal(core.asteroidHitsCircle(shape,{px:entry-2,py:500,x:entry-2,y:500},4,()=>false),null,'the bolt centre is still clear');
    assert.equal(has(filter(new Occlusion(),front,100),'front'),false,'its leading cylinder cap already touches the real outline');
    const back=scene([bolt('rear',exit+2)],{asteroids:[medium]});
    assert.equal(has(filter(new Occlusion(),back,100),'rear'),false,'the rear of a complete bolt must also stay out of the rock');
    assert.ok(has(filter(new Occlusion(),front,100,{front:0,tail:12}),'front'),'the 2D trail ends at its tip and does not acquire the 3D forward extension');
  }],
  ['flat cylinder end-cap corners are covered rather than treated as rounded tips',()=>{
    const radius=core.SHIELD_RADIUS,angle=24*Math.PI/180,distance=radius+7.5*Math.cos(angle)+1.8*Math.sin(angle)-.1;
    for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const side of [-1,1]){
      const dx=Math.cos(heading),dy=Math.sin(heading),sx=-dy,sy=dx;
      const x=800-distance*(dx*Math.cos(angle)+side*sx*Math.sin(angle));
      const y=500-distance*(dy*Math.cos(angle)+side*sy*Math.sin(angle));
      const corner={x:x+dx*7.5+sx*side*1.8,y:y+dy*7.5+sy*side*1.8};
      assert.ok(Math.hypot(corner.x-800,corner.y-500)<radius,'a genuine vertex of the flat cylinder cap penetrates the visible shield');
      const state=scene([bolt('corner',x,y,{vx:dx*1000,vy:dy*1000})],{players:[{i:1,x:800,y:500,r:0,b:0,vx:0,vy:0,dead:false,prot:0,shield:10}]});
      assert.ok(has(filter(new Occlusion(),state,100,{front:3.5}),'corner'),'the former rounded-tip padding misses this real flat-cap corner');
      assert.equal(has(filter(new Occlusion(),state,100),'corner'),false,'four-pixel forward padding encloses the complete 15 by 3.6 cylinder footprint');
    }
  }],
  ['real concave gaps stay empty instead of becoming bounding circles',()=>{
    // (67,94) lies inside the giant's convex envelope, in a genuine concave
    // opening with more than twenty units of clearance from the actual edge.
    const giantScene=scene([bolt('gap',67,94)],{giant:{x:0,y:0}});
    assert.equal(core.giantHitsCircle({x:0,y:0},{px:67,py:94,x:67,y:94},4),null);
    assert.ok(has(filter(new Occlusion(),giantScene,100,{front:0,tail:0}),'gap'),'the giant concavity does not hide a clear shot');
    let gap;
    for(let dy=-45;dy<=45&&!gap;dy+=2)for(let dx=-45;dx<=45;dx+=2){
      if(Math.hypot(dx,dy)>medium.r-3)continue;
      const x=medium.x+dx,y=medium.y+dy;
      if(core.mediumSurface(pinned(medium),x,y).distance>6){gap={x,y};break;}
    }
    assert.ok(gap,'fixture finds empty visible space inside the old medium circle');
    const clear=scene([bolt('medium-gap',gap.x,gap.y)],{asteroids:[medium]});
    assert.ok(has(filter(new Occlusion(),clear,100,{front:0,tail:0}),'medium-gap'),'the actual medium profile decides the contact');
  }],
  ['queries pin the visible pose rather than replaying hidden rock history',()=>{
    const stale={...medium,px:500,py:500,spin:5,pspin:0};
    const state=scene([bolt('pinned',500,500)],{asteroids:[stale]});
    assert.ok(has(filter(new Occlusion(),state,100,{front:0,tail:0}),'pinned'),'stale physics path fields cannot create an obstruction at a different place');
  }],
  ['ship extremities and bank use the real hull rather than its enclosing circle',()=>{
    const target={i:1,x:600,y:500,r:0,b:0,vx:0,vy:0,shield:0,dead:false,prot:0};
    const clear=scene([bolt('hull-gap',645,480)],{players:[target]});
    assert.ok(has(filter(new Occlusion(),clear,100,{front:0,tail:0}),'hull-gap'),'empty space inside the old ship circle stays empty');
    const outline=core.shipProfile(core.shipPose({...target,index:1,rot:0,bank:0,poseTime:1})).outline;
    const nose=outline.reduce((best,p)=>p[1]<best[1]?p:best,outline[0]);
    const pointed=scene([bolt('nose',600+nose[0],500+nose[1])],{players:[target]});
    assert.equal(has(filter(new Occlusion(),pointed,100,{front:0,tail:0}),'nose'),false,'the actual pointed nose can obstruct a visible round');
    const wing=scene([bolt('wing',637,518)],{players:[target]});
    assert.equal(has(filter(new Occlusion(),wing,100,{front:0,tail:0}),'wing'),false);
    const banked=scene([bolt('wing',637,518)],{players:[{...target,b:Math.PI/3}]});
    assert.ok(has(filter(new Occlusion(),banked,100,{front:0,tail:0}),'wing'),'a sixty-degree bank leaves the corresponding visible wing gap clear');
  }],
  ['owner fields, protected ships and invisible opponents do not hide shots',()=>{
    const owner=scene([bolt('owner',500,465,{vx:0,vy:-500})],{players:[{i:0,x:500,y:500,r:0,b:0,vx:0,vy:0,ammo:3,armed:true,dead:false,prot:0,shield:10}]});
    assert.ok(has(filter(new Occlusion(),owner,100),'owner'),'a normal round may leave its own shield and hull');
    for(const target of [{i:1,x:600,y:500,r:0,b:0,shield:10,dead:true,prot:0},{i:1,x:600,y:500,r:0,b:0,shield:10,dead:false,prot:3},{i:1,x:600,y:500,r:0,b:0,shield:10,dead:false,prot:0,camo:8}]){
      const state=scene([bolt('hidden',600)],{players:[...owner.players,target]});
      assert.ok(has(filter(new Occlusion(),state,100,{playerVisible:p=>!(p.camo>0)}),'hidden'),'dead, protected or actually invisible ships cannot produce a cosmetic obstruction');
    }
    const shown=scene([bolt('enemy-field',600)],{players:[...owner.players,{i:1,x:600,y:500,r:0,b:0,shield:10,dead:false,prot:0,camo:8}]});
    assert.equal(has(filter(new Occlusion(),shown,100,{playerVisible:()=>true}),'enemy-field'),false,'the same ship blocks when its real reveal callback says it is visible');
  }],
  ['only own normal presentation changes; remote shots and missiles keep identity',()=>{
    const local=bolt('local',800),remote=bolt('remote',800,500,{o:1,owner:1}),missile=bolt('missile',800,500,{g:true,guided:true});
    const state=scene([local,remote,missile],{asteroids:[medium]}),out=filter(new Occlusion(),state,100);
    assert.equal(has(out,'local'),false);assert.equal(out.find(b=>b.id==='remote'),remote);assert.equal(out.find(b=>b.id==='missile'),missile);
  }],
  ['round environmental objects block visually without applying their game effects',()=>{
    for(const extra of [
      {asteroids:[{id:4,x:800,y:500,r:17,fragment:true}]},
      {meteors:[{id:4,x:800,y:500}]},
      {ufos:[{id:4,x:800,y:500,hp:3}]},
      {pickups:[{id:4,x:800,y:500,type:'ammo3'}]},
      {flares:[{id:4,x:800,y:500,o:1,life:2}]}
    ])assert.equal(has(filter(new Occlusion(),scene([bolt('object',800)],extra),100),'object'),false,'environmental contact only hides the own presentation');
    const enemyMissile=bolt('enemy-rocket',800,500,{o:1,owner:1,g:true,guided:true,predicted:false});
    assert.equal(has(filter(new Occlusion(),scene([bolt('intercepted',800),enemyMissile]),100),'intercepted'),false);
    const ownMissile={...enemyMissile,id:'own-rocket',o:0,owner:0};
    assert.ok(has(filter(new Occlusion(),scene([bolt('same-owner',800),ownMissile]),100),'same-owner'),'same-owner projectiles never intercept each other');
    const remoteRound=bolt('other-round',800,500,{o:1,owner:1,predicted:false});
    assert.ok(has(filter(new Occlusion(),scene([bolt('round',800),remoteRound]),100),'round'),'two normal rounds still pass through each other');
  }],
  ['ghost identity survives confirmation and ledger pruning until the contact ACK',()=>{
    const clip=new Occlusion(),ghost='local-shot:0:7:1';
    const prediction=(tick,shots)=>({ready:true,epoch:7,tick,ack:30,accumulator:0,shots});
    const authority=(ack,seq,x)=>scene([bolt(101,x,500,{predicted:false})],{seq,simTime:ack/60,players:[{i:0,x:500,y:500,r:0,b:0,ammo:2,armed:false,motion:{v:1,epoch:7,ack,x:500,y:500,rot:0,vx:0,vy:0}}]});
    const before=scene([bolt(ghost,680)],{seq:30,simTime:.5,asteroids:[medium]});
    filter(clip,before,100,{prediction:prediction(30,[{id:ghost,tick:1,confirmedId:null}]),authoritative:authority(20,20,680)});
    const crossing=scene([bolt(ghost,900)],{seq:40,simTime:.7,asteroids:[medium]});
    assert.equal(has(filter(clip,crossing,320,{prediction:prediction(40,[{id:ghost,tick:1,confirmedId:null}]),authoritative:authority(30,30,800)}),ghost),false);
    const confirmed=scene([bolt(101,900,500,{predicted:false})],{seq:41,simTime:.72,asteroids:[medium]});
    assert.equal(has(filter(clip,confirmed,337,{prediction:prediction(41,[{id:ghost,tick:1,confirmedId:101}]),authoritative:authority(31,31,900)}),101),false,'ACKing the old birth tick cannot release a later visual contact');
    assert.equal(has(filter(clip,confirmed,354,{prediction:prediction(42,[]),authoritative:authority(31,31,900)}),101),false,'pruning the weapon ledger does not forget an already confirmed obstruction');
    const clear=scene([bolt(101,920,500,{predicted:false})],{seq:42,simTime:.75,asteroids:[medium]});
    assert.ok(has(filter(clip,clear,371,{prediction:prediction(43,[]),authoritative:authority(41,41,910)}),101),'a fresh authoritative trace beyond the rock releases a living shot after its contact tick is confirmed');
  }],
  ['prediction resets do not erase fallback obstruction or bypass fresh confirmation',()=>{
    const clip=new Occlusion(),bullet=x=>bolt(50,x,500,{predicted:false});
    const state=(x,seq,simTime,epoch=7)=>scene([bullet(x)],{seq,simTime,asteroids:[medium],players:[{i:0,x:500,y:500,r:0,b:0,ammo:3,motion:{v:1,epoch,ack:0}}]});
    const first=state(680,60,1),blocked=state(900,70,1.17);
    assert.ok(has(filter(clip,first,100,{prediction:{ready:false,shots:[]},authoritative:first}),50));
    assert.equal(has(filter(clip,blocked,320,{prediction:{ready:false,shots:[]},authoritative:blocked}),50),false);
    const still=state(910,70,1.17);
    assert.equal(has(filter(clip,still,337,{prediction:{ready:false,shots:[]},authoritative:blocked}),50),false,'a fresh predictor object with ready=false does not clear independent occlusion records');
    assert.equal(has(filter(clip,still,354,{prediction:null,authoritative:blocked}),50),false,'the same old authoritative clock cannot release a blocked shot');
    const confirmed=state(920,71,1.2);
    assert.ok(has(filter(clip,confirmed,371,{prediction:{ready:false,shots:[]},authoritative:confirmed}),50),'fallback recovers from fresh simulation time without needing movement ACK to advance');
    const reset=new Occlusion();filter(reset,first,100,{authoritative:first});filter(reset,blocked,320,{authoritative:blocked});
    const nextEpoch=state(900,71,1.2,8);
    assert.ok(has(filter(reset,nextEpoch,337,{authoritative:nextEpoch}),50),'a new owner epoch starts a new obstruction context');
  }],
  ['expired hidden records and identities do not accumulate through a long session',()=>{
    const clip=new Occlusion(),blocked=scene([bolt(70,800,500,{predicted:false})],{asteroids:[medium]});
    assert.equal(has(filter(clip,blocked,100,{authoritative:blocked}),70),false);
    const empty={...blocked,bullets:[]};
    filter(clip,empty,3701,{authoritative:blocked});
    assert.equal(clip.records.size,0,'an unseen obstruction is retired after its bounded TTL even if a stale snapshot still mentions the ID');
    assert.equal(clip.aliases.size,0,'retiring an obstruction also clears its identity aliases');
    for(let i=0;i<150;i++){
      const fresh=scene([bolt('bounded-'+i,100,100,{predicted:false})],{seq:i+1,simTime:i/60});
      filter(clip,fresh,4000+i*17,{authoritative:fresh});
    }
    assert.ok(clip.records.size<=128&&clip.aliases.size<=256,'tracking remains bounded across many consecutive shot identities');
    const gone=scene([],{seq:151,simTime:3});filter(clip,gone,7000,{authoritative:gone});
    assert.equal(clip.records.size,0);assert.equal(clip.aliases.size,0,'removed authoritative IDs leave no persistent aliases');
  }]
];

let passed=0;
for(const [name,check] of checks){check();passed++;console.log('OK: '+name);}

// A moving asteroid can obstruct the delayed drawing while the real host
// correctly lets the same shot pass. Do not hide that living bullet for its
// remaining lifetime after fresh authority has cleared the visual contact.
const game=fs.readFileSync('docs/game.js','utf8');
const start=game.indexOf('  function networkDrawingState('),end=game.indexOf('\n  function ',start+1);
assert.ok(start>=0&&end>start);vm.runInContext(game.slice(start,end),ctx);
const h=new ctx.window.GalaxyHostPhysics({});h.start([{i:0,n:'Pilot'},{i:1,n:'Other'}]);
Object.assign(h.players[0],{x:960,y:800,rot:0,vx:0,vy:0,spawnFx:0,protection:100,bullets:20,guidedAmmo:0,guided:false,flare:0,shockwave:false});
Object.assign(h.players[1],{x:1700,y:900,spawnFx:0,protection:100,bullets:0});
h.asteroids=[{id:7,x:800,y:500,r:51.75,spin:1.2,pspin:1.2,vx:190,vy:0,exitDelay:-1}];h.updateAsteroidPopulation=()=>{};
for(const name of ['updateFlares','updatePickups','updateShower','updateMeteors','updateGiant','updateUfo','shipCollisions'])h[name]=()=>{};
const prediction=new Prediction(),playback=new Playback(),clip=new Occlusion(),packets=[],snapshots=[];
let latest=freeze(copy(h.publicState())),sequence=0,stateSequence=0,accepted=0,nextSend=0,firstMasked=null,recovered=null,hostCollision=false;
for(let frame=0;frame<=240*3;frame++){
  const now=frame*1000/240;clock.now=1000000+now;
  const input={turn:0,thrust:false,fire:now>=500&&now<600,directFire:true};
  if(frame%4===0){
    const player=latest.players[0];prediction.advance(now,player,input);
    const own=prediction.projectiles(player,latest.bullets,now),sample=playback.sample(now);
    if(sample){
      const visible=ctx.networkDrawingState(sample,latest,0,own),shown=filter(clip,visible,now,{prediction,authoritative:latest});
      for(const b of shown)if(b.o===0&&!b.g)for(const a of visible.asteroids){
        assert.equal(polygonOverlap(boltRectangle(b),mediumPolygon(a)),false,'the actual flat-ended 3D rectangle cannot penetrate the currently drawn irregular medium, including the recovery frame');
      }
      const raw=visible.bullets.filter(b=>b.o===0&&!b.g),alive=latest.bullets.some(b=>b.o===0&&!b.g);
      if(raw.length&&!shown.some(b=>b.o===0&&!b.g)&&firstMasked===null)firstMasked=now;
      if(firstMasked!==null&&alive&&shown.some(b=>b.o===0&&!b.g)&&recovered===null)recovered=now;
    }
    if(now+1e-6>=nextSend){sequence++;nextSend=now+1000/30;packets.push({at:now+100,sequence,input,motion:prediction.packet()});}
  }
  while(packets.length&&packets[0].at<=now+1e-6){const q=packets.shift();h.setControl(0,q.input.turn,q.input.thrust,q.input.fire,{controlSeq:q.sequence,motion:q.motion,directFire:true});}
  if(frame&&frame%4===0){
    const prior=h.bullets.slice();h.update(1/60);h.tickCount++;
    for(const b of prior)if(!h.bullets.includes(b)&&b.x>=-20&&b.x<=1940&&b.y>=-20&&b.y<=1100)hostCollision=true;
    if(h.tickCount%3===0||h.humanShotPending){h.humanShotPending=false;stateSequence++;snapshots.push({at:now+100,sequence:stateSequence,state:freeze(copy(h.publicState()))});}
  }
  while(snapshots.length&&snapshots[0].at<=now+1e-6){const q=snapshots.shift();if(q.sequence>accepted){latest=q.state;accepted=q.sequence;playback.push(latest,now);}}
}
assert.equal(hostCollision,false,'the mobile fixture really passes the asteroid in host physics');
assert.ok(firstMasked!==null,'the delayed visible asteroid really creates a local obstruction');
assert.ok(recovered!==null&&recovered>firstMasked,'the still living authoritative shot becomes visible again');
assert.ok(recovered-firstMasked<500,'a false visual obstruction cannot hide the valid shot for its remaining 1.4-second flight');
console.log('OK: moving-medium/100 ms network recovery '+JSON.stringify({firstMasked,recovered,hiddenMs:recovered-firstMasked}));
console.log('Shot occlusion OK: '+passed+' geometry/lifecycle groups plus real host/playback recovery; no damage, events, ammo changes or snapshot mutations.');
