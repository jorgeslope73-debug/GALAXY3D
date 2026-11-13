/* Blender-authored low-poly serpent. All instances share GLB geometry/materials. */
import {GLTFLoader} from './vendor/GLTFLoader.js';

export const DEVOURER_RADII=Object.freeze({head:68,segment:39,joint:23});
export function prepareDevourerTemplate(T,source,kind){
  const node=source.getObjectByName('DEVOURER_'+kind.toUpperCase());
  if(!node)throw new Error('Falta DEVOURER_'+kind.toUpperCase());
  const root=new T.Group(),axis=new T.Group(),part=node.clone(true);
  // Blender can export the complete preview scene. Gameplay owns each root's
  // position and the jaw pose; keep the authored mesh/material edits underneath.
  part.position.set(0,0,0);
  for(let i=0;i<3;i++)part.getObjectByName('JAW_'+i)?.rotation.set(0,0,0);
  axis.rotation.x=Math.PI/2;axis.add(part);root.add(axis);
  root.updateMatrixWorld(true);const v=new T.Vector3();let radius=0;
  root.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);radius=Math.max(radius,Math.hypot(v.x,v.y));}
  });
  if(!(radius>0))throw new Error('Dimensiones invalidas del devorador');
  root.scale.setScalar(DEVOURER_RADII[kind]/radius);return root;
}
export async function loadDevourerTemplates(T){
  const url=new URL('./assets/models/devorador.glb',import.meta.url);url.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(url.href),templates={};
  const source=gltf.scenes.find(scene=>scene.getObjectByName('DEVOURER_HEAD'))||gltf.scene;
  for(const kind of ['head','segment','joint'])templates[kind]=prepareDevourerTemplate(T,source,kind);
  return templates;
}
export function createDevourerFactory(T,{templates,environment=null,reducedMotion=false}={}){
  if(!templates?.head||!templates?.segment||!templates?.joint)throw new Error('GLB del devorador pendiente');
  const materials=new Set(),geometries=new Set();
  for(const template of Object.values(templates))template.traverse(o=>{
    if(!o.isMesh)return;geometries.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:[o.material]){
      if(materials.has(m))continue;materials.add(m);
      if(environment&&m.metalness>0){m.envMap=environment;m.envMapIntensity=.65;}
    }
  });
  const weakMaterial=new T.MeshBasicMaterial({color:0xff9f32,toneMapped:false});
  const lockedMaterial=new T.MeshBasicMaterial({color:0x7b2716,toneMapped:false});
  const markerMaterial=new T.MeshBasicMaterial({color:0xff4b32,transparent:true,opacity:.8,depthWrite:false,toneMapped:false});
  materials.add(weakMaterial);materials.add(lockedMaterial);materials.add(markerMaterial);
  const ringGeometry=new T.TorusGeometry(28,1.8,4,24);geometries.add(ringGeometry);
  function create(){
    const root=new T.Group(),head=templates.head.clone(true);root.add(head);
    const jaws=Array.from({length:3},(_,i)=>head.getObjectByName('JAW_'+i));
    if(jaws.some(j=>!j))throw new Error('Faltan mandibulas del devorador');
    const segments=Array.from({length:5},()=>{
      const shell=templates.segment.clone(true),joint=templates.joint.clone(true);root.add(shell,joint);return {shell,joint};
    });
    const target=new T.Mesh(ringGeometry,markerMaterial);target.position.z=7;root.add(target);
    const update=body=>{
      head.rotation.z=-body.angle;head.position.z=20;
      const open=body.vulnerable?1:body.attack==='volley-warning'?.7:body.attack==='volley'?1:.08;
      for(const jaw of jaws)jaw.rotation.y=open*.60;
      for(let i=0;i<segments.length;i++){
        const record=segments[i],part=body.segments[i],visible=!!(part&&part.hp>0);
        record.shell.visible=record.joint.visible=visible;if(!visible)continue;
        record.shell.position.set(part.x-body.x,body.y-part.y,15);record.shell.rotation.z=-part.angle;
        record.joint.position.set(part.joint.x-body.x,body.y-part.joint.y,17);record.joint.rotation.z=-part.angle;
        const weak=body.weakSlot===part.slot;
        record.joint.traverse(o=>{if(o.isMesh)o.material=weak?weakMaterial:lockedMaterial;});
        const pulse=weak&&!reducedMotion?1+.09*Math.sin(body.age*8):1;
        record.joint.scale.setScalar(templates.joint.scale.x*pulse);
      }
      target.visible=body.attack==='charge-warning'&&Number.isFinite(body.warning?.targetX)&&Number.isFinite(body.warning?.targetY);
      if(target.visible){target.position.set(body.warning.targetX-body.x,body.y-body.warning.targetY,7);target.scale.setScalar(reducedMotion?1:1+.15*Math.sin(body.age*12));}
    };
    return {root,update,jaws,segments,target};
  }
  create.dispose=()=>{for(const g of geometries)g.dispose();for(const m of materials)m.dispose();materials.clear();geometries.clear();};
  return create;
}
