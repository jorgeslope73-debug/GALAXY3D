'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {clientFixture,engineContext}=require('./check-session-regressions.js');
const game=fs.readFileSync('docs/game.js','utf8').replaceAll('\r\n','\n');
function source(name){
  let start=game.indexOf('  function '+name+'(');
  if(start<0)start=game.indexOf('  async function '+name+'(');
  const end=game.indexOf('\n  }',start);
  assert.ok(start>=0&&end>start,'find production '+name);
  return game.slice(start,end+4);
}
function fixture(){
  const f=clientFixture(),ctx=f.ctx,timers=new Map(),calls={menu:0,reconnect:[],notice:[],recover:[],prepare:0,closed:0};let timerId=1;
  Object.assign(ctx,{
    onlineRoomUnavailable:false,onlineStartPending:false,hostIndex:0,serverProtocolReady:false,
    resumeStartedAt:0,resumeExpiryTimer:null,RESUME_WINDOW_MS:30000,reconnectFailures:0,
    statusEl:{textContent:''},playerColors:['blue','pink','green','yellow'],playersEl:{innerHTML:''},
    tr:key=>key,trServer:s=>s,sinTildes:s=>s,showShareToast:s=>calls.notice.push(s),
    playNoticeStart:0,playNoticeUntil:0,playNoticeText:'',playNoticeKind:'',
    alert:()=>assert.fail('no forced alert over an active or completed game'),returnToMainMenu:()=>calls.menu++,
    clearResumeSession:()=>{calls.clearedResume=(calls.clearedResume||0)+1;},
    scheduleReconnect:delay=>calls.reconnect.push(delay),setServerReady:()=>{},
    manualClose:false,pendingStateRaw:null,healthTimer:123,sharedRoomCode:'',
    performance:{now:()=>100000},setTimeout:(fn,delay)=>{const id=timerId++;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id),clearInterval:()=>{},
    recoverOnlineRound:m=>calls.recover.push(m),prepareOnlineView:()=>calls.prepare++,
    updateLobbyStartButton:()=>{},updateWaitingPlayers:()=>{},escapeHtml:s=>s,
    persistCriticalServerOps:()=>{calls.persist=(calls.persist||0)+1;},
    send:m=>{calls.sent=(calls.sent||[]);calls.sent.push(m);return true;},
    loadResumeSession:()=>null,wakeStatus:()=>{},sendSocketRaw:()=>true
  });
  ctx.startHostPhysics(ctx.lobbyPlayers,1);
  ctx.inGame=true;ctx.state={started:true,finished:false,round:1,winner:null};
  ctx.p2p={peers:new Map([[1,{open:true,pc:{connectionState:'connected'}}]])};
  for(const name of ['stopResumeWindow','p2pGameHealthy','onlineSessionCanContinue','onlineRoundResultPresent','preserveOnlineSession','currentLifecyclePacket','retireSocket','serverHello','handle'])vm.runInContext(source(name),ctx);
  function socket(){
    const connection={readyState:1,protocolReadyAt:0,bufferedAmount:0,close(){this.readyState=3;calls.closed++;}};
    ctx.connection=connection;ctx.ws=connection;
    const start=game.indexOf('    ws.onclose=()=>{'),end=game.indexOf('    ws.onerror=',start);
    assert.ok(start>=0&&end>start);
    vm.runInContext(game.slice(start,end).replace('ws.onclose=','connection.onclose='),ctx);
    return connection;
  }
  return {...f,ctx,timers,calls,socket};
}

for(const finished of [false,true]){
  const {ctx,timers,calls,socket}=fixture(),motor=ctx.hostPhysics;
  motor.finished=finished;motor.winner=finished?0:null;ctx.state.finished=finished;ctx.state.winner=motor.winner;
  ctx.inGame=!finished;ctx.onlineSeriesPhase=finished?'round-finished':'playing';
  const connection=socket();connection.onclose();
  assert.equal(ctx.hostPhysics,motor,'signaling close keeps the authority motor');
  const expiry=[...timers.values()].find(t=>t.delay===31500);assert.ok(expiry,'start the existing bounded recovery window');
  ctx.pendingCriticalServerOps.push({t:'series-round-result'});expiry.fn();
  assert.equal(calls.menu,0,'recovery timeout cannot eject a live host or its victory screen');
  assert.equal(ctx.hostPhysics,motor);assert.equal(motor.finished,finished);assert.equal(motor.winner,finished?0:null);
  assert.equal(ctx.onlineRoomUnavailable,false,'no server response is not proof the room was deleted');
  assert.equal(ctx.pendingCriticalServerOps.length,1,'temporary loss retains pending reliable operations');
  assert.ok(calls.reconnect.includes(1200));
  ctx.serverHello({protocolVersion:ctx.PROTOCOL.VERSION});
  const resume=calls.sent.at(-1);assert.equal(resume.t,'resume');
  assert.equal(resume.hostSimulationAlive,true,'ordinary reconnection does not request a host reload/restart, even between rounds');
}

{
  const {ctx,calls}=fixture();
  assert.equal(ctx.p2pGameHealthy(),true,'running host with a connected peer is shared authority');
  ctx.hostPhysics.finished=true;ctx.inGame=false;ctx.onlineSeriesPhase='round-finished';
  assert.equal(ctx.p2pGameHealthy(),true,'finished authority is still healthy with connected peers');
  ctx.p2p.peers.clear();assert.equal(ctx.p2pGameHealthy(),false,'a local motor alone is not evidence of shared P2P authority');
  assert.equal(ctx.preserveOnlineSession(),true,'an isolated motor/result is retained explicitly, without calling it shared');
  assert.equal(calls.menu,0);
  ctx.isHost=false;ctx.hostPhysics=null;ctx.state={started:true,finished:true,round:1,winner:0};
  ctx.p2p.peers.set(0,{open:true,pc:{connectionState:'connected'}});ctx.lastP2PStateAt=1;
  assert.equal(ctx.p2pGameHealthy(),true,'guest victory does not depend on fresh position snapshots');
}

for(const type of ['closed','resume-failed'])for(const finished of [false,true]){
  const {ctx,calls,socket}=fixture(),motor=ctx.hostPhysics;
  motor.finished=finished;motor.winner=finished?0:null;ctx.state.finished=finished;ctx.state.winner=motor.winner;ctx.inGame=!finished;
  const connection=socket();ctx.pendingCriticalServerOps.push({t:'rank-restart'});
  ctx.handle({t:type,cause:'solo_host',hostEpoch:ctx.hostEpoch,seriesId:ctx.onlineSeriesId,code:ctx.roomCode});
  assert.equal(ctx.onlineRoomUnavailable,true,'confirmed room loss is explicitly marked');
  assert.equal(calls.menu,0);assert.equal(ctx.hostPhysics,motor);assert.equal(motor.finished,finished);
  assert.equal(motor.rankHostToken,'','a deleted room cannot report new ranked results');
  assert.equal(ctx.pendingCriticalServerOps.length,0,'do not retry operations against a room known to be gone');
  assert.equal(connection.readyState,3,'retire stale WebSocket membership without closing the simulation/P2P');
  assert.match(ctx.statusEl.textContent,/SALA NO DISPONIBLE/);assert.match(ctx.playNoticeText,/PARTIDA CONSERVADA/);
  const count=calls.reconnect.length;connection.onclose();assert.equal(calls.reconnect.length,count,'an old socket callback cannot restart recovery again');
  const sent=(calls.sent||[]).length;ctx.serverHello({protocolVersion:ctx.PROTOCOL.VERSION});
  assert.equal((calls.sent||[]).length,sent,'a new signaling hello does not claim a deleted room is resumable');
}

{
  const {ctx,calls}=fixture(),motor=ctx.hostPhysics;
  const context={hostEpoch:ctx.hostEpoch,seriesId:ctx.onlineSeriesId,code:ctx.roomCode};
  for(const message of [
    {t:'closed',...context,code:'OLD'},
    {t:'closed',...context,seriesId:'b'.repeat(32)},
    {t:'closed',...context,hostEpoch:ctx.hostEpoch-1},
    {t:'host-migrated',...context,seriesId:'b'.repeat(32),hostIndex:1,started:true,restartRound:true},
    {t:'joined',...context,code:'OLD',started:true},
    {t:'created',...context,started:true}
  ])ctx.handle(message);
  assert.equal(calls.menu,0);assert.equal(ctx.hostPhysics,motor);assert.equal(ctx.isHost,true);assert.equal(calls.recover.length,0);
  ctx.onlineRoomUnavailable=true;
  ctx.handle({t:'host-migrated',...context,hostEpoch:ctx.hostEpoch+1,hostIndex:1,started:true,restartRound:true});
  assert.equal(ctx.hostPhysics,null,'a legitimate higher host epoch stops the previous motor');
  assert.equal(ctx.isHost,false);assert.equal(ctx.hostIndex,1);assert.equal(calls.recover.length,1);
  assert.equal(ctx.onlineRoomUnavailable,false,'a valid authority transition is not blocked by previous connection trouble');
}

for(const host of [true,false]){
  const {ctx,calls}=fixture(),motor=ctx.hostPhysics;
  ctx.isHost=host;ctx.myIndex=host?0:1;ctx.hostIndex=0;ctx.inGame=false;
  motor.finished=true;motor.winner=0;ctx.state={started:true,finished:true,round:1,winner:0};
  if(!host)ctx.hostPhysics=null;
  ctx.handle({t:'resumed',code:'TEST',index:ctx.myIndex,hostIndex:0,hostEpoch:ctx.hostEpoch,seriesId:ctx.onlineSeriesId,started:true,roundFinished:true,roundWinner:0,rankRound:1,playerToken:'token'});
  assert.equal(calls.recover.length,0,'a result already on screen must not be rebuilt on signaling reconnection');
  assert.equal(calls.prepare,0,'reconnection must not hide the victory behind a new game view');
  if(host)assert.equal(ctx.hostPhysics,motor,'finished host motor identity is retained');
}
{
  const {ctx,calls}=fixture(),motor=ctx.hostPhysics;
  ctx.handle({t:'resumed',code:'TEST',index:0,hostIndex:0,hostEpoch:ctx.hostEpoch,seriesId:ctx.onlineSeriesId,started:false,rankRound:0,playerToken:'token'});
  assert.equal(ctx.hostPhysics,null,'confirmed return to lobby cannot keep an old engine running behind the UI');
  assert.equal(motor.started,false);assert.equal(ctx.state,null);assert.equal(ctx.inGame,false);assert.equal(calls.menu,0);
}
function resumeTrackingFixture(){
  const f=fixture(),ctx=f.ctx,wire=[];
  Object.assign(ctx,{
    onlineMembershipGeneration:0,serverProtocolReady:true,NET_FRAME_MS:50,
    closeRoomDialogs:()=>{},impactFX:null,resetGameFeelVisuals:()=>{},resetLeaderAnnouncement:()=>{},
    resetLocalVisual:()=>{},resetRemoteVisuals:()=>{},rebuildPreviousLookup:()=>{},
    clearLobbyChat:()=>{},privateTestProfile:()=> 'standard',lastVoicePlayersSig:0,
    sendSocketRaw:(connection,raw)=>{wire.push(JSON.parse(raw));return true;}
  });
  for(const name of ['invalidatePendingResumeRequests','registerResumeRequest','acceptResumeReply','send'])vm.runInContext(source(name),ctx);
  function attach(){
    const connection=f.socket();connection.resumeRequests=[];
    const start=game.indexOf('    ws.onmessage=e=>{'),end=game.indexOf('\n  }\n  function send(o)',start);
    assert.ok(start>=0&&end>start);
    vm.runInContext(game.slice(start,end).replace('ws.onmessage=','connection.onmessage='),ctx);
    return connection;
  }
  return {...f,ctx,wire,attach,receive:(connection,message)=>connection.onmessage({data:JSON.stringify(message)})};
}
{
  const f=resumeTrackingFixture(),{ctx,calls}=f,connection=f.attach();
  f.receive(connection,{t:'resume-failed',message:'old reply'});
  assert.equal(ctx.onlineRoomUnavailable,false,'a context-free failure without any resume request is ignored');
  assert.equal(ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true}),true);
  assert.equal(ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true}),true);
  assert.equal(f.wire.length,1,'identical in-flight resume requests coalesce locally');
  assert.equal(Object.hasOwn(f.wire[0],'requestId'),false,'resume correlation adds no wire metadata');
  const reply={t:'resumed',code:'TEST',index:0,hostIndex:0,hostEpoch:ctx.hostEpoch,seriesId:ctx.onlineSeriesId,started:true,rankRound:1,recoverHost:false};
  f.receive(connection,reply);assert.equal(connection.resumeRequests.length,0);
  f.receive(connection,{t:'resume-failed'});assert.equal(ctx.onlineRoomUnavailable,false,'a duplicate failure after an accepted reply cannot invalidate the game');
  assert.equal(calls.menu,0);
}
{
  const f=resumeTrackingFixture(),{ctx}=f,connection=f.attach(),epoch=ctx.hostEpoch;
  ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true});
  ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:false});
  assert.equal(connection.resumeRequests.length,2,'distinct recovery intentions keep their ordered requests');
  const reply={t:'resumed',code:'TEST',index:0,hostIndex:0,hostEpoch:epoch,seriesId:ctx.onlineSeriesId,started:true,rankRound:1,recoverHost:false};
  f.receive(connection,reply);assert.equal(connection.resumeRequests.length,1);
  f.receive(connection,reply);assert.equal(connection.resumeRequests.length,1,'an explicit no-recovery duplicate cannot consume a pending host reload');
  f.receive(connection,{...reply,hostEpoch:epoch+1,recoverHost:true,restartRound:true});
  assert.equal(connection.resumeRequests.length,0);assert.equal(ctx.hostEpoch,epoch+1);
  assert.equal(f.calls.recover.length,1,'a legitimate higher-epoch recovery remains accepted');
}
{
  const f=resumeTrackingFixture(),{ctx}=f,connection=f.attach();
  ctx.send({t:'resume',code:'TEST',token:'old',hostSimulationAlive:true});
  ctx.hostPhysics.stop();ctx.hostPhysics=null;ctx.state=null;ctx.inGame=false;ctx.roomCode='';ctx.onlineSeriesId='';ctx.hostEpoch=1;
  ctx.send({t:'create',name:'New'});
  ctx.handle({t:'created',code:'NEXT',index:0,hostIndex:0,hostEpoch:1,seriesId:'b'.repeat(32),playerToken:'new',players:[],started:false});
  assert.equal(connection.resumeRequests.length,0,'accepting a new membership clears earlier resume ownership');
  ctx.inGame=true;ctx.state={started:true,finished:false};
  f.receive(connection,{t:'resume-failed',message:'old request expired'});
  assert.equal(ctx.roomCode,'NEXT');assert.equal(ctx.onlineRoomUnavailable,false,'a context-free stale failure cannot mark a newly created room unavailable');
  ctx.send({t:'resume',code:'NEXT',token:'new',hostSimulationAlive:false});
  f.receive(connection,{t:'resume-failed'});
  assert.equal(ctx.onlineRoomUnavailable,true,'the backend may omit context on a failure that belongs to an actually pending current resume');
}
{
  const f=resumeTrackingFixture(),{ctx}=f,old=f.attach();
  ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true});
  const current=f.attach();
  f.receive(old,{t:'resume-failed'});
  assert.equal(ctx.ws,current);assert.equal(ctx.onlineRoomUnavailable,false,'a previous WebSocket cannot deliver a reply to its replacement');
  ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true});
  ctx.onlineSeriesId='b'.repeat(32);
  f.receive(current,{t:'resume-failed'});
  assert.equal(ctx.onlineRoomUnavailable,false,'reusing the same room code in another series invalidates the old local resume context');
}
{
  const f=resumeTrackingFixture(),{ctx}=f,connection=f.attach();
  ctx.roomCode='';ctx.onlineSeriesId='';ctx.hostEpoch=1;ctx.hostPhysics=null;ctx.inGame=false;ctx.isHost=false;
  ctx.send({t:'resume',code:'TEST',token:'saved',hostSimulationAlive:false});
  f.receive(connection,{t:'resumed',code:'TEST',index:0,hostIndex:0,hostEpoch:6,seriesId:'c'.repeat(32),started:true,rankRound:1,recoverHost:true,restartRound:true});
  assert.equal(ctx.hostEpoch,6);assert.equal(ctx.roomCode,'TEST');assert.equal(f.calls.recover.length,1,'initial saved-session recovery does not require context fields the page did not yet know');
  assert.ok(source('returnToMainMenu').includes('invalidatePendingResumeRequests();'),'explicit exit invalidates pending resume generations');
}
{
  const f=resumeTrackingFixture(),{ctx}=f,connection=f.attach();
  ctx.sendSocketRaw=()=>false;
  assert.equal(ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true}),false);
  assert.equal(connection.resumeRequests.length,0,'a request that was not sent cannot own a later reply');
  ctx.sendSocketRaw=(c,raw)=>{f.wire.push(JSON.parse(raw));return true;};
  assert.equal(ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true}),true);
  assert.equal(f.wire.length,1,'a failed send does not suppress the next actual retry');
  ctx.hostEpoch++;
  f.receive(connection,{t:'resume-failed'});
  assert.equal(ctx.onlineRoomUnavailable,false,'a context-free failure for the earlier host epoch cannot invalidate the newer authority');
}
{
  const f=resumeTrackingFixture(),{ctx}=f,connection=f.attach();
  for(let i=0;i<8;i++){ctx.hostEpoch=2+i;assert.equal(ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true}),true);}
  assert.equal(connection.resumeRequests.length,8);ctx.hostEpoch++;
  assert.equal(ctx.send({t:'resume',code:'TEST',token:'token',hostSimulationAlive:true}),false);
  assert.equal(f.wire.length,8,'the pending request FIFO is bounded rather than emitting unbounded retries');
  assert.equal(ctx.ws,null);assert.equal(connection.resumeRequests.length,0,'retiring a blocked signaling socket clears local request ownership');
  assert.equal(f.calls.menu,0,'bounded recovery does not discard the game motor');
}
async function checkLocalCpuStartup(){
  const f=resumeTrackingFixture(),{ctx}=f,engines=engineContext(),noop=()=>{};
  const ui=()=>{const classes=new Set();return {textContent:'',classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)}};};
  Object.assign(ctx,{
    window:engines.window,document:{getElementById:key=>({value:key==='difficulty'?'medio':'1'})},campoNombre:{value:'Local pilot'},
    startMusic:noop,prepareMobileControls:async()=>{},updateBuildVersionLearningState:noop,postAnalyticsEvent:noop,
    cpuLearningControl:{localHardEnabled:false},activeLocalDifficulty:'',localCampaignLevel:1,
    onlineStartTimer:null,ONLINE_READY_MS:1200,ONLINE_GO_MS:700,warmOnlineStartCaches:noop,
    inputActionHeld:{rocket:false,flare:false,shock:false},currentMatchBackgroundRound:1,
    invisibleHudUntil:[0,0,0,0],nearWinActive:new Set(),shockwaveFx:[],lastLocalKillAt:0,netDebug:false,
    consumeGameFeelFx:noop,detectLocalMissileEvasion:noop,updatePickupVisualBirths:noop,updateLeaderAnnouncement:noop,
    maybeScheduleVictory:noop,selectMatchBackgroundForRound:noop,selectLocalCampaignBackground:noop,
    updateMobileControlUi:noop,scheduleCanvasResolution:noop,menu:ui(),lobby:ui(),victory:ui(),topbar:ui(),mobileControls:ui(),mobileExit:ui(),
    p2p:{close:noop},isMobile:false
  });
  for(const name of ['stopP2P','stopLocalCpu','startLocalCpu','resetOnlineStartCountdown','beginOnlineStartCountdown','beginGame'])vm.runInContext(source(name),ctx);
  const connection=f.attach(),previousOnlineMotor=ctx.hostPhysics;
  await ctx.startLocalCpu();
  for(let i=0;i<6;i++)await Promise.resolve();
  const cpu=ctx.localCpu;
  assert.ok(cpu instanceof engines.window.GalaxyLocalCpu,'JUGAR creates the real CPU simulation');
  assert.equal(ctx.localCpuActive,true);assert.equal(cpu.started,true);
  assert.equal(previousOnlineMotor.started,false,'switching to CPU stops the previous online authority');
  assert.equal(ctx.hostPhysics,null);
  assert.equal(ctx.roomCode,'LOCAL','the real created event is accepted from the current local engine');
  assert.equal(ctx.myIndex,0);assert.equal(ctx.roomCodeEl.textContent,'LOCAL');
  assert.equal(ctx.inGame,true,'the real start event reaches countdown and beginGame');
  assert.equal(ctx.onlineStartPending,false);assert.ok(ctx.onlineStartAt>0);
  assert.equal(ctx.menu.classList.contains('hidden'),true);assert.equal(ctx.lobby.classList.contains('hidden'),true);
  assert.equal(ctx.state.started,true);assert.equal(ctx.state.players.length,2,'the first real CPU snapshot reaches the state dispatcher');
  assert.equal(ctx.state.players[0].n,'Local pilot');
  const seq=ctx.state.seq;cpu.advance(1000);cpu.advance(1020);
  assert.ok(ctx.state.seq>seq,'subsequent CPU onState callbacks also reach the dispatcher');
  cpu.emit({t:'hunter',index:0});assert.equal(ctx.playNoticeKind,'hunter','local engine events stay enabled');
  const state=ctx.state,epoch=ctx.hostEpoch,notice=ctx.playNoticeKind;
  for(const message of [
    {t:'created',code:'OTHER',index:1,started:true},
    {t:'start',code:'OTHER',hostEpoch:epoch+5},
    {t:'state',started:true,finished:true,round:90,seq:900,players:[]},
    {t:'closed',cause:'solo_host'},{t:'resume-failed'},{t:'victory',winner:1},{t:'hunter'}
  ])f.receive(connection,message);
  assert.equal(ctx.roomCode,'LOCAL');assert.equal(ctx.hostEpoch,epoch);assert.equal(ctx.state,state);
  assert.equal(ctx.pendingStateRaw,null,'old WS snapshots cannot even enter the pending-frame queue in CPU');
  assert.equal(ctx.playNoticeKind,notice);assert.equal(ctx.onlineRoomUnavailable,false);assert.equal(f.calls.menu,0);
  ctx.handle({t:'closed'});ctx.handle({t:'state',players:[]});
  assert.equal(ctx.state,state,'untrusted direct/P2P callbacks cannot overwrite CPU state either');
  await ctx.startLocalCpu();for(let i=0;i<6;i++)await Promise.resolve();
  const replacement=ctx.localCpu,replacementState=ctx.state;
  assert.notEqual(replacement,cpu);assert.equal(cpu.started,false);
  cpu.onState({t:'state',players:[]});cpu.emit({t:'closed'});
  assert.equal(ctx.state,replacementState,'retired local engine callbacks cannot overwrite a replacement match');
  ctx.stopLocalCpu();ctx.roomCode='NEXT';ctx.inGame=true;ctx.state={started:true,finished:false};
  const onlineState=ctx.state;replacement.onState({t:'state',players:[]});replacement.emit({t:'closed'});
  assert.equal(ctx.roomCode,'NEXT');assert.equal(ctx.state,onlineState,'retired CPU callbacks cannot alter a later online session');
}
checkLocalCpuStartup().then(()=>console.log('Host continuity OK: signaling/result preservation, stale resume correlation, legitimate migration, real CPU created/start/state flow and isolation from old WS/P2P/local-engine callbacks.')).catch(error=>{console.error(error);process.exitCode=1;});
