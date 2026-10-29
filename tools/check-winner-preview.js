'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/winner-preview.js','utf8');
function fixture({mobile=false,reduced=false,context=true}={}){
  let next=0,hidden=false,victoryHidden=true,championHidden=true,observe;
  const frames=new Map(),events=new Map(),calls=[];
  const ctx={clearRect(){}};
  const canvas={width:420,height:270,dataset:{player:'0'},getContext:()=>context?ctx:null,
    getBoundingClientRect:()=>({width:240,height:150})};
  const victory={classList:{contains:()=>victoryHidden}},champion={classList:{contains:()=>championHidden}};
  const document={get hidden(){return hidden;},getElementById:id=>({victory,seriesChampion:champion,seriesChampionShip:canvas})[id],
    addEventListener:(name,fn)=>events.set(name,fn)};
  const window={devicePixelRatio:3,Galaxy3D:{active:false,winner:(ctx,player,angle)=>calls.push({player,angle})},
    addEventListener:(name,fn)=>events.set(name,fn)};
  const c=vm.createContext({window,document,matchMedia:q=>({matches:q.includes('reduced')?reduced:mobile}),
    MutationObserver:class{constructor(fn){observe=fn;}observe(){}},
    requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(source,c);
  return {calls,canvas,frames,
    ready(){window.Galaxy3D.active=true;events.get('galaxy3d-ready')?.();},
    show(player=0){canvas.dataset.player=String(player);victoryHidden=false;championHidden=false;observe?.();},
    hide(){victoryHidden=true;observe?.();},
    hideChampion(){championHidden=true;observe?.();},
    visibility(value){hidden=value;events.get('visibilitychange')?.();},
    event(name){events.get(name)?.();},
    error(){window.Galaxy3D.active=false;events.get('galaxy3d-error')?.();},
    tick(now){assert.equal(frames.size,1,'one animation loop');const [id,fn]=frames.entries().next().value;frames.delete(id);fn(now);}
  };
}
for(const options of [{},{mobile:true},{reduced:true}]){
  const f=fixture(options),period=options.reduced?24000:12000;
  f.show();assert.equal(f.frames.size,0,'no low-poly/2D fallback while models load');
  f.ready();f.tick(1000);assert.equal(f.calls.at(-1).angle,0);
  f.tick(1016);assert.equal(f.calls.length,1,'throttled preview');
  for(let quarter=1;quarter<=4;quarter++){
    f.tick(1000+period*quarter/4);
    assert.ok(Math.abs(f.calls.at(-1).angle-(quarter%4)*Math.PI/2)<1e-9,'complete turn without changing axis');
  }
  assert.equal(f.canvas.width,240*(options.mobile?1.25:1.5));
  assert.equal(f.canvas.height,Math.round(150*(options.mobile?1.25:1.5)));
  for(let player=0;player<4;player++){
    f.show(player);f.tick(30000+player*1000);assert.equal(f.calls.at(-1).player,player);
    f.hide();assert.equal(f.frames.size,0,'leaving cancels animation');
  }
  f.show(2);f.tick(40000);assert.equal(f.calls.at(-1).angle,0,'fresh screen starts at the front');
  f.visibility(true);assert.equal(f.frames.size,0,'background tab does no rendering');
  f.visibility(false);f.tick(50000);assert.equal(f.calls.at(-1).angle,0,'resume without elapsed-time jump');
  f.event('resize');f.event('resize');assert.equal(f.frames.size,1);
  f.error();assert.equal(f.frames.size,0,'lost WebGL pauses');
  f.ready();f.tick(60000);f.hideChampion();assert.equal(f.frames.size,0,'round/lobby cleanup cancels too');
  f.show(1);f.tick(70000);f.event('pagehide');assert.equal(f.frames.size,0);
  f.event('pageshow');f.tick(80000);assert.equal(f.calls.at(-1).angle,0);
}
assert.equal(fixture({context:false}).frames.size,0);
const read=name=>fs.readFileSync('docs/'+name,'utf8');
assert.match(read('index.html'),/<canvas id="seriesChampionShip"/);
assert.ok(read('index.html').includes('winner-preview.js?')&&read('build-version.js').includes("'winner-preview.js'"),'both boot paths load the preview');
assert.ok(!read('game.js').includes("champShip.src="),'winner never requests an old sprite');
assert.ok(!/new (?:Image|WebSocket|Worker)|fetch\(|import\(/.test(source),'preview reuses loaded resources and sends no data');
console.log('Winner preview OK: all four players, full looping turn, repeated exit/re-entry, load/visibility/WebGL/page lifecycle, bounded resolution and one throttled animation loop; no sprite or network traffic.');
