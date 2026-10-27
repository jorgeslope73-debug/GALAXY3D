'use strict';
const assert=require('node:assert/strict');
const {createHarness,SHARED}=require('./check-resource-cache.js');
(async()=>{
  const h=createHarness(),paints=['naveazul-cupula-oscura.png','navefuxia.jpg','nave-luces-mask.svg'];
  let online=true,revision='new';
  h.network=async()=>{if(!online)throw Error('offline');return new Response(revision,{status:200});};
  for(const file of paints){
    const path='assets/models/'+file+'?v=same';
    h.seed(SHARED,'assets/models/'+file,'old');revision='new';online=true;
    assert.equal(await (await h.request(path)).text(),'new','an edited texture must replace the stale cached image');
    assert.equal(h.calls.at(-1).cache,'no-cache','unvalidated images must revalidate through the HTTP cache');
    revision='newer';assert.equal(await (await h.request(path)).text(),'newer','replacing the same filename again must also work');
    online=false;assert.equal(await (await h.request(path)).text(),'newer','offline must retain the latest successful image');
  }
  h.seed('galaxy3d-shell-PREVIOUS','assets/models/naveroja.png','shell-paint');
  assert.equal(await (await h.request('assets/models/naveroja.png?v=other')).text(),'shell-paint','older shell paints migrate lazily without changing their filename');
  const model='assets/models/nave.glb?v=same';h.seed(SHARED,'assets/models/nave.glb','model',{'ETag':'"model"'});online=true;
  h.network=async request=>{assert.equal(request.headers.get('If-None-Match'),'"model"');return new Response(null,{status:304});};
  assert.equal(await (await h.request(model)).text(),'model','an unchanged GLB reuses its complete cached body after a 304');
  revision='edited-model';h.network=async()=>new Response(revision,{headers:{'ETag':'"edited"'}});
  assert.equal(await (await h.request(model)).text(),'edited-model','GLBs replaced under the same filename also refresh');
  h.network=async()=>{throw Error('offline');};
  assert.equal(await (await h.request('assets/models/nave.glb?v=next')).text(),'edited-model','version changes reuse the last successful model offline');
  await assert.rejects(h.request('assets/models/missing.png'),/offline/,'missing paints must fail instead of showing an unrelated image');
  console.log('Model texture cache OK: repeated image/GLB edits refresh, unchanged models reuse 304 bodies, version changes share cached assets and offline retains the last valid paint.');
})().catch(error=>{console.error(error);process.exitCode=1;});
