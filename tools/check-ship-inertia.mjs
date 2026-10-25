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
    assert.ok(Math.abs(state.pitch)*DEG<=35+10*(speed-1)+.000001,'amplitud acotada según la mejora de velocidad');
    samples.push({now,pitch:state.pitch,velocity:state.velocity,speed:Math.hypot(player.vx,player.vy),thrust});
  }
  return samples;
}
const flights=new Map([30,60,120].map(fps=>[fps,flight(fps)]));
function checkHeldFlight(samples,speed){
  const amplitude=35+10*(speed-1),held=samples.filter(s=>s.now>=12000&&s.now<30000);
  const braking=samples.filter(s=>s.now>=30000&&s.now<32000);
  assert.ok(Math.max(...samples.filter(s=>s.now<2000).map(s=>s.pitch))*DEG>amplitude-.3,'la subida inicial alcanza casi toda la inclinación');
  assert.ok(samples.filter(s=>s.thrust).every(s=>s.pitch>=0),'acelerando desde parado nunca cabecea hacia abajo');
  assert.ok(held.every(s=>s.pitch*DEG>=amplitude*.799&&s.pitch*DEG<amplitude*.85),'el crucero permanece inclinado, incluso tras 12–30 s');
  for(let i=1;i<held.length;i++)assert.ok(held[i].pitch<=held[i-1].pitch+1e-12,'la relajación mantenida es gradual y sin oscilación');
  assert.ok((held[0].pitch-held.at(-1).pitch)*DEG>.5,'se relaja ligeramente a lo largo de varios segundos');
  assert.ok(Math.min(...braking.map(s=>s.pitch))*DEG<-amplitude*.97,'soltar alcanza casi toda la inclinación negativa');
  const afterTwo=samples.find(s=>s.now>=32000);
  assert.ok(afterTwo.pitch*DEG<-5,'la recuperación no termina con un pulso corto de un segundo');
  for(const [threshold,tolerance] of [[1,.5],[.5,.15]]){
    const stopped=samples.find(s=>s.now>=30000&&s.speed<threshold);
    assert.ok(stopped&&Math.abs(stopped.pitch)*DEG<tolerance,'casi nivelada al reducirse la velocidad a '+threshold);
  }
  assert.ok(Math.abs(samples.at(-1).pitch)*DEG<.00001,'se nivela al quedar parada');
}
for(const samples of flights.values())checkHeldFlight(samples,1);
let maxFrameDifference=0;
for(const fps of [30,120]){
  const compared=new Map(flights.get(fps).map(s=>[Math.round(s.now*1000),s]));
  for(const sample of flights.get(60)){
    const other=compared.get(Math.round(sample.now*1000));if(!other)continue;
    maxFrameDifference=Math.max(maxFrameDifference,Math.abs(sample.pitch-other.pitch));
  }
}
assert.ok(maxFrameDifference*DEG<.25,'el movimiento no depende materialmente de 30/60/120 Hz');
const normal=flights.get(60),boosted=[flight(60,1.5),flight(60,2)];
for(const [i,samples] of boosted.entries()){
  checkHeldFlight(samples,1.5+i*.5);
  const before=i?boosted[i-1]:normal;
  assert.ok(Math.max(...samples.map(s=>s.pitch))*DEG>Math.max(...before.map(s=>s.pitch))*DEG+4,'cada mejora aumenta el cabeceo al acelerar');
  assert.ok(Math.min(...samples.map(s=>s.pitch))*DEG<Math.min(...before.map(s=>s.pitch))*DEG-4,'cada mejora aumenta el cabeceo al frenar');
}

const tap=flight(60,1,.08,7),repress=flight(60,1,2,12,now=>now<2000||(now>=2400&&now<6000));
assert.ok(tap.every(s=>Math.abs(s.pitch)*DEG<=35.000001),'un toque corto permanece acotado');
assert.ok(Math.abs(tap.at(-1).pitch)*DEG<.00001,'el toque corto no deja inclinación residual');
const ramp=repress.filter(s=>s.now>=2400&&s.now<3000);
for(let i=1;i<ramp.length;i++)assert.ok(ramp[i].pitch>=ramp[i-1].pitch,'reactivar durante la bajada empieza a levantar sin otro cabeceo hacia abajo');
assert.ok(repress.find(s=>s.now>=4000).pitch*DEG>25,'reactivar recupera la postura elevada');
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
tilt.rotation.x=35/DEG;tilt.updateMatrixWorld(true);
const lifted=nose.reduce((total,v)=>total+v.clone().applyEuler(tilt.rotation).z,0)/nose.length;
assert.ok(lifted>initial+15,'el pitch pronunciado levanta el morro real hacia la cámara +Z');
const mount=new T.Object3D();mount.position.set(10,14,4);tilt.add(mount);tilt.updateMatrixWorld(true);
const worldMount=mount.getWorldPosition(new T.Vector3()),expected=mount.position.clone().applyEuler(tilt.rotation);
assert.ok(worldMount.distanceTo(expected)<1e-10,'las armas montadas heredan el mismo cabeceo');
for(const [fps,samples] of flights)console.log(fps+' Hz: impulso '+(Math.max(...samples.map(s=>s.pitch))*DEG).toFixed(3)+'°, mantenida30s '+(samples.find(s=>s.now>=29900).pitch*DEG).toFixed(3)+'°, frenado '+(Math.min(...samples.map(s=>s.pitch))*DEG).toFixed(3)+'°.');
console.log('Inercia visual OK: postura mantenida, recuperación por velocidad, 35/40/45°, 30/60/120 Hz (diferencia máxima '+(maxFrameDifference*DEG).toFixed(4)+'°), pulsos/reactivación continua, resets, aislamiento, inmutabilidad y signo del GLB real.');
