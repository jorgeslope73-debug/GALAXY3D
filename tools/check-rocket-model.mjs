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
console.log(`Rocket GLB OK: ${sourceMeshes} parts -> 1 mesh; ${triangles} triangles; nose +Y; stable roll axis; colours and geometry shared safely`);
