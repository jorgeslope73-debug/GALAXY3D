'use strict';

// A population change must retire a rock without looking like an impact.
// Exercise the shared speed ramp and both real asteroid integration loops.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const ctx=engineContext(),core=ctx.window.GalaxyPhysicsCore,DT=1/60,EPS=1e-8;
const clean=value=>JSON.parse(JSON.stringify(value));
const near=(a,b,label,tolerance=EPS)=>assert.ok(Math.abs(a-b)<tolerance,label+': '+a+' != '+b);
const speed=rock=>Math.hypot(rock.vx,rock.vy);
const moving=(id=1,v=80,angle=.7)=>({id,x:960,y:540,px:460,py:540,r:51.75,type:1,spin:1.1,pspin:.9,vx:Math.cos(angle)*v,vy:Math.sin(angle)*v,exitDelay:DT/2});
function engine(name){
  const result=new ctx.window[name]({});
  Object.assign(result,{players:[],asteroids:[],meteors:[],pickups:[],flares:[],bullets:[],giant:null,ufo:null});
  result.updateAsteroidPopulation=()=>{};
  return result;
}
function check(name,fn){fn();console.log('OK: '+name);}

check('marcar una retirada no cambia posición, rumbo, velocidad ni historial',()=>{
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const sim=engine(name),rock=moving(),before=clean(rock);
    // No random edge may choose the new heading, even accidentally.
    vm.runInContext('globalThis.savedExitRandom=Math.random;Math.random=()=>{throw Error("random exit heading");};',ctx);
    try{assert.doesNotThrow(()=>sim.beginAsteroidExit(rock));}
    finally{vm.runInContext('Math.random=globalThis.savedExitRandom;delete globalThis.savedExitRandom;',ctx);}
    assert.equal(rock.exiting,true);assert.equal(rock.exitDelay,-1);
    for(const field of ['x','y','px','py','vx','vy','spin','pspin'])assert.equal(rock[field],before[field],name+': marcar salida conserva '+field);
    const marked=clean(rock);sim.beginAsteroidExit(rock);
    assert.deepEqual(clean(rock),marked,name+': marcar dos veces es idempotente');
  }
});

check('la rapidez converge a90 sin girar y con aceleración máxima30/s² a30/60/120Hz',()=>{
  assert.equal(typeof core.stepAsteroidExit,'function');
  for(const hz of [30,60,120])for(const initial of [1,40,80,190])for(const angle of [0,.31,1.7,Math.PI,4.8]){
    const rock={...moving(1,initial,angle),exiting:true},dt=1/hz,position={x:rock.x,y:rock.y};
    for(let tick=0;tick<7*hz;tick++){
      const before={vx:rock.vx,vy:rock.vy},oldSpeed=speed(rock),error=Math.abs(oldSpeed-90);
      core.stepAsteroidExit(rock,dt);
      assert.ok(Math.hypot(rock.vx-before.vx,rock.vy-before.vy)<=30*dt+EPS,'no hay salto de velocidad');
      assert.ok(Math.abs(speed(rock)-90)<=error+EPS,'el ajuste se acerca a90 sin sobrepasarlo');
      near(rock.vx/speed(rock),Math.cos(angle),'se conserva el rumbo x');
      near(rock.vy/speed(rock),Math.sin(angle),'se conserva el rumbo y');
      assert.equal(rock.x,position.x,'el helper no integra ni teletransporta');
      assert.equal(rock.y,position.y);
    }
    near(speed(rock),90,'la rapidez termina estabilizada en90');
  }
  const active=moving(),before=clean(active);core.stepAsteroidExit(active,DT);
  assert.deepEqual(clean(active),before,'la rampa no afecta a asteroides activos');
});

check('un asteroide parado arranca suavemente hacia su borde más cercano',()=>{
  const places=[{x:50,y:540,dx:-1,dy:0},{x:1870,y:540,dx:1,dy:0},{x:960,y:50,dx:0,dy:-1},{x:960,y:1030,dx:0,dy:1}];
  for(const hz of [30,60,120])for(const {x,y,dx,dy} of places){
    const rock={...moving(1,0),x,y,exiting:true};
    core.stepAsteroidExit(rock,1/hz);
    assert.ok(speed(rock)>0&&speed(rock)<=30/hz+EPS,'el arranque desde0 tiene aceleración acotada');
    near(rock.vx/speed(rock),dx,'apunta al borde cercano x');near(rock.vy/speed(rock),dy,'apunta al borde cercano y');
  }
  const a={...moving(1,0),x:50,y:50,exiting:true},b={...a};
  core.stepAsteroidExit(a,DT,100,100);core.stepAsteroidExit(b,DT,100,100);
  assert.deepEqual(clean(a),clean(b),'el empate entre bordes se resuelve de forma determinista');
  assert.ok((a.vx===0)!==(a.vy===0),'el empate elige un borde, no una diagonal inventada');
});

check('ambos motores integran sin salto ni barrido antiguo y conservan la misma trayectoria',()=>{
  const paths=[];
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const sim=engine(name),rock=moving();sim.asteroids=[rock];const path=[];
    for(let tick=0;tick<240;tick++){
      const before=clean(rock);sim.updateAsteroids(DT);
      assert.equal(rock.exiting,true);
      near(rock.px,before.x,'px es el comienzo real del tick');near(rock.py,before.y,'py es el comienzo real del tick');
      near(rock.x,before.x+rock.vx*DT,'x solo avanza por la velocidad integrada');
      near(rock.y,before.y+rock.vy*DT,'y solo avanza por la velocidad integrada');
      assert.ok(Math.hypot(rock.vx-before.vx,rock.vy-before.vy)<=.5+EPS,'el motor aplica como máximo0.5 por tick');
      if(tick===0){
        const oldPathPoint={x:700,y:540,px:700,py:540};
        assert.equal(core.asteroidHitsCircle(rock,oldPathPoint,4,()=>false),null,'la salida no reutiliza el px de un tick antiguo');
        assert.ok(core.asteroidHitsCircle(rock,{x:rock.x,y:rock.y},4,()=>false),'la posición real final sigue siendo sólida');
      }
      path.push(clean({x:rock.x,y:rock.y,vx:rock.vx,vy:rock.vy,spin:rock.spin,px:rock.px,py:rock.py}));
    }
    paths.push(path);
  }
  assert.deepEqual(paths[0],paths[1],'anfitrión y CPU conservan exactamente la misma retirada');
});

check('la salida termina fuera de pantalla para velocidades0/1/40/80/190 y distintos rumbos',()=>{
  let maxSeconds=0;
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu'])for(const initial of [0,1,40,80,190])for(const angle of [0,.6,1.6,Math.PI,4.9]){
    const sim=engine(name),rock=moving(1,initial,angle);sim.asteroids=[rock];
    let frames=0;
    while(sim.asteroids.length&&frames<36*60){
      sim.updateAsteroids(DT);frames++;
      if(sim.asteroids.length)assert.ok(rock.x>=-220&&rock.x<=2140&&rock.y>=-220&&rock.y<=1300,'no se retira un cuerpo que aún está dentro del margen');
    }
    assert.equal(sim.asteroids.length,0,name+': la retirada no queda atrapada sin obstáculos');
    assert.ok(rock.x<-220||rock.x>2140||rock.y<-220||rock.y>1300,'solo desaparece tras salir completamente');
    maxSeconds=Math.max(maxSeconds,frames*DT);
  }
  console.log('  retirada más larga: '+maxSeconds.toFixed(3)+' s');
});

check('los contactos físicos con retirados y gigante conservan su respuesta',()=>{
  const exiting={...moving(1,80,0),x:800,y:500,px:800,py:500,exiting:true,exitDelay:-1};
  const active={...moving(2,80,Math.PI),x:870,y:500,px:870,py:500};
  core.stepAsteroidExit(exiting,DT);
  const before=clean(exiting),oldActive=clean(active);
  assert.ok(core.rockContact(exiting,active));
  assert.equal(core.resolveAsteroidPairCollision(exiting,active,51.75,190),true);
  assert.equal(core.rockContact(exiting,active),null,'se separan los contornos reales');
  for(const field of ['x','y','vx','vy'])near(exiting[field],before[field],'el retirado mantiene su trayectoria cinemática '+field);
  assert.ok(Math.hypot(active.vx-oldActive.vx,active.vy-oldActive.vy)>1,'el asteroide activo recibe el choque legítimo');
  const bothA={...before},bothB={...before,id:2,x:before.x+20};
  const bothBefore=clean([bothA,bothB]);
  assert.equal(core.resolveAsteroidPairCollision(bothA,bothB,51.75),false,'se conserva la regla anterior entre dos retirados');
  assert.deepEqual(clean([bothA,bothB]),bothBefore);
  const giant={x:900,y:500,vx:45,vy:0},rock={...moving(7,60,Math.PI),x:1059.5,y:500,px:1059.5,py:500,exiting:true};
  core.stepAsteroidExit(rock,DT);core.captureRockMotion(rock);
  const gBefore=clean(giant),vBefore={vx:rock.vx,vy:rock.vy};
  assert.equal(core.resolveGiantAsteroidContacts(giant,[rock],core.GIANT_RADIUS,51.75),true,'el gigante sigue alcanzando al mediano retirado');
  assert.deepEqual(clean(giant),gBefore,'el gigante conserva posición y velocidad');
  assert.equal(rock.exiting,true);assert.equal(core.rockContact(giant,rock,core.GIANT_RADIUS,51.75,'giant'),null);
  assert.ok(Math.hypot(rock.vx-vBefore.vx,rock.vy-vBefore.vy)>1,'se permite cambiar rumbo por un impacto real');
  const after={vx:rock.vx,vy:rock.vy},heading={x:rock.vx/speed(rock),y:rock.vy/speed(rock)};
  core.stepAsteroidExit(rock,DT);
  near(rock.vx/speed(rock),heading.x,'la retirada conserva el rumbo posterior al impacto x');
  near(rock.vy/speed(rock),heading.y,'la retirada conserva el rumbo posterior al impacto y');
  assert.ok(Math.hypot(rock.vx-after.vx,rock.vy-after.vy)<=.5+EPS,'no deshace el choque con un salto de velocidad');
});

check('el estado público y el códec conservan los mismos campos de asteroide',()=>{
  vm.runInContext(fs.readFileSync('docs/net-state-codec.js','utf8'),ctx);
  const codec=ctx.window.GalaxyStateCodec,expected=['fragment','id','r','s','type','x','y'];
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const sim=engine(name),rock=moving();sim.asteroids=[rock];
    const before=sim.publicState();sim.beginAsteroidExit(rock);sim.updateAsteroids(DT);
    const after=sim.publicState();
    assert.deepEqual(Object.keys(before.asteroids[0]).sort(),expected);
    assert.deepEqual(Object.keys(after.asteroids[0]).sort(),expected,'la retirada no añade heading, velocidad ni flags al protocolo');
    const packet=codec.encode(after,0);assert.ok(packet);
    const restored=codec.decode(clean(packet));assert.ok(restored);
    assert.deepEqual(clean(restored.asteroids),clean(after.asteroids),'el invitado recibe los mismos contornos y posiciones');
  }
});

console.log('Retirada de asteroides OK: continuidad, rampa limitada, rumbo, salida finita, contactos y protocolo sin campos nuevos.');
