/* Imported meteor artwork only; gameplay still supplies its position and diameter. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

// The irregular outline averages 90% of its enclosing sphere in projection.
// Match that visible outline to the existing circular gameplay radius.
export const METEOR_VISUAL_SCALE=1.11;

export function prepareMeteorTemplate(source){
  source.updateMatrixWorld(true);
  const parts=[];let authoredMaterial=null;
  source.traverse(object=>{
    if(!object.isMesh)return;
    if(object.isSkinnedMesh||Array.isArray(object.material))throw new Error('El meteorito debe ser un modelo estático');
    parts.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
    // Both pieces of this GLB use the same embedded image and PBR settings.
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
  const template=new T.Group();template.name='meteor-glb';
  template.scale.setScalar(METEOR_VISUAL_SCALE);
  template.add(new T.Mesh(geometry,material));
  return template;
}

export async function loadMeteorTemplate(){
  const asset=new URL('./assets/models/meteor.glb',import.meta.url);
  asset.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(asset.href);
  return prepareMeteorTemplate(gltf.scene);
}

export function createMeteorFactory(template){
  // Geometry, materials and the embedded texture are immutable and shared.
  return ()=>template.clone(true);
}
