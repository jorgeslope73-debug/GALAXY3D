import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareRocketTemplate,createRocketFactory,ROCKET_LENGTH} from '../docs/rocket-model.js';

const pbrFields=[
  'type','color','emissive','emissiveIntensity','metalness','roughness','vertexColors',
  'map','lightMap','lightMapIntensity','aoMap','aoMapIntensity','emissiveMap',
  'bumpMap','bumpScale','normalMap','normalMapType','normalScale','displacementMap','displacementScale','displacementBias',
  'roughnessMap','metalnessMap','alphaMap','envMap','envMapIntensity','envMapRotation',
  'opacity','transparent','alphaTest','alphaHash','side','flatShading','depthTest','depthWrite','premultipliedAlpha',
  'clearcoat','clearcoatMap','clearcoatRoughness','clearcoatRoughnessMap','clearcoatNormalMap','clearcoatNormalScale',
  'ior','reflectivity','iridescence','iridescenceMap','iridescenceIOR','iridescenceThicknessRange','iridescenceThicknessMap',
  'sheen','sheenColor','sheenColorMap','sheenRoughness','sheenRoughnessMap',
  'transmission','transmissionMap','thickness','thicknessMap','attenuationDistance','attenuationColor',
  'specularIntensity','specularIntensityMap','specularColor','specularColorMap','anisotropy','anisotropyRotation','anisotropyMap',
  'userData'
];
function materialState(material){
  return Object.fromEntries(pbrFields.filter(key=>key in material).map(key=>{
    const value=material[key];
    return [key,value?.isTexture?value:value?.toArray?value.toArray():value&&typeof value==='object'?JSON.parse(JSON.stringify(value)):value];
  }));
}
function samePbr(material,expected,label,environment){
  const actual=materialState(material),wanted={...expected};
  if(environment&&!wanted.envMap)wanted.envMap=environment;
  for(const key of Object.keys(wanted)){
    if(wanted[key]?.isTexture)assert.strictEqual(actual[key],wanted[key],label+': preserve texture '+key);
    else assert.deepEqual(actual[key],wanted[key],label+': preserve '+key);
  }
}
function geometryState(geometry){
  return {
    index:geometry.index?.array.slice(),
    attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([key,attribute])=>[key,attribute.array.slice()]))
  };
}
function collect(scene){const meshes=[];scene.traverse(object=>{if(object.isMesh)meshes.push(object);});return meshes;}
function near(a,b,label,tolerance=1e-4){assert.ok(Math.abs(a-b)<tolerance,label+': '+a+' != '+b);}

const bytes=await readFile(new URL('../docs/assets/models/cohete_galaxy_combat.glb',import.meta.url));
assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
assert.ok(json.buffers.every(buffer=>!buffer.uri),'The rocket must not need external buffers');
assert.ok(!json.animations?.length&&!json.skins?.length,'Expected the supplied static rocket');
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
gltf.scene.updateMatrixWorld(true);
const sourceMeshes=collect(gltf.scene),byMaterial=new Map(),ranges=new Map(),sourceGeometry=new Map(),sourceMaterials=new Map();
const alignment=new T.Matrix4().makeRotationX(-Math.PI/2),alignedBounds=new T.Box3();
let triangles=0,totalVertices=0;
for(const mesh of sourceMeshes){
  assert.ok(!Array.isArray(mesh.material),'The supplied part has one authored material');
  if(!byMaterial.has(mesh.material))byMaterial.set(mesh.material,{material:mesh.material,parts:[],count:0,triangles:0});
  const group=byMaterial.get(mesh.material),positions=mesh.geometry.attributes.position;
  const points=Array.from({length:positions.count},(_,i)=>new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(alignment));
  for(const point of points)alignedBounds.expandByPoint(point);
  const range={group,start:group.count,count:positions.count,name:mesh.name};
  ranges.set(mesh.name,range);group.parts.push({range,points});group.count+=positions.count;
  const partTriangles=(mesh.geometry.index?.count||positions.count)/3;group.triangles+=partTriangles;triangles+=partTriangles;totalVertices+=positions.count;
  sourceGeometry.set(mesh.geometry,geometryState(mesh.geometry));
  sourceMaterials.set(mesh.material,materialState(mesh.material));
}
assert.equal(sourceMeshes.length,38,'Load every authored rocket part');
assert.ok(byMaterial.size>1,'The new GLB contains distinct authored PBR materials');
const centreY=(alignedBounds.min.y+alignedBounds.max.y)/2,factor=ROCKET_LENGTH/(alignedBounds.max.y-alignedBounds.min.y);
const template=prepareRocketTemplate(gltf.scene),meshes=collect(template),groups=Array.from(byMaterial.values());
assert.equal(meshes.length,groups.length,'Only parts sharing an authored material may be merged');
assert.ok(meshes.length<=sourceMeshes.length,'Grouping must not increase mesh count');
for(let groupIndex=0;groupIndex<groups.length;groupIndex++){
  const group=groups[groupIndex],mesh=meshes[groupIndex],position=mesh.geometry.attributes.position;
  group.template=mesh;
  assert.equal(position.count,group.count,'Merging preserves all vertices in each material group');
  assert.equal((mesh.geometry.index?.count||position.count)/3,group.triangles,'Merging preserves every triangle');
  assert.notStrictEqual(mesh.material,group.material,'The template clones each authored material');
  samePbr(mesh.material,sourceMaterials.get(group.material),'Grouped material '+groupIndex);
  assert.ok(mesh.material.vertexColors&&mesh.geometry.attributes.color,'Keep the authored vertex colours');
  for(const {range,points} of group.parts)for(let i=0;i<points.length;i++){
    near(position.getX(range.start+i),points[i].x*factor,'Preserve authored X');
    near(position.getY(range.start+i),(points[i].y-centreY)*factor,'Preserve authored Y');
    near(position.getZ(range.start+i),points[i].z*factor,'Preserve authored Z');
  }
}
const size=new T.Box3().setFromObject(template).getSize(new T.Vector3());
near(size.y,ROCKET_LENGTH,'Rocket length remains40');
assert.ok(size.y>size.x&&size.y>size.z,'Align the long axis to game Y');
for(const [name,front] of [['nose_highlight_trim',true],['dark_exhaust_mouth',false]]){
  const range=ranges.get(name);assert.ok(range,'Missing authored part '+name);
  const position=range.group.template.geometry.attributes.position;
  for(let i=range.start;i<range.start+range.count;i++)assert.ok(front?position.getY(i)>19:position.getY(i)<-19,'Nose faces +Y and exhaust -Y');
}
const body=ranges.get('body_core'),bodyPosition=body.group.template.geometry.attributes.position,axis=new T.Vector3();
for(let i=body.start;i<body.start+body.count;i++)axis.add(new T.Vector3().fromBufferAttribute(bodyPosition,i));
axis.divideScalar(body.count);assert.ok(Math.abs(axis.x)<1e-5&&Math.abs(axis.z)<1e-5,'The cylindrical body stays on the roll axis');

const templateGeometry=meshes.map(mesh=>geometryState(mesh.geometry));
const factory=createRocketFactory(template),first=collect(factory()),second=collect(factory());
const environment=new T.Texture(),litFactory=createRocketFactory(template,environment);
for(let i=0;i<meshes.length;i++){
  assert.strictEqual(first[i].geometry,second[i].geometry,'Unpainted instances share geometry');
  assert.notStrictEqual(first[i].material,second[i].material,'Each rocket owns its opacity');
  assert.notStrictEqual(first[i].material,meshes[i].material,'Instances do not own template materials');
  samePbr(first[i].material,materialState(meshes[i].material),'Unpainted instance '+i);
  first[i].material.opacity=.42;first[i].material.transparent=true;
  samePbr(second[i].material,materialState(meshes[i].material),'Another rocket stays independent '+i);
}
const painted=[0,1,2,3].map(index=>collect(litFactory(index)));
const teamColours=[0x28bce8,0xf232a3,0x47df3f,0xffd83d].map(hex=>new T.Color(hex));
const bodyGroup=groups.indexOf(body.group),bodyColours=painted.map(visual=>new T.Vector3().fromBufferAttribute(visual[bodyGroup].geometry.attributes.color,body.start));
assert.ok(bodyColours[0].z>bodyColours[0].x&&bodyColours[0].y>bodyColours[0].x,'Player1 paint is blue');
assert.ok(bodyColours[1].x>bodyColours[1].y&&bodyColours[1].z>bodyColours[1].y,'Player2 paint is fuchsia');
assert.ok(bodyColours[2].y>bodyColours[2].x&&bodyColours[2].y>bodyColours[2].z,'Player3 paint is green');
assert.ok(bodyColours[3].x>bodyColours[3].z*3&&bodyColours[3].y>bodyColours[3].z*3,'Player4 paint is yellow');
let paintedVertices=0,detailVertices=0;
for(const [team,visual] of painted.entries()){
  const repeat=collect(litFactory(team));
  for(let i=0;i<meshes.length;i++){
    const authored=meshes[i].geometry,coloured=visual[i].geometry;
    assert.strictEqual(coloured,repeat[i].geometry,'Repeated team rockets share cached geometry');
    assert.notStrictEqual(coloured,painted[(team+1)%4][i].geometry,'Team colour buffers remain independent');
    assert.notStrictEqual(visual[i].material,repeat[i].material,'Cached team geometry never shares mutable opacity');
    samePbr(visual[i].material,materialState(meshes[i].material),'Team'+team+' material'+i,environment);
    const attributes=geometryState(coloured);delete attributes.attributes.color;
    const original=geometryState(authored);delete original.attributes.color;
    assert.deepEqual(attributes,original,'Painting changes neither shape nor normals/UVs/index');
    const a=authored.attributes.color,b=coloured.attributes.color;
    for(let v=0;v<a.count;v++){
      const paint=a.getX(v)>a.getY(v)*3&&a.getZ(v)>a.getY(v)*3&&a.getX(v)>a.getZ(v);
      if(paint){
        paintedVertices++;
        const colour=new T.Vector3(b.getX(v),b.getY(v),b.getZ(v)),tone=teamColours[team],hue=new T.Vector3(tone.r,tone.g,tone.b);
        assert.ok(colour.dot(hue)>0&&colour.clone().cross(hue).length()<colour.length()*hue.length()*1e-5,'Every painted vertex keeps the selected team hue and authored shading');
        continue;
      }
      detailVertices++;
      for(let channel=0;channel<3;channel++)assert.equal(b.getComponent(v,channel),a.getComponent(v,channel),'Preserve non-paint metal, seams and lamps');
    }
    visual[i].material.opacity=.21;visual[i].material.transparent=true;
    samePbr(repeat[i].material,materialState(meshes[i].material),'Another mounted/team rocket stays opaque',environment);
  }
}
assert.ok(paintedVertices>0&&detailVertices>0,'The real GLB exercises both paint and untouched details');
for(const [geometry,state] of sourceGeometry)assert.deepEqual(geometryState(geometry),state,'Preparation does not mutate original GLB geometry');
for(const [material,state] of sourceMaterials)samePbr(material,state,'Original GLB material stays untouched');
for(let i=0;i<meshes.length;i++){
  assert.deepEqual(geometryState(meshes[i].geometry),templateGeometry[i],'Factories never mutate template vertex buffers');
  samePbr(meshes[i].material,sourceMaterials.get(groups[i].material),'Factory leaves template PBR untouched');
}

// The real GLB currently uses Standard materials without maps. Exercise a
// textured Physical material separately so later authored exports keep their
// clearcoat/transmission/IOR/maps instead of silently becoming generic metal.
const maps=Object.fromEntries(['map','normalMap','metalnessMap','roughnessMap','emissiveMap','alphaMap','clearcoatMap','clearcoatNormalMap','transmissionMap','thicknessMap','specularColorMap','iridescenceMap','sheenColorMap','anisotropyMap'].map(name=>[name,new T.Texture()]));
const authoredEnvironment=new T.Texture();
const physical=new T.MeshPhysicalMaterial({
  ...maps,color:0xc875d3,emissive:0x927723,emissiveIntensity:2.3,metalness:.83,roughness:.17,
  clearcoat:.74,clearcoatRoughness:.23,ior:1.72,iridescence:.41,iridescenceIOR:1.4,iridescenceThicknessRange:[140,420],
  sheen:.38,sheenColor:0x24436a,sheenRoughness:.26,transmission:.33,thickness:.62,attenuationDistance:3.2,attenuationColor:0x6fa7c1,
  specularIntensity:.57,specularColor:0xe89834,anisotropy:.35,anisotropyRotation:.67,vertexColors:true,normalScale:new T.Vector2(.43,.81),
  clearcoatNormalScale:new T.Vector2(.21,.46),envMap:authoredEnvironment,envMapIntensity:.76,side:T.DoubleSide
});
physical.userData={authoredPbr:'retained'};
const standard=new T.MeshStandardMaterial({vertexColors:true,metalness:.61,roughness:.29});
const synthetic=new T.Group(),geometry=new T.CylinderGeometry(1,1,12,8);geometry.rotateX(Math.PI/2);
const colours=new Float32Array(geometry.attributes.position.count*3);
for(let i=0;i<colours.length;i+=3)colours.set([.95,.12,.62],i);
geometry.setAttribute('color',new T.BufferAttribute(colours,3));
synthetic.add(new T.Mesh(geometry,physical));
const other=new T.Mesh(geometry,standard);other.position.x=3;synthetic.add(other);
const originals=[materialState(physical),materialState(standard)],syntheticGeometry=geometryState(geometry);
const physicalTemplate=prepareRocketTemplate(synthetic),physicalMeshes=collect(physicalTemplate),physicalFactory=createRocketFactory(physicalTemplate,environment);
assert.equal(physicalMeshes.length,2,'Different PBR materials stay distinct');
for(const team of [0,1,2,3]){
  const instance=collect(physicalFactory(team));
  for(let i=0;i<instance.length;i++){
    samePbr(physicalMeshes[i].material,originals[i],'Synthetic template'+i);
    samePbr(instance[i].material,originals[i],'Physical team'+team+' material'+i,environment);
    assert.equal(instance[i].material.isMeshPhysicalMaterial,i===0?true:undefined,'Keep Physical/Standard class');
  }
  assert.strictEqual(instance[0].material.envMap,authoredEnvironment,'An authored environment overrides the shared fallback');
  assert.strictEqual(instance[1].material.envMap,environment,'Unmapped material receives the shared environment');
}
samePbr(physical,originals[0],'Original Physical material');samePbr(standard,originals[1],'Original Standard material');
assert.deepEqual(geometryState(geometry),syntheticGeometry,'Synthetic input geometry remains untouched');

console.log(`Rocket GLB OK: ${sourceMeshes.length} parts -> ${meshes.length} material groups; ${totalVertices} vertices; ${triangles} triangles; length40; nose +Y; stable roll axis`);
console.log('Rocket PBR OK: authored scalars/maps/Physical properties, original materials, four paints, shared environments and independent opacity');
