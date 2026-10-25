/* Stateless wire format: losing a packet never loses the baseline for the next. */
'use strict';
(() => {
  const hasOwn=Object.prototype.hasOwnProperty,finite=Number.isFinite,safeInteger=Number.isSafeInteger,integer=Number.isInteger,isArray=Array.isArray;
  const own=(o,k)=>hasOwn.call(o,k);
  const object=o=>!!o&&typeof o==='object'&&!isArray(o);
  const schemas={
    players:{tag:'p',max:4,fields:['i','x','y','r','b','vx','vy','ammo','cad','spd','k','d','shield','camo','prot','spawnFx','ma','mt','flare','respawn','n','appliedControlSeq','motion'],bools:['cpu','thrust','armed','mira','shock','dead']},
    asteroids:{tag:'a',max:128,fields:['id','x','y','type','r','s'],bools:['fragment']},
    bullets:{tag:'b',max:512,fields:['id','o','x','y','vx','vy','gt','wt'],bools:['g']},
    flares:{tag:'f',max:256,fields:['id','o','x','y','a','life'],bools:[]},
    pickups:{tag:'k',max:128,fields:['id','type','x','y','expiresIn'],bools:[]},
    meteors:{tag:'m',max:256,fields:['id','type','x','y','a'],bools:[]},
    ufos:{tag:'u',max:32,fields:['id','x','y','vx','vy','hp'],bools:[]},
    fx:{tag:'e',max:256,fields:['id','i','x','y','kind','age'],bools:['hidden']}
  };
  const requiredCollections=['players','asteroids','bullets','pickups','meteors'];
  const requiredFields={players:['i','x','y','r','vx','vy'],asteroids:['id','x','y','r'],bullets:['id','o','x','y','vx','vy'],flares:['id','o','x','y','a','life'],pickups:['id','type','x','y'],meteors:['id','type','x','y','a'],ufos:['id','x','y'],fx:['id','x','y','kind','age']};
  function standaloneBodies(state){
    for(const key of ['giant','ufo'])if(own(state,key)&&state[key]!==null){
      const body=state[key];if(!object(body)||!finite(body.x)||!finite(body.y)||(key==='ufo'&&!own(body,'id')))return false;
    }
    return true;
  }
  const validHeader=state=>finite(state.simTime)&&state.simTime>=0&&safeInteger(state.seq)&&state.seq>=1;
  const schemaList=Object.entries(schemas);
  for(const [kind,s] of schemaList){
    s.keys=new Set([...s.fields,...s.bools]);
    s.requiredMask=requiredFields[kind].reduce((mask,key)=>mask|(1<<s.fields.indexOf(key)),0);
  }
  const nullable=new Set(['expiresIn']);
  const strings=new Set(['n','kind','type']);
  const opaque=new Set(['id']);
  function motionPack(m){
    if(!object(m)||m.v!==1||!['epoch','ack','x','y','rot','vx','vy'].every(k=>finite(m[k]))||typeof m.active!=='boolean')return null;
    if(!safeInteger(m.epoch)||m.epoch<1||!safeInteger(m.ack)||m.ack<0)return null;
    const rest={...m};for(const k of ['v','epoch','ack','active','x','y','rot','vx','vy'])delete rest[k];
    const row=[m.epoch,m.ack,m.active?1:0,m.x,m.y,m.rot,m.vx,m.vy];if(Object.keys(rest).length)row.push(rest);return row;
  }
  function motionUnpack(row){
    if(!isArray(row)||row.length<8||row.length>9||!row.slice(0,8).every(finite)||![0,1].includes(row[2])||(row.length===9&&!object(row[8])))return null;
    if(!safeInteger(row[0])||row[0]<1||!safeInteger(row[1])||row[1]<0)return null;
    return {...(row[8]||{}),v:1,epoch:row[0],ack:row[1],active:!!row[2],x:row[3],y:row[4],rot:row[5],vx:row[6],vy:row[7]};
  }
  function aliases(entity){
    const b={...entity};
    for(const [canonical,alias] of [['o','owner'],['g','guided'],['gt','target']]){
      if(!own(b,canonical)&&own(b,alias))b[canonical]=b[alias];
      if(own(b,alias)&&b[alias]===b[canonical])delete b[alias];
    }
    return b;
  }
  function rowPack(entity,schema,kind,recipient){
    if(!object(entity))return null;
    const item=kind==='bullets'?aliases(entity):entity;
    if(kind==='asteroids'&&!(item.r>0))return null;
    let mask=0,flags=0;const values=[];
    for(let i=0;i<schema.fields.length;i++){
      const key=schema.fields[i];if(!own(item,key)||item[key]===undefined||(key==='motion'&&Number(item.i)!==Number(recipient)))continue;
      let value=item[key];if(key==='motion'){value=motionPack(value);if(!value)return null;}
      else if(!validField(key,value))return null;
      mask|=1<<i;values.push(value);
    }
    for(let i=0;i<schema.bools.length;i++){
      const key=schema.bools[i];if(!own(item,key)||item[key]===undefined)continue;
      if(typeof item[key]!=='boolean')return null;
      flags|=(item[key]?2:1)<<(i*2);
    }
    if((mask&schema.requiredMask)!==schema.requiredMask)return null;
    let extra=null;for(const key in item)if(own(item,key)&&!schema.keys.has(key)){if(!extra)extra=Object.create(null);extra[key]=item[key];}
    if(extra){mask|=1<<schema.fields.length;values.push(extra);}
    return [mask,flags,...values];
  }
  function validField(key,value){
    if(typeof value==='number')return finite(value);
    if(value===null)return nullable.has(key);
    return typeof value==='string'&&(strings.has(key)||opaque.has(key));
  }
  function rowUnpack(row,schema,kind){
    if(!isArray(row)||row.length<2||!integer(row[0])||row[0]<0||row[0]>=2**(schema.fields.length+1)||!integer(row[1])||row[1]<0||row[1]>=2**(schema.bools.length*2))return null;
    const [mask,flags]=row;let at=2;const result={};
    if((mask&schema.requiredMask)!==schema.requiredMask)return null;
    for(let i=0;i<schema.fields.length;i++)if(mask&(1<<i)){
      if(at>=row.length)return null;const key=schema.fields[i];let value=row[at++];
      if(key==='motion'){value=motionUnpack(value);if(!value)return null;}
      else if(!validField(key,value))return null;
      result[key]=value;
    }
    const extra=mask&(1<<schema.fields.length)?row[at++]:null;
    if(at!==row.length||extra!==null&&!object(extra))return null;
    if(extra&&Object.keys(extra).some(key=>schema.keys.has(key)))return null;
    for(let i=0;i<schema.bools.length;i++){
      const bits=(flags>>>(i*2))&3,key=schema.bools[i];
      if(bits===1||bits===2)result[key]=bits===2;
      if(bits===3)return null;
    }
    // Spread only; an untrusted __proto__ key must never alter a prototype.
    const restored=extra?{...result,...extra}:result;
    if(kind==='asteroids'&&!(restored.r>0))return null;
    if(kind==='players'&&(!integer(restored.i)||restored.i<0||restored.i>3))return null;
    if(kind==='bullets'){
      if(own(restored,'o')&&!own(restored,'owner'))restored.owner=restored.o;
      if(own(restored,'g')&&!own(restored,'guided'))restored.guided=restored.g;
      if(own(restored,'gt')&&!own(restored,'target'))restored.target=restored.gt;
      if(own(restored,'owner')&&!finite(restored.owner)||own(restored,'guided')&&typeof restored.guided!=='boolean'||own(restored,'target')&&!finite(restored.target))return null;
    }
    return restored;
  }
  function prepare(state){
    if(!object(state)||own(state,'stateCodec')||own(state,'entities')||!validHeader(state))return null;
    if(!requiredCollections.every(key=>isArray(state[key]))||!standaloneBodies(state))return null;
    const header={...state},entities={};let playerRows;
    for(const [kind,schema] of schemaList)if(own(state,kind)){
      if(!isArray(state[kind])||state[kind].length>schema.max)return null;
      const rows=state[kind].map(entity=>rowPack(entity,schema,kind,NaN));if(rows.some(row=>!row))return null;
      if(kind==='players')playerRows=rows;
      entities[schema.tag]=rows;delete header[kind];
    }
    // This object lives only for one broadcast. No cross-frame cache can retain
    // an old winner/header, and expensive shared rows are prepared once.
    return {encodeFor(recipient){
      const index=state.players.findIndex(p=>Number(p.i)===Number(recipient)&&own(p,'motion')&&p.motion!==undefined);
      let ownRows=playerRows;
      if(index>=0){
        const row=rowPack(state.players[index],schemas.players,'players',recipient);if(!row)return null;
        ownRows=playerRows.slice();ownRows[index]=row;
      }
      return {...header,stateCodec:1,entities:{...entities,p:ownRows}};
    }};
  }
  function encode(state,recipient){return prepare(state)?.encodeFor(recipient)||null;}
  function decode(packet){
    try{
      if(!object(packet)||packet.stateCodec!==1||!object(packet.entities))return null;
      if(!validHeader(packet))return null;
      if(!requiredCollections.every(key=>own(packet.entities,schemas[key].tag)))return null;
      const state={...packet};delete state.stateCodec;delete state.entities;
      if(!standaloneBodies(state))return null;
      const tags=new Set(Object.values(schemas).map(s=>s.tag));if(Object.keys(packet.entities).some(k=>!tags.has(k)))return null;
      let total=0;
      for(const [kind,schema] of schemaList)if(own(packet.entities,schema.tag)){
        const rows=packet.entities[schema.tag];if(!isArray(rows)||rows.length>schema.max||(total+=rows.length)>1024)return null;
        const entities=rows.map(row=>rowUnpack(row,schema,kind));if(entities.some(row=>!row))return null;
        state[kind]=entities;
      }
      return state;
    }catch(_){return null;}
  }
  window.GalaxyStateCodec=Object.freeze({version:1,prepare,encode,decode,isCompact:packet=>object(packet)&&packet.stateCodec===1});
})();
