'use strict';
(() => {
  const loader=document.getElementById('menuFirstLoader');
  if(!loader)return;
  const progressEl=document.getElementById('menuFirstLoaderProgress');
  const barEl=document.getElementById('menuFirstLoaderBar');
  const labelEl=document.getElementById('menuFirstLoaderLabel');
  const app=document.getElementById('app');
  const actions=document.getElementById('menuFirstLoaderActions');
  let modelsState='loading';
  let total=0,done=0,registrationComplete=false,finished=false,releaseTimer=0;
  let resolveReady;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const isMobile=document.documentElement.classList.contains('handheld-device')||
    matchMedia('(pointer:coarse)').matches||/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  document.documentElement.classList.add('menu-first-loading');
  if(app)app.inert=true;
  loader.dataset.state='loading';
  loader.hidden=false;
  loader.classList.remove('is-ready');
  if(labelEl)labelEl.textContent='CARGANDO GRAFICOS...';

  function updateProgress(){
    if(modelsState==='error'){if(progressEl)progressEl.textContent='CARGA INCOMPLETA';return;}
    const pct=finished?100:Math.min(99,Math.round(done/Math.max(1,total)*100));
    if(progressEl)progressEl.textContent=pct+'%';
    if(barEl)barEl.style.transform='scaleX('+(pct/100)+')';
  }
  const slowTimer=window.setTimeout(()=>{
    if(!finished&&modelsState!=='error'&&labelEl&&actions?.hidden!==false)labelEl.textContent='CARGANDO GRAFICOS... ESPERA UN MOMENTO';
  },8000);
  // A slow download offers a retry without exposing incomplete graphics.
  // Registered game resources retain their own bounded image/decode waits.
  const watchdogTimer=window.setTimeout(()=>{
    if(finished||modelsState==='error')return;
    if(labelEl)labelEl.textContent='LA CARGA SIGUE EN CURSO. PUEDES REINTENTAR';
    if(actions)actions.hidden=false;
  },isMobile?6000:18000);
  function finishIfReady(){
    if(finished||modelsState!=='ready'||!registrationComplete||done<total)return;
    if(window.Galaxy3D?.active!==true){modelFailure();return;}
    finished=true;
    window.clearTimeout(slowTimer);
    window.clearTimeout(watchdogTimer);
    updateProgress();
    loader.classList.add('is-ready');
    loader.dataset.state='ready';
    if(actions)actions.hidden=true;
    releaseTimer=window.setTimeout(()=>{
      releaseTimer=0;
      if(modelsState!=='ready'||window.Galaxy3D?.active!==true){modelFailure();return;}
      loader.hidden=true;
      if(app)app.inert=false;
      document.documentElement.classList.remove('menu-first-loading');
      resolveReady(true);
    },420);
  }
  function track(promise){
    total++;
    updateProgress();
    const settled=()=>{done++;updateProgress();finishIfReady();};
    Promise.resolve(promise).then(settled,settled);
    return promise;
  }
  // game.js registra sus texturas y la preparacion final de fuentes y caches.
  window.GalaxyGraphicsLoader={track,ready};
  function modelFailure(){
    finished=false;modelsState='error';loader.dataset.state='error';
    window.clearTimeout(slowTimer);window.clearTimeout(watchdogTimer);
    if(releaseTimer)window.clearTimeout(releaseTimer);releaseTimer=0;
    loader.hidden=false;loader.classList.remove('is-ready');
    document.documentElement.classList.add('menu-first-loading');
    if(app)app.inert=true;
    if(labelEl)labelEl.textContent='NO SE HAN PODIDO CARGAR LOS OBJETOS 3D';
    if(actions)actions.hidden=false;
    updateProgress();
  }
  window.addEventListener('galaxy3d-error',modelFailure);
  window.addEventListener('galaxy3d-ready',()=>{
    if(window.Galaxy3D?.active!==true)return;
    modelsState='ready';finishIfReady();
  });
  try{
    const readiness=window.Galaxy3D?.ready;
    if(!readiness||typeof readiness.then!=='function')modelFailure();
    else track(Promise.resolve(readiness).then(result=>{
      if(modelsState==='error')return;
      if(!result?.ok||window.Galaxy3D?.active!==true){modelFailure();return;}
      modelsState='ready';finishIfReady();
    },modelFailure));
  }catch(_){modelFailure();}
  document.getElementById('menuFirstLoaderRetry')?.addEventListener('click',()=>window.location.reload());
  function completeRegistration(){registrationComplete=true;finishIfReady();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',completeRegistration,{once:true});
  else completeRegistration();
})();
