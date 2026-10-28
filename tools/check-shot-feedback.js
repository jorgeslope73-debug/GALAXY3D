'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const ctx=engineContext(),core=ctx.window.GalaxyPhysicsCore;
for(const name of ['motion-prediction','network-playback','net-state-codec'])vm.runInContext(fs.readFileSync('docs/'+name+'.js','utf8'),ctx);
const ImpactFX=require('../docs/impactos.js'),DT=1/60;
const source=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
const at=source.indexOf('  function networkDrawingState('),to=source.indexOf('\n  function ',at+1);
vm.runInContext(source.slice(at,to),ctx);
function fixture(offset=.1,owner=0){
 const e=new ctx.window.GalaxyHostPhysics({code:'TEST',seriesId:'a'.repeat(32)});
 e.players=[0,1].map(i=>Object.assign(e.makePlayer(i,'J'+i,false),{x:100,y:900,px:100,py:900,rot:0,pr:0,bank:0,pbank:0,shield:0,protection:0,spawnFx:0,deaths:0,inputSessionId:String(i),motionStream:core.createMotionStream(4+i)}));
 Object.assign(e,{asteroids:[],meteors:[],flares:[],pickups:[],bullets:[],ufo:null,giant:null,activeShockwaves:[]});
 for(let tick=0;tick<=30;tick++){
  e.fxClock=tick/60;const target=e.players[1-owner];
  target.x=500+800*(e.fxClock-(.5-offset));target.y=500;target.px=target.x;target.py=target.y;
  e.shotHistory.capture(e);
 }
 return e;
}
function projectile(owner=0,offset=.1){return {id:42,owner,x:500,y:500,px:500,py:500,vx:0,vy:0,age:0,travel:150,guided:false,se:4+owner,st:20,lagOffset:offset};}
let cases=0;
for(const offset of [.075,.10,.15,.25,.30])for(const owner of [0,1]){
 const e=fixture(offset,owner),b=projectile(owner,offset),actual=e.players[1-owner];
 const without={...b,lagOffset:undefined};
 assert.equal(e.queryProjectileShipHit(without),null,'current target has left the visible hit point');
 const hit=e.queryProjectileShipHit(b);assert.ok(hit,"bounded history restores the shooter's visible hit");
 assert.equal(hit.target,actual);assert.equal(hit.attacker,e.players[owner]);assert.equal(actual.dead,false,'query alone is not damage');
 e.bullets=[b];e.updateBullets(DT);assert.equal(actual.dead,true);assert.equal(e.players[owner].kills,1);assert.equal(e.bullets.length,0);
 const fx=e.publicState().fx.find(f=>f.kind==='explosion');assert.equal(fx.so,owner);assert.equal(fx.si,42);assert.equal(fx.st,20);
 e.updateBullets(DT);assert.equal(e.players[owner].kills,1,'no duplicate kill');cases++;
}
for(const change of ['dead','protection','spawnFx','newLife','newSession']){
 const e=fixture(),b=projectile(),p=e.players[1];
 if(change==='newLife')p.deaths++;else if(change==='newSession')p.inputSessionId='replacement';else p[change]=change==='dead'?true:3;
 assert.equal(e.queryProjectileShipHit(b),null,change+' cannot be bypassed by history');cases++;
}
for(const shield of ['now','then']){
 const e=fixture(),b=projectile();if(shield==='now')e.players[1].shield=5;else for(const f of e.shotHistory.frames)f.players[1].shield=5;
 const hit=e.queryProjectileShipHit(b);assert.equal(hit.shielded,true);
 e.bullets=[b];e.updateBullets(DT);assert.equal(e.players[1].dead,false);assert.equal(e.bullets.length,0);cases++;
}
for(const field of ['asteroids','meteors','flares','pickups','giant','ufo']){
 const e=fixture(),b={...projectile(),px:400,x:500},body={id:12,x:450,y:500,r:17,type:1,fragment:true};
 for(const f of e.shotHistory.frames)if(Array.isArray(f[field]))f[field]=[{...body}];else f[field]={...body};
 assert.equal(e.queryProjectileShipHit(b),null,field+' blocks before the historical target');assert.equal(b.historyBlocked,true);cases++;
}
{
 const e=fixture(),b={...projectile(),px:400,x:470};
 for(const f of e.shotHistory.frames)f.asteroids=[{id:12,x:450,y:500,r:17,type:1,fragment:true}];
 e.bullets=[b];e.updateBullets(DT);assert.equal(e.bullets.length,0,'historical obstruction consumes the bullet before it can kill later');assert.equal(e.players[1].dead,false);
}
{
 const e=fixture(),p=e.players[0];p.motionStream.active=true;p.motionStream.ack=33;
 for(const viewTime of [.4,-2,.6,NaN,0]){const b=projectile();delete b.lagOffset;e.shotHistory.stamp(b,p,{viewTime},.5);assert.equal(Number.isFinite(b.lagOffset),viewTime===.4);}
 p.motionStream.missing=2;const b=projectile();delete b.lagOffset;e.shotHistory.stamp(b,p,{viewTime:.4},.5);assert.equal(b.lagOffset,undefined,'missing input never reuses an old viewing time');
 e.shotHistory.reset();assert.equal(e.shotHistory.frames.length,0);
 for(let i=0;i<600;i++){e.fxClock=i/60;e.shotHistory.capture(e);}assert.ok(e.shotHistory.frames.length<=32);
}
{
 const codec=ctx.window.GalaxyStateCodec,packet={protocolVersion:2,seriesId:'a'.repeat(32),hostEpoch:1,rankRound:1,inputSessionId:'b'.repeat(32),controlSeq:1,turn:0,thrust:true,fire:true,
  motion:{v:1,epoch:1,frames:[[1,0,1,1,0],[2,0,1,1,0],[3,0,1,1,0]],viewTime:4.125}};
 const encoded=codec.encodeRelayControl(packet),decoded=codec.decodeRelayControl(encoded);assert.equal(decoded.motion.viewTime,4.125);
 const noView={...packet,motion:{...packet.motion}};delete noView.motion.viewTime;
 assert.ok(encoded.length-codec.encodeRelayControl(noView).length<=6,'view time costs one integer per control, not one timestamp per frame');
 const stream=core.createMotionStream(1);assert.equal(core.acceptMotionFrames(stream,decoded.motion),true);
 assert.ok(Math.abs(core.consumeMotionFrame(stream).viewTime-(4.125-2/60))<1e-8);
 assert.equal(codec.decodeRelayControl(codec.encodeRelayControl(noView)).motion.viewTime,undefined,'old command packets remain valid');
}
const view={code:'TEST',seriesId:'a'.repeat(32),hostEpoch:1,round:1,simTime:.4,seq:5,players:[{i:0,x:100,y:900,dead:false,d:0,motion:{epoch:4,ack:10}},{i:1,x:500,y:500,r:0,b:0,dead:false,d:0,prot:0}],bullets:[],asteroids:[],meteors:[],pickups:[],flares:[],fx:[]};
{
 const mask=new ctx.window.GalaxyShotOcclusion(),fx=new ImpactFX();fx.consume(view,0,0);
 const predicted={id:'local-shot:0:4:20',o:0,x:500,y:500,vx:0,vy:-700,se:4,st:20,predicted:true};let sounds=0,contacts=0;
 const before=JSON.stringify(view);
 const frame={...view,bullets:[predicted]};
 const onImpact=e=>{contacts++;if(fx.predictShotHit(e,0,100)&&fx.shotSound(e,0))sounds++;};
 assert.equal(mask.filter(frame,0,100,{onImpact}).length,0);assert.equal(fx.bursts.length,1);assert.equal(fx.bursts[0].kind,'hit');assert.equal(sounds,1);
 mask.filter(frame,0,116,{onImpact});assert.equal(contacts,1);assert.equal(view.players[1].dead,false);assert.equal(JSON.stringify(view),before);
 const confirmation={...view,seq:6,simTime:.5,players:view.players.map(p=>p.i===1?{...p,dead:true,d:1}:p),fx:[{id:8,i:1,x:500,y:500,kind:'explosion',age:0,so:0,si:42,se:4,st:20}]};
 const drawn=ctx.networkDrawingState({state:view,previous:view,simTime:.4},confirmation,0);
 assert.equal(drawn.players[1].dead,true,'confirmed kill bypasses the remote playback delay');assert.equal(drawn.seq,6);assert.equal(drawn.fx.length,1);
 fx.consume(drawn,0,200);fx.consume(drawn,0,220);assert.equal(fx.bursts.filter(b=>b.kind==='explosion').length,1);assert.equal(fx.shotSound({...confirmation.fx[0],kind:'impact'},0),false);
 fx.enqueue({...confirmation.fx[0],id:9,kind:'hit'},'fx:9',0,230);assert.equal(fx.bursts.filter(b=>b.kind==='hit').length,1,'confirmed hit cannot duplicate predicted contact');
 const other=ctx.networkDrawingState({state:view,previous:view,simTime:.4},confirmation,1);assert.equal(other.players[0],view.players[0]);
 const denied={...view,seq:7,simTime:.6};const deniedView=ctx.networkDrawingState({state:view,previous:view,simTime:.4},denied,0);assert.equal(deniedView.players[1].dead,false,'an unconfirmed spark never hides/kills a ship');
}
console.log('Shot feedback OK: '+cases+' authority/history cases, both shooters, 75–300 ms view offset, current baseline misses, obstacles, immunity/lives/shields, bounds, relay timestamp, prediction/confirmation/audio dedup, immediate confirmed death and immutable authority.');
