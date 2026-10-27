'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/menu-decor.js','utf8');
function fixture({requested,renderer=false,reduced=false,mobile=false}={}){
  let frame,time=0,hidden=false,menuHidden=false,randomCalls=0;
  const urls=[],allocations=[],calls={three:[],images:0,polygons:0,clears:0,positions:[]};
  const ctx={clearRect(){calls.clears++;},save(){},restore(){},translate(x,y){calls.positions.push([x,y]);},rotate(){},drawImage(){calls.images++;},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){calls.polygons++;},arc(){},setTransform(){}};
  const canvas={width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({width:1920,height:1080})};
  const menu={classList:{contains:()=>menuHidden}};
  const document={get hidden(){return hidden;},getElementById:id=>id==='menu'?menu:id==='menuDecor'?canvas:null,documentElement:{classList:{contains:()=>false}}};
  const math=Object.create(Math);math.random=()=>{randomCalls++;return .5;};
  const window={devicePixelRatio:1,addEventListener(){}};
  if(renderer)window.Galaxy3D={requested,active:false,menu(context,now){assert.equal(context,ctx);calls.three.push(now);return this.active;}};
  class TrackedArray extends Array{static from(input,map){allocations.push(input.length);return Array.from(input,map);}}
  const c=vm.createContext({window,document,navigator:{userAgent:'Desktop'},performance:{now:()=>time},Math:math,Array:TrackedArray,Image:class{constructor(){this.complete=true;this.naturalWidth=this.naturalHeight=256;}set src(url){urls.push(url);}},matchMedia:query=>({matches:query.includes('reduced-motion')?reduced:mobile}),setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>{frame=fn;return 1;}});
  vm.runInContext(source,c,{filename:'menu-decor.js'});
  return {urls,calls,window,allocations,get randomCalls(){return randomCalls;},hidePage:value=>{hidden=value;},hideMenu:value=>{menuHidden=value;},tick(now){time=now;const callback=frame;frame=null;assert.equal(typeof callback,'function');callback(now);assert.equal(typeof frame,'function','the next animation frame stays scheduled');}};
}
for(const options of [{},{mobile:true},{reduced:true}]){
  const f=fixture({...options,renderer:true,requested:true});
  assert.equal(f.urls.length,0,'requested 3D does not download invisible 2D sprite backups');
  assert.equal(f.randomCalls,0,'requested 3D does not initialize legacy meteors or particles');
  assert.deepEqual(f.allocations,[0],'requested 3D does not allocate an invisible legacy particle pool');
  f.tick(1000);f.tick(1016);f.tick(options.reduced?1101:options.mobile?1043:1034);
  assert.equal(f.calls.three.length,2,'the existing desktop/mobile/reduced-motion paint cadence is preserved');
  assert.equal(f.calls.images,0,'3D loading does not draw a legacy sprite');
  assert.equal(f.calls.polygons,0,'3D loading does not draw legacy fragments');
  f.window.Galaxy3D.active=true;f.tick(1500);
  assert.equal(f.calls.three.at(-1),1500,'3D receives the current animation clock when ready');
  assert.equal(f.randomCalls,0,'no invisible collisions run behind the 3D menu');
  const count=f.calls.three.length;f.hideMenu(true);f.tick(1600);f.hideMenu(false);f.hidePage(true);f.tick(1800);
  assert.equal(f.calls.three.length,count,'hidden menu and background page still skip painting');
  f.hidePage(false);f.tick(2000);assert.equal(f.calls.three.at(-1),2000,'returning from the background uses the current time without a catch-up simulation');
}
for(const renderer of [false,true]){
  const f=fixture({renderer,requested:false});
  assert.equal(f.urls.length,6,'the legacy page still loads its six authored sprites');
  assert.deepEqual(f.allocations,[72],'the desktop legacy particle pool keeps its authored capacity');
  assert.equal(new Set(f.urls).size,6);assert.ok(f.randomCalls>0);
  f.tick(1000);assert.equal(f.calls.images,5,'desktop fallback draws its five initial meteors');
  const initializationCalls=f.randomCalls;f.tick(1034);
  assert.equal(f.calls.images,10,'fallback keeps painting the same sprites');
  assert.ok(f.randomCalls>initializationCalls,'legacy meteor collisions still emit their original fragments');
  assert.ok(f.calls.polygons>0,'fallback particles remain visible');
  assert.notDeepEqual(f.calls.positions.slice(0,5),f.calls.positions.slice(-5),'legacy meteors still advance instead of becoming a static picture');
}
console.log('Menu resources OK: no legacy requests, allocations or hidden simulation in requested 3D; unchanged desktop/mobile/reduced-motion cadence, loading/visibility behavior and working legacy meteors/fragments.');
