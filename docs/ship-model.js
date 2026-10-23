/* Imported artwork is visual only; collision sizes and network state stay in the game. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

const teamColors=[0x5ae1ff,0xff50a5,0x5aff78,0xffdc46];

export function prepareShipTemplate(source){
  // This Blender export points along -X and uses Y as its vertical axis.
  // The game's models point along +Y, with Z facing the overhead camera.
  const level=new T.Group();level.rotation.x=-Math.PI/2;level.add(source);
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
  const asset=new URL('./assets/models/nave.glb',import.meta.url);
  asset.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(asset.href);
  return prepareShipTemplate(gltf.scene);
}

function teamTexture(original,color){
  const image=original.image;
  if(!image)return original;
  const canvas=document.createElement('canvas');
  canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('No se pueden preparar los colores de la nave');
  ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  const red=(color>>>16)&255,green=(color>>>8)&255,blue=color&255;
  for(let i=0;i<pixels.data.length;i+=4){
    const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];
    // Only the magenta paint changes. Keep the hull, wear and normal map intact.
    const amount=Math.max(0,Math.min(1,(Math.min(r,b)-g-12)/42));
    if(!amount)continue;
    const shade=Math.max(r,b)/255;
    pixels.data[i]=r+(red*shade-r)*amount;
    pixels.data[i+1]=g+(green*shade-g)*amount;
    pixels.data[i+2]=b+(blue*shade-b)*amount;
  }
  ctx.putImageData(pixels,0,0);
  // Texture.clone shares its Source; give each paint its own source so recolouring
  // one team never overwrites the original or another player's texture.
  const texture=original.clone();texture.source=new T.Source(canvas);texture.needsUpdate=true;
  return texture;
}

export function createShipFactory(template){
  const palettes=new Map();
  return index=>{
    const team=Math.max(0,Math.min(3,Number(index)||0));
    const visual=template.clone(true),materials=new Map();
    visual.traverse(object=>{
      if(!object.isMesh)return;
      const clone=original=>{
        if(materials.has(original))return materials.get(original);
        const material=original.clone();
        if(original.map){
          const key=original.map.uuid+':'+team;
          if(!palettes.has(key))palettes.set(key,teamTexture(original.map,teamColors[team]));
          material.map=palettes.get(key);
        }
        materials.set(original,material);
        return material;
      };
      object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
    });
    return visual;
  };
}
