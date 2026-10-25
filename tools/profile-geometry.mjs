// Decode the production transforms, without decoding or changing artwork.
import {readFile,writeFile} from 'node:fs/promises';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareShipTemplate} from '../docs/ship-model.js';
import {prepareMeteorTemplate} from '../docs/meteor-model.js';
export async function modelGeometry(kind){
  const file=kind==='ship'?'nave.glb':'asteroidemediano.glb';
  const bytes=await readFile(new URL('../docs/assets/models/'+file,import.meta.url));
  const loader=new GLTFLoader();
  loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const template=kind==='ship'?prepareShipTemplate(gltf.scene):prepareMeteorTemplate(gltf.scene,'medium');
  if(kind==='ship')template.scale.multiplyScalar(1.5);
  template.updateMatrixWorld(true);
  const vertices=[],triangles=[];
  template.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const p=mesh.geometry.attributes.position,offset=vertices.length;
    for(let i=0;i<p.count;i++)vertices.push(new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).toArray());
    const idx=mesh.geometry.index;
    for(let i=0;i<(idx?idx.count:p.count);i+=3)triangles.push([0,1,2].map(j=>offset+(idx?idx.getX(i+j):i+j)));
  });
  return {vertices,triangles};
}
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify({ship:await modelGeometry('ship'),medium:await modelGeometry('medium')}));
