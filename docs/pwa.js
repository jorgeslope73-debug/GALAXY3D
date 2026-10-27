(() => {
  const installBtn=document.getElementById('orientationInstallGame');
  const installCopy=document.getElementById('orientationInstallCopy');
  const isHandheld=document.documentElement.classList.contains('handheld-device')
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||'');
  const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent||'')
    || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  let deferredPrompt=null;
  const tr=(key,fallback)=>{
    try{
      if(window.GalaxyI18n&&typeof window.GalaxyI18n.t==='function')return window.GalaxyI18n.t(key);
    }catch(_){}
    return fallback;
  };

  function isInstalled(){
    return window.matchMedia?.('(display-mode: standalone)').matches
      || window.matchMedia?.('(display-mode: fullscreen)').matches
      || navigator.standalone===true;
  }

  function showInstallMessage(text){
    const toast=document.getElementById('shareToast');
    if(toast){
      toast.textContent=String(text||'');
      toast.classList.remove('hidden');
      clearTimeout(showInstallMessage.timer);
      showInstallMessage.timer=setTimeout(()=>toast.classList.add('hidden'),6500);
    }else{
      alert(String(text||''));
    }
  }

  function refreshInstallButton(){
    const hideInstall=!isHandheld||isInstalled();
    if(installBtn)installBtn.classList.toggle('pwa-hidden',hideInstall);
    if(installCopy)installCopy.classList.toggle('pwa-hidden',hideInstall);
  }

  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    deferredPrompt=e;
    refreshInstallButton();
  });

  window.addEventListener('appinstalled',()=>{
    deferredPrompt=null;
    refreshInstallButton();
    showInstallMessage(tr('pwaInstalled','GALAXY COMBAT INSTALADO.'));
  });

  if(installBtn){
    installBtn.addEventListener('click',async()=>{
      if(isInstalled()){
        refreshInstallButton();
        return;
      }
      if(deferredPrompt){
        const prompt=deferredPrompt;
        deferredPrompt=null;
        try{
          await prompt.prompt();
          await prompt.userChoice;
        }catch(_){}
        refreshInstallButton();
        return;
      }
      if(isIOS){
        showInstallMessage(tr('pwaIosInstall','EN IPHONE/IPAD: PULSA COMPARTIR Y DESPUES AÑADIR A PANTALLA DE INICIO.'));
      }else{
        showInstallMessage(tr('pwaBrowserInstall','ABRE EL MENU DEL NAVEGADOR Y ELIGE AÑADIR A PANTALLA DE INICIO.'));
      }
    });
  }

  refreshInstallButton();

  if (!('serviceWorker' in navigator)) return;

  // V20.90: una actualizacion nunca puede recargar la pagina mientras hay
  // una sala, partida o pantalla de victoria activa. El nuevo SW puede quedar
  // controlando la pagina, pero la recarga se aplaza hasta volver al menu.
  let reloadingForUpdate=false;
  let pendingUpdateReload=false;
  let pageReady=false,maintenanceJob=null,registrationTask=null,updateTask=null,lastUpdateAt=0;
  let hadController=!!navigator.serviceWorker.controller;
  const reportedResources=new Set();

  function safeToReloadForUpdate(){
    const menu=document.getElementById('menu');
    return !!(menu&&!menu.classList.contains('hidden'));
  }

  function reloadForPendingUpdate(){
    if(reloadingForUpdate||!pendingUpdateReload||!safeToReloadForUpdate())return false;
    reloadingForUpdate=true;
    pendingUpdateReload=false;
    location.reload();
    return true;
  }

  function menuIdle(){return pageReady&&!document.hidden&&safeToReloadForUpdate();}
  function notifyResourceMode(){
    try{navigator.serviceWorker.controller?.postMessage({type:'resource-idle',idle:menuIdle()});}catch(_){}
  }
  function cacheLoadedResources(){
    const controller=navigator.serviceWorker.controller;
    if(!controller||!menuIdle())return;
    const urls=[];
    for(const entry of performance.getEntriesByType('resource')){
      try{
        const url=new URL(entry.name,location.href);
        if(url.origin!==location.origin||!url.pathname.startsWith(new URL('./',location.href).pathname)||url.pathname.includes('/api/')||/\.(?:mp3|wav|ogg|m4a)$/i.test(url.pathname)||reportedResources.has(url.href))continue;
        urls.push(url.href);if(urls.length>=128)break;
      }catch(_){}
    }
    if(!urls.length)return;
    try{controller.postMessage({type:'cache-loaded',urls});for(const url of urls)reportedResources.add(url);}catch(_){}
  }
  function checkControllerVersion(){
    const controller=navigator.serviceWorker.controller;if(!controller)return;
    const previous=hadController;hadController=true;
    const decide=version=>{
      if(navigator.serviceWorker.controller!==controller)return;
      const current=String(window.GALAXY_BUILD?.version||'');
      if(version&&current&&version!==current||!version&&previous){pendingUpdateReload=true;reloadForPendingUpdate();}
      else{notifyResourceMode();scheduleMaintenance();}
    };
    const fallback=()=>{let version='';try{version=new URL(controller.scriptURL).searchParams.get('v')||'';}catch(_){}decide(version);};
    if(typeof MessageChannel!=='function'){fallback();return;}
    const channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();fallback();},1500);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();decide(String(event.data?.version||''));};
    try{controller.postMessage({type:'resource-version'},[channel.port2]);}catch(_){clearTimeout(timer);channel.port1.close();fallback();}
  }

  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloadingForUpdate)return;
    reportedResources.clear();checkControllerVersion();
  });

  const mainMenu=document.getElementById('menu');
  if(mainMenu&&typeof MutationObserver==='function'){
    const menuObserver=new MutationObserver(()=>{reloadForPendingUpdate();notifyResourceMode();scheduleMaintenance();});
    menuObserver.observe(mainMenu,{attributes:true,attributeFilter:['class']});
  }

  async function refreshServiceWorker(){
    if(!registrationTask){scheduleMaintenance();return;}
    if(!menuIdle()||updateTask||Date.now()-lastUpdateAt<60000)return updateTask;
    lastUpdateAt=Date.now();
    updateTask=(async()=>{
    try{
      const reg=await navigator.serviceWorker.getRegistration('./');
      if(reg)await reg.update();
    }catch(_){}
    })();
    try{await updateTask;}finally{updateTask=null;}
  }
  function registerServiceWorker(){
    if(registrationTask||!menuIdle())return registrationTask;
    const swUrl=(window.GALAXY_BUILD&&typeof window.GALAXY_BUILD.versioned==='function')
      ?window.GALAXY_BUILD.versioned('./sw.js')
      :'./sw.js?v=V22.28';
    lastUpdateAt=Date.now();
    registrationTask=navigator.serviceWorker.register(swUrl,{updateViaCache:'none',scope:'./'})
      .then(()=>{notifyResourceMode();cacheLoadedResources();})
      .catch(err=>{registrationTask=null;console.warn('[PWA] Service worker no disponible:',err);});
    return registrationTask;
  }
  function scheduleMaintenance(){
    if(!menuIdle()||maintenanceJob!==null)return;
    const run=()=>{maintenanceJob=null;if(!menuIdle())return;registerServiceWorker();notifyResourceMode();cacheLoadedResources();};
    maintenanceJob=typeof requestIdleCallback==='function'?requestIdleCallback(run,{timeout:1200}):setTimeout(run,350);
  }
  window.addEventListener('load',async()=>{
    // Graphics and their first GPU preparation have priority over offline copies.
    try{await (window.GalaxyGraphicsLoader?.ready||window.Galaxy3D?.ready||Promise.resolve());}catch(_){return;}
    pageReady=true;notifyResourceMode();scheduleMaintenance();
  });

  // Al volver a la pestaña o ventana, comprobar si GitHub Pages ya tiene una
  // version nueva. Es barato y evita mantener una PWA abierta con version vieja.
  window.addEventListener('focus',()=>{refreshServiceWorker();scheduleMaintenance();});
  document.addEventListener('visibilitychange',()=>{notifyResourceMode();if(!document.hidden){refreshServiceWorker();scheduleMaintenance();}});
  window.addEventListener('pagehide',()=>{try{navigator.serviceWorker.controller?.postMessage({type:'resource-idle',idle:false});}catch(_){}});
})();
