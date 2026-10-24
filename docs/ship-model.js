/* Imported artwork is visual only; collision sizes and network state stay in the game. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';

const authoredPaints=new WeakMap();
const lightStates=new WeakMap(),lampMasks=new WeakMap();
// Player 4 uses the yellow artwork uploaded under the existing naveroja.png name.
const paintFiles=['naveazul-cupula-oscura.png','navefuxia.jpg','naveverde-luces-rojas.png','naveroja.png'];

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

export async function loadShipTemplate({strict=false}={}){
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
  const [gltf,paints,mask]=await Promise.all([
    new GLTFLoader().loadAsync(assetURL('nave.glb')),
    loadPaints(paintFiles),
    textureLoader.loadAsync(assetURL('nave-luces-mask.svg')).catch(error=>{
      console.warn('[GALAXY3D] Se conservan las luces de la textura:',error);return null;
    })
  ]);
  if(strict&&(!paints.every(Boolean)||!mask)){
    throw new Error('No se han podido cargar todas las texturas de las naves');
  }
  const template=prepareShipTemplate(gltf.scene);
  authoredPaints.set(template,paints);
  if(mask){mask.name='nave-luces-mask.svg';mask.colorSpace=T.NoColorSpace;lampMasks.set(template,mask);}
  document.documentElement.dataset.galaxyShipTextures=paints.every(Boolean)?'azul-fucsia-verde-amarilla':paints.some(Boolean)?'partial':'embedded';
  document.documentElement.dataset.galaxyShipAmmoTextures='shared';
  document.documentElement.dataset.galaxyShipAmmoMask=mask?'loaded':'fallback';
  return template;
}

function mappedPaint(original,paint){
  // Keep the GLB's UV channel, orientation and sampling settings, using each image directly.
  const texture=original.clone();texture.source=paint.source;
  texture.name=paint.name;texture.colorSpace=paint.colorSpace;texture.needsUpdate=true;
  return texture;
}

function prepareAmmoLamps(material,mask,player){
  // The shared vector mask follows only the front panel in the model UVs.
  // It changes only their final light output, after the hull's normal lighting.
  const power={value:1};
  const colour={value:new T.Color(player===2?0xff0802:0x03ff12)};
  material.onBeforeCompile=shader=>{
    shader.uniforms.galaxyAmmoMask={value:mask};
    shader.uniforms.galaxyAmmoPower=power;
    shader.uniforms.galaxyAmmoColour=colour;
    shader.fragmentShader='uniform sampler2D galaxyAmmoMask;\nuniform float galaxyAmmoPower;\nuniform vec3 galaxyAmmoColour;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',`
      #include <tonemapping_fragment>
      #ifdef USE_MAP
        float galaxyLamp=texture2D(galaxyAmmoMask,vMapUv).r;
        gl_FragColor.rgb=mix(gl_FragColor.rgb,galaxyAmmoColour*galaxyAmmoPower,galaxyLamp);
      #endif
    `);
  };
  material.customProgramCacheKey=()=> 'galaxy-ammo-front-light-v3';
  return power;
}

export function createShipFactory(template){
  const palettes=new Map(),masks=new Map();
  const paints=authoredPaints.get(template)||[];
  const mask=lampMasks.get(template);
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
            palettes.set(key,paint?mappedPaint(original.map,paint):original.map);
          }
          material.map=palettes.get(key);
          let power=null;
          if(mask){
            if(!masks.has(original.map.uuid))masks.set(original.map.uuid,mappedPaint(original.map,mask));
            power=prepareAmmoLamps(material,masks.get(original.map.uuid),player);
          }
          if(power)lights.push(power);
          // Apply the artwork directly; never generate additional team recolours.
          if(paint)material.color.setHex(0xffffff);
        }
        materials.set(original,material);
        return material;
      };
      object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
    });
    lightStates.set(visual,{hasAmmo:true,visibility:1,lights});
    return visual;
  };
}

export function setShipAmmoLights(visual,hasAmmo,alpha=1){
  const state=lightStates.get(visual),on=!!hasAmmo;
  const visibility=Math.max(0,Math.min(1,Number(alpha)||0));
  if(!state||(state.hasAmmo===on&&state.visibility===visibility))return;
  // Keep the current hull paint through reloads; only the masked lamps change.
  // Fade their light output too, so the ready lamp never reveals a cloaked hull.
  for(const power of state.lights)power.value=on?visibility:0;
  state.hasAmmo=on;state.visibility=visibility;
}
