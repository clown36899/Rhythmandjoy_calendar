import {Campaign} from './game/campaign.js?v=66';
import {Journey} from './game/model.js?v=66';
import {Autoplay} from './game/autoplay.js?v=66';
import {makeGame} from './game/scene.js?v=66';
import {Soundscape} from './game/audio.js?v=67';
import {ROAD,MAX_HP,MAX_COINS,UNITS,SKILLS,TEAM_SKILLS,CODEX,COMPANIONS,MOTION,motionFrame,AREAS,STAGES,skyState,ENEMY_STRIKE,enemyAttackFrame,bossPose,unitStats,DEFAULT_LOADOUT,validLoadout,REAPER_DEPARTURE_TIME,reaperDepartureFrame,enemyDepartureFrame,isBoss,ENEMIES,healerPose,TEST_MODE,DEFAULT_PARTY,validParty,GATE,ALLY_TYPE_LIMIT,ALLY_TOTAL_LIMIT} from './game/data.js?v=66';
const $=id=>document.getElementById(id);
const model=new Journey();
const autoplay=new Autoplay(model);
const requestedAutoplay=/(?:^|[?&])autoplay=1(?:&|$)/.test(window.location?.search||'');
let lastAutoplayFrame=0,preparing=false,entryEpoch=0,retryAssets=null;
let installPrompt=null,fullscreenPending=false;
let scene,ready=false,lastStatus='',lastHint=0,noticeUntil=0,lastFrame=0,infoPaused=false,coinAnimation,lastKeeperRank=-1,resultReadyAt=Infinity;
const keys=new Set();
const infoDialogs=[$('settings'),$('codex'),$('app-help'),$('loadout'),$('journey-map'),$('roster'),$('opening')];
// Keep dialogs in the fullscreen subtree and one pause owner for nested panels.
for(const dialog of infoDialogs)document.querySelector('.phone-screen').append(dialog);
const motionPreviews=[];
const visiblePreviews=new WeakSet();
const previewObserver=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)visiblePreviews.add(e.target);else visiblePreviews.delete(e.target);},{root:$('codex'),rootMargin:'100px'});
const startButton=$('start');startButton.disabled=true;
let best=0,loadout=[...DEFAULT_LOADOUT],draftLoadout=[],clearedStages=0;
// Campaign completion is distinct from the existing best distance: only a destroyed
// gate earns a clear. One sequential count keeps the stage save recoverable.
try{const saved=Number(localStorage.getItem('saebyeokmun-cleared'));if(Number.isInteger(saved)&&saved>=0&&saved<=STAGES.length)clearedStages=saved;}catch{}
let savedCampaign={};try{savedCampaign=JSON.parse(localStorage.getItem('saebyeokmun-campaign')||'{}')||{};}catch{}
if(!Array.isArray(savedCampaign.cleared))savedCampaign.cleared=Array.from({length:clearedStages},(_,i)=>i);
const campaign=new Campaign(savedCampaign);
let activeRun=0,draftParty=[],rosterFocus='king',rosterMotion=null;
function saveCampaign(){try{localStorage.setItem('saebyeokmun-campaign',JSON.stringify(campaign.snapshot()));return true;}catch{showNotice('이 브라우저에서 저장할 수 없어요. 현재 화면에서만 유지됩니다.');return false;}}
let selectedStage=STAGES.findIndex((_,i)=>!campaign.cleared.includes(i));if(selectedStage<0)selectedStage=0;
document.body.dataset.screen='map';
$('map-acts').innerHTML=['놓친 손을 찾아','남겨진 약속','길을 훔친 문','세 이름, 하나의 집'].map((name,i)=>`<button data-act="${i}" aria-pressed="false"><small>${i*10+1}–${i*10+10}장</small>${name}</button>`).join('');
$('map-acts').addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)selectStage(Number(b.dataset.act)*10);});
$('map-catalog').innerHTML=STAGES.map((stage,i)=>`<button id="stage-${i}" class="map-node" aria-pressed="false"><span class="node-mark">${String(i+1).padStart(2,'0')}</span><b>${stage.name}</b><small>${stage.place} · ${stage.subtitle}</small><em class="stage-state"></em></button>`).join('');
$('map-route-line').setAttribute('points',STAGES.map(s=>s.mapX+','+s.mapY).join(' '));
$('map-pins').innerHTML=STAGES.map((s,i)=>`<button id="pin-${i}" class="map-pin" style="left:${(s.mapX-26)/40*100}%;top:${(s.mapY-51)/34*100}%" aria-label="${i+1}장 ${s.place}, ${s.name}">${i+1}</button>`).join('');
function renderMap(){
 const act=STAGES[selectedStage].act;
 $('map-acts').querySelectorAll('[data-act]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.act)===act)));
 $('map-route-line').setAttribute('points',STAGES.filter(s=>s.act===act).map(s=>s.mapX+','+s.mapY).join(' '));
 for(let i=0;i<STAGES.length;i++){
  const node=$('stage-'+i),cleared=campaign.cleared.includes(i),locked=!TEST_MODE&&i>clearedStages;
  node.disabled=locked;node.dataset.state=cleared?'cleared':locked?'locked':'open';node.setAttribute('aria-pressed',String(i===selectedStage));
  node.querySelector('.stage-state').textContent=cleared?'✓ 되찾은 길':locked?'앞선 길을 열어 주세요':TEST_MODE?'테스트 · 바로 출발':'출발할 수 있어요';
  const pin=$('pin-'+i);pin.disabled=locked;pin.dataset.state=cleared?'cleared':'open';pin.setAttribute('aria-pressed',String(i===selectedStage));
  node.hidden=STAGES[i].act!==act;pin.hidden=STAGES[i].act!==act;
 }
 const stage=STAGES[selectedStage];$('home-chapter').textContent=stage.name+' · '+stage.place;$('map-chapter').textContent=stage.subtitle;$('map-place').textContent=stage.place+' · '+stage.time;
 $('map-name').textContent=stage.name;$('map-brief').textContent=stage.brief;$('map-clears').textContent=campaign.cleared.length+' / '+STAGES.length+' 클리어 · 테스트에서 모든 길 개방';
 $('map-next-clue').textContent='다음 발걸음 · '+stage.clue;
 $('map-skills').textContent=loadout.map(k=>SKILLS[k].name).join(' · ');$('start-label').textContent=campaign.cleared.includes(selectedStage)?'이 길 다시 걷기':'길 따라가기';
 if(scene?.ready&&scene.previewAreaIndex===selectedStage)model.stage=selectedStage;
}
function selectStage(index){if(!Number.isInteger(index)||!STAGES[index]||(!TEST_MODE&&index>clearedStages)||model.status!=='ready')return;selectedStage=index;renderMap();}
function showMap(){
 if(fullscreenPending)return;entryEpoch++;$('asset-loading').close();infoPaused=false;for(const dialog of infoDialogs)if(dialog.open)dialog.close();
 stopAutoplay();
 keys.clear();model.reset();lastStatus='';resultReadyAt=Infinity;selectedStage=STAGES.findIndex((_,i)=>!campaign.cleared.includes(i));if(selectedStage<0)selectedStage=0;
 $('intro').hidden=false;$('result').hidden=true;$('pause-overlay').hidden=true;$('hud').hidden=true;$('callout').hidden=true;document.body.dataset.screen='map';
 scene?.resetPresentation();soundscape.stopVoices(true);soundscape.setPlaying(false);renderMap();openInfo($('journey-map'));
}
$('enter-map').addEventListener('click',()=>{if(ready)openInfo($('journey-map'));});
$('journey-map').querySelector('.dialog-close').addEventListener('click',()=>$('journey-map').close());
for(let i=0;i<STAGES.length;i++)for(const prefix of ['stage-','pin-'])$(prefix+i).addEventListener('click',()=>selectStage(i));
for(const id of ['result-map','pause-map','settings-map'])$(id).addEventListener('click',showMap);

try{const saved=JSON.parse(localStorage.getItem('saebyeokmun-loadout'));if(validLoadout(saved))loadout=saved;}catch{}
try{best=Number(localStorage.getItem('saebyeokmun-best')||0)||0;}catch{}
$('best').textContent=best?best+'%':'아직 걷지 않은 길';
const soundscape=new Soundscape({onState:state=>{
 $('settings-open').dataset.audioState=state;
 $('audio-status').textContent=state==='locked'?'설정에서 효과음을 켜 주세요.':state==='loading'?'밤길의 소리를 준비하고 있어요.':state==='partial'?'일부 소리를 불러오지 못했어요. 새로고침하면 다시 준비합니다.':'소의 뿔 · 돌팔매 · 먹붓 · 씨앗탄 · 선비의 봉인 · 승천';
}});
function unlockSound(){return soundscape.unlock().catch(()=>{showNotice('소리를 시작하지 못했어요. 설정에서 소리를 다시 켜 주세요.');});}
try{const saved=JSON.parse(localStorage.getItem('saebyeokmun-audio'));for(const channel of ['music','effects'])if(typeof saved?.[channel]==='boolean')soundscape.setChannelEnabled(channel,saved[channel]);if(typeof saved?.volume==='number'&&Number.isFinite(saved.volume))soundscape.setVolume(saved.volume);}catch{}
function updateSound(){for(const channel of ['music','effects']){const on=soundscape[channel+'Enabled'],b=$(channel+'-toggle');b.setAttribute('aria-pressed',String(on));b.querySelector('.switch-state').textContent=on?'켬':'끔';}$('sound-volume').value=Math.round(soundscape.volume*100);$('volume-value').textContent=Math.round(soundscape.volume*100)+'%';}
function saveSound(){try{localStorage.setItem('saebyeokmun-audio',JSON.stringify({music:soundscape.musicEnabled,effects:soundscape.effectsEnabled,volume:soundscape.volume}));}catch{}}
updateSound();
// Opening preferences are separate from campaign rewards; the existing modal owns pause/resume.
let openingEnabled=true;try{openingEnabled=localStorage.getItem('saebyeokmun-opening')!=='false';}catch{}
function updateOpening(){const b=$('opening-toggle');b.setAttribute('aria-pressed',String(openingEnabled));b.querySelector('.switch-state').textContent=openingEnabled?'켬':'끔';}
function stopNarration(){$('opening-voice').pause();$('opening-voice').currentTime=0;$('opening-narrate').setAttribute('aria-pressed','false');$('opening-narrate').textContent='나레이션 듣기 ♫';}
function showOpening(){if(fullscreenPending)return;loadDialogImages($('opening'));stopNarration();openInfo($('opening'));for(const d of infoDialogs)if(d!==$('opening')&&d.open)d.close();$('opening-continue').disabled=!ready;$('opening-skip').disabled=!ready;}
updateOpening();
$('opening-toggle').addEventListener('click',()=>{openingEnabled=!openingEnabled;try{localStorage.setItem('saebyeokmun-opening',String(openingEnabled));}catch{}updateOpening();if(openingEnabled)showOpening();});
$('opening-replay').addEventListener('click',showOpening);
for(const id of ['opening-continue','opening-skip'])$(id).addEventListener('click',()=>{if(ready)$('opening').close();});
$('opening').addEventListener('close',stopNarration);
$('opening-narrate').addEventListener('click',async()=>{const voice=$('opening-voice');if(!voice.paused){stopNarration();return;}voice.volume=soundscape.volume;try{await voice.play();$('opening-narrate').setAttribute('aria-pressed','true');$('opening-narrate').textContent='나레이션 멈추기 ■';}catch{$('opening-loading').textContent='음성을 시작하지 못했어요. 이야기는 화면에서 읽을 수 있어요.';}});
$('opening-voice').addEventListener('ended',stopNarration);
function updateBest(){const n=Math.floor(model.progress()*100);best=Math.max(best,n);$('best').textContent=best+'%';try{localStorage.setItem('saebyeokmun-best',String(best));}catch{}}
async function start(testStage=null){
 const testing=Number.isInteger(testStage)&&autoplay.active;
 if(!ready||preparing||fullscreenPending||(!testing&&!TEST_MODE&&selectedStage>clearedStages))return;
 if(testing)selectedStage=testStage;else stopAutoplay();
 const stage=selectedStage;
 if(!await prepareFor(`${stage+1}장 · ${STAGES[stage].name}`,p=>scene.prepareStage(stage,p),()=>start(testing?stage:null)))return;
 infoPaused=false;for(const dialog of infoDialogs)if(dialog.open)dialog.close();
 if(!testing){activeRun=campaign.begin();saveCampaign();}
 model.start(selectedStage,testing?DEFAULT_PARTY:campaign.party,scene?.vw,{tour:testing});
 if(testing){autoplay.enter();scene.playbackRate=autoplay.rate;}
 renderSummonSlots();renderSkillSlots();renderAutoplay();keys.clear();lastStatus='';resultReadyAt=Infinity;document.body.dataset.screen='game';$('intro').hidden=true;$('result').hidden=true;$('pause-overlay').hidden=true;$('hud').hidden=false;$('callout').hidden=false;
 if(scene)scene.resetPresentation();prefetchNext(stage);updateAuto();soundscape.stopVoices(true);soundscape.setPlaying(true);unlockSound().then(()=>{if(model.status==='playing')soundscape.play('summon');});
}
function pause(){if(!ready||fullscreenPending)return;if(autoplay.active){if(autoplay.complete)return;autoplay.paused=model.status==='paused'?false:!autoplay.paused;}model.pause();keys.clear();model.direction=0;renderAutoplay();soundscape.setPlaying(model.status==='playing');if(model.status==='playing')unlockSound();}
function stopAutoplay(){autoplay.stop();if(scene)scene.playbackRate=1;renderAutoplay();renderSkillSlots();}
function beginAutoplay(){if(!ready||preparing||fullscreenPending)return;lastAutoplayFrame=performance.now();start(autoplay.begin());}
function renderAutoplay(){
 const a=autoplay,m=model;document.body.dataset.autoplay=String(a.active);$('autoplay-panel').hidden=!a.active;
 for(const id of ['move-left','move-right','auto'])$(id).disabled=a.active;
 for(const id of ['autoplay-start','autoplay-home'])$(id).disabled=!ready;
 if(!a.active)return;
 $('autoplay-title').textContent=a.complete?'전체 맵 테스트 완료':`${m.stage+1} / ${STAGES.length} · ${STAGES[m.stage].name}`;
 const paused=a.paused||m.status==='paused',seconds=Math.floor(a.elapsed);
 $('autoplay-state').textContent=(a.complete?`${a.clears.length}개 맵 완주`:paused?'일시정지 · 주인공 무적':m.status==='won'?'길을 열었어요 · 다음 맵 준비':'짧은 코스 · 주인공 무적')+` · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 $('autoplay-pause').textContent=paused?'계속':'일시정지';$('autoplay-pause').disabled=a.complete;
 $('autoplay-stop').textContent=a.complete?'돌아가기':'중지';$('autoplay-speed').value=String(a.rate);
 const progress=(a.clears.length+(m.status==='won'?0:m.progress()))/STAGES.length;
 $('autoplay-progress').value=progress;$('autoplay-progress').setAttribute('aria-label',`전체 맵 테스트 ${a.clears.length} / ${STAGES.length} 완료`);
}
for(const id of ['autoplay-start','autoplay-home'])$(id).addEventListener('click',beginAutoplay);
$('autoplay-pause').addEventListener('click',pause);
$('autoplay-stop').addEventListener('click',showMap);
$('autoplay-speed').addEventListener('change',e=>{autoplay.setRate(e.target.value);if(scene)scene.playbackRate=autoplay.rate;});
function renderMinimap(m){
 const bounds=m.viewport||{left:0,right:m.gateX},pad=340,left=Math.min(0,bounds.left-pad),right=Math.max(m.gateX,bounds.right+pad),span=right-left;
 const x=value=>8+224*Math.max(0,Math.min(1,(value-left)/span));
 $('minimap-view').setAttribute('x',String(x(bounds.left)));$('minimap-view').setAttribute('width',String(x(bounds.right)-x(bounds.left)));
 const allies=m.allies.filter(a=>a.hp>0),enemies=m.enemies.filter(e=>e.hp>0);
 $('minimap-points').innerHTML=[`<circle class="map-hero" cx="${x(m.x)}" cy="23" r="3"/>`,...allies.map(a=>`<circle data-actor="a${a.id}" class="map-ally" cx="${x(a.x)}" cy="${10+a.id%3*4}" r="2"/>`),...enemies.map(e=>`<circle data-actor="e${e.id}" class="map-enemy" cx="${x(e.x)}" cy="${28+e.id%3*4}" r="2"/>`)].join('');
 $('battle-minimap').setAttribute('aria-label',`전장 미니맵 · 아군 ${allies.length}명 · 적 ${enemies.length}명 · 흰 점 주인공, 청록 점 아군, 붉은 점 적`);
}
function updateAuto(){$('auto').setAttribute('aria-pressed',String(model.auto));}
function callAction(name){if(UNITS[name])model.summon(name);else model.skill(name);}
function setDirection(){model.direction=keys.has('right')?1:keys.has('left')?-1:0;}
function setupHold(button,direction){
 const release=e=>{keys.delete(direction);button.classList.remove('held');setDirection();if(e&&button.hasPointerCapture?.(e.pointerId))button.releasePointerCapture(e.pointerId);};
  button.addEventListener('pointerdown',e=>{e.preventDefault();if(model.status!=='playing'||autoplay.active)return;button.setPointerCapture(e.pointerId);keys.add(direction);button.classList.add('held');setDirection();});
 button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
}
setupHold($('move-left'),'left');setupHold($('move-right'),'right');
$('start').addEventListener('click',start);$('restart').addEventListener('click',start);$('restart-pause').addEventListener('click',start);
$('pause').addEventListener('click',pause);$('resume').addEventListener('click',pause);

$('auto').addEventListener('click',()=>{if(!autoplay.active){model.auto=!model.auto;updateAuto();}});
$('actions').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)callAction(b.dataset.action);});
for(const [id,dir]of [['summon-prev',-1],['summon-next',1]])$(id).addEventListener('click',()=>{$('summon-slots').scrollBy({left:dir*$('summon-slots').clientWidth*.8,behavior:'smooth'});});
$('upgrade').addEventListener('click',()=>{if($('settings').open){$('settings').close();completeInfo();}model.upgradeKeeper();});
document.addEventListener('dragstart',e=>e.preventDefault());
document.addEventListener('keydown',e=>{
 if(fullscreenPending||infoDialogs.some(d=>d.open))return;
 const k=e.key.toLowerCase();
 if(autoplay.active&&k!==' ')return;
 if(['arrowleft','arrowright',' ','a','d','q','e','r','1','2','3','4','5'].includes(k))e.preventDefault();
 if(k===' '){if(!e.repeat)pause();return;}
 if(k==='enter'&&model.status==='ready'&&ready)openInfo($('journey-map'));
 if(k==='arrowleft'||k==='a'){keys.add('left');setDirection();}
 if(k==='arrowright'||k==='d'){keys.add('right');setDirection();}
 if(!e.repeat&&{'1':model.summonTypes[0],'2':model.summonTypes[1],'3':model.summonTypes[2],'4':model.summonTypes[3],'5':model.summonTypes[4],q:loadout[0],e:loadout[1],r:loadout[2]}[k])callAction({'1':model.summonTypes[0],'2':model.summonTypes[1],'3':model.summonTypes[2],'4':model.summonTypes[3],'5':model.summonTypes[4],q:loadout[0],e:loadout[1],r:loadout[2]}[k]);
});
document.addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(k==='arrowleft'||k==='a')keys.delete('left');if(k==='arrowright'||k==='d')keys.delete('right');setDirection();});
function blurPause(){keys.clear();model.direction=0;infoPaused=false;if(autoplay.active&&!autoplay.complete)autoplay.paused=true;if(model.status==='playing')model.pause();renderAutoplay();soundscape.setPlaying(false);soundscape.stopVoices();stopNarration();}
window.addEventListener('blur',blurPause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)blurPause();});
window.matchMedia('(max-width:600px) and (orientation:portrait)').addEventListener('change',e=>{if(e.matches)blurPause();});
for(const channel of ['music','effects'])$(channel+'-toggle').addEventListener('click',()=>{soundscape.setChannelEnabled(channel,!soundscape[channel+'Enabled']);updateSound();saveSound();if(soundscape[channel+'Enabled'])unlockSound().then(()=>{if(channel==='effects')soundscape.play('guard',{allowIdle:true});});});
$('sound-volume').addEventListener('input',e=>{soundscape.setVolume(e.target.value/100);updateSound();saveSound();});
document.querySelectorAll('[data-sound]').forEach(button=>button.addEventListener('click',async()=>{
 if(!soundscape.effectsEnabled){$('audio-status').textContent='설정에서 효과음을 켜면 미리 들을 수 있어요.';return;}await unlockSound();soundscape.play(button.dataset.sound,{allowIdle:true});
}));
$('fullscreen').addEventListener('click',async()=>{
 if(fullscreenPending)return;
 fullscreenPending=true;$('settings-open').disabled=true;
 // Fullscreen is added above existing top-layer dialogs. Close them first so
 // an invisible modal cannot keep the entire game inert. Retain pause ownership
 // until the browser finishes; queued close events must not resume early.
 for(const dialog of [...infoDialogs].reverse())if(dialog.open)dialog.close();
 try{
  if(document.fullscreenElement)await document.exitFullscreen();
  else{
   await document.querySelector('.phone-screen').requestFullscreen();
   // Optional orientation lock must never delay restoring game controls.
   try{screen.orientation?.lock?.('landscape')?.catch(()=>{});}catch{}
  }
 }catch{openInfo($('app-help'));}
 finally{fullscreenPending=false;$('settings-open').disabled=false;completeInfo();}
});
document.addEventListener('fullscreenchange',()=>{const text=document.fullscreenElement?'전체 화면 나가기':'전체 화면';$('fullscreen').setAttribute('aria-label',text);$('fullscreen').textContent='⤢ '+text;});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install-confirm').hidden=false;});
window.addEventListener('appinstalled',()=>{installPrompt=null;$('install-confirm').hidden=true;$('app-help').close();});
$('install').addEventListener('click',()=>openInfo($('app-help')));
$('app-help').querySelector('.dialog-close').addEventListener('click',()=>$('app-help').close());
$('install-confirm').addEventListener('click',async()=>{if(!installPrompt)return;const prompt=installPrompt;installPrompt=null;$('install-confirm').hidden=true;await prompt.prompt();await prompt.userChoice;});
// Every combat gesture can recover mobile audio after an OS interruption.
document.addEventListener('pointerdown',()=>{if(model.status==='playing'&&soundscape.enabled&&soundscape.context?.state!=='running')unlockSound();},{passive:true});
function showNotice(message){$('callout').textContent=message;$('callout').hidden=false;noticeUntil=performance.now()+2400;}
function loadDialogImages(dialog){dialog.querySelectorAll('img[data-src]').forEach(img=>{img.src=img.dataset.src;delete img.dataset.src;});}
function openInfo(dialog){loadDialogImages(dialog);if(!fullscreenPending&&!infoDialogs.some(d=>d.open)){infoPaused=model.status==='playing';if(infoPaused)model.pause();}keys.clear();model.direction=0;soundscape.setPlaying(false);dialog.showModal();}
function completeInfo(){if(fullscreenPending||infoDialogs.some(d=>d.open))return;soundscape.stopVoices();if(infoPaused&&model.status==='paused')model.pause();soundscape.setPlaying(model.status==='playing');infoPaused=false;}
$('settings-open').addEventListener('click',()=>openInfo($('settings')));
$('settings-return').addEventListener('click',()=>$('settings').close());
$('settings').querySelector('.dialog-close').addEventListener('click',()=>$('settings').close());
async function openCodex(){if(!ready||preparing)return;if(!await prepareFor('동료와 귀물 도감',p=>scene.ensureCommon(p),openCodex))return;openInfo($('codex'));}
$('codex-open').addEventListener('click',openCodex);$('result-codex').addEventListener('click',openCodex);$('sources-open').addEventListener('click',openCodex);
$('codex').querySelector('.dialog-close').addEventListener('click',()=>$('codex').close());
$('codex').addEventListener('close',()=>{for(const p of motionPreviews){p.variants.clear();p.frame=-1;p.img.removeAttribute('src');}if(scene?.commonReady)scene.retainFiles([...scene.stageKeys]);});
$('codex').addEventListener('click',e=>{if(e.target===$('codex')){const r=$('codex').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('codex').close();}});
for(const dialog of infoDialogs)dialog.addEventListener('close',completeInfo);
function renderSkillSlots(){
 $('team-skills').innerHTML=Object.entries(TEAM_SKILLS).map(([key,s])=>`<button class="action team-action" id="action-${key}" data-action="${key}" hidden><span class="action-art"><img data-icon="${s.icon}" alt="" draggable="false"></span><strong>${s.name}</strong><small>5인 합동</small><span class="cooldown"></span></button>`).join('');
 $('skill-slots').innerHTML=(autoplay.active?['charm','stomp','shelter']:loadout).map((key,i)=>{const s=SKILLS[key];return `<button class="action" id="action-${key}" data-action="${key}"><span class="action-role magic">${s.role}</span><kbd>${['Q','E','R'][i]}</kbd><span class="action-art"><img data-icon="${s.icon}" alt="" draggable="false"></span><strong>${key==='rush'?'해태 돌진':key==='stomp'?'발구름':s.name}</strong><small>◎ ${s.cost}</small><span class="cooldown"></span></button>`;}).join('');
 if(scene)for(const id of ['skill-slots','team-skills'])$(id).querySelectorAll('[data-icon]').forEach(img=>{img.src=scene.previewTexture(img.dataset.icon);});
}
function renderTeamSkills(m,s){
 let visible=false;for(const [key,spec]of Object.entries(TEAM_SKILLS)){
  const b=$('action-'+key),count=m.countAllies(spec.unit),active=m.teamAction?.key===key;if(!b)continue;
  b.hidden=count<spec.required&&!active;if(b.hidden)continue;visible=true;
  b.disabled=!m.teamReady(key);b.dataset.state=active?'active':m.cooldowns[key]>0?'cooldown':b.disabled?'idle':'ready';
  b.querySelector('small').textContent=active?({gather:'정렬 중',perform: key==='prayer'?'기도 중':key==='cavalryCharge'?'돌진 중':m.teamAction.launched+' / '+spec.volleys+'회 사격',return:'복귀 중'}[m.teamAction.phase]):m.cooldowns[key]>0?Math.ceil(m.cooldowns[key])+'초':count+'명 · 준비';
  b.style.setProperty('--cooldown-turn',m.cooldowns[key]/spec.cooldown+'turn');b.setAttribute('aria-label',spec.description+' '+b.querySelector('small').textContent);b.title=spec.description;
  const img=b.querySelector('img');if(!img.src)img.src=s.previewTexture(spec.icon);
 }
 $('team-skills').hidden=!visible;
}
function renderSummonSlots(){
 $('summon-slots').innerHTML=(TEST_MODE?Object.keys(UNITS):campaign.party).map((key,i)=>{const s=UNITS[key],icon=key==='keeper'&&model.keeperRank?'keeperBrush1':key+'1';return `<button class="action" id="action-${key}" data-action="${key}"><kbd>${i<5?i+1:'↔'}</kbd><span class="unit-count">0/10</span><span class="action-art"><img data-icon="${icon}" src="${scene?.previewTexture(icon)||''}" alt="" draggable="false"></span><strong>${s.name}</strong><small>◎ ${s.cost}</small><span class="cooldown"></span></button>`;}).join('');
 lastKeeperRank=-1;
}
function renderRoster(){
 $('roster-balance').textContent='◎ '+campaign.balance.toLocaleString('ko-KR');
 $('roster-count').textContent=draftParty.length+' / 5 편성';$('roster-save').disabled=!validParty(draftParty);
 $('roster-slots').innerHTML=Array.from({length:5},(_,i)=>`<button data-party-remove="${i}" ${draftParty[i]?'':'disabled'} aria-label="${i+1}번 ${UNITS[draftParty[i]]?.name||'빈 자리'} 편성 해제"><small>${i+1}</small>${draftParty[i]?`<img src="${scene.previewTexture(draftParty[i]+'1')}" alt="" draggable="false"><span>${UNITS[draftParty[i]].name}</span>`:'<span>+</span>'}</button>`).join('');
 $('roster-choices').innerHTML=Object.entries(UNITS).map(([key,s])=>`<button class="roster-card" data-character="${key}" aria-label="${s.name} 살펴보기" aria-pressed="${rosterFocus===key}"><img src="${scene.previewTexture(key+'1')}" alt="" draggable="false"><strong>${s.name}</strong><small>${s.role.split(' · ')[0]}</small><em>${draftParty.includes(key)?'편성 중':campaign.owned.includes(key)?'보유':'◎ '+s.price+' · 체험 가능'}</em></button>`).join('');
 const s=UNITS[rosterFocus];$('roster-name').textContent=s.name;$('roster-role').textContent=s.role;$('roster-stats').textContent='체력 '+s.hp+' · 공격 '+s.damage+' · 소환 '+s.cost+' 엽전';
 $('roster-description').textContent=({king:'어보의 빛으로 적을 잠깐 봉인합니다.',prince:'후열에서 활을 당겨 화살이 닿을 때 피해를 줍니다.',minister:'교지와 부채를 펼쳐 먼 상대의 공격 준비를 끊습니다.',cavalry:'말을 타고 앞줄로 달려가 검으로 공격합니다.',spearman:'2스테이지에서는 한 명이 자동으로 돕습니다. 직접 편성하면 소환할 수 있어요.',archer:'2스테이지 중반에 한 명이 자동으로 돕습니다. 편성하면 다른 길에서도 소환할 수 있어요.',healer:'부상한 동료를 찾아가 움직이는 중에도 붕대를 감습니다.'})[rosterFocus]||'함께 걸으며 각자의 거리에서 길을 지킵니다.';
 const owned=campaign.owned.includes(rosterFocus),selected=draftParty.includes(rosterFocus),buy=$('roster-buy');buy.disabled=owned||campaign.balance<s.price;buy.textContent=owned?'보유 중':'구매 · ◎ '+s.price;
 const select=$('roster-select');select.disabled=selected||draftParty.length===5||(!TEST_MODE&&!owned);select.textContent=selected?'편성 중':owned?'편성에 넣기':'테스트로 편성';
 const img=$('roster-preview');img.src=scene.previewTexture(rosterFocus+'1');rosterMotion={kind:rosterFocus,enemy:false,img,keys:Array.from({length:rosterFocus==='cow'?57:8},(_,i)=>rosterFocus+i),variants:new Map(),health:1,mode:'walk',started:performance.now(),frame:-1};
}
async function openRoster(){if(!ready||preparing||['playing','paused'].includes(model.status))return;if(!await prepareFor('동료 편성',p=>scene.ensureCommon(p),openRoster))return;draftParty=[...campaign.party];renderRoster();openInfo($('roster'));}
for(const id of ['roster-open','map-roster','result-roster'])$(id).addEventListener('click',openRoster);
$('roster-choices').addEventListener('click',e=>{const b=e.target.closest('[data-character]');if(!b)return;rosterFocus=b.dataset.character;renderRoster();});
$('roster-slots').addEventListener('click',e=>{const b=e.target.closest('[data-party-remove]');if(!b||b.disabled)return;draftParty.splice(Number(b.dataset.partyRemove),1);renderRoster();});
$('roster-select').addEventListener('click',()=>{if(draftParty.length<5&&!draftParty.includes(rosterFocus)&&(TEST_MODE||campaign.owned.includes(rosterFocus))){draftParty.push(rosterFocus);renderRoster();}});
$('roster-buy').addEventListener('click',()=>{if(campaign.buy(rosterFocus)){saveCampaign();renderRoster();}});
$('roster-save').addEventListener('click',()=>{if(campaign.select(draftParty)){saveCampaign();renderSummonSlots();$('roster').close();}});
$('roster').querySelector('.dialog-close').addEventListener('click',()=>$('roster').close());
$('roster-motions').addEventListener('click',e=>{const b=e.target.closest('[data-roster-motion]');if(b&&rosterMotion){rosterMotion.mode=b.dataset.rosterMotion;rosterMotion.started=performance.now();}});
function renderLoadout(){
 $('loadout-slots').innerHTML=[0,1,2].map(i=>`<button data-remove="${i}" ${draftLoadout[i]?'':'disabled'}><kbd>${['Q','E','R'][i]}</kbd>${SKILLS[draftLoadout[i]]?.name||'비어 있는 자리'}${draftLoadout[i]?'<span>×</span>':''}</button>`).join('');
 $('loadout-choices').innerHTML=Object.entries(SKILLS).map(([key,s])=>{const i=draftLoadout.indexOf(key);return `<button class="skill-choice" data-skill="${key}" aria-pressed="${i>=0}" ${i<0&&draftLoadout.length===3?'disabled':''}><img src="${scene?.previewTexture(s.icon)||''}" alt="" draggable="false"><span class="choice-role">${s.role} ${i>=0?'· '+['Q','E','R'][i]+' 장착':''}</span><strong>${s.name}</strong><p>${s.description}</p><small>◎ ${s.cost} · 대기 ${s.cooldown}초</small></button>`;}).join('');
 $('loadout-count').textContent=draftLoadout.length+' / 3 선택';$('loadout-save').disabled=!validLoadout(draftLoadout);
}
async function openLoadout(){if(!ready||preparing||['playing','paused'].includes(model.status))return;if(!await prepareFor('필살기 편성',p=>scene.ensureCommon(p),openLoadout))return;draftLoadout=[...loadout];renderLoadout();openInfo($('loadout'));}
for(const id of ['loadout-open','map-loadout'])$(id).addEventListener('click',openLoadout);
$('loadout-choices').addEventListener('click',e=>{const b=e.target.closest('[data-skill]');if(!b||b.disabled)return;const k=b.dataset.skill;if(draftLoadout.includes(k))draftLoadout=draftLoadout.filter(v=>v!==k);else if(draftLoadout.length<3)draftLoadout.push(k);renderLoadout();});
$('loadout-slots').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b||b.disabled)return;draftLoadout.splice(Number(b.dataset.remove),1);renderLoadout();});
$('loadout-save').addEventListener('click',()=>{if(!validLoadout(draftLoadout))return;loadout=[...draftLoadout];try{localStorage.setItem('saebyeokmun-loadout',JSON.stringify(loadout));}catch{}renderSkillSlots();if(model.status==='ready')renderMap();$('loadout').close();});
$('loadout').querySelector('.dialog-close').addEventListener('click',()=>$('loadout').close());
renderSkillSlots();
function onReady(error,s){
 if(error){$('loading').textContent=error.message;$('home-loading').textContent=error.message;$('opening-loading').textContent=error.message;return;}
 scene=s;ready=true;startButton.disabled=false;$('enter-map').disabled=false;$('roster-open').disabled=false;$('home-loading').hidden=true;$('loading').hidden=true;$('opening-continue').disabled=false;$('opening-skip').disabled=false;$('opening-loading').textContent='갈 길을 고르면 필요한 그림부터 받습니다.';renderMap();renderSummonSlots();
 document.querySelectorAll('[data-icon]').forEach(img=>{img.src=scene.previewTexture(img.dataset.icon);img.draggable=false;});
 const preview={skirt:'skirt0',horse:'horse',reaper:'reaper',boss:'boss',haetae:'haetae1',rabbit:'rabbit1',keeper:'keeper1',cow:'cow1',scholar:'scholar1',healer:'healer1',king:'king1',prince:'prince1',minister:'minister1',cavalry:'cavalry1',girl:'girl1',warden:'wardenWalk0',ferryman:'ferrymanWalk0',waterghost:'waterghostWalk0',spearman:'spearman0',archer:'archer0',mangtae:'mangtaeWalk0',shadow:'shadowWalk0'};
 for(const [kind,spec]of Object.entries(ENEMIES))if(spec.atlas)preview[kind]=kind+'Walk0';
 for(const item of [...COMPANIONS,...CODEX]){
  const article=document.createElement('article');article.className='codex-card';
  const img=document.createElement('img');img.alt=item.name;img.className='sprite-preview';img.draggable=false;
  const tag=document.createElement('small');tag.textContent=item.tag;
  const title=document.createElement('h3');title.textContent=item.name;
  const body=document.createElement('p');body.textContent=item.text;
  const counter=document.createElement('p');counter.className='counter';counter.textContent=item.counter;
  article.append(img,tag,title,body,counter);
  if(item.source){const url=item.sourceUrl||item.url,source=document.createElement(url?'a':'p');source.className='source-note';source.textContent=item.source;if(url){source.href=url;source.target='_blank';source.rel='noreferrer';source.draggable=false;}article.append(source);}
  if(item.motion||CODEX.includes(item)){
   const row=document.createElement('div');row.className='motion-controls';row.setAttribute('role','group');row.setAttribute('aria-label',item.name+' 동작 시험');
   const enemy=CODEX.includes(item),defaultMode='walk';
   const keys=Array.from({length:enemy?8:(MOTION[item.asset].idleFrame!==undefined?MOTION[item.asset].idleFrame+1:(MOTION[item.asset].walkFrames||4)+(item.motion==='walk'?0:(MOTION[item.asset].attackFrames||4)))},(_,i)=>item.asset+(enemy?(i<4?'Walk':'Strike'):'')+(enemy?i%4:i));
   const state={kind:item.asset,enemy,img,keys,variants:new Map(),health:1,mode:defaultMode,started:performance.now(),frame:-1,buttons:[]};
   const modes=item.motion==='walk'?[['walk','걷기'],['idle','멈춤']]:[['walk','걷기'],['attack',item.asset==='healer'?'치료':'공격'],['idle','멈춤']];
   if(!enemy)modes.push(['depart','쓰러짐']);else{modes.push(['depart','소멸']);if(isBoss(item.asset))modes.push(['cast',ENEMIES[item.asset].ability.name||'특수 공격']);}
   for(const [mode,label] of modes){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',item.name+' '+label);button.setAttribute('aria-pressed',String(mode===defaultMode));
    button.addEventListener('click',()=>{state.mode=mode;state.frame=-1;state.started=performance.now();state.buttons.forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});state.buttons.push(button);row.append(button);
   }
   article.append(row);
   const healthRow=document.createElement('div');healthRow.className='motion-controls';healthRow.setAttribute('role','group');healthRow.setAttribute('aria-label',item.name+' 피해 상태');
   const healthButtons=[];
   for(const [health,label] of [[1,'멀쩡함'],[.7,'상처'],[.3,'큰 상처']]){
    const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',item.name+' '+label);b.setAttribute('aria-pressed',String(health===1));
    b.addEventListener('click',()=>{state.health=health;state.frame=-1;healthButtons.forEach(other=>other.setAttribute('aria-pressed',String(other===b)));});healthButtons.push(b);healthRow.append(b);
   }
   article.append(healthRow);motionPreviews.push(state);previewObserver?.observe(img);
  }
  $(COMPANIONS.includes(item)?'companions-grid':'codex-grid').append(article);
 }
 renderAutoplay();
 if(requestedAutoplay)beginAutoplay();
}
function onEvents(events){
 if(events.some(e=>e.type==='coin')){coinAnimation?.cancel();coinAnimation=$('coins').animate([{transform:'scale(1)'},{transform:'scale(1.16)',color:'#be8f36'},{transform:'scale(1)'}],{duration:260});}
 for(const e of events){
  if(e.type==='notice')showNotice(e.message);
  soundscape.event(e,model.x);
 }
}
function onFrame(m,s){
 soundscape.setPlaying(m.status==='playing');
 const now=performance.now();
 const next=autoplay.update(lastAutoplayFrame?Math.max(0,(now-lastAutoplayFrame)/1000):0,preparing||fullscreenPending||document.hidden||infoDialogs.some(d=>d.open));lastAutoplayFrame=now;
 if(next!==null)start(next);
 if($('codex').open||$('roster').open)for(const p of [...($('codex').open?motionPreviews:[]),...($('roster').open&&rosterMotion?[rosterMotion]:[])]){
  if(previewObserver&&p!==rosterMotion&&!visiblePreviews.has(p.img)){if(p.variants.size){p.variants.clear();p.frame=-1;p.img.removeAttribute('src');}continue;}
  if(ENEMIES[p.kind]&&!scene.previewReady(p.kind)){
   if(!p.loading&&now>=(p.retryAt||0)){p.img.alt=p.kind+' · 그림 준비 중';p.loading=scene.ensurePreview(p.kind).then(()=>{p.frame=-1;p.variants.clear();p.img.alt=ENEMIES[p.kind].name;}).catch(()=>{p.retryAt=performance.now()+5000;p.img.alt='그림을 다시 준비합니다';}).finally(()=>{p.loading=null;});}continue;
  }
  const spec=p.enemy?ENEMY_STRIKE:MOTION[p.kind],elapsed=(now-p.started)/1000,phase=elapsed%((spec.duration||.64)+.7);
  const action=p.mode==='attack'&&phase<spec.duration?{elapsed:phase}:null;
  const dying=p.mode==='depart',deathDuration=p.kind==='reaper'?REAPER_DEPARTURE_TIME:p.enemy?(isBoss(p.kind)?2.7:2.1):1.8,deathProgress=Math.min(1,(elapsed%(deathDuration+1))/deathDuration);
  const frame=p.enemy?(action?4+enemyAttackFrame(phase):motionFrame(p.kind,elapsed,p.mode==='walk',null)):motionFrame(p.kind,p.mode==='walk'?elapsed:0,p.mode==='walk',action);
  const ability=isBoss(p.kind)?ENEMIES[p.kind].ability:null,castPhase=elapsed%((ability?.windup??2.6)+(ability?.duration??1.15)+.7);
  const bossKey=ability?bossPose(elapsed,p.mode==='walk',p.mode==='cast'&&castPhase>=ability.windup&&castPhase<ability.windup+ability.duration?{kind:ability.kind,elapsed:castPhase-ability.windup}:action?{...action,kind:'enemy'}:null,p.mode==='cast'&&castPhase<ability.windup?ability.windup-castPhase:0,p.kind):null;
  const pose=['king','prince','minister','cavalry'].includes(p.kind)&&p.mode==='idle'?p.kind+'Idle0':p.kind==='healer'?healerPose(elapsed,p.mode==='walk',action?{...action,kind:'healer',phase:'treat'}:null,elapsed):bossKey||p.keys[frame];
  const key=dying?(p.kind==='reaper'?'reaperDepart'+reaperDepartureFrame(deathProgress):p.enemy?'depart'+p.kind+enemyDepartureFrame(deathProgress,ENEMIES[p.kind]?.departureFrames):'defeat'+p.kind+(deathProgress<.32?0:1)):scene.injuryTexture(pose,p.kind,p.health,1);

  p.img.style.opacity=dying?String(1-Math.max(0,(deathProgress-.55)/.45)):'1';
  p.img.style.transform=dying&&p.kind==='reaper'?'translateY(-'+Math.min(1,deathProgress/.46)*9+'px)':'';
  if(key!==p.frame){if(!p.variants.has(key))p.variants.set(key,scene.previewTexture(key));p.img.src=p.variants.get(key);p.frame=key;}
 }
 if(now-lastFrame<70)return;lastFrame=now;
 renderAutoplay();
 $('hero-state').textContent=m.invincible?'테스트 · 무적':m.hp<=0?'잠시 쉬어 가기':m.shield>0?'우산으로 보호 중':m.action?.kind==='rush'?'해태 돌진':m.action?'합동 공격':m.moving?'길을 걷는 중':'숨 고르는 중';
 $('health-fill').style.width=(m.hp/MAX_HP*100)+'%';$('hp-text').textContent=Math.ceil(m.hp)+' / '+MAX_HP;
 const fraction=m.progress(),progress=Math.floor(fraction*100),sky=skyState(fraction,m.time,m.status==='ready'?s.previewAreaIndex:m.stage),moonMix=sky.night;
 $('distance').textContent=progress+'%';$('route-fill').style.width=fraction*100+'%';document.querySelector('.route-dot').style.left=fraction*100+'%';
 $('sky-label').textContent=sky.name;$('journey-dial').style.setProperty('--celestial',moonMix>.5?'#b9d9f5':sky.name==='노을'?'#ffb18b':'#f4d18a');
 $('dial-sun').setAttribute('opacity',String(1-moonMix));$('dial-moon').setAttribute('opacity',String(moonMix));
 $('sky-ring-fill').setAttribute('stroke-dashoffset',String(100-fraction*100));
 $('journey-dial').setAttribute('aria-valuenow',String(progress));$('journey-dial').setAttribute('aria-valuetext',sky.name+' · 길의 '+progress+'%');
 const shownCoins=Math.max(0,Math.floor(m.coins-(s.pendingCoinAmount?.()||0)));
 $('coins').textContent=shownCoins.toLocaleString('ko-KR');
 $('coins').classList[s.coinArrivalActive?.()?'add':'remove']('coin-arrival');
 $('coin-fill').style.width=(shownCoins/MAX_COINS*100)+'%';$('coin-gauge').setAttribute('aria-valuenow',String(shownCoins));
 renderTeamSkills(m,s);
 renderMinimap(m);
 $('party-count').textContent='동료 '+m.summonCount+' / '+ALLY_TOTAL_LIMIT+(m.allies.some(a=>a.hp>0&&a.helper)?' · 조력 '+m.allies.filter(a=>a.hp>0&&a.helper).length:'');
 $('loadout-open').disabled=!ready||autoplay.active||['playing','paused'].includes(m.status);
 $('loadout-open').title=['playing','paused'].includes(m.status)?'이번 여정이 끝나면 편성을 바꿀 수 있어요.':'필살기 5개 중 3개 선택';
 $('upgrade').disabled=!(m.status==='playing'||m.status==='paused'&&infoPaused&&$('settings').open)||m.keeperRank>0||m.coins<UNITS.keeper.upgrade.price;
 if(lastKeeperRank!==m.keeperRank){lastKeeperRank=m.keeperRank;$('upgrade').innerHTML=m.keeperRank?'먹붓 수련 완료':'도령 수련 <small>◎ 45</small>';const keeperButton=$('action-keeper');if(keeperButton){keeperButton.querySelector('strong').textContent=m.keeperRank?'먹붓 도령':'도령';keeperButton.querySelector('img').src=s.previewTexture(m.keeperRank?'keeperBrush1':'keeper1');}}
 const region=m.status==='ready'?s.previewAreaIndex:m.stage;
 $('area-label').textContent=m.bossDefeated?(m.stage===STAGES.length-1?'집 앞':'열린 길'):STAGES[region].place;
 $('edition-area').textContent=AREAS[region].name;document.body.dataset.area=String(region);
 if(now>noticeUntil&&lastHint!==m.hintSerial){$('callout').textContent=m.hint;lastHint=m.hintSerial;}
 $('callout').hidden=m.status==='ready'||m.status==='won'||m.status==='lost'||(m.time-m.lastHintAt>7&&now>noticeUntil);
 for(const [name,baseSpec] of Object.entries({...UNITS,...SKILLS})){
  const spec=UNITS[name]?unitStats(name,m.keeperRank):baseSpec;
  const button=$('action-'+name),cd=m.cooldowns[name],full=!!UNITS[name]&&m.atSummonLimit(name);if(!button)continue;button.disabled=m.status!=='playing'||cd>0||m.coins<spec.cost||full||(['rush','stomp'].includes(name)&&!!m.action);
  button.dataset.state=m.status!=='playing'?'idle':full?'full':cd>0?'cooldown':m.coins<spec.cost?'cost':button.disabled?'full':'ready';
  button.querySelector('.cooldown').style.height=(cd/spec.cooldown*100)+'%';button.style.setProperty('--cooldown-turn',Math.max(0,Math.min(1,cd/spec.cooldown))+'turn');
  button.title=spec.name+(spec.role?' · '+spec.role:'')+' · '+(button.dataset.state==='full'?'동료가 가득해요':cd>0?cd.toFixed(1)+'초 뒤':button.dataset.state==='cost'?'엽전 '+Math.ceil(spec.cost-m.coins)+' 부족 · 필요 '+spec.cost:spec.cost+' 엽전');
  button.setAttribute('aria-label',button.title);if(UNITS[name])button.querySelector('.unit-count').textContent=m.countAllies(name)+'/'+ALLY_TYPE_LIMIT;
  let badge=button.querySelector('.countdown');
  if(cd>0&&!full){if(!badge){badge=document.createElement('span');badge.className='countdown';button.append(badge);}badge.textContent=Math.ceil(cd);}
  else badge?.remove();
 }
 const boss=m.enemies.find(e=>isBoss(e.type))||m.enemies.find(e=>e.type==='gate');$('boss-bar').hidden=!boss||m.status!=='playing';if(boss){$('boss-fill').style.width=(boss.hp/boss.maxHp*100)+'%';$('boss-label').textContent=boss.type==='gate'?'길을 막는 봉인 · '+(boss.hp/boss.maxHp>.67?'닫힌 길':boss.hp/boss.maxHp>.34?'벌어진 균열':'열리는 길'):ENEMIES[boss.type].name+' · '+(ENEMIES[boss.type].ability.name||{boss:'우박',warden:'내려찍기',ferryman:'밀려오는 파도'}[boss.type]);}
 $('pause').hidden=!['playing','paused'].includes(m.status);
 $('pause-overlay').hidden=autoplay.active||m.status!=='paused'||fullscreenPending||infoDialogs.some(d=>d.open);
 if(m.status!==lastStatus){
  lastStatus=m.status;
  if(['won','lost'].includes(m.status)&&!autoplay.active){
   updateBest();resultReadyAt=now+(m.status==='lost'?1800:350);$('result').hidden=true;
   if(m.status==='won'){const reward=campaign.clear(activeRun,m.earnedCoins,m.stage);saveCampaign();clearedStages=0;while(campaign.cleared.includes(clearedStages))clearedStages++;try{localStorage.setItem('saebyeokmun-cleared',String(clearedStages));}catch{}$('result-earned').textContent='구매용 엽전 +'+reward+' · 보유 '+campaign.balance+' (완주 보너스 50 포함)';}else $('result-earned').textContent='완주하면 모은 엽전이 구매용으로 쌓여요.';
   $('result-tag').textContent=m.status==='won'?(m.stage===STAGES.length-1?'부모님의 손을 다시 잡고':'집으로, 한 걸음 더'):'다시 길을 찾아서';
   $('result-title').textContent=m.status==='won'?(m.stage===STAGES.length-1?'집에 도착했다.':STAGES[m.stage].place+'의 길을 되찾았다.'):'오늘의 발걸음은 여기까지.';
   $('result-copy').textContent=m.status==='won'?STAGES[m.stage].clue:'동료를 모으고 귀물의 예고를 살펴보세요. 열어 둔 길은 지도에 남아 있어요.';
   $('result-stats').replaceChildren();
   for(const [label,value] of [['걸어온 길',progress+'%'],['모은 엽전',Math.floor(m.earnedCoins).toLocaleString('ko-KR')],['함께한 시간',Math.floor(m.time/60)+':'+String(Math.floor(m.time%60)).padStart(2,'0')]]){
    const span=document.createElement('span');span.textContent=label;const b=document.createElement('b');b.textContent=value;span.append(b);$('result-stats').append(span);
   }
  }
 }
 if(['won','lost'].includes(m.status))$('result').hidden=autoplay.active||now<resultReadyAt;
}
function updateDownload(p){
 const mb=n=>(n/1048576).toFixed(1);
 $('download-progress').value=p.percent;$('download-percent').textContent=p.percent+'%';
 $('download-bytes').textContent=`${mb(p.loaded)} / ${mb(p.total)} MB · 남은 용량 ${mb(Math.max(0,p.total-p.loaded))} MB`;
 $('download-state').textContent=p.phase==='prepare'?'다운로드 완료 · 그림과 동작을 준비하고 있어요.':'이 길에 필요한 그림을 받고 있어요.';
}
async function prepareFor(title,work,retry){
 if(preparing)return false;preparing=true;const epoch=++entryEpoch;retryAssets=retry;
 $('download-title').textContent=title;$('download-retry').hidden=true;$('download-state').textContent='필요한 그림을 확인하고 있어요.';
 updateDownload({loaded:0,total:0,percent:0});
 $('asset-loading').showModal();
 try{await work(p=>{if(epoch===entryEpoch)updateDownload(p);});if(epoch!==entryEpoch)return false;$('asset-loading').close();document.querySelectorAll('[data-icon]').forEach(img=>{const src=scene.previewTexture(img.dataset.icon);if(src)img.src=src;});return true;}
 catch(error){if(epoch===entryEpoch){$('download-state').textContent=error.message;$('download-retry').hidden=false;}return false;}
 finally{preparing=false;}
}
function prefetchNext(stage){
 const next=stage+1,badge=$('next-map-loading');if(!STAGES[next]){badge.hidden=true;return;}
 badge.hidden=false;badge.textContent=`${next+1}장 미리 준비 중`;
 scene.prefetchStage(next,p=>{if(model.stage!==stage)return;badge.textContent=p.percent===100?`${next+1}장 다운로드 완료`:`${next+1}장 미리 받는 중 · ${p.percent}%`;}).catch(()=>{if(model.stage===stage)badge.textContent=`${next+1}장은 이동할 때 다시 받습니다`;});
}
$('download-retry').addEventListener('click',()=>{if(!preparing)retryAssets?.();});
$('download-back').addEventListener('click',showMap);
$('asset-loading').addEventListener('cancel',e=>{e.preventDefault();showMap();});
document.querySelector('.phone-screen').append($('asset-loading'));
renderMap();renderSummonSlots();
makeGame(model,onReady,onFrame,onEvents);
if(openingEnabled&&!requestedAutoplay)showOpening();
