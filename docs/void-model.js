/* Original Blender GLB. Motion is local presentation; combat stays in void-core. */
import {GLTFLoader} from './vendor/GLTFLoader.js';
// A local cutaway presentation. With no intro fields, warm-up/test actors use
// their normal combat pose; the authoritative collision geometry never tilts.
export function voidPresentation(body,reducedMotion=false){
  const active=Number.isFinite(body.introAge)&&!body.introComplete;
  const age=active?Math.max(0,body.introAge):8;
  const ease=(a,b)=>{const t=Math.max(0,Math.min(1,(age-a)/(b-a)));return t*t*(3-2*t);};
  return {active,tilt:active?(reducedMotion?.16:1.02)*(1-ease(1,4)):0,
    yaw:active?(reducedMotion?0:.24)*(1-ease(1,4)):0,
    roll:active?(reducedMotion?0:-.38)*(1-ease(1,4)):0,
    reveal:active?ease(3.6,5.4):1,shield:active?ease(6,7.5):1};
}
export async function loadVoidTemplate(T){
  const url=new URL('./assets/models/esfera-vacio.glb',import.meta.url);url.search=new URL(import.meta.url).search;
  const moduleURL=new URL('./void-decor.js',import.meta.url);moduleURL.search=new URL(import.meta.url).search;
  const [gltf,decor]=await Promise.all([new GLTFLoader().loadAsync(url.href),import(moduleURL.href)]);
  if(!gltf.scene.getObjectByName('VOID_ROOT'))throw new Error('Falta VOID_ROOT');
  return {station:gltf.scene,detail:await decor.loadVoidDecor(T),createDecor:decor.createVoidDecorFactory};
}
export function createVoidFactory(T,{template,environment=null,reducedMotion=false,combat=globalThis.window?.GalaxyVoidCore}={}){
  if(!combat)throw new Error('Falta la autoridad del laberinto');
  const stationTemplate=template.station||template;
  const createDecor=template.createDecor?template.createDecor(T,{template:template.detail,combat,environment,reducedMotion}):null;
  const geometries=new Set(),materials=new Set();
  stationTemplate.traverse(o=>{if(!o.isMesh)return;geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(environment&&m.metalness>0){m.envMap=environment;m.envMapIntensity=.65;}}});
  const shieldGeometry=new T.SphereGeometry(combat.SHIELD,24,16);geometries.add(shieldGeometry);
  const shieldMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.FrontSide,toneMapped:false,
    uniforms:{opacity:{value:.8},formation:{value:1}},
    vertexShader:'varying vec3 n;varying float h;void main(){n=normalMatrix*normal;h=position.y/'+combat.SHIELD.toFixed(1)+';gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec3 n;varying float h;uniform float opacity;uniform float formation;void main(){float edge=1.-abs(normalize(n).z);float sweep=formation*2.12-1.06;float cover=1.-smoothstep(sweep-.035,sweep+.035,h);float line=(1.-smoothstep(0.,.045,abs(h-sweep)))*step(.001,formation)*step(formation,.999);gl_FragColor=vec4(mix(vec3(.55,.3,1.),vec3(.65,.95,1.),line),opacity*((.025+.48*edge*edge)*cover+.7*line));}'
  });materials.add(shieldMaterial);
  // A closed, lightweight armor skin hides the old cutaway's underside during
  // the opening orbit. It dissolves with the roof, exposing the real GLB kit.
  const armorPixels=new Uint8Array(384*192*4);
  for(let y=0;y<192;y++)for(let x=0;x<384;x++){
    const row=Math.floor(y/16),u=(x+(row%2)*8)%16,v=y%16,cell=(Math.floor((x+(row%2)*8)/16)*7+row*11)%9;
    const seam=u===0||v===0,lip=u===1||v===1,base=seam?12:lip?100:53+cell*3,i=(y*384+x)*4;
    armorPixels[i]=base;armorPixels[i+1]=base+(seam?4:16);armorPixels[i+2]=base+(seam?8:27);armorPixels[i+3]=255;
  }
  const armorTexture=new T.DataTexture(armorPixels,384,192);armorTexture.colorSpace=T.SRGBColorSpace;armorTexture.needsUpdate=true;
  const armorGeometry=new T.SphereGeometry(combat.OUTER+35,64,32);geometries.add(armorGeometry);
  const create=()=>{
    const root=new T.Group(),axis=new T.Group(),station=stationTemplate.clone(true);axis.rotation.x=Math.PI/2;axis.add(station);root.add(axis);
    const decor=createDecor?.()||null;if(decor)root.add(decor.root);
    const part=name=>{const o=station.getObjectByName('VOID_'+name);if(!o)throw new Error('Falta VOID_'+name);return o;};
    const roof=part('ROOF'),core=part('CORE'),outer=part('OUTER_GATE'),inner=part('INNER_GATE'),gens=[0,1,2].map(i=>part('GENERATOR_'+i)),turrets=[0,1].map(i=>part('TURRET_'+i));
    // The original GLB's shutter arcs no longer describe this moving maze.
    // Build two batched walls directly from the authority's segments so the
    // generous opening, end posts and rotation match the actual collision hull.
    for(const name of ['OUTER_WALL','INNER_WALL','OUTER_GATE','INNER_GATE','CORRIDOR','CHAMBER'])part(name).visible=false;
    const wallMaterial=new T.MeshStandardMaterial({color:0x344b60,metalness:.7,roughness:.35,envMap:environment,envMapIntensity:.65,side:T.DoubleSide});
    const laneMaterial=new T.MeshBasicMaterial({color:0x65e8f1,toneMapped:false,side:T.DoubleSide}),floorMaterial=new T.MeshStandardMaterial({color:0x172932,metalness:.25,roughness:.65});
    materials.add(wallMaterial);materials.add(laneMaterial);materials.add(floorMaterial);
    const floorGeometry=new T.CircleGeometry(combat.OUTER-combat.WALL,72);geometries.add(floorGeometry);
    const floor=new T.Mesh(floorGeometry,floorMaterial);floor.position.z=-53;root.add(floor);
    const postGeometry=new T.CylinderGeometry(combat.WALL,combat.WALL,70,12);postGeometry.rotateX(Math.PI/2);geometries.add(postGeometry);
    function wall(segments){
      const group=new T.Group(),vertices=[],lights=[];
      const quad=(into,a,b,c,d)=>into.push(...a,...b,...c,...a,...c,...d);
      for(const s of segments){
        if(s.gate)continue;
        const length=Math.hypot(s.ax,s.ay),rad=(x,y,r,z)=>[x*r/length,-y*r/length,z],lo=length-combat.WALL,hi=length+combat.WALL;
        const a=rad(s.ax,s.ay,lo,20),b=rad(s.ax,s.ay,hi,20),c=rad(s.bx,s.by,hi,20),d=rad(s.bx,s.by,lo,20);
        quad(vertices,a,b,c,d);quad(vertices,[a[0],a[1],-50],a,d,[d[0],d[1],-50]);quad(vertices,b,[b[0],b[1],-50],[c[0],c[1],-50],c);
        quad(lights,rad(s.ax,s.ay,length-2,20.2),rad(s.ax,s.ay,length+2,20.2),rad(s.bx,s.by,length+2,20.2),rad(s.bx,s.by,length-2,20.2));
      }
      const add=(positions,material)=>{const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometries.add(geometry);group.add(new T.Mesh(geometry,material));};
      add(vertices,wallMaterial);add(lights,laneMaterial);
      for(let i=0;i<segments.length;i++)if(segments[i].gate!==segments[(i+1)%segments.length].gate){const s=segments[i],post=new T.Mesh(postGeometry,wallMaterial);post.position.set(s.bx,-s.by,-15);group.add(post);}
      root.add(group);return group;
    }
    const outerRing=wall(combat.walls.outer),innerRing=wall(combat.walls.inner);
    if(decor){outerRing.children[1].visible=false;innerRing.children[1].visible=false;}
    const barrierGeometry=new T.RingGeometry(combat.OUTER-10,combat.OUTER+10,24,1,Math.PI-combat.OPENING,combat.OPENING*2),barrierMaterial=new T.MeshBasicMaterial({color:0xa16eff,transparent:true,opacity:.65,depthWrite:false,toneMapped:false,side:T.DoubleSide});
    geometries.add(barrierGeometry);materials.add(barrierMaterial);
    const barrier=new T.Mesh(barrierGeometry,barrierMaterial);barrier.position.z=23;root.add(barrier);
    const navigation=station.getObjectByName('VOID_NAVIGATION');if(navigation)navigation.visible=false;
    // Compact gun bases sit on the inner wall's solid arc, above the deck.
    for(const turret of turrets){turret.scale.multiplyScalar(.6);if(decor)turret.visible=false;}
    core.scale.multiplyScalar(combat.CORE/65);
    const coreLights=new Map();
    core.traverse(o=>{if(!o.isMesh)return;const lamp=m=>{
      if(m.name!=='VOID_VIOLET')return m;
      if(!coreLights.has(m)){const copy=m.clone();coreLights.set(m,copy);materials.add(copy);}return coreLights.get(m);
    };o.material=Array.isArray(o.material)?o.material.map(lamp):lamp(o.material);});
    const roofMaterials=[];
    roof.traverse(o=>{if(!o.isMesh)return;const clone=m=>{const c=m.clone();c.transparent=true;c.depthWrite=false;c.side=T.DoubleSide;materials.add(c);roofMaterials.push(c);return c;};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);});
    const coreShieldMaterial=shieldMaterial.clone(),outerShieldMaterial=shieldMaterial.clone();outerShieldMaterial.uniforms.opacity.value=.6;materials.add(coreShieldMaterial);materials.add(outerShieldMaterial);
    const shield=new T.Mesh(shieldGeometry,coreShieldMaterial);shield.position.z=12;root.add(shield);
    const outerShield=new T.Mesh(shieldGeometry,outerShieldMaterial);outerShield.scale.setScalar((combat.OUTER+combat.WALL+4)/combat.SHIELD);root.add(outerShield);
    const armorMaterial=new T.MeshStandardMaterial({map:armorTexture,color:0xb8d1e0,metalness:.65,roughness:.42,envMap:environment,envMapIntensity:.8,transparent:true,depthWrite:false});materials.add(armorMaterial);
    const introHull=new T.Mesh(armorGeometry,armorMaterial);introHull.renderOrder=5;root.add(introHull);
    const hpGeometry=new T.PlaneGeometry(130,5),hpMaterial=new T.MeshBasicMaterial({color:0xc98bff,toneMapped:false}),backMaterial=new T.MeshBasicMaterial({color:0x182234});geometries.add(hpGeometry);materials.add(hpMaterial);materials.add(backMaterial);
    const back=new T.Mesh(hpGeometry,backMaterial),health=new T.Mesh(hpGeometry,hpMaterial);back.position.set(0,-108,75);health.position.set(0,-108,76);root.add(back,health);
    const arrowShape=new T.Shape();arrowShape.moveTo(-16,-8);arrowShape.lineTo(0,-8);arrowShape.lineTo(0,-17);arrowShape.lineTo(23,0);arrowShape.lineTo(0,17);arrowShape.lineTo(0,8);arrowShape.lineTo(-16,8);arrowShape.closePath();
    const arrowGeometry=new T.ShapeGeometry(arrowShape),openMaterial=new T.MeshBasicMaterial({color:0x5affd1,toneMapped:false}),closedMaterial=new T.MeshBasicMaterial({color:0xff6148,toneMapped:false});geometries.add(arrowGeometry);materials.add(openMaterial);materials.add(closedMaterial);
    const entryArrow=new T.Mesh(arrowGeometry,closedMaterial),innerArrow=new T.Mesh(arrowGeometry,closedMaterial);entryArrow.position.set(-438,0,45);innerArrow.position.set(268,0,45);innerArrow.rotation.z=Math.PI;root.add(entryArrow,innerArrow);
    const presentation=new T.Group();presentation.name='VOID_PRESENTATION';
    for(const child of [...root.children])presentation.add(child);root.add(presentation);
    const underside=station.getObjectByName('VOID_UNDERSIDE'),roofRest=roof.scale.clone(),undersideRest=underside?.scale.clone(),undersidePosition=underside?.position.clone();
    const update=b=>{
      const intro=voidPresentation(b,reducedMotion);
      presentation.rotation.set(intro.tilt,intro.yaw,intro.roll);
      decor?.update(b);
      const oa=b.outerAngle||0,ia=b.innerAngle||0;
      outerRing.rotation.z=-oa;innerRing.rotation.z=-ia;
      barrier.rotation.z=-oa;barrier.visible=b.outerGate<.98&&intro.shield>0;barrierMaterial.opacity=.65*intro.shield;
      entryArrow.position.set(-(combat.OUTER+28)*Math.cos(oa),(combat.OUTER+28)*Math.sin(oa),45);
      innerArrow.position.set((combat.INNER+30)*Math.cos(ia),-(combat.INNER+30)*Math.sin(ia),45);
      entryArrow.material=b.outerGate>.98?openMaterial:closedMaterial;innerArrow.material=openMaterial;
      entryArrow.rotation.z=-oa+(b.stage==='escape'?Math.PI:0);innerArrow.rotation.z=-ia+(b.stage==='escape'?0:Math.PI);
      // glTF Y is Blender Z. No scaled root: authored radii equal collision radii.
      const open=b.introComplete||b.roofOpen||b.inside||b.stage==='escape';
      const roofAlpha=intro.active?1-intro.reveal:open?0:1;roof.visible=!intro.active&&roofAlpha>.001;
      introHull.visible=intro.active&&roofAlpha>.001;armorMaterial.opacity=roofAlpha;
      for(const m of roofMaterials)m.opacity=roofAlpha;
      // Stretch only the presentation shell into a full sphere; restore the
      // authored shallow underside before any gameplay contacts are enabled.
      const round=intro.active?1-intro.reveal:0;
      roof.scale.copy(roofRest);roof.scale.x*=1+round*(combat.OUTER/407-1);roof.scale.z*=1+round*(combat.OUTER/407-1);roof.scale.y*=1+round*(combat.OUTER/205-1);
      if(underside){const depthScale=1+round*((combat.OUTER-55)/170-1);underside.scale.copy(undersideRest);underside.scale.x*=1+round*(combat.OUTER/407-1);underside.scale.z*=1+round*(combat.OUTER/407-1);underside.scale.y*=depthScale;underside.position.copy(undersidePosition);underside.position.y+=55*(depthScale-1);}
      for(let i=0;i<gens.length;i++){const g=b.generators[i];gens[i].visible=g.hp>0;gens[i].position.x=g.x-b.x;gens[i].position.z=g.y-b.y;}
      core.visible=b.stage!=='escape';core.rotation.y=reducedMotion?0:b.age*.35;
      for(const m of coreLights.values()){m.color.setHex(b.inside?0x18b858:0x8652b9);m.emissive.setHex(b.inside?0x18b858:0x8652b9);m.emissiveIntensity=b.inside?.65:1.25;}
      shield.visible=b.stage!=='escape'&&!b.inside&&intro.shield>0;
      outerShield.visible=b.stage!=='escape'&&b.outerGate<.98&&intro.shield>0;
      coreShieldMaterial.uniforms.formation.value=outerShieldMaterial.uniforms.formation.value=intro.shield;
      const pulse=reducedMotion?1:1+.025*Math.sin(b.age*4);shield.scale.setScalar(pulse);
      for(let i=0;i<turrets.length;i++){const gun=combat.turretPosition(b,i);turrets[i].position.set(gun.x-b.x,28,gun.y-b.y);turrets[i].rotation.y=-(b.aims?.[i]||0)-Math.PI/2;}
      const ratio=Math.max(0,b.hp/b.maxHp);hpMaterial.color.setHex(b.inside?0x80ffbc:0x667185);health.scale.x=ratio;health.position.x=-(1-ratio)*65;back.visible=health.visible=!intro.active&&open&&b.stage!=='escape';
      entryArrow.visible=innerArrow.visible=!intro.active;
    };
    return {root,update,roof,core,outer,inner,gens,shield,outerShield,introHull,presentation,outerRing,innerRing,turrets,entryArrow,innerArrow,health,decor};
  };
  create.dispose=()=>{createDecor?.dispose();armorTexture.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();};return create;
}
