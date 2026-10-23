/* Imported artwork is visual only; collision sizes and network state stay in the game. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

const authoredPaints=new WeakMap();
const unarmedPaints=new WeakMap(),lightStates=new WeakMap();
const paintFiles=['naveazul-cupula-oscura.png','navefuxia.jpg','naveverde-luces-rojas.png','naveroja.png'];
const unarmedFiles=['naveazul-sin-balas.png','navefuxia-sin-balas.png','naveverde-sin-balas.png','naveroja-sin-balas.png'];

function assetURL(name){
  const asset=new URL('./assets/models/'+name,import.meta.url);
  asset.search=new URL(import.meta.url).search;
  return asset.href;
}

export function prepareShipTemplate(source){
  // This export points along -X, with its upper deck facing +Y.
  // Turn the deck towards the overhead camera (+Z), then align the nose to +Y.
  const level=new T.Group();level.rotation.x=Math.PI/2;level.add(source);
  const facing=new T.Group();facing.rotation.z=-Math.PI/2;facing.add(level);
  facing.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(facing);
  const size=bounds.getSize(new T.Vector3());
  const span=Math.max(size.x,size.y);
  if(!Number.isFinite(span)||span<=0)throw new Error('La nave no contiene geometría válida');
  facing.position.sub(bounds.getCenter(new T.Vector3()));
  const template=new T.Group();template.name='nave-glb';template.add(facing);
  template.scale.setScalar(62/span);
  template.updateMatrixWorld(true);
  return template;
}

export async function loadShipTemplate(){
  const textureLoader=new T.TextureLoader();
  const loadPaints=files=>Promise.all(files.map(async file=>{
    try{
      const paint=await textureLoader.loadAsync(assetURL(file));
      paint.name=file;paint.colorSpace=T.SRGBColorSpace;
      return paint;
    }catch(_){
      console.warn('[GALAXY3D] Se usa la pintura de respaldo al faltar '+file);
      return null;
    }
  }));
  const [gltf,paints,offPaints]=await Promise.all([
    new GLTFLoader().loadAsync(assetURL('nave.glb')),
    loadPaints(paintFiles),loadPaints(unarmedFiles)
  ]);
  const template=prepareShipTemplate(gltf.scene);
  authoredPaints.set(template,paints);
  unarmedPaints.set(template,offPaints);
  document.documentElement.dataset.galaxyShipTextures=paints.every(Boolean)?'azul-fucsia-verde-roja':paints.some(Boolean)?'partial':'embedded';
  document.documentElement.dataset.galaxyShipAmmoTextures=offPaints.every(Boolean)?'loaded':'partial';
  return template;
}

function mappedPaint(original,paint){
  // Keep the GLB's UV channel, orientation and sampling settings, using each image directly.
  const texture=original.clone();texture.source=paint.source;
  texture.name=paint.name;texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;
  return texture;
}

export function createShipFactory(template){
  const palettes=new Map();
  const paints=authoredPaints.get(template)||[];
  const offPaints=unarmedPaints.get(template)||[];
  return index=>{
    // Each player gets a distinct authored texture, including the two Adobe colour variants.
    const player=Math.max(0,Math.min(3,Math.trunc(Number(index)||0)));
    const paintIndex=player,paint=paints[paintIndex];
    const visual=template.clone(true),materials=new Map(),lights=[];
    visual.traverse(object=>{
      if(!object.isMesh)return;
      const clone=original=>{
        if(materials.has(original))return materials.get(original);
        const material=original.clone();
        if(original.map){
          const key=original.map.uuid+':'+paintIndex;
          if(!palettes.has(key)){
            const on=paint?mappedPaint(original.map,paint):original.map;
            palettes.set(key,{on,off:offPaints[paintIndex]?mappedPaint(original.map,offPaints[paintIndex]):on});
          }
          const maps=palettes.get(key);material.map=maps.on;
          lights.push({material,...maps});
          // Apply the artwork directly; never generate additional team recolours.
          if(paint)material.color.setHex(0xffffff);
        }
        materials.set(original,material);
        return material;
      };
      object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
    });
    lightStates.set(visual,{hasAmmo:true,lights});
    return visual;
  };
}

export function setShipAmmoLights(visual,hasAmmo){
  const state=lightStates.get(visual),on=!!hasAmmo;
  if(!state||state.hasAmmo===on)return;
  for(const light of state.lights)light.material.map=on?light.on:light.off;
  state.hasAmmo=on;
}
