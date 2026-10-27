'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/menu-decor.js','utf8');
function fixture({active=false,renderer=true,reduced=false,mobile=false,context=true}={}){
  let time=0,hidden=false,menuHidden=false,next=0,observer;
  const frames=new Map(),timers=new Map(),windowEvents=new Map(),documentEvents=new Map();
  const calls={three:[],clears:0,transforms:[],cancelled:0,images:0,random:0,allocations:0};
  const ctx={clearRect(){calls.clears++;},setTransform(...values){calls.transforms.push(values);}};
  let rect={width:1920,height:1080};
  const canvas={width:1280,height:720,getContext:()=>context?ctx:null,getBoundingClientRect:()=>rect};
  const menu={classList:{contains:name=>name==='hidden'&&menuHidden}};
  const add=(map,type,fn)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(fn);};
  const dispatch=(map,type)=>{for(const fn of map.get(type)||[])fn();};
  const document={get hidden(){return hidden;},getElementById:id=>id==='menu'?menu:id==='menuDecor'?canvas:null,
    documentElement:{classList:{contains:()=>false}},addEventListener:(type,fn)=>add(documentEvents,type,fn)};
  const window={devicePixelRatio:1,addEventListener:(type,fn)=>add(windowEvents,type,fn)};
  if(renderer)window.Galaxy3D={active,menu(context,now){assert.equal(context,ctx);calls.three.push(now);return this.active;}};
  const math=Object.create(Math);math.random=()=>{calls.random++;return .5;};
  class TrackedArray extends Array{static from(input,map){calls.allocations++;return Array.from(input,map);}}
  const c=vm.createContext({window,document,navigator:{userAgent:mobile?'Mobile':'Desktop'},performance:{now:()=>time},Math:math,Array:TrackedArray,
    Image:class{constructor(){calls.images++;throw Error('The 3D menu must never create legacy images');}},
    MutationObserver:class{constructor(fn){observer=fn;}observe(target,options){assert.equal(target,menu);assert.equal(options.attributeFilter.join(','),'class');}},
    matchMedia:query=>({matches:query.includes('reduced-motion')?reduced:mobile}),
    setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},
    cancelAnimationFrame:id=>{calls.cancelled++;frames.delete(id);}});
  vm.runInContext(source,c,{filename:'menu-decor.js'});
  return {calls,window,canvas,frames,timers,
    ready(){window.Galaxy3D.active=true;dispatch(windowEvents,'galaxy3d-ready');},
    error(){window.Galaxy3D.active=false;dispatch(windowEvents,'galaxy3d-error');},
    hidePage(value){hidden=value;dispatch(documentEvents,'visibilitychange');},
    hideMenu(value){menuHidden=value;observer?.();},
    resize(width,height,dpr=1){rect={width,height};window.devicePixelRatio=dpr;dispatch(windowEvents,'resize');},
    flushTimers(){const due=[...timers];timers.clear();for(const [,timer]of due)timer.fn();},
    tick(now){time=now;assert.equal(frames.size,1,'only one menu frame may be queued');const [id,fn]=frames.entries().next().value;frames.delete(id);fn(now);}};
}
for(const options of [{},{mobile:true},{reduced:true}]){
  const f=fixture(options);
  assert.equal(f.frames.size,0,'loading graphics schedules no useless menu loop');
  assert.equal(f.calls.images,0);assert.equal(f.calls.random,0);assert.equal(f.calls.allocations,0);
  f.ready();assert.equal(f.frames.size,1);
  f.tick(1000);f.tick(1016);f.tick(options.reduced?1101:options.mobile?1043:1034);
  assert.equal(f.calls.three.length,2,'desktop/mobile/reduced-motion paint cadence is preserved');
  assert.equal(f.calls.clears,2,'the compositor clears only when a 3D frame is painted');
  assert.equal(f.calls.images,0);assert.equal(f.calls.random,0);assert.equal(f.calls.allocations,0);
  const count=f.calls.three.length;
  f.hideMenu(true);assert.equal(f.frames.size,0,'entering a match cancels the menu animation');
  f.hideMenu(false);assert.equal(f.frames.size,1);f.hidePage(true);assert.equal(f.frames.size,0,'backgrounding cancels the animation rather than polling');
  assert.equal(f.calls.three.length,count);
  f.hidePage(false);f.tick(2000);assert.equal(f.calls.three.at(-1),2000,'resume uses current time without a catch-up simulation');
  f.error();assert.equal(f.frames.size,0,'WebGL loss suspends the menu while the loader offers retry');
  f.ready();f.tick(3000);assert.equal(f.calls.three.at(-1),3000,'restoring the renderer resumes the 3D menu');
  f.resize(1000,400,2);f.resize(1000,400,2);assert.equal(f.timers.size,1,'resize remains debounced');
  f.flushTimers();assert.equal(f.frames.size,1,'resize does not create a second frame loop');f.tick(4000);
  const dpr=options.mobile?1.05:1.25;
  assert.equal(f.canvas.width,1000*dpr);assert.equal(f.canvas.height,400*dpr,'backing dimensions preserve the CSS aspect ratio');
  const [sx,, ,sy]=f.calls.transforms.at(-1);assert.equal(sx,sy,'the scene is scaled uniformly');
  const transforms=f.calls.transforms.length;f.hidePage(true);f.resize(800,450);f.flushTimers();
  assert.equal(f.frames.size,0);assert.equal(f.calls.transforms.length,transforms,'hidden resize does no graphics work');
}
for(const options of [{renderer:false},{context:false}]){
  const f=fixture(options);
  assert.equal(f.frames.size,0,'missing renderer/context never starts 2D fallback');
  assert.equal(f.calls.images,0);assert.equal(f.calls.three.length,0);
}
assert.ok(!/legacyDecoration|spawnMeteor|collideMeteors|updateParticles|new Image|drawMeteorSprite/.test(source),'the old 2D simulation and asset loader are absent');
console.log('Menu resources OK: 3D-only compositor, unchanged desktop/mobile/reduced-motion cadence and uniform size; readiness/visibility/WebGL/resize lifecycle; zero legacy images, particles or simulation.');
