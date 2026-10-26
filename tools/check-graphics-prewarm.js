'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const render=fs.readFileSync('docs/render-3d.js','utf8').replaceAll('\r\n','\n');
function extract(name){const a=render.indexOf('    async function '+name+'('),b=render.indexOf('\n    ',a+5);assert.ok(a>=0);let depth=0,start=render.indexOf('{',a);for(let i=start;i<render.length;i++){if(render[i]==='{')depth++;if(render[i]==='}'&&--depth===0)return render.slice(a,i+1);}throw Error(name);}
async function gpuCase({legacy=false,lost=false,failed=false}={}){
  let polls=0,frames=0,deleted=0,flush=0,now=0;
  const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,TIMEOUT_EXPIRED:5,
    fenceSync:legacy?undefined:()=>({}),flush:()=>flush++,isContextLost:()=>lost,
    clientWaitSync:()=>{polls++;return failed?4:polls<3?5:3;},deleteSync:()=>deleted++};
  const c=vm.createContext({renderer:{getContext:()=>gl},performance:{now:()=>now},requestAnimationFrame:fn=>{frames++;now+=16;queueMicrotask(()=>fn(now));}});
  vm.runInContext(extract('waitForGpu'),c);if(lost)await assert.rejects(c.waitForGpu());else await c.waitForGpu();
  assert.equal(deleted,legacy?0:1);if(!lost)assert.ok(frames>=1);if(!legacy)assert.equal(flush,1);
}
(async()=>{
  for(const options of [{},{legacy:true},{lost:true},{failed:true}])await gpuCase(options);
  const calls=[],stats={flush:0,compile:0,settled:false};let finish;
  const api={begin:(c,t,s)=>calls.push(['begin',s]),ship:(...a)=>calls.push(['ship',...a]),rocket:(...a)=>calls.push(['rocket',...a]),bolt:(...a)=>calls.push(['bolt',...a]),rock:(...a)=>calls.push(['rock',...a]),pickup:(...a)=>calls.push(['pickup',...a]),ufo(){},menuUfo(){},flush:()=>stats.flush++};
  const ctx=vm.createContext({W:1920,H:1080,scene:{},camera:{},api,bolts:4,boltMesh:{},updateEffects(){},document:{createElement:()=>({getContext:()=>({setTransform(){}})})},renderer:{info:{programs:[]},compile:()=>{stats.compile++;}},requestAnimationFrame:fn=>queueMicrotask(fn),waitForGpu:()=>new Promise(resolve=>{finish=()=>{stats.settled=true;resolve();};})});
  vm.runInContext(extract('warmScene'),ctx);let complete=false;const warm=ctx.warmScene(1280,720).then(()=>{complete=true;});
  for(let i=0;i<30;i++)await Promise.resolve();assert.equal(stats.compile,4);assert.equal(stats.flush,4);assert.equal(complete,false,'readiness waits for GPU completion, not just file loading');
  finish();await warm;assert.equal(stats.settled,true);
  assert.ok(calls.some(c=>c[0]==='ship'&&c[6]===.4),'transparent material variants are prepared');
  assert.ok(calls.filter(c=>c[0]==='bolt').length>=4);assert.ok(calls.filter(c=>c[0]==='pickup').length>=9);
  assert.ok(calls.some(c=>c[0]==='begin'&&c[1].fx.some(e=>e.kind==='explosion')));
  const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n'),a=game.indexOf('  function prepareGameAssets('),b=game.indexOf('\n  function warmGameAssetsWhenIdle(',a);assert.ok(a>=0&&b>a);
  let modelsReady,gpuReady;const models=new Promise(r=>modelsReady=r),gpu=new Promise(r=>gpuReady=r);
  const assets=vm.createContext({gameAssetsReady:false,gameAssetsPromise:null,Promise,imageDecodePromises:{},document:{fonts:{load:()=>Promise.resolve()}},updateCanvasResolution(){},warmRendererCaches(){},warmOnlineStartCaches(){},canvas:{width:1280,height:720},window:{Galaxy3D:{ready:models,prepareMatch:()=>gpu}}});
  vm.runInContext(game.slice(a,b),assets);const pending=assets.prepareGameAssets();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(assets.gameAssetsReady,false);modelsReady({ok:true});for(let i=0;i<10;i++)await Promise.resolve();assert.equal(assets.gameAssetsReady,false);gpuReady({});await pending;assert.equal(assets.gameAssetsReady,true);
  const handlers={},cached=new Set();let active=0,peak=0,downloads=0,waiting;
  const cache={put:async request=>cached.add(new URL(request.url).pathname),match:async path=>cached.has(new URL(path,'https://test.invalid/GALAXY3D/').pathname)};
  const worker=vm.createContext({URL,Request,console,importScripts(){},caches:{open:async()=>cache},fetch:async()=>{active++;peak=Math.max(peak,active);downloads++;await new Promise(setImmediate);active--;return {ok:true,clone(){return this;}};},self:{GALAXY_BUILD:{version:'test'},registration:{scope:'https://test.invalid/GALAXY3D/'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{waiting=true;}}});
  vm.runInContext(fs.readFileSync('docs/sw.js','utf8'),worker);let installation;handlers.install({waitUntil:task=>installation=task});await installation;
  assert.equal(peak,3,'background cache downloads are bounded');assert.equal(downloads,cached.size);assert.ok(cached.has('/GALAXY3D/index.html'));assert.equal(waiting,true);
  console.log('Graphics prewarm OK: shader/FX variants, GPU fence/legacy/failure cleanup, target size, loader readiness and offline installation limited to three simultaneous downloads.');
})().catch(error=>{console.error(error);process.exitCode=1;});
