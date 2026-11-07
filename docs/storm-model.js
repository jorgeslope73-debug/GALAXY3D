// Native geometry: no extra download, texture or per-frame geometry allocation.
export function createStormFactory(T,{mobile=false,reducedMotion=false}={}){
  const metal=new T.MeshStandardMaterial({color:0x29344e,metalness:.82,roughness:.3});
  const trim=new T.MeshStandardMaterial({color:0x7489a7,metalness:.72,roughness:.24});
  const energy=new T.MeshStandardMaterial({color:0x6c3dba,emissive:0x823bff,emissiveIntensity:1.5,metalness:.2,roughness:.35});
  const light=new T.MeshBasicMaterial({color:0x89ecff,toneMapped:false});
  const dark=new T.MeshBasicMaterial({color:0x25334a});
  const warningMaterial=new T.MeshBasicMaterial({color:0xffad52,transparent:true,opacity:.17,depthWrite:false,side:T.DoubleSide,toneMapped:false});
  const shieldMaterial=new T.MeshBasicMaterial({color:0x837cff,transparent:true,opacity:.13,depthWrite:false,side:T.FrontSide,toneMapped:false});
  const geometry={core:new T.IcosahedronGeometry(48,1),armor:new T.BoxGeometry(26,39,24),
    rim:new T.TorusGeometry(72,4,6,mobile?32:48),halo:new T.TorusGeometry(105,1.5,4,mobile?32:48),
    shield:new T.SphereGeometry(106,mobile?16:24,12),satellite:new T.CylinderGeometry(24,27,18,6),
    lens:new T.SphereGeometry(12,12,8),pip:new T.BoxGeometry(8,5,3),ray:new T.PlaneGeometry(1,1)};
  const fan=new T.BufferGeometry();fan.setAttribute('position',new T.Float32BufferAttribute([0,0,0,Math.cos(.84)*780,Math.sin(.84)*780,0,Math.cos(.84)*780,-Math.sin(.84)*780,0],3));
  const mesh=(parent,shape,material,x=0,y=0,z=0)=>{const m=new T.Mesh(shape,material);m.position.set(x,y,z);parent.add(m);return m;};
  return ()=>{
    const root=new T.Group(),rotor=new T.Group();root.add(rotor);
    const heart=mesh(rotor,geometry.core,energy,0,0,20);
    const armor=[];
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,part=mesh(rotor,geometry.armor,metal,Math.cos(a)*61,Math.sin(a)*61,7);
      part.rotation.z=a-Math.PI/2;armor.push({part,a});
    }
    const rim=mesh(root,geometry.rim,trim,0,0,18),halo=mesh(root,geometry.halo,light);
    const shield=mesh(root,geometry.shield,shieldMaterial);
    const health=Array.from({length:6},(_,i)=>mesh(root,geometry.pip,light,-30+i*12,-47,65));
    const satellites=Array.from({length:3},()=>{
      const group=new T.Group();root.add(group);
      const hull=mesh(group,geometry.satellite,metal);hull.rotation.x=Math.PI/2;
      const lens=mesh(group,geometry.lens,light,0,0,14);lens.scale.z=.45;
      const pips=[-7,7].map(x=>mesh(group,geometry.pip,light,x,-19,20));
      return {group,lens,pips};
    });
    const tell=new T.Group();root.add(tell);
    const sector=mesh(tell,fan,warningMaterial,0,0,-25);
    const ray=mesh(tell,geometry.ray,warningMaterial,390,0,-22);ray.scale.set(780,3,1);
    const portal=mesh(root,geometry.halo,light,0,0,-35);
    return {root,update(body){
      root.visible=!!body&&body.hp>0;if(!root.visible)return;
      const age=Number(body.age)||0,charging=body.attack==='charging',enraged=!!body.enraged;
      rotor.rotation.z=reducedMotion?0:age*.22;
      heart.rotation.set(reducedMotion?.35:age*.18,.4,reducedMotion?0:-age*.35);
      rim.rotation.set(.25,.12,reducedMotion?0:age*-.12);
      for(const item of armor){const radius=enraged?67:61;item.part.position.x=Math.cos(item.a)*radius;item.part.position.y=Math.sin(item.a)*radius;}
      // Shared materials are updated once for the single campaign boss.
      light.color.setHex(charging?0xffad52:body.vulnerable?0xa5fff0:0x9dbaff);
      energy.emissive.setHex(enraged?0xff384d:body.vulnerable?0x12b9d9:0x823bff);
      energy.emissiveIntensity=charging?2.2:1.5;
      shield.visible=!body.vulnerable;halo.visible=!body.vulnerable;
      shieldMaterial.opacity=charging?.19:.13;
      halo.rotation.set(.45,.18,reducedMotion?0:age*.08);
      health.forEach((pip,i)=>{pip.material=i<body.hp?light:dark;});
      body.satellites.forEach((part,i)=>{
        const sat=satellites[i];sat.group.visible=part.hp>0;
        sat.group.position.set(part.x-body.x,body.y-part.y,0);
        sat.group.rotation.z=reducedMotion?0:age*.35+i;
        sat.pips.forEach((pip,h)=>{pip.material=h<part.hp?light:dark;});
      });
      tell.visible=!!body.warning;
      if(body.warning){
        const warning=body.warning,source=warning.slot<0?body:body.satellites[warning.slot];
        tell.position.set(source.x-body.x,body.y-source.y,0);tell.rotation.z=-warning.angle;
        sector.visible=warning.slot<0;sector.scale.y=enraged?1:.66/.84;
        warningMaterial.opacity=.06+.12*(1-warning.remaining/warning.duration);
      }
      portal.visible=age<1.5;
      if(portal.visible)portal.scale.setScalar(1+age*1.2);
    }};
  };
}
