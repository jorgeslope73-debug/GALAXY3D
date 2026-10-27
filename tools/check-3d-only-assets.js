'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const docs=path.resolve('docs');
const retired=[
  'asteroide1.png','asteroide2.png','asteroide3.png','asteroide5.png','asteroide6.png','asteroidegrande_270.png','asteroidemediano.png','dos.png','ovni.png',
  'bengalasnave.png','coete.png','coeteA.png','coeteB.png','coeteC.png','coeteD.png',
  'navemira.png','navemiraA.png','navemiraB.png','navemiraC.png','navemiraD.png',
  'coete1a.png','coete1af.png','coete2a.png','coete2f.png','coete2af.png','coete3a.png','coete3f.png','coete3af.png','coete4a.png','coete4f.png','coete4af.png',
  'INTRO.png','INTRO_MOBILE.png'
];
function read(file){return fs.readFileSync(path.join(docs,file),'utf8');}
function sources(folder){
  const result=[];
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    if(entry.name==='assets'||entry.name==='vendor')continue;
    const file=path.join(folder,entry.name);
    if(entry.isDirectory())result.push(...sources(file));
    else if(/\.(?:js|css|html|json|webmanifest|svg)$/i.test(entry.name))result.push({file,text:fs.readFileSync(file,'utf8')});
  }
  return result;
}
const active=sources(docs),staticAssets=new Set();
for(const name of retired){
  assert.equal(fs.existsSync(path.join(docs,'assets/sprites',name)),false,'retired exclusive 2D image must be removed: '+name);
  // The worker only lists retired names for deleting old offline copies.
  const references=active.filter(source=>path.basename(source.file)!=='sw.js'&&source.text.toLowerCase().includes(name.toLowerCase())).map(source=>path.relative(docs,source.file));
  assert.deepEqual(references,[],'active code/styles/pages must not refer to removed art: '+name);
}
// Only complete literal paths are checked here. Dynamic GLB manifests and UV maps
// are covered by the model tests; do not mistake JS expressions for filenames.
for(const source of active)for(const match of source.text.matchAll(/assets\/(?:sprites|models)\/[\w.%+\/-]+\.(?:png|jpe?g|svg|glb)\b/g)){
  const asset=decodeURIComponent(match[0]),resolved=path.resolve(docs,asset);
  assert.ok(resolved.startsWith(docs+path.sep+'assets'+path.sep));
  assert.ok(fs.existsSync(resolved),'literal asset reference must exist: '+asset+' in '+path.relative(docs,source.file));
  staticAssets.add(asset);
}
const game=read('game.js'),decor=read('menu-decor.js'),index=read('index.html'),manual=read('manual.js');
for(const obsolete of ['loadLegacyGameImages','legacyGameImageKeys','drawProfileSprite','SHIP_IMAGE_KEYS','ROCKET_IMAGE_KEYS','ASTEROID_IMAGE_KEYS','NAVEMIRA_IMAGE_KEYS'])assert.ok(!game.includes(obsolete),'legacy world path must be removed: '+obsolete);
assert.ok(!/dataset\.view\s*=\s*['"]2d['"]/.test(game),'a lost renderer cannot switch the game to 2D');
assert.match(game,/scene3D=window\.Galaxy3D\?\.begin\([^\n]+\n[^\n]*\n\s*if\(!scene3D\)return;/,'missing/preparing 3D stops before drawing world objects');
assert.ok(decor.includes('Galaxy3D')&&decor.includes('.menu('),'the cover still uses the 3D scene');
assert.ok(index.includes('render-3d.js?'),'the mandatory renderer is loaded by the page');
for(const file of ['ship-model.js','rocket-model.js','meteor-model.js','ufo-model.js'])assert.ok(fs.statSync(path.join(docs,file)).size>0,'keep imported model renderers');
for(const name of ['coete1.png','coete2.png','coete3.png','coete4.png','coete1f.png'])assert.ok(fs.statSync(path.join(docs,'assets/sprites',name)).size>0,'manual/victory image must survive world cleanup: '+name);
assert.ok(manual.includes('assets/sprites/coete1.png')&&manual.includes('assets/sprites/coete1f.png'),'manual examples remain usable');
for(const name of ['bengala.png','bengalahud.png','mira1.png','municion1.png','municion3.png','cadencia.png','velocidad.png','ojo.png','pantA.png','pantB.png','pantC.png','pantD.png','localizaA.png','localizaB.png','localizaC.png','localizaD.png'])assert.ok(fs.statSync(path.join(docs,'assets/sprites',name)).size>0,'keep current gameplay overlay: '+name);
for(const suffix of ['','02','03','04','05'])for(const mobile of ['', '_1280'])assert.ok(fs.statSync(path.join(docs,'assets/sprites','fondo'+suffix+mobile+'.jpg')).size>0,'keep every round/device background');
console.log('3D-only assets OK: '+retired.length+' retired world/cover images absent, '+active.length+' source files free of references, '+staticAssets.size+' complete static asset paths exist; HUD, backgrounds, manual and champion images retained.');
