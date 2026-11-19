/* Original Blender GLB. Motion is local presentation; combat stays in void-core. */
import {GLTFLoader} from './vendor/GLTFLoader.js';
export async function loadVoidTemplate(T){
  const url=new URL('./assets/models/esfera-vacio.glb',import.meta.url);url.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(url.href);
  if(!gltf.scene.getObjectByName('VOID_ROOT'))throw new Error('Falta VOID_ROOT');
  return gltf.scene;
}
export function createVoidFactory(T,{template,environment=null,reducedMotion=false,combat=globalThis.window?.GalaxyVoidCore}={}){
  if(!combat)throw new Error('Falta la autoridad del laberinto');
  const geometries=new Set(),materials=new Set();
  template.traverse(o=>{if(!o.isMesh)return;geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(environment&&m.metalness>0){m.envMap=environment;m.envMapIntensity=.65;}}});
  const shieldGeometry=new T.SphereGeometry(combat.SHIELD,24,16);geometries.add(shieldGeometry);
  const shieldMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.FrontSide,toneMapped:false,
    uniforms:{opacity:{value:.8}},
    vertexShader:'varying vec3 n;void main(){n=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec3 n;uniform float opacity;void main(){float edge=1.-abs(normalize(n).z);gl_FragColor=vec4(.55,.3,1.,opacity*(.08+.5*edge*edge));}'
  });materials.add(shieldMaterial);
  const create=()=>{
    const root=new T.Group(),axis=new T.Group(),station=template.clone(true);axis.rotation.x=Math.PI/2;axis.add(station);root.add(axis);
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
    const barrierGeometry=new T.RingGeometry(combat.OUTER-10,combat.OUTER+10,24,1,Math.PI-combat.OPENING,combat.OPENING*2),barrierMaterial=new T.MeshBasicMaterial({color:0xa16eff,transparent:true,opacity:.65,depthWrite:false,toneMapped:false,side:T.DoubleSide});
    geometries.add(barrierGeometry);materials.add(barrierMaterial);
    const barrier=new T.Mesh(barrierGeometry,barrierMaterial);barrier.position.z=23;root.add(barrier);
    const navigation=station.getObjectByName('VOID_NAVIGATION');if(navigation)navigation.position.y+=.5;
    // Guns sit low in the reactor room. Their bases and muzzles no longer
    // occupy the corridor; these are the same two positions used for firing.
    for(let i=0;i<turrets.length;i++){turrets[i].position.set(0,-18,(i?1:-1)*125);turrets[i].scale.multiplyScalar(.6);}
    core.scale.multiplyScalar(combat.CORE/65);
    const roofMaterials=[];
    roof.traverse(o=>{if(!o.isMesh)return;const clone=m=>{const c=m.clone();c.transparent=true;c.depthWrite=false;c.side=T.DoubleSide;materials.add(c);roofMaterials.push(c);return c;};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);});
    const shield=new T.Mesh(shieldGeometry,shieldMaterial);shield.position.z=12;root.add(shield);
    const hpGeometry=new T.PlaneGeometry(130,5),hpMaterial=new T.MeshBasicMaterial({color:0xc98bff,toneMapped:false}),backMaterial=new T.MeshBasicMaterial({color:0x182234});geometries.add(hpGeometry);materials.add(hpMaterial);materials.add(backMaterial);
    const back=new T.Mesh(hpGeometry,backMaterial),health=new T.Mesh(hpGeometry,hpMaterial);back.position.set(0,-108,75);health.position.set(0,-108,76);root.add(back,health);
    const arrowShape=new T.Shape();arrowShape.moveTo(-16,-8);arrowShape.lineTo(0,-8);arrowShape.lineTo(0,-17);arrowShape.lineTo(23,0);arrowShape.lineTo(0,17);arrowShape.lineTo(0,8);arrowShape.lineTo(-16,8);arrowShape.closePath();
    const arrowGeometry=new T.ShapeGeometry(arrowShape),openMaterial=new T.MeshBasicMaterial({color:0x5affd1,toneMapped:false}),closedMaterial=new T.MeshBasicMaterial({color:0xff6148,toneMapped:false});geometries.add(arrowGeometry);materials.add(openMaterial);materials.add(closedMaterial);
    const entryArrow=new T.Mesh(arrowGeometry,closedMaterial),innerArrow=new T.Mesh(arrowGeometry,closedMaterial);entryArrow.position.set(-438,0,45);innerArrow.position.set(268,0,45);innerArrow.rotation.z=Math.PI;root.add(entryArrow,innerArrow);
    const update=b=>{
      const oa=b.outerAngle||0,ia=b.innerAngle||0;
      outerRing.rotation.z=-oa;innerRing.rotation.z=-ia;
      barrier.rotation.z=-oa;barrier.visible=b.outerGate<.98;
      entryArrow.position.set(-438*Math.cos(oa),438*Math.sin(oa),45);
      innerArrow.position.set((combat.INNER+30)*Math.cos(ia),-(combat.INNER+30)*Math.sin(ia),45);
      entryArrow.material=b.outerGate>.98?openMaterial:closedMaterial;innerArrow.material=openMaterial;
      entryArrow.rotation.z=-oa+(b.stage==='escape'?Math.PI:0);innerArrow.rotation.z=-ia+(b.stage==='escape'?0:Math.PI);
      // glTF Y is Blender Z. No scaled root: authored radii equal collision radii.
      const open=b.roofOpen||b.inside||b.stage==='escape';roof.visible=!open;
      for(const m of roofMaterials)m.opacity=open?0:1;
      for(let i=0;i<gens.length;i++)gens[i].visible=b.generators[i].hp>0;
      core.visible=b.stage!=='escape';core.rotation.y=reducedMotion?0:b.age*.35;
      shield.visible=b.stage!=='escape'&&!b.inside;
      const pulse=reducedMotion?1:1+.025*Math.sin(b.age*4);shield.scale.setScalar(pulse);
      for(let i=0;i<turrets.length;i++)turrets[i].rotation.y=-(b.aims?.[i]||0)-Math.PI/2;
      const ratio=Math.max(0,b.hp/b.maxHp);health.scale.x=ratio;health.position.x=-(1-ratio)*65;back.visible=health.visible=open&&b.stage!=='escape';
    };
    return {root,update,roof,core,outer,inner,gens,shield,outerRing,innerRing,turrets,entryArrow,innerArrow};
  };
  create.dispose=()=>{for(const g of geometries)g.dispose();for(const m of materials)m.dispose();};return create;
}
