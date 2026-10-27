'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/sw.js','utf8');
const ORIGIN='https://galaxy.example',SCOPE=ORIGIN+'/GALAXY3D/';
const SHARED='galaxy3d-assets-shared-v1',SHELL='galaxy3d-shell-TEST';

function createHarness(){
  const stores=new Map(),listeners={},calls=[],writes=[],warnings=[];
  const h={stores,listeners,calls,writes,warnings,live:new Set(['one','two','three']),claims:0,skips:0,rejectPut:null,rejectOpen:null,rejectMatch:null,network:async()=>new Response('network')};
  const href=request=>typeof request==='string'?new URL(request,SCOPE).href:request.url;
  function cache(name){
    if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);
    return {
      async put(request,response){
        const url=href(request);writes.push({name,url,status:response.status});
        if(response.status===206)throw new TypeError('A partial response cannot enter CacheStorage');
        if(h.rejectPut&&h.rejectPut(name,url))throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});
        entries.set(url,response.clone());
      },
      async match(request,options={}){
        if(h.rejectMatch&&h.rejectMatch(name))throw new Error('match unavailable');
        const url=href(request);
        for(const [key,value] of entries)if(key===url||(options.ignoreSearch&&new URL(key).pathname===new URL(url).pathname))return value.clone();
      },
      async keys(){return [...entries.keys()].map(url=>new Request(url));}
    };
  }
  h.cache=cache;
  h.seed=(name,path,body,headers={},status=200)=>{cache(name);stores.get(name).set(new URL(path,SCOPE).href,new Response(body,{status,headers}));};
  const self={location:{origin:ORIGIN},registration:{scope:SCOPE},addEventListener:(name,handler)=>listeners[name]=handler,
    skipWaiting:async()=>{h.skips++;},clients:{claim:async()=>{h.claims++;},matchAll:async()=>[...h.live].map(id=>({id}))}};
  vm.runInNewContext(source,{self,URL,Request,Response,Headers,console:{warn:(...args)=>warnings.push(args)},
    importScripts:()=>{self.GALAXY_BUILD={version:'TEST'};},
    caches:{open:async name=>{if(h.rejectOpen&&h.rejectOpen(name))throw new Error('storage unavailable');return cache(name);},keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name)},
    fetch:async(request,options)=>{
      const req=typeof request==='string'?new Request(new URL(request,SCOPE)):request;
      const call={url:req.url,cache:options&&options.cache,headers:new Headers(req.headers)};calls.push(call);
      return h.network(req,options||{},call);
    }});
  h.event=async name=>{let pending;listeners[name]({waitUntil:task=>{pending=task;}});return pending;};
  h.request=(path,options={})=>{
    const {navigate,destination,...init}=options,request=new Request(new URL(path,SCOPE),init);let pending;
    if(navigate)Object.defineProperty(request,'mode',{value:'navigate'});
    if(destination)Object.defineProperty(request,'destination',{value:destination});
    listeners.fetch({request,respondWith:task=>{pending=task;}});return pending;
  };
  h.message=(data,id='one',extra={})=>{
    let pending;listeners.message({data,source:id?{id,url:SCOPE+'index.html'}:null,waitUntil:task=>{pending=task;},...extra});return pending||Promise.resolve();
  };
  return h;
}
const body=async response=>response&&response.text();
const turn=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

async function installAndActivate(){
  const h=createHarness();let active=0,peak=0;
  h.network=async()=>{active++;peak=Math.max(peak,active);await turn();active--;return new Response('shell');};
  await h.event('install');
  assert.equal(h.calls.length,3,'install only fetches index, build version and config');
  assert.equal(peak,3);assert.equal(h.skips,1);
  assert.deepEqual(h.calls.map(call=>new URL(call.url).pathname).sort(),['/GALAXY3D/build-version.js','/GALAXY3D/config.js','/GALAXY3D/index.html']);
  assert.ok(h.calls.every(call=>call.cache==='no-cache'));
  assert.equal(h.stores.get(SHELL).size,3);assert.ok(!h.calls.some(call=>call.url.endsWith('/GALAXY3D/')),'the root and index must not download twice');
  const broken=createHarness();broken.network=async request=>new Response('missing',{status:request.url.endsWith('index.html')?404:200});
  await assert.rejects(broken.event('install'),/index.html/);assert.equal(broken.skips,0);

  for(const name of ['galaxy3d-shell-oldest','galaxy3d-assets-oldest','galaxy3d-shell-previous','galaxy3d-assets-previous',SHARED,'other-app'])h.seed(name,'placeholder','keep');
  const writes=h.writes.length;await h.event('activate');
  assert.deepEqual([...h.stores.keys()].sort(),[SHELL,SHARED,'galaxy3d-shell-previous','galaxy3d-assets-previous','other-app'].sort());
  assert.equal(h.writes.length,writes,'activation must not copy large legacy models');assert.equal(h.claims,1);
}

async function conditionalAssets(){
  const h=createHarness(),path='assets/models/nave.glb',canonical=SCOPE+path;
  h.seed(SHARED,path,'original',{'ETag':'"original"'});
  h.network=async(request,options)=>{
    assert.equal(request.headers.get('If-None-Match'),'"original"');
    assert.equal(options.cache,'no-store','the explicit validator must reach the origin');
    return new Response(null,{status:304});
  };
  const unchanged=await h.request(path+'?v=NEXT');assert.equal(unchanged.status,200);assert.equal(await body(unchanged),'original');
  assert.equal(h.calls[0].url,canonical+'?v=NEXT','keep the real URL for the HTTP cache');
  assert.equal(h.stores.get(SHARED).size,1,'a new v shares the same large body');
  h.network=async()=>new Response('changed',{'headers':{'ETag':'"changed"'}});
  assert.equal(await body(await h.request(path+'?v=LATER')),'changed');
  assert.equal(await body(await (await h.cache(SHARED)).match(canonical)),'changed');
  h.network=async request=>{assert.equal(request.headers.get('If-None-Match'),'"changed"');throw Error('offline');};
  assert.equal(await body(await h.request(path+'?v=OFFLINE')),'changed');
  h.network=async()=>new Response('bad gateway',{status:503});
  assert.equal(await body(await h.request(path+'?v=SERVER-DOWN')),'changed');
  assert.equal(h.stores.get(SHARED).size,1);

  h.seed(SHARED,'assets/models/paint.png?skin=blue','blue',{'Last-Modified':'Tue, 27 Oct 2026 10:00:00 GMT'});
  h.network=async request=>{assert.equal(request.headers.get('If-Modified-Since'),'Tue, 27 Oct 2026 10:00:00 GMT');assert.equal(request.headers.get('If-None-Match'),null);return new Response(null,{status:304});};
  assert.equal(await body(await h.request('assets/models/paint.png?skin=blue&v=NEW')),'blue');
  h.network=async request=>{assert.equal(request.headers.get('If-Modified-Since'),null);return new Response('red');};
  assert.equal(await body(await h.request('assets/models/paint.png?skin=red&v=NEW')),'red','only v can be ignored; skin remains a different asset');
  assert.equal(await body(await h.cache(SHARED).match(SCOPE+'assets/models/paint.png?skin=blue')),'blue');

  const noBody=createHarness();let attempt=0;
  noBody.network=async(request,options)=>++attempt===1?new Response(null,{status:304}):(assert.equal(options.cache,'reload'),new Response('recovered'));
  assert.equal(await body(await noBody.request('assets/models/new.glb?v=NEW')),'recovered');assert.equal(attempt,2);
  const stillMissing=createHarness();stillMissing.network=async()=>new Response(null,{status:304});
  await assert.rejects(stillMissing.request('assets/models/missing.glb'),/sin cuerpo/);assert.equal(stillMissing.calls.length,2);
  const missing=createHarness();missing.network=async()=>{throw Error('offline');};
  await assert.rejects(missing.request('assets/models/missing.png'),/offline/);

  const quota=createHarness();quota.rejectPut=()=>true;quota.network=async()=>new Response('fresh despite quota');
  assert.equal(await body(await quota.request('assets/models/nave.glb')),'fresh despite quota','CacheStorage quota must not fail a successful game resource');
  for(const failure of ['rejectOpen','rejectMatch']){
    const unavailable=createHarness();unavailable.seed(SHARED,'assets/models/nave.glb','inaccessible');unavailable.seed(SHELL,'game.js?v=TEST','inaccessible');
    unavailable[failure]=()=>true;unavailable.network=async()=>new Response('network survives');
    for(const path of ['assets/models/nave.glb','game.js?v=TEST','index.html'])assert.equal(await body(await unavailable.request(path)),'network survives',failure+' must not prevent a successful network request');
  }
}

async function deduplicationAndMigration(){
  const h=createHarness(),gate=deferred();h.network=async()=>{await gate.promise;return new Response('one downloaded body');};
  const first=h.request('assets/models/nave.glb?v=ONE'),second=h.request('assets/models/nave.glb?v=TWO');
  await turn();assert.equal(h.calls.length,1,'concurrent aliases must share the same transfer');gate.resolve();
  const responses=await Promise.all([first,second]);assert.notEqual(responses[0],responses[1]);
  assert.deepEqual(await Promise.all(responses.map(body)),['one downloaded body','one downloaded body'],'each fetch event receives its own stream');

  const old=createHarness();old.seed('galaxy3d-assets-OLD','assets/models/old.glb?v=OLD&skin=blue','legacy model',{'ETag':'"old"'});
  old.seed('galaxy3d-shell-OLDER','assets/models/paint.png?v=OLDER','legacy paint');
  old.seed('galaxy3d-shell-OLDER','game.js?v=OLDER','legacy code');
  old.network=async()=>{throw Error('offline');};
  const writes=old.writes.length;assert.equal(old.stores.has(SHARED),false,'legacy assets are not copied on worker startup');
  assert.equal(await body(await old.request('assets/models/old.glb?v=TEST&skin=blue')),'legacy model');
  assert.equal(await body(await old.request('assets/models/paint.png?v=TEST')),'legacy paint');
  assert.equal(old.writes.length-writes,2,'only requested assets migrate');
  assert.ok(old.stores.get(SHARED).has(SCOPE+'assets/models/old.glb?skin=blue'));
  assert.ok(![...old.stores.get(SHARED).keys()].some(key=>key.includes('game.js')));
  await assert.rejects(old.request('assets/models/old.glb?v=TEST&skin=red'),/offline/);
  await assert.rejects(old.request('game.js?v=TEST'),/offline/,'legacy JS must never alias a different version');
  old.rejectPut=()=>true;old.seed('galaxy3d-assets-OLD','assets/models/quota.glb?v=OLD','legacy quota');
  // A cache index is a snapshot: use a distinct cache as a genuine earlier build would.
  old.seed('galaxy3d-assets-OLD-2','assets/models/quota.glb?v=OLD','legacy quota');
  assert.equal(await body(await old.request('assets/models/quota.glb?v=TEST')),'legacy quota','failed lazy migration retains the old cache body');
}

async function exactCodeAndFreshEntries(){
  const h=createHarness();h.seed(SHELL,'game.js?v=TEST','current code');h.seed('galaxy3d-shell-OLD','game.js?v=OLD','old code');
  h.network=async()=>new Response('network code');
  assert.equal(await body(await h.request('game.js?v=TEST')),'current code');assert.equal(h.calls.length,0);
  assert.equal(await body(await h.request('game.js?v=OLD')),'old code');assert.equal(h.calls.length,0,'an already-open old tab keeps its exact cached code while online');
  assert.equal(await body(await h.request('game.js?v=TEST&mode=other')),'network code','other query parameters remain part of the code identity');
  for(const path of ['index.html?v=TEST','build-version.js?v=TEST','config.js?v=TEST','sw.js?v=TEST']){
    h.seed(SHELL,path,'stale entry');assert.equal(await body(await h.request(path)),'network code');assert.equal(h.calls.at(-1).cache,'no-cache');
  }
  h.seed(SHELL,'index.html','offline index');h.network=async()=>{throw Error('offline');};
  assert.equal(await body(await h.request('./?v=TEST',{navigate:true})),'offline index');
  assert.equal(await body(await h.request('game.js?v=OLD')),'old code');
  await assert.rejects(h.request('game.js?v=UNKNOWN'),/offline/);
  assert.equal(h.request(ORIGIN+'/another-app/game.js?v=TEST'),undefined,'do not claim resources outside this Pages project');
  assert.equal(h.request('https://elsewhere.example/GALAXY3D/assets/test.png'),undefined);
}

async function ranges(){
  const h=createHarness(),path='assets/audio/music.mp3';h.seed(SHARED,path,'0123456789',{'Content-Type':'audio/mpeg'});
  h.network=async()=>new Response('net',{status:206,headers:{'Content-Range':'bytes 0-2/10'}});
  const before=h.writes.length;const online=await h.request(path,{headers:{Range:'bytes=0-2'}});
  assert.equal(online.status,206);assert.equal(await body(online),'net');assert.equal(h.writes.length,before,'partial responses must never be written to CacheStorage');
  h.network=async()=>{throw Error('offline');};
  for(const [range,text,contentRange] of [['bytes=0-3','0123','bytes 0-3/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-3','789','bytes 7-9/10'],['bytes=8-20','89','bytes 8-9/10']]){
    const response=await h.request(path+'?v=NEW',{headers:{Range:range}});assert.equal(response.status,206);assert.equal(await body(response),text);assert.equal(response.headers.get('Content-Range'),contentRange);assert.equal(response.headers.get('Content-Length'),String(text.length));
  }
  for(const range of ['bytes=20-30','bytes=8-4','bytes=-0'])assert.equal((await h.request(path,{headers:{Range:range}})).status,416);
  const multi=await h.request(path,{headers:{Range:'bytes=0-1,4-5'}});assert.equal(multi.status,200);assert.equal(await body(multi),'0123456789','unsupported multipart ranges safely fall back to the complete cached response');
  assert.equal(h.writes.length,before);
}

async function idleWarmMessages(){
  const h=createHarness();let version;await h.message({type:'resource-version'},null,{ports:[{postMessage:value=>{version=value;}}]});assert.equal(version.version,'TEST');
  const invalid=['https://elsewhere.example/GALAXY3D/assets/a.glb','/other/assets/a.glb','api/state','sw.js?v=TEST','build-version.js?v=TEST','config.js?v=TEST','assets/audio/music.mp3','assets/audio/hit.wav','game.js?v=OLD','assets/%2e%2e/secret.png'];
  await h.message({type:'cache-loaded',urls:[...invalid,'assets/models/a.glb?v=TEST','game.js?v=TEST','assets/models/a.glb?v=OTHER']});
  assert.equal(h.calls.length,0,'a known non-idle page may announce loaded files without downloading');
  await h.message({type:'resource-idle',idle:true},'two');assert.equal(h.calls.length,0,'another idle page cannot override a page preparing or playing a match');
  await h.message({type:'resource-idle',idle:true});
  assert.deepEqual(h.calls.map(call=>new URL(call.url).pathname),['/GALAXY3D/assets/models/a.glb','/GALAXY3D/game.js']);
  assert.ok(h.calls.every(call=>call.cache==='force-cache'),'already loaded files reuse the HTTP cache');
  await h.message({type:'cache-loaded',urls:['assets/models/ignored.glb']},null);assert.equal(h.calls.length,2,'messages without a client source cannot request downloads');
  await h.message({type:'cache-loaded',urls:['assets/models/outside.glb']},'one',{source:{id:'one',url:ORIGIN+'/another-app/'}});assert.equal(h.calls.length,2);

  const serial=createHarness(),gate=deferred();let active=0,peak=0,seen=0;
  serial.network=async()=>{active++;peak=Math.max(peak,active);if(++seen===1)await gate.promise;else await turn();active--;return new Response('loaded');};
  await serial.message({type:'cache-loaded',urls:['assets/models/one.glb','assets/models/two.glb','assets/models/three.glb']});
  const warming=serial.message({type:'resource-idle',idle:true});await turn();assert.equal(serial.calls.length,1);
  const paused=serial.message({type:'resource-idle',idle:false});gate.resolve();await Promise.all([warming,paused]);
  assert.equal(serial.calls.length,1,'idle:false pauses every pending optional request');
  await serial.message({type:'resource-idle',idle:true});assert.equal(serial.calls.length,3);assert.equal(peak,1,'optional cache population is always serial');

  const closed=createHarness();await closed.message({type:'cache-loaded',urls:['assets/models/closed.glb']},'one');
  await closed.message({type:'resource-idle',idle:false},'two');closed.live.delete('two');await closed.message({type:'resource-idle',idle:true},'one');assert.equal(closed.calls.length,1,'closed active tabs cannot pause optional work forever');

  const bounded=createHarness();await bounded.message({type:'resource-idle',idle:true});
  await bounded.message({type:'cache-loaded',urls:Array.from({length:150},(_,i)=>'assets/icons/'+i+'.png')});
  await bounded.message({type:'cache-loaded',urls:['assets/icons/overflow.png']});assert.equal(bounded.calls.length,128,'the queue has a total cap, not just a per-message limit');
  const cached=createHarness();cached.seed(SHARED,'assets/models/nave.glb','validated');cached.network=async()=>{throw Error('must not replace a validated asset');};
  await cached.message({type:'cache-loaded',urls:['assets/models/nave.glb?v=TEST']});await cached.message({type:'resource-idle',idle:true});assert.equal(cached.calls.length,0);
  const offline=createHarness(),resources=[
    'net-protocol.js','collision-profiles.js','menu-ufo.js','projectile-lighting.js','startup-preparation.js',
    'assets/models/asteroidemediano.glb','assets/models/Rocky_Asteroid_5.glb','assets/models/meteorito3.glb'
  ];
  const fixtures=new Map(resources.map((path,index)=>[SCOPE+path+'?v=TEST','offline fixture '+index+': '+path]));
  offline.network=async request=>{assert.ok(fixtures.has(request.url),'only loaded fixtures may be warmed');return new Response(fixtures.get(request.url));};
  await offline.message({type:'cache-loaded',urls:[...fixtures.keys()]});assert.equal(offline.calls.length,0);
  await offline.message({type:'resource-idle',idle:true});assert.equal(offline.calls.length,resources.length);
  offline.network=async()=>{throw Error('offline');};
  for(const path of resources){
    const expected=fixtures.get(SCOPE+path+'?v=TEST');
    assert.equal(await body(await offline.request(path+'?v=TEST')),expected,path+' remains available offline after idle warming');
    if(path.endsWith('.js'))await assert.rejects(offline.request(path+'?v=OTHER'),/offline/,'offline code must keep its exact build version: '+path);
    else assert.equal(await body(await offline.request(path+'?v=OTHER')),expected,'the correct asteroid role remains available across build queries: '+path);
  }
}

async function main(){
  await installAndActivate();await conditionalAssets();await deduplicationAndMigration();await exactCodeAndFreshEntries();await ranges();await idleWarmMessages();
  console.log('Resource cache OK: minimal install, persistent conditional assets/304, exact code versions, lazy legacy migration, offline ranges, quota fallback and bounded serial idle warm.');
}
module.exports={createHarness,SHARED,SHELL,SCOPE};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
