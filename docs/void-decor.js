/* Blender-authored interior kit. Cosmetic meshes never own combat or doors. */
import {GLTFLoader} from './vendor/GLTFLoader.js';

export async function loadVoidDecor(T){
  const url=new URL('./assets/models/esfera-interior.glb',import.meta.url);
  url.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(url.href);
  for(const name of ['WALL','TURRET_BASE','TURRET_HEAD','GATE_PYLON']){
    if(!gltf.scene.getObjectByName('VOID_DETAIL_'+name))throw new Error('Falta VOID_DETAIL_'+name);
  }
  return gltf.scene;
}

export function createVoidDecorFactory(T,{template,combat,environment=null,reducedMotion=false}={}){
  if(!template||!combat?.walls||!combat?.turretPosition)throw new Error('Interior de la esfera pendiente');
  const geometries=new Set(),materials=new Set(),materialCopies=new Map(),instanceMeshes=new Set();
  const axis=new T.Matrix4().makeRotationX(Math.PI/2);
  template.updateMatrixWorld(true);
  function copyMaterial(source){
    if(!materialCopies.has(source)){
      const material=source.clone();
      if(environment&&material.metalness>0){material.envMap=environment;material.envMapIntensity=.75;}
      materialCopies.set(source,material);materials.add(material);
    }
    return materialCopies.get(source);
  }
  function parts(kind){
    const node=template.getObjectByName('VOID_DETAIL_'+kind);
    if(!node)throw new Error('Falta pieza del interior: '+kind);
    const inverse=node.matrixWorld.clone().invert(),list=[];
    node.traverse(o=>{
      if(!o.isMesh)return;
      if(o.isSkinnedMesh||o.morphTargetInfluences?.length)throw new Error('Pieza del interior no rigida');
      const geometry=o.geometry.clone();
      geometry.applyMatrix4(axis.clone().multiply(inverse).multiply(o.matrixWorld));
      geometry.computeBoundingBox();geometry.computeBoundingSphere();geometries.add(geometry);
      const material=Array.isArray(o.material)?o.material.map(copyMaterial):copyMaterial(o.material);
      list.push({geometry,material,moving:/SLIDE|SHUTTER|PISTON/i.test(o.name),name:o.name});
    });
    if(!list.length)throw new Error('Pieza del interior sin geometria: '+kind);
    return list;
  }
  const library={wall:parts('WALL'),base:parts('TURRET_BASE'),head:parts('TURRET_HEAD'),gate:parts('GATE_PYLON')};
  const deckMaterial=new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,metalness:.58,roughness:.5,envMap:environment,envMapIntensity:.45});
  materials.add(deckMaterial);
  // One bevelled, vertex-coloured mesh supplies the metal deck. Shallow seams
  // remain well below ships and bullets; there is no navigation circle.
  const deckVertices=[],deckColors=[],deckNormals=[];
  const shades=[new T.Color(0x263c4b),new T.Color(0x304756),new T.Color(0x223440)];
  function face(a,b,c,d,color){
    const ab=new T.Vector3().fromArray(b).sub(new T.Vector3().fromArray(a));
    const ac=new T.Vector3().fromArray(c).sub(new T.Vector3().fromArray(a));
    const normal=ab.cross(ac).normalize();
    for(const v of [a,b,c,a,c,d]){deckVertices.push(...v);deckColors.push(color.r,color.g,color.b);deckNormals.push(normal.x,normal.y,normal.z);}
  }
  function deckBand(r0,r1,steps,band){
    for(let i=0;i<steps;i++){
      const a=i*Math.PI*2/steps+.009,b=(i+1)*Math.PI*2/steps-.009;
      const p=(r,t,z)=>[Math.cos(t)*r,Math.sin(t)*r,z];
      const outline=[p(r0,a,-51.8),p(r1,a,-51.8),p(r1,b,-51.8),p(r0,b,-51.8)];
      const cap=[p(r0+1.6,a+.004,-50.2),p(r1-1.6,a+.004,-50.2),p(r1-1.6,b-.004,-50.2),p(r0+1.6,b-.004,-50.2)];
      const color=shades[(i+band)%shades.length];face(...cap,color);
      for(let side=0;side<4;side++){const next=(side+1)%4;face(outline[side],outline[next],cap[next],cap[side],shades[2]);}
    }
  }
  const corridorFrom=combat.INNER+combat.WALL+4,corridorTo=combat.OUTER-combat.WALL-4;
  for(let band=0;band<3;band++){const width=(corridorTo-corridorFrom)/3;deckBand(corridorFrom+band*width+1,corridorFrom+(band+1)*width-1,48,band);}
  const chamberFrom=combat.CORE+38,chamberTo=combat.INNER-combat.WALL-4;
  for(let band=0;band<2;band++){const width=(chamberTo-chamberFrom)/2;deckBand(chamberFrom+band*width+1,chamberFrom+(band+1)*width-1,36,band+1);}
  const deckGeometry=new T.BufferGeometry();
  deckGeometry.setAttribute('position',new T.Float32BufferAttribute(deckVertices,3));
  deckGeometry.setAttribute('color',new T.Float32BufferAttribute(deckColors,3));
  deckGeometry.setAttribute('normal',new T.Float32BufferAttribute(deckNormals,3));
  deckGeometry.computeBoundingBox();deckGeometry.computeBoundingSphere();geometries.add(deckGeometry);
  const zAxis=new T.Vector3(0,0,1);
  function matrix(x,y,z,rotation=0,sx=1){return new T.Matrix4().compose(new T.Vector3(x,y,z),new T.Quaternion().setFromAxisAngle(zAxis,rotation),new T.Vector3(sx,1,1));}
  const create=()=>{
    const root=new T.Group();root.name='VOID_INTERIOR_DETAIL';
    const deck=new T.Mesh(deckGeometry,deckMaterial);deck.name='VOID_DETAILED_DECK';root.add(deck);
    function batches(partList,poses,parent,label){
      return partList.map(part=>{
        const mesh=new T.InstancedMesh(part.geometry,part.material,poses.length);
        instanceMeshes.add(mesh);
        mesh.name=label+'_'+part.name;
        mesh.instanceMatrix.setUsage(part.moving?T.DynamicDrawUsage:T.StaticDrawUsage);
        poses.forEach((pose,i)=>mesh.setMatrixAt(i,pose));
        mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();
        if(part.moving){mesh.boundingBox.expandByScalar(3);mesh.boundingSphere.radius+=3;}
        parent.add(mesh);
        return {mesh,part,poses};
      });
    }
    function makeRing(segments,label){
      const group=new T.Group();group.name='VOID_DETAIL_'+label;root.add(group);
      const wallPoses=[],gatePoses=[];
      for(let i=0;i<segments.length;i++){
        const s=segments[i],theta=Math.atan2(s.ay+s.by,s.ax+s.bx);
        if(!s.gate)wallPoses.push(matrix((s.ax+s.bx)/2,-(s.ay+s.by)/2,0,-theta-Math.PI/2,Math.hypot(s.bx-s.ax,s.by-s.ay)/40));
        if(s.gate!==segments[(i+1)%segments.length].gate){const at=Math.atan2(s.by,s.bx);gatePoses.push(matrix(s.bx,-s.by,0,-at-Math.PI/2));}
      }
      const walls=batches(library.wall,wallPoses,group,label+'_WALL');
      const gates=batches(library.gate,gatePoses,group,label+'_GATE');
      return {group,walls,gates};
    }
    const outer=makeRing(combat.walls.outer,'OUTER'),inner=makeRing(combat.walls.inner,'INNER');
    function component(list,label){const group=new T.Group();group.name=label;for(const part of list){const mesh=new T.Mesh(part.geometry,part.material);mesh.name=part.name;group.add(mesh);}root.add(group);return group;}
    const turrets=[0,1].map(slot=>({slot,base:component(library.base,'VOID_DETAIL_GUN_BASE_'+slot),head:component(library.head,'VOID_DETAIL_GUN_HEAD_'+slot)}));
    const slide=new T.Matrix4(),rise=new T.Matrix4();
    const update=body=>{
      outer.group.rotation.z=-(body.outerAngle||0);inner.group.rotation.z=-(body.innerAngle||0);
      for(const gun of turrets){
        const pose=combat.turretPosition(body,gun.slot),x=pose.x-body.x,y=body.y-pose.y;
        gun.base.position.set(x,y,20);gun.head.position.set(x,y,30);
        gun.base.rotation.z=-(body.innerAngle||0)-(gun.slot?1:-1)*Math.PI/2-Math.PI/2;
        gun.head.rotation.z=-(body.aims?.[gun.slot]||0)-Math.PI/2;
      }
      // Sliding actuator parts stay vertically retracted and within the solid
      // end post. They advertise machinery without ever closing a real gap.
      const lift=reducedMotion?0:1.5+.9*Math.sin((body.age||0)*.7);
      rise.makeTranslation(0,0,lift);
      for(const ring of [outer,inner])for(const batch of ring.gates){
        if(!batch.part.moving)continue;
        batch.poses.forEach((pose,i)=>{slide.copy(pose).premultiply(rise);batch.mesh.setMatrixAt(i,slide);});
        batch.mesh.instanceMatrix.needsUpdate=true;
      }
    };
    return {root,update,outerRing:outer.group,innerRing:inner.group,turrets,gateFrames:[...outer.gates,...inner.gates],wallBatches:[...outer.walls,...inner.walls],deck};
  };
  create.dispose=()=>{for(const mesh of instanceMeshes)mesh.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();instanceMeshes.clear();};
  return create;
}
