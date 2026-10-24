'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/sw.js','utf8');
const origin='https://galaxy.example',scope=origin+'/GALAXY3D/';
const listeners={},stores=new Map(),calls=[];
let online=true,revision='new';
function store(name){
 if(!stores.has(name))stores.set(name,new Map());
 const entries=stores.get(name);
 return {async put(request,response){entries.set(typeof request==='string'?new URL(request,scope).href:request.url,response.clone());},async match(request,options={}){
  const url=typeof request==='string'?new URL(request,scope).href:request.url;
  for(const [key,value] of entries)if(key===url||(options.ignoreSearch&&key.split('?')[0]===url.split('?')[0]))return value.clone();
 }};
}
const self={location:{origin},registration:{scope},addEventListener:(type,handler)=>{listeners[type]=handler;}};
vm.runInNewContext(source,{self,URL,Request,Response,caches:{open:async name=>store(name)},importScripts:()=>{self.GALAXY_BUILD={version:'TEST'};},fetch:async(request,options)=>{
 calls.push({url:request.url,cache:options?.cache});
 if(!online)throw Error('offline');
 return new Response(revision,{status:200});
},console});
async function request(path){let response;listeners.fetch({request:new Request(scope+path),respondWith:value=>{response=value;}});return response;}
(async()=>{
 const paints=['naveazul-cupula-oscura.png','navefuxia.jpg','nave-luces-mask.svg'];
 for(const file of paints){
  const path='assets/models/'+file+'?v=same',req=new Request(scope+path);
  await store('galaxy3d-assets-TEST').put(req,new Response('old'));
  revision='new';online=true;
  assert.equal(await (await request(path)).text(),'new','an edited texture must replace the stale cached image');
  assert.equal(calls.at(-1).cache,'no-cache','revalidate with HTTP cache validators');
  revision='newer';
  assert.equal(await (await request(path)).text(),'newer','replacing the same filename again must also work');
  online=false;
  assert.equal(await (await request(path)).text(),'newer','offline must retain the latest successful image');
 }
 const precached='assets/models/naveroja.png?v=other';
 await store('galaxy3d-shell-TEST').put(new Request(scope+'assets/models/naveroja.png'),new Response('shell-paint'));
 assert.equal(await (await request(precached)).text(),'shell-paint','a fresh offline page may use its precached paint');
 const model='assets/models/nave.glb?v=same';
 await store('galaxy3d-assets-TEST').put(new Request(scope+model),new Response('model'));
 const before=calls.length;
 assert.equal(await (await request(model)).text(),'model');
 assert.equal(calls.length,before,'GLB models keep their existing cache-first behaviour');
 await assert.rejects(request('assets/models/missing.png'),/offline/,'missing paints must report a failure instead of showing an unrelated image');
 console.log('Model texture cache OK: edited images replace stale copies, repeated edits refresh, offline uses the last valid paint, GLB caching unchanged.');
})().catch(error=>{console.error(error);process.exitCode=1;});
