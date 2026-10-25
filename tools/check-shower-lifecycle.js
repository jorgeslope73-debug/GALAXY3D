'use strict';

// Keep the real rain scheduler, rock response and offscreen lifetime. A quiet
// arena isolates those paths from player deaths, weapons and CPU decisions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const DT=1/60,EPS=1e-8;
const clean=value=>JSON.parse(JSON.stringify(value));
const started=performance.now();
function context(seed=2){
  const ctx=engineContext();
  vm.runInContext('let showerSeed='+seed+';Math.random=()=>{showerSeed=(Math.imul(showerSeed,1664525)+1013904223)>>>0;return showerSeed/4294967296;};',ctx);
  for(const file of ['net-state-codec','network-playback'])vm.runInContext(fs.readFileSync('docs/'+file+'.js','utf8'),ctx,{filename:file+'.js'});
  return ctx;
}
function fixture(ctx,name='GalaxyHostPhysics'){
  const events=[];
  const engine=new ctx.window[name]({onEvent:event=>events.push(event)});
  Object.assign(engine,{players:[],asteroids:[],meteors:[],flares:[],pickups:[],bullets:[],giant:null,ufo:null,activeShockwaves:[],started:true,finished:false,firstShower:999999,nextShower:0,nextMeteor:0,showerLeft:0});
  return {engine,events};
}
const meteor=(id,x,y,vx=120,vy=0)=>({id,type:1,x,y,vx,vy,angle:30});
const bodies=()=>[meteor(10001,300,210),meteor(10002,900,540,-150,12),meteor(10003,1500,850,170,-16)];
const ids=engine=>Array.from(engine.meteors,m=>m.id);
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<EPS,label+': '+actual+' != '+expected);
function check(name,run){run();console.log('OK: '+name);}

check('los límites de fase preservan los meteoritos que ya están en vuelo',()=>{
  const ctx=context();
  for(const boundary of [165,285,360]){
    const {engine,events}=fixture(ctx);
    Object.assign(engine,{hazardCycleAge:boundary-DT/2,showerLeft:2,firstShower:999999,nextShower:0,nextMeteor:-1,meteors:bodies()});
    const original=engine.meteors,refs=original.slice(),before=clean(original);
    engine.updateHazardCycle(DT);
    assert.strictEqual(engine.meteors,original,'el calendario no sustituye el array al llegar a '+boundary+' s');
    assert.deepEqual(clean(engine.meteors),before,'el calendario conserva IDs, posiciones y velocidades a '+boundary+' s');
    engine.updateShower(DT);
    assert.equal(engine.showerLeft,0,'se interrumpe la emisión a '+boundary+' s');
    assert.deepEqual(clean(engine.meteors),before,'el bloqueo de nuevas lluvias no borra las existentes');
    engine.updateMeteors(DT);
    assert.deepEqual(ids(engine),before.map(m=>m.id));
    for(let i=0;i<refs.length;i++){
      assert.strictEqual(engine.meteors[i],refs[i],'el cuerpo conserva su identidad');
      near(refs[i].x,before[i].x+before[i].vx*DT,'el meteorito sigue avanzando');
      near(refs[i].y,before[i].y+before[i].vy*DT,'el meteorito sigue avanzando en y');
      near(refs[i].vx,before[i].vx,'no cambia vx por acabar la fase');
      near(refs[i].vy,before[i].vy,'no cambia vy por acabar la fase');
    }
    for(let frame=0;frame<5*60;frame++){
      engine.updateHazardCycle(DT);engine.updateShower(DT);
      assert.deepEqual(ids(engine),before.map(m=>m.id),'no se generan nuevos meteoritos durante descanso/apertura');
    }
    assert.equal(events.length,0,'el cambio de fase no produce explosiones ficticias');
  }
});

check('descansos completos y apertura del ciclo bloquean nuevas emisiones',()=>{
  const ctx=context();
  for(const [from,to] of [[165,195],[285,315],[0,32]]){
    const {engine}=fixture(ctx);
    Object.assign(engine,{hazardCycleAge:from,firstShower:0,nextShower:0,nextMeteor:-100});
    const frames=Math.round((to-from)*60)-1;
    for(let frame=0;frame<frames;frame++){
      engine.updateHazardCycle(DT);engine.updateShower(DT);
      assert.equal(engine.meteors.length,0,'no hay emisión en '+from+'–'+to+' s');
      assert.equal(engine.showerLeft,0);
    }
  }
});

check('con shower=0 siguen las colisiones y la retirada fuera de pantalla en ambos motores',()=>{
  const ctx=context();
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const {engine}=fixture(ctx,name);
    Object.assign(engine,{hazardCycleAge:170,meteors:[meteor(10,850,500,100),meteor(11,877,500,-100),meteor(12,2019,300,120)]});
    engine.updateShower(DT);engine.updateMeteors(DT);
    assert.equal(engine.showerLeft,0);
    assert.deepEqual(ids(engine),[10,11],name+': solo se retira el que ya ha salido');
    const [a,b]=engine.meteors;
    assert.ok(Math.hypot(b.x-a.x,b.y-a.y)>=28-EPS,name+': las superficies se separan');
    assert.ok((b.vx-a.vx)*(b.x-a.x)+(b.vy-a.vy)*(b.y-a.y)>=-EPS,name+': las velocidades dejan de acercarlos');
    for(let frame=0;frame<2400&&engine.meteors.length;frame++)engine.updateMeteors(DT);
    assert.equal(engine.meteors.length,0,name+': los restantes terminan su recorrido natural');
  }
});

check('la lluvia normal emite 7 s y sus últimos cuerpos terminan su viaje',()=>{
  const ctx=context();
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const {engine}=fixture(ctx,name);
    Object.assign(engine,{hazardCycleAge:60,firstShower:0});
    const profile=engine.hazardProfile();
    const born=new Set();let time=0;
    do{
      engine.updateShower(DT);
      for(const m of engine.meteors)born.add(m.id);
      engine.updateMeteors(DT);time+=DT;
      assert.ok(time<7.05,'la emisión tiene un final acotado');
    }while(engine.showerLeft>0);
    assert.ok(Math.abs(time-7)<=DT*2,name+': emisión durante 7 s');
    assert.ok(born.size>=14&&born.size<=28,name+': cantidad coherente con el intervalo de emisión');
    assert.ok(engine.meteors.length>0,name+': acabar la emisión no elimina a los que siguen visibles');
    assert.ok(engine.nextShower>=profile.showerRepeatMin&&engine.nextShower<=profile.showerRepeatMax,name+': se conserva la espera entre lluvias');
    for(let frame=0;frame<30*60;frame++){
      engine.updateShower(DT);
      assert.ok(engine.meteors.every(m=>born.has(m.id)),name+': no aparece otra lluvia durante el drenaje');
      engine.updateMeteors(DT);
    }
    assert.equal(engine.meteors.length,0,name+': todos salen o chocan de forma individual');
  }
});

check('iniciar y reiniciar una partida siguen limpiando los peligros antiguos',()=>{
  const ctx=context();
  for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
    const {engine}=fixture(ctx,name);
    engine.meteors=bodies();engine.showerLeft=2;
    if(name==='GalaxyHostPhysics')assert.equal(engine.start([{i:0,n:'Host'},{i:1,n:'Guest'}]),true);
    else engine.start('Human','medio',1,null,false);
    assert.equal(engine.meteors.length,0,name+': start limpia los cuerpos de la partida anterior');
    assert.equal(engine.showerLeft,0);
    engine.meteors=bodies();engine.showerLeft=2;engine.finished=true;
    engine.restart();
    assert.equal(engine.meteors.length,0,name+': restart conserva la limpieza legítima');
    assert.equal(engine.showerLeft,0);
    assert.equal(engine.started,true);
  }
});

check('publicState, códec e interpolación conservan los meteoritos durante el cambio de fase',()=>{
  const ctx=context(),codec=ctx.window.GalaxyStateCodec;
  const {engine}=fixture(ctx);
  Object.assign(engine,{hazardCycleAge:165-DT/2,meteors:bodies(),showerLeft:2,fxClock:164.95});
  const first=engine.publicState();
  engine.updateHazardCycle(DT);engine.updateShower(DT);
  for(let frame=0;frame<3;frame++)engine.updateMeteors(DT);
  engine.fxClock=165;
  const second=engine.publicState();
  assert.equal(second.shower,0);
  const playback=new ctx.window.GalaxyNetworkPlayback();
  const saved=JSON.stringify([first,second]);
  for(const [state,arrival] of [[first,1000],[second,1050]]){
    const packet=codec.encode(state,1);assert.ok(packet,'se codifica el estado real');
    const decoded=codec.decode(clean(packet));assert.ok(decoded,'se decodifica el estado real');
    assert.deepEqual(clean(decoded.meteors),clean(state.meteors),'el códec no elimina entidades con shower=0');
    assert.equal(playback.push(decoded,arrival),true);
  }
  for(let now=1050;now<1350;now+=10){
    const sample=playback.sample(now);
    assert.deepEqual(Array.from(sample.state.meteors,m=>m.id),ids(engine),'el invitado conserva los mismos IDs');
  }
  assert.equal(JSON.stringify([first,second]),saved,'la presentación no modifica los snapshots');
});

// A full six-minute calendar at 60 Hz is inexpensive without the unrelated AI,
// UFOs and weapons. Check bodies around every scheduler call, before movement
// can legitimately remove a rock after it crosses the arena boundary.
check('recorrido determinista hasta 365 s sin borrado masivo del calendario',()=>{
  const ctx=context(2),engine=new ctx.window.GalaxyHostPhysics({});
  assert.equal(engine.start([{i:0,n:'A'},{i:1,n:'B'}]),true);
  engine.players=[];engine.asteroids=[];
  let maxLive=0,totalBorn=0,previousIds=new Set();
  const allIds=new Set();
  const boundaries=[];
  for(let frame=0;frame<365*60;frame++){
    const before=clean(engine.meteors),oldAge=engine.hazardCycleAge;
    engine.fxClock+=DT;
    engine.updateHazardCycle(DT);
    assert.deepEqual(clean(engine.meteors),before,'el calendario conserva todos los cuerpos a '+((frame+1)*DT).toFixed(3)+' s');
    // Keep resetAsteroids' production result at the six-minute boundary: its
    // spawn and any subsequent meteor contact must not change this seed's RNG.
    engine.updateShower(DT);
    const currentIds=new Set(ids(engine));
    for(const m of before)assert.ok(currentIds.has(m.id),'el bloqueo de emisión no borra una entidad existente');
    for(const id of currentIds)if(!previousIds.has(id)){
      assert.ok(!allIds.has(id),'un meteorito nuevo no reutiliza un ID retirado');
      allIds.add(id);totalBorn++;
    }
    assert.equal(currentIds.size,engine.meteors.length,'los IDs emitidos son únicos');
    maxLive=Math.max(maxLive,engine.meteors.length);
    const age=engine.hazardCycleAge;
    if((oldAge<165&&age>=165)||(oldAge<285&&age>=285)||age<oldAge)boundaries.push({at:Number(((frame+1)*DT).toFixed(3)),live:before.length,preserved:before.length});
    engine.updateMeteors(DT);previousIds=new Set(ids(engine));
  }
  assert.equal(boundaries.length,3,'se cruzan los dos descansos y el reinicio del ciclo');
  assert.ok(boundaries.find(b=>Math.abs(b.at-285)<DT*2).live>0,'la lluvia natural sigue en vuelo al empezar el segundo descanso');
  assert.ok(boundaries.find(b=>Math.abs(b.at-360)<DT*2).live>0,'la lluvia natural sigue en vuelo al reiniciar el ciclo');
  assert.ok(totalBorn>20&&maxLive>0,'el recorrido realmente ha generado varias lluvias');
  assert.ok(maxLive<256,'la población natural queda lejos del límite del códec');
  console.log('  seed2: '+JSON.stringify({boundaries,totalBorn,maxLive}));
});

console.log('Ciclo de lluvia OK: emisión, drenaje, colisiones, reinicio de partida y red; '+(performance.now()-started).toFixed(0)+' ms.');
