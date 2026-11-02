/* Distant menu scenery only. No physics, projectiles, AI or network state. */
export const MENU_MOTHERSHIP_DEPTH=-900;
// A complete hull stays outside the camera at both ends, before it can be drawn.
export const MENU_MOTHERSHIP_MARGIN=420;
const W=1920,MARGIN=MENU_MOTHERSHIP_MARGIN;
const menuTurrets=new WeakMap();
export function prepareMenuMothership(visual,mobile=false){
  visual.scale.multiplyScalar(mobile?.48:.64);
  const materials=new Map(),turrets=[];
  visual.traverse(object=>{
    if(/^AEGIS_Yaw_(Aft|Forward)_[LR]$/.test(object.name))turrets.push({pivot:object,rest:object.rotation.y});
    if(!object.isMesh)return;
    const original=object.material;
    if(!materials.has(original)){
      const material=original.clone();material.transparent=false;material.opacity=1;material.depthWrite=true;
      materials.set(original,material);
    }
    object.material=materials.get(original);
  });
  menuTurrets.set(visual,turrets);return visual;
}
export function setMenuMothershipPose(visual,pose){
  const direction=pose.direction||(Math.sin(pose.angle)>=0?1:-1);
  visual.rotation.set(0,-direction*Math.abs(pose.bank),-pose.angle,'ZYX');
  // Independent, gentle scans around each authored yaw null; menu presentation only.
  const age=Math.max(0,Number(pose.age)||0),turrets=menuTurrets.get(visual);
  if(turrets)for(let i=0;i<turrets.length;i++)turrets[i].pivot.rotation.y=turrets[i].rest+Math.sin(age*(.45+i*.04)+i*1.7)*22*Math.PI/180;
}
export function createMenuMothershipFlight({random=Math.random,reducedMotion=false}={}){
  let clock=0,last=null,next=24000+random()*12000,flight=null;
  return {
    get needsAssets(){return !reducedMotion&&clock>=6000;},
    update(time,ready=false){
      if(reducedMotion)return null;
      if(last===null){last=time;return null;}
      const elapsed=time-last;last=time;
      // Time in a match or a hidden tab cannot fast-forward the background ship.
      if(elapsed<0||elapsed>500){flight=null;next=Math.max(next,clock+24000);return null;}
      clock+=elapsed;
      if(!ready)return null;
      if(!flight&&clock>=next)flight={born:clock,duration:50000+random()*10000,direction:random()<.5?1:-1,y:320+random()*100,drift:(random()-.5)*30};
      if(!flight)return null;
      const age=clock-flight.born,progress=age/flight.duration;
      if(progress>=1){flight=null;next=clock+100000+random()*60000;return null;}
      const x=-MARGIN+(W+MARGIN*2)*progress;
      return {x:flight.direction>0?x:W-x,y:flight.y+flight.drift*(progress-.5)+Math.sin(age*.0004)*6,
        angle:flight.direction*Math.PI/2+Math.sin(age*.00028)*.025,
        bank:(80+3*Math.sin(age*.00022))*Math.PI/180,direction:flight.direction,age:age/1000};
    }
  };
}
