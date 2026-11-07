import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
export async function readStormGunData(bytes){
 const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
 const g=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');g.scene.updateMatrixWorld(true);
 const clip=g.animations.find(c=>c.name.toLowerCase()==='disparo');if(!clip)throw Error('Missing DISPARO');
 const track=clip.tracks[0],times=Array.from(track.times),weights=Array.from(track.values);
 for(const t of clip.tracks)if(JSON.stringify(Array.from(t.times))!==JSON.stringify(times)||JSON.stringify(Array.from(t.values))!==JSON.stringify(weights))throw Error('DISPARO requires per-gun curves');
 let radius=0;const v=new T.Vector3();g.scene.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);radius=Math.max(radius,Math.hypot(v.x,v.z));}}});
 const guns=[];
 for(let i=1;i<=6;i++){
  const pivot=g.scene.getObjectByName('TURRET_'+String(i).padStart(2,'0')+'_PIVOT'),hull=pivot.children.find(o=>o.name.includes('Hull'));
  const inverse=pivot.matrixWorld.clone().invert(),transform=new T.Matrix4();
  const forward=new T.Vector3(0,0,-1).transformDirection(hull.matrix),restForward=forward.clone().transformDirection(pivot.matrix);
  const muzzles=[];
  for(const side of [-1,1]){
   const samples=[];
   hull.traverse(o=>{if(!o.isMesh)return;transform.multiplyMatrices(inverse,o.matrixWorld);const p=o.geometry.attributes.position,m=o.geometry.morphAttributes.position?.[0];if(!m)throw Error('Missing barrel morph');
    for(let k=0;k<p.count;k++){
     const raw=new T.Vector3().fromBufferAttribute(p,k);if(Math.abs(raw.x-side*.205)>.14||Math.abs(raw.y-.32)>.15)continue;
     const peak=raw.clone().add(new T.Vector3().fromBufferAttribute(m,k));
     samples.push({raw,base:raw.clone().applyMatrix4(transform),peak:peak.applyMatrix4(transform)});
    }
   });
   const front=Math.min(...samples.map(s=>s.raw.z)),seen=new Set(),base=new T.Vector3(),delta=new T.Vector3();let count=0;
   for(const s of samples){if(s.raw.z>front+1e-5)continue;const key=s.raw.toArray().map(n=>n.toFixed(6)).join(',');if(seen.has(key))continue;seen.add(key);base.add(s.base);delta.add(s.peak.sub(s.base));count++;}
   if(count<8)throw Error('Cannot identify muzzle rim '+i);base.divideScalar(count);delta.divideScalar(count);muzzles.push({base:base.toArray(),delta:delta.toArray()});
  }
  guns.push({pivot:pivot.position.toArray(),forward:Math.atan2(-forward.z,forward.x),rest:Math.atan2(restForward.z,restForward.x),muzzles});
 }
 return {sha256:createHash('sha256').update(bytes).digest('hex'),scale:122/radius,duration:clip.duration,lead:times[weights.indexOf(Math.max(...weights))],times,weights,guns};
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop())){
 const data=await readStormGunData(fs.readFileSync('docs/assets/models/nucleo.glb'));
 if(process.argv.includes('--write')){const path='docs/storm-core.js',s=fs.readFileSync(path,'utf8');if(!s.includes('  const GUNS='))throw Error('Missing calibration marker');fs.writeFileSync(path,s.replace(/  const GUNS=.*;/,'  const GUNS='+JSON.stringify(data)+';'));}
 else console.log(JSON.stringify(data));
}
