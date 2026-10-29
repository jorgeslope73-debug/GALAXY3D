/* Local turntable for the online series champion; shares the game's renderer. */
'use strict';
(() => {
  const victory=document.getElementById('victory');
  const champion=document.getElementById('seriesChampion');
  const canvas=document.getElementById('seriesChampionShip');
  if(!victory||!champion||!canvas)return;
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)return;
  const mobile=matchMedia('(pointer:coarse)').matches;
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frameMs=mobile?42:33,period=reducedMotion?24000:12000;
  let frame=0,lastPaint=null,startedAt=null,player=null;

  function canRender(){
    return !document.hidden&&!victory.classList.contains('hidden')&&
      !champion.classList.contains('hidden')&&window.Galaxy3D?.active===true&&
      /^[0-3]$/.test(canvas.dataset.player||'');
  }
  function resize(){
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,mobile?1.25:1.5);
    const width=Math.max(1,Math.round(rect.width*dpr));
    const height=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  }
  function loop(now){
    frame=0;
    if(!canRender()){sync();return;}
    frame=requestAnimationFrame(loop);
    if(lastPaint!==null&&now-lastPaint<frameMs)return;
    if(startedAt===null)startedAt=now;
    lastPaint=now;resize();
    const angle=((now-startedAt)%period)/period*Math.PI*2;
    window.Galaxy3D.winner(ctx,Number(canvas.dataset.player),angle);
  }
  function sync(){
    if(!canRender()){
      if(frame)cancelAnimationFrame(frame);
      frame=0;lastPaint=null;startedAt=null;player=null;
      return;
    }
    if(player!==canvas.dataset.player){
      player=canvas.dataset.player;startedAt=null;lastPaint=null;
      ctx.clearRect(0,0,canvas.width,canvas.height);
    }
    if(!frame)frame=requestAnimationFrame(loop);
  }
  const observer=new MutationObserver(sync);
  observer.observe(victory,{attributes:true,attributeFilter:['class']});
  observer.observe(champion,{attributes:true,attributeFilter:['class']});
  observer.observe(canvas,{attributes:true,attributeFilter:['data-player']});
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('resize',sync,{passive:true});
  window.addEventListener('galaxy3d-ready',sync);
  window.addEventListener('galaxy3d-error',sync);
  window.addEventListener('pagehide',()=>{
    if(frame)cancelAnimationFrame(frame);
    frame=0;lastPaint=null;startedAt=null;
  });
  window.addEventListener('pageshow',sync);
  sync();
})();
