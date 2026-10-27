'use strict';
(() => {
  const menu=document.getElementById('menu');
  const canvas=document.getElementById('menuDecor');
  if(!menu||!canvas)return;
  // The 2D context only composites the permanent WebGL scene into the menu.
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)return;
  const W=1920,H=1080;
  const isMobile=document.documentElement.classList.contains('handheld-device')||
    matchMedia('(pointer:coarse)').matches||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targetFrameMs=reducedMotion?100:(isMobile?42:33);
  let frame=0,lastPaint=0,resizeTimer=0,needsResize=true;

  function resize(){
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const dpr=Math.min(window.devicePixelRatio||1,isMobile?1.05:1.25);
    const maxW=isMobile?1100:1500;
    const rawW=rect.width*dpr,rawH=rect.height*dpr;
    const cap=Math.min(1,maxW/rawW);
    const targetW=Math.max(480,Math.round(rawW*cap));
    const targetH=Math.max(270,Math.round(rawH*cap));
    if(canvas.width!==targetW||canvas.height!==targetH){
      canvas.width=targetW;canvas.height=targetH;
    }
    const scale=Math.max(canvas.width/W,canvas.height/H);
    ctx.setTransform(scale,0,0,scale,(canvas.width-W*scale)/2,(canvas.height-H*scale)/2);
  }
  function canRender(){
    return !document.hidden&&!menu.classList.contains('hidden')&&window.Galaxy3D?.active===true;
  }
  function loop(now){
    frame=0;
    if(!canRender()){lastPaint=0;return;}
    frame=requestAnimationFrame(loop);
    if(lastPaint&&now-lastPaint<targetFrameMs)return;
    if(!lastPaint||needsResize){resize();needsResize=false;}
    lastPaint=now;
    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation='source-over';
    window.Galaxy3D.menu(ctx,now);
  }
  function sync(){
    if(!canRender()){
      if(frame)cancelAnimationFrame(frame);
      frame=0;lastPaint=0;
      return;
    }
    needsResize=true;
    if(!frame)frame=requestAnimationFrame(loop);
  }
  window.addEventListener('resize',()=>{
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(sync,120);
  },{passive:true});
  document.addEventListener('visibilitychange',sync);
  if(typeof MutationObserver==='function')new MutationObserver(sync).observe(menu,{attributes:true,attributeFilter:['class']});
  window.addEventListener('galaxy3d-ready',sync);
  window.addEventListener('galaxy3d-error',sync);
  sync();
})();
