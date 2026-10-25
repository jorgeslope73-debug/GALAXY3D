import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {stepShipInertia,prepareShipTemplate} from '../docs/ship-model.js';
const require=createRequire(import.meta.url),{engineContext}=require('./check-session-regressions.js');
const core=engineContext().window.GalaxyPhysicsCore,DEG=180/Math.PI;

function flight(fps,speed=1,heldSeconds=30,totalSeconds=38,thrustAt=now=>now<heldSeconds*1000){
  const player={x:500,y:500,rot:0,vx:0,vy:0,speed},samples=[];
  let state=null;
  for(let tick=0;tick<=totalSeconds*240;tick++){
    const now=tick*1000/240,thrust=thrustAt(now);
    if(tick&&tick%4===0)core.stepShipMovement(player,{turn:0,thrust});
    if(tick%(240/fps))continue;
    const pose=Object.freeze({now,context:'match:1',thrust,vx:player.vx,vy:player.vy,speed,active:true});
    const oldPose=JSON.stringify(pose),oldState=JSON.stringify(state),before=state;
    if(state)Object.freeze(state);
    state=stepShipInertia(state,pose);
    assert.equal(JSON.stringify(pose),oldPose,'los datos de física/render entrantes son inmutables');
    assert.equal(JSON.stringify(before),oldState,'el estado anterior no cambia');
    assert.ok(Number.isFinite(state.pitch)&&Number.isFinite(state.velocity));
    assert.ok(state.pitch*DEG<=25.000001&&state.pitch*DEG>=-5.000001,'morro acotado a 25 grados arriba y 5 abajo, también con mejoras');
    samples.push({now,pitch:state.pitch,velocity:state.velocity,speed:Math.hypot(player.vx,player.vy),thrust});
  }
  return samples;
}
const flights=new Map([30,60,120].map(fps=>[fps,flight(fps)]));
function checkThrustPulse(samples,speed){
  const recovery=samples.filter(s=>s.now>=1000&&s.now<=2000);
  const braking=samples.filter(s=>s.now>=30000&&s.now<31000);
  assert.ok(Math.max(...samples.filter(s=>s.now<1000).map(s=>s.pitch))*DEG>24.5,'la subida inicial alcanza aproximadamente 25 grados sin una espera larga');
  assert.ok(samples.filter(s=>s.thrust).every(s=>s.pitch>=0),'acelerando desde parado nunca cabecea hacia abajo');
  const halfway=samples.find(s=>s.now>=1000),later=samples.find(s=>s.now>=1500),level=samples.find(s=>s.now>=2000);
  assert.ok(halfway.pitch*DEG>5,'el pulso se recupera de forma gradual, no desaparece inmediatamente tras el pico');
  assert.ok((halfway.pitch-later.pitch)*DEG>3,'la recuperación avanza mientras se mantiene el acelerador');
  for(let i=1;i<recovery.length;i++)assert.ok(recovery[i].pitch<=recovery[i-1].pitch+1e-12,'la recuperación hacia horizontal es progresiva y sin oscilación');
  assert.ok(level.thrust&&Math.abs(level.pitch)*DEG<1,'a los dos segundos ya está horizontal sin tener que soltar el acelerador');
  assert.ok(level.speed>50*speed,'la recuperación no espera a que se detenga el movimiento');
  assert.ok(samples.filter(s=>s.now>=2000&&s.now<30000).every(s=>Math.abs(s.pitch)*DEG<1),'la nave permanece horizontal al seguir acelerando durante 30 segundos');
  assert.ok(Math.min(...braking.map(s=>s.pitch))*DEG<-4.25,'soltar produce un pequeño cabeceo hacia abajo perceptible');
  assert.ok(braking.every(s=>s.pitch*DEG>=-5.000001),'el cabeceo al soltar no supera cinco grados');
  const afterOne=samples.find(s=>s.now>=31000);
  assert.ok(Math.abs(afterOne.pitch)*DEG<1,'se recupera la horizontal en menos de un segundo al soltar');
  assert.ok(afterOne.speed>50*speed,'la recuperación termina mientras la nave todavía se desplaza, sin esperar a frenarse');
  assert.ok(samples.filter(s=>s.now>=31000).every(s=>Math.abs(s.pitch)*DEG<1),'la nave sigue nivelada durante el deslizamiento posterior, sin otro cabeceo');
  assert.ok(Math.abs(samples.at(-1).pitch)*DEG<.00001,'se nivela al quedar parada');
}
for(const samples of flights.values())checkThrustPulse(samples,1);
let maxFrameDifference=0;
for(const fps of [30,120]){
  const compared=new Map(flights.get(fps).map(s=>[Math.round(s.now*1000),s]));
  for(const sample of flights.get(60)){
    const other=compared.get(Math.round(sample.now*1000));if(!other)continue;
    maxFrameDifference=Math.max(maxFrameDifference,Math.abs(sample.pitch-other.pitch));
  }
}
assert.ok(maxFrameDifference*DEG<.25,'el movimiento no depende materialmente de 30/60/120 Hz');
for(const fps of [30,60,120])for(const speed of [1.5,2]){
  const samples=flight(fps,speed),normal=flights.get(fps);
  checkThrustPulse(samples,speed);
  const peak=list=>Math.max(...list.map(s=>s.pitch))*DEG,dip=list=>Math.min(...list.map(s=>s.pitch))*DEG;
  assert.ok(Math.abs(peak(samples)-peak(normal))<.05,'las mejoras de velocidad mantienen la misma elevación máxima de 25 grados');
  assert.ok(Math.abs(dip(samples)-dip(normal))<.05,'las mejoras de velocidad conservan el pequeño cabeceo de cinco grados');
}

const tap=flight(60,1,.08,7),repress=flight(60,1,2,12,now=>now<2000||(now>=2400&&now<6000));
assert.ok(tap.every(s=>s.pitch*DEG<=25.000001&&s.pitch*DEG>=-5.000001),'un toque corto permanece acotado');
assert.ok(Math.abs(tap.at(-1).pitch)*DEG<.00001,'el toque corto no deja inclinación residual');
const ramp=repress.filter(s=>s.now>=2400&&s.now<2650);
for(let i=1;i<ramp.length;i++)assert.ok(ramp[i].pitch>=ramp[i-1].pitch,'reactivar durante la bajada empieza a levantar sin otro cabeceo hacia abajo');
assert.ok(Math.max(...repress.filter(s=>s.now>=2400&&s.now<3400).map(s=>s.pitch))*DEG>24.5,'reactivar inicia un nuevo pulso de aproximadamente 25 grados');
const relevelled=repress.find(s=>s.now>=4400);
assert.ok(relevelled.thrust&&Math.abs(relevelled.pitch)*DEG<1,'el segundo pulso se recupera en dos segundos sin volver a soltar');
assert.ok(repress.filter(s=>s.now>=4400&&s.now<6000).every(s=>Math.abs(s.pitch)*DEG<1),'mantener la segunda aceleración tampoco deja una postura elevada residual');
assert.ok(Math.abs(repress.at(-1).pitch)*DEG<.15,'la segunda frenada vuelve a nivelarse');

let brakingState=null;
for(let now=0;now<=2500;now+=1000/60)brakingState=stepShipInertia(brakingState,{now,context:'repress',thrust:now<2000,vx:0,vy:100,speed:1});
assert.ok(brakingState.pitch<0);
const resumed=stepShipInertia(brakingState,{now:brakingState.time+.001,context:'repress',thrust:true,vx:0,vy:100,speed:1});
assert.ok(Math.abs(resumed.pitch-brakingState.pitch)*DEG<.001,'reactivar conserva continuidad angular, sin saltar a cero');

const base={now:0,context:'a',thrust:true,vx:0,vy:0,speed:1,active:true};
let moving=stepShipInertia(null,base);
for(let now=1000/60;now<250;now+=1000/60)moving=stepShipInertia(moving,{...base,now});
assert.ok(moving.pitch>0);
for(const change of [{now:1000},{now:-10},{context:'next-round'},{active:false},{vx:NaN},{speed:0}]){
  const reset=stepShipInertia(moving,{...base,now:250,...change});
  assert.equal(reset.pitch,0,'reinicio limpio ante '+JSON.stringify(change));
  assert.equal(reset.velocity,0);assert.equal(reset.releaseAt,null);
}
assert.equal(stepShipInertia(moving,{...base,now:moving.time}).pitch,moving.pitch,'un reloj repetido no salta');
const hidden=stepShipInertia(moving,{...base,now:250,active:false});
const shown=stepShipInertia(hidden,{...base,now:1000/60+250,thrust:false});
assert.equal(shown.pitch,0,'reaparición sin impulso de frenado residual');
let other=null;
for(let now=0;now<1000;now+=1000/60)other=stepShipInertia(other,{...base,now,thrust:false});
assert.equal(other.pitch,0,'cada nave mantiene su propio estado');
assert.ok(moving.pitch>0,'actualizar otra nave no modifica la primera');

// Parse the real GLB without a browser texture loader. Check actual nose
// vertices, rather than assuming the export's original axes match the group.
const loader=new GLTFLoader();
loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const bytes=fs.readFileSync(new URL('../docs/assets/models/nave.glb',import.meta.url));
const imported=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const model=prepareShipTemplate(imported.scene),tilt=new T.Group();tilt.add(model);tilt.updateMatrixWorld(true);
const vertices=[];
model.traverse(object=>{
  if(!object.isMesh)return;
  const positions=object.geometry.attributes.position;
  for(let i=0;i<positions.count;i++)vertices.push(new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld));
});
const front=Math.max(...vertices.map(v=>v.y)),nose=vertices.filter(v=>v.y>front-1);
assert.ok(front>20&&nose.length,'el modelo preparado apunta hacia +Y');
const initial=nose.reduce((total,v)=>total+v.z,0)/nose.length;
tilt.rotation.x=25/DEG;tilt.updateMatrixWorld(true);
const lifted=nose.reduce((total,v)=>total+v.clone().applyEuler(tilt.rotation).z,0)/nose.length;
assert.ok(lifted>initial+10,'los 25 grados levantan el morro real hacia la cámara +Z');
const dip=Math.min(...flights.get(60).map(s=>s.pitch));
tilt.rotation.x=dip;tilt.updateMatrixWorld(true);
const lowered=nose.reduce((total,v)=>total+v.clone().applyEuler(tilt.rotation).z,0)/nose.length;
assert.ok(lowered<initial-2,'el pequeño cabeceo real al soltar baja el morro sin invertir su orientación');
const mount=new T.Object3D();mount.position.set(10,14,4);tilt.add(mount);tilt.updateMatrixWorld(true);
for(const pitch of [25/DEG,dip,0]){
  tilt.rotation.x=pitch;tilt.updateMatrixWorld(true);
  const worldMount=mount.getWorldPosition(new T.Vector3()),expected=mount.position.clone().applyEuler(tilt.rotation);
  assert.ok(worldMount.distanceTo(expected)<1e-10,'las armas montadas siguen la elevación, el cabeceo y la vuelta a horizontal');
}
for(const [fps,samples] of flights)console.log(fps+' Hz: impulso '+(Math.max(...samples.map(s=>s.pitch))*DEG).toFixed(3)+'°, horizontal2s '+(samples.find(s=>s.now>=2000).pitch*DEG).toFixed(3)+'°, frenado '+(Math.min(...samples.map(s=>s.pitch))*DEG).toFixed(3)+'°.');
console.log('Inercia visual OK: pulso inicial de 25° y vuelta progresiva a horizontal <1° en dos segundos sin soltar, también con mejoras; cabeceo de hasta 5° al soltar y horizontal en un segundo mientras desliza; 30/60/120 Hz (diferencia máxima '+(maxFrameDifference*DEG).toFixed(4)+'°), nueva aceleración con pulso, continuidad, resets, aislamiento, inmutabilidad, morro GLB y armas.');
