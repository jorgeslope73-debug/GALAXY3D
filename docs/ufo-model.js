/* Imported UFO artwork and motion; gameplay keeps the existing position and radius. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

export const UFO_DIAMETER=60;
export const UFO_LEAN_LIMIT=Math.PI/4,UFO_LEAN_FULL_SPEED=310,UFO_LEAN_RESPONSE_MS=220;
const animationStates=new WeakMap();
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

export function prepareUfoTemplate(source,animations=[]){
  const level=new T.Group();level.rotation.x=Math.PI/2;level.add(source);
  level.updateMatrixWorld(true);
  // Morph-target bounding boxes include mutually exclusive lamp positions.
  // Measure the actual supplied pose so those conservative bounds do not
  // change the disc's centre, visual diameter or collision calibration.
  const bounds=new T.Box3().setFromObject(level,true),size=bounds.getSize(new T.Vector3());
  const span=Math.max(size.x,size.y);
  if(!Number.isFinite(span)||span<=0)throw new Error('El OVNI no contiene geometría válida');
  level.position.sub(bounds.getCenter(new T.Vector3()));
  const template=new T.Group();template.name='ovni-glb';template.add(level);
  template.animations=animations;
  template.scale.setScalar(UFO_DIAMETER/span);template.updateMatrixWorld(true);
  return template;
}
export async function loadUfoTemplate(){
  const asset=new URL('./assets/models/ovni.glb',import.meta.url);
  asset.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(asset.href);
  document.documentElement.dataset.galaxyUfoAnimation=gltf.animations.map(clip=>clip.name).join(',')||'none';
  return prepareUfoTemplate(gltf.scene,gltf.animations);
}
export function createUfoFactory(template,environment=null){
  return ()=>{
    const visual=template.clone(true),materials=new Map();
    visual.traverse(object=>{
      if(!object.isMesh)return;
      const clone=original=>{
        if(!materials.has(original)){
          const material=original.clone();
          if(environment){material.envMap=environment;material.envMapIntensity=.85;}
          materials.set(original,material);
        }
        return materials.get(original);
      };
      object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
    });
    const clip=template.animations[0];
    if(clip&&clip.duration>0){
      const mixer=new T.AnimationMixer(visual);
      mixer.clipAction(clip).setLoop(T.LoopRepeat,Infinity).play();
      animationStates.set(visual,{mixer,duration:clip.duration,time:null});
      setUfoLights(visual,0);
    }
    return visual;
  };
}
export function setUfoLights(root,time,phase=0){
  const state=animationStates.get(root)||animationStates.get(root.children[0]);
  if(!state||!Number.isFinite(time))return;
  const offset=Number.isFinite(phase)?phase*state.duration/(Math.PI*2):0;
  const seconds=((time*.001+offset)%state.duration+state.duration)%state.duration;
  if(state.time===seconds)return;
  // Seek the authored lamp clip using only the local presentation clock.
  // Absolute time also handles pooled instances, warm-up and tab resumes
  // without running catch-up animation steps or sending animation frames.
  state.mixer.setTime(seconds);state.time=seconds;
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
