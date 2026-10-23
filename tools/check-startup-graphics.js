'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/menu-loader.js','utf8');
const index=fs.readFileSync('docs/index.html','utf8');
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

function fixture({mobile=false,requested=true}={}){
  const timers=new Map(),elements=new Map();let now=0,id=0,resolveModels,reloads=0,assigned='';
  function element(){
    const classes=new Set(),events={};
    return {hidden:false,inert:false,dataset:{},style:{},textContent:'',
      classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},
      addEventListener:(k,fn)=>events[k]=fn,click:()=>events.click?.()};
  }
  for(const key of ['menuFirstLoader','menuFirstLoaderProgress','menuFirstLoaderBar','menuFirstLoaderLabel','menuFirstLoaderActions','menuFirstLoaderRetry','menuFirstLoader2D','app'])elements.set(key,element());
  elements.get('menuFirstLoaderActions').hidden=true;
  const root=element();if(mobile)root.classList.add('handheld-device');
  const models=new Promise(resolve=>{resolveModels=resolve;});
  const location={href:'https://example.com/GALAXY3D/?view=3d&room=ABCD#test',reload:()=>reloads++,assign:url=>assigned=url};
  const window={Galaxy3D:{requested,ready:models},location,
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:key=>timers.delete(key)};
  class Image{
    set src(value){queueMicrotask(()=>this.onload?.());}
    decode(){return Promise.resolve();}
  }
  const context=vm.createContext({window,Image,Promise,URL,matchMedia:()=>({matches:mobile}),navigator:{userAgent:mobile?'iPhone':'Desktop'},
    document:{readyState:'complete',documentElement:root,getElementById:key=>elements.get(key)}});
  vm.runInContext(source,context);
  async function advance(ms){
    await drain();const end=now+ms;
    while(true){
      const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;
      now=due[1].at;timers.delete(due[0]);due[1].fn();await drain();
    }
    now=end;await drain();
  }
  return {window,context,location,elements,root,resolveModels,advance,get reloads(){return reloads;},get assigned(){return assigned;}};
}

(async()=>{
  for(const mobile of [false,true]){
    const f=fixture({mobile});let releaseLate;
    f.window.GalaxyGraphicsLoader.track(new Promise(resolve=>{releaseLate=resolve;}));
    await f.advance(20000);
    assert.equal(f.elements.get('menuFirstLoader').hidden,false,'slow 3D must survive every former release timer');
    assert.equal(f.elements.get('menuFirstLoader').classList.contains('is-ready'),false);
    assert.equal(f.elements.get('app').inert,true,'keyboard and pointer controls stay unavailable during startup');
    f.resolveModels({ok:true});await drain();
    assert.equal(f.elements.get('menuFirstLoader').classList.contains('is-ready'),false,'also wait for registered sprites and fonts');
    releaseLate();await drain();await f.advance(420);
    assert.equal(f.elements.get('menuFirstLoader').hidden,true);
    assert.equal(f.elements.get('app').inert,false);
    assert.equal(f.elements.get('menuFirstLoaderProgress').textContent,'100%');
  }
  const broken=fixture({mobile:true});broken.resolveModels({ok:false});await broken.advance(20000);
  assert.equal(broken.elements.get('menuFirstLoader').hidden,false,'a model failure must not reveal fallback art');
  assert.equal(broken.elements.get('menuFirstLoader').dataset.state,'error');
  assert.equal(broken.elements.get('menuFirstLoaderActions').hidden,false);
  broken.elements.get('menuFirstLoaderRetry').click();assert.equal(broken.reloads,1);
  broken.elements.get('menuFirstLoader2D').click();
  const choice=new URL(broken.assigned);assert.equal(choice.searchParams.get('view'),'2d');
  assert.equal(choice.searchParams.get('room'),'ABCD');assert.equal(choice.hash,'#test');
  const twoD=fixture({mobile:true,requested:false});
  twoD.window.GalaxyGraphicsLoader.track(new Promise(()=>{}));await twoD.advance(3000);
  assert.equal(twoD.elements.get('menuFirstLoader').hidden,true,'explicit 2D keeps its bounded image startup');
  // Run the actual independent index watchdog against the same slow 3D state.
  const safety=index.slice(index.indexOf('  // Última red de seguridad'),index.indexOf('</script>',index.indexOf('  // Última red de seguridad')));
  const slow=fixture({mobile:true});vm.runInContext('(()=>{'+safety,slow.context);await slow.advance(20000);
  assert.equal(slow.elements.get('menuFirstLoader').hidden,false,'the independent watchdog must also respect required models');
  console.log('Startup graphics OK: delayed desktop/mobile models, late fonts, load errors, retry, explicit 2D and independent watchdog.');
})().catch(error=>{console.error(error);process.exitCode=1;});
