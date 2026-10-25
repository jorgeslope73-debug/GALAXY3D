'use strict';

const assert=require('node:assert/strict');
const {engineContext}=require('./check-session-regressions.js');
const context=engineContext(),core=context.window.GalaxyPhysicsCore;
const DT=1/60,R=core.SHIELD_RADIUS;
const names=['GalaxyHostPhysics','GalaxyLocalCpu'];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const rock=(x,y,r,vx=0)=>({id:1,x,y,px:x,py:y,r,vx,vy:0,angle:0,type:1,entered:true});
function fixture(name){
  const events=[],engine=new context.window[name]({onEvent:e=>events.push(e)});
  const players=[0,1].map(i=>Object.assign(engine.makePlayer(i,'J'+i,false),{
    x:i?1200:500,y:500,px:i?1200:500,py:500,vx:0,vy:0,
    protection:0,spawnFx:0,shield:i?0:10,dead:false,kills:0
  }));
  Object.assign(engine,{players,asteroids:[],meteors:[],bullets:[],flares:[],pickups:[],giant:null,ufo:null,
    activeShockwaves:[],fxClock:10,nextGiant:999999,nextUfo:999999,nextPickup:999999});
  engine.updateAsteroidPopulation=()=>{};
  return {engine,players,events};
}
function both(label,check){
  const results=[];
  for(const name of names){
    const f=fixture(name);check(f,name);
    for(const p of f.players)for(const key of ['x','y','vx','vy'])assert.ok(Number.isFinite(p[key]),name+' '+key);
    results.push(JSON.stringify({players:f.players.map(p=>[p.x,p.y,p.vx,p.vy,p.shield,p.dead]),
      rocks:[f.engine.asteroids,f.engine.meteors,f.engine.giant,f.engine.ufo],hits:f.engine.fxEvents}));
  }
  assert.equal(results[0],results[1],label+': CPU y online deben resolver el mismo contacto');
}
const checks=[
  ['radio activo, apagado y proteccion de reaparicion',()=>{
    assert.equal(R,60);
    assert.equal(core.shipCollisionRadius({shield:1}),R);
    assert.equal(core.shipCollisionRadius({shield:.001}),R);
    assert.equal(core.shipCollisionRadius({shield:0}),24);
    assert.equal(core.shipCollisionRadius({shield:0,protection:3}),24);
    assert.equal(core.shipCollisionRadius({shield:0},30),30);
  }],
  ['bala interceptada en el borde y efecto sobre la esfera',()=>both('bala',({engine,players:[p]})=>{
    engine.bullets=[{id:1,owner:1,x:500+R+5,y:500,vx:-120,vy:0,age:0,travel:100,guided:false}];
    engine.updateBullets(DT);
    assert.equal(engine.bullets.length,0);assert.equal(p.dead,false);assert.equal(p.shield,10);
    const hit=engine.fxEvents.find(e=>e.kind==='hit');
    assert.ok(hit);assert.ok(Math.abs(distance(p,hit)-R)<.11,'el destello se situa en el perimetro');
  })],
  ['misil consume el escudo en el borde y conserva la nave',()=>both('misil',({engine,players:[p]})=>{
    engine.bullets=[{id:1,owner:1,x:500+R+5,y:500,vx:-120,vy:0,age:0,travel:100,guided:true,target:-1}];
    engine.updateBullets(DT);
    assert.equal(engine.bullets.length,0);assert.equal(p.dead,false);assert.equal(p.shield,0);
    assert.ok(Math.abs(distance(p,engine.fxEvents.find(e=>e.kind==='hit'))-R)<.11);
  })],
  ['proyectil rapido impacta en el lado de entrada',()=>both('entrada continua',({engine,players:[p]})=>{
    engine.bullets=[{id:1,owner:1,x:430,y:500,vx:8400,vy:0,age:0,travel:100,guided:true,target:-1}];
    engine.updateBullets(DT);
    assert.equal(engine.bullets.length,0);assert.equal(p.dead,false);assert.equal(p.shield,0);
    const hit=engine.fxEvents.find(e=>e.kind==='hit');assert.ok(hit);assert.equal(hit.x,440);
  })],
  ['misil propio sale del escudo y puede chocar al regresar',()=>both('salida del misil',({engine,players:[p]})=>{
    p.guidedAmmo=1;p.guidedTarget=-1;p.reload=0;
    const missile=core.tryFireProjectile(p,{x:1,y:0},false,true,false,false,engine.players,()=>({x:1,y:0}),()=>99);
    assert.ok(missile&&missile.leavingOwnerShield);engine.bullets=[missile];
    for(let i=0;i<12;i++)engine.updateBullets(DT);
    assert.equal(engine.bullets.length,1);assert.equal(p.dead,false);assert.equal(p.shield,10);
    assert.equal(missile.leavingOwnerShield,false);
    missile.x=p.x+R+5;missile.vx=-400;missile.target=-1;engine.updateBullets(DT);
    assert.equal(engine.bullets.length,0);assert.equal(p.dead,false);assert.equal(p.shield,0);
  })],
  ['paso exterior y escudo agotado no amplian el casco',()=>{
    for(const shield of [10,0])both('sin contacto '+shield,({engine,players:[p]})=>{
      p.shield=shield;
      engine.bullets=[{id:1,owner:1,x:500+R+8,y:500,vx:0,vy:0,age:0,travel:100,guided:false}];
      engine.updateBullets(DT);assert.equal(engine.bullets.length,1);assert.equal(p.dead,false);
      if(!shield){
        engine.bullets[0].x=550;engine.updateBullets(DT);
        assert.equal(engine.bullets.length,1,'sin escudo un proyectil lejano al casco pasa');
      }
    });
  }],
  ['embestida al tocar escudo contra casco',()=>both('embestida',({engine,players:[a,b]})=>{
    b.x=a.x+R+24-.5;b.px=b.x;engine.shipCollisions();
    assert.equal(a.dead,false);assert.equal(b.dead,true);assert.equal(a.kills,1);
  })],
  ['dos escudos rebotan sin penetrar ni matar',()=>both('doble escudo',({engine,players:[a,b]})=>{
    b.shield=10;b.x=a.x+R*2-.5;b.px=b.x;a.vx=120;b.vx=-120;
    engine.shipCollisions();assert.equal(a.dead||b.dead,false);
    assert.ok(distance(a,b)>=R*2);assert.ok(a.vx<0&&b.vx>0);
  })],
  ['limite exterior y bordes opuestos no chocan',()=>{
    for(const edge of [false,true])both('separacion '+edge,({engine,players:[a,b]})=>{
      a.x=edge?5:500;b.x=edge?1915:a.x+R+core.SHIP_PROJECTILE_RADIUS+2;a.px=a.x;b.px=b.x;
      engine.shipCollisions();assert.equal(a.dead||b.dead,false);
    });
  }],
  ['asteroides y fragmentos chocan con la esfera',()=>{
    for(const r of [45,17])both('roca '+r,({engine,players:[p]})=>{
      p.vx=120;const a=rock(500+R+r-.5,500,r);engine.asteroids=[a];
      if(r===45){const edge=core.mediumSurface(a,300,500);p.x=p.px=edge.x+edge.nx*(R-.5);p.y=p.py=edge.y+edge.ny*(R-.5);p.vx=-edge.nx*120;p.vy=-edge.ny*120;}
      engine.shipCollisions();assert.equal(p.dead,false);assert.ok(p.vx<0);
      assert.ok(r===45?core.mediumSurface(a,p.x,p.y).distance>=R-.001:distance(p,a)>=R+r,'no debe quedar dentro del escudo');
    });
  }],
  ['meteorito de lluvia rebota desde el perimetro',()=>both('lluvia',({engine,players:[p]})=>{
    const m=rock(500+R+14-.5,500,14,-120);engine.meteors=[m];
    for(let i=0;i<60;i++){
      engine.updateMeteors(DT);assert.ok(distance(p,m)>=R+14-.001);
      assert.equal(p.dead,false);assert.ok(m.vx>0,'el meteorito se aleja del escudo');
    }
  })],
  ['gigante empuja desde la superficie y conserva su recorrido',()=>both('gigante',({engine,players:[p]})=>{
    const g=rock(690,500,core.GIANT_RADIUS,-40),edge=core.giantSurface(g,300,500);engine.giant=g;
    p.x=p.px=edge.x+edge.nx*(R-.5);p.y=p.py=edge.y+edge.ny*(R-.5);
    engine.updateGiant(DT);assert.equal(p.dead,false);assert.ok(core.giantSurface(g,p.x,p.y).distance>=R-.001);
    assert.equal(g.vx,-40);assert.ok(p.vx<0);
  })],
  ['OVNI rebota al tocar el escudo',()=>both('ovni',({engine,players:[p]})=>{
    engine.hazardStage=()=>({ufo:true});
    engine.campaignLevel=2;
    const u=rock(500+R+30-.5,500,30,-120);
    Object.assign(u,{born:10,nextSteer:20,bounceUntil:0});engine.ufo=u;
    engine.updateUfo(DT);assert.equal(p.dead,false);assert.ok(u.vx>0);assert.ok(distance(p,u)>=R+30);
  })],
  ['bengala rompe el escudo al tocar el borde',()=>both('bengala',({engine,players:[p]})=>{
    engine.flares=[{id:1,owner:1,x:500+R+12-.5,y:500,px:500+R+12-.5,py:500,ownerSafe:0}];
    engine.shipCollisions();assert.equal(p.dead,false);assert.equal(p.shield,0);assert.equal(engine.flares.length,0);
    const hit=engine.fxEvents.find(e=>e.kind==='hit');assert.ok(hit);assert.equal(hit.x,560);
  })],
  ['onda expansiva alcanza primero el borde del escudo',()=>both('onda',({engine,players:[owner,target]})=>{
    owner.shield=0;target.shield=10;target.x=600;target.px=600;
    engine.activeShockwaves=[{owner:0,x:500,y:500,born:engine.fxClock-.04,prevRadius:28,hitMask:0}];
    engine.started=true;engine.update(0);
    assert.equal(target.dead,false);assert.equal(target.shield,0);
    const hit=engine.fxEvents.find(e=>e.kind==='hit'&&e.i===1);assert.ok(hit);assert.equal(hit.x,540);
  })],
  ['contacto con centros coincidentes siempre queda finito',()=>both('centros',({engine,players:[p]})=>{
    const a=rock(p.x,p.y,45);engine.asteroids=[a];engine.shipCollisions();
    assert.equal(p.dead,false);assert.ok(core.mediumSurface(a,p.x,p.y).distance>=R-.001);
  })]
];
let failed=0;
for(const [label,check] of checks){try{check();console.log('OK: '+label);}catch(e){failed++;console.error('FALLO: '+label+'\n'+e.stack);}}
if(failed)process.exitCode=1;
else console.log('Escudo OK: perimetro compartido, proteccion, embestidas y rebotes; paridad local/online.');
