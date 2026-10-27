/* The imported rocket is presentation only; the existing guided projectile stays authoritative. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';

export const ROCKET_LENGTH=40;
const teamPaints=[0x28bce8,0xf232a3,0x47df3f,0xffd83d].map(hex=>new T.Color(hex));
const isMagentaPaint=colour=>colour&&colour.r>colour.g*3&&colour.b>colour.g*3&&colour.r>colour.b;

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
    // Keep the authored PBR finish; the factory changes only the paint colour.
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

export function createRocketFactory(template,environment=null){
  const palettes=new Map();
  function paintedGeometry(original,index){
    // Material-painted exports need no duplicate vertex buffers for each team.
    if(!original.attributes.color)return original;
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
      if(!materials.has(original)){
        const material=original.clone();
        // The replacement GLB stores the body/cone/fin paint in baseColorFactor,
        // rather than COLOR_0. Recolour that paint without tinting metal or lights.
        if(index!==undefined&&!object.geometry.attributes.color&&!original.map&&
          isMagentaPaint(original.color)&&(!original.emissive||original.emissive.r+original.emissive.g+original.emissive.b===0)){
          const shade=original.color.r/teamPaints[1].r;
          material.color.copy(teamPaints[team]).multiplyScalar(shade);
        }
        if(environment&&!material.envMap){material.envMap=environment;material.needsUpdate=true;}
        materials.set(original,material);
      }
      object.material=materials.get(original);
    });
    if(index!==undefined)visual.userData.galaxyRocketTeam=team;
    return visual;
  };
}
