/* Imported UFO artwork and motion; gameplay keeps the existing position and radius. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

export const UFO_DIAMETER=60;
export const UFO_ROCK_LIMIT=Math.PI/4,UFO_ROCK_PERIOD_MS=8000;
export const UFO_LIGHT_PERIOD_MS=2600;
const lampStates=new WeakMap();

function prepareLampMaterial(original,geometry,power){
  const material=original.clone();geometry.computeBoundingBox();
  const bounds=geometry.boundingBox,centre=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
  const lampCentre={value:new T.Vector2(centre.x,centre.y)},lampRadius={value:Math.max(size.x,size.y)/2};
  material.onBeforeCompile=shader=>{
    shader.uniforms.ufoLampPower=power;shader.uniforms.ufoLampCentre=lampCentre;shader.uniforms.ufoLampRadius=lampRadius;
    shader.vertexShader='varying vec2 ufoLampXY;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nufoLampXY=position.xy;');
    shader.fragmentShader='uniform float ufoLampPower;\nuniform vec2 ufoLampCentre;\nuniform float ufoLampRadius;\nvarying vec2 ufoLampXY;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`
      #include <emissivemap_fragment>
      vec2 ufoP=abs((ufoLampXY-ufoLampCentre)/ufoLampRadius);
      float ufoLensDistance=min(min(length(ufoP-vec2(.89,0.0)),length(ufoP-vec2(0.0,.89))),length(ufoP-vec2(.51,.75)));
      float ufoLenses=1.0-smoothstep(.07,.13,ufoLensDistance);
      vec3 ufoPaint=diffuseColor.rgb;
      float ufoColour=max(ufoPaint.r-max(ufoPaint.g,ufoPaint.b),ufoPaint.b-max(ufoPaint.r,ufoPaint.g));
      float ufoLampMask=ufoLenses*smoothstep(.06,.22,ufoColour);
      diffuseColor.rgb*=mix(1.0,.35+.65*ufoLampPower,ufoLampMask);
      totalEmissiveRadiance+=ufoPaint*(2.2*ufoLampPower)*ufoLampMask;
    `);
  };
  material.customProgramCacheKey=()=> 'galaxy-ufo-lamps-v1';
  return material;
}
export function prepareUfoTemplate(source){
  const level=new T.Group();level.rotation.x=Math.PI/2;level.add(source);
  level.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(level),size=bounds.getSize(new T.Vector3());
  const span=Math.max(size.x,size.y);
  if(!Number.isFinite(span)||span<=0)throw new Error('El OVNI no contiene geometría válida');
  level.position.sub(bounds.getCenter(new T.Vector3()));
  const template=new T.Group();template.name='ovni-glb';template.add(level);
  template.scale.setScalar(UFO_DIAMETER/span);template.updateMatrixWorld(true);
  return template;
}
export async function loadUfoTemplate(){
  const asset=new URL('./assets/models/ovni.glb',import.meta.url);
  asset.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(asset.href);
  return prepareUfoTemplate(gltf.scene);
}
export function createUfoFactory(template){
  return ()=>{
    const visual=template.clone(true),power={value:1},materials=new Map();
    visual.traverse(object=>{
      if(!object.isMesh)return;
      const clone=original=>{
        if(!materials.has(original))materials.set(original,prepareLampMaterial(original,object.geometry,power));
        return materials.get(original);
      };
      object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
    });
    lampStates.set(visual,power);return visual;
  };
}
export function setUfoLights(root,time,phase=0){
  const power=lampStates.get(root)||lampStates.get(root.children[0]);
  if(power)power.value=.1+.9*(.5-.5*Math.cos(time*Math.PI*2/UFO_LIGHT_PERIOD_MS+phase));
}
export function setUfoPose(root,angle,time,phase=0){
  root.rotation.set(.035*Math.sin(time*.0011+phase*.7),UFO_ROCK_LIMIT*Math.sin(time*Math.PI*2/UFO_ROCK_PERIOD_MS+phase),angle*Math.PI/180);
  setUfoLights(root,time,phase);
}
