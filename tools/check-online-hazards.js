'use strict';

// Exercise the production host, clock, physics, publisher and wire codec. Human
// controls stay idle; periodic environmental deaths keep noDeathTime below 9 s.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {engineContext}=require('./check-session-regressions.js');
const DT=1/60,STEP_MS=1000/60;
const clean=value=>JSON.parse(JSON.stringify(value));
const inside=(value,min,max,label,tolerance=DT*2)=>assert.ok(value>=min-tolerance&&value<=max+tolerance,label+': '+value.toFixed(3)+' fuera de '+min+'–'+max+' s');
const startedAt=performance.now();

function fixture(seed){
  const clock={now:1000000},ctx=engineContext(clock);
  vm.runInContext('let hazardSeed='+seed+';Math.random=()=>{hazardSeed=(Math.imul(hazardSeed,1664525)+1013904223)>>>0;return hazardSeed/4294967296;};',ctx);
  vm.runInContext(fs.readFileSync('docs/net-state-codec.js','utf8'),ctx);
  const codec=ctx.window.GalaxyStateCodec;
  let renderCount=0,stateCount=0,round,forcedDeaths=0,totalTicks=0;
  const rounds=[],events=[];
  const engine=new ctx.window.GalaxyHostPhysics({
    renderEveryStep:true,
    onRenderState(){renderCount++;},
    onEvent(event){events.push(clean(event));},
    onState(state){
      stateCount++;
      assert.equal(state.finished,false,'los humanos sin disparar no terminan la ronda');
      for(const kind of ['ufo','giant','shower']){
        const present=kind==='shower'?state.shower>0&&state.meteors.length>0:!!state[kind];
        if(!present||round.transmitted.has(kind))continue;
        for(const recipient of [0,1]){
          const packet=codec.encode(state,recipient);
          assert.ok(packet,'publicState real admite el formato compacto');
          const decoded=codec.decode(JSON.parse(JSON.stringify(packet)));
          assert.ok(decoded,'el invitado puede leer el estado de peligros');
          for(const field of ['giant','ufo','meteors','shower','fx'])assert.deepEqual(clean(decoded[field]),clean(state[field]),'wire conserva '+field);
        }
        round.transmitted.add(kind);
      }
      if(!round.deathTransmitted&&state.fx.some(fx=>fx.kind==='explosion'&&round.deathFxIds.has(fx.id))){
        const decoded=codec.decode(JSON.parse(JSON.stringify(codec.encode(state,1))));
        assert.deepEqual(clean(decoded.fx),clean(state.fx),'la muerte ambiental comparte efectos');
        round.deathTransmitted=true;
      }
    }
  });
  function observe(name,field){
    const original=engine[name];
    engine[name]=function(dt){
      const before=this[field],oldId=before&&before.id;
      original.call(this,dt);
      const after=this[field],age=this.hazardCycleAge;
      const born=field==='showerLeft'?before<=0&&after>0:after&&after.id!==oldId;
      const phase=Math.floor((this.fxClock+.001)/360)+':'+(age<165?0:age<285?1:2);
      if(field==='showerLeft'&&born&&round.showerEnd?.phase===phase)inside(this.fxClock-round.showerEnd.at,55,85,'intervalo real tras terminar lluvia');
      if(born)round.appearances[field].push({at:this.fxClock,age});
      if(field==='ufo'&&before&&!after&&this.hazardStage().ufo)inside(this.nextUfo,75,120,'repetición OVNI',0);
      if(field==='giant'&&before&&!after&&this.hazardStage().giant)inside(this.nextGiant,130,190,'repetición gigante',0);
      if(field==='showerLeft'&&before>0&&after<=0&&this.hazardStage().shower){
        inside(this.nextShower,55,85,'repetición lluvia',0);
        round.showerEnd={at:this.fxClock,phase};
      }
    };
  }
  observe('updateUfo','ufo');observe('updateGiant','giant');observe('updateShower','showerLeft');
  function begin(restart=false){
    round={appearances:{ufo:[],giant:[],showerLeft:[]},transmitted:new Set(),deathTransmitted:false,deathFxIds:new Set(),ticks:0,renderBase:renderCount,stateBase:stateCount,removedUfoAt:null,showerEnd:null};
    rounds.push(round);
    if(restart){engine.finished=true;assert.equal(engine.restart(),true,'reinicio productivo con dos humanos');}
    else assert.equal(engine.start([{i:0,n:'Host'},{i:1,n:'Guest'}]),true);
    assert.equal(engine.hazardCycleAge,0);assert.equal(engine.hazardCycleDuration,360);
    assert.equal(engine.players.length,2);assert.ok(engine.players.every(p=>!p.cpu));
    assert.equal(engine.giant,null);assert.equal(engine.ufo,null);assert.equal(engine.meteors.length,0);
    engine.advance(clock.now);
    return round;
  }
  function step(){
    // Protection isolates scheduling from a lucky series of collisions without
    // replacing any physics method or removing the human players.
    for(const player of engine.players)player.protection=10000;
    if(round.ticks>0&&round.ticks%540===0){
      const victim=engine.players[0],age=engine.hazardCycleAge;
      victim.protection=0;victim.shield=0;engine.destroyShip(victim,null);
      assert.equal(victim.dead,true,'muerte real del entorno');
      round.deathFxIds.add(engine.fxEvents.at(-1).id);
      assert.equal(engine.noDeathTime,0);
      assert.equal(engine.hazardCycleAge,age,'la muerte no retrasa el calendario');
      forcedDeaths++;
    }
    // A player destroys the first UFO at 40 s. Its existing 75–120 s repeat
    // must remain live across the 60/120 s phase transitions, before the rest.
    if(round.ticks===2400&&round.removedUfoAt===null){
      assert.ok(engine.ufo,'el primer OVNI sigue disponible a los 40 s');
      assert.equal(engine.destroyUfo(0),true);
      inside(engine.nextUfo,75,120,'repetición tras destruir OVNI',0);
      round.removedUfoAt=engine.fxClock;
    }
    round.ticks++;totalTicks++;clock.now=1000000+totalTicks*STEP_MS;
    engine.advance(clock.now);
    assert.equal(engine.finished,false);assert.equal(engine.winner,null);
    assert.ok(engine.noDeathTime<9+DT*2,'las apariciones no dependen de tiempo sin muertes');
    assert.ok(engine.players.every(p=>p.kills===0),'la simulación ambiental no puntúa una victoria');
    assert.ok(engine.asteroidPopulationUnits()<=5,'límite de cinco unidades de asteroides');
    const age=engine.hazardCycleAge;
    const stages=[[60,1],[120,2],[165,3],[195,2],[240,3],[285,4],[315,2],[360,5]];
    assert.equal(engine.asteroidTargetCount,stages.find(([until])=>age<until)[1],'rampa de asteroides conservada');
    if((age>=165&&age<195)||(age>=285&&age<315)){
      assert.equal(engine.ufo,null,'descanso sin OVNI');assert.equal(engine.meteors.length,0,'descanso sin lluvia');
      assert.equal(engine.showerLeft,0);assert.equal(engine.nextGiant,999999,'descanso sin nuevos gigantes');
    }
  }
  function runTo(seconds){while(round.ticks<Math.round(seconds*60))step();}
  function checkOpening(label){
    for(const [field,min,max] of [['ufo',18,32],['giant',32,44],['showerLeft',50,60]]){
      assert.ok(round.appearances[field].length,label+': aparece '+field);
      inside(round.appearances[field][0].at,min,max,label+' '+field);
    }
    assert.deepEqual([...round.transmitted].sort(),['giant','shower','ufo']);
    assert.equal(renderCount-round.renderBase,round.ticks,'presentación local sigue a 60 Hz');
    assert.equal(stateCount-round.stateBase,Math.floor(round.ticks/3),'publicación de red sigue a 20 Hz');
    assert.ok(round.deathTransmitted,'las muertes ambientales comparten su efecto por codec');
  }
  return {engine,rounds,events,begin,runTo,step,checkOpening,stats:()=>({forcedDeaths,totalTicks,renderCount,stateCount})};
}

const timings=[];
let main;
for(const seed of [1,0x6123,0xfedcba98]){
  const test=fixture(seed);
  for(const restart of [false,true]){
    const round=test.begin(restart);test.runTo(65);test.checkOpening('seed '+seed+(restart?' restart':' start'));
    timings.push({seed,route:restart?'restart':'start',ufo:round.appearances.ufo[0].at,giant:round.appearances.giant[0].at,shower:round.appearances.showerLeft[0].at});
  }
  if(!main)main=test;
}

// Continue one real restarted match through both rests and a complete cycle.
main.runTo(425);
const long=main.rounds.at(-1);
const ufoRepeat=long.appearances.ufo.find(a=>a.at>long.removedUfoAt&&a.at<165);
assert.ok(ufoRepeat,'el OVNI destruido vuelve antes de 165 s y no pierde su timer a los 60/120 s');
inside(ufoRepeat.at-long.removedUfoAt,75,120,'segundo OVNI');
assert.ok(long.appearances.showerLeft.filter(a=>a.at<165).length>=2,'la lluvia repite antes del primer descanso');
for(const field of ['ufo','giant','showerLeft'])assert.ok(long.appearances[field].some(a=>a.at>195&&a.at<285),'regresa '+field+' después del primer descanso');
for(const resume of [195,315])for(const [field,min,max] of [['ufo',18,32],['showerLeft',18,28]]){
  const next=long.appearances[field].find(a=>a.at>resume);
  assert.ok(next,'regresa '+field+' después del descanso de '+resume+' s');
  inside(next.at-resume,min,max,'primera aparición tras descanso de '+resume+' s: '+field);
}
for(const field of ['ufo','showerLeft']){
  const next=long.appearances[field].find(a=>a.at>360);
  assert.ok(next,'nuevo ciclo vuelve a habilitar '+field);
  inside(next.age,field==='ufo'?18:50,field==='ufo'?32:60,'primer '+field+' del siguiente ciclo');
}
assert.ok(main.engine.hazardCycleAge>64&&main.engine.hazardCycleAge<66,'el ciclo se reinicia a los 360 s');
assert.equal(main.engine.players.length,2,'el ciclo no expulsa jugadores');

// Controlled boundary fixtures use a real spawned giant. The old travelling
// body must move through a rest or cycle reset; an absent body must not spawn.
for(const boundary of [165,285,360]){
  const test=fixture(0x1100+boundary),engine=test.engine;
  test.begin();engine.hazardCycleAge=boundary-DT/2;engine.nextGiant=0;
  engine.updateGiant(DT);assert.ok(engine.giant,'crear gigante antes del límite');
  engine.giant.x=960;engine.giant.y=540;
  const giant=engine.giant,x=giant.x,y=giant.y;
  test.step();
  assert.equal(engine.giant,giant,'el gigante no desaparece al cruzar '+boundary+' s');
  assert.ok(Math.hypot(giant.x-x,giant.y-y)>0,'el gigante sigue viajando');
  engine.giant=null;test.step();assert.equal(engine.giant,null,'no nace un gigante en descanso/apertura');
}

console.table(timings.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='number'&&key!=='seed'?+value.toFixed(3):value]))));
console.log('Repeticiones antes del descanso: OVNI '+ufoRepeat.at.toFixed(3)+' s; lluvias '+long.appearances.showerLeft.filter(a=>a.at<165).map(a=>a.at.toFixed(3)).join(', ')+' s.');
console.log('Peligros online OK: inicio/reinicio, 3 semillas, muertes sin retraso, descansos, ciclo de 360 s, gigante persistente y publicState/codec. '+JSON.stringify(main.stats())+'; '+((performance.now()-startedAt)/1000).toFixed(2)+' s de ejecución.');
