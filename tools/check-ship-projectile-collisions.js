'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {engineContext}=require('./check-session-regressions.js');
const ctx=engineContext(),core=ctx.window.GalaxyPhysicsCore,DT=1/60;
const angles=[0,45,90,135,180,225,270,315,359];
const point=(x,y,rot=0)=>{const a=rot*Math.PI/180;return{x:500+x*Math.cos(a)+y*Math.sin(a),y:500-x*Math.sin(a)+y*Math.cos(a)};};
function fixture(name,rot=0){
  const engine=new ctx.window[name]({});
  engine.players=[0,1].map(i=>Object.assign(engine.makePlayer(i,'J'+i,false),{
    x:i?500:1200,y:i?500:900,px:i?500:1200,py:i?500:900,rot:i?rot:0,pr:i?rot:0,
    vx:0,vy:0,shield:0,protection:0,spawnFx:0,dead:false,kills:0
  }));
  Object.assign(engine,{asteroids:[],meteors:[],pickups:[],flares:[],bullets:[],giant:null,ufo:null,activeShockwaves:[]});
  return engine;
}
function shoot(engine,start,end,guided=false,owner=0){
  engine.bullets=[{id:1,owner,x:start.x,y:start.y,vx:(end.x-start.x)/DT,vy:(end.y-start.y)/DT,age:0,travel:100,guided,target:-1}];
  engine.updateBullets(DT);
}
let scenarios=0;
for(const name of ['GalaxyHostPhysics','GalaxyLocalCpu']){
  for(const rot of angles)for(const [x,y,hit] of [[0,-45,true],[-36,20,true],[36,20,true],[-10,45,true],[10,45,true],[0,0,true],[28,-20,false],[25,40,false],[0,-55,false],[46,20,false]]){
    const engine=fixture(name,rot),p=point(x,y,rot);shoot(engine,p,p);
    assert.equal(engine.players[1].dead,hit,name+' rot='+rot+' punto='+[x,y]);
    assert.equal(engine.players[0].kills,hit?1:0);scenarios++;
  }
  for(const rot of angles){
    const engine=fixture(name,rot);shoot(engine,point(-80,-44,rot),point(80,-44,rot));
    assert.equal(engine.players[1].dead,true,name+': la bala rapida cruza el morro rotado');scenarios++;
  }
  {
    const engine=fixture(name);engine.players[1].px=400;
    shoot(engine,{x:450,y:455},{x:450,y:455});
    assert.equal(engine.players[1].dead,true,name+': movimiento relativo de la nave');scenarios++;
  }
  {
    const engine=fixture(name,90);engine.players[1].pr=0;
    shoot(engine,{x:500,y:455},{x:500,y:455});
    assert.equal(engine.players[1].dead,true,name+': el giro no deja pasar la bala');scenarios++;
  }
  {
    const engine=fixture(name);engine.players[1].px=10;engine.players[1].x=1910;
    shoot(engine,{x:960,y:455},{x:960,y:455});
    assert.equal(engine.players[1].dead,false,name+': cruzar el borde no barre la arena');scenarios++;
  }
  for(const protection of [0,3]){
    const engine=fixture(name);engine.players[1].protection=protection;
    shoot(engine,point(0,-45),point(0,-45));
    assert.equal(engine.players[1].dead,protection===0,name+': inmunidad de reaparicion');scenarios++;
  }
  {
    const engine=fixture(name),p=engine.players[1];p.shield=10;
    shoot(engine,point(59,0),point(59,0));
    assert.equal(p.dead,false);assert.equal(p.shield,10);assert.equal(engine.bullets.length,0);scenarios++;
  }
  {
    const engine=fixture(name),p=engine.players[0];p.x=p.px=500;p.y=p.py=500;
    engine.players[1].x=1200;engine.players[1].px=1200;
    p.guidedAmmo=1;p.guidedTarget=-1;p.reload=0;
    const missile=core.tryFireProjectile(p,{x:0,y:-1},false,true,false,false,engine.players,()=>({x:0,y:-1}),()=>99);
    engine.bullets=[missile];
    for(let i=0;i<12;i++)engine.updateBullets(DT);
    assert.equal(engine.bullets.length,1,name+': el misil sale del morro sin autodano');assert.equal(p.dead,false);
    assert.equal(missile.leavingOwnerShip,false);
    missile.x=500;missile.y=450;missile.vx=0;missile.vy=400;missile.target=-1;engine.updateBullets(DT);
    assert.equal(p.dead,true,name+': el misil propio puede danar al regresar');scenarios++;
  }
  {
    const engine=fixture(name),p=engine.players[0];p.x=p.px=500;p.y=p.py=500;engine.players[1].x=1200;
    shoot(engine,point(0,-45),point(0,-45));assert.equal(p.dead,false,name+': la bala propia no dana');scenarios++;
  }
}
async function checkRealModel(){
  const url=relative=>pathToFileURL(path.resolve(__dirname,'../docs/'+relative)).href;
  const T=await import(url('vendor/three.module.min.js'));
  const {GLTFLoader}=await import(url('vendor/GLTFLoader.js'));
  const {prepareShipTemplate}=await import(url('ship-model.js'));
  const bytes=fs.readFileSync(path.resolve(__dirname,'../docs/assets/models/nave.glb'));
  const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_TEXTURES',loadTexture(){return Promise.resolve(new T.Texture());}}));
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const template=prepareShipTemplate(gltf.scene),target={x:500,y:500,px:500,py:500,rot:0,pr:0};
  let vertices=0,misses=0;
  template.traverse(o=>{
    if(!o.isMesh)return;const a=o.geometry.attributes.position;
    for(let i=0;i<a.count;i++){
      const v=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);
      const p={x:500+v.x*1.5,y:500-v.y*1.5};vertices++;
      if(!core.projectileHitsShipHull(p,target,1))misses++;
    }
  });
  assert.equal(misses,0,'el contorno debe cubrir cada vertice del GLB real con tolerancia de una unidad');
  console.log('Colision nave-bala OK: '+scenarios+' escenarios en ambos motores, '+vertices+' vertices del modelo, morro/alas/motores, giros, CCD, roces y autodano.');
}
checkRealModel().catch(error=>{console.error(error);process.exitCode=1;});
