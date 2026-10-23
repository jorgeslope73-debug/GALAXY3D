/* The imported rocket is presentation only; the existing guided projectile stays authoritative. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

export const ROCKET_LENGTH=40;
const teamPaints=[0x28bce8,0xf232a3,0x47df3f,0xf14450].map(hex=>new T.Color(hex));

export function prepareRocketTemplate(source){
  // The supplied model points along +Z. Align its nose with the game's +Y.
  const aligned=new T.Group();aligned.rotation.x=-Math.PI/2;aligned.add(source);
  aligned.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(aligned),length=bounds.max.y-bounds.min.y;
  if(!Number.isFinite(length)||length<=0)throw new Error('El cohete no contiene geometría válida');
  const centreY=(bounds.min.y+bounds.max.y)/2,factor=ROCKET_LENGTH/length;
  const byMaterial=new Map();
  source.traverse(object=>{
    if(!object.isMesh)return;
    if(object.isSkinnedMesh||Array.isArray(object.material))throw new Error('El cohete debe usar mallas estáticas');
    const geometry=object.geometry.clone().applyMatrix4(object.matrixWorld);
    // Keep X/Z on the real cylindrical axis, rather than the asymmetric fin bounds.
    geometry.translate(0,-centreY,0);geometry.scale(factor,factor,factor);
    if(!byMaterial.has(object.material))byMaterial.set(object.material,[]);
    byMaterial.get(object.material).push(geometry);
  });
  const template=new T.Group();template.name='cohete-glb';
  for(const [original,parts] of byMaterial){
    const geometry=mergeGeometries(parts,false);
    for(const part of parts)part.dispose();
    if(!geometry)throw new Error('No se pueden agrupar las piezas del cohete');
    const material=original.clone();
    // This vertex-coloured export has no authored PBR material; light it as painted metal.
    material.metalness=.25;material.roughness=.5;
    geometry.computeBoundingSphere();geometry.computeBoundingBox();
    template.add(new T.Mesh(geometry,material));
  }
  if(!template.children.length)throw new Error('El cohete está vacío');
  return template;
}

export async function loadRocketTemplate(){
  const asset=new URL('./assets/models/cohete_galaxy_combat.glb',import.meta.url);
  asset.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(asset.href);
  return prepareRocketTemplate(gltf.scene);
}

export function createRocketFactory(template){
  const palettes=new Map();
  function paintedGeometry(original,index){
    const key=original.uuid+':'+index;
    if(palettes.has(key))return palettes.get(key);
    const geometry=original.clone(),source=original.attributes.color,paint=geometry.attributes.color;
    const team=teamPaints[index];
    if(source){
      for(let i=0;i<source.count;i++){
        const r=source.getX(i),g=source.getY(i),b=source.getZ(i);
        // Only the authored magenta paint changes; lamps, seams and metal stay intact.
        if(r>g*3&&b>g*3&&r>b){
          const shade=r/(242/255);
          paint.setXYZ(i,team.r*shade,team.g*shade,team.b*shade);
        }
      }
    }
    palettes.set(key,geometry);return geometry;
  }
  return index=>{
    const visual=template.clone(true),materials=new Map();
    const team=Math.max(0,Math.min(3,Math.trunc(Number(index)||0)));
    visual.traverse(object=>{
      if(!object.isMesh)return;
      if(index!==undefined)object.geometry=paintedGeometry(object.geometry,team);
      const original=object.material;
      if(!materials.has(original))materials.set(original,original.clone());
      object.material=materials.get(original);
    });
    if(index!==undefined)visual.userData.galaxyRocketTeam=team;
    return visual;
  };
}
