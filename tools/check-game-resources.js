'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
function section(start,end){const a=game.indexOf(start),b=game.indexOf(end,a);assert.ok(a>=0&&b>a,start);return game.slice(a,b);}
function fn(name){
  const start=game.indexOf('  function '+name+'(')>=0?game.indexOf('  function '+name+'('):game.indexOf('  async function '+name+'(');
  assert.ok(start>=0,name);const brace=game.indexOf('{',start);let depth=0,quote='',escape=false,line=false,block=false;
  for(let i=brace;i<game.length;i++){
    const c=game[i],next=game[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}
    if(c==='/'&&next==='/'){line=true;i++;continue;}
    if(c==='/'&&next==='*'){block=true;i++;continue;}
    if(c==='\''||c==='"'||c==='`'){quote=c;continue;}
    if(c==='{')depth++;else if(c==='}'&&--depth===0)return game.slice(start,i+1);
  }
  throw Error(name+' has no closing brace');
}
const drain=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const selection=section('    scene3D=window.Galaxy3D?.begin(',"    if(playback&&typeof guestShotOcclusion");

function imageFixture(mobile){
  const requests=[],tracked=[],timers=new Map();let timerId=0;
  class Image{
    constructor(){this.complete=false;this.naturalWidth=this.naturalHeight=0;this.fetchPriority='auto';}
    set src(url){this.url=url;requests.push(this);}
    get src(){return this.url;}
    decode(){this.decodes=(this.decodes||0)+1;return this.decodePromise||Promise.resolve();}
  }
  const c=vm.createContext({isMobile:mobile,images:{},window:{GalaxyGraphicsLoader:{track:p=>tracked.push(p)},Galaxy3D:{begin:()=>({}),ready:Promise.resolve(),prepareMatch:async()=>{}}},
    Image,Promise,console:{warn(){}},setTimeout:(callback,ms)=>{timers.set(++timerId,{callback,ms});return timerId;},clearTimeout:id=>timers.delete(id),
    backgroundCache:null,backgroundCacheW:0,backgroundCacheH:0,scheduleCanvasResolution(){},
    roomCode:'ROOM',localCampaignLevel:1,LOCAL_CAMPAIGN_LEVELS:5,clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),
    gameAssetsReady:false,gameAssetsPromise:null,document:{fonts:{load:async()=>{}},getElementById:()=>({value:'facil'})},
    updateCanvasResolution(){},warmRendererCaches(){},warmOnlineStartCaches(){},canvas:{width:1280,height:720,dataset:{}},ctx:{},now:1000,renderState:{},myIndex:0,scene3D:null});
  vm.runInContext(section('  const SHIP_IMAGE_KEYS=','  const METEOR_DRAW_SIZES=')+
    section('  const FALLBACK_MATCH_BACKGROUNDS=','  const MATCH_BACKGROUNDS=')+'const MATCH_BACKGROUNDS=FALLBACK_MATCH_BACKGROUNDS;'+
    section('  const assetList=','  let rendererWarmed=')+fn('prepareMatchBackground')+fn('prepareGameAssets')+fn('imageReady')+fn('drawImageCentered'),c);
  const api=vm.runInContext('({assetList,images,imageDecodePromises,imageLoadPromises,legacyGameImageKeys,loadGameImage,loadLegacyGameImages,prepareMatchBackground,prepareGameAssets,imageReady})',c);
  function settle(image,{error=false}={}){
    if(image.settled)return;image.settled=true;
    if(error){image.onerror();return;}
    image.complete=true;image.naturalWidth=image.naturalHeight=64;image.onload();
  }
  return {c,api,requests,tracked,timers,settle,render:()=>vm.runInContext(selection,c),
    settleEager:()=>{for(const key of Object.keys(api.imageDecodePromises))settle(api.images[key]);}};
}

async function checkImages(mobile){
  const f=imageFixture(mobile),{api}=f;
  const eager=['pantA','pantB','pantC','pantD','ammo1','ammo3','cadence','speed','bengala','bengalahud','ojo','mira1','localizaA','localizaB','localizaC','localizaD','ship1','ship2','ship3','ship4'];
  if(mobile)eager.push('bg');
  assert.deepEqual(Object.keys(api.images).sort(),eager.sort(),'all 3D HUD, flares, localization and victory images remain eager');
  assert.equal(f.requests.length,mobile?21:20);assert.equal(f.tracked.length,f.requests.length);
  assert.equal(api.legacyGameImageKeys.length,32);
  assert.equal(api.imageReady(api.images.ship1a),false);
  assert.equal(f.c.drawImageCentered(api.images.ufo,0,0,56),false,'pending fallback images are safe to access before their first download');
  for(let i=0;i<10;i++)f.render();
  assert.equal(f.requests.length,eager.length,'successful 3D frames do not request legacy sprites');
  const startup=api.prepareGameAssets();let ready=false;startup.then(()=>ready=true);await drain();assert.equal(ready,false);
  f.settleEager();await startup;assert.equal(ready,true);
  for(const key of eager)assert.equal(api.imageReady(api.images[key]),true,key+' is decoded for the first frame');
  const startupTracked=f.tracked.length;
  for(let round=1;round<=5;round++){
    const key=round===1?'bg':'bg0'+round,before=f.requests.length;
    const background=api.prepareMatchBackground(round);
    assert.strictEqual(api.prepareMatchBackground(round),background,'each round shares a single background promise');
    assert.equal(f.requests.length,before+(mobile&&round===1?0:1));
    const image=api.images[key];
    assert.equal(image.src,'assets/sprites/fondo'+(round===1?'':'0'+round)+(mobile?'_1280':'')+'.jpg');
    if(!image.settled){
      let decoded;image.decodePromise=new Promise(resolve=>decoded=resolve);let completed=false;background.then(()=>completed=true);
      f.settle(image);await drain();assert.equal(completed,false,'the round awaits actual background decoding');decoded();
    }
    assert.equal(await background,true);
    assert.equal(image.decodes,1,'the background is decoded once');
    if(round<5)assert.equal(api.images['bg0'+(round+1)],undefined,'later rounds remain deferred');
  }
  f.c.roomCode='LOCAL';f.c.localCampaignLevel=4;
  assert.strictEqual(api.prepareMatchBackground(1),api.imageLoadPromises.bg04,'local campaign level selects the matching round asset');
  const beforeLegacy=f.requests.length;f.c.window.Galaxy3D.begin=()=>null;f.render();
  assert.equal(f.requests.length,beforeLegacy+32);assert.equal(f.c.canvas.dataset.view,'2d');
  const fallback=api.loadLegacyGameImages();
  for(let i=0;i<20;i++)f.render();
  assert.strictEqual(api.loadLegacyGameImages(),fallback);assert.equal(f.requests.length,beforeLegacy+32,'fallback frames never start duplicate loads');
  assert.equal(f.tracked.length,startupTracked,'lazy art is not added to initial graphics readiness');
  for(const key of api.legacyGameImageKeys)f.settle(api.images[key],{error:key==='ufo'});
  await fallback;assert.equal(await api.imageLoadPromises.ufo,false,'one failed fallback sprite settles without blocking the rest');
  for(const key of api.legacyGameImageKeys.filter(key=>key!=='ufo'))assert.equal(api.imageReady(api.images[key]),true,key);
  assert.strictEqual(api.loadGameImage('ufo'),api.imageLoadPromises.ufo,'even a failed asset has only one request');
  assert.equal(f.timers.size,0,'completed image/decode timeouts are released');

  const late=imageFixture(mobile);delete late.c.window.Galaxy3D;late.render();
  const background=late.api.prepareMatchBackground(2),legacy=late.api.loadLegacyGameImages();
  const onlyEager=late.api.prepareGameAssets();late.settleEager();await onlyEager;
  assert.equal(late.c.gameAssetsReady,true,'startup does not wait for pending legacy art or an unrelated later background');
  assert.equal(late.api.imageReady(late.api.images.ship1a),false);
  for(const image of late.requests)late.settle(image);await Promise.all([background,legacy]);

  const broken=imageFixture(mobile);broken.settleEager();await drain();
  const missing=broken.api.prepareMatchBackground(3);const timeout=[...broken.timers.values()].find(t=>t.ms===(mobile?10000:15000));
  assert.ok(timeout);timeout.callback();assert.equal(await missing,false,'missing round art times out without blocking preparation forever');
  console.log('OK: '+(mobile?'mobile':'desktop')+' '+eager.length+' eager images; 32 fallback sprites + 4 later backgrounds deferred, single requests and round decode gates');
}

async function checkAudio(webAudio,mobile){
  const audios=[],fetches=[],decoded=[],idle=[];let contexts=0;
  class Audio{constructor(url){this.src=url;this.paused=true;this.plays=0;audios.push(this);}setAttribute(){}play(){this.plays++;this.paused=false;return Promise.resolve();}}
  class AudioContext{constructor(){contexts++;this.state='running';this.destination={};}createGain(){return {gain:{value:0},connect(){}};}decodeAudioData(data){decoded.push(data);return Promise.resolve({});}}
  const c=vm.createContext({window:{GALAXY_BUILD:{version:'test'},AudioContext:webAudio?AudioContext:undefined},navigator:{},isMobile:mobile,Audio,
    sounds:{},menu:{classList:{contains:()=>false}},musicStarted:false,requestIdleCallback:callback=>idle.push(callback),
    fetch:async url=>{fetches.push(url);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};},console,Promise});
  vm.runInContext(section('  const AUDIO_ASSET_VERSION=','  function playWebEffect(')+fn('startMusic'),c);
  const music=audios.find(audio=>audio.src.includes('musica.mp3'));
  assert.equal(music.preload,'none');assert.equal(music.loop,true);assert.equal(music.volume,.35*(mobile?.45:.75));
  assert.equal(fetches.length,0);assert.equal(contexts,0);assert.equal(idle.length,0,'initial music does not schedule fetch/decode work');
  assert.equal((game.match(/\bwarmWebMusicWhenIdle\(/g)||[]).length,1,'the unused WebAudio music warmer is still only a definition');
  await Promise.all([c.loadWebAudio(),c.loadWebAudio()]);
  assert.equal(fetches.length,webAudio?4:0);assert.equal(decoded.length,webAudio?4:0);
  assert.ok(fetches.every(url=>!url.includes('musica.mp3')),'effect preparation never fetches music');
  if(webAudio)assert.deepEqual(fetches.map(url=>url.split('/').pop().split('?')[0]),['laser_1.mp3','impacto1.mp3','carga3.wav','inicio.wav']);
  else{
    assert.equal(audios.length,18,'all original HTMLAudio effect pool entries are kept');
    assert.ok(audios.filter(audio=>audio!==music).every(audio=>audio.preload==='auto'));
  }
  c.startMusic();await drain();assert.equal(music.plays,1);assert.equal(c.musicStarted,true);
  c.startMusic();assert.equal(music.plays,1,'the same HTMLAudio music element remains playing');
  assert.equal(fetches.length,webAudio?4:0,'music playback does not introduce a second WebAudio download');
}

function checkDrag(){
  const variants=[['drawEngineParticles','engine',.72,250],['drawRockDebris','rock',.58,300],['drawRocketParticles','rocket',.66,300],['drawUfoParticles','ufo',.70,300]];
  for(const [name,prefix,base,gap] of variants)for(const elapsed of [-10,0,1,1000/144,1000/60,1000/30,50,99,gap,gap+1]){
    const particles=Array.from({length:64},(_,i)=>({life:i===0?0:i===1?.0005:i===2?.02:1-i/128,maxLife:1,x:i*3.1,y:-i*7.5,vx:i===3?-0:Math.sin(i)*703,vy:Math.cos(i)*191,size:2+i/10,rot:i/3,spin:i-8,palette:i%2,color:i%3}));
    const before=structuredClone(particles),calls=[],ctx=new Proxy({}, {get:(target,key)=>key in target?target[key]:(...args)=>calls.push([key,...args]),set:(target,key,value)=>{target[key]=value;return true;}});
    let powers=0;const math=Object.create(Math);math.pow=(...args)=>{powers++;return Math.pow(...args);};
    const c=vm.createContext({ctx,Math:math,[prefix+'Particles']:particles,[prefix+'FxLastAt']:1000,ENGINE_FIRE_PALETTES:[['#fff','#a00'],['#aff','#004']],UFO_FX_COLORS:['#fff','#aff','#afa']});
    const now=1000+elapsed,measuredElapsed=now-1000;
    vm.runInContext(fn(name),c);c[name](now);
    const dt=Math.min(.05,Math.max(0,measuredElapsed/1000));
    assert.equal(powers,elapsed>0&&elapsed<=gap?1:0,name+' computes drag at most once per pass');
    for(let i=0;i<particles.length;i++){
      const expected={...before[i]};
      if(elapsed>gap)expected.life=0;
      else if(dt>0&&expected.life>0){
        expected.life-=dt;
        if(expected.life>0){
          expected.x+=expected.vx*dt;expected.y+=expected.vy*dt;
          expected.vx*=Math.pow(base,dt);expected.vy*=Math.pow(base,dt);
          if(prefix==='rock')expected.rot+=expected.spin*dt;
        }
      }
      assert.deepEqual(particles[i],expected,name+' retains exact position, velocity, lifetime, rotation and all appearance fields');
    }
    if(elapsed>0&&elapsed<=gap)assert.ok(calls.some(call=>call[0]==='fill'),name+' still renders living particles');
  }
}

(async()=>{
  for(const mobile of [false,true])await checkImages(mobile);
  for(const mobile of [false,true])for(const webAudio of [true,false])await checkAudio(webAudio,mobile);
  checkDrag();
  console.log('Game resources OK: eager 3D HUD, selected round backgrounds, deferred single-load 2D fallback, unchanged effect audio and playback, exact local particle motion with one drag power per pass.');
})().catch(error=>{console.error(error);process.exitCode=1;});
