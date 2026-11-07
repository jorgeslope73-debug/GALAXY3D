/* Authored low-poly GLBs. Presentation consumes authority snapshots only. */
import {GLTFLoader} from './vendor/GLTFLoader.js';

export const STORM_VISUAL_RADII=Object.freeze({core:122,satellite:42});
export function prepareStormTemplate(T,source,kind){
  const name=kind==='core'?'NUCLEO_ROOT':'SAT_ROOT';
  if(!source.getObjectByName(name))throw new Error('Falta '+name+' en el modelo del núcleo');
  const template=new T.Group(),level=new T.Group();
  template.name=kind==='core'?'nucleo-glb':'satelite-glb';
  // glTF +Y front -> game +Z front; authored Blender XY -> gameplay XY.
  level.rotation.x=Math.PI/2;level.add(source);template.add(level);
  template.updateMatrixWorld(true);
  const vertex=new T.Vector3();let radius=0;
  source.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++){vertex.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);radius=Math.max(radius,Math.hypot(vertex.x,vertex.y));}
  });
  if(!(radius>0&&Number.isFinite(radius)))throw new Error('Dimensiones inválidas del núcleo');
  template.scale.setScalar(STORM_VISUAL_RADII[kind]/radius);
  template.position.z=10;template.updateMatrixWorld(true);return template;
}

export async function loadStormTemplates(T){
  const loader=new GLTFLoader(),version=new URL(import.meta.url).search;
  const load=async(kind,file)=>{const url=new URL('./assets/models/'+file,import.meta.url);url.search=version;
    const gltf=await loader.loadAsync(url.href);return prepareStormTemplate(T,gltf.scene,kind);};
  const [core,satellite]=await Promise.all([load('core','nucleo.glb'),load('satellite','satelite.glb')]);
  return {core,satellite};
}

export function createStormFactory(T,{templates,environment=null,mobile=false,reducedMotion=false}={}){
  if(!templates?.core||!templates?.satellite)throw new Error('Los GLB del núcleo no están preparados');
  const light=new T.MeshBasicMaterial({color:0x89ecff,toneMapped:false});
  const dark=new T.MeshBasicMaterial({color:0x25334a});
  const warningMaterial=new T.MeshBasicMaterial({color:0xffad52,transparent:true,opacity:.17,depthWrite:false,side:T.DoubleSide,toneMapped:false});
  const shieldMaterial=new T.MeshBasicMaterial({color:0x837cff,transparent:true,opacity:.13,depthWrite:false,side:T.FrontSide,toneMapped:false});
  const geometry={halo:new T.TorusGeometry(170,1.5,4,mobile?32:48),
    shield:new T.SphereGeometry(170,mobile?16:24,12),pip:new T.BoxGeometry(8,5,3),ray:new T.PlaneGeometry(1,1)};
  const fan=new T.BufferGeometry();fan.setAttribute('position',new T.Float32BufferAttribute([0,0,0,Math.cos(.84)*780,Math.sin(.84)*780,0,Math.cos(.84)*780,-Math.sin(.84)*780,0],3));
  const ownedMaterials=new Set([light,dark,warningMaterial,shieldMaterial]),axis=new T.Vector3(0,1,0);
  const mesh=(parent,shape,material,x=0,y=0,z=0)=>{const m=new T.Mesh(shape,material);m.position.set(x,y,z);parent.add(m);return m;};
  const create=()=>{
    const root=new T.Group(),rotor=new T.Group();root.add(rotor);
    const core=templates.core.clone(true);rotor.add(core);
    const health=Array.from({length:6},(_,i)=>mesh(root,geometry.pip,light,-30+i*12,-142,65));
    const satellites=Array.from({length:3},()=>{
      const group=new T.Group();root.add(group);group.add(templates.satellite.clone(true));
      const pips=[-10,10].map(x=>mesh(group,geometry.pip,light,x,-50,40));
      return {group,pips};
    });
    // Geometry and textures stay shared; each encounter owns its animated materials.
    const materialCopies=new Map(),emissives=[];
    for(const visual of [core,...satellites.map(s=>s.group.children[0])])visual.traverse(o=>{
      if(!o.isMesh)return;
      const original=o.material;
      if(!materialCopies.has(original)){
        const copy=original.clone();
        if(environment){copy.envMap=environment;copy.envMapIntensity=.7;}
        materialCopies.set(original,copy);ownedMaterials.add(copy);
        if(/Energia|Violeta/.test(copy.name))emissives.push({material:copy,color:copy.emissive.clone(),intensity:copy.emissiveIntensity});
      }
      o.material=materialCopies.get(original);
    });
    const heart=new T.Group();heart.name='storm-energy-rotor';heart.position.y=.28;core.getObjectByName('NUCLEO_ROOT').add(heart);
    for(const name of ['CORE_Energy_Glow','CORE_Energy_Panels']){const part=core.getObjectByName(name);heart.add(part);part.position.y=-.28;}
    const pivots=Array.from({length:6},(_,i)=>{
      const pivot=core.getObjectByName('TURRET_'+String(i+1).padStart(2,'0')+'_PIVOT');
      if(!pivot)throw new Error('Falta el pivote de una torreta del núcleo');
      return {pivot,rest:i*Math.PI/3,heading:Math.PI/2+i*Math.PI/3};
    });
    const shield=mesh(root,geometry.shield,shieldMaterial),halo=mesh(root,geometry.halo,light);
    const tell=new T.Group();root.add(tell);
    const sector=mesh(tell,fan,warningMaterial,0,0,-25);
    const ray=mesh(tell,geometry.ray,warningMaterial,390,0,-22);ray.scale.set(780,3,1);
    const portal=mesh(root,geometry.halo,light,0,0,-35);
    return {root,update(body){
      root.visible=!!body&&body.hp>0;if(!root.visible)return;
      const age=Number(body.age)||0,charging=body.attack==='charging',enraged=!!body.enraged;
      const spin=reducedMotion?0:age*.08;rotor.rotation.z=spin;
      // The panels and luminous seams roll together around the authored centre.
      heart.rotation.set(reducedMotion?0:.18,reducedMotion?0:age*.55,reducedMotion?0:age*.22);
      for(const item of pivots){
        let yaw=0;
        if(body.warning?.slot===-1){const error=-body.warning.angle-spin-item.heading;yaw=Math.max(-.35,Math.min(.35,Math.atan2(Math.sin(error),Math.cos(error))));}
        item.pivot.quaternion.setFromAxisAngle(axis,item.rest+yaw);
      }
      light.color.setHex(charging?0xffad52:body.vulnerable?0xa5fff0:0x9dbaff);
      for(const item of emissives){
        if(charging)item.material.emissive.setHex(0xff8b25);
        else if(enraged)item.material.emissive.setHex(0xff285c);
        else if(body.vulnerable)item.material.emissive.setHex(0x16a7d9);
        else item.material.emissive.copy(item.color);
        item.material.emissiveIntensity=item.intensity*(charging?1.25:1);
      }
      shield.visible=!body.vulnerable;halo.visible=!body.vulnerable;shieldMaterial.opacity=charging?.19:.13;
      halo.rotation.set(.45,.18,reducedMotion?0:age*.08);
      health.forEach((pip,i)=>{pip.material=i<body.hp?light:dark;});
      body.satellites.forEach((part,i)=>{
        const sat=satellites[i];sat.group.visible=part.hp>0;
        sat.group.position.set(part.x-body.x,body.y-part.y,0);sat.group.rotation.z=reducedMotion?0:age*.35+i;
        sat.pips.forEach((pip,h)=>{pip.material=h<part.hp?light:dark;});
      });
      tell.visible=!!body.warning;
      if(body.warning){
        const warning=body.warning,source=warning.slot<0?body:body.satellites[warning.slot];
        tell.position.set(source.x-body.x,body.y-source.y,0);tell.rotation.z=-warning.angle;
        sector.visible=warning.slot<0;sector.scale.y=enraged?1:.66/.84;
        warningMaterial.opacity=.06+.12*(1-warning.remaining/warning.duration);
      }
      portal.visible=age<1.5;if(portal.visible)portal.scale.setScalar(1+age*1.2);
    }};
  };
  create.dispose=()=>{for(const g of Object.values(geometry))g.dispose();fan.dispose();for(const m of ownedMaterials)m.dispose();ownedMaterials.clear();};
  return create;
}
