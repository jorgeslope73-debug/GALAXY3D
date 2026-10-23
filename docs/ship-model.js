/* Imported artwork is visual only; collision sizes and network state stay in the game. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

const authoredPaints=new WeakMap();
const paintFile='difuse.jpg';

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
  const [gltf,paint]=await Promise.all([
    new GLTFLoader().loadAsync(assetURL('nave.glb')),
    textureLoader.loadAsync(assetURL(paintFile)).catch(()=>{
      console.warn('[GALAXY3D] Se usa la pintura incluida en el GLB al faltar '+paintFile);
      return null;
    })
  ]);
  if(paint){paint.name=paintFile;paint.colorSpace=T.SRGBColorSpace;}
  const template=prepareShipTemplate(gltf.scene);
  authoredPaints.set(template,paint);
  document.documentElement.dataset.galaxyShipTextures=paint?'difuse-original':'embedded';
  return template;
}

function mappedPaint(original,paint){
  // Keep the GLB's UV channel, orientation and sampling settings, using the JPEG unchanged.
  const texture=original.clone();texture.source=paint.source;
  texture.name=paint.name;texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;
  return texture;
}

export function createShipFactory(template){
  const palettes=new Map();
  const paint=authoredPaints.get(template);
  return ()=>{
    const visual=template.clone(true),materials=new Map();
    visual.traverse(object=>{
      if(!object.isMesh)return;
      const clone=original=>{
        if(materials.has(original))return materials.get(original);
        const material=original.clone();
        if(original.map){
          const key=original.map.uuid;
          if(!palettes.has(key)){
            palettes.set(key,paint?mappedPaint(original.map,paint):original.map);
          }
          material.map=palettes.get(key);
          // Player identity stays in the HUD; do not tint the supplied artwork.
          if(paint)material.color.setHex(0xffffff);
        }
        materials.set(original,material);
        return material;
      };
      object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
    });
    return visual;
  };
}
