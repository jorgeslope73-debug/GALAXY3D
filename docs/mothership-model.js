/* Authored hull/materials and five independent yaw nulls; simulation supplies the angles. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
const poses=new WeakMap();
export function prepareMothershipTemplate(source,definition){
  const level=new T.Group();level.rotation.x=Math.PI/2;level.add(source);
  level.position.set(-definition.center[0],definition.center[2],-definition.center[1]);
  const template=new T.Group();template.name='nodriza-glb';template.scale.setScalar(definition.scale);template.add(level);
  for(const turret of definition.turrets){const pivot=template.getObjectByName(turret.name);if(!pivot)throw new Error('Falta el null '+turret.name);pivot.rotation.set(0,0,0);}
  template.updateMatrixWorld(true);return template;
}
export async function loadMothershipTemplate(definition){
  const asset=new URL('./assets/models/nodriza.glb',import.meta.url);asset.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(asset.href);return prepareMothershipTemplate(gltf.scene,definition);
}
export function createMothershipFactory(template,definition,environment=null){
  return ()=>{
    const visual=template.clone(true);
    if(environment){const materials=new Map();visual.traverse(object=>{if(!object.isMesh)return;const original=object.material;if(!materials.has(original)){const material=original.clone();material.envMap=environment;material.envMapIntensity=.85;materials.set(original,material);}object.material=materials.get(original);});}
    poses.set(visual,definition.turrets.map(t=>visual.getObjectByName(t.name)));return visual;
  };
}
export function setMothershipPose(visual,body){
  visual.rotation.z=-body.angle;
  const pivots=poses.get(visual);if(!pivots)return;
  for(let i=0;i<pivots.length;i++)pivots[i].rotation.y=Math.PI/2+body.angle-body.turrets[i].angle;
}
