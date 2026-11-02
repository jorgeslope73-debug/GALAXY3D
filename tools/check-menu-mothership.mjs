import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareMothershipTemplate,createMothershipFactory} from '../docs/mothership-model.js';
import {createMenuMothershipFlight,prepareMenuMothership,setMenuMothershipPose,MENU_MOTHERSHIP_DEPTH,MENU_MOTHERSHIP_MARGIN} from '../docs/menu-mothership.js';
const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
let visits=0;const directions=new Set();
for(let seed=1;seed<=8;seed++){
  const flight=createMenuMothershipFlight({random:random(seed)});let previous=null,ended=null,count=0,started=null,minY=Infinity,maxY=-Infinity;
  for(let time=0;time<=720000;time+=40){
    const pose=flight.update(time,true);
    assert.equal(flight.needsAssets,time>=6000,'large assets wait for visible menu dwell');
    if(pose){
      if(!previous){count++;started=time;minY=Infinity;maxY=-Infinity;if(ended===null)assert.ok(time>=24000&&time<=36040);else assert.ok(time-ended>=100000,'passes have long quiet intervals');}
      minY=Math.min(minY,pose.y);maxY=Math.max(maxY,pose.y);
      if(previous)assert.ok(Math.hypot(pose.x-previous.x,pose.y-previous.y)<2.3,'the enlarged ship crosses more slowly and continuously');
      if(!previous)assert.equal(pose.x,pose.direction>0?-MENU_MOTHERSHIP_MARGIN:1920+MENU_MOTHERSHIP_MARGIN,'a passage always starts offscreen');
      assert.ok(pose.x>=-MENU_MOTHERSHIP_MARGIN&&pose.x<=1920+MENU_MOTHERSHIP_MARGIN);assert.ok(pose.y>110&&pose.y<630);
      if(previous){const tangent=Math.atan2(pose.x-previous.x,-(pose.y-previous.y));assert.ok(Math.abs(tangent-pose.angle)<.002,'the hull follows the curve tangent in both directions');}
      assert.ok(pose.bank>77*Math.PI/180-.001&&pose.bank<83*Math.PI/180+.001,'the hull stays in lateral view');
      directions.add(pose.direction);
    }else if(previous){assert.ok(maxY-minY>100,'every passage follows a visible broad arc');assert.ok(time-started>=50000&&time-started<=60040,'a crossing lasts 50-60 seconds');assert.ok(previous.x< -MENU_MOTHERSHIP_MARGIN+4||previous.x>1920+MENU_MOTHERSHIP_MARGIN-4,'the full ship leaves before disappearing');ended=time;}
    previous=pose;
  }
  assert.ok(count>=4&&count<=6,'scenery is occasional during twelve minutes');visits+=count;
}
assert.deepEqual([...directions].sort(),[-1,1]);
const delayed=createMenuMothershipFlight({random:()=>.5});for(let t=0;t<=40000;t+=40)assert.equal(delayed.update(t,false),null,'an unloaded model is never shown');assert.ok(delayed.update(40040,true));
assert.equal(delayed.update(500000,true),null,'matches and hidden tabs cancel the active passage');
for(let t=500040;t<524000;t+=40)assert.equal(delayed.update(t,true),null,'returning never catches up a hidden passage');
const reduced=createMenuMothershipFlight({reducedMotion:true});for(let t=0;t<300000;t+=40){assert.equal(reduced.update(t,true),null);assert.equal(reduced.needsAssets,false);}
const poses=[];for(const step of [20,50]){const f=createMenuMothershipFlight({random:()=>.5});let pose;for(let t=0;t<=42000;t+=step)pose=f.update(t,true);poses.push(pose);}assert.ok(Math.hypot(poses[0].x-poses[1].x,poses[0].y-poses[1].y)<1e-8,'refresh rate does not change the route');
for(const mobile of [false,true]){
  const original=new T.MeshStandardMaterial({color:0xddeeff,emissive:0xff9955,emissiveIntensity:7,envMapIntensity:.85});original.map=new T.Texture();original.normalMap=new T.Texture();
  const visual=new T.Group();visual.scale.setScalar(36.6);visual.add(new T.Mesh(new T.BoxGeometry(),original),new T.Mesh(new T.BoxGeometry(),original));
  const prepared=prepareMenuMothership(visual,mobile);assert.equal(prepared,visual);assert.equal(prepared.scale.x,36.6*(mobile?.48:.64));
  const material=visual.children[0].material;assert.notEqual(material,original);assert.equal(material,visual.children[1].material);assert.equal(material.map,original.map);assert.equal(material.normalMap,original.normalMap);
  assert.equal(material.opacity,1);assert.equal(material.transparent,false);assert.equal(material.depthWrite,true);assert.equal(material.color.getHex(),original.color.getHex());assert.equal(material.emissiveIntensity,7);assert.equal(material.envMapIntensity,.85);assert.equal(original.opacity,1);assert.equal(original.emissiveIntensity,7,'menu preparation cannot change the gameplay material');
  for(const direction of [-1,1]){
    setMenuMothershipPose(visual,{bank:80*Math.PI/180,angle:direction*Math.PI/2,direction});
    assert.ok(Math.abs(visual.rotation.y+direction*80*Math.PI/180)<1e-12);
    assert.ok(new T.Vector3(0,0,1).applyEuler(visual.rotation).y>.9,'The bridge remains above the hull in either crossing direction');
  }
}
assert.ok(MENU_MOTHERSHIP_DEPTH< -500,'the ship lies behind every foreground floater');
// Check the actual replacement GLB, including its tower and turret geometry.
const definitionScope=vm.createContext({window:{}});vm.runInContext(await readFile(new URL('../docs/mothership-data.js',import.meta.url),'utf8'),definitionScope);
const bytes=await readFile(new URL('../docs/assets/models/nodriza.glb',import.meta.url));
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const definition=definitionScope.window.GalaxyMothershipData,factory=createMothershipFactory(prepareMothershipTemplate(gltf.scene,definition),definition);
// All four real yaw nulls scan independently and remain bounded/smooth on each menu clone.
const gameplay=factory(),visitor=prepareMenuMothership(factory()),guns=definition.turrets.map(t=>visitor.getObjectByName(t.name));
const ranges=guns.map(()=>[Infinity,-Infinity]);let previousAngles=null;
for(let frame=0;frame<=1200;frame++){
  const age=frame/60;setMenuMothershipPose(visitor,{angle:Math.PI/2,bank:80*Math.PI/180,direction:1,age});
  const angles=guns.map(g=>g.rotation.y);
  for(let i=0;i<guns.length;i++){
    assert.ok(Math.abs(angles[i])<=40*Math.PI/180+1e-12,'scans stay within 40 degrees');
    if(previousAngles)assert.ok(Math.abs(angles[i]-previousAngles[i])<25*Math.PI/180/60,'scans have no frame-to-frame snaps');
    assert.equal(Math.abs(guns[i].rotation.x),0);assert.equal(Math.abs(guns[i].rotation.z),0);
    ranges[i][0]=Math.min(ranges[i][0],angles[i]);ranges[i][1]=Math.max(ranges[i][1],angles[i]);
  }
  previousAngles=angles;
}
assert.ok(ranges.every(([min,max])=>max-min>1.3),'every cannon visibly moves both ways');
assert.equal(new Set(previousAngles.map(a=>a.toFixed(4))).size,4,'the guns do not turn in unison');
for(const turret of definition.turrets)assert.equal(gameplay.getObjectByName(turret.name).rotation.y,0,'menu scans cannot modify gameplay aiming');
for(const mobile of [false,true])for(const direction of [-1,1]){
  const visual=prepareMenuMothership(factory(),mobile),flight=createMenuMothershipFlight({random:()=>direction>0?0:.99});let first=null,last=null;
  for(let t=0;t<120000;t+=40){const pose=flight.update(t,true);if(pose){first??=pose;last=pose;}else if(first)break;}
  for(const [pose,entering]of [[first,true],[last,false]]){
    setMenuMothershipPose(visual,pose);visual.position.x=pose.x;
    const bounds=new T.Box3().setFromObject(visual),left=entering?direction>0:direction<0;
    assert.ok(left?bounds.max.x<0:bounds.min.x>1920,'no mesh fragment is visible before entry or at retirement, in either direction/size');
  }
}
// Exercise the real menu method while its optional model request is unresolved/fails.
const render=await readFile(new URL('../docs/render-3d.js',import.meta.url),'utf8');const start=render.indexOf('      menu(ctx,time){'),end=render.indexOf('      winner(ctx,player,angle){',start);assert.ok(start>0&&end>start);
let requests=0,frames=0,resolveLoad;const loading=new Promise(resolve=>resolveLoad=resolve);
const scope=vm.createContext({reducedMotion:false,mobile:false,menuActors:()=>[],menuFlight:{update:()=>null},menuMothershipFlight:{needsAssets:true,update:(t,ready)=>ready?{x:100,y:240}:null},createImportedMothership:null,menuMothershipFailed:false,mothershipLoad:null,console:{warn(){}},prepareMothership(){requests++;scope.mothershipLoad=loading;return loading;}});
const menu=vm.runInContext('({'+render.slice(start,end)+'}).menu',scope),ctx={canvas:{dataset:{}}};const api={begin(){},menuMothership(){frames++;},flush(){},menuUfo(){}};
for(let i=0;i<20;i++)menu.call(api,ctx,i*40);assert.equal(requests,1);assert.equal(frames,0,'model download never blocks normal menu frames');resolveLoad();await loading;
scope.createImportedMothership=()=>{};menu.call(api,ctx,1000);assert.equal(frames,1);assert.equal(ctx.canvas.dataset.menuMothership,'flying');
scope.createImportedMothership=null;scope.mothershipLoad=null;scope.prepareMothership=()=>{requests++;return Promise.reject(new Error('offline'));};menu.call(api,ctx,1040);await Promise.resolve();assert.equal(scope.menuMothershipFailed,true);menu.call(api,ctx,1080);assert.equal(requests,2,'optional failures do not loop requests or break the renderer');
scope.menuMothershipFlight=null;menu.call(api,ctx,1120);assert.equal(ctx.canvas.dataset.menuMothership,'idle','startup also works before the optional controller arrives');
console.log(`Menu mothership OK: ${visits} occasional passes, both directions, opaque original materials, 60% larger size, 50-60 second travel, fully offscreen entry/exit, long pauses, reduced motion, hidden-tab reset, shared textures and non-blocking optional loading/failure.`);
