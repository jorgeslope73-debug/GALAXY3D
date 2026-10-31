/* Authored hull/materials and four independent yaw nulls; simulation supplies the angles. */
import * as T from './vendor/three.module.min.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
const poses=new WeakMap();
export function prepareMothershipTemplate(source,definition){
  const level=new T.Group();level.rotation.x=Math.PI/2;level.add(source);
  level.position.set(-definition.center[0],definition.center[2],-definition.center[1]);
  const template=new T.Group();template.name='nodriza-glb';template.scale.setScalar(definition.scale);template.add(level);
  for(const turret of definition.turrets){const pivot=template.getObjectByName(turret.name);if(!pivot)throw new Error('Falta el null '+turret.name);pivot.rotation.set(0,0,0);}
  template.updateMatrixWorld(true);return template;
}
export async function loadMothershipTemplate(definition){
  const asset=new URL('./assets/models/nodriza.glb',import.meta.url);asset.search=new URL(import.meta.url).search;
  const gltf=await new GLTFLoader().loadAsync(asset.href);return prepareMothershipTemplate(gltf.scene,definition);
}
export function createMothershipFactory(template,definition,environment=null){
  return ()=>{
    const visual=template.clone(true);
    if(environment){const materials=new Map();visual.traverse(object=>{if(!object.isMesh)return;const original=object.material;if(!materials.has(original)){const material=original.clone();material.envMap=environment;material.envMapIntensity=.85;materials.set(original,material);}object.material=materials.get(original);});}
    poses.set(visual,definition.turrets.map(t=>visual.getObjectByName(t.name)));return visual;
  };
}
export function setMothershipPose(visual,body){
  const bank=Number(body.bank)||0;
  visual.rotation.set(0,bank,-body.angle,'ZYX');
  const pivots=poses.get(visual);if(!pivots)return;
  for(let i=0;i<pivots.length;i++){const local=body.turrets[i].angle-body.angle;pivots[i].rotation.y=Math.atan2(Math.cos(local)/Math.cos(bank),Math.sin(local));}
}

// Centres of the five circular rear nozzle rims in the original hull coordinates.
// The particles are presentation only: no emitters or particle data enter physics.
export const MOTHERSHIP_NOZZLES=Object.freeze([
  [0,.39,7.55,.50],[-1.48,.52,7.13,.33],[1.48,.52,7.13,.33],
  [-.98,-.43,7.37,.21],[.98,-.43,7.37,.21]
].map(Object.freeze));
export function createMothershipExhaust({mobile=false}={}){
  const capacity=mobile?144:256,rate=mobile?32:54;
  const positions=new Float32Array(capacity*3),velocities=new Float32Array(capacity*3);
  const lives=new Float32Array(capacity),durations=new Float32Array(capacity),sizes=new Float32Array(capacity),fractions=new Float32Array(capacity);
  const geometry=new T.BufferGeometry();
  for(const [name,array,size]of [['position',positions,3],['life',fractions,1],['size',sizes,1]])geometry.setAttribute(name,new T.BufferAttribute(array,size).setUsage(T.DynamicDrawUsage));
  const attributes=Object.values(geometry.attributes);
  const material=new T.ShaderMaterial({
    uniforms:{pointScale:{value:1}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false,
    vertexShader:`attribute float life; attribute float size; uniform float pointScale; varying float heat;
      void main(){heat=life;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        gl_PointSize=max(1.0,size*(.25+.75*life)*pointScale);}`,
    fragmentShader:`varying float heat;
      void main(){float radius=length(gl_PointCoord-vec2(.5))*2.0;
        float alpha=(1.0-smoothstep(.15,1.0,radius))*pow(max(0.0,heat),.7)*.85;
        if(alpha<.005)discard;
        vec3 blue=mix(vec3(.015,.08,.65),vec3(.3,.8,1.0),heat);
        blue=mix(blue,vec3(.75,.96,1.0),smoothstep(.72,1.0,heat)*(1.0-radius));
        gl_FragColor=vec4(blue,alpha);}`
  });
  const points=new T.Points(geometry,material);points.name='nodriza-propulsion-azul';points.frustumCulled=false;
  const frame=new T.Matrix4(),direction=new T.Vector3(),side=new T.Vector3(),up=new T.Vector3();
  const origins=MOTHERSHIP_NOZZLES.map(()=>new T.Vector3());
  let cursor=0,carry=0,lastAt=null,lastX=0,lastY=0,lastContext=null,lastId=null;
  function clear(){lives.fill(0);fractions.fill(0);cursor=0;carry=0;}
  function update(visual,body,now,context,pointScale=1){
    let elapsed=lastAt===null?0:(now-lastAt)/1000;
    const reset=lastAt===null||context!==lastContext||body.id!==lastId||elapsed<0||elapsed>.25||Math.hypot(body.x-lastX,body.y-lastY)>400;
    if(reset){clear();elapsed=0;}
    const dx=reset?0:lastX-body.x,dy=reset?0:body.y-lastY;
    const shipVx=elapsed>0?-dx/elapsed:0,shipVy=elapsed>0?-dy/elapsed:0;
    lastAt=now;lastX=body.x;lastY=body.y;lastContext=context;lastId=body.id;
    material.uniforms.pointScale.value=pointScale;
    // Trail positions stay in world axes while the hull moves, turns and banks.
    for(let i=0;i<capacity;i++){
      lives[i]=Math.max(0,lives[i]-elapsed);fractions[i]=lives[i]/(durations[i]||1);
      if(!lives[i])continue;
      const at=i*3;positions[at]+=dx+velocities[at]*elapsed;positions[at+1]+=dy+velocities[at+1]*elapsed;positions[at+2]+=velocities[at+2]*elapsed;
    }
    const hull=visual.getObjectByName('AEGIS_Hull'),parent=points.parent;
    if(!parent)throw new Error('La propulsion de la nodriza necesita su grupo visual');
    hull.updateWorldMatrix(true,false);
    frame.copy(parent.matrixWorld).invert().multiply(hull.matrixWorld);
    direction.set(0,0,1).transformDirection(frame);side.set(1,0,0).transformDirection(frame);up.set(0,1,0).transformDirection(frame);
    for(let i=0;i<origins.length;i++){const nozzle=MOTHERSHIP_NOZZLES[i];origins[i].set(nozzle[0],nozzle[1],nozzle[2]).applyMatrix4(frame);}
    carry+=elapsed*rate;const amount=reset?1:Math.floor(carry);if(!reset)carry-=amount;
    const scale=visual.scale.x;
    for(let birth=0;birth<amount;birth++)for(let nozzle=0;nozzle<origins.length;nozzle++){
      const i=cursor,at=i*3;cursor=(cursor+1)%capacity;
      const age=reset?0:(carry+amount-1-birth)/rate;
      const theta=Math.random()*Math.PI*2,radius=Math.sqrt(Math.random())*MOTHERSHIP_NOZZLES[nozzle][3]*scale;
      const offsetX=Math.cos(theta)*radius,offsetY=Math.sin(theta)*radius,exhaust=155+Math.random()*90;
      velocities[at]=shipVx*.15+direction.x*exhaust+side.x*offsetX*.55+up.x*offsetY*.55;
      velocities[at+1]=shipVy*.15+direction.y*exhaust+side.y*offsetX*.55+up.y*offsetY*.55;
      velocities[at+2]=direction.z*exhaust+side.z*offsetX*.55+up.z*offsetY*.55;
      const origin=origins[nozzle];
      positions[at]=origin.x+side.x*offsetX+up.x*offsetY+(velocities[at]-shipVx)*age;
      positions[at+1]=origin.y+side.y*offsetX+up.y*offsetY+(velocities[at+1]-shipVy)*age;
      positions[at+2]=origin.z+side.z*offsetX+up.z*offsetY+velocities[at+2]*age;
      durations[i]=.42+Math.random()*.23;lives[i]=durations[i]-age;fractions[i]=lives[i]/durations[i];
      sizes[i]=(5+Math.random()*7)*(nozzle===0?1.15:1);
    }
    for(const attribute of attributes)attribute.needsUpdate=true;
  }
  return {points,update};
}
