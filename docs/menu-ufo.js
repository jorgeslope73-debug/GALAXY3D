/* Menu decoration only: this flight never enters gameplay or network state. */
export const MENU_UFO_RADIUS=80,MENU_UFO_CLEARANCE=40;
const W=1920,H=1080,SPEED=200;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});

export function menuFloaters(time,mobile=false){
  const rock=(id,x,y,size,type,role,anchorX=x,drift=0)=>({id,kind:'rock',x,y,size,type,role,safety:{x:anchorX,y,r:size*.59+drift}});
  const ship=(index,x,y,size,rotation,anchorY=y,drift=0)=>({id:'ship'+index,kind:'ship',index,x,y,size,rotation,safety:{x,y:anchorY,r:size*.56+drift}});
  const objects=[
    rock('menu1',(mobile?240:410)+Math.sin(time*.00012)*35,mobile?260:340,mobile?72:125,1,'large',mobile?240:410,35),
    rock('menu2',(mobile?1690:1490)+Math.cos(time*.0001)*25,245,mobile?60:88,3,'medium',mobile?1690:1490,25)
  ];
  if(!mobile)objects.push(rock('menu3',1240,465+Math.sin(time*.0002)*18,46,4,'fragment',1240,18));
  // The third rock drifts vertically; its envelope is centred on its rest position.
  if(!mobile)objects[2].safety.y=465;
  objects.push(ship(0,mobile?430:960,398+Math.sin(time*.001)*6,mobile?175:270,-28+Math.sin(time*.00035)*12,398,6));
  objects.push(ship(1,mobile?1500:1430,435,mobile?80:98,32));
  return objects;
}

function segmentClear(a,b,circles,extra=0){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  return circles.every(c=>{
    const t=length?clamp(((c.x-a.x)*dx+(c.y-a.y)*dy)/length,0,1):0;
    return Math.hypot(a.x+dx*t-c.x,a.y+dy*t-c.y)>=c.r+extra;
  });
}

function route(start,end,circles){
  const nodes=[start,end];
  for(const circle of circles)for(let i=0;i<16;i++){
    const angle=i*Math.PI/8,p={x:circle.x+Math.cos(angle)*(circle.r+18),y:circle.y+Math.sin(angle)*(circle.r+18)};
    if(p.x>=-170&&p.x<=W+170&&p.y>=-100&&p.y<=H+100&&segmentClear(p,p,circles))nodes.push(p);
  }
  const edges=nodes.map(()=>[]);
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(segmentClear(nodes[i],nodes[j],circles)){
    const mid=mix(nodes[i],nodes[j],.5),outside=Math.max(0,220-mid.y,mid.y-580)/220;
    const cost=distance(nodes[i],nodes[j])*(1+outside*.8);
    edges[i].push([j,cost]);edges[j].push([i,cost]);
  }
  const costs=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),used=new Set();costs[0]=0;
  while(used.size<nodes.length){
    let best=-1;
    for(let i=0;i<nodes.length;i++)if(!used.has(i)&&(best<0||costs[i]<costs[best]))best=i;
    if(best<0||!Number.isFinite(costs[best]))return null;
    if(best===1)break;
    used.add(best);
    for(const [next,cost] of edges[best])if(costs[best]+cost<costs[next]){costs[next]=costs[best]+cost;previous[next]=best;}
  }
  const path=[];for(let i=1;i>=0;i=previous[i]){path.unshift(nodes[i]);if(i===0)break;}
  return path[0]===start?path:null;
}

function roundedPath(points,circles){
  const result=[points[0]];let cursor=points[0];
  for(let i=1;i<points.length-1;i++){
    const corner=points[i],next=points[i+1];
    let trim=Math.min(42,distance(cursor,corner)*.25,distance(corner,next)*.25),curve=null;
    for(let attempt=0;attempt<6;attempt++,trim*=.5){
      const enter=mix(corner,cursor,trim/(distance(corner,cursor)||1)),leave=mix(corner,next,trim/(distance(corner,next)||1));
      const samples=[enter];
      for(let s=1;s<=12;s++){const t=s/12;samples.push(mix(mix(enter,corner,t),mix(corner,leave,t),t));}
      if(segmentClear(cursor,enter,circles)&&samples.every((p,n)=>!n||segmentClear(samples[n-1],p,circles))){curve=samples;break;}
    }
    if(curve){result.push(...curve);cursor=curve.at(-1);}else{result.push(corner);cursor=corner;}
  }
  result.push(points.at(-1));
  const arc=[0];for(let i=1;i<result.length;i++)arc.push(arc[i-1]+distance(result[i-1],result[i]));
  return {points:result,arc,length:arc.at(-1)};
}

function pathPoint(path,progress){
  const s=path.length*progress;let i=1;
  while(i<path.arc.length-1&&path.arc[i]<s)i++;
  return mix(path.points[i-1],path.points[i],(s-path.arc[i-1])/(path.arc[i]-path.arc[i-1]||1));
}

function planVisit(objects,rng){
  const circles=objects.map(o=>({...o.safety,r:o.safety.r+MENU_UFO_RADIUS+MENU_UFO_CLEARANCE}));
  const left=rng()<.5,start={x:left?-160:W+160,y:280+rng()*240};
  const end={x:left?W+160:-160,y:280+rng()*240};
  const legs=[],targets=new Set();let current=start;
  for(let visit=0;visit<2;visit++){
    const candidates=[];
    for(let index=0;index<objects.length;index++){
      if(targets.has(objects[index].id))continue;
      const c=circles[index];let best=null;
      for(let i=0;i<24;i++){
        const angle=i*Math.PI/12,p={x:c.x+Math.cos(angle)*(c.r+28),y:c.y+Math.sin(angle)*(c.r+28)};
        if(p.x<100||p.x>W-100||p.y<245||p.y>570||!segmentClear(p,p,circles))continue;
        const score=distance(current,p)+rng()*90;
        if(!best||score<best.score)best={point:p,target:objects[index].id,score};
      }
      if(best)candidates.push(best);
    }
    candidates.sort((a,b)=>a.score-b.score);
    let selected=null;
    for(const candidate of candidates){const points=route(current,candidate.point,circles);if(points){selected={...candidate,path:roundedPath(points,circles)};break;}}
    if(!selected)return null;
    legs.push({path:selected.path,target:selected.target,hold:1600+rng()*900});targets.add(selected.target);current=selected.point;
  }
  const exit=route(current,end,circles);if(!exit)return null;
  legs.push({path:roundedPath(exit,circles),target:null,hold:0});
  let at=0;
  for(const leg of legs){leg.start=at;leg.duration=Math.max(900,leg.path.length/SPEED*1500);at+=leg.duration+leg.hold;}
  return {legs,duration:at};
}

export function createMenuUfoFlight({random=Math.random,reducedMotion=false}={}){
  let clock=0,last=null,next=12000+random()*10000,flight=null;
  return {
    update(time,objects){
      if(reducedMotion)return null;
      if(last===null){last=time;return null;}
      const elapsed=time-last;last=time;
      // A hidden tab or a match must not fast-forward a decorative visit on return.
      if(elapsed<0||elapsed>500){if(flight){flight=null;next=clock+12000+random()*10000;}return null;}
      clock+=Math.max(0,elapsed);
      if(!flight&&clock>=next){const plan=planVisit(objects,random);if(!plan){next=clock+15000;return null;}flight={...plan,born:clock};}
      if(!flight)return null;
      const age=clock-flight.born;
      if(age>=flight.duration){flight=null;next=clock+60000+random()*40000;return null;}
      const leg=flight.legs.find(item=>age<item.start+item.duration+item.hold)||flight.legs.at(-1);
      const local=age-leg.start,observing=local>=leg.duration;
      const progress=clamp(local/leg.duration,0,1),ease=progress*progress*(3-2*progress);
      const p=pathPoint(leg.path,ease);
      const before=Math.max(0,progress-.001),after=Math.min(1,progress+.001);
      const a=pathPoint(leg.path,before*before*(3-2*before)),b=pathPoint(leg.path,after*after*(3-2*after));
      const seconds=(after-before)*leg.duration/1000||1;
      const vx=observing?0:(b.x-a.x)/seconds,vy=observing?0:(b.y-a.y)/seconds;
      let look=0,lookX=0,lookY=0;
      if(observing){
        const u=clamp((local-leg.duration)/leg.hold,0,1);look=Math.sin(u*Math.PI)**2;
        p.x+=2*look*Math.sin(u*Math.PI*4);p.y+=3*look*Math.sin(u*Math.PI*3);
        const target=objects.find(o=>o.id===leg.target);
        if(target){const d=Math.hypot(target.x-p.x,target.y-p.y)||1;lookX=(target.x-p.x)/d;lookY=(target.y-p.y)/d;}
      }
      return {...p,vx,vy,phase:observing?'observing':'flying',target:leg.target,
        bank:-vx/SPEED*.12-look*lookX*.09,pitch:-.98+vy/SPEED*.08+look*lookY*.10,
        angle:(clock*.072+70*Math.sin(clock*.0006+.8))%360};
    }
  };
}
