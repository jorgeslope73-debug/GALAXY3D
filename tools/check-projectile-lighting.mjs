import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../docs/vendor/three.module.min.js';
import {createProjectileLighting} from '../docs/projectile-lighting.js';

const freeze=value=>{
  if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};
const snapshot=extra=>({players:[],asteroids:[],meteors:[],bullets:[],...extra});
const live=scene=>scene.children.filter(x=>x.isPointLight&&x.intensity>0);
function fixture(mobile=false){
  const scene=new T.Scene();let creations=0;
  class CountedPointLight extends T.PointLight{constructor(...args){super(...args);creations++;}}
  const api=createProjectileLighting({PointLight:CountedPointLight},scene,{mobile});
  return {scene,api,get creations(){return creations;}};
}
function frame(f,state,bolts,time,context='round1'){
  const at=time??((f.time??984)+16);f.time=at;
  f.api.begin(state,context);
  for(const b of bolts)f.api.addBolt(b.id,b.x,b.y);
  f.api.update(at);
}
function near(a,b,label){assert.ok(Math.abs(a-b)<1e-7,label);}
function check(label,fn){fn();console.log('OK: '+label);}

check('fixed desktop/mobile pools, no shadows, no light-count shader changes',()=>{
  for(const mobile of [false,true]){
    const f=fixture(mobile),objects=f.scene.children.slice();
    assert.equal(f.api.limit,mobile?2:4);assert.equal(f.creations,f.api.limit);
    for(const light of objects){
      assert.equal(light.visible,true);assert.equal(light.castShadow,false);assert.equal(light.intensity,0);
      assert.ok(light.distance>0&&Number.isFinite(light.distance));
      assert.ok(light.color.g>light.color.r&&light.color.g>light.color.b);
    }
    for(let i=0;i<200;i++)frame(f,snapshot(),[],i*16);
    assert.deepEqual(f.scene.children,objects);assert.equal(f.creations,f.api.limit);
    f.api.dispose();assert.equal(f.scene.children.length,0);
  }
});

check('only actually drawn bullets emit, at their current drawn position',()=>{
  const f=fixture(),state=freeze(snapshot({
    asteroids:[{id:1,x:800,y:500,r:52}],
    bullets:[{id:7,x:750,y:500,g:false}]
  })),before=JSON.stringify(state);
  frame(f,state,[]);assert.equal(f.api.activeCount,0,'an authoritative but hidden projectile must not light anything');
  for(let i=0;i<12;i++){
    const b={id:'local-preview',x:720+i*4,y:493};
    frame(f,state,[b],1016+i*16);
    assert.equal(f.api.activeCount,1);
    const [light]=live(f.scene);near(light.position.x,b.x-960,'no interpolation lag on X');
    near(light.position.y,540-b.y,'no interpolation lag on Y');assert.ok(light.position.z>16);
  }
  frame(f,state,[],1300);assert.equal(f.api.activeCount,0,'disappearing/occluded shots leave no ghost light');
  assert.ok(f.scene.children.every(l=>l.intensity===0&&l.visible));
  assert.equal(JSON.stringify(state),before,'presentation never changes the input snapshot');
});

check('a fast flyby receives most of its light in the first visible frame',()=>{
  const f=fixture(),state=snapshot({asteroids:[{x:800,y:500,r:52}]}),bolts=[{id:1,x:750,y:500}];
  frame(f,state,bolts,1000);const first=live(f.scene)[0].intensity;
  for(let i=1;i<=40;i++)frame(f,state,bolts,1000+i*16);
  const settled=live(f.scene)[0].intensity;
  assert.ok(first>=settled*.55,'short projectile passes must not wait for a slow light fade-in');
  frame(f,state,[],1700);assert.equal(f.api.activeCount,0);
});

check('range, invisible/dead ships, guided targets and menu/round resets',()=>{
  const f=fixture(),b={id:1,x:500,y:500};
  frame(f,snapshot({asteroids:[{x:1400,y:500,r:50}]}),[b]);assert.equal(f.api.activeCount,0);
  for(const p of [{dead:true},{camo:5}])
    {frame(f,snapshot({players:[{x:540,y:500,...p}]}),[b]);assert.equal(f.api.activeCount,0);}
  for(const state of [
    snapshot({players:[{x:540,y:500,shield:1}]}),
    snapshot({meteors:[{x:540,y:500}]}),
    snapshot({giant:{x:680,y:500}}),
    snapshot({ufo:{x:540,y:500}}),
    snapshot({bullets:[{x:540,y:500,g:true}]})
  ]){frame(f,state,[b]);assert.equal(f.api.activeCount,1);}
  frame(f,snapshot(),[],2000,'round2');assert.equal(f.api.activeCount,0);
  frame(f,null,[],2100,'menu');assert.equal(f.api.activeCount,0);
});

check('nearest visible surfaces get the budget rather than faraway bullets',()=>{
  for(const mobile of [false,true]){
    const f=fixture(mobile),asteroids=[200,650,1100,1550].map(x=>({x,y:500,r:40}));
    const bolts=Array.from({length:40},(_,i)=>({id:'far'+i,x:20+i*35,y:10}));
    bolts.push(...asteroids.map((a,i)=>({id:'near'+i,x:a.x,y:460})));
    frame(f,snapshot({asteroids}),bolts);
    assert.equal(f.api.activeCount,f.api.limit);
    for(const light of live(f.scene))near(light.position.y,80,'a shot beside an object takes priority');
    assert.equal(f.creations,f.api.limit);
  }
});

check('clusters share light instead of multiplying the green intensity',()=>{
  const f=fixture(),state=snapshot({asteroids:[{x:800,y:500,r:100}]});
  for(let i=0;i<60;i++)frame(f,state,[{id:1,x:760,y:500}],i*16);
  const single=live(f.scene)[0].intensity;
  frame(f,state,Array.from({length:20},(_,i)=>({id:i,x:755+i,y:500})),1000);
  assert.equal(f.api.activeCount,1,'close shots share one point light');
  const pair=[{id:101,x:760,y:500},{id:102,x:840,y:500}];
  for(let i=0;i<60;i++)frame(f,state,pair,1100+i*16);
  assert.equal(f.api.activeCount,2);
  const combined=live(f.scene).reduce((sum,l)=>sum+l.intensity,0);
  assert.ok(combined<=single*1.01,'overlapping nearby light pools retain the soft total intensity');
});

check('stable identities, finite inputs and bounded peak populations',()=>{
  for(const mobile of [false,true]){
    const f=fixture(mobile),asteroids=Array.from({length:512},(_,i)=>({x:40+(i%32)*59,y:30+Math.floor(i/32)*65,r:22}));
    const state=freeze(snapshot({asteroids})),bolts=Array.from({length:300},(_,i)=>({id:i,x:45+(i%24)*75,y:50+Math.floor(i/24)*70}));
    const objects=f.scene.children.slice(),started=performance.now();
    for(let i=0;i<120;i++){
      frame(f,state,i%2?bolts:bolts.slice().reverse(),3000+i*16);
      assert.ok(f.api.activeCount<=f.api.limit);assert.equal(f.creations,f.api.limit);
      for(const light of f.scene.children)assert.ok(Number.isFinite(light.intensity)&&light.intensity>=0);
    }
    console.log((mobile?'  mobile':'  desktop')+' peak CPU: '+((performance.now()-started)/120).toFixed(3)+'ms/frame');
    assert.deepEqual(f.scene.children,objects);
    f.api.begin(state,'new');f.api.addBolt(1,NaN,10);f.api.addBolt(2,10,Infinity);f.api.update(5000);
    assert.equal(f.api.activeCount,0);
  }
});

const render=await readFile(new URL('../docs/render-3d.js',import.meta.url),'utf8');
assert.ok(render.includes("import('./projectile-lighting.js?v='"),'renderer loads the versioned lighting module');
// Offline reuse of this module is covered by check-resource-cache.js.
console.log('Projectile lighting OK: local visible positions, soft green range, stable bounded pools, no ghost lights or snapshot mutation.');
