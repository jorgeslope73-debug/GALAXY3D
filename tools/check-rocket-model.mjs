import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareRocketTemplate,createRocketFactory,ROCKET_LENGTH} from '../docs/rocket-model.js';

const bytes=await readFile(new URL('../docs/assets/models/cohete_galaxy_combat.glb',import.meta.url));
assert.equal(bytes.toString('ascii',0,4),'glTF');
assert.equal(bytes.readUInt32LE(4),2);
assert.equal(bytes.readUInt32LE(8),bytes.length);
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
assert.ok(json.buffers.every(buffer=>!buffer.uri),'The rocket must not need external buffers');
assert.ok(!json.animations?.length&&!json.skins?.length,'Expected the supplied static rocket');
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
let offset=0,triangles=0,sourceMeshes=0;
const ranges={};
gltf.scene.traverse(object=>{
  if(!object.isMesh)return;
  ranges[object.name]={start:offset,count:object.geometry.attributes.position.count};
  offset+=object.geometry.attributes.position.count;
  triangles+=(object.geometry.index?.count||object.geometry.attributes.position.count)/3;
  sourceMeshes++;
});
const template=prepareRocketTemplate(gltf.scene);
assert.equal(template.children.length,1,'The 38 supplied parts must draw as one mesh');
const mesh=template.children[0],position=mesh.geometry.attributes.position;
assert.equal(position.count,offset,'Merging must preserve every vertex');
assert.equal(mesh.geometry.index.count/3,triangles,'Merging must preserve every triangle');
assert.ok(mesh.material.vertexColors&&mesh.geometry.attributes.color,'Keep the supplied vertex colours');
const size=mesh.geometry.boundingBox.getSize(new T.Vector3());
assert.ok(Math.abs(size.y-ROCKET_LENGTH)<1e-4&&size.y>size.x&&size.y>size.z,'Align the long axis to game Y');
for(const [name,front] of [['nose_highlight_trim',true],['dark_exhaust_mouth',false]]){
  const range=ranges[name];assert.ok(range,'Missing authored rocket part '+name);
  for(let i=range.start;i<range.start+range.count;i++)assert.ok(front?position.getY(i)>19:position.getY(i)<-19,'Nose must face forwards and nozzle backwards');
}
const body=ranges.body_core,axis=new T.Vector3();
for(let i=body.start;i<body.start+body.count;i++)axis.add(new T.Vector3().fromBufferAttribute(position,i));
axis.divideScalar(body.count);
assert.ok(Math.abs(axis.x)<1e-5&&Math.abs(axis.z)<1e-5,'Keep the cylinder on the roll axis without orbiting');
const factory=createRocketFactory(template),first=factory(),second=factory();
assert.equal(first.children[0].geometry,second.children[0].geometry,'Instances share geometry');
assert.notEqual(first.children[0].material,second.children[0].material,'Mounted camouflage must not fade another rocket');
first.children[0].material.opacity=.42;
assert.equal(second.children[0].material.opacity,1,'Materials stay independent');
const authoredColours=mesh.geometry.attributes.color.array.slice();
const painted=[0,1,2,3].map(index=>factory(index));
const bodyColours=painted.map(visual=>new T.Vector3().fromBufferAttribute(visual.children[0].geometry.attributes.color,ranges.body_core.start));
assert.ok(bodyColours[0].z>bodyColours[0].x&&bodyColours[0].y>bodyColours[0].x,'Player 1 rocket is blue');
assert.ok(bodyColours[1].x>bodyColours[1].y&&bodyColours[1].z>bodyColours[1].y,'Player 2 rocket is fuchsia');
assert.ok(bodyColours[2].y>bodyColours[2].x&&bodyColours[2].y>bodyColours[2].z,'Player 3 rocket is green');
assert.ok(bodyColours[3].x>bodyColours[3].y*3&&bodyColours[3].x>bodyColours[3].z*3,'Player 4 rocket is red');
for(const [index,visual] of painted.entries()){
  const coloured=visual.children[0].geometry;
  assert.equal(coloured,factory(index).children[0].geometry,'Repeated rockets share the team geometry');
  assert.notEqual(coloured,painted[(index+1)%4].children[0].geometry,'Team paint buffers remain independent');
  assert.deepEqual(coloured.attributes.position.array,mesh.geometry.attributes.position.array,'Team paint preserves the model shape');
  for(const name of ['exhaust_nozzle','metal_ring_0','seam_0','midlamp_0','headlamp_0']){
    const range=ranges[name];
    for(let i=range.start;i<range.start+range.count;i++){
      for(let component=0;component<3;component++)assert.equal(coloured.attributes.color.getComponent(i,component),mesh.geometry.attributes.color.getComponent(i,component),'Preserve authored detail '+name);
    }
  }
}
assert.deepEqual(mesh.geometry.attributes.color.array,authoredColours,'Team colours never mutate the authored template');
console.log(`Rocket GLB OK: ${sourceMeshes} parts -> 1 mesh; ${triangles} triangles; nose +Y; stable roll axis; colours and geometry shared safely`);
console.log('Rocket colours OK: blue, fuchsia, green and red; lights and metal preserved; team buffers cached independently');
