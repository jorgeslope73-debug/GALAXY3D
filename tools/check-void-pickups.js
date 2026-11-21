'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 let state=123456789,calls=0,random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const math=Object.create(Math);math.random=()=>{calls++;return random();};
 const c=vm.createContext({window:{},console,Date,Math:math,performance,setTimeout,clearTimeout});
 for(const n of ['net-protocol','campaign-config','collision-profiles','physics-core','mothership-data','mothership-core','storm-core','devourer-core','void-core','shot-history','host-physics','local-cpu'])vm.runInContext(fs.readFileSync('docs/'+n+'.js','utf8'),c);
 const e=new c.window.GalaxyLocalCpu({});e.start('P','medio',3,null,false,5);
 for(const p of e.players)Object.assign(p,{dead:p.cpu,spawnFx:0,shield:0,protection:1e5});
 const S=c.window.GalaxyVoidCore,b=S.create(7001),p=e.players[0];e.voidSphere=b;e.pickups=[];
 return {e,S,b,p,c,setRandom(fn){random=fn;calls=0;},getCalls(){return calls;}};
}
function zone(f,name){
 const {b,p,S}=f;b.inside=name==='inner';b.stage=name==='inner'?'core':name==='corridor'?'infiltrate':'generators';
 b.generators.forEach(g=>g.hp=name==='outside'?2:0);b.outerGate=name==='outside'?0:1;
 Object.assign(p,name==='outside'?{x:180,y:540}:name==='inner'?{x:b.x+150,y:b.y}:{x:b.x+S.CORRIDOR,y:b.y});p.px=p.x;p.py=p.y;p.dead=false;p.spawnFx=0;
}
function safe(f,point,name){
 const {b,p,S,e}=f;assert.ok(point&&Number.isFinite(point.x)&&Number.isFinite(point.y),name+' yields a usable point');
 const r=Math.hypot(point.x-b.x,point.y-b.y),eps=1e-6;
 if(name==='inner'){assert.ok(r>=118-eps&&r<=180+eps,'inner supplies leave a full shield clear of the core and wall');}
 else if(name==='corridor'){assert.ok(r>=340-eps&&r<=370+eps,'corridor supplies remain clear of both rotating rings');}
 else{assert.ok(point.x>=80-eps&&point.x<=1840+eps&&point.y>=80-eps&&point.y<=1000+eps,'outside supplies stay within the viewport');assert.ok(r>=530-eps,'outside supplies stay clear of the shell');}
 for(const g of b.generators)if(g.hp>0)assert.ok(Math.hypot(point.x-g.x,point.y-g.y)>=S.GENERATOR+68-eps,'live generator clearance');
 if(!p.dead)assert.ok(Math.hypot(point.x-p.x,point.y-p.y)>=66-eps,'a new supply does not materialize directly on the pilot');
 for(const pk of e.pickups)assert.ok(Math.hypot(point.x-pk.x,point.y-pk.y)>=80-eps,'separate pickup halos');
 for(const a of [0,.4,1.2,Math.PI,-2.3]){
  b.outerAngle=b.pOuterAngle=a;b.innerAngle=b.pInnerAngle=-a*.7;
  assert.equal(S.firstHit(b,{...point,px:point.x,py:point.y},60,{hullOnly:true,fromTime:1,toTime:1}),null,'a shielded pilot fits at the supply for every ring pose');
 }
}
for(const name of ['outside','corridor','inner']){
 const f=fixture();zone(f,name);assert.equal(typeof f.e.voidPickupPoint,'function');
 const points=[],sectors=new Set(),radii=new Set();
 for(let i=0;i<160;i++){
  const point=f.e.voidPickupPoint(f.b,f.p);safe(f,point,name);points.push(point);
  const angle=Math.atan2(point.y-f.b.y,point.x-f.b.x);sectors.add(Math.floor((angle+Math.PI)/(Math.PI/4))%8);radii.add(Math.round(Math.hypot(point.x-f.b.x,point.y-f.b.y)));
 }
 assert.ok(new Set(points.map(p=>p.x.toFixed(3)+':'+p.y.toFixed(3))).size>100,'positions genuinely vary across repeated appearances');
 assert.ok(sectors.size>=(name==='outside'?6:7),'supplies use many directions rather than one fixed side');assert.ok(radii.size>=10,'distance varies as well as angle');
 f.setRandom(()=>0);const first=f.e.voidPickupPoint(f.b,f.p);safe(f,first,name);f.e.pickups=[{id:1,...first,type:'flare',phase:0}];
 f.setRandom(()=>0);const alternate=f.e.voidPickupPoint(f.b,f.p);safe(f,alternate,name);assert.ok(f.getCalls()<=200,'a repeated random value cannot cause an unbounded retry loop');
 // Deliberately fill every candidate region. Exhaustion must return null,
 // rather than place a supply on another object or loop indefinitely.
 f.e.pickups=[];for(let x=0;x<=1920;x+=40)for(let y=0;y<=1080;y+=40)f.e.pickups.push({x,y});
 f.setRandom(()=>0);assert.equal(f.e.voidPickupPoint(f.b,f.p),null,'no unsafe fallback when every point is occupied');assert.ok(f.getCalls()<=200);
}
{
 const f=fixture(),{e,p,b}=f;zone(f,'corridor');p.bullets=0;p.flare=0;e.nextPickup=0;
 e.updatePickups(1/60);assert.equal(e.pickups.length,1);assert.equal(e.pickups[0].type,'ammo3');assert.equal(e.nextPickup,5);
 const pk=e.pickups[0];Object.assign(p,{x:pk.x,y:pk.y,px:pk.x,py:pk.y});e.updatePickups(0);assert.equal(p.bullets,6,'randomly placed ammunition can be collected normally');assert.equal(e.pickups.length,0);
 e.nextPickup=0;e.updatePickups(0);assert.equal(e.pickups.length,1);assert.equal(e.pickups[0].type,'flare','the existing low-ammo priority remains intact');
 e.updatePickups(2);assert.equal(e.pickups.length,1);assert.equal(e.nextPickup,3);e.updatePickups(3);assert.equal(e.pickups.length,2,'the existing five-second appearance interval is preserved');
 for(let i=0;i<7;i++)e.updatePickups(5);assert.ok(e.pickups.length<=5,'the supply queue remains bounded');
 b.stage='escape';const ids=e.pickups.map(pk=>pk.id);e.nextPickup=0;e.updatePickups(0);assert.deepEqual(e.pickups.map(pk=>pk.id),ids,'no new supplies during timed escape');
}
console.log('Void supplies OK: varied safe positions in all three regions, shield-wide rotating-wall clearance, separated icons, bounded frozen-RNG fallback, normal collection, five-second cadence and escape/queue limits.');
