importScripts('./build-version.js');
const VERSION=String(self.GALAXY_BUILD&&self.GALAXY_BUILD.version||'dev');
const SHELL_CACHE=`galaxy3d-shell-${VERSION}`;
const ASSET_CACHE='galaxy3d-assets-shared-v1';
const SCOPE=new URL(self.registration.scope);
const SHELL_FILES=[
  './index.html',
  './build-version.js?v='+encodeURIComponent(VERSION),
  './config.js?v='+encodeURIComponent(VERSION)
];
// Retired art is removed from older offline copies as well as from the repository.
const RETIRED_2D_ASSETS=new Set(["asteroide1.png","asteroide2.png","asteroide3.png","asteroide5.png","asteroide6.png","asteroidegrande_270.png","asteroidemediano.png","dos.png","ovni.png","bengalasnave.png","coete.png","coeteA.png","coeteB.png","coeteC.png","coeteD.png","navemira.png","navemiraA.png","navemiraB.png","navemiraC.png","navemiraD.png","coete1a.png","coete1af.png","coete2a.png","coete2f.png","coete2af.png","coete3a.png","coete3f.png","coete3af.png","coete4a.png","coete4f.png","coete4af.png","INTRO.png","INTRO_MOBILE.png"]);
const assetFlights=new Map(),legacyIndexes=new Map();
const idleClients=new Map(),warmSeen=new Set();
let warmTask=null;

function inScope(url){return url.origin===SCOPE.origin&&url.pathname.startsWith(SCOPE.pathname);}
function isAsset(url){
  if(!inScope(url)||!url.pathname.startsWith(SCOPE.pathname+'assets/'))return false;
  try{const path=decodeURIComponent(url.pathname);return !path.includes('\\')&&!path.split('/').includes('..');}catch(_){return false;}
}
function canonicalAsset(request){const url=new URL(request.url);url.searchParams.delete('v');return new Request(url.href);}
function isCode(request,url){return request.mode==='navigate'||['script','style','document','manifest'].includes(request.destination)||/\.(?:js|css|html|webmanifest)$/i.test(url.pathname);}
function isFreshEntry(request,url){return request.mode==='navigate'||/\.(?:html|webmanifest)$/i.test(url.pathname)||/(?:^|\/)(?:build-version|config|sw)\.js$/i.test(url.pathname);}
function currentVersion(url){return url.searchParams.get('v')===VERSION;}
async function openCache(name){try{return await caches.open(name);}catch(_){return null;}}
async function cacheNames(){try{return await caches.keys();}catch(_){return [];}}
async function cachedResponse(cache,request){try{return cache?await cache.match(request):null;}catch(_){return null;}}
async function putSafely(cache,request,response){
  if(!cache||!response||response.status!==200)return false;
  try{await cache.put(request,response.clone());return true;}catch(error){console.warn('[PWA] Cache no disponible:',new URL(request.url).pathname,error&&error.name||'');return false;}
}
async function cacheShellFile(cache,path){
  const request=new Request(new URL(path,SCOPE).href);
  for(let attempt=0;attempt<2;attempt++){
    try{const response=await fetch(request,{cache:'no-cache'});if(response&&response.status===200)return await putSafely(cache,request,response);}catch(_){}
  }
  return false;
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE);let next=0;
    // Only the entry documents are installed. Models are already requested by the game.
    await Promise.all(Array.from({length:3},async()=>{while(next<SHELL_FILES.length)await cacheShellFile(cache,SHELL_FILES[next++]);}));
    if(!await cache.match(new Request(new URL('./index.html',SCOPE).href)))throw new Error('[PWA] index.html no pudo precachearse');
    await self.skipWaiting();
  })());
});
async function purgeRetiredArt(names){
  for(const name of names){
    if(!name.startsWith('galaxy3d-'))continue;
    const cache=await openCache(name);if(!cache)continue;
    try{
      for(const request of await cache.keys()){
        const url=new URL(request.url);
        if(inScope(url)&&url.pathname.startsWith(SCOPE.pathname+'assets/sprites/')&&RETIRED_2D_ASSETS.has(decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/')+1)))){
          try{await cache.delete(request);}catch(_){}
        }
      }
    }catch(_){}
  }
}
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await cacheNames(),keep=new Set([SHELL_CACHE,ASSET_CACHE]);
    // Leave one previous build available to tabs still running its code. Assets migrate lazily.
    for(const prefix of ['galaxy3d-shell-','galaxy3d-assets-']){
      const previous=keys.filter(key=>key.startsWith(prefix)&&!keep.has(key)).at(-1);if(previous)keep.add(previous);
    }
    await Promise.all(keys.filter(key=>key.startsWith('galaxy3d-')&&!keep.has(key)).map(async key=>{try{await caches.delete(key);}catch(_){}}));
    await purgeRetiredArt([...keep]);
    await self.clients.claim();
  })());
});
async function exactCode(request){
  const current=await cachedResponse(await openCache(SHELL_CACHE),request);if(current)return current;
  const keys=await cacheNames();
  for(const name of keys.reverse())if(name.startsWith('galaxy3d-shell-')&&name!==SHELL_CACHE){const cached=await cachedResponse(await openCache(name),request);if(cached)return cached;}
  return null;
}
async function codeResponse(request,url){
  const cache=await openCache(SHELL_CACHE);
  if(!isFreshEntry(request,url)&&url.searchParams.has('v')){
    const cached=currentVersion(url)?await cachedResponse(cache,request):await exactCode(request);if(cached)return cached;
  }
  try{
    const response=await fetch(request,{cache:'no-cache'});
    if(response&&response.status===200){await putSafely(cache,request,response);return response;}
    return await exactCode(request)||response;
  }catch(error){
    const cached=await exactCode(request);if(cached)return cached;
    if(request.mode==='navigate'&&(url.pathname===SCOPE.pathname||url.pathname===SCOPE.pathname+'index.html')){
      const index=await cachedResponse(cache,new Request(new URL('./index.html',SCOPE).href));if(index)return index;
    }
    throw error;
  }
}
async function legacyIndex(name){
  if(!legacyIndexes.has(name))legacyIndexes.set(name,(async()=>{
    const cache=await openCache(name),index=new Map();
    try{for(const request of (cache?await cache.keys():[]).reverse())if(isAsset(new URL(request.url))){const key=canonicalAsset(request).url;if(!index.has(key))index.set(key,request);}}catch(_){}
    return {cache,index};
  })());
  return legacyIndexes.get(name);
}
async function storedAsset(key){
  const cache=await openCache(ASSET_CACHE),response=await cachedResponse(cache,key);if(response&&response.status===200)return {response,shared:true};
  for(const name of (await cacheNames()).reverse()){
    if(name===ASSET_CACHE||!/^galaxy3d-(?:assets|shell)-/.test(name))continue;
    const legacy=await legacyIndex(name),alias=legacy.index.get(key.url);if(!alias)continue;
    const saved=await cachedResponse(legacy.cache,alias);if(saved&&saved.status===200)return {response:saved,shared:false};
  }
  return null;
}
async function retainLegacy(key,stored){if(stored&&!stored.shared)await putSafely(await openCache(ASSET_CACHE),key,stored.response);}
async function revalidateAsset(request,key){
  const stored=await storedAsset(key),headers=new Headers(request.headers);
  headers.delete('If-None-Match');headers.delete('If-Modified-Since');
  if(stored){
    const etag=stored.response.headers.get('ETag'),modified=stored.response.headers.get('Last-Modified');
    if(etag)headers.set('If-None-Match',etag);else if(modified)headers.set('If-Modified-Since',modified);
  }
  try{
    // The requested URL is retained for the HTTP cache. Only CacheStorage drops v.
    // Explicit validators let a new build reuse unchanged large GLBs with a 304.
    let response=await fetch(new Request(request,{headers}),{cache:headers.has('If-None-Match')||headers.has('If-Modified-Since')?'no-store':'no-cache'});
    if(response&&response.status===304&&stored){await retainLegacy(key,stored);return stored.response;}
    if(response&&response.status===304){
      headers.delete('If-None-Match');headers.delete('If-Modified-Since');
      response=await fetch(new Request(request,{headers}),{cache:'reload'});
    }
    if(response&&response.status===200){await putSafely(await openCache(ASSET_CACHE),key,response);return response;}
    if(stored){await retainLegacy(key,stored);return stored.response;}
    if(response&&response.status!==304)return response;
    throw new Error('[PWA] Recurso sin cuerpo disponible');
  }catch(error){if(stored){await retainLegacy(key,stored);return stored.response;}throw error;}
}
async function assetResponse(request){
  const key=canonicalAsset(request);
  if(!assetFlights.has(key.url)){
    const task=revalidateAsset(request,key);assetFlights.set(key.url,task);
    task.then(()=>assetFlights.delete(key.url),()=>assetFlights.delete(key.url));
  }
  return (await assetFlights.get(key.url)).clone();
}
async function cachedRange(request,cached){
  const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range')||'');
  if(!match||(!match[1]&&!match[2]))return cached;
  const buffer=await cached.arrayBuffer(),size=buffer.byteLength;
  let start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
  let end=match[1]?(match[2]?Number(match[2]):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start||(!match[1]&&Number(match[2])===0))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
  end=Math.min(end,size-1);
  const headers=new Headers(cached.headers);headers.set('Content-Range',`bytes ${start}-${end}/${size}`);headers.set('Content-Length',String(end-start+1));headers.set('Accept-Ranges','bytes');headers.delete('Content-Encoding');
  return new Response(buffer.slice(start,end+1),{status:206,headers});
}
async function rangeResponse(request){
  try{const response=await fetch(request);if(response&&response.ok)return response;throw new Error('Range no disponible');}
  catch(error){const stored=await storedAsset(canonicalAsset(request));if(stored)return cachedRange(request,stored.response);throw error;}
}
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(!inScope(url))return;
  if(isAsset(url)){event.respondWith(request.headers.has('Range')?rangeResponse(request):assetResponse(request));return;}
  if(isCode(request,url))event.respondWith(codeResponse(request,url));
});
function warmURL(raw){
  try{
    const url=new URL(raw,SCOPE);
    if(!inScope(url)||/(?:^|\/)api(?:\/|$)/i.test(url.pathname)||isFreshEntry({},url)||/\.(?:mp3|wav|ogg|m4a|mp4|webm)$/i.test(url.pathname))return null;
    if(isAsset(url)||(/\.(?:js|css)$/i.test(url.pathname)&&(currentVersion(url)||url.pathname.startsWith(SCOPE.pathname+'vendor/'))))return url;
  }catch(_){}
  return null;
}
async function warmOne(url){
  const request=new Request(url.href),asset=isAsset(url),key=asset?canonicalAsset(request):request,cache=await openCache(asset?ASSET_CACHE:SHELL_CACHE);
  if(!cache||await cachedResponse(cache,key))return;
  // These URLs have already loaded in the sending page; reuse its HTTP cache.
  // Never replace a revalidated shared asset with an older HTTP-cache copy.
  const response=await fetch(request,{cache:'force-cache'});if(response&&response.status===200)await putSafely(cache,key,response);
}
async function pruneClosedClients(){
  if(!self.clients||typeof self.clients.matchAll!=='function')return;
  try{const live=new Set((await self.clients.matchAll({type:'window',includeUncontrolled:true})).map(client=>client.id));for(const id of idleClients.keys())if(!live.has(id))idleClients.delete(id);}catch(_){}
}
function pumpWarmQueue(){
  if(warmTask)return warmTask;
  warmTask=(async()=>{
    await pruneClosedClients();
    while(true){
      // Any active match in a known tab pauses optional work on this machine.
      if([...idleClients.values()].some(client=>!client.idle))return;
      const next=[...idleClients.values()].find(client=>client.idle&&client.queue.length);if(!next)return;
      const url=next.queue.shift();try{await warmOne(url);}catch(_){}
    }
  })();
  warmTask.then(()=>{warmTask=null;},()=>{warmTask=null;});return warmTask;
}
self.addEventListener('message',event=>{
  const data=event.data||{};
  if(data.type==='resource-version'){if(event.ports&&event.ports[0])event.ports[0].postMessage({version:VERSION});return;}
  const id=event.source&&event.source.id;if(!id||(event.source.url&&!inScope(new URL(event.source.url))))return;
  if(data.type!=='resource-idle'&&data.type!=='cache-loaded')return;
  if(!idleClients.has(id)){if(idleClients.size>=32)return;idleClients.set(id,{idle:false,queue:[]});}
  const client=idleClients.get(id);
  if(data.type==='resource-idle')client.idle=data.idle===true;
  else if(Array.isArray(data.urls))for(const raw of data.urls.slice(0,128)){
    if(warmSeen.size>=128)break;if(typeof raw!=='string')continue;const url=warmURL(raw);if(!url)continue;
    const key=id+'\n'+(isAsset(url)?canonicalAsset(new Request(url.href)).url:url.href);if(warmSeen.has(key))continue;
    warmSeen.add(key);client.queue.push(url);
  }
  const task=pumpWarmQueue();if(event.waitUntil)event.waitUntil(task);
});
