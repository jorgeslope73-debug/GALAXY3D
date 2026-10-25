'use strict';

// Exercise the real shared solver and both game engines at their normal tick.
// The fixtures stay away from the arena edge and do not require swept/CCD hits.
const assert=require('node:assert/strict');
const {engineContext}=require('./check-session-regressions.js');
const context=engineContext();
const core=context.window.GalaxyPhysicsCore;
const DT=1/60,EPS=1e-7;
const clone=value=>JSON.parse(JSON.stringify(value));
const rock=(x,y,vx=0,vy=0,r=45,extra={})=>({id:'rock',x,y,px:x,py:y,vx,vy,r,angle:0,type:1,...extra});
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
function separated(a,b,radius,label){
  if(core.isMediumRock(a,Number(a.r)||14)||core.isMediumRock(b,Number(b.r)||14)){assert.equal(core.rockContact(a,b,Number(a.r)||14,Number(b.r)||14),null,label+': los contornos reales siguen solapados');return;}
  assert.ok(distance(a,b)>=radius-EPS,label+': las superficies siguen solapadas ('+distance(a,b)+' < '+radius+')');
}
function finite(body,label,maxSpeed){
  for(const key of ['x','y','vx','vy'])assert.ok(Number.isFinite(body[key]),label+': '+key+' no es finito');
  if(maxSpeed)assert.ok(Math.hypot(body.vx,body.vy)<=maxSpeed+EPS,label+': velocidad excesiva');
}
function separating(a,b,label){
  const closing=(b.vx-a.vx)*(b.x-a.x)+(b.vy-a.vy)*(b.y-a.y);
  assert.ok(closing>=-EPS,label+': siguen acercandose despues de resolver el choque');
}
function fixture(name,state){
  const engine=new context.window[name]({onState:()=>{},onEvent:()=>{}});
  Object.assign(engine,{players:[],asteroids:[],meteors:[],pickups:[],flares:[],giant:null,nextGiant:999999},clone(state));
  // Isolate the existing bodies from scheduled population/spawn changes only.
  engine.updateAsteroidPopulation=()=>{};
  return engine;
}
function snapshot(engine){
  return clone({meteors:engine.meteors,asteroids:engine.asteroids,giant:engine.giant});
}
function bothEngines(label,state,frames,step,verify){
  const results=[];
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const engine=fixture(name,state);
    for(let frame=0;frame<frames;frame++){
      step(engine,frame);
      for(const body of engine.meteors)finite(body,label+' '+name+' meteorito',240);
      for(const body of engine.asteroids)finite(body,label+' '+name+' asteroide',190);
      if(engine.giant)finite(engine.giant,label+' '+name+' gigante',52);
      verify(engine,frame,name);
    }
    results.push(snapshot(engine));
  }
  assert.deepEqual(results[0],results[1],label+': CPU local y autoridad online no coinciden');
}
function giantChain(count){
  const giant=rock(900,500,45,0,core.GIANT_RADIUS,{id:9,entered:true});
  const asteroids=[
    rock(1059.5,500,-60,0,51.75,{id:1,spin:1.1,pspin:1.1,exitDelay:-1}),
    rock(1143.4687408106652,509.4604739136755,-60,0,51.75,{id:2,spin:1.7,pspin:1.7,exitDelay:-1})
  ];
  const dx=asteroids[1].x-asteroids[0].x,dy=asteroids[1].y-asteroids[0].y,length=Math.hypot(dx,dy);
  while(asteroids.length<count){
    const previous=asteroids.at(-1),id=asteroids.length+1;let next;
    for(let gap=60;gap<125;gap+=.25){
      const x=previous.x+dx/length*gap,y=previous.y+dy/length*gap;
      const candidate=rock(x,y,-60,0,51.75,{id,spin:id*.6+.5,pspin:id*.6+.5,exitDelay:-1});
      if(asteroids.every(a=>!core.rockContact(a,candidate,a.r,candidate.r))&&!core.rockContact(giant,candidate,giant.r,candidate.r,'giant')){next=candidate;break;}
    }
    assert.ok(next,'la fila oblicua empieza sin solapes entre vecinos');asteroids.push(next);
  }
  return {giant,asteroids};
}

const checks=[
  ['lluvia contra lluvia: impulso y separacion completa',()=>{
    const a=rock(500,500,200,20,14),b=rock(524,500,-180,20,14);
    core.resolveMeteorCollisions([a,b],[]);
    separated(a,b,28,'lluvia contra lluvia');separating(a,b,'lluvia contra lluvia');
    assert.ok(a.vx<0&&b.vx>0,'los meteoritos enfrentados deben rebotar');
    assert.equal(a.vy,20,'un choque frontal conserva la componente tangencial');
    assert.equal(b.vy,20);
    finite(a,'meteorito A',240);finite(b,'meteorito B',240);
  }],
  ['asteroide movil alcanza meteorito y transmite impulso',()=>{
    for(const radius of [45,17]){
      const a=rock(500,500,150,0,radius,{fragment:radius===17});
      const m=rock(500+radius+10,500,40,0,14);
      if(radius===45){const hit=core.mediumSurface(a,800,500);m.x=m.px=hit.x+hit.nx*10;m.y=m.py=hit.y+hit.ny*10;}
      core.resolveMeteorCollisions([m],[a]);
      separated(a,m,radius+14,'asteroide/fragmento contra lluvia');
      separating(a,m,'asteroide/fragmento contra lluvia');
      assert.ok(m.vx>40,'debe considerar la velocidad relativa, aunque el meteorito ya vaya hacia fuera');
      assert.ok(a.vx<150,'el cuerpo movil tambien recibe el impulso');
      finite(a,'asteroide/fragmento',190);finite(m,'meteorito',240);
    }
  }],
  ['centros coincidentes: asteroides y gigante',()=>{
    const a=rock(500,500,100,0),b=rock(500,500,-80,0);
    assert.equal(core.resolveAsteroidPairCollision(a,b),true);
    separated(a,b,90,'asteroides con centro coincidente');
    separating(a,b,'asteroides con centro coincidente');
    const g=rock(900,500,45,0,core.GIANT_RADIUS),m=rock(900,500,0,0,14);
    assert.equal(core.resolveGiantAsteroidCollision(g,m,core.GIANT_RADIUS,14,240),true);
    assert.ok(core.giantSurface(g,m.x,m.y).distance>=m.r,'el cuerpo sale del contorno real del gigante');
    assert.deepEqual([g.x,g.y,g.vx,g.vy],[900,500,45,0],'el gigante conserva su trayectoria');
    finite(a,'centro A',190);finite(b,'centro B',190);finite(m,'centro meteorito',240);
  }],
  ['fragmentos hermanos: salida inicial y nueva aproximacion',()=>{
    const a=rock(500,500,-45,0,16,{fragment:true,fragmentGroup:'same'});
    const b=rock(520,500,45,0,16,{fragment:true,fragmentGroup:'same'});
    const initial=clone([a,b]);
    assert.equal(core.resolveAsteroidPairCollision(a,b),false,'la rotura inicial permite que se separen');
    assert.deepEqual(clone([a,b]),initial,'el impulso inicial de fractura no debe modificarse');
    // A third rock may reverse a fragment before the pair reaches release distance.
    a.vx=45;b.vx=-45;
    assert.equal(core.resolveAsteroidPairCollision(a,b),true,'no deben atravesarse si vuelven a acercarse');
    separated(a,b,32,'hermanos al volver a chocar');separating(a,b,'hermanos al volver a chocar');
  }],
  ['cuerpos en retirada: rebotan los otros sin bloquear la salida',()=>{
    for(const exitingFirst of [false,true]){
      const exiting=rock(550,500,-100,0,45,{exiting:true});
      const a=rock(500,500,110,0,45),before=clone(exiting);
      assert.equal(core.resolveAsteroidPairCollision(...(exitingFirst?[exiting,a]:[a,exiting])),true);
      separated(a,exiting,90,'asteroide en retirada');
      assert.deepEqual(exiting,before,'la retirada conserva posicion y velocidad');
      assert.ok(a.vx<0,'el asteroide activo rebota contra el que sale');
    }
    const exiting=rock(550,500,-100,0,45,{exiting:true}),m=rock(500,500,140,0,14),before=clone(exiting);
    const edge=core.mediumSurface(exiting,300,500);m.x=m.px=edge.x+edge.nx*10;m.y=m.py=edge.y+edge.ny*10;
    core.resolveMeteorCollisions([m],[exiting]);
    separated(m,exiting,59,'meteorito contra cuerpo en retirada');
    assert.deepEqual(exiting,before,'la lluvia tampoco bloquea la retirada');
    assert.ok(m.vx<0,'el meteorito rebota contra el asteroide que sale');
  }],
  ['ambos motores: lluvia frontal durante 90 ticks',()=>{
    bothEngines('lluvia frontal',{meteors:[rock(500,500,200,0,14,{id:'m1'}),rock(560,500,-180,0,14,{id:'m2'})]},90,
      engine=>engine.updateMeteors(DT),(engine,frame)=>{
        assert.equal(engine.meteors.length,2,'el choque no destruye meteoritos');
        const [a,b]=engine.meteors;
        separated(a,b,28,'lluvia tick '+frame);
        assert.ok(a.x<b.x,'no deben intercambiar sus lados atravesandose');
        if(frame===89)assert.ok(a.vx<0&&b.vx>0,'deben alejarse despues del choque');
      });
  }],
  ['ambos motores: asteroide y fragmento moviles durante 60 ticks',()=>{
    for(const radius of [45,17]){
      bothEngines('asteroide/fragmento movil '+radius,{
        meteors:[rock(500,500,60,0,14,{id:'meteor'})],
        asteroids:[rock(575,500,-110,0,radius,{fragment:radius===17,id:'asteroid'})]
      },60,engine=>{engine.updateAsteroids(DT);engine.updateMeteors(DT);},(engine,frame)=>{
        const m=engine.meteors[0],a=engine.asteroids[0];
        separated(m,a,radius+14,'asteroide/fragmento tick '+frame);
        if(frame===59)assert.ok(m.vx<0,'la lluvia debe rebotar en el asteroide/fragmento');
      });
    }
  }],
  ['ambos motores: cuerpo rapido alcanza lluvia que se aleja',()=>{
    for(const radius of [45,17]){
      bothEngines('alcance '+radius,{
        meteors:[rock(570,500,40,0,14,{id:'meteor'})],
        asteroids:[rock(500,500,150,0,radius,{fragment:radius===17,id:'asteroid'})]
      },60,engine=>{engine.updateAsteroids(DT);engine.updateMeteors(DT);},(engine,frame)=>{
        const m=engine.meteors[0],a=engine.asteroids[0];
        separated(a,m,radius+14,'alcance tick '+frame);
        if(frame===59){
          assert.ok(m.vx>40,'el impacto relativo debe acelerar el meteorito que ya se alejaba');
          assert.ok(a.vx<150,'el asteroide/fragmento tambien debe responder al impacto');
        }
      });
    }
  }],
  ['ambos motores: asteroide en retirada conserva su recorrido',()=>{
    bothEngines('retirada',{
      asteroids:[rock(500,500,110,0,45,{id:'active'}),rock(650,500,-100,0,45,{id:'exiting',exiting:true})]
    },60,engine=>engine.updateAsteroids(DT),(engine,frame)=>{
      const [a,exit]=engine.asteroids;separated(a,exit,90,'retirada tick '+frame);
      assert.equal(exit.vx,-100,'la retirada mantiene su velocidad');
      assert.ok(Math.abs(exit.x-(650-100*DT*(frame+1)))<EPS,'la retirada mantiene su recorrido');
      if(frame===59)assert.ok(a.vx<0,'el cuerpo activo debe rebotar durante la retirada');
    });
  }],
  ['ambos motores: gigante alcanza lluvia despues de moverse',()=>{
    bothEngines('gigante movil',{
      giant:rock(500,500,50,0,core.GIANT_RADIUS,{id:'giant',entered:true}),
      meteors:[(()=>{const hit=core.giantSurface({x:500,y:500},800,500);return rock(hit.x+hit.nx*13.5,hit.y+hit.ny*13.5,0,0,14,{id:'meteor'});})()]
    },60,engine=>{engine.updateMeteors(DT);engine.updateGiant(DT);},(engine,frame)=>{
      const g=engine.giant,m=engine.meteors[0];
      assert.ok(core.giantSurface(g,m.x,m.y).distance>=m.r-EPS,'el meteorito no penetra el contorno del gigante en tick '+frame);
      assert.equal(g.vx,50,'el gigante no cambia de velocidad');
      assert.ok(Math.abs(g.x-(500+50*DT*(frame+1)))<EPS,'el gigante no cambia de recorrido');
      assert.ok(m.vx>0,'el meteorito recibe el impulso despues del movimiento del gigante');
    });
  }],
  ['ambos motores: mediano en retirada sigue siendo solido frente al gigante',()=>{
    bothEngines('retirada contra gigante',{
      giant:rock(900,500,45,0,core.GIANT_RADIUS,{id:9,entered:true}),
      asteroids:[rock(1200,500,-90,0,51.75,{id:1,spin:1.1,pspin:1.1,exitDelay:-1,exiting:true})]
    },360,engine=>{engine.updateAsteroids(DT);engine.updateGiant(DT);},(engine,frame)=>{
      const g=engine.giant,a=engine.asteroids[0];
      assert.ok(a,'el contacto no elimina el mediano en retirada');
      assert.equal(core.rockContact(g,a,core.GIANT_RADIUS,a.r,'giant'),null,'la retirada no permite atravesar la silueta del gigante en tick '+frame);
      assert.equal(a.exiting,true,'se conserva la retirada de poblacion despues del rebote');
      assert.ok(Math.abs(g.x-(900+45*DT*(frame+1)))<EPS,'el gigante conserva su recorrido');
      if(frame===359)assert.ok(a.vx!==-90||a.vy!==0,'el contacto debe cambiar la trayectoria del mediano que salia');
    });
  }],
  ['ambos motores: empuje gigante-mediano-mediano termina en el mismo tick',()=>{
    bothEngines('cadena contra gigante',{
      giant:rock(900,500,45,0,core.GIANT_RADIUS,{id:9,entered:true}),
      asteroids:[
        rock(1059.5,500,0,0,51.75,{id:1,spin:1.1,pspin:1.1,exitDelay:-1}),
        rock(1143.4687408106652,509.4604739136755,0,0,51.75,{id:2,spin:1.7,pspin:1.7,exitDelay:-1})
      ]
    },120,engine=>{engine.updateAsteroids(DT);engine.updateGiant(DT);},(engine,frame)=>{
      const g=engine.giant,[a,b]=engine.asteroids;
      assert.equal(core.rockContact(a,b,a.r,b.r),null,'el empuje no deja medianos incrustados hasta otro tick: '+frame);
      for(const m of [a,b])assert.equal(core.rockContact(g,m,core.GIANT_RADIUS,m.r,'giant'),null,'resolver la cadena tampoco deja un mediano dentro del gigante');
      assert.ok(Math.abs(g.x-(900+45*DT*(frame+1)))<EPS,'resolver la cadena no integra ni mueve dos veces al gigante');
    });
  }],
  ['ambos motores: el apoyo se propaga por tres a cinco medianos en cualquier orden',()=>{
    for(const count of [3,4,5])for(const reversed of [false,true]){
      const state=giantChain(count);if(reversed)state.asteroids.reverse();
      bothEngines('fila oblicua '+count+' invertida '+reversed,state,120,engine=>{engine.updateAsteroids(DT);engine.updateGiant(DT);},(engine,frame)=>{
        for(let i=0;i<count;i++){
          const a=engine.asteroids[i];
          assert.equal(core.rockContact(engine.giant,a,core.GIANT_RADIUS,a.r,'giant'),null,'la fila queda fuera del gigante desde el tick '+frame);
          for(let j=i+1;j<count;j++)assert.equal(core.rockContact(a,engine.asteroids[j],a.r,engine.asteroids[j].r),null,'la propagacion no deja vecinos solapados en tick '+frame);
        }
        assert.ok(Math.abs(engine.giant.x-(900+45*DT*(frame+1)))<EPS,'propagar apoyo no integra de nuevo al gigante');
      });
    }
  }],
  ['el sesgo de separacion no convierte el mediano apoyado en masa infinita',()=>{
    const state=giantChain(2);for(const a of state.asteroids){a.vx=0;a.vy=0;}
    const reference=clone(state);
    for(const a of reference.asteroids)core.resolveGiantAsteroidCollision(reference.giant,a,core.GIANT_RADIUS,a.r);
    const momentum=items=>items.reduce((sum,a)=>[sum[0]+a.r*a.r*a.vx,sum[1]+a.r*a.r*a.vy],[0,0]);
    const expected=momentum(reference.asteroids),giant=clone(state.giant);
    assert.equal(core.resolveGiantAsteroidContacts(state.giant,state.asteroids),true);
    const actual=momentum(state.asteroids);
    assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<1e-6,'el impulso entre los dos medianos conserva su momento con las masas originales');
    assert.deepEqual(state.giant,giant,'solo el gigante tiene masa fija durante el impulso');
  }],
  ['ambos motores: un vecino en retirada no bloquea el apoyo del gigante',()=>{
    for(const exitingIndex of [0,1]){
      const state=giantChain(2);state.asteroids[exitingIndex].exiting=true;
      bothEngines('cadena con retirada '+exitingIndex,state,60,engine=>{engine.updateAsteroids(DT);engine.updateGiant(DT);},engine=>{
        const [a,b]=engine.asteroids;
        assert.equal(core.rockContact(a,b,a.r,b.r),null,'el vecino de trayectoria fija tampoco deja una pareja incrustada');
        for(const m of [a,b])assert.equal(core.rockContact(engine.giant,m,core.GIANT_RADIUS,m.r,'giant'),null,'el gigante permanece solido al resolver la retirada');
        assert.equal(engine.asteroids[exitingIndex].exiting,true,'se conserva la retirada durante toda la cadena');
      });
    }
  }],
  ['dos medianos apoyados en el gigante se separan incluso con una retirada',()=>{
    for(const exiting of [false,true])for(const reversed of [false,true]){
      const giant=rock(900,500,45,0,core.GIANT_RADIUS),before=clone(giant);
      const bodies=[rock(1059.5,500,-60,0,51.75,{id:1,spin:1.1}),rock(1029.5,450,-60,0,51.75,{id:2,spin:1.7,exiting})];
      for(const a of bodies)assert.ok(core.rockContact(giant,a,giant.r,a.r,'giant'),'ambos cuerpos empiezan realmente apoyados');
      if(reversed)bodies.reverse();
      assert.equal(core.resolveGiantAsteroidContacts(giant,bodies),true);
      assert.equal(core.rockContact(bodies[0],bodies[1],51.75,51.75),null,'los dos apoyos no quedan bloqueados entre si');
      for(const a of bodies){assert.equal(core.rockContact(giant,a,giant.r,a.r,'giant'),null);finite(a,'doble apoyo',190);}
      assert.deepEqual(giant,before,'el ajuste de apoyos mantiene fijo el gigante');
    }
  }],
  ['separar un mediano que ya se aleja no le da patadas extra',()=>{
    const g=rock(900,500,0,0,core.GIANT_RADIUS),a=rock(1059.5,500,0,0,51.75,{id:1,spin:1.1});
    const hit=core.rockContact(g,a,g.r,a.r,'giant');assert.ok(hit);
    a.vx=hit.nx*60;a.vy=hit.ny*60;
    const velocity=[a.vx,a.vy];
    assert.equal(core.resolveGiantAsteroidContacts(g,[a],g.r,a.r),true);
    assert.equal(core.rockContact(g,a,g.r,a.r,'giant'),null);
    assert.deepEqual([a.vx,a.vy],velocity,'la correccion de posicion no inyecta velocidad si el cuerpo ya se aleja');
    const settled=clone(a);
    assert.equal(core.resolveGiantAsteroidContacts(g,[a],g.r,a.r),false);
    assert.deepEqual(a,settled,'una comprobacion repetida sin contacto no cambia el cuerpo');
  }],
  ['sin contacto gigante no se repiten los pares y las otras retiradas se conservan',()=>{
    const g=rock(500,500,45,0,core.GIANT_RADIUS),a=rock(1300,500,0,0,51.75,{id:1,spin:1.1}),b=rock(1310,500,0,0,51.75,{id:2,spin:1.7});
    const before=clone([a,b]);
    assert.equal(core.resolveGiantAsteroidContacts(g,[a,b],g.r,a.r),false);
    assert.deepEqual([a,b],before,'la pasada extra solo se activa despues de un impacto con el gigante');
    const fragment=rock(g.x,g.y,30,0,17,{fragment:true,exiting:true}),original=clone(fragment);
    assert.equal(core.resolveGiantAsteroidCollision(g,fragment,g.r,17),false);
    assert.deepEqual(fragment,original,'la correccion de medianos no cambia las retiradas de fragmentos');
  }],
  ['ambos motores: choque de roce y paso cercano sin contacto',()=>{
    for(const offset of [24,31]){
      bothEngines('roce '+offset,{
        meteors:[rock(500,500,180,0,14,{id:'m1'}),rock(570,500+offset,-180,0,14,{id:'m2'})]
      },35,engine=>engine.updateMeteors(DT),(engine,frame)=>{
        const [a,b]=engine.meteors;separated(a,b,28,'roce tick '+frame);
        if(frame===34){
          if(offset===24)assert.ok(Math.abs(a.vy)>1&&Math.abs(b.vy)>1,'el roce debe desviar ambas trayectorias');
          else assert.deepEqual([a.vx,a.vy,b.vx,b.vy],[180,0,-180,0],'un paso sin contacto no debe producir rebote');
        }
      });
    }
  }],
  ['ambos motores: colision con bengala conserva su consumo',()=>{
    for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
      const engine=fixture(name,{meteors:[rock(500,500,120,0,14)],flares:[{x:505,y:500,px:505,py:500,owner:0}]});
      const impacts=[];engine.emitExplosionAt=(...args)=>impacts.push(args);
      engine.updateMeteors(DT);
      assert.equal(engine.meteors.length,0,name+': la bengala consume el meteorito');
      assert.equal(engine.flares.length,0,name+': la bengala tambien se consume');
      assert.equal(impacts.length,1,name+': un unico impacto');
    }
  }]
];

let failures=0;
for(const [label,check] of checks){
  try{check();console.log('OK: '+label);}
  catch(error){failures++;console.error('FALLO: '+label+'\n'+error.stack);}
}
if(failures){console.error(failures+' grupo(s) de colisiones fallan.');process.exitCode=1;}
else console.log('Colisiones OK: lluvia, asteroides, fragmentos y gigante; paridad CPU/online, contactos y velocidades finitas.');
