'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/pwa.js','utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const drain=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture({visible=true,existing=false}={}){
  let menuVisible=visible,resolveGraphics,resolveUpdate,now=1000000,observer;
  const windowEvents={},workerEvents={},documentEvents={},idle=[],messages=[],calls={register:0,updates:0,reloads:0},timers=new Map();let timer=0;
  const graphics=new Promise(r=>resolveGraphics=r);
  const controller=version=>({version,scriptURL:'https://game.example/GALAXY3D/sw.js?v='+version,postMessage(message,ports){messages.push(clone(message));if(message.type==='resource-version')ports[0].deliver({version});}});
  const sw={controller:existing?controller('TEST'):null,addEventListener:(name,fn)=>workerEvents[name]=fn,register:async()=>{calls.register++;return reg;},getRegistration:async()=>reg};
  const reg={update:()=>{calls.updates++;return new Promise(r=>resolveUpdate=r);}};
  class Channel{constructor(){this.port1={close(){},onmessage:null};this.port2={deliver:data=>queueMicrotask(()=>this.port1.onmessage?.({data}))};}}
  class Clock extends Date{static now(){return now;}}
  const menu={classList:{contains:()=>!menuVisible}};
  const document={hidden:false,documentElement:{classList:{contains:()=>false}},getElementById:id=>id==='menu'?menu:null,addEventListener:(name,fn)=>documentEvents[name]=fn};
  const window={addEventListener:(name,fn)=>windowEvents[name]=fn,matchMedia:()=>({matches:false}),GALAXY_BUILD:{version:'TEST',versioned:path=>path+'?v=TEST'},GalaxyGraphicsLoader:{ready:graphics}};
  const c=vm.createContext({window,document,navigator:{serviceWorker:sw,userAgent:'desktop'},location:{origin:'https://game.example',href:'https://game.example/GALAXY3D/',reload:()=>calls.reloads++},URL,Promise,Date:Clock,MessageChannel:Channel,MutationObserver:class{constructor(fn){observer=fn;}observe(){}},console,performance:{getEntriesByType:()=>[
    'https://game.example/GALAXY3D/game.js?v=TEST','https://game.example/GALAXY3D/assets/models/nave.glb?v=TEST','https://game.example/GALAXY3D/assets/sonido/musica.mp3','https://game.example/GALAXY3D/api/test','https://other.example/file.png','https://game.example/outside.js'
  ].map(name=>({name}))},requestIdleCallback:fn=>{idle.push(fn);return idle.length;},setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id),alert(){}});
  vm.runInContext(source,c);
  return {c,sw,controller,calls,messages,windowEvents,workerEvents,documentEvents,resolveGraphics,resolveUpdate:()=>resolveUpdate?.(),tick(ms){now+=ms;},menu(value){menuVisible=value;observer?.();},runIdle(){while(idle.length)idle.shift()();}};
}
(async()=>{
  const f=fixture(),load=f.windowEvents.load();await drain();f.runIdle();assert.equal(f.calls.register,0,'graphics preparation takes priority over offline maintenance');
  f.resolveGraphics(true);await load;assert.equal(f.calls.register,0,'registration waits for menu idle time');f.runIdle();await drain();assert.equal(f.calls.register,1);assert.equal(f.calls.updates,0,'register is not followed by a redundant update request');
  f.sw.controller=f.controller('TEST');f.workerEvents.controllerchange();await drain();f.runIdle();await drain();assert.equal(f.calls.reloads,0,'first matching worker claim does not decode and prepare the whole game a second time');
  const warm=f.messages.find(m=>m.type==='cache-loaded');assert.deepEqual(warm.urls,['https://game.example/GALAXY3D/game.js?v=TEST','https://game.example/GALAXY3D/assets/models/nave.glb?v=TEST'],'warm only already loaded, same-scope resources and no media/API');
  f.menu(false);f.windowEvents.focus();f.runIdle();await drain();assert.equal(f.calls.updates,0);assert.equal(f.messages.at(-1).idle,false,'entering a round pauses background cache copies');
  f.sw.controller=f.controller('NEXT');f.workerEvents.controllerchange();await drain();assert.equal(f.calls.reloads,0,'an update cannot reload an active round');f.menu(true);assert.equal(f.calls.reloads,1,'deferred update reloads at the main menu');
  const hidden=fixture({visible:false}),hiddenLoad=hidden.windowEvents.load();hidden.resolveGraphics(true);await hiddenLoad;hidden.runIdle();await drain();assert.equal(hidden.calls.register,0);hidden.menu(true);hidden.runIdle();await drain();assert.equal(hidden.calls.register,1,'a short menu visit can defer registration until after the round');
  const update=fixture({existing:true}),updateLoad=update.windowEvents.load();update.resolveGraphics(true);await updateLoad;update.runIdle();await drain();update.tick(60001);update.windowEvents.focus();update.windowEvents.focus();await drain();assert.equal(update.calls.updates,1,'concurrent focus notifications share one update');update.resolveUpdate();await drain();update.windowEvents.focus();await drain();assert.equal(update.calls.updates,1,'focus storms are bounded within the update window');
  const mismatch=fixture(),mismatchLoad=mismatch.windowEvents.load();mismatch.resolveGraphics(true);await mismatchLoad;mismatch.runIdle();await drain();mismatch.sw.controller=mismatch.controller('ACTUAL');mismatch.workerEvents.controllerchange();await drain();assert.equal(mismatch.calls.reloads,1,'a genuinely different first worker still refreshes an old document');
  console.log('PWA resource idle OK: graphics-first registration, no duplicate first-claim reload, same-scope loaded resources, match pause, deferred updates and deduplicated focus refresh.');
})().catch(error=>{console.error(error);process.exitCode=1;});
