/* Imported meteor artwork only; gameplay still supplies its position and diameter. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// Each authored outline is calibrated to the existing circular gameplay radius.
export const METEOR_MODELS=Object.freeze({
  fragment:Object.freeze({file:'meteorito3.glb',scale:1.066}),
  medium:Object.freeze({file:'meteorito1.glb',scale:1.082}),
  large:Object.freeze({file:'meteorito2.glb',scale:1.136})
});
export const METEOR_VISUAL_SCALE=METEOR_MODELS.medium.scale;

export function prepareMeteorTemplate(source,kind='medium'){
  source.updateMatrixWorld(true);
  const parts=[];let authoredMaterial=null;
  source.traverse(object=>{
    if(!object.isMesh)return;
    if(object.isSkinnedMesh||Array.isArray(object.material))throw new Error('El meteorito debe ser un modelo estático');
    parts.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
    // All surfaces in this GLB use the same embedded image and PBR settings.
    if(!authoredMaterial)authoredMaterial=object.material;
  });
  if(!parts.length)throw new Error('El meteorito no contiene geometría');
  const geometry=mergeGeometries(parts,false);
  for(const part of parts)part.dispose();
  if(!geometry)throw new Error('No se pueden agrupar las piezas del meteorito');
  geometry.computeBoundingBox();
  const centre=geometry.boundingBox.getCenter(new T.Vector3());
  geometry.translate(-centre.x,-centre.y,-centre.z);geometry.computeBoundingSphere();
  const radius=geometry.boundingSphere.radius;
  if(!Number.isFinite(radius)||radius<=0)throw new Error('El meteorito tiene un tamaño inválido');
  geometry.scale(1/radius,1/radius,1/radius);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=authoredMaterial.clone();
  // A soft purple tint keeps the embedded rock texture and its detail.
  material.color.multiply(new T.Color(0xc5a4e8));
  const template=new T.Group();template.name='meteor-'+kind+'-glb';
  template.userData.galaxyMeteorKind=kind;
  template.scale.setScalar((METEOR_MODELS[kind]||METEOR_MODELS.medium).scale);
  template.add(new T.Mesh(geometry,material));
  return template;
}

export async function loadMeteorTemplate(kind='medium'){
  const definition=METEOR_MODELS[kind]||METEOR_MODELS.medium;
  const asset=new URL('./assets/models/'+definition.file,import.meta.url);
  asset.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(asset.href);
  return prepareMeteorTemplate(gltf.scene,kind);
}

export async function loadMeteorTemplates(){
  const entries=await Promise.all(Object.keys(METEOR_MODELS).map(async kind=>[kind,await loadMeteorTemplate(kind)]));
  return Object.fromEntries(entries);
}

export function createMeteorFactory(templates){
  // Share resources within each role; the three supplied artworks stay distinct.
  if(templates.isObject3D)return ()=>templates.clone(true);
  return (kind='medium')=>(templates[kind]||templates.medium).clone(true);
}
