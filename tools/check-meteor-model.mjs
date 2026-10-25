import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {GLTFLoader} from '../docs/vendor/GLTFLoader.js';
import {prepareMeteorTemplate,createMeteorFactory,METEOR_MODELS} from '../docs/meteor-model.js';
const budgets={fragment:{triangles:3000,mapSize:512},medium:{triangles:6000,mapSize:1024},large:{triangles:12852,mapSize:1024}};
assert.deepEqual(Object.fromEntries(Object.entries(METEOR_MODELS).map(([kind,model])=>[kind,model.file])),{fragment:'meteorito3.glb',medium:'asteroidemediano.glb',large:'Rocky_Asteroid_5.glb'});
function jpegSize(bytes){let at=2;assert.equal(bytes.readUInt16BE(0),0xffd8);while(at<bytes.length){assert.equal(bytes[at],255);const marker=bytes[at+1],length=bytes.readUInt16BE(at+2);if([0xc0,0xc1,0xc2].includes(marker))return [bytes.readUInt16BE(at+7),bytes.readUInt16BE(at+5)];at+=length+2;}throw Error('Missing JPEG dimensions');}
const templates={};let totalBytes=0;
for(const [kind,definition] of Object.entries(METEOR_MODELS)){
const bytes=await readFile(new URL('../docs/assets/models/'+definition.file,import.meta.url));totalBytes+=bytes.length;
assert.equal(bytes.toString('ascii',0,4),'glTF');assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);assert.ok(bytes.length<750000,'each web model stays below 750 kB');
const jsonSize=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonSize).toString());
assert.equal(json.meshes.length,1);assert.ok(json.buffers.every(b=>!b.uri));assert.ok(!json.skins?.length&&!json.animations?.length&&!json.extensionsRequired?.length);
assert.equal(json.images.length,3,'retain colour, normal and metallic/roughness maps');
for(const image of json.images){assert.ok(Number.isInteger(image.bufferView));assert.equal(image.mimeType,'image/jpeg');const v=json.bufferViews[image.bufferView],at=28+jsonSize+(v.byteOffset||0);assert.deepEqual(jpegSize(bytes.subarray(at,at+v.byteLength)),[budgets[kind].mapSize,budgets[kind].mapSize]);}
assert.equal(json.materials.length,1);assert.ok(json.materials.every(m=>m.normalTexture&&m.pbrMetallicRoughness.baseColorTexture&&m.pbrMetallicRoughness.metallicRoughnessTexture&&!m.doubleSided));
const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const template=prepareMeteorTemplate(gltf.scene,kind);templates[kind]=template;assert.equal(template.children.length,1);assert.equal(template.userData.galaxyMeteorKind,kind);assert.equal(template.scale.x,definition.scale);
const mesh=template.children[0],geometry=mesh.geometry;assert.equal(geometry.index.count/3,budgets[kind].triangles);assert.ok(geometry.boundingSphere.center.length()<1e-5);assert.ok(Math.abs(geometry.boundingSphere.radius-1)<1e-5);assert.equal(geometry.attributes.uv.count,geometry.attributes.position.count);assert.equal(geometry.attributes.normal.count,geometry.attributes.position.count);assert.ok(mesh.material.map&&mesh.material.normalMap&&mesh.material.roughnessMap&&mesh.material.metalnessMap);
const vertex=new T.Vector3(),pose=new T.Quaternion(),rotation=new T.Euler(),radii=[];
for(let frame=0;frame<16;frame++){pose.setFromEuler(rotation.set(frame*.31,frame*.47,frame*.23));const support=Array(24).fill(-Infinity);for(let i=0;i<geometry.attributes.position.count;i++){vertex.fromBufferAttribute(geometry.attributes.position,i).applyQuaternion(pose).multiplyScalar(definition.scale);for(let d=0;d<24;d++){const angle=d*Math.PI/12;support[d]=Math.max(support[d],vertex.x*Math.cos(angle)+vertex.y*Math.sin(angle));}}radii.push(...support);}
const mean=radii.reduce((a,b)=>a+b,0)/radii.length;if(kind==='fragment'){assert.ok(Math.abs(mean-1)<.005,'average outline fits the gameplay circle');assert.ok(Math.min(...radii)>.88&&Math.max(...radii)<1.14,'the supplied uneven silhouette stays near its circular collision radius');}else assert.ok(Math.max(...radii)<=1.00001,'the irregular artwork fits its broad phase; exact contour contacts are checked separately');console.log(kind+': '+bytes.length+' bytes, '+budgets[kind].triangles+' triangles; projected radius '+mean.toFixed(3));
}
assert.ok(totalBytes<1600000,'the whole set stays below 1.6 MB');
const factory=createMeteorFactory(templates),instances={};
for(const kind of Object.keys(templates)){const first=factory(kind),second=factory(kind);assert.notEqual(first,second);assert.equal(first.children[0].geometry,second.children[0].geometry);assert.equal(first.children[0].material,second.children[0].material);first.rotation.set(.3,.7,1);first.scale.setScalar(135);assert.ok(Math.abs(second.rotation.z)<1e-8);assert.equal(second.scale.x,METEOR_MODELS[kind].scale);instances[kind]=second;}
for(const a of Object.keys(templates))for(const b of Object.keys(templates))if(a!==b){assert.notEqual(instances[a].children[0].geometry,instances[b].children[0].geometry);assert.notEqual(instances[a].children[0].material,instances[b].children[0].material);}
assert.equal(factory().children[0].geometry,instances.medium.children[0].geometry);
const renderSource=await readFile(new URL('../docs/render-3d.js',import.meta.url),'utf8'),calls=[];
const rockMethod=renderSource.match(/      rock\([^\n]+\{[\s\S]*?\n      \},/);assert.ok(rockMethod);
const take=(kind,id)=>{calls.push([kind,id]);return {root:new T.Group(),rock:factory(kind.slice(5))};};
const rock=vm.runInNewContext('({'+rockMethod[0]+'}).rock',{take,place:()=>{},now:1000,Math,Number,String});
for(const [size,role,expected] of [[28,undefined,'fragment'],[56,undefined,'fragment'],[90,undefined,'medium'],[270,undefined,'large'],[50,'large','large']]){rock('same-id',100,100,size,1,0,role);assert.equal(calls.at(-1)[0],'rock:'+expected,'pool keys must track the artwork role, including reused IDs');}
const game=(await readFile(new URL('../docs/game.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const start=game.indexOf('    for(const a of renderState.asteroids){',game.indexOf('drawAsteroidDust(Math.min(')),end=game.indexOf('    {\n      const visibleUfos',start);assert.ok(start>0&&end>start);
const drawn=[];vm.runInNewContext(game.slice(start,end),{get renderState(){return this.state;},state:{asteroids:[{id:1,x:10,y:10,r:45,type:1},{id:2,x:20,y:10,r:28,type:1,fragment:true}],pickups:[],flares:[],meteors:[{id:3,x:30,y:10,a:45,type:1}],giant:{x:400,y:400}},prev:{giant:null},previousLookup:{asteroids:new Map(),pickups:new Map(),flares:new Map(),meteors:new Map()},blend:1,now:1000,nowSec:1,METEOR_3D_DIAMETER:28,scene3D:{rock:(...args)=>drawn.push(args)},drawGiantEntryWarning:()=>{},Math,Number});
assert.deepEqual(Array.from(drawn,args=>[args[0],args[3],args[6]]),[['a1',90,'medium'],['a2',56,'fragment'],['m3',28,'fragment'],['giant',270,'large']]);
const sw=await readFile(new URL('../docs/sw.js',import.meta.url),'utf8');for(const definition of Object.values(METEOR_MODELS))assert.ok(sw.includes('./assets/models/'+definition.file),'offline startup includes every role');assert.ok(!sw.includes('./assets/models/meteor.glb'));
console.log('Meteor set OK: 3 distinct roles: asteroidemediano, Rocky_Asteroid_5 and meteorito3; actual game routes medium/fragments/rain/giant; independent role pools, shared resources, embedded PBR maps and offline startup.');
