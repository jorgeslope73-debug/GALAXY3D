// Local presentation only: no authoritative projectile or collision state is changed.
const MAX_BOLTS=256,MAX_TARGETS=512;
const RANGE=260,HEIGHT=120,POWER=60000,SPACING=70;

export function createProjectileLighting(T,scene,{mobile=false}={}){
  const limit=mobile?2:4;
  // Keep every light in the scene, even at zero intensity. Changing the number
  // of visible lights would recompile material shaders during firing.
  const slots=Array.from({length:limit},()=>{
    const light=new T.PointLight(0x50ff78,0,RANGE,2);
    light.castShadow=false;scene.add(light);
    return {light,id:null,energy:0,used:false};
  });
  const bolts=Array.from({length:MAX_BOLTS},()=>({id:null,x:0,y:0,score:0}));
  const targets=Array.from({length:MAX_TARGETS},()=>({x:0,y:0,r:0}));
  const order=[],selected=[];
  let count=0,targetCount=0,contextKey='',lastTime=NaN,activeCount=0;
  const compare=(a,b)=>a.score-b.score;
  function clear(){
    for(const slot of slots){slot.id=null;slot.energy=0;slot.used=false;slot.light.intensity=0;}
    activeCount=0;lastTime=NaN;
  }
  function target(body,radius){
    if(!body||targetCount>=MAX_TARGETS||!Number.isFinite(body.x)||!Number.isFinite(body.y))return;
    const t=targets[targetCount++];t.x=body.x;t.y=body.y;t.r=radius;
  }
  return {
    limit,
    get activeCount(){return activeCount;},
    begin(snapshot,context='',giantRadius=189){
      count=targetCount=0;
      if(!snapshot||context!==contextKey){clear();contextKey=context;}
      if(!snapshot)return;
      for(const p of snapshot.players||[])if(!p.dead&&!(p.camo>0))target(p,p.shield>0?60:54);
      for(const a of snapshot.asteroids||[])target(a,Number(a.r)||45);
      for(const m of snapshot.meteors||[])target(m,14);
      target(snapshot.giant,giantRadius);
      for(const u of snapshot.ufos||(snapshot.ufo?[snapshot.ufo]:[]))target(u,30);
      for(const b of snapshot.bullets||[])if(b.g===true||b.guided===true)target(b,22);
    },
    addBolt(id,x,y){
      if(count>=MAX_BOLTS||!Number.isFinite(x)||!Number.isFinite(y))return;
      const b=bolts[count];b.id=id??count;b.x=x;b.y=y;count++;
    },
    update(time){
      const dt=Number.isFinite(lastTime)&&time>=lastTime?Math.min(50,time-lastTime):1000/60;
      lastTime=time;order.length=selected.length=0;
      for(let i=0;i<count;i++){
        const b=bolts[i];let gap=Infinity;
        for(let j=0;j<targetCount;j++){
          const t=targets[j],dx=b.x-t.x,dy=b.y-t.y,reach=RANGE+t.r;
          if(Math.abs(dx)>reach||Math.abs(dy)>reach)continue;
          const distance2=dx*dx+dy*dy;if(distance2>reach*reach)continue;
          gap=Math.min(gap,Math.max(0,Math.sqrt(distance2)-t.r));
          if(gap===0)break;
        }
        if(gap>=RANGE)continue;
        // A small preference for a light already following this bullet avoids
        // swapping between equally close shots at the pool limit.
        b.score=gap-(slots.some(s=>s.id===b.id)?12:0);order.push(b);
      }
      order.sort(compare);
      for(const b of order){
        if(selected.some(s=>s.id===b.id||(b.x-s.x)**2+(b.y-s.y)**2<SPACING*SPACING))continue;
        selected.push(b);if(selected.length===limit)break;
      }
      for(const slot of slots)slot.used=false;
      // Reserve continuing shots first, before assigning newly selected ones.
      for(const b of selected){
        const slot=slots.find(s=>s.id===b.id);
        if(slot)slot.used=true;
      }
      const blend=1-Math.exp(-dt/14);
      for(const b of selected){
        let slot=slots.find(s=>s.id===b.id);
        if(!slot){
          slot=slots.find(s=>!s.used);slot.id=b.id;slot.energy=0;slot.used=true;
        }
        let neighbours=0;
        for(const other of selected)if((b.x-other.x)**2+(b.y-other.y)**2<110*110)neighbours++;
        slot.energy+=(POWER/Math.max(1,neighbours)-slot.energy)*blend;
        slot.light.position.set(b.x-960,540-b.y,HEIGHT);
        slot.light.intensity=slot.energy;
      }
      activeCount=0;
      for(const slot of slots){
        if(!slot.used){slot.id=null;slot.energy=0;slot.light.intensity=0;}
        else if(slot.light.intensity>0)activeCount++;
      }
    },
    dispose(){
      clear();count=targetCount=0;order.length=selected.length=0;
      for(const slot of slots){scene.remove(slot.light);slot.light.dispose?.();}
    }
  };
}
