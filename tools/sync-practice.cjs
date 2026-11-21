'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'docs',name+'.js'),'utf8').replaceAll('\r\n','\n').trim();
let bundle=read('prueba-nucleo');
if(!bundle.includes('// void-core.js\n'))bundle=bundle.replace('// local-cpu.js\n','// void-core.js\n'+read('void-core')+'\n;\n// local-cpu.js\n');
for(const name of ['render-3d','campaign-config','i18n','manual','devourer-core','void-core','local-cpu','shot-history','network-playback','startup-preparation']){
 const marker='// '+name+'.js\n',start=bundle.indexOf(marker)+marker.length,end=bundle.indexOf('\n;\n// ',start);
 if(start<marker.length||end<start)throw Error('Bundle boundary '+name);
 bundle=bundle.slice(0,start)+read(name)+'\n'+bundle.slice(end);
}
let game=read('game');
const change=(a,b)=>{if(!game.includes(a))throw Error('Practice anchor '+a.slice(0,70));game=game.replace(a,b);};
change('function postAnalyticsEvent(type){','function postAnalyticsEvent(type){\n    return; // Isolated boss practice does not send analytics.');
change('stopLocalCpu();\n    localCampaignLevel=1;localCampaignAwaitingContinue=false;','stopLocalCpu();\n    localCampaignLevel=Number(document.documentElement.dataset.practiceLevel)||3;localCampaignAwaitingContinue=false;');
change("const difficulty=document.getElementById('difficulty').value;","const difficulty='medio';");
change("postAnalyticsEvent('cpu_match');",'// Practice sessions do not count as normal CPU matches.');
change('cpuLearningControl.localHardEnabled===true,','false,');
change("    localCpuActive=true;\n    handle({t:'created'",`    const pilot=localCpu.players.find(player=>!player.cpu);
    pilot.kills=5;pilot.bullets=localCampaignLevel>=4?40:25;pilot.guidedAmmo=3;pilot.guided=true;pilot.flare=3;
    if(!localCpu.beginCampaignBoss(pilot))throw new Error('No se pudo iniciar el jefe de prueba');
    localCpuActive=true;
    handle({t:'created'`);
change('  connect();render();',`  startupGraphics.then(()=>startLocalCpu()).catch(error=>{
    statusEl.textContent='NO SE PUDO CARGAR LA PRUEBA. RECARGA LA PAGINA.';
    console.error('[Boss practice]',error);
  });
  render();`);
const marker='// game.js\n',at=bundle.indexOf(marker);if(at<0)throw Error('Missing practice game');
bundle=bundle.slice(0,at+marker.length)+game+'\n;\n';
fs.writeFileSync(path.join(root,'docs/prueba-nucleo.js'),bundle);
console.log('Practice canonical modules synchronized; direct levels 3/4/5 isolated.');
