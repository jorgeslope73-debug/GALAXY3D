import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {stepShipInertia,prepareShipTemplate} from '../docs/ship-model.js';
const require=createRequire(import.meta.url),{engineContext}=require('./check-session-regressions.js');
const core=engineContext().window.GalaxyPhysicsCore,DEG=180/Math.PI;

function flight(fps,speed=1){
  const player={x:500,y:500,rot:0,vx:0,vy:0,speed},samples=[];
  let state=null;
  for(let tick=0;tick<=12*240;tick++){
    const now=tick*1000/240,thrust=now<7000;
    if(tick&&tick%4===0)core.stepShipMovement(player,{turn:0,thrust});
    if(tick%(240/fps))continue;
    const pose=Object.freeze({now,context:'match:1',thrust,vx:player.vx,vy:player.vy,speed,active:true});
    const oldPose=JSON.stringify(pose),oldState=JSON.stringify(state),before=state;
    if(state)Object.freeze(state);
    state=stepShipInertia(state,pose);
    assert.equal(JSON.stringify(pose),oldPose,'los datos de física/render entrantes son inmutables');
    assert.equal(JSON.stringify(before),oldState,'el estado anterior no cambia');
    assert.ok(Number.isFinite(state.pitch)&&Number.isFinite(state.velocity));
    assert.ok(Math.abs(state.pitch)*DEG<=20.000001,'amplitud acotada a veinte grados');
    samples.push({now,pitch:state.pitch,velocity:state.velocity,speed:Math.hypot(player.vx,player.vy)});
  }
  const acceleration=samples.filter(s=>s.now<3000),cruise=samples.filter(s=>s.now>=6000&&s.now<7000);
  const braking=samples.filter(s=>s.now>=7000&&s.now<8500),recovered=samples.filter(s=>s.now>=10000);
  assert.ok(Math.max(...acceleration.map(s=>s.pitch))*DEG>15,'el primer impulso levanta el morro de forma pronunciada');
  assert.ok(Math.max(...cruise.map(s=>Math.abs(s.pitch)))*DEG<.05,'se nivela a la velocidad terminal real con acelerador mantenido');
  assert.ok(Math.min(...braking.map(s=>s.pitch))*DEG<-.8,'soltar el acelerador baja el morro');
  assert.ok(Math.max(...braking.filter(s=>s.now>7500).map(s=>s.pitch))*DEG>.03,'el frenado deja un pequeño rebote amortiguado');
  assert.ok(Math.max(...recovered.map(s=>Math.abs(s.pitch)))*DEG<.001,'el cabeceo se amortigua completamente');
  return samples;
}
const flights=new Map([30,60,120].map(fps=>[fps,flight(fps)]));
let maxFrameDifference=0;
for(const fps of [30,120]){
  const compared=new Map(flights.get(fps).map(s=>[Math.round(s.now*1000),s]));
  for(const sample of flights.get(60)){
    const other=compared.get(Math.round(sample.now*1000));if(!other)continue;
    maxFrameDifference=Math.max(maxFrameDifference,Math.abs(sample.pitch-other.pitch));
  }
}
assert.ok(maxFrameDifference*DEG<.25,'el movimiento no depende materialmente de 30/60/120 Hz');
const faster=flight(60,1.7);
for(let i=0;i<faster.length;i++)assert.ok(Math.abs(faster[i].pitch-flights.get(60)[i].pitch)<1e-10,'la mejora de velocidad conserva el mismo cabeceo relativo');

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
tilt.rotation.x=20/DEG;tilt.updateMatrixWorld(true);
const lifted=nose.reduce((total,v)=>total+v.clone().applyEuler(tilt.rotation).z,0)/nose.length;
assert.ok(lifted>initial+8,'el pitch pronunciado levanta el morro real hacia la cámara +Z');
const mount=new T.Object3D();mount.position.set(10,14,4);tilt.add(mount);tilt.updateMatrixWorld(true);
const worldMount=mount.getWorldPosition(new T.Vector3()),expected=mount.position.clone().applyEuler(tilt.rotation);
assert.ok(worldMount.distanceTo(expected)<1e-10,'las armas montadas heredan el mismo cabeceo');
for(const [fps,samples] of flights)console.log(fps+' Hz: impulso '+(Math.max(...samples.filter(s=>s.now<3000).map(s=>s.pitch))*DEG).toFixed(3)+'°, frenado '+(Math.min(...samples.filter(s=>s.now>=7000).map(s=>s.pitch))*DEG).toFixed(3)+'°.');
console.log('Inercia visual OK: terminal real, crucero, rebote amortiguado, 30/60/120 Hz (diferencia máxima '+(maxFrameDifference*DEG).toFixed(4)+'°), mejoras, resets, aislamiento, inmutabilidad y signo del GLB real.');
