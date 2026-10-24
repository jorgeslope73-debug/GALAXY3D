/* Imported UFO artwork and motion; gameplay keeps the existing position and radius. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

export const UFO_DIAMETER=60;
export const UFO_ROCK_LIMIT=Math.PI/4,UFO_ROCK_PERIOD_MS=8000;
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
export function createUfoFactory(template){return ()=>template.clone(true);}
export function setUfoPose(root,angle,time,phase=0){
  root.rotation.set(.035*Math.sin(time*.0011+phase*.7),UFO_ROCK_LIMIT*Math.sin(time*Math.PI*2/UFO_ROCK_PERIOD_MS+phase),angle*Math.PI/180);
}
