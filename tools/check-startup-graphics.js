'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/menu-loader.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

function fixture({mobile=false,requested=true,renderer=true,loadMenu=true}={}){
  const timers=new Map(),elements=new Map(),windowEvents=new Map();let now=0,id=0,settleModels,rejectModels,reloads=0,assigned='',active=false;
  function element(){
    const classes=new Set(),events={};
    return {hidden:false,inert:false,dataset:{},style:{},textContent:'',
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},
      addEventListener:(k,fn)=>events[k]=fn,click:()=>events.click?.()};
  }
  for(const key of ['menuFirstLoader','menuFirstLoaderProgress','menuFirstLoaderBar','menuFirstLoaderLabel','menuFirstLoaderActions','menuFirstLoaderRetry','app'])elements.set(key,element());
  elements.get('menuFirstLoaderActions').hidden=true;
  const root=element();if(mobile)root.classList.add('handheld-device');
  const models=new Promise((resolve,reject)=>{settleModels=resolve;rejectModels=reject;});
  const location={href:'https://example.com/GALAXY3D/?view=2d&room=ABCD#test',reload:()=>reloads++,assign:url=>assigned=url};
  const window={location,addEventListener:(type,fn)=>{if(!windowEvents.has(type))windowEvents.set(type,[]);windowEvents.get(type).push(fn);},
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:key=>timers.delete(key)};
  if(renderer)window.Galaxy3D={requested,ready:models,get active(){return active;}};
  class Image{
    set src(value){queueMicrotask(()=>this.onload?.());}
    decode(){return Promise.resolve();}
  }
  const context=vm.createContext({window,Image,Promise,URL,matchMedia:()=>({matches:mobile}),navigator:{userAgent:mobile?'iPhone':'Desktop'},
    document:{readyState:'complete',documentElement:root,getElementById:key=>elements.get(key)}});
  if(loadMenu)vm.runInContext(source,context);
  async function advance(ms){
    await drain();const end=now+ms;
    while(true){
      const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;
      now=due[1].at;timers.delete(due[0]);due[1].fn();await drain();
    }
    now=end;await drain();
  }
  return {window,context,location,elements,root,advance,rejectModels,
    resolveModels:(result,isActive=!!result?.ok)=>{active=isActive;settleModels(result);},
    rendererEvent:(type,isActive)=>{active=isActive;for(const listener of windowEvents.get(type)||[])listener();},
    get reloads(){return reloads;},get assigned(){return assigned;}};
}

(async()=>{
  for(const mobile of [false,true])for(const requested of [true,false]){
    const f=fixture({mobile,requested});let releaseLate;
    f.window.GalaxyGraphicsLoader.track(new Promise(resolve=>{releaseLate=resolve;}));
    await f.advance(20000);
    assert.equal(f.elements.get('menuFirstLoader').hidden,false,'3D is mandatory despite slow loads or a legacy 2D preference');
    assert.equal(f.elements.get('menuFirstLoader').classList.contains('is-ready'),false);
    assert.equal(f.elements.get('app').inert,true,'keyboard and pointer controls stay unavailable during startup');
    f.resolveModels({ok:true});await drain();
    assert.equal(f.elements.get('menuFirstLoader').classList.contains('is-ready'),false,'also wait for registered sprites and fonts');
    releaseLate();await drain();await f.advance(420);
    assert.equal(f.elements.get('menuFirstLoader').hidden,true);
    assert.equal(f.elements.get('app').inert,false);
    assert.equal(f.elements.get('menuFirstLoaderProgress').textContent,'100%');
    assert.equal(f.assigned,'','startup never redirects to a 2D page');
  }
  const broken=fixture({mobile:true});broken.resolveModels({ok:false});await broken.advance(20000);
  assert.equal(broken.elements.get('menuFirstLoader').hidden,false,'a model failure must not reveal fallback art');
  assert.equal(broken.elements.get('menuFirstLoader').dataset.state,'error');
  assert.equal(broken.elements.get('menuFirstLoaderActions').hidden,false);
  broken.elements.get('menuFirstLoaderRetry').click();assert.equal(broken.reloads,1);
  assert.equal(broken.assigned,'');
  assert.equal(index.includes('id="menuFirstLoader2D"'),false,'the error UI only offers retry');
  const rejected=fixture();rejected.rejectModels(new Error('Failed model'));await rejected.advance(20000);
  assert.equal(rejected.elements.get('menuFirstLoader').dataset.state,'error');assert.equal(rejected.elements.get('app').inert,true);
  const missing=fixture({renderer:false});await missing.advance(20000);
  assert.equal(missing.elements.get('menuFirstLoader').dataset.state,'error','missing renderer reports a recoverable startup error');
  assert.equal(missing.elements.get('menuFirstLoader').hidden,false);assert.equal(missing.elements.get('app').inert,true);
  missing.elements.get('menuFirstLoaderRetry').click();assert.equal(missing.reloads,1);
  const unavailable=fixture();unavailable.resolveModels({ok:true},false);await unavailable.advance(20000);
  assert.equal(unavailable.elements.get('menuFirstLoader').dataset.state,'error','a resolved model promise cannot expose an inactive renderer');
  assert.equal(unavailable.elements.get('app').inert,true);
  for(const failDuringFade of [false,true]){
    const f=fixture();f.resolveModels({ok:true});await f.advance(failDuringFade?100:500);
    assert.equal(f.elements.get('menuFirstLoader').hidden,!failDuringFade);
    f.rendererEvent('galaxy3d-error',false);await f.advance(20000);
    assert.equal(f.elements.get('menuFirstLoader').hidden,false,'WebGL loss reopens the overlay and cancels a pending reveal');
    assert.equal(f.elements.get('menuFirstLoader').classList.contains('is-ready'),false);
    assert.equal(f.elements.get('menuFirstLoader').dataset.state,'error');assert.equal(f.elements.get('app').inert,true);
    f.rendererEvent('galaxy3d-ready',false);await f.advance(500);
    assert.equal(f.elements.get('app').inert,true,'an unavailable renderer cannot unlock the application');
    f.rendererEvent('galaxy3d-ready',true);await f.advance(420);
    assert.equal(f.elements.get('menuFirstLoader').hidden,true,'a restored WebGL context resumes without a reload');
    assert.equal(f.elements.get('app').inert,false);assert.equal(f.reloads,0);
  }
  // Run the actual independent index watchdog against the same slow 3D state.
  const safety=index.slice(index.indexOf('  // Última red de seguridad'),index.indexOf('</script>',index.indexOf('  // Última red de seguridad')));
  const slow=fixture({mobile:true});vm.runInContext('(()=>{'+safety,slow.context);await slow.advance(20000);
  assert.equal(slow.elements.get('menuFirstLoader').hidden,false,'the independent watchdog must also respect required models');
  assert.equal(slow.elements.get('app').inert,true);
  for(const renderer of [false,true]){
    const absent=fixture({renderer,loadMenu:false});vm.runInContext('(()=>{'+safety,absent.context);await absent.advance(20000);
    assert.equal(absent.elements.get('menuFirstLoader').hidden,false,'missing startup scripts never expose 2D through the watchdog');
    assert.equal(absent.elements.get('menuFirstLoader').dataset.state,'error');assert.equal(absent.elements.get('app').inert,true);
    assert.equal(absent.elements.get('menuFirstLoaderActions').hidden,false);
    absent.elements.get('menuFirstLoaderRetry').click();assert.equal(absent.reloads,1);
  }
  console.log('Startup graphics OK: mandatory desktop/mobile 3D, legacy preferences ignored, late fonts, missing/failed models, retry, WebGL loss/restoration and independent watchdog without 2D escape.');
})().catch(error=>{console.error(error);process.exitCode=1;});
