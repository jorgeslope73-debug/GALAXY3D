/* Imported UFO artwork and motion; gameplay keeps the existing position and radius. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

export const UFO_DIAMETER=60;
export const UFO_LEAN_LIMIT=Math.PI/4,UFO_LEAN_FULL_SPEED=310,UFO_LEAN_RESPONSE_MS=220;
export const UFO_LIGHT_PERIOD_MS=2600;
const lampStates=new WeakMap();
const leanStates=new WeakMap();

export function createUfoEnvironment(renderer){
  // Bake once: menus and matches share these soft reflections on the original PBR maps.
  // UFO and rocket materials share this map; other artwork keeps its existing lighting.
  const studio=new T.Scene();studio.background=new T.Color(0x182235);
  const geometry=new T.PlaneGeometry(1,1),materials=[];
  const card=(x,y,z,w,h,r,g,b)=>{
    const material=new T.MeshBasicMaterial({color:new T.Color().setRGB(r,g,b),side:T.DoubleSide});
    const mesh=new T.Mesh(geometry,material);materials.push(material);
    mesh.position.set(x,y,z);mesh.scale.set(w,h,1);mesh.lookAt(0,0,0);studio.add(mesh);
  };
  card(-4,5,7,5,4,4,4.1,4.3);
  card(5,-1,3,2,6,1.5,1.8,2.2);
  card(-1,-5,-3,3,2,.35,.45,.65);
  const generator=new T.PMREMGenerator(renderer);
  try{return generator.fromScene(studio,.03,.1,30,{size:128});}
  finally{generator.dispose();geometry.dispose();for(const material of materials)material.dispose();}
}

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
export function createUfoFactory(template,environment=null){
  return ()=>{
    const visual=template.clone(true),power={value:1},materials=new Map();
    visual.traverse(object=>{
      if(!object.isMesh)return;
      const clone=original=>{
        if(!materials.has(original)){
          const material=prepareLampMaterial(original,object.geometry,power);
          if(environment){material.envMap=environment;material.envMapIntensity=.85;}
          materials.set(original,material);
        }
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
export function setUfoPose(root,angle,time,phase=0,vx=0,vy=0,reset=false){
  const dx=Number.isFinite(vx)?vx:0,dy=Number.isFinite(vy)?vy:0;
  const speed=Math.hypot(dx,dy);
  const slope=speed>0?Math.tan(UFO_LEAN_LIMIT*Math.min(1,speed/UFO_LEAN_FULL_SPEED))/speed:0;
  // Arena Y points down; these slopes point towards travel in world X/Y.
  const targetX=dx*slope,targetY=-dy*slope;
  let state=leanStates.get(root);
  const elapsed=state?time-state.time:0;
  if(!state||reset||elapsed<0||elapsed>250){
    state={x:targetX,y:targetY,time};leanStates.set(root,state);
  }else{
    const response=1-Math.exp(-elapsed/UFO_LEAN_RESPONSE_MS);
    state.x+=(targetX-state.x)*response;state.y+=(targetY-state.y)*response;state.time=time;
  }
  // XYZ keeps the bank in arena coordinates while the disc spins locally.
  // Interpolating the slopes also bounds diagonal motion to the same 45-degree limit.
  root.rotation.set(-Math.atan(state.y),Math.atan2(state.x,Math.hypot(1,state.y)),angle*Math.PI/180,'XYZ');
  setUfoLights(root,time,phase);
}
