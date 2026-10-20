import {Campaign} from './game/campaign.js?v=218-integrated';
import {mountCollection} from './game/collection.js?v=218-integrated';
import {Journey} from './game/model.js?v=218-integrated';
import {Autoplay} from './game/autoplay.js?v=218-integrated';
import {makeGame} from './game/scene.js?v=218-integrated';
import {Soundscape,MUSIC_TRACK} from './game/audio.js?v=218-integrated';
import {ROAD,MAX_HP,MAX_COINS,UNITS,UNIT_TIERS,SKILLS,TEAM_SKILLS,CODEX,COMPANIONS,MOTION,motionFrame,AREAS,STAGES,skyState,ENEMY_STRIKE,enemyAttackFrame,bossPose,unitStats,DEFAULT_LOADOUT,validLoadout,REAPER_DEPARTURE_TIME,reaperDepartureFrame,enemyDepartureFrame,isBoss,ENEMIES,healerPose,TEST_MODE,DEFAULT_PARTY,STAGE_REWARDS,validParty,GATE,ALLY_TYPE_LIMIT,ALLY_TOTAL_LIMIT} from './game/data.js?v=218-integrated';
const $=id=>document.getElementById(id);
const collection=mountCollection(document,{stateFor:id=>campaign.cardState(id),claim:claimCollectionCard});
const model=new Journey();
const autoplay=new Autoplay(model);
const requestedAutoplay=/(?:^|[?&])autoplay=1(?:&|$)/.test(window.location?.search||'');
const stageLink=/(?:^|[?&])stage=(\d+)(?:&|$)/.exec(window.location?.search||'');
const requestedStage=stageLink?Number(stageLink[1])-1:null;
let lastAutoplayFrame=0,preparing=false,entryEpoch=0,retryAssets=null;
let installPrompt=null,fullscreenPending=false;
let scene,ready=false,lastStatus='',lastHint=0,noticeUntil=0,lastFrame=0,infoPaused=false,coinAnimation,lastKeeperRank=-1,resultReadyAt=Infinity;
const keys=new Set();
const infoDialogs=[$('settings'),$('codex'),$('app-help'),$('loadout'),$('journey-map'),$('roster'),$('opening')];
// Keep dialogs in the fullscreen subtree and one pause owner for nested panels.
const phoneScreen=document.querySelector('.phone-screen');
for(const dialog of infoDialogs)phoneScreen.append(dialog);
// Native modal dialogs live in the top layer: inheriting a parent does not
// constrain their fixed-position viewport. One geometry owner fits every panel.
function fitPhoneDialogs(){
 const bounds=phoneScreen.getBoundingClientRect();
 for(const dialog of [...infoDialogs,$('asset-loading')])for(const [key,value]of Object.entries({left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height}))dialog.style.setProperty('--phone-'+key,value+'px');
}
const phoneObserver=new ResizeObserver(fitPhoneDialogs);phoneObserver.observe(phoneScreen);
window.addEventListener('resize',fitPhoneDialogs);window.addEventListener('scroll',fitPhoneDialogs,{passive:true});document.addEventListener('fullscreenchange',fitPhoneDialogs);
fitPhoneDialogs();
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
clearedStages=0;while(campaign.cleared.includes(clearedStages))clearedStages++;
let activeRun=0,draftParty=[],rosterFocus=campaign.party[0],rosterMotion=null;
function saveCampaign(){try{localStorage.setItem('saebyeokmun-campaign',JSON.stringify(campaign.snapshot()));return true;}catch{showNotice('이 브라우저에서 저장할 수 없어요. 현재 화면에서만 유지됩니다.');return false;}}
function claimCollectionCard(id){const before=campaign.snapshot().cards;if(!campaign.claimCard(id))return false;if(saveCampaign())return true;campaign.cards=before;return false;}
let selectedStage=STAGES.findIndex((_,i)=>!campaign.cleared.includes(i));if(selectedStage<0)selectedStage=0;
// View-only country browsing never writes Campaign or unlocks a stage.
const STAGES_PER_COUNTRY=15,PREVIEW_STAGE_COUNT=5;
// Explicit playtest access; completion/reward ownership remains in Campaign.
function canEnterStage(index){return Number.isInteger(index)&&!!STAGES[index]&&(TEST_MODE||index<PREVIEW_STAGE_COUNT||campaign.cleared.includes(index)||index<=clearedStages);}
const countryNames=['첫 번째 나라','두 번째 나라','세 번째 나라','네 번째 나라','다섯 번째 나라'];
let mapPage=Math.floor(selectedStage/STAGES_PER_COUNTRY);
document.body.dataset.screen='map';
const actNames=['01–10','11–20','21–30','31–40'];
$('map-acts').innerHTML=actNames.map((name,i)=>`<button data-act="${i}" aria-pressed="false"><small>${i*10+1}–${i*10+10}장</small>${name}</button>`).join('');
$('map-acts').addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)selectStage(Number(b.dataset.act)*10);});
// Presentation coordinates only. STAGES and Campaign retain progression ownership.
// Two readable routes fit the phone height; extra width scrolls horizontally.
const atlasPoints=STAGES.map((_,i)=>{const n=i%STAGES_PER_COUNTRY;return n<8?[7+n*12,31+[0,-2,2,0,2,-1,2,0][n]]:[91-(n-8)*14,76+[0,-2,2,0,-1,2,0][n-8]];});
$('map-catalog').innerHTML=STAGES.map((stage,i)=>`<button id="stage-${i}" class="map-node" style="left:${atlasPoints[i][0]}%;top:${atlasPoints[i][1]}%" data-gate="${i%10===9}" aria-label="스테이지 ${i+1}" aria-pressed="false"><span class="stage-art${i<PREVIEW_STAGE_COUNT?' stage-art--village':''}" aria-hidden="true" style="background-position:${i<PREVIEW_STAGE_COUNT?i*25:i%10/9*100}% ${i<PREVIEW_STAGE_COUNT?50:[8.4,41.2,73.9,103.4][Math.floor(i/10)]}%"></span><em class="stage-state" aria-hidden="true"></em></button>`).join('');
$('map-route-line').setAttribute('points',atlasPoints.slice(0,STAGES_PER_COUNTRY).map(p=>p.join(',')).join(' '));
$('map-pins').innerHTML=STAGES.map((s,i)=>`<button id="pin-${i}" class="map-pin" aria-label="스테이지 ${i+1}" aria-pressed="false"><span>${String(i+1).padStart(2,'0')}</span><i aria-hidden="true"></i></button>`).join('');
function renderMap(){
 const act=STAGES[selectedStage].act,first=mapPage*STAGES_PER_COUNTRY;
 const populated=first<STAGES.length,selectedHere=Math.floor(selectedStage/STAGES_PER_COUNTRY)===mapPage;
 $('journey-map').dataset.country=String(mapPage);
 $('country-title').textContent=countryNames[mapPage];
 $('country-page').textContent=(mapPage+1)+' / '+countryNames.length;
 $('country-empty').hidden=populated;$('map-route').setAttribute('data-empty',String(!populated));
 $('map-route-line').setAttribute('points',populated?atlasPoints.slice(first,first+STAGES_PER_COUNTRY).map(p=>p.join(',')).join(' '):'');
 startButton.disabled=!ready||!selectedHere||!populated;
 $('start-label').textContent=!populated?'준비 중':!selectedHere?'이전 나라를 먼저 완료하세요':campaign.cleared.includes(selectedStage)?'재도전':'게임 시작';
 $('map-acts').querySelectorAll('[data-act]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.act)===act)));
 for(let i=0;i<STAGES.length;i++){
  const node=$('stage-'+i),cleared=campaign.cleared.includes(i),locked=!canEnterStage(i);
  node.disabled=locked;node.dataset.state=cleared?'cleared':locked?'locked':'open';node.setAttribute('aria-pressed',String(i===selectedStage));
  node.querySelector('.stage-state').textContent=cleared?'✓':locked&&i>=PREVIEW_STAGE_COUNT?'?':'';
  const pin=$('pin-'+i);pin.disabled=locked;pin.dataset.state=cleared?'cleared':locked?'locked':'open';pin.setAttribute('aria-pressed',String(i===selectedStage));
  node.hidden=i<first||i>=first+STAGES_PER_COUNTRY;pin.hidden=node.hidden;
 }
 const stage=STAGES[selectedStage];$('home-chapter').textContent='';$('map-chapter').textContent=String(selectedStage+1).padStart(2,'0');$('map-place').textContent='';
 $('map-name').textContent=stage.place;$('atlas-stage-name').textContent=!populated?'준비 중':!selectedHere?'아직 닿지 않은 곳':String(selectedStage+1).padStart(2,'0')+' · '+stage.place;$('map-brief').textContent='';$('map-clears').textContent=campaign.cleared.length+' / '+STAGES.length;
 $('map-story-hint').textContent='';$('map-act-label').textContent=actNames[act];$('map-page-label').textContent=populated?(first+1)+'–'+Math.min(first+STAGES_PER_COUNTRY,STAGES.length):'준비 중';
 $('map-balance').textContent=String(campaign.balance);
 $('map-prev').disabled=mapPage===0;$('map-next').disabled=mapPage===countryNames.length-1;
 $('map-next-clue').textContent='';$('map-skills').textContent=loadout.map(k=>SKILLS[k].name).join(' · ');
 const reward=stage.reward;$('map-reward').hidden=!reward;
 if(reward){
  const img=$('map-reward-image'),portrait=scene?.previewTexture(reward+'1');img.hidden=!portrait;if(portrait)img.src=portrait;img.alt=UNITS[reward].name;$('map-reward-state').textContent=campaign.owned.includes(reward)?'✓':'+';
  if(scene&&!portrait)scene.ensurePreview(reward).then(()=>{if(STAGES[selectedStage].reward===reward){const src=scene.previewTexture(reward+'1');if(src){img.src=src;img.hidden=false;}}}).catch(()=>{img.hidden=true;});
 }
 $('home-collection').textContent=campaign.owned.length+' / '+Object.keys(UNITS).length;
 if(scene?.ready&&scene.previewAreaIndex===selectedStage)model.stage=selectedStage;
}
function selectStage(index){if(!canEnterStage(index)||model.status!=='ready')return;selectedStage=index;mapPage=Math.floor(index/STAGES_PER_COUNTRY);renderMap();}
function browseCountry(direction){
 if(model.status!=='ready'||preparing||fullscreenPending)return;
 mapPage=Math.max(0,Math.min(countryNames.length-1,mapPage+direction));
 const first=mapPage*STAGES_PER_COUNTRY;
 if(Math.floor(selectedStage/STAGES_PER_COUNTRY)!==mapPage){const available=STAGES.findIndex((_,i)=>i>=first&&i<first+STAGES_PER_COUNTRY&&canEnterStage(i));if(available>=0)selectedStage=available;}
 renderMap();
}
$('map-prev').addEventListener('click',()=>browseCountry(-1));
$('map-next').addEventListener('click',()=>browseCountry(1));
function setMapExpanded(expanded){$('map-atlas').hidden=!expanded;$('journey-map').dataset.expanded=String(expanded);$('map-expand').setAttribute('aria-expanded',String(expanded));$('map-expand').querySelector('span').textContent=expanded?'닫기':'전체 지도';if(expanded&&!$('stage-'+selectedStage).hidden)$('stage-'+selectedStage).focus?.();if(!expanded)$('map-expand').focus?.();}
for(const id of ['map-expand','map-fold'])$(id).addEventListener('click',()=>setMapExpanded(id==='map-expand'&&$('map-atlas').hidden));
for(const id of ['map-settings','home-settings'])$(id).addEventListener('click',()=>openInfo($('settings')));
$('home-codex').addEventListener('click',openCodex);
function showMap(){
 if(fullscreenPending)return;openingAutomatic=false;openingEpoch++;delete document.body.dataset.entryPhase;if(scene){scene.entryPreview=false;delete scene.entryViewStarted;scene.resize();}entryEpoch++;stopLoadingDisplay();$('asset-loading').close();if(!$('opening').open)releaseOpeningFilm();infoPaused=false;for(const dialog of infoDialogs)if(dialog.open)dialog.close();
 stopAutoplay();
 keys.clear();model.setDirection(0,{cancel:true});model.reset();lastStatus='';resultReadyAt=Infinity;selectedStage=STAGES.findIndex((_,i)=>!campaign.cleared.includes(i));if(selectedStage<0)selectedStage=0;mapPage=Math.floor(selectedStage/STAGES_PER_COUNTRY);
 $('intro').hidden=false;$('result').hidden=true;$('pause-overlay').hidden=true;$('hud').hidden=true;$('callout').hidden=true;document.body.dataset.screen='map';
 scene?.resetPresentation();soundscape.stopVoices(true);soundscape.setPlaying(false);renderMap();setMapExpanded(true);openInfo($('journey-map'));
}
$('enter-map').addEventListener('click',()=>{if(ready){setMapExpanded(true);openInfo($('journey-map'));}});
$('journey-map').querySelector('.dialog-close').addEventListener('click',()=>$('journey-map').close());
for(let i=0;i<STAGES.length;i++)for(const prefix of ['stage-','pin-'])$(prefix+i).addEventListener('click',()=>selectStage(i));
for(const id of ['result-map','pause-map','settings-map'])$(id).addEventListener('click',showMap);

try{const saved=JSON.parse(localStorage.getItem('saebyeokmun-loadout'));if(validLoadout(saved))loadout=saved;}catch{}
try{best=Number(localStorage.getItem('saebyeokmun-best')||0)||0;}catch{}
$('best').textContent=best?best+'%':'아직 걷지 않은 길';
const soundscape=new Soundscape({fetcher:async url=>{await scene.downloads.request({url});const blob=scene.downloads.take(url);return {ok:!!blob,arrayBuffer:()=>blob.arrayBuffer()};},onState:state=>{
 $('settings-open').dataset.audioState=state;
 $('opening-narrate').hidden=state!=='locked'||!$('opening').open||!soundscape.musicEnabled;
 $('audio-status').textContent=state==='locked'?'설정에서 효과음을 켜 주세요.':state==='loading'?'밤길의 소리를 준비하고 있어요.':state==='partial'?'일부 소리를 불러오지 못했어요. 새로고침하면 다시 준비합니다.':'소의 뿔 · 돌팔매 · 먹붓 · 씨앗탄 · 선비의 봉인 · 승천';
}});
function unlockSound(){return soundscape.unlock().catch(()=>{showNotice('소리를 시작하지 못했어요. 설정에서 소리를 다시 켜 주세요.');});}
soundscape.setChannelEnabled('effects',false);
try{const saved=JSON.parse(localStorage.getItem('saebyeokmun-audio'));for(const channel of ['music','effects'])if(typeof saved?.[channel]==='boolean'&&saved.musicTrack===MUSIC_TRACK)soundscape.setChannelEnabled(channel,saved[channel]);if(typeof saved?.volume==='number'&&Number.isFinite(saved.volume))soundscape.setVolume(saved.volume);}catch{}
function updateSound(){for(const channel of ['music','effects']){const on=soundscape[channel+'Enabled'],b=$(channel+'-toggle');b.setAttribute('aria-pressed',String(on));b.querySelector('.switch-state').textContent=on?'켬':'끔';const hud=$('hud-'+channel);hud.setAttribute('aria-pressed',String(on));hud.setAttribute('aria-label',(channel==='music'?'음악':'효과음')+(on?' 끄기':' 켜기'));hud.title=(channel==='music'?'음악':'효과음')+' '+(on?'켬':'끔');}$('sound-volume').value=Math.round(soundscape.volume*100);$('volume-value').textContent=Math.round(soundscape.volume*100)+'%';}
function saveSound(){try{localStorage.setItem('saebyeokmun-audio',JSON.stringify({music:soundscape.musicEnabled,effects:soundscape.effectsEnabled,volume:soundscape.volume,musicTrack:MUSIC_TRACK}));}catch{}}
// Current-track preferences persist; old review settings migrate only once.
saveSound();updateSound();
// Opening preferences are separate from campaign rewards; the existing modal owns pause/resume.
let openingEnabled=true;try{openingEnabled=localStorage.getItem('saebyeokmun-opening')!=='false';}catch{}
let openingEpoch=0,openingAutomatic=false,openingPreparing=false;
let loadingDisplay={active:false,value:0,target:0,last:0,frame:0};
function updateOpening(){const b=$('opening-toggle');b.setAttribute('aria-pressed',String(openingEnabled));b.querySelector('.switch-state').textContent=openingEnabled?'켬':'끔';}
function stopNarration(){$('opening-voice').pause();$('opening-video').pause();}
function coverOpening(){
 if($('asset-loading').open&&openingPreparing)return;
 openingAutomatic=true;openingPreparing=true;
 $('opening').dataset.phase='preparing';document.body.dataset.entryPhase='loading';
 $('download-title').textContent='로딩 중';$('download-retry').hidden=true;updateDownload({phase:'waiting'});fitPhoneDialogs();$('asset-loading').showModal();
}
function openingFile(stage){return stage===1?'./assets/entry-stage2-v160.mp4':'./assets/entry-stage1-v146.mp4';}
async function prepareOpeningFilm(stage){
 const epoch=entryEpoch,video=$('opening-video'),file=openingFile(stage);
 if(video.dataset.nextFile!==file){
  await scene.downloads.request({url:file});const blob=scene.downloads.take(file);if(epoch!==entryEpoch)return;
  if(video.dataset.nextSrc)URL.revokeObjectURL(video.dataset.nextSrc);
  video.dataset.nextSrc=URL.createObjectURL(blob);video.dataset.nextFile=file;video.src=video.dataset.nextSrc;
 }
 // Prime the same muted decoder behind the loading dialog, before displaying it.
 await video.play();if(epoch!==entryEpoch)return;video.pause();video.currentTime=0;
}
function playOpening(stage,automatic=false){
 openingAutomatic=automatic;openingPreparing=false;$('opening').dataset.stage=String(stage);
 const video=$('opening-video');
 // This film already contains the generated title and the camera move into the
 // native field. Play it once, from zero, only after that field is prepared.
 const token=++openingEpoch;video.dataset.clip='transition';const src=video.dataset.nextFile===openingFile(stage)?video.dataset.nextSrc:openingFile(stage);if(video.src!==src)video.src=src;video.currentTime=0;
 $('opening-narrate').hidden=!soundscape.musicEnabled||soundscape.context?.state==='running';
 // Decode behind the existing cover, then start the title and the one music
 // loop together. A browser gesture resumes this same pending preparation.
 unlockSound().then(()=>{if(token!==openingEpoch||!$('opening').open)return;return video.play().then(()=>{if(token===openingEpoch&&$('opening').open&&['preparing','loading'].includes($('opening').dataset.phase)){$('opening').dataset.phase='playing';$('opening-narrate').hidden=true;soundscape.setPlaying(!document.hidden);}});}).catch(()=>{if(token===openingEpoch)finishOpeningFilm();});
}
function showOpening(){
 if(fullscreenPending||preparing)return;
 $('opening').dataset.phase='loading';openInfo($('opening'));for(const d of infoDialogs)if(d!==$('opening')&&d.open)d.close();
 playOpening(model.stage,false);
}
function finishOpeningFilm(){
 if(!$('opening').open)return;
 if(openingPreparing)return;
 if(openingAutomatic){scene.entryViewStarted=performance.now();document.body.dataset.entryPhase='ui';}
 $('opening').close();
}
function finishOpeningUI(){
 if(document.body.dataset.entryPhase!=='ui')return;
 delete document.body.dataset.entryPhase;scene.entryPreview=false;delete scene.entryViewStarted;scene.resize();openingAutomatic=false;
 completeInfo();
}
updateOpening();
$('opening-toggle').addEventListener('click',()=>{openingEnabled=!openingEnabled;try{localStorage.setItem('saebyeokmun-opening',String(openingEnabled));}catch{}updateOpening();if(openingEnabled)showOpening();});
$('opening-replay').addEventListener('click',showOpening);
$('opening-video').addEventListener('ended',finishOpeningFilm);
$('opening-video').addEventListener('error',finishOpeningFilm);
$('opening-skip').addEventListener('click',finishOpeningFilm);
$('opening-narrate').addEventListener('click',unlockSound);
document.querySelector('.control-deck').addEventListener('animationend',e=>{if(e.target===document.querySelector('.control-deck')&&e.animationName==='entry-hud')finishOpeningUI();});
$('opening').addEventListener('cancel',e=>{if(openingAutomatic)e.preventDefault();});
function releaseOpeningFilm(){
 openingEpoch++;stopNarration();const video=$('opening-video');
 // Closing releases movie buffers; backgrounding only pauses the current film.
 video.removeAttribute('src');video.load();
 if(video.dataset.nextSrc)URL.revokeObjectURL(video.dataset.nextSrc);
 delete video.dataset.nextSrc;delete video.dataset.nextFile;delete video.dataset.clip;
}
$('opening').addEventListener('close',releaseOpeningFilm);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!openingPreparing&&$('opening').open&&['playing','preparing'].includes($('opening').dataset.phase))$('opening-video').play().catch(finishOpeningFilm);});
function updateBest(){const n=Math.floor(model.progress()*100);best=Math.max(best,n);$('best').textContent=best+'%';try{localStorage.setItem('saebyeokmun-best',String(best));}catch{}}
async function start(testStage=null,cinematic=false){
 const testing=Number.isInteger(testStage)&&autoplay.active;
 if(!ready||preparing||fullscreenPending||(!testing&&Math.floor(selectedStage/STAGES_PER_COUNTRY)!==mapPage)||(!testing&&!canEnterStage(selectedStage)))return;
 if(testing)selectedStage=testStage;else stopAutoplay();
 const stage=selectedStage;
 if(cinematic)coverOpening();
 if(!await prepareFor(cinematic?'로딩 중':'불러오는 중',async p=>{
  const party=testing?Object.keys(UNITS):campaign.party,keys=scene.videoFiles([...scene.commonKeys,...scene.stageFiles(stage,testing,party)],false,stage),files=keys.filter(k=>!scene.loadedFiles.has(k)).map(k=>scene.files.get(k));
  const started=performance.now();let transfer=null,audioPrepared=0,audioTotal=soundscape.assetFiles().length,fieldReady=false,filmReady=!cinematic;
  let fieldPhase='download',fieldRemaining=files.filter(f=>!f.video).length*60+2150;
  files.push(...soundscape.assetFiles());if(cinematic&&$('opening-video').dataset.nextFile!==openingFile(stage))files.push({url:openingFile(stage)});
  const report=()=>{
   const elapsed=Math.max(1,performance.now()-started),rate=transfer?.loaded?transfer.loaded/elapsed:2*1048576/1000;
   const network=transfer?.total?Math.max(0,transfer.total-transfer.loaded)/rate:files.reduce((n,f)=>n+(scene.downloads.sizes?.[f.url.split('?')[0]]||0),0)/rate;
   const audio=audioPrepared<audioTotal?Math.max(250,(audioTotal-audioPrepared)*12):0;
   p({...transfer,phase:'entry',remainingMs:Math.max(network+(fieldReady?0:fieldRemaining),network+audio,filmReady?0:network+250),state:fieldReady?(audio?'소리 준비 중':'시작 화면 준비 중'):fieldPhase==='warm'?'첫 동작 준비 중':fieldPhase==='world'?'화면 준비 중':fieldPhase==='prepare'?'그림 준비 중':'그림과 소리 불러오는 중'});
  };
  const transferTask=scene.downloads.batch(files,progress=>{transfer=progress;report();});
  const fieldTask=scene.prepareStage(stage,progress=>{
   if(['prepare','world','warm'].includes(progress.phase)){fieldPhase=progress.phase;fieldRemaining=(progress.remainingMs??Math.max(0,progress.prepareTotal-progress.prepared)*60)+(fieldPhase==='prepare'?2150:fieldPhase==='world'?1800:0);}report();
  },testing,party).then(()=>{fieldReady=true;report();});
  const audioTask=soundscape.prepare(progress=>{audioPrepared=progress.prepared;audioTotal=progress.prepareTotal;report();}).then(()=>{if(soundscape.missing.length)throw new Error('소리 준비가 끝나지 않았어요. 다시 시도해 주세요.');audioPrepared=audioTotal;report();});
  const filmTask=cinematic?prepareOpeningFilm(stage).then(()=>{filmReady=true;report();}):Promise.resolve();
  const results=await Promise.allSettled([transferTask,fieldTask,audioTask,filmTask]);
  // A failed film must not unlock a retry while the existing scene is still preparing.
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 },()=>start(testing?stage:null,cinematic),cinematic))return;
 infoPaused=false;for(const dialog of infoDialogs)if(dialog.open&&(!cinematic||dialog!==$('opening')))dialog.close();
 if(cinematic)openInfo($('opening'));
 if(!testing){activeRun=campaign.begin();saveCampaign();}
 model.start(selectedStage,testing?DEFAULT_PARTY:campaign.party,scene?.vw,{tour:testing&&requestedStage===null});
 if(testing){autoplay.enter();scene.playbackRate=autoplay.rate;}
 renderSummonSlots();renderSkillSlots();renderAutoplay();keys.clear();model.setDirection(0,{cancel:true});lastStatus='';resultReadyAt=Infinity;document.body.dataset.screen='game';$('intro').hidden=true;$('result').hidden=true;$('pause-overlay').hidden=true;$('hud').hidden=false;$('callout').hidden=false;
 if(scene)scene.resetPresentation();updateAuto();soundscape.stopVoices(true);
 if(cinematic){document.body.style.setProperty('--entry-zoom-ms',(AREAS[stage].entryView?.duration??700)+'ms');scene.entryPreview=true;scene.entryBlend=0;delete scene.entryViewStarted;scene.resize();model.drainEvents();model.pause();infoPaused=!document.hidden;soundscape.setPlaying(false);playOpening(stage,true);}
 else{scene.entryPreview=false;delete scene.entryViewStarted;scene.resize();delete document.body.dataset.entryPhase;soundscape.setPlaying(true);unlockSound().then(()=>{if(model.status==='playing')soundscape.play('summon');});}
 // A focused stage link stays scoped to that stage. Background next-map
 // downloads also compete with combat decoding, so entry does not start them.
}
function pause(){if(!ready||fullscreenPending)return;if(autoplay.active){if(autoplay.complete)return;autoplay.paused=model.status==='paused'?false:!autoplay.paused;}model.pause();keys.clear();model.setDirection(0,{cancel:true});renderAutoplay();soundscape.setPlaying(model.status==='playing');if(model.status==='playing')unlockSound();}
function stopAutoplay(){autoplay.stop();if(scene)scene.playbackRate=1;renderAutoplay();renderSkillSlots();}
function beginAutoplay(){if(!ready||preparing||fullscreenPending)return;lastAutoplayFrame=performance.now();const first=autoplay.begin();start(requestedStage??first);}
function renderAutoplay(){
 const a=autoplay,m=model;document.body.dataset.autoplay=String(a.active);$('autoplay-panel').hidden=!a.active;
 for(const id of ['move-left','move-right','auto'])$(id).disabled=a.active;
 for(const id of ['autoplay-start','autoplay-home'])$(id).disabled=!ready;
 if(!a.active)return;
 $('autoplay-title').textContent=a.complete?'전체 맵 테스트 완료':`${m.stage+1} / ${STAGES.length} · ${STAGES[m.stage].name}`;
 const paused=a.paused||m.status==='paused',seconds=Math.floor(a.elapsed);
 $('autoplay-state').textContent=(a.complete?`${a.clears.length}개 맵 완주`:paused?'일시정지 · 주인공 무적':m.status==='won'?'길을 열었어요 · 다음 맵 준비':(requestedStage===null?'짧은 코스 · 주인공 무적':'전체 길 · 주인공 무적'))+` · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 $('autoplay-pause').textContent=paused?'계속':'일시정지';$('autoplay-pause').disabled=a.complete;
 $('autoplay-stop').textContent=a.complete?'돌아가기':'중지';if(document.activeElement!==$('autoplay-speed'))$('autoplay-speed').value=String(a.rate);
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
function setDirection(pressed,cancel=false){model.setDirection(keys.has('right')?1:keys.has('left')?-1:0,{pressed:Boolean(pressed),cancel});}
function setupHold(button,direction){
 const release=(e,cancel=false)=>{keys.delete(direction);button.classList.remove('held');setDirection(undefined,cancel);if(e&&button.hasPointerCapture?.(e.pointerId))button.releasePointerCapture(e.pointerId);};
 button.addEventListener('pointerdown',e=>{e.preventDefault();if(model.status!=='playing'||autoplay.active)return;button.setPointerCapture(e.pointerId);keys.add(direction);button.classList.add('held');setDirection(direction);});
 button.addEventListener('pointerup',release);button.addEventListener('pointercancel',e=>release(e,true));button.addEventListener('lostpointercapture',e=>{if(keys.has(direction))release(e,true);});
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
 if(fullscreenPending||document.body.dataset.entryPhase||$('asset-loading').open||infoDialogs.some(d=>d.open))return;
 const k=e.key.toLowerCase();
 if(autoplay.active&&k!==' ')return;
 if(['arrowleft','arrowright',' ','a','d','q','e','r','1','2','3','4','5'].includes(k))e.preventDefault();
 if(k===' '){if(!e.repeat)pause();return;}
 if(k==='enter'&&model.status==='ready'&&ready)openInfo($('journey-map'));
 if(k==='arrowleft'||k==='a'){keys.add('left');setDirection('left');}
 if(k==='arrowright'||k==='d'){keys.add('right');setDirection('right');}
 if(!e.repeat&&{'1':model.summonTypes[0],'2':model.summonTypes[1],'3':model.summonTypes[2],'4':model.summonTypes[3],'5':model.summonTypes[4],q:loadout[0],e:loadout[1],r:loadout[2]}[k])callAction({'1':model.summonTypes[0],'2':model.summonTypes[1],'3':model.summonTypes[2],'4':model.summonTypes[3],'5':model.summonTypes[4],q:loadout[0],e:loadout[1],r:loadout[2]}[k]);
});
document.addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(k==='arrowleft'||k==='a')keys.delete('left');if(k==='arrowright'||k==='d')keys.delete('right');setDirection();});
function blurPause(){keys.clear();model.setDirection(0,{cancel:true});infoPaused=false;if(autoplay.active&&!autoplay.complete)autoplay.paused=true;if(model.status==='playing')model.pause();renderAutoplay();soundscape.setPlaying(false);soundscape.stopVoices();stopNarration();}
window.addEventListener('blur',blurPause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)blurPause();});
window.matchMedia('(max-width:600px) and (orientation:portrait)').addEventListener('change',e=>{if(e.matches)blurPause();});
for(const channel of ['music','effects'])for(const id of [channel+'-toggle','hud-'+channel])$(id).addEventListener('click',()=>{soundscape.setChannelEnabled(channel,!soundscape[channel+'Enabled']);updateSound();saveSound();if(soundscape[channel+'Enabled'])unlockSound().then(()=>{if(channel==='effects')soundscape.play('guard',{allowIdle:true});});});
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
document.addEventListener('pointerdown',()=>{if((model.status==='playing'||$('opening').open)&&soundscape.enabled&&soundscape.context?.state!=='running')unlockSound();},{passive:true});
function showNotice(message){$('callout').textContent=message;$('callout').hidden=false;noticeUntil=performance.now()+2400;}
function loadDialogImages(dialog){dialog.querySelectorAll('img[data-src]').forEach(img=>{img.src=img.dataset.src;delete img.dataset.src;});}
function openInfo(dialog){loadDialogImages(dialog);if(!fullscreenPending&&!infoDialogs.some(d=>d.open)){infoPaused=model.status==='playing';if(infoPaused)model.pause();}keys.clear();model.setDirection(0,{cancel:true});soundscape.setPlaying(false);fitPhoneDialogs();dialog.showModal();}
function completeInfo(){if(fullscreenPending||document.body.dataset.entryPhase||infoDialogs.some(d=>d.open))return;soundscape.stopVoices(false,'effects');if(infoPaused&&model.status==='paused')model.pause();soundscape.setPlaying(model.status==='playing');infoPaused=false;}
$('settings-open').addEventListener('click',()=>openInfo($('settings')));
$('settings-return').addEventListener('click',()=>$('settings').close());
$('settings').querySelector('.dialog-close').addEventListener('click',()=>$('settings').close());
// Static collection cards join the same modal; pause, native previews and storage keep their owners.
const codexTabs=['collection','companions','enemies','sources'];let codexTab='collection';
function selectCodexTab(kind){
 codexTab=kind;
 $('codex').dataset.panel=kind;$('codex-library').open=false;$('codex-title').textContent=kind==='collection'?'인연첩':'도감';
 for(const key of codexTabs){
  $('codex-'+key).hidden=key!==kind;$('codex-tab-'+key).setAttribute('aria-selected',String(key===kind));
 }
 $('codex').querySelector('.codex-body').scrollTop=0;
 if(kind==='collection')collection.open();
}
for(const kind of codexTabs)$('codex-tab-'+kind).addEventListener('click',()=>selectCodexTab(kind));
async function openCodex(){if(!ready||preparing)return;if(!scene.commonReady&&!await prepareFor('동료와 귀물 도감',p=>scene.ensureCommon(p),openCodex))return;openInfo($('codex'));selectCodexTab(codexTab);}
$('codex-open').addEventListener('click',openCodex);$('result-codex').addEventListener('click',openCodex);$('sources-open').addEventListener('click',openCodex);
$('codex').querySelector('.dialog-close').addEventListener('click',()=>$('codex').close());
$('codex-return').addEventListener('click',()=>$('codex').close());
$('codex').addEventListener('close',()=>{for(const p of motionPreviews){p.variants.clear();p.frame=-1;p.img.removeAttribute('src');}if(scene?.commonReady)scene.retainFiles([...scene.stageKeys]);});
$('codex').addEventListener('click',e=>{if(e.target===$('codex')){const r=$('codex').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('codex').close();}});
for(const dialog of infoDialogs)dialog.addEventListener('close',completeInfo);
for(const id of ['roster','loadout','codex'])$(id).addEventListener('dragstart',e=>e.preventDefault());
function renderSkillSlots(){
 $('team-skills').innerHTML=Object.entries(TEAM_SKILLS).map(([key,s])=>`<button class="action team-action" id="action-${key}" data-action="${key}" hidden><span class="action-art"><img data-icon="${s.icon}" alt="" draggable="false"></span><strong>${s.name}</strong><small>5인 합동</small><span class="cooldown"></span></button>`).join('');
 $('skill-slots').innerHTML=(autoplay.active?['charm','stomp','shelter']:loadout).map((key,i)=>{const s=SKILLS[key];return `<button class="action" id="action-${key}" data-action="${key}" data-tier="${s.tier}"><span class="action-role magic">${s.role}</span><kbd>${['Q','E','R'][i]}</kbd><span class="action-art"><img data-icon="${s.icon}" alt="" draggable="false"></span><strong>${key==='rush'?'해태 돌진':key==='stomp'?'발구름':s.name}</strong><small>◎ ${s.cost}</small><span class="cooldown"></span></button>`;}).join('');
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
function hydrateIcons(root=document){
 if(!scene)return;
 for(const img of root.querySelectorAll('[data-icon]')){
  const key=img.dataset.icon,src=scene.previewTexture(key,img.dataset.previewAlign);if(src){img.src=src;img.hidden=false;continue;}img.hidden=true;
  const kind=img.dataset.previewKind||key.replace(/\d+$/,'');if(!scene.commonReady)continue;
  scene.ensurePreview(kind).then(()=>{if(img.isConnected===false||img.dataset.icon!==key)return;const ready=scene.previewTexture(key,img.dataset.previewAlign);if(ready){img.src=ready;img.hidden=false;}}).catch(()=>{});
 }
}
function renderSummonSlots(){
 $('summon-slots').innerHTML=(autoplay.active?Object.keys(UNITS):campaign.party).map((key,i)=>{const s=UNITS[key],icon=key==='keeper'&&model.keeperRank?'keeperBrush1':key+'1';return `<button class="action" id="action-${key}" data-action="${key}" data-tier="${s.tier}" data-card="${s.cardArt?"painted":"native"}"><kbd>${i<5?i+1:'↔'}</kbd><span class="unit-tier">${UNIT_TIERS[s.tier].level?['Ⅰ','Ⅱ','Ⅲ','Ⅳ'][UNIT_TIERS[s.tier].level-1]+' ':''}${UNIT_TIERS[s.tier].label}</span><span class="unit-count">0/${ALLY_TYPE_LIMIT}</span><span class="action-art"><img ${s.cardArt?'src="./assets/'+s.cardArt+'"':'data-icon="'+icon+'" src="'+(scene?.previewTexture(icon)||'')+'"'} alt="" draggable="false"></span><strong>${s.name}</strong><small class="summon-cost"><span>◎ ${s.cost}</span></small><span class="cooldown"></span></button>`;}).join('');
 lastKeeperRank=-1;hydrateIcons($('summon-slots'));
}
function rosterStars(count){
 const star='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 15 8.4 22 9.4 17 14.5 18.2 21.8 12 18.3 5.8 21.8 7 14.5 2 9.4 9 8.4Z" fill="#ffbc25" stroke="#613b11" stroke-width="1.6" stroke-linejoin="round"/><path d="m12 4-2.4 5.8-5.2.7 7.6 2Z" fill="#ffe68a"/></svg>';
 return '<span class="roster-stars" aria-label="별 '+count+'개">'+star.repeat(count)+'</span>';
}
function renderRoster(status='닫으면 저장'){
 const rosterKinds=['cow',...STAGE_REWARDS];
 $('roster-balance').textContent='◎ '+campaign.balance.toLocaleString('ko-KR');
 $('roster-count').textContent=draftParty.length+' / 5';
 $('roster-status').textContent=status;
 $('roster-slots').innerHTML=Array.from({length:5},(_,i)=>`<button data-party-remove="${i}" data-tier="${UNITS[draftParty[i]]?.tier||'beast'}" data-rarity="${UNITS[draftParty[i]]?.rosterCard.rarity||'일반'}" ${draftParty[i]?'':'disabled'} aria-label="${i+1}번 ${UNITS[draftParty[i]]?.name||'빈 자리'} 보기${draftParty.length>1?'·편성 해제':''}"><small>${i+1}</small>${draftParty[i]?`<span class="roster-card-art" aria-hidden="true"><img src="${scene.previewTexture(scene.previewIdleKey(draftParty[i]),'roster')}" data-icon="${scene.previewIdleKey(draftParty[i])}" data-preview-kind="${draftParty[i]}" data-preview-align="roster" alt="" draggable="false"></span><span class="roster-slot-name">${UNITS[draftParty[i]].name}</span>${rosterStars(UNITS[draftParty[i]].rosterCard.stars)}`:'<span class="roster-slot-name">+</span>'}</button>`).join('');
 $('roster-choices').innerHTML=rosterKinds.map(key=>[key,UNITS[key]]).map(([key,s])=>`<button class="roster-card" data-focused="${rosterFocus===key}" data-tier="${s.tier}" data-rarity="${s.rosterCard.rarity}" data-owned="${campaign.owned.includes(key)}" data-character="${key}" aria-label="${s.name} · ${s.rosterCard.rarity} · 별 ${s.rosterCard.stars}개 편성 ${draftParty.includes(key)?'해제':'선택'}" aria-pressed="${draftParty.includes(key)}"><span class="roster-card-art" aria-hidden="true"><img src="${scene.previewTexture(scene.previewIdleKey(key),'roster')}" data-icon="${scene.previewIdleKey(key)}" data-preview-kind="${key}" data-preview-align="roster" alt="" draggable="false"></span><strong>${s.name}</strong>${rosterStars(s.rosterCard.stars)}<small>${s.rosterCard.rarity}</small><em>${draftParty.includes(key)?'✓':campaign.owned.includes(key)?'':'🔒'}</em></button>`).join('')+'<div class="roster-card roster-card-empty" data-tier="beast" aria-hidden="true"><span class="roster-card-art"></span></div>';
 const s=UNITS[rosterFocus];$('roster').dataset.tier=s.tier;$('roster').dataset.rarity=s.rosterCard.rarity;$('roster-stars').innerHTML=rosterStars(s.rosterCard.stars);$('roster-name').textContent=s.name;$('roster-role').textContent=s.rosterCard.rarity+' · '+s.role.split(' · ')[0];$('roster-stats').innerHTML='<span>체력 <b>'+Math.round(s.hp)+'</b></span><span>공격 <b>'+Math.round(s.damage)+'</b></span><span>소환 <b>'+s.cost+'</b></span>';
 $('roster-description').textContent='';
 const img=$('roster-preview');img.src=scene.previewTexture(scene.previewIdleKey(rosterFocus),'roster');img.dataset.icon=scene.previewIdleKey(rosterFocus);img.dataset.previewKind=rosterFocus;img.dataset.previewAlign='roster';rosterMotion={kind:rosterFocus,enemy:false,img,keys:Array.from({length:rosterFocus==='cow'?97:8},(_,i)=>rosterFocus+i),variants:new Map(),health:1,mode:'idle',started:performance.now(),frame:-1};
 $('roster-motion-menu').open=false;
 for(const button of $('roster-motions').querySelectorAll('[data-roster-motion]')){button.setAttribute('aria-pressed',String(button.dataset.rosterMotion==='idle'));if(button.dataset.rosterMotion==='attack')button.textContent=rosterFocus==='healer'?'치료':'공격';}
 hydrateIcons($('roster'));
}
async function openRoster(){if(!ready||preparing||['playing','paused'].includes(model.status))return;if(!scene.commonReady&&!await prepareFor('동료 편성',p=>scene.ensureCommon(p),openRoster))return;draftParty=[...campaign.party];$('roster-motion-menu').open=false;renderRoster();openInfo($('roster'));}
for(const id of ['roster-open','result-roster'])$(id).addEventListener('click',openRoster);
for(const id of ['roster-choices','roster-slots'])$(id).addEventListener('click',e=>{
 const b=e.target.closest('[data-character],[data-party-remove]');if(!b||b.disabled)return;
 const kind=b.dataset.character??draftParty[Number(b.dataset.partyRemove)];if(!UNITS[kind])return;
 rosterFocus=kind;const index=draftParty.indexOf(kind);let status='닫으면 저장';
 if(index>=0){if(draftParty.length>1)draftParty.splice(index,1);else status='최소 1명 필요';}
 else if(!campaign.owned.includes(kind))status='획득 후 편성';
 else if(draftParty.length>=5)status='최대 5명 편성';
 else draftParty.push(kind);
 renderRoster(status);
});
// The existing Campaign owns validation and persistence; closing commits only a changed draft.
$('roster').addEventListener('close',()=>{if(draftParty.length===campaign.party.length&&draftParty.every((key,i)=>key===campaign.party[i]))return;if(campaign.select(draftParty)){saveCampaign();renderSummonSlots();renderMap();}});
$('roster').querySelector('.dialog-close').addEventListener('click',()=>$('roster').close());
$('roster-motions').addEventListener('click',e=>{
 const b=e.target.closest('[data-roster-motion]');if(!b||!rosterMotion)return;
 const preview=rosterMotion,mode=b.dataset.rosterMotion;preview.mode=mode;preview.started=performance.now();preview.frame=-1;preview.variants.clear();delete preview.img.dataset.icon;$('roster-motion-menu').open=false;
 for(const button of $('roster-motions').querySelectorAll('[data-roster-motion]'))button.setAttribute('aria-pressed',String(button===b));
 $('roster-status').textContent='동작 준비 중';
 const pending=scene.ensurePreview(preview.kind,mode);preview.loading=pending;
 pending.then(()=>{if(rosterMotion===preview&&preview.loading===pending){preview.started=performance.now();preview.frame=-1;$('roster-status').textContent='닫으면 저장';}}).catch(()=>{if(rosterMotion===preview&&preview.loading===pending)$('roster-status').textContent='다시 눌러주세요';}).finally(()=>{if(preview.loading===pending)preview.loading=null;});
});
function renderLoadout(focusKey=draftLoadout[0]){
 const focused=SKILLS[focusKey];$('loadout-detail-label').textContent=focused?.description||'기술을 눌러 장착하거나 해제하세요.';$('loadout-detail-label').setAttribute('aria-label',focused?focused.name+' 설명 펼치기':'기술 설명');
 $('loadout-detail').textContent=focused?.description||'기술을 눌러 장착하거나 해제하세요.';
 $('loadout-slots').innerHTML=[0,1,2].map(i=>`<button data-remove="${i}" ${draftLoadout[i]?'':'disabled'} aria-label="${i+1}번 ${SKILLS[draftLoadout[i]]?.name||'빈 자리'}${draftLoadout[i]?' 장착 해제':''}"><kbd>${i+1}</kbd>${draftLoadout[i]?`<img src="${scene?.previewTexture(SKILLS[draftLoadout[i]].icon)||''}" alt="" draggable="false">`:''}<span class="loadout-slot-name">${SKILLS[draftLoadout[i]]?.name||'빈 자리'}</span>${draftLoadout[i]?'<span class="loadout-slot-remove">×</span>':''}</button>`).join('');
 $('loadout-choices').innerHTML=Object.entries(SKILLS).map(([key,s])=>{const i=draftLoadout.indexOf(key);return `<button class="skill-choice" data-skill="${key}" aria-pressed="${i>=0}" ${i<0&&draftLoadout.length===3?'disabled':''}><img src="${scene?.previewTexture(s.icon)||''}" alt="" draggable="false"><span class="choice-role">${s.role}</span><strong>${s.name}</strong><p>${s.description}</p><small>◎ ${s.cost} · ${s.cooldown}초</small></button>`;}).join('');
 $('loadout-count').textContent=draftLoadout.length+' / 3 장착 · '+Object.keys(SKILLS).length+'가지';$('loadout-save').disabled=!validLoadout(draftLoadout);
}
async function openLoadout(){if(!ready||preparing||['playing','paused'].includes(model.status))return;if(!scene.commonReady&&!await prepareFor('필살기 편성',p=>scene.ensureCommon(p),openLoadout))return;draftLoadout=[...loadout];$('loadout-inspect').open=false;renderLoadout();openInfo($('loadout'));}
for(const id of ['loadout-open','home-loadout'])$(id).addEventListener('click',openLoadout);
$('loadout-choices').addEventListener('click',e=>{const b=e.target.closest('[data-skill]');if(!b||b.disabled)return;const k=b.dataset.skill;if(draftLoadout.includes(k))draftLoadout=draftLoadout.filter(v=>v!==k);else if(draftLoadout.length<3)draftLoadout.push(k);renderLoadout(k);});
$('loadout-slots').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b||b.disabled)return;draftLoadout.splice(Number(b.dataset.remove),1);renderLoadout();});
$('loadout-save').addEventListener('click',()=>{if(!validLoadout(draftLoadout))return;loadout=[...draftLoadout];try{localStorage.setItem('saebyeokmun-loadout',JSON.stringify(loadout));}catch{}renderSkillSlots();if(model.status==='ready')renderMap();$('loadout').close();});
$('loadout').querySelector('.dialog-close').addEventListener('click',()=>$('loadout').close());
renderSkillSlots();
function onReady(error,s){
 if(error){$('loading').textContent=error.message;$('home-loading').textContent=error.message;$('opening-loading').textContent=error.message;return;}
 scene=s;ready=true;startButton.disabled=false;$('enter-map').disabled=false;$('roster-open').disabled=false;$('home-loading').hidden=true;$('loading').hidden=true;$('opening-continue').disabled=false;$('opening-skip').disabled=false;$('opening-loading').textContent='갈 길을 고르면 필요한 그림부터 받습니다.';renderMap();renderSummonSlots();
 // The home menu owns entry; opening the map is always an explicit choice.
 hydrateIcons();document.querySelectorAll('[data-icon]').forEach(img=>{img.draggable=false;});
 const preview={skirt:'skirt0',horse:'horse',reaper:'reaper',boss:'boss',haetae:'haetae1',rabbit:'rabbit1',keeper:'keeper1',cow:'cow1',scholar:'scholar1',healer:'healer1',king:'king1',prince:'prince1',minister:'minister1',cavalry:'cavalry1',girl:'girl1',warden:'wardenWalk0',ferryman:'ferrymanWalk0',waterghost:'waterghostWalk0',spearman:'spearman0',archer:'archer0',mangtae:'mangtaeWalk0',shadow:'shadowWalk0'};
 for(const [kind,spec]of Object.entries(ENEMIES))if(spec.atlas)preview[kind]=kind+'Walk0';
 for(const item of [...COMPANIONS,...CODEX]){
  const article=document.createElement('article');article.className='codex-card';
  const img=document.createElement('img');img.alt=item.name;img.className='sprite-preview';img.draggable=false;
  const tag=document.createElement('small');tag.textContent=item.tag;
  const title=document.createElement('h3');title.textContent=item.name;
  const body=document.createElement('p');body.textContent=item.text;
  const counter=document.createElement('p');counter.className='counter';counter.textContent=item.counter;
  const details=document.createElement('details'),summary=document.createElement('summary');details.setAttribute('name','codex-entry');summary.setAttribute('aria-label',item.name+' 설명·동작');summary.textContent='설명·동작';details.append(summary,body,counter);article.append(img,tag,title,details);
  if(item.source){const url=item.sourceUrl||item.url,source=document.createElement(url?'a':'p');source.className='source-note';source.textContent=item.source;if(url){source.href=url;source.target='_blank';source.rel='noreferrer';source.draggable=false;}details.append(source);}
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
   details.append(row);
   const healthRow=document.createElement('div');healthRow.className='motion-controls';healthRow.setAttribute('role','group');healthRow.setAttribute('aria-label',item.name+' 피해 상태');
   const healthButtons=[];
   for(const [health,label] of [[1,'멀쩡함'],[.7,'상처'],[.3,'큰 상처']]){
    const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',item.name+' '+label);b.setAttribute('aria-pressed',String(health===1));
    b.addEventListener('click',()=>{state.health=health;state.frame=-1;healthButtons.forEach(other=>other.setAttribute('aria-pressed',String(other===b)));});healthButtons.push(b);healthRow.append(b);
   }
   details.append(healthRow);motionPreviews.push(state);previewObserver?.observe(img);
  }
  $(COMPANIONS.includes(item)?'companions-grid':'codex-grid').append(article);
 }
 // Warm the existing shared bundle while the home remains interactive. Failed files
 // retain the normal foreground retry path; ensureCommon coalesces concurrent opens.
 if(!requestedAutoplay&&!(requestedStage!==null&&canEnterStage(requestedStage))&&!(openingEnabled&&requestedStage===null))scene.ensureCommon().then(()=>{renderSkillSlots();renderSummonSlots();}).catch(()=>{});
 renderAutoplay();
 if(requestedAutoplay)beginAutoplay();
 else if(requestedStage!==null&&canEnterStage(requestedStage)){selectStage(requestedStage);start(null,openingEnabled&&requestedStage<2);}
 else if(openingEnabled&&requestedStage===null){selectStage(1);start(null,true);}
}
function onEvents(events){
 if(events.some(e=>e.type==='coin')){coinAnimation?.cancel();coinAnimation=$('coins').animate([{transform:'scale(1)'},{transform:'scale(1.16)',color:'#be8f36'},{transform:'scale(1)'}],{duration:260});}
 for(const e of events){
  if(e.type==='notice')showNotice(e.message);
  soundscape.event(e,model.x);
 }
}
function onFrame(m,s){
 soundscape.setPlaying(!document.hidden&&(m.status==='playing'||$('opening').open&&$('opening').dataset.phase==='playing'&&!$('opening-video').paused||document.body.dataset.entryPhase==='ui'&&infoPaused));
 const now=performance.now();
 const next=autoplay.update(lastAutoplayFrame?Math.max(0,(now-lastAutoplayFrame)/1000):0,preparing||fullscreenPending||document.hidden||infoDialogs.some(d=>d.open));lastAutoplayFrame=now;
 if(next!==null){if(requestedStage!==null){autoplay.complete=true;model.invincible=false;renderAutoplay();}else start(next);}
 if($('codex').open||$('roster').open)for(const p of [...($('codex').open?motionPreviews:[]),...($('roster').open&&rosterMotion?[rosterMotion]:[])]){
  if(previewObserver&&p!==rosterMotion&&!visiblePreviews.has(p.img)){if(p.variants.size){p.variants.clear();p.frame=-1;p.img.removeAttribute('src');}continue;}
  if(ENEMIES[p.kind]&&!scene.previewReady(p.kind)){
   if(!p.loading&&now>=(p.retryAt||0)){p.img.alt=ENEMIES[p.kind].name+' · 그림 준비 중';p.loading=scene.ensurePreview(p.kind).then(()=>{p.frame=-1;p.variants.clear();p.img.alt=ENEMIES[p.kind].name;}).catch(()=>{p.retryAt=performance.now()+5000;p.img.alt='그림을 다시 준비합니다';}).finally(()=>{p.loading=null;});}continue;
  }
  const spec=p.enemy?ENEMY_STRIKE:MOTION[p.kind],elapsed=(now-p.started)/1000*.4,phase=elapsed%((spec.duration||.64)+.7);
  const action=p.mode==='attack'&&phase<spec.duration?{elapsed:phase}:null;
  const dying=p.mode==='depart',deathDuration=p.kind==='reaper'?REAPER_DEPARTURE_TIME:p.enemy?(isBoss(p.kind)?2.7:2.1):1.8,deathProgress=Math.min(1,(elapsed%(deathDuration+1))/deathDuration);
  const frame=p.enemy?(action?4+enemyAttackFrame(phase):motionFrame(p.kind,elapsed,p.mode==='walk',null)):motionFrame(p.kind,p.mode==='walk'?elapsed:0,p.mode==='walk',action);
  const ability=isBoss(p.kind)?ENEMIES[p.kind].ability:null,castPhase=elapsed%((ability?.windup??2.6)+(ability?.duration??1.15)+.7);
  const bossKey=ability?bossPose(elapsed,p.mode==='walk',p.mode==='cast'&&castPhase>=ability.windup&&castPhase<ability.windup+ability.duration?{kind:ability.kind,elapsed:castPhase-ability.windup}:action?{...action,kind:'enemy'}:null,p.mode==='cast'&&castPhase<ability.windup?ability.windup-castPhase:0,p.kind):null;
  const nativePose=!p.enemy?scene.previewMotionKey?.(p.kind,p.mode,elapsed):null;
  const pose=nativePose||(!p.enemy&&p.mode==='idle'?scene.previewIdleKey(p.kind,elapsed):p.kind==='healer'?healerPose(elapsed,p.mode==='walk',action?{...action,kind:'healer',phase:'treat'}:null,elapsed):bossKey||p.keys[frame]);
  const key=dying&&!nativePose?(p.kind==='reaper'?'reaperDepart'+reaperDepartureFrame(deathProgress):p.enemy?'depart'+p.kind+enemyDepartureFrame(deathProgress,ENEMIES[p.kind]?.departureFrames):'defeat'+p.kind+(deathProgress<.32?0:1)):scene.injuryTexture(pose,p.kind,p.health,1);

  p.img.style.opacity=dying&&!nativePose?String(1-Math.max(0,(deathProgress-.55)/.45)):'1';
  p.img.style.transform=dying&&p.kind==='reaper'?'translateY(-'+Math.min(1,deathProgress/.46)*9+'px)':'';
  if(key!==p.frame){const src=p.variants.get(key)||scene.previewTexture(key,p===rosterMotion?'roster':undefined);if(src){p.variants.set(key,src);p.img.src=src;p.img.hidden=false;p.frame=key;}}
 }
 if(now-lastFrame<70)return;lastFrame=now;
 renderAutoplay();
 $('hero-state').textContent=m.invincible?'테스트 · 무적':m.hp<=0?'잠시 쉬어 가기':m.shield>0?(m.waterWard>0?'우산·물의 수호막으로 보호 중':'우산으로 보호 중'):m.waterWard>0?'물의 수호막으로 보호 중':m.action?.kind==='rush'?'해태 돌진':m.action?'합동 공격':m.moving?'길을 걷는 중':'위험';
 $('health-fill').style.width=(m.hp/MAX_HP*100)+'%';$('hp-text').textContent=Math.ceil(m.hp)+' / '+MAX_HP;
 const fraction=m.progress(),progress=Math.floor(fraction*100),sky=skyState(fraction,m.time,m.status==='ready'?s.previewAreaIndex:m.stage),moonMix=sky.night;
 $('distance').textContent=progress+'%';$('route-fill').style.width=fraction*100+'%';document.querySelector('.route-dot').style.left=fraction*100+'%';
 $('sky-label').textContent=sky.name;$('journey-dial').style.setProperty('--celestial',moonMix>.5?'#b9d9f5':sky.name==='노을'?'#ffb18b':'#f4d18a');
 $('dial-sun').setAttribute('opacity',String(1-moonMix));$('dial-moon').setAttribute('opacity',String(moonMix));
 $('sky-ring-fill').setAttribute('stroke-dashoffset',String(100-fraction*100));
 $('journey-dial').setAttribute('aria-valuenow',String(progress));$('journey-dial').setAttribute('aria-valuetext','지옥문까지 '+(100-progress)+'% 남음 · '+sky.name);$('route-remaining').textContent=m.bossDefeated?'문이 열렸어요':'지옥문까지 '+(100-progress)+'%';
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
 if(lastKeeperRank!==m.keeperRank){lastKeeperRank=m.keeperRank;$('upgrade').innerHTML=m.keeperRank?'먹붓 수련 완료':'도령 수련 <small>◎ 45</small>';const keeperButton=$('action-keeper');if(keeperButton){keeperButton.querySelector('strong').textContent=m.keeperRank?'먹붓 도령':'도령';if(!UNITS.keeper.cardArt)keeperButton.querySelector('img').src=s.previewTexture(m.keeperRank?'keeperBrush1':'keeper1');}}
 const region=m.status==='ready'?s.previewAreaIndex:m.stage;
 $('area-label').textContent=m.bossDefeated?(m.stage===STAGES.length-1?'집 앞':'열린 길'):STAGES[region].place;
 $('edition-area').textContent=AREAS[region].name;document.body.dataset.area=String(region);
 if(now>noticeUntil&&lastHint!==m.hintSerial){$('callout').textContent=m.hint;lastHint=m.hintSerial;}
 $('callout').hidden=m.status==='ready'||m.status==='won'||m.status==='lost'||(m.time-m.lastHintAt>7&&now>noticeUntil);
 for(const [name,baseSpec] of Object.entries({...UNITS,...SKILLS})){
  const spec=UNITS[name]?unitStats(name,m.keeperRank):baseSpec;
  const button=$('action-'+name),cd=m.cooldowns[name],full=!!UNITS[name]&&m.atSummonLimit(name);if(!button)continue;button.disabled=m.status!=='playing'||cd>0||m.coins<spec.cost||full||(name==='charm'&&!!m.moving)||(['rush','stomp'].includes(name)&&!!m.action);
  button.dataset.state=m.status!=='playing'?'idle':full?'full':cd>0?'cooldown':m.coins<spec.cost?'cost':button.disabled?'idle':'ready';
  // The price strip mirrors the visible shared purse; only Journey owns spending/readiness.
  if(UNITS[name])button.style.setProperty('--cost-fill',(Math.min(1,shownCoins/spec.cost)*100)+'%');
  button.querySelector('.cooldown').style.height=(cd/spec.cooldown*100)+'%';button.style.setProperty('--cooldown-turn',Math.max(0,Math.min(1,cd/spec.cooldown))+'turn');
  button.title=(UNITS[name]?UNIT_TIERS[spec.tier].label+' · ':'')+spec.name+(spec.role?' · '+spec.role:'')+' · '+(name==='charm'&&m.moving?'멈춘 뒤 사용 가능':button.dataset.state==='full'?'동료가 가득해요':cd>0?cd.toFixed(1)+'초 뒤':button.dataset.state==='cost'?'엽전 '+Math.ceil(spec.cost-m.coins)+' 부족 · 필요 '+spec.cost:spec.cost+' 엽전');
  button.setAttribute('aria-label',button.title);if(UNITS[name])button.querySelector('.unit-count').textContent=m.countAllies(name)+'/'+ALLY_TYPE_LIMIT;
  let badge=button.querySelector('.countdown');
  if(cd>0&&!full){if(!badge){badge=document.createElement('span');badge.className='countdown';button.append(badge);}badge.textContent=Math.ceil(cd);}
  else badge?.remove();
 }
 const boss=m.enemies.find(e=>isBoss(e.type))||m.enemies.find(e=>e.type==='gate');$('boss-bar').hidden=!boss||m.status!=='playing';if(boss){$('boss-fill').style.width=(boss.hp/boss.maxHp*100)+'%';$('boss-label').textContent=boss.type==='gate'?'문':ENEMIES[boss.type].name;}
 $('pause').hidden=!['playing','paused'].includes(m.status);for(const channel of ['music','effects'])$('hud-'+channel).hidden=$('pause').hidden;
 $('pause-overlay').hidden=autoplay.active||m.status!=='paused'||fullscreenPending||infoDialogs.some(d=>d.open);
 if(m.status!==lastStatus){
  lastStatus=m.status;
  if(['won','lost'].includes(m.status)&&!autoplay.active){
   updateBest();resultReadyAt=now+(m.status==='lost'?1800:350);$('result').hidden=true;
   const rewardKind=STAGES[m.stage].reward,newCharacter=m.status==='won'&&rewardKind&&!campaign.owned.includes(rewardKind);
   if(m.status==='won'){const reward=campaign.clear(activeRun,m.earnedCoins,m.stage);saveCampaign();clearedStages=0;while(campaign.cleared.includes(clearedStages))clearedStages++;try{localStorage.setItem('saebyeokmun-cleared',String(clearedStages));}catch{}$('result-earned').textContent='◎ +'+reward;}else $('result-earned').textContent='';
   $('result-character').hidden=!newCharacter;
   if(newCharacter){$('result-character-image').src=scene.previewTexture(rewardKind+'1');$('result-character-image').alt=UNITS[rewardKind].name;$('result-character-name').textContent=UNITS[rewardKind].name;}
   $('result-tag').textContent=String(m.stage+1).padStart(2,'0');
   $('result-title').textContent=m.status==='won'?'클리어':'재도전';
   $('result-copy').textContent='';
   $('result-stats').replaceChildren();
   for(const [label,value] of [['진행',progress+'%'],['◎',Math.floor(m.earnedCoins).toLocaleString('ko-KR')],['◷',Math.floor(m.time/60)+':'+String(Math.floor(m.time%60)).padStart(2,'0')]]){
    const span=document.createElement('span');span.textContent=label;const b=document.createElement('b');b.textContent=value;span.append(b);$('result-stats').append(span);
   }
  }
 }
 if(['won','lost'].includes(m.status))$('result').hidden=autoplay.active||now<resultReadyAt;
}
function stopLoadingDisplay(complete=false){
 loadingDisplay.active=false;window.cancelAnimationFrame(loadingDisplay.frame);
 $('download-progress').dataset.elapsedMs=String(Math.round(performance.now()-loadingDisplay.started));
 if(complete){loadingDisplay.value=100;$('download-progress').value=100;$('download-percent').textContent='100%';}
}
function paintLoading(now){
 const s=loadingDisplay;if(!s.active)return;
 const dt=Math.min(100,Math.max(0,now-s.last));s.last=now;
 // Predict between measured work callbacks. Re-estimate from this connection's
 // throughput and this device's decode times, rather than a fixed byte weight.
 // An overdue operation slows the forecast instead of freezing at its last byte.
 const age=Math.max(0,now-s.updated),remaining=Math.max(250,s.remaining-age,s.remaining*.35/(1+age/Math.max(1,s.remaining)));
 s.value=Math.min(99.9,s.value+(100-s.value)*(1-Math.exp(-dt/Math.max(500,remaining))));
 $('download-progress').value=s.value;$('download-percent').textContent=s.value.toFixed(2)+'%';
 $('download-progress').dataset.elapsedMs=String(Math.max(0,Math.round(now-s.started)));
 $('download-state').textContent=s.state+' · '+(age>5000?Math.floor((now-s.started)/1000)+'초 경과':'약 '+Math.max(1,Math.ceil(remaining/1000))+'초 남음');
 s.frame=window.requestAnimationFrame(paintLoading);
}
function updateDownload(p){
 const now=performance.now();
 $('download-percent').hidden=false;$('download-bytes').hidden=!p.total;$('download-state').hidden=false;
 if(p.total)$('download-bytes').textContent=`${(p.loaded/1048576).toFixed(1)} / ${(p.total/1048576).toFixed(1)} MB`;
 if(!loadingDisplay.active){loadingDisplay={active:true,value:0,started:now,last:now,updated:now,remaining:10000,frame:0};$('download-progress').value=0;$('download-progress').setAttribute('aria-label','예상 게임 준비 진행률');$('download-percent').textContent='0.00%';loadingDisplay.frame=window.requestAnimationFrame(paintLoading);}
 const s=loadingDisplay;s.state=p.state||(p.phase==='prepare'?'그림 준비 중':p.phase==='waiting'?'준비할 파일 확인 중':'파일 받는 중');$('download-state').textContent=s.state;
 if(p.phase!=='waiting'){
  const elapsed=Math.max(1,now-s.started),rate=p.loaded?p.loaded/elapsed:2*1048576/1000;
  s.remaining=Math.max(250,p.remainingMs??(p.phase==='prepare'?Math.max(0,p.prepareTotal-p.prepared)*60:Math.max(0,(p.total||0)-(p.loaded||0))/rate+2000));s.updated=now;
 }
}
async function prepareFor(title,work,retry,covered=false){
 if(preparing)return false;preparing=true;const epoch=++entryEpoch;retryAssets=retry;
 $('download-title').textContent=title;$('download-retry').hidden=true;$('download-state').textContent='확인 중';$('download-state').hidden=true;
 updateDownload({loaded:0,total:0,percent:0,phase:'waiting'});
 fitPhoneDialogs();if(!covered)$('asset-loading').showModal();
 try{await work(p=>{if(epoch===entryEpoch)updateDownload(p);});if(epoch!==entryEpoch)return false;stopLoadingDisplay(true);$('asset-loading').close();hydrateIcons();return true;}
 catch(error){if(epoch===entryEpoch){stopLoadingDisplay();$('download-state').textContent=error.message;$('download-state').hidden=false;$('download-retry').hidden=false;if(covered)$('asset-loading').showModal();}return false;}
 finally{preparing=false;}
}
$('download-retry').addEventListener('click',()=>{if(!preparing)retryAssets?.();});
$('download-back').addEventListener('click',showMap);
$('asset-loading').addEventListener('cancel',e=>{e.preventDefault();showMap();});
document.querySelector('.phone-screen').append($('asset-loading'));
renderMap();renderSummonSlots();
makeGame(model,onReady,onFrame,onEvents);


if(openingEnabled&&!requestedAutoplay&&(requestedStage===null||requestedStage<2))coverOpening();
