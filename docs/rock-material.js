import * as T from './vendor/three.module.min.js';

export async function loadRockTexture(){
  const asset=new URL('./assets/models/asteroideAzul.png',import.meta.url);
  asset.search=new URL(import.meta.url).search;
  const texture=await new T.TextureLoader().loadAsync(asset.href);
  texture.name='asteroideAzul.png';
  texture.colorSpace=T.SRGBColorSpace;
  texture.wrapS=T.RepeatWrapping;texture.wrapT=T.RepeatWrapping;
  return texture;
}
