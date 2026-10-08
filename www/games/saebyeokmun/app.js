import {Journey} from './game/model.js?v=17';
import {makeGame} from './game/scene.js?v=17';
import {Soundscape} from './game/audio.js?v=14';
import {ROAD,MAX_HP,MAX_COINS,UNITS,SKILLS,CODEX,COMPANIONS,MOTION,motionFrame,AREAS,areaIndex,ENEMY_STRIKE,enemyAttackFrame,unitStats,DEFAULT_LOADOUT,validLoadout} from './game/data.js?v=17';
const $=id=>document.getElementById(id);
const model=new Journey();
let installPrompt=null;
let scene,ready=false,lastStatus='',lastHint=0,noticeUntil=0,lastFrame=0,infoPaused=false,coinAnimation,lastKeeperRank=-1;
const keys=new Set();
const motionPreviews=[];
const startButton=$('start');startButton.disabled=true;
let best=0,loadout=[...DEFAULT_LOADOUT],draftLoadout=[];
try{const saved=JSON.parse(localStorage.getItem('saebyeokmun-loadout'));if(validLoadout(saved))loadout=saved;}catch{}
try{best=Number(localStorage.getItem('saebyeokmun-best')||0)||0;}catch{}
$('best').textContent=best?best+'%':'아직 걷지 않은 길';
const soundscape=new Soundscape({onState:state=>{
 $('sound').dataset.audioState=state;
 $('audio-status').textContent=state==='locked'?'소리 버튼을 눌러 공격음을 켜 주세요.':state==='loading'?'밤길의 소리를 준비하고 있어요.':state==='partial'?'일부 소리를 불러오지 못했어요. 새로고침하면 다시 준비합니다.':'소의 뿔 · 돌팔매 · 먹붓 · 씨앗탄 · 선비의 봉인 · 승천';
}});
function unlockSound(){return soundscape.unlock().catch(()=>{showNotice('소리를 시작하지 못했어요. 소리 버튼을 다시 눌러 주세요.');});}
function updateSound(){
 $('sound').setAttribute('aria-pressed',String(soundscape.enabled));$('sound').setAttribute('aria-label',soundscape.enabled?'소리 끄기':'소리 켜기');$('sound-state').textContent=soundscape.enabled?'소리 켬':'소리 끔';
}
function updateBest(){const n=Math.floor(model.progress()*100);best=Math.max(best,n);$('best').textContent=best+'%';try{localStorage.setItem('saebyeokmun-best',String(best));}catch{}}
function start(){
 if(!ready)return;model.start();keys.clear();lastStatus='';$('intro').hidden=true;$('result').hidden=true;$('pause-overlay').hidden=true;$('hud').hidden=false;$('callout').hidden=false;
 if(scene)scene.resetPresentation();updateAuto();soundscape.setPlaying(true);unlockSound().then(()=>{if(model.status==='playing')soundscape.play('summon');});
}
function pause(){if(!ready)return;model.pause();keys.clear();model.direction=0;soundscape.setPlaying(model.status==='playing');if(model.status==='playing')unlockSound();}
function updateAuto(){$('auto').setAttribute('aria-pressed',String(model.auto));}
function callAction(name){if(UNITS[name])model.summon(name);else model.skill(name);}
function setDirection(){model.direction=keys.has('right')?1:keys.has('left')?-1:0;}
function setupHold(button,direction){
 const release=e=>{keys.delete(direction);button.classList.remove('held');setDirection();if(e&&button.hasPointerCapture?.(e.pointerId))button.releasePointerCapture(e.pointerId);};
 button.addEventListener('pointerdown',e=>{e.preventDefault();if(model.status!=='playing')return;button.setPointerCapture(e.pointerId);keys.add(direction);button.classList.add('held');setDirection();});
 button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
}
setupHold($('move-left'),'left');setupHold($('move-right'),'right');
$('start').addEventListener('click',start);$('restart').addEventListener('click',start);$('restart-pause').addEventListener('click',start);
$('pause').addEventListener('click',pause);$('resume').addEventListener('click',pause);
document.querySelectorAll('[data-scene]').forEach(button=>button.addEventListener('click',()=>{if(scene&&model.status==='ready')scene.previewAreaIndex=Number(button.dataset.scene);}));
$('auto').addEventListener('click',()=>{model.auto=!model.auto;updateAuto();});
$('actions').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)callAction(b.dataset.action);});
$('upgrade').addEventListener('click',()=>model.upgradeKeeper());
document.addEventListener('dragstart',e=>e.preventDefault());
document.addEventListener('keydown',e=>{
 if($('codex').open||$('loadout').open||$('app-help').open)return;
 const k=e.key.toLowerCase();
 if(['arrowleft','arrowright',' ','a','d','q','e','r','1','2','3','4'].includes(k))e.preventDefault();
 if(k===' '){if(!e.repeat)pause();return;}
 if(k==='enter'&&model.status==='ready')start();
 if(k==='arrowleft'||k==='a'){keys.add('left');setDirection();}
 if(k==='arrowright'||k==='d'){keys.add('right');setDirection();}
 if(!e.repeat&&{'1':'cow','2':'keeper','3':'rabbit','4':'scholar',q:loadout[0],e:loadout[1],r:loadout[2]}[k])callAction({'1':'cow','2':'keeper','3':'rabbit','4':'scholar',q:loadout[0],e:loadout[1],r:loadout[2]}[k]);
});
document.addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(k==='arrowleft'||k==='a')keys.delete('left');if(k==='arrowright'||k==='d')keys.delete('right');setDirection();});
function blurPause(){keys.clear();model.direction=0;if(model.status==='playing')model.pause();soundscape.setPlaying(false);soundscape.stopVoices();}
window.addEventListener('blur',blurPause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)blurPause();});
window.matchMedia('(max-width:600px) and (orientation:portrait)').addEventListener('change',e=>{if(e.matches)blurPause();});
$('sound').addEventListener('click',()=>{soundscape.setEnabled(!soundscape.enabled);updateSound();if(soundscape.enabled)unlockSound().then(()=>soundscape.play('guard',{allowIdle:true}));});
$('sound-volume').addEventListener('input',e=>{soundscape.setVolume(e.target.value/100);$('volume-value').textContent=e.target.value+'%';});
document.querySelectorAll('[data-sound]').forEach(button=>button.addEventListener('click',async()=>{
 soundscape.setEnabled(true);updateSound();await unlockSound();soundscape.play(button.dataset.sound,{allowIdle:true});
}));
$('fullscreen').addEventListener('click',async()=>{
 try{if(document.fullscreenElement){await document.exitFullscreen();}else{await document.querySelector('.phone-screen').requestFullscreen();try{await screen.orientation?.lock?.('landscape');}catch{}}}catch{openInfo($('app-help'));}
});
document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'전체 화면 나가기':'전체 화면');});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install-confirm').hidden=false;});
window.addEventListener('appinstalled',()=>{installPrompt=null;$('install-confirm').hidden=true;$('app-help').close();});
$('install').addEventListener('click',()=>openInfo($('app-help')));
$('app-help').querySelector('.dialog-close').addEventListener('click',()=>$('app-help').close());
$('install-confirm').addEventListener('click',async()=>{if(!installPrompt)return;const prompt=installPrompt;installPrompt=null;$('install-confirm').hidden=true;await prompt.prompt();await prompt.userChoice;});
// Every combat gesture can recover mobile audio after an OS interruption.
document.addEventListener('pointerdown',()=>{if(soundscape.enabled&&soundscape.context?.state!=='running')unlockSound();},{passive:true});
function showNotice(message){$('callout').textContent=message;$('callout').hidden=false;noticeUntil=performance.now()+2400;}
function openInfo(dialog){infoPaused=model.status==='playing';if(infoPaused)model.pause();soundscape.setPlaying(false);dialog.showModal();}
function openCodex(){openInfo($('codex'));}
$('codex-open').addEventListener('click',openCodex);$('result-codex').addEventListener('click',openCodex);$('sources-open').addEventListener('click',openCodex);
$('codex').querySelector('.dialog-close').addEventListener('click',()=>$('codex').close());
$('codex').addEventListener('click',e=>{if(e.target===$('codex')){const r=$('codex').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('codex').close();}});
for(const dialog of [$('codex'),$('app-help')])dialog.addEventListener('close',()=>{soundscape.stopVoices();if(infoPaused&&model.status==='paused')model.pause();soundscape.setPlaying(model.status==='playing');infoPaused=false;});
function renderSkillSlots(){
 $('skill-slots').innerHTML=loadout.map((key,i)=>{const s=SKILLS[key];return `<button class="action" id="action-${key}" data-action="${key}"><span class="action-role magic">${s.role}</span><kbd>${['Q','E','R'][i]}</kbd><span class="action-art"><img data-icon="${s.icon}" alt="" draggable="false"></span><strong>${key==='rush'?'해태 돌진':key==='stomp'?'발구름':s.name}</strong><small>◎ ${s.cost}</small><span class="cooldown"></span></button>`;}).join('');
 if(scene)$('skill-slots').querySelectorAll('[data-icon]').forEach(img=>{img.src=scene.previewTexture(img.dataset.icon);});
}
function renderLoadout(){
 $('loadout-slots').innerHTML=[0,1,2].map(i=>`<button data-remove="${i}" ${draftLoadout[i]?'':'disabled'}><kbd>${['Q','E','R'][i]}</kbd>${SKILLS[draftLoadout[i]]?.name||'비어 있는 자리'}${draftLoadout[i]?'<span>×</span>':''}</button>`).join('');
 $('loadout-choices').innerHTML=Object.entries(SKILLS).map(([key,s])=>{const i=draftLoadout.indexOf(key);return `<button class="skill-choice" data-skill="${key}" aria-pressed="${i>=0}" ${i<0&&draftLoadout.length===3?'disabled':''}><img src="${scene?.previewTexture(s.icon)||''}" alt="" draggable="false"><span class="choice-role">${s.role} ${i>=0?'· '+['Q','E','R'][i]+' 장착':''}</span><strong>${s.name}</strong><p>${s.description}</p><small>◎ ${s.cost} · 대기 ${s.cooldown}초</small></button>`;}).join('');
 $('loadout-count').textContent=draftLoadout.length+' / 3 선택';$('loadout-save').disabled=!validLoadout(draftLoadout);
}
$('loadout-open').addEventListener('click',()=>{if(!ready||['playing','paused'].includes(model.status))return;draftLoadout=[...loadout];renderLoadout();$('loadout').showModal();});
$('loadout-choices').addEventListener('click',e=>{const b=e.target.closest('[data-skill]');if(!b||b.disabled)return;const k=b.dataset.skill;if(draftLoadout.includes(k))draftLoadout=draftLoadout.filter(v=>v!==k);else if(draftLoadout.length<3)draftLoadout.push(k);renderLoadout();});
$('loadout-slots').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b||b.disabled)return;draftLoadout.splice(Number(b.dataset.remove),1);renderLoadout();});
$('loadout-save').addEventListener('click',()=>{if(!validLoadout(draftLoadout))return;loadout=[...draftLoadout];try{localStorage.setItem('saebyeokmun-loadout',JSON.stringify(loadout));}catch{}renderSkillSlots();$('loadout').close();});
$('loadout').querySelector('.dialog-close').addEventListener('click',()=>$('loadout').close());
renderSkillSlots();
function onReady(error,s){
 if(error){$('loading').textContent=error.message;return;}
 scene=s;ready=true;startButton.disabled=false;$('loading').hidden=true;
 document.querySelectorAll('[data-icon]').forEach(img=>{img.src=scene.previewTexture(img.dataset.icon);img.draggable=false;});
 const preview={skirt:'skirt0',horse:'horse',reaper:'reaper',boss:'boss',haetae:'haetae1',rabbit:'rabbit1',keeper:'keeper1',cow:'cow1',scholar:'scholar1',girl:'girl1'};
 for(const item of [...COMPANIONS,...CODEX]){
  const article=document.createElement('article');article.className='codex-card';
  const img=document.createElement('img');img.src=scene.previewTexture(preview[item.asset]);img.alt=item.name;img.className='sprite-preview';img.draggable=false;
  const tag=document.createElement('small');tag.textContent=item.tag;
  const title=document.createElement('h3');title.textContent=item.name;
  const body=document.createElement('p');body.textContent=item.text;
  const counter=document.createElement('p');counter.className='counter';counter.textContent=item.counter;
  article.append(img,tag,title,body,counter);
  if(item.motion||CODEX.includes(item)){
   const row=document.createElement('div');row.className='motion-controls';row.setAttribute('role','group');row.setAttribute('aria-label',item.name+' 동작 시험');
   const enemy=CODEX.includes(item),defaultMode='walk';
   const state={kind:item.asset,enemy,img,frames:Array.from({length:enemy?8:(MOTION[item.asset].idleFrame!==undefined?MOTION[item.asset].idleFrame+1:(MOTION[item.asset].walkFrames||4)+(item.motion==='walk'?0:(MOTION[item.asset].attackFrames||4)))},(_,i)=>scene.previewTexture(item.asset+(enemy?(i<4?'Walk':'Strike'):'')+(enemy?i%4:i))),mode:defaultMode,started:performance.now(),frame:-1,buttons:[]};
   for(const [mode,label] of (item.motion==='walk'?[['walk','걷기'],['idle','멈춤']]:[['walk','걷기'],['attack','공격'],['idle','멈춤']])){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',item.name+' '+label);button.setAttribute('aria-pressed',String(mode===defaultMode));
    button.addEventListener('click',()=>{state.mode=mode;state.started=performance.now();state.buttons.forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});state.buttons.push(button);row.append(button);
   }
   article.append(row);motionPreviews.push(state);
  }
  $(COMPANIONS.includes(item)?'companions-grid':'codex-grid').append(article);
 }
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
 if($('codex').open)for(const p of motionPreviews){
  const spec=p.enemy?ENEMY_STRIKE:MOTION[p.kind],elapsed=(now-p.started)/1000,phase=elapsed%((spec.duration||.64)+.7);
  const action=p.mode==='attack'&&phase<spec.duration?{elapsed:phase}:null;
  const frame=p.enemy?(action?4+enemyAttackFrame(phase):motionFrame(p.kind,elapsed,p.mode==='walk',null)):motionFrame(p.kind,elapsed,p.mode==='walk',action);
  if(frame!==p.frame){p.img.src=p.frames[frame];p.frame=frame;}
 }
 if(now-lastFrame<70)return;lastFrame=now;
 $('health-fill').style.width=(m.hp/MAX_HP*100)+'%';$('hp-text').textContent=Math.ceil(m.hp)+' / '+MAX_HP;
 const progress=Math.floor(m.progress()*100);$('distance').textContent=progress+'%';$('route-fill').style.width=progress+'%';document.querySelector('.route-dot').style.left=progress+'%';
 $('coins').textContent=Math.floor(m.coins).toLocaleString('ko-KR');
 $('coin-fill').style.width=(m.coins/MAX_COINS*100)+'%';$('coin-gauge').setAttribute('aria-valuenow',String(Math.floor(m.coins)));
 $('party-count').textContent='동료 '+m.allies.filter(a=>a.hp>0).length+' / 7';
 $('loadout-open').disabled=!ready||['playing','paused'].includes(m.status);
 $('loadout-open').title=['playing','paused'].includes(m.status)?'이번 여정이 끝나면 편성을 바꿀 수 있어요.':'필살기 5개 중 3개 선택';
 $('upgrade').disabled=m.status!=='playing'||m.keeperRank>0||m.coins<UNITS.keeper.upgrade.price;
 if(lastKeeperRank!==m.keeperRank){lastKeeperRank=m.keeperRank;$('upgrade').innerHTML=m.keeperRank?'먹붓 수련 완료':'도령 수련 <small>◎ 45</small>';$('action-keeper').querySelector('strong').textContent=m.keeperRank?'먹붓 도령':'도령';$('action-keeper').querySelector('img').src=s.previewTexture(m.keeperRank?'keeperBrush1':'keeper1');}
 const region=m.status==='ready'?s.previewAreaIndex:areaIndex(m.progress());
 $('area-label').textContent=m.bossDefeated?'새벽문 앞':AREAS[region].name;
 $('edition-area').textContent=AREAS[region].name;document.querySelector('.intro-caption strong').textContent=AREAS[region].name;document.body.dataset.area=String(region);
 $('scene-help').textContent=m.status==='ready'?'출발 전, 배경 둘러보기':'함께 지나갈 세 갈래 풍경';
 document.querySelectorAll('[data-scene]').forEach(button=>{button.disabled=m.status!=='ready';button.setAttribute('aria-pressed',String(Number(button.dataset.scene)===region));});
 if(now>noticeUntil&&lastHint!==m.hintSerial){$('callout').textContent=m.hint;lastHint=m.hintSerial;}
 $('callout').hidden=m.status==='ready'||m.status==='won'||m.status==='lost'||(m.time-m.lastHintAt>7&&now>noticeUntil);
 for(const [name,baseSpec] of Object.entries({...UNITS,...SKILLS})){
  const spec=UNITS[name]?unitStats(name,m.keeperRank):baseSpec;
  const button=$('action-'+name),cd=m.cooldowns[name];if(!button)continue;button.disabled=m.status!=='playing'||cd>0||m.coins<spec.cost||(UNITS[name]&&m.allies.length>=7)||(['rush','stomp'].includes(name)&&!!m.action);
  button.dataset.state=m.status!=='playing'?'idle':cd>0?'cooldown':m.coins<spec.cost?'cost':button.disabled?'full':'ready';
  button.querySelector('.cooldown').style.height=(cd/spec.cooldown*100)+'%';
  button.title=spec.name+(spec.role?' · '+spec.role:'')+' · '+(button.dataset.state==='full'?'동료가 가득해요':cd>0?cd.toFixed(1)+'초 뒤':spec.cost+' 엽전');
  button.setAttribute('aria-label',button.title);
  let badge=button.querySelector('.countdown');
  if(cd>0){if(!badge){badge=document.createElement('span');badge.className='countdown';button.append(badge);}badge.textContent=Math.ceil(cd);}
  else badge?.remove();
 }
 const boss=m.enemies.find(e=>e.type==='boss');$('boss-bar').hidden=!boss||m.status!=='playing';if(boss)$('boss-fill').style.width=(boss.hp/boss.maxHp*100)+'%';
 $('pause-overlay').hidden=m.status!=='paused'||$('codex').open||$('app-help').open;
 if(m.status!==lastStatus){
  lastStatus=m.status;
  if(['won','lost'].includes(m.status)){
   updateBest();$('result').hidden=false;$('result-tag').textContent=m.status==='won'?'THE DAWN HAS ARRIVED':'THE JOURNEY CONTINUES';
   $('result-title').textContent=m.status==='won'?'함께, 새벽에 닿았다.':'오늘의 발걸음은 여기까지.';
   $('result-copy').textContent=m.status==='won'?'먹구름 너머로 문이 열렸어요. 작은 행렬이 밤을 건넜습니다.':'동료를 모으고 귀물의 예고를 살펴보세요. 다시 걸을 수 있어요.';
   $('result-stats').replaceChildren();
   for(const [label,value] of [['걸어온 길',progress+'%'],['모은 엽전',Math.floor(m.earnedCoins).toLocaleString('ko-KR')],['함께한 시간',Math.floor(m.time/60)+':'+String(Math.floor(m.time%60)).padStart(2,'0')]]){
    const span=document.createElement('span');span.textContent=label;const b=document.createElement('b');b.textContent=value;span.append(b);$('result-stats').append(span);
   }
  }
 }
}
makeGame(model,onReady,onFrame,onEvents);
