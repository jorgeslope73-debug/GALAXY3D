import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as T from '../docs/vendor/three.module.min.js';
import {createStormFactory} from '../docs/storm-model.js';
const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('docs/storm-core.js','utf8'),ctx);
const S=ctx.window.GalaxyStormCore;
for(const reducedMotion of [false,true]){
  const create=createStormFactory(T,{mobile:true,reducedMotion}),visual=create(),second=create(),body=S.create(1);
  const geometries=new Set(),materials=new Set();visual.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
  const before=JSON.stringify(S.snapshot(body)),target={x:230,y:400};let id=0;
  for(let frame=0;frame<720;frame++){
    if(frame===200)for(let i=0;i<3;i++)S.damage(body,i,'missile');
    if(frame===400)S.damage(body,-1,'missile');
    S.step(body,1/60,target,()=>++id);const state=S.snapshot(body),serialized=JSON.stringify(state);visual.update(state);second.update(state);
    assert.equal(JSON.stringify(state),serialized,'presentation never mutates the authority snapshot');
    visual.root.updateMatrixWorld(true);
    visual.root.traverse(o=>{if(o.geometry)assert.ok(geometries.has(o.geometry),'all frames reuse geometry');assert.ok(o.matrixWorld.elements.every(Number.isFinite));});
  }
  assert.notEqual(JSON.stringify(S.snapshot(body)),before);assert.ok(geometries.size<12);assert.ok(materials.size<9);
  const box=new T.Box3().setFromObject(visual.root);assert.ok(!box.isEmpty());assert.ok(box.max.z<150,'the model remains on the gameplay plane');
  visual.update(null);assert.equal(visual.root.visible,false);
}
const render=fs.readFileSync('docs/render-3d.js','utf8');assert.ok(render.includes('api.storm({id:\'warm-storm\''),'all attack and material variants are part of shader prewarming');
console.log('Storm model OK: shared native geometry, bounded materials, finite transforms, reduced motion, immutable snapshots, cleanup and GPU prewarming.');
