// Rebuild the fixed top-view hull and authored turret pivots from the supplied GLB.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
const bytes=await readFile(new URL('../docs/assets/models/nodriza.glb',import.meta.url));
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const hull=gltf.scene.getObjectByName('AEGIS_Hull');
hull.geometry.computeBoundingBox();const bounds=hull.geometry.boundingBox;
const center=bounds.getCenter(new T.Vector3()),scale=600/(bounds.max.z-bounds.min.z);
const p=hull.geometry.attributes.position,indices=hull.geometry.index.array;
function build(bank){
const vertices=Array.from({length:p.count},(_,i)=>[((p.getX(i)-center.x)*Math.cos(bank)+(p.getY(i)-center.y)*Math.sin(bank))*scale,(p.getZ(i)-center.z)*scale]);
// Rasterize the union of projected triangles, retaining the concave silhouette.
const n=1152,offset=n/2,zoom=1.7,mask=new Uint8Array(n*n);
for(let i=0;i<indices.length;i+=3){
  const points=Array.from(indices.slice(i,i+3),j=>vertices[j].map(v=>v*zoom+offset));
  const lo=Math.max(0,Math.ceil(Math.min(...points.map(v=>v[1]))-.5)),hi=Math.min(n-1,Math.floor(Math.max(...points.map(v=>v[1]))-.5));
  for(let y=lo;y<=hi;y++){
    const yy=y+.5,xs=[];
    for(let a=0,b=2;a<3;b=a++){
      const u=points[a],v=points[b];
      if((u[1]>yy)!==(v[1]>yy))xs.push(u[0]+(yy-u[1])*(v[0]-u[0])/(v[1]-u[1]));
    }
    if(xs.length<2)continue;
    const x0=Math.max(0,Math.ceil(Math.min(...xs)-.5)),x1=Math.min(n-1,Math.floor(Math.max(...xs)-.5));
    mask.fill(1,y*n+x0,y*n+x1+1);
  }
}
const edges=new Map(),key=(x,y)=>y*(n+1)+x;
function edge(a,b){if(!edges.has(a))edges.set(a,[]);edges.get(a).push(b);}
for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(mask[y*n+x]){
  if(!y||!mask[(y-1)*n+x])edge(key(x,y),key(x+1,y));
  if(x===n-1||!mask[y*n+x+1])edge(key(x+1,y),key(x+1,y+1));
  if(y===n-1||!mask[(y+1)*n+x])edge(key(x+1,y+1),key(x,y+1));
  if(!x||!mask[y*n+x-1])edge(key(x,y+1),key(x,y));
}
const loops=[];
while(edges.size){
  const start=edges.keys().next().value,loop=[];let at=start;
  do{loop.push(at);const options=edges.get(at);if(!options?.length)break;const next=options.pop();if(!options.length)edges.delete(at);at=next;}while(at!==start);
  if(at===start&&loop.length>10)loops.push(loop.map(v=>[v%(n+1),Math.floor(v/(n+1))]));
}
const area=points=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
const outer=loops.filter(l=>area(l)>10).sort((a,b)=>area(b)-area(a));
function distance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);}
function rdp(points,tolerance){if(points.length<3)return points;let best=0,index=0;for(let i=1;i<points.length-1;i++){const d=distance(points[i],points[0],points.at(-1));if(d>best){best=d;index=i;}}return best<=tolerance?[points[0],points.at(-1)]:rdp(points.slice(0,index+1),tolerance).slice(0,-1).concat(rdp(points.slice(index),tolerance));}
const outlines=outer.map(loop=>{let far=0;for(let i=1;i<loop.length;i++)if(Math.hypot(...loop[i].map((v,k)=>v-loop[0][k]))>Math.hypot(...loop[far].map((v,k)=>v-loop[0][k])))far=i;return rdp(loop.slice(0,far+1),1.2).slice(0,-1).concat(rdp(loop.slice(far).concat([loop[0]]),1.2).slice(0,-1)).map(point=>point.map(v=>+((v-offset)/zoom).toFixed(3)));});
function parts(points){
  const pieces=T.ShapeUtils.triangulateShape(points.map(p=>new T.Vector2(...p)),[]);let changed=true;
  const convex=poly=>{let sign=0;for(let i=0;i<poly.length;i++){const a=points[poly[i]],b=points[poly[(i+1)%poly.length]],c=points[poly[(i+2)%poly.length]],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<1e-8)continue;if(sign&&cross*sign<0)return false;sign=Math.sign(cross);}return true;};
  while(changed){changed=false;outer:for(let i=0;i<pieces.length;i++)for(let j=i+1;j<pieces.length;j++){const a=pieces[i],b=pieces[j];for(let u=0;u<a.length;u++)for(let v=0;v<b.length;v++)if(a[u]===b[(v+1)%b.length]&&a[(u+1)%a.length]===b[v]){const merged=[...Array.from({length:a.length-1},(_,k)=>a[(u+1+k)%a.length]),...Array.from({length:b.length-1},(_,k)=>b[(v+1+k)%b.length])];if(convex(merged)){pieces[i]=merged;pieces.splice(j,1);changed=true;break outer;}}}}
  return pieces;
}
const profiles=outlines.map(outline=>({outline,pieces:parts(outline)}));
return {profiles,radius:Math.max(...vertices.map(p=>Math.hypot(...p)))};
}
const names=['Aft_L','Aft_R','Centre','Forward_L','Forward_R'];
const turrets=names.map(name=>{
  const pivot=gltf.scene.getObjectByName('AEGIS_Yaw_'+name),mesh=gltf.scene.getObjectByName('AEGIS_Turret_'+name),position=mesh.geometry.attributes.position;
  const ends=[];for(let i=0;i<position.count;i++)if(position.getZ(i)>1.81)ends.push([position.getX(i),position.getY(i),position.getZ(i)]);
  const barrel=side=>{const group=ends.filter(p=>p[0]*side>0);return [group.reduce((s,p)=>s+p[0],0)/group.length,group.reduce((s,p)=>s+p[1],0)/group.length,Math.max(...group.map(p=>p[2]))].map(v=>+v.toFixed(6));};
  return {name:pivot.name,pivot:pivot.position.toArray().map(v=>+v.toFixed(6)),muzzles:[barrel(-1),barrel(1)]};
});
const banks=Array.from({length:21},(_,i)=>build((i-10)*Math.PI/180)),profiles=banks[10].profiles;
const definition={sha256:createHash('sha256').update(bytes).digest('hex'),length:600,center:center.toArray(),scale,turrets,profiles,bankProfiles:banks.map(b=>b.profiles[0]),radius:Math.max(...banks.map(b=>b.radius))};
await writeFile(new URL('../docs/mothership-data.js',import.meta.url),'/* Generated by tools/build-mothership-profile.mjs from nodriza.glb. Hull profiles: roll -10..+10 degrees at 1 degree; raster tolerance <1 arena unit. */\n\'use strict\';\n(typeof window!==\'undefined\'?window:globalThis).GalaxyMothershipData='+JSON.stringify(definition)+';\n');
console.log(JSON.stringify({bytes:bytes.length,triangles:indices.length/3+5*536,scale,profiles:profiles.map(p=>({points:p.outline.length,parts:p.pieces.length})),bankProfileCount:banks.length,bankIslands:banks.map(b=>b.profiles.length),turrets,radius:definition.radius},null,2));
