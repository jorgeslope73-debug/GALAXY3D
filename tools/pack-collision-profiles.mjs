import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from '../docs/vendor/three.module.min.js';
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
function convex(polygon,points){
  let sign=0;
  for(let i=0;i<polygon.length;i++){
    const a=points[polygon[i]],b=points[polygon[(i+1)%polygon.length]],c=points[polygon[(i+2)%polygon.length]];
    const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
    if(Math.abs(cross)<1e-9)continue;
    if(sign&&cross*sign<0)return false;sign=Math.sign(cross);
  }
  return true;
}
function parts(points){
  const pieces=T.ShapeUtils.triangulateShape(points.map(p=>new T.Vector2(...p)),[]);
  let changed=true;
  while(changed){
    changed=false;
    outer:for(let i=0;i<pieces.length;i++)for(let j=i+1;j<pieces.length;j++){
      const a=pieces[i],b=pieces[j];
      for(let u=0;u<a.length;u++)for(let v=0;v<b.length;v++)if(a[u]===b[(v+1)%b.length]&&a[(u+1)%a.length]===b[v]){
        const merged=[...Array.from({length:a.length-1},(_,k)=>a[(u+1+k)%a.length]),...Array.from({length:b.length-1},(_,k)=>b[(v+1+k)%b.length])];
        if(convex(merged,points)){pieces[i]=merged;pieces.splice(j,1);changed=true;break outer;}
      }
    }
  }
  return pieces;
}
const packed={version:1,shipStep:1,mediumSteps:720};
packed.models={};
for(const file of ['nave.glb','asteroidemediano.glb'])packed.models[file]=createHash('sha256').update(await readFile(new URL('../docs/assets/models/'+file,import.meta.url))).digest('hex');
for(const kind of ['ship','medium']){
  const scale=kind==='ship'?100:10000;
  packed[kind]=input[kind].map(outline=>{
    const quantized=outline.map(p=>p.map(v=>Math.round(v*scale)));
    const points=quantized.map(p=>p.map(v=>v/scale));
    return [quantized.flat(),parts(points)];
  });
}
const source='/* Generated from nave.glb and asteroidemediano.glb by tools/build-collision-profiles.py.\n * Ship: bank -60..60 degrees at 1 degree. Medium: one full 3D tumble at .5 degree.\n * Coordinates: ship /100 arena units, medium /10000 normalized radius. */\n\'use strict\';\n(typeof window!==\'undefined\'?window:globalThis).GalaxyCollisionProfiles='+JSON.stringify(packed)+';\n';
await writeFile(new URL('../docs/collision-profiles.js',import.meta.url),source);
console.log(JSON.stringify({bytes:source.length,shipProfiles:packed.ship.length,mediumProfiles:packed.medium.length,maxShipPoints:Math.max(...input.ship.map(p=>p.length)),maxMediumPoints:Math.max(...input.medium.map(p=>p.length))}));
