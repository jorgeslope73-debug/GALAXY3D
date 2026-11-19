/* Original Blender GLB. Motion is local presentation; combat stays in void-core. */
import {GLTFLoader} from './vendor/GLTFLoader.js';
export async function loadVoidTemplate(T){
  const url=new URL('./assets/models/esfera-vacio.glb',import.meta.url);url.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(url.href);
  if(!gltf.scene.getObjectByName('VOID_ROOT'))throw new Error('Falta VOID_ROOT');
  return gltf.scene;
}
export function createVoidFactory(T,{template,environment=null,reducedMotion=false}={}){
  const geometries=new Set(),materials=new Set();
  template.traverse(o=>{if(!o.isMesh)return;geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(environment&&m.metalness>0){m.envMap=environment;m.envMapIntensity=.65;}}});
  const shieldGeometry=new T.SphereGeometry(90,24,16);geometries.add(shieldGeometry);
  const shieldMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.FrontSide,toneMapped:false,
    uniforms:{opacity:{value:.8}},
    vertexShader:'varying vec3 n;void main(){n=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec3 n;uniform float opacity;void main(){float edge=1.-abs(normalize(n).z);gl_FragColor=vec4(.55,.3,1.,opacity*(.08+.5*edge*edge));}'
  });materials.add(shieldMaterial);
  const create=()=>{
    const root=new T.Group(),axis=new T.Group(),station=template.clone(true);axis.rotation.x=Math.PI/2;axis.add(station);root.add(axis);
    const part=name=>{const o=station.getObjectByName('VOID_'+name);if(!o)throw new Error('Falta VOID_'+name);return o;};
    const roof=part('ROOF'),core=part('CORE'),outer=part('OUTER_GATE'),inner=part('INNER_GATE'),gens=[0,1,2].map(i=>part('GENERATOR_'+i)),turrets=[0,1].map(i=>part('TURRET_'+i));
    const roofMaterials=[];
    roof.traverse(o=>{if(!o.isMesh)return;const clone=m=>{const c=m.clone();c.transparent=true;c.depthWrite=false;c.side=T.DoubleSide;materials.add(c);roofMaterials.push(c);return c;};o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);});
    const shield=new T.Mesh(shieldGeometry,shieldMaterial);shield.position.z=12;root.add(shield);
    const hpGeometry=new T.PlaneGeometry(130,5),hpMaterial=new T.MeshBasicMaterial({color:0xc98bff,toneMapped:false}),backMaterial=new T.MeshBasicMaterial({color:0x182234});geometries.add(hpGeometry);materials.add(hpMaterial);materials.add(backMaterial);
    const back=new T.Mesh(hpGeometry,backMaterial),health=new T.Mesh(hpGeometry,hpMaterial);back.position.set(0,-108,75);health.position.set(0,-108,76);root.add(back,health);
    const arrowShape=new T.Shape();arrowShape.moveTo(-16,-8);arrowShape.lineTo(0,-8);arrowShape.lineTo(0,-17);arrowShape.lineTo(23,0);arrowShape.lineTo(0,17);arrowShape.lineTo(0,8);arrowShape.lineTo(-16,8);arrowShape.closePath();
    const arrowGeometry=new T.ShapeGeometry(arrowShape),openMaterial=new T.MeshBasicMaterial({color:0x5affd1,toneMapped:false}),closedMaterial=new T.MeshBasicMaterial({color:0xff6148,toneMapped:false});geometries.add(arrowGeometry);materials.add(openMaterial);materials.add(closedMaterial);
    const entryArrow=new T.Mesh(arrowGeometry,closedMaterial),innerArrow=new T.Mesh(arrowGeometry,closedMaterial);entryArrow.position.set(-438,0,45);innerArrow.position.set(268,0,45);innerArrow.rotation.z=Math.PI;root.add(entryArrow,innerArrow);
    const update=b=>{
      outer.position.y=-95*b.outerGate;inner.position.y=-95*b.innerGate;
      entryArrow.material=b.outerGate>.98?openMaterial:closedMaterial;innerArrow.material=b.innerGate>.98?openMaterial:closedMaterial;
      entryArrow.rotation.z=b.stage==='escape'?Math.PI:0;
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
    return {root,update,roof,core,outer,inner,gens,shield};
  };
  create.dispose=()=>{for(const g of geometries)g.dispose();for(const m of materials)m.dispose();};return create;
}
