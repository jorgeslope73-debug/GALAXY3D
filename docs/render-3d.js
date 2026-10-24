/* GALAXY3D: presentation only. The host's 2D simulation remains authoritative. */
'use strict';
(() => {
  const W=1920,H=1080,TAU=Math.PI*2;
  const SHIP_VISUAL_SCALE=1.5;
  const SHIP_BANK_LIMIT=60*Math.PI/180;
  const mobile=document.documentElement.classList.contains('handheld-device')||matchMedia('(pointer: coarse)').matches||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const preferenceKey='galaxy3d-view-v1';
  const requested=new URLSearchParams(location.search).get('view');
  let enabled=true,world=null,failed=false,button=null,assetsComplete=false;
  let resolveAssetsReady;
  const assetsReady=new Promise(resolve=>{resolveAssetsReady=resolve;});
  try{enabled=(requested||localStorage.getItem(preferenceKey))!=='2d';}catch(_){enabled=requested!=='2d';}

  const labels={es:['VISTA 3D','VISTA 2D','Cambiar entre vista 3D y 2D'],en:['3D VIEW','2D VIEW','Switch between 3D and 2D'],fr:['VUE 3D','VUE 2D','Changer entre la vue 3D et 2D'],it:['VISTA 3D','VISTA 2D','Cambia tra vista 3D e 2D'],de:['3D ANSICHT','2D ANSICHT','Zwischen 3D und 2D wechseln'],zh:['3D 视图','2D 视图','切换 3D 和 2D 视图']};
  function updateUI(){
    const active=enabled&&assetsComplete&&world&&!world.lost;
    document.documentElement.dataset.galaxyView=active?'3d':'2d';
    if(!button)return;
    const language=window.GalaxyI18n?.getLanguage?.()||'es';
    const text=labels[language]||labels.es;
    button.textContent=active?text[0]:text[1];
    button.title=failed?'Vista 2D disponible en este dispositivo':text[2];
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-pressed',active?'true':'false');
    button.disabled=!assetsComplete||failed;
    button.classList.toggle('active',!!active);
  }
  function fallback(error){
    failed=true;
    if(world)world.lost=true;
    document.documentElement.dataset.galaxyModels='error';
    resolveAssetsReady({ok:false});
    updateUI();
    console.warn('[GALAXY3D] Se mantiene la vista 2D:',error?.message||error);
  }
  function setupUI(){
    const audio=document.getElementById('enableAudio');
    if(audio&&!document.getElementById('viewMode')){
      button=document.createElement('button');
      button.id='viewMode';button.type='button';
      audio.insertAdjacentElement('afterend',button);
      button.addEventListener('click',()=>{
        enabled=!enabled;
        try{localStorage.setItem(preferenceKey,enabled?'3d':'2d');}catch(_){}
        updateUI();
      });
    }
    updateUI();
  }
  window.addEventListener('galaxy-languagechange',updateUI);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setupUI,{once:true});
  else setupUI();

  window.Galaxy3D={
    ready:assetsReady,
    get requested(){return enabled;},
    get active(){return !!(enabled&&assetsComplete&&world&&!world.lost&&!failed);},
    get rocketTailOffset(){return world?.rocketTailOffset||10;},
    begin(ctx,now,snapshot,localIndex){
      if(!this.active)return null;
      try{world.begin(ctx,now,snapshot,localIndex);return world;}catch(error){fallback(error);return null;}
    },
    menu(ctx,now){
      if(!this.active)return false;
      try{world.menu(ctx,now);return true;}catch(error){fallback(error);return false;}
    },
    flush(ctx){
      if(!this.active)return false;
      try{world.flush(ctx);return true;}catch(error){fallback(error);return false;}
    }
  };

  // Vendored and pinned: no CDN dependency while starting a match or playing offline.
  document.documentElement.dataset.galaxyModels='loading';
  import('./vendor/three.module.min.js').then(async THREE=>{
    world=createWorld(THREE);
    await world.ready;
    if(world.lost)throw new Error('Se ha perdido el contexto 3D durante la carga');
    assetsComplete=true;
    document.documentElement.dataset.galaxyModels='ready';
    updateUI();
    resolveAssetsReady({ok:true});
    for(const event of ['galaxy3d-ready','galaxy3d-rocketready','galaxy3d-rockready','galaxy3d-modelready'])window.dispatchEvent(new Event(event));
  }).catch(fallback);

  function createWorld(T){
    const surface=document.createElement('canvas');
    const renderer=new T.WebGLRenderer({canvas:surface,alpha:true,antialias:!mobile,powerPreference:'high-performance'});
    renderer.setClearColor(0x000000,0);
    renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;
    renderer.toneMappingExposure=.85;
    const scene=new T.Scene();
    const camera=new T.OrthographicCamera(-W/2,W/2,H/2,-H/2,1,4000);
    camera.position.set(0,0,1800);
    camera.lookAt(0,0,0);
    scene.add(new T.HemisphereLight(0xffffff,0x555555,1.2));
    const key=new T.DirectionalLight(0xffffff,2);key.position.set(-450,600,1000);scene.add(key);
    const fill=new T.DirectionalLight(0xffffff,.6);fill.position.set(650,-280,450);scene.add(fill);
    const colors=[0x5ae1ff,0xff50a5,0x5aff78,0xff5d5d];
    const records=new Map(),spares=new Map();
    let createImportedShip=null,setImportedShipAmmo=null,createImportedRocket=null,createImportedMeteor=null;
    document.documentElement.dataset.galaxyShip='loading';
    document.documentElement.dataset.galaxyRock='loading';
    document.documentElement.dataset.galaxyRocket='loading';
    const matrix=new T.Matrix4(),position=new T.Vector3(),scale=new T.Vector3(),quaternion=new T.Quaternion(),euler=new T.Euler();
    const metal=(color,extra={})=>new T.MeshStandardMaterial({color,metalness:.48,roughness:.36,...extra});
    const glow=color=>new T.MeshBasicMaterial({color,toneMapped:false});
    const sphere=new T.SphereGeometry(1,mobile?12:20,mobile?8:12);
    const shieldGeometry=new T.SphereGeometry(1,mobile?24:40,mobile?16:24);
    const cylinder=new T.CylinderGeometry(1,1,1,8);
    const cone=new T.ConeGeometry(1,1,8);
    const box=new T.BoxGeometry(1,1,1);
    const ringGeometry=new T.TorusGeometry(1,.025,5,48);
    const shardGeometry=new T.TetrahedronGeometry(1);
    const boltMesh=new T.InstancedMesh(cylinder,glow(0x7affac),256);
    boltMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);boltMesh.frustumCulled=false;boltMesh.count=0;
    scene.add(boltMesh);
    const shardMesh=new T.InstancedMesh(shardGeometry,glow(0xffa64c),mobile?128:256);
    shardMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);shardMesh.frustumCulled=false;shardMesh.count=0;
    scene.add(shardMesh);
    const effects=new Map(),seenEffects=new Set();
    let now=0,contextKey='',poseContext='',lastSequence=-1,bolts=0;

    function add(group,geometry,material,x,y,z,sx=1,sy=sx,sz=sx){
      const mesh=new T.Mesh(geometry,material);
      mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);group.add(mesh);return mesh;
    }
    function hullGeometry(points,depth){
      const shape=new T.Shape();shape.moveTo(...points[0]);
      for(let i=1;i<points.length;i++)shape.lineTo(...points[i]);
      shape.closePath();
      return new T.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:1.4,bevelSize:1.4,bevelSegments:1,steps:1});
    }
    const hull=hullGeometry([[0,31],[-8,11],[-9,-22],[0,-18],[9,-22],[8,11]],5);
    const wings=hullGeometry([[-5,12],[-29,-20],[-10,-15],[0,-23],[10,-15],[29,-20],[5,12]],2);
    const tailFin=hullGeometry([[0,-8],[-4,-24],[0,-19],[4,-24]],5);

    function shipModel(index){
      const root=new T.Group(),tilt=new T.Group();root.add(tilt);
      const bodyRoot=new T.Group();tilt.add(bodyRoot);
      const body=metal(0xb5c6d6),trim=metal(colors[index]),dark=metal(0x1b293b),light=glow(colors[index]);
      add(bodyRoot,wings,trim,0,0,-3);
      add(bodyRoot,hull,body,0,0,0);
      add(bodyRoot,tailFin,trim,0,0,7);
      add(bodyRoot,cylinder,dark,-8,-22,0,4.8,10,4.8);
      add(bodyRoot,cylinder,dark,8,-22,0,4.8,10,4.8);
      const canopyMaterial=metal(0x51d9ff,{emissive:0x0c596b,emissiveIntensity:.7,metalness:.25,roughness:.16});
      const canopy=add(bodyRoot,sphere,canopyMaterial,0,9,7,5.8,10,4.5);
      add(bodyRoot,box,light,-23,-15,0,3,6,2);
      add(bodyRoot,box,light,23,-15,0,3,6,2);
      add(bodyRoot,box,dark,-7,19,0,2,14,2);
      add(bodyRoot,box,dark,7,19,0,2,14,2);
      const shieldMaterial=new T.ShaderMaterial({
        transparent:true,depthWrite:false,toneMapped:false,
        uniforms:{shieldColour:{value:new T.Color(0x78e8ff)},shieldOpacity:{value:1}},
        vertexShader:`
          varying vec3 shieldNormal;
          void main(){
            shieldNormal=normalMatrix*normal;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
          }
        `,
        fragmentShader:`
          uniform vec3 shieldColour;
          uniform float shieldOpacity;
          varying vec3 shieldNormal;
          void main(){
            // The overhead camera is orthographic: its view direction is +Z.
            float edge=1.0-clamp(abs(normalize(shieldNormal).z),0.0,1.0);
            float opacity=(0.025+0.42*pow(edge,2.0))*shieldOpacity;
            gl_FragColor=vec4(shieldColour,opacity);
            #include <colorspace_fragment>
          }
        `
      });
      const shield=add(root,shieldGeometry,shieldMaterial,0,0,0,40);
      shield.renderOrder=5;
      const shock=add(tilt,ringGeometry,glow(0xc5efff),0,22,10,8);
      const flare=add(tilt,box,glow(0xffb55a),0,-27,8,8,4,2.5);
      const mounts=[18,-18].map(x=>{
        const root=new T.Group();root.name=x>0?'rocket-hardpoint-right':'rocket-hardpoint-left';
        root.position.set(x,-7,4);tilt.add(root);
        add(root,box,dark,0,-1,-3,4,11,2);
        const fallback=add(root,cylinder,metal(colors[index]),0,0,0,2,22,2);
        root.visible=false;
        return {root,fallback,visual:null};
      });
      const materials=[];
      root.traverse(o=>{if(o.isMesh&&!materials.includes(o.material))materials.push(o.material);});
      for(const material of materials)rememberMaterial(material);
      return {root,tilt,bodyRoot,canopy,canopyMaterial,shield,shieldMaterial,shock,flare,mounts,materials};
    }
    function rememberMaterial(material){
      material.userData.galaxyBase={opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite};
    }
    function attachImportedShip(record,index){
      if(!createImportedShip||record.importedShip)return;
      const imported=createImportedShip(index);
      imported.traverse(object=>{
        if(!object.isMesh)return;
        for(const material of (Array.isArray(object.material)?object.material:[object.material])){
          if(record.materials.includes(material))continue;
          rememberMaterial(material);record.materials.push(material);
        }
      });
      record.tilt.add(imported);record.importedShip=imported;
      record.bodyRoot.visible=false;
    }
    function attachMountedRocket(record,index){
      if(!createImportedRocket)return;
      for(const mount of record.mounts){
        if(mount.visual)continue;
        const visual=createImportedRocket(index);visual.scale.setScalar(.6);
        mount.root.add(visual);mount.visual=visual;mount.fallback.visible=false;
        visual.traverse(object=>{
          if(!object.isMesh)return;
          if(!record.materials.includes(object.material)){
            rememberMaterial(object.material);record.materials.push(object.material);
          }
        });
      }
    }
    function attachFlyingRocket(record,owner){
      if(!createImportedRocket)return;
      const team=Math.max(0,Math.min(3,Math.trunc(Number(owner)||0)));
      if(record.importedRocket)record.importedRocket.visible=false;
      if(!record.rocketVariants.has(team)){
        const visual=createImportedRocket(team);record.rocketVariants.set(team,visual);record.roll.add(visual);
      }
      record.importedRocket=record.rocketVariants.get(team);record.importedRocket.visible=true;
      record.procedural.visible=false;
    }
    const assetVersion=window.GALAXY_BUILD?.version||'V23.35';
    const modelLoads=[];
    modelLoads.push(import('./rocket-model.js?v='+encodeURIComponent(assetVersion)).then(async assets=>{
      const template=await assets.loadRocketTemplate();
      createImportedRocket=assets.createRocketFactory(template);
      document.documentElement.dataset.galaxyRocket='cohete-glb';
    }).catch(error=>{
      document.documentElement.dataset.galaxyRocket='fallback';
      console.warn('[GALAXY3D] Se conserva el cohete de respaldo:',error?.message||error);
      throw error;
    }));
    modelLoads.push(import('./meteor-model.js?v='+encodeURIComponent(assetVersion)).then(async assets=>{
      const template=await assets.loadMeteorTemplate();
      createImportedMeteor=assets.createMeteorFactory(template);
      document.documentElement.dataset.galaxyRock='meteor-glb';
    }).catch(error=>{
      document.documentElement.dataset.galaxyRock='error';
      console.warn('[GALAXY3D] No se ha podido cargar meteor.glb:',error?.message||error);
      throw error;
    }));
    modelLoads.push(import('./ship-model.js?v='+encodeURIComponent(assetVersion)).then(async assets=>{
      const template=await assets.loadShipTemplate({strict:true});
      createImportedShip=assets.createShipFactory(template);
      setImportedShipAmmo=assets.setShipAmmoLights;
      document.documentElement.dataset.galaxyShip='nave-glb';
    }).catch(error=>{
      document.documentElement.dataset.galaxyShip='fallback';
      console.warn('[GALAXY3D] No se pudo cargar nave.glb; se conserva la nave de respaldo:',error?.message||error);
      throw error;
    }));
    function model(kind){
      if(kind.startsWith('ship:'))return shipModel(Number(kind.split(':')[1])||0);
      const root=new T.Group();
      if(kind==='rock'){
        const rock=createImportedMeteor();root.add(rock);
        return {root,rock};
      }
      if(kind==='rocket'){
        const roll=new T.Group(),procedural=new T.Group();root.add(roll);roll.add(procedural);
        const trim=metal(0x69d9ff),paint=metal(0x69d9ff);
        add(procedural,cylinder,paint,0,0,0,3.2,20,3.2);
        add(procedural,cone,paint,0,14,0,3.2,9,3.2);
        add(procedural,box,trim,0,-7,0,16,4,2);
        add(procedural,box,trim,0,-7,0,2,4,12);
        return {root,roll,procedural,trim,paint,rocketVariants:new Map()};
      }
      if(kind==='ufo'){
        add(root,sphere,metal(0xabb8ca),0,0,0,31,26,7);
        add(root,sphere,metal(0x6cf0c2,{emissive:0x164a3a,emissiveIntensity:.75}),0,0,5,14,13,10);
        for(let i=0;i<8;i++)add(root,sphere,glow(i%2?0x9b87ff:0x80f6ff),Math.cos(i*TAU/8)*25,Math.sin(i*TAU/8)*21,4,2.2);
        return {root};
      }
      if(kind==='pickup'){
        const material=glow(0x7be9ff);
        const torus=add(root,ringGeometry,material,0,0,0,26);
        return {root,torus,material};
      }
      return {root};
    }
    function take(kind,id){
      const key=kind+'|'+id;
      let record=records.get(key);
      if(!record){
        record=spares.get(kind)?.pop()||model(kind);
        record.kind=kind;record.turnPose=null;record.launchAt=now;record.launchContext=poseContext;
        if(!record.root.parent)scene.add(record.root);
        records.set(key,record);
      }
      record.used=true;record.root.visible=true;
      return record;
    }
    function place(root,x,y,z=0){root.position.set(x-W/2,H/2-y,z);}
    function turnBank(record,rotation,showcase){
      const context=poseContext+':'+showcase,previous=record.turnPose;
      const elapsed=previous?now-previous.time:0;
      let bank=0;
      if(!showcase&&!reducedMotion&&previous&&previous.context===context&&elapsed>0&&elapsed<=250){
        const delta=((rotation-previous.rotation)%360+540)%360-180;
        // Follow the shortest turn across 0/360; ignore sudden pose corrections.
        if(Math.abs(delta)<=Math.max(12,elapsed*.72)){
          const speed=delta*1000/elapsed;
          const turn=Math.max(-1,Math.min(1,speed/240));
          const target=-turn*Math.abs(turn)*SHIP_BANK_LIMIT;
          const response=target===0?240:280;
          bank=previous.bank+(target-previous.bank)*(1-Math.exp(-elapsed/response));
          if(Math.abs(bank)<.0001)bank=0;
        }
      }
      record.turnPose={rotation,time:now,bank,context};
      return bank;
    }
    function collectEffects(snapshot,localIndex){
      if(!snapshot)return;
      const nextContext=[snapshot.code,snapshot.seriesId,snapshot.hostEpoch,snapshot.round].join(':');
      if(nextContext!==contextKey||(Number.isFinite(snapshot.seq)&&snapshot.seq<lastSequence)){
        contextKey=nextContext;effects.clear();seenEffects.clear();
      }
      lastSequence=Number.isFinite(snapshot.seq)?snapshot.seq:lastSequence;
      for(const event of (snapshot.fx||[]).slice(-24)){
        const key=contextKey+':'+event.id;
        if(seenEffects.has(key))continue;
        seenEffects.add(key);
        if(event.hidden&&Number(event.i)!==Number(localIndex))continue;
        if(!Number.isFinite(event.x)||!Number.isFinite(event.y))continue;
        const age=Math.max(0,Number(event.age)||0),duration=event.kind==='explosion'?600:380;
        if(age>=duration)continue;
        effects.set(key,{x:event.x,y:event.y,born:now-age,duration,large:event.kind==='explosion',seed:Number(event.id)||1});
      }
      while(seenEffects.size>256)seenEffects.delete(seenEffects.values().next().value);
      while(effects.size>24)effects.delete(effects.keys().next().value);
    }
    function updateEffects(){
      let count=0;
      for(const [key,event] of effects){
        const t=(now-event.born)/event.duration;
        if(t<0||t>=1){effects.delete(key);continue;}
        const n=event.large?16:7;
        for(let i=0;i<n&&count<shardMesh.instanceMatrix.count;i++){
          const a=TAU*(i/n+event.seed*.037),travel=(event.large?68:26)*t;
          position.set(event.x-W/2+Math.cos(a)*travel,H/2-event.y+Math.sin(a)*travel,(Math.sin(a*3)+1)*18*t);
          euler.set(t*9+i,t*7,i);quaternion.setFromEuler(euler);
          scale.setScalar((event.large?3.4:2.0)*(1-t));
          matrix.compose(position,quaternion,scale);shardMesh.setMatrixAt(count++,matrix);
        }
      }
      shardMesh.count=count;shardMesh.instanceMatrix.needsUpdate=true;
    }
    const api={
      lost:false,
      shipScale:SHIP_VISUAL_SCALE,
      get rocketTailOffset(){return createImportedRocket?20:10;},
      begin(ctx,time,snapshot,localIndex){
        now=time;bolts=0;
        poseContext=snapshot?[snapshot.code,snapshot.seriesId,snapshot.hostEpoch,snapshot.round].join(':'):'menu';
        const width=Math.min(ctx.canvas.width,mobile?1280:1920);
        const height=Math.round(width*H/W);
        if(surface.width!==width||surface.height!==height)renderer.setSize(width,height,false);
        for(const record of records.values()){record.used=false;record.root.visible=false;}
        collectEffects(snapshot,localIndex);
      },
      rock(id,x,y,size,type=1,angle=0){
        const record=take('rock',id),variant=Math.abs(Number(type)||0)%6;
        record.root.scale.setScalar(size*.5);
        place(record.root,x,y,-8);
        const phase=(Number(String(id).replace(/\D/g,''))||variant)*.7;
        record.rock.rotation.set(now*.00013+phase,now*.00017+phase,angle*Math.PI/180+phase);
      },
      ship(index,x,y,rotation,size,alpha,thrust,armed,shield,flare,shock,missile,hit=0,showcase=false,missileCount=missile?1:0,hasAmmo=armed){
        const record=take('ship:'+index,index),root=record.root;
        attachImportedShip(record,index);
        attachMountedRocket(record,index);
        place(root,x,y,18);
        root.scale.setScalar(size/72*(showcase?1:SHIP_VISUAL_SCALE));
        root.rotation.z=rotation*Math.PI/180;
        // Bank only while turning; ease back to the overhead pose when the turn stops.
        const bank=turnBank(record,rotation,showcase);
        record.tilt.rotation.set(showcase?.38:0,showcase?Math.sin(now*.0006)*.30:bank,0);
        record.canopyMaterial.color.setHex(armed?0x8aff9d:0x58cfff);
        record.canopyMaterial.emissive.setHex(armed?0x287b36:0x0c596b);
        // Engine trails for thrust and turns use the existing particle system in game.js.
        record.shield.visible=!!shield;
        record.shock.visible=!!shock;record.flare.visible=!!flare;
        const mountedCount=Math.max(0,Math.min(2,Math.trunc(Number(missileCount)||0)));
        record.mounts.forEach((mount,i)=>{mount.root.visible=i<mountedCount;});
        if(record.importedShip)setImportedShipAmmo(record.importedShip,armed&&hasAmmo);
        for(const material of record.materials){
          if(material===record.shieldMaterial)continue;
          const base=material.userData.galaxyBase;
          material.transparent=base.transparent||alpha<.999;
          material.opacity=base.opacity*alpha;
          material.depthWrite=base.depthWrite&&alpha>.8;
        }
        record.shieldMaterial.uniforms.shieldOpacity.value=alpha*(Number(shield)||0);
        record.canopyMaterial.emissiveIntensity=hit>0?2:.75;
      },
      ufo(id,x,y,angle){
        const record=take('ufo',id);place(record.root,x,y,13);
        record.root.rotation.set(.22,Math.sin(now*.001)*.12,angle*Math.PI/180);
      },
      rocket(id,x,y,rotation,owner){
        const record=take('rocket',id);place(record.root,x,y,18);
        attachFlyingRocket(record,owner);
        if(record.launchContext!==poseContext||now<record.launchAt){record.launchAt=now;record.launchContext=poseContext;}
        record.root.rotation.z=rotation*Math.PI/180;
        record.roll.rotation.y=reducedMotion?0:((now-record.launchAt)*.001*TAU*1.6)%TAU;
        record.trim.color.setHex(colors[Math.max(0,Math.min(3,Number(owner)||0))]);
        record.paint.color.setHex(colors[Math.max(0,Math.min(3,Number(owner)||0))]);
      },
      bolt(x,y,vx,vy){
        if(bolts>=256)return;
        position.set(x-W/2,H/2-y,16);
        euler.set(0,0,Math.atan2(-vx,-vy));quaternion.setFromEuler(euler);
        scale.set(1.8,15,1.8);matrix.compose(position,quaternion,scale);
        boltMesh.setMatrixAt(bolts++,matrix);
      },
      pickup(id,x,y,type){
        const record=take('pickup',id);place(record.root,x,y,-8);
        record.material.color.setHex(({ammo1:0x7aff9c,ammo3:0x7aff9c,cadence:0xffbb69,speed:0x69d7ff,mira:0xff7ba1,flare:0xffb36a,camo:0xc4a2ff})[type]||0x8adfff);
        record.torus.rotation.set(.2,0,now*.0005);
      },
      flush(ctx){
        boltMesh.count=bolts;boltMesh.instanceMatrix.needsUpdate=true;
        updateEffects();
        for(const [key,record] of records){
          if(record.used)continue;
          record.root.visible=false;records.delete(key);
          if(!spares.has(record.kind))spares.set(record.kind,[]);
          spares.get(record.kind).push(record);
        }
        renderer.render(scene,camera);
        ctx.drawImage(surface,0,0,W,H);
        // Diagnostics describe the rendered scene, without exposing game authority.
        ctx.canvas.dataset.view='3d';
        ctx.canvas.dataset.meshes=String(renderer.info.render.calls);
        ctx.canvas.dataset.triangles=String(renderer.info.render.triangles);
        ctx.canvas.dataset.geometries=String(renderer.info.memory.geometries);
        ctx.canvas.dataset.shipModel=createImportedShip?'nave-glb':'procedural';
        ctx.canvas.dataset.rockMaterial=createImportedMeteor?'meteor-glb':'loading';
        ctx.canvas.dataset.rockModel=createImportedMeteor?'meteor-glb':'loading';
        ctx.canvas.dataset.rocketModel=createImportedRocket?'cohete-glb':'procedural';
      },
      menu(ctx,time){
        const t=reducedMotion?0:time;
        this.begin(ctx,time,null,-1);
        this.rock('menu1',(mobile?240:410)+Math.sin(t*.00012)*35,mobile?260:340,mobile?72:125,1);
        this.rock('menu2',(mobile?1690:1490)+Math.cos(t*.0001)*25,245,mobile?60:88,3);
        if(!mobile)this.rock('menu3',1240,465+Math.sin(t*.0002)*18,46,4);
        this.ship(0,mobile?430:960,398+Math.sin(t*.001)*6,-28+Math.sin(t*.00035)*12,mobile?125:194,1,true,true,false,false,false,false,0,true);
        this.ship(1,mobile?1500:1430,435,32,mobile?80:98,1,true,false,false,false,false,false,0,true);
        this.flush(ctx);
      }
    };
    api.ready=Promise.all(modelLoads).then(()=>{
      // Upload textures and compile the actual models behind the loading screen.
      const cache=document.createElement('canvas');cache.width=256;cache.height=144;
      const ctx=cache.getContext('2d');
      ctx.setTransform(256/W,0,0,144/H,0,0);
      for(let pass=0;pass<3;pass++){
        api.begin(ctx,pass*16,{code:'graphics-warmup',round:0,seq:pass,fx:[]},-1);
        for(let team=0;team<4;team++){
          api.ship(team,240+team*480,540,0,100,pass===2?.4:1,false,true,1,true,true,true,0,false,2,pass!==1);
          api.rocket('warm-rocket-'+team,240+team*480,800,0,team);
        }
        api.rock('warm-rock',960,230,100,1,0);
        api.flush(ctx);
      }
      // Leave the pool in its normal menu state before exposing the first frame.
      api.menu(ctx,0);
    });
    surface.addEventListener('webglcontextlost',event=>{event.preventDefault();api.lost=true;updateUI();});
    surface.addEventListener('webglcontextrestored',()=>{api.lost=false;updateUI();});
    window.addEventListener('beforeunload',()=>renderer.dispose(),{once:true});
    return api;
  }
})();
