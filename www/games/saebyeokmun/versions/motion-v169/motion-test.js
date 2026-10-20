import {Journey} from './game/model.js?v=149-cross-chat';
import {makeGame} from './game/scene.js?v=149-cross-chat';
import {HEALER_VIDEO} from './game/healer-motion.js?v=selected139-cards';
import {STAGES,ENEMIES,MAX_HP,MAX_COINS,DEFAULT_PARTY,UNITS,BODY_HEIGHT,MOTION} from './game/data.js?v=149-cross-chat';
import {TRAVELLER_VIDEO} from './game/traveller-motion.js?v=149-cross-chat';
const VIDEO_MOTION={healer:HEALER_VIDEO,...TRAVELLER_VIDEO};
const $=id=>document.getElementById(id),model=new Journey(),keys=new Set();let scene,ready=false,totalDamage=0,totalHealed=0,lastUI=-Infinity,pausedByHidden=false,healerConfig=null,fieldPreview=null;

// Production registries and Scene own pixels, streaming, scale and floor. No master atlases.
async function prepareHealerMotions(){healerConfig={clips:HEALER_VIDEO,labels:{castHeal:'약초',castHealLight:'치유빛',castHealBless:'축복'}};}
let previewSerial=0;
const motionLabels={ritual:'지원 의식',projectile:'책에서 분리한 원혼',idle:'기본 대기',dance:'감정 대기',annoyed:'다른 대기',sit:'앉아 쉬기',walk:'걷기',run:'달리기',runUrgent:'치료하러 달리기',castHeal:'힐 · 약초',castHealLight:'힐 · 치유빛',castHealBless:'힐 · 축복',attack:'공격',anticipation:'적 발견 · 예비',anger:'분노 전환',rageRun:'분노 달리기',rageHold:'화난 대기',combatCalm:'전투 후 복귀',angerHold:'화난 대기',emotionHold:'감정 유지',emotion:'혼자 화내기',calm:'평상시 복귀',receiveHeal:'치료받기',hurt:'피격',death:'사망'};
motionLabels.reaper={idle:'부유 대기',walk:'느린 부유',run:'빠른 비행',attack:'명부 소환 공격',ritual:'지원 의식',receiveHeal:'기운 회복 받기',hurt:'공중 피격',death:'형체 소멸 · 빈 옷 낙하',projectile:'원혼 공격 · 완전 소멸'};
function motionButtons(){
 const kind=$('motion-character').value;
 const seen=new Set();
 $('motion-buttons').replaceChildren(...Object.entries(VIDEO_MOTION[kind]).filter(([,spec])=>{if(seen.has(spec.asset))return false;seen.add(spec.asset);return true;}).map(([name])=>{const b=document.createElement('button');b.type='button';b.dataset.motion=name;b.textContent=motionLabels[kind]?.[name]||motionLabels[name]||name;b.setAttribute('aria-pressed','false');b.disabled=!ready;b.onclick=()=>previewMotion(name);return b;}));
}
async function previewMotion(name){
 if(!ready)return;
 const kind=$('motion-character').value,spec=VIDEO_MOTION[kind]?.[name];if(!spec)return;
 const ticket=++previewSerial;fieldPreview=null;
 $('motion-progress').textContent=(motionLabels[kind]?.[name]||motionLabels[name]||name)+' 준비 중…';
 // Source time/ranges come from the same deployed clip, not a separate timing model.
 const range=['walk','run','runUrgent','attack'].includes(name)?spec.cycles?.[0]:null,start=range?.start||0,end=range?.end??spec.frames-1;
 try{
  const [key]=scene.videoFiles([spec.asset+':'+Math.floor(start/24)]);await scene.loadFiles([key],p=>{if(ticket===previewSerial)$('motion-progress').textContent='동작 준비 · '+(p.phase==='prepare'?'그림 처리':Math.round(p.percent||0)+'%');});await scene.decodeVideo(key);
  if(ticket!==previewSerial)return;
  restart();model.enemies=[];model.projectiles=[];model.wave=model.waves.length;model.auto=false;model.heroAttack=Infinity;$('auto').checked=false;
  model.x=model.furthest=model.roadEnd-90;
  let actor=null;
  if(UNITS[kind]){actor=model.allies.find(a=>a.type===kind)||model.addAlly(kind,model.roadEnd-90);if(typeof actor!=='object')actor=model.allies.find(a=>a.type===kind);model.allies=model.allies.filter(a=>a===actor);actor.x=model.roadEnd-90;}
  else model.allies=[];
  if(ENEMIES[kind]){actor=model.spawn(kind,model.roadEnd-90);actor.stun=Infinity;actor.entering=false;}
  fieldPreview={kind,motion:name,spec,start,end,actor:actor?(ENEMIES[kind]?'e':'a')+actor.id:kind==='girl'?'girl':'hero',x:actor?actor.x:model.x+(kind==='girl'?-60:37),at:model.time};
  if(model.status==='paused')pause();
  $('status').textContent='모션 확인 · 제자리 재생 · 게임 진행과 재화는 저장하지 않습니다';
  $('motion-progress').textContent=motionLabels[kind]?.[name]||motionLabels[name]||name;
  for(const b of $('motion-buttons').children)b.setAttribute('aria-pressed',String(b.dataset.motion===name));
 }catch(error){if(ticket===previewSerial)$('motion-progress').textContent='동작 준비 실패 · 같은 버튼을 눌러 다시 시도하세요.';}
}
function drawMotionPreview(){
 const p=fieldPreview;if(!p)return;
 const image=p.actor==='hero'?scene.hero:p.actor==='girl'?scene.girl:scene.sprites.get(p.actor);if(!image)return;
 const elapsed=Math.max(0,model.time-p.at),count=p.end-p.start+1,n=Math.floor(elapsed*p.spec.fps),frame=p.start+(p.motion==='death'?Math.min(count-1,n):n%count);
 const key=scene.videoCel(p.spec.prefix+frame,image.celKey||image.texture.key);scene.setCel(image,key);
 scene.placeOnGround(image,p.x-scene.offset,BODY_HEIGHT[p.kind],scene.actorGround(p.actor));image.setFlipX(false).setVisible(scene.textures.exists(scene.videoPage(scene.videoFrameIndex.get(key)||scene.videoFrameIndex.get(p.spec.prefix+frame)).key));
 if(p.motion==='projectile'){const page=scene.videoPage(scene.videoFrameIndex.get(p.spec.prefix+frame)),height=scene.actorHeight(BODY_HEIGHT[p.kind])*p.spec.scale;image.setOrigin(.5,.5).setDisplaySize(height*page.w/page.h,height).setPosition(p.x-scene.offset,scene.actorGround(p.actor)-scene.actorHeight(BODY_HEIGHT[p.kind])*.55);}
 else image.y-=(MOTION[p.kind]?.hover||0)*scene.actorHeight(BODY_HEIGHT[p.kind])*(p.motion==='death'&&p.spec.cue?.grounded?Math.max(0,1-elapsed/(p.spec.cue.grounded/p.spec.fps)):p.motion==='death'?0:1);
 image.setAlpha(p.motion==='death'?Math.max(0,1-Math.max(0,elapsed-count/p.spec.fps)/.5):1);scene.root.bringToTop(image);
 if(p.kind==='healer'&&p.motion.startsWith('castHeal')){const cue=p.spec.cycles?.find(c=>frame>=c.start&&frame<=c.end);if(cue){const clock=frame<=cue.impact?(frame-cue.start)/Math.max(1,cue.impact-cue.start)*MOTION.healer.impact:MOTION.healer.impact+(frame-cue.impact)/Math.max(1,cue.end-cue.impact)*(MOTION.healer.duration-MOTION.healer.impact);scene.drawHealerCastLight(image,{phase:'treat',elapsed:clock});}}
 if(p.actor!=='hero')scene.hero.setVisible(false);if(p.actor!=='girl')scene.girl.setVisible(false);
 $('game').dataset.previewMotion=p.motion;$('game').dataset.previewCharacter=p.kind;$('game').dataset.previewFrame=String(frame);$('game').dataset.previewVisible=String(image.visible);
 $('motion-progress').textContent=(motionLabels[p.kind]?.[p.motion]||motionLabels[p.motion]||p.motion)+' · '+(frame+1)+' / '+p.spec.frames+' · '+p.spec.fps+'fps';
}
$('motion-character').disabled=true;
$('motion-character').onchange=()=>{if(!ENEMIES[$('motion-character').value])$('field-character').value=$('motion-character').value;motionButtons();previewMotion('idle');};
$('motion-battle').onclick=()=>{previewSerial++;selectFieldCharacter();$('motion-progress').textContent='실전 전투 · 준비 완료';for(const b of $('motion-buttons').children)b.setAttribute('aria-pressed','false');};
for(const b of document.querySelectorAll('[data-direction]')){
 const release=()=>{keys.clear();model.setDirection(0);};const cancel=()=>{keys.clear();model.setDirection(0,{cancel:true});};
 b.onpointerdown=e=>{if(!ready)return;e.preventDefault();previewSerial++;fieldPreview=null;b.setPointerCapture(e.pointerId);if(model.status==='paused')pause();keys.clear();model.setDirection(Number(b.dataset.direction),{pressed:true});};
 b.onpointerup=release;b.onpointercancel=cancel;b.onlostpointercapture=()=>{if(model.direction)cancel();};
}
motionButtons();
function selectFieldCharacter(){
 if(!ready)return;previewSerial++;fieldPreview=null;$('motion-character').value=$('field-character').value;motionButtons();
 if($('field-character').value==='healer'){
  healingTrial('approach');$('healer-field-controls').hidden=false;
  $('status').textContent='의원 자동 걷기 · 소에게 시험 피해를 누르면 정지·놀람 → 급행 → 치료 · 시선은 계속 오른쪽';
 }else{restart();$('healer-field-controls').hidden=true;if(['girl','haetae'].includes($('field-character').value))$('status').textContent=($('field-character').value==='girl'?'소녀':'해태')+' 선정 모션 적용 · 전투 시작 후 방향키 이동 · Space 기술 · 게임과 동일한 피해 판정';}
 $('game').focus({preventScroll:true});
}
function previewHealing(name){if(!ready)return;$('motion-character').value='healer';$('field-character').value='healer';motionButtons();if(name==='random'){const choices=['castHeal','castHealLight','castHealBless'];name=choices[Math.floor(Math.random()*choices.length)];}previewMotion(name);}
$('field-character').onchange=selectFieldCharacter;
$('field-stage').onchange=async()=>{
 if(!ready)return;
 if(model.status==='playing')model.pause();keys.clear();model.setDirection(0,{cancel:true});ready=false;
 $('field-stage').disabled=true;$('field-character').disabled=true;
 try{
  await scene.prepareStage(Number($('field-stage').value),p=>{$('status').textContent='길 준비 중 · '+(p.phase==='prepare'?'그림 처리 '+p.prepared+'/'+p.prepareTotal:Math.round(p.percent??0)+'%');});
  ready=true;selectFieldCharacter();
 }catch(error){ready=true;$('status').textContent='길을 불러오지 못했습니다. 다시 선택해 주세요. '+error.message;}
 $('field-stage').disabled=false;$('field-character').disabled=false;
};

document.querySelectorAll('[data-healer-motion]').forEach(button=>button.onclick=()=>previewHealing(button.dataset.healerMotion));

function refreshFoes(){const current=$('foe').value;$('foe').replaceChildren();for(const type of new Set(STAGES[Number($('field-stage').value)].waves.flatMap(w=>w.types))){const option=document.createElement('option');option.value=type;option.textContent=ENEMIES[type].name;$('foe').append(option);}if([...$('foe').options].some(o=>o.value===current))$('foe').value=current;}
refreshFoes();
async function addEnemy(){if(!ready||!['playing','paused'].includes(model.status))return;const type=$('foe').value;await scene.ensurePreview(type);model.spawn(type,Math.min(model.gateX,model.x+700));$('events').textContent=ENEMIES[type].name+' 수동 추가';}
function selectedUnit(){const kind=$('field-character').value;return UNITS[kind]?kind:'cow';}
function summon(){if(!ready||model.status!=='playing')return;model.summon(selectedUnit());}
function restart(){for(const k of ['previewCharacter','previewMotion','previewFrame','previewVisible'])delete $('game').dataset[k];$('top').querySelector('b').textContent='실전 전투 필드 · '+STAGES[Number($('field-stage').value)].name;fieldPreview=null;const selected=selectedUnit(),party=DEFAULT_PARTY.includes(selected)?DEFAULT_PARTY:[DEFAULT_PARTY[0],selected,...DEFAULT_PARTY.filter(k=>!['cow','keeper'].includes(k))];model.start(Number($('field-stage').value),party,scene.vw);if(!DEFAULT_PARTY.includes(selected))model.addAlly(selected,model.x+210);model.coins=MAX_COINS;model.auto=$('auto').checked;model.drainEvents();totalDamage=0;totalHealed=0;keys.clear();scene.resetPresentation();refreshFoes();model.pause();$('pause').textContent='전투 시작';$('motion-progress').textContent='위에서 동작 선택 · 아래에서 실전 전투 시작';$('status').textContent=UNITS[selected].name+' 모션 연결 완료 · 전투 시작을 누르세요. 게임과 같은 사거리·피해 판정입니다.';lastUI=-Infinity;}
// Local scenario setup only; Journey owns treatment, damage and timing.
function summonHealer(){if(ready&&model.status==='playing')model.summon('healer');}
function damageCow(){if(!ready||model.status!=='playing')return;const cow=model.allies.find(a=>a.type==='cow'&&a.hp>0);if(cow)model.hurtAlly(cow,120,cow.x+100);}
function healingTrial(kind='heal'){
 if(!ready)return;restart();model.enemies=[];model.projectiles=[];model.wave=model.waves.length;model.auto=false;$('auto').checked=false;
 const cow=model.allies.find(a=>a.type==='cow');cow.x=model.x+UNITS.cow.formation;
 const healerIdle=kind==='idle'&&$('field-character').value==='healer';
 if(healerIdle||kind==='approach'||kind==='heal'){
  // The normal road-end destination already stops the independent party.
  // Reuse it for a stationary patient/rest test, without adding movement flags,
  // fake actions, a second animation clock or changing the production model.
  cow.x=model.roadEnd-90;model.x=model.furthest=Math.max(model.x,cow.x-scene.vw*.5);
 }
 if(kind!=='idle'||healerIdle)model.addAlly('healer',cow.x-UNITS.healer.spacing-(kind==='approach'?120:0));model.pause();if(kind==='heal')model.hurtAlly(cow,120,cow.x+100);
 if(kind==='idle'){$('pause').textContent='일시정지';$('status').textContent=healerIdle?'의원 제자리 대기 시험 · 쪼그려 앉아 쉬기 등 새 대기 모션을 아래 버튼으로 확인합니다.':'새 기본 대기 반복 중 · 방향키로 이동하면 걷기·달리기로 이어집니다. 정지하면 새 대기로 돌아오며 기존 랜덤 동작도 유지합니다.';return;}
 $('pause').textContent='일시정지';$('status').textContent='회복 모션 시험 · 소에게 시험 피해를 주고 의원의 실제 치료를 재생합니다. 전투 시험은 다시 시작으로 돌아갑니다.';
}
function pause(){if(!ready)return;model.pause();keys.clear();model.setDirection(0,{cancel:true});$('pause').textContent=model.status==='paused'?'전투 계속':'일시정지';$('status').textContent=model.status==='paused'?'전투 일시정지 · 체력과 공격 진행도 함께 멈춥니다.':'전투 중 · 실제 피해·방어·사거리 적용 · 무적 해제';}
$('heal-summon').onclick=summonHealer;$('hurt-cow').onclick=damageCow;$('heal-trial').onclick=()=>{healingTrial('approach');damageCow();};$('idle-trial').onclick=()=>healingTrial('idle');
$('pause').onclick=pause;$('summon').onclick=summon;$('spawn').onclick=addEnemy;$('reset').onclick=selectFieldCharacter;
$('clear').onclick=()=>{model.enemies=[];model.wave=model.waves.length;model.projectiles=model.projectiles.filter(p=>!p.enemy);$('events').textContent='몬스터를 모두 없앴습니다.';};
$('auto').onchange=()=>{model.auto=$('auto').checked;};
$('game').addEventListener('click',()=>$('game').focus({preventScroll:true}));
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(!['ArrowLeft','ArrowRight','Shift',' ','c','C','e','E','p','P'].includes(e.key)||!ready)return;e.preventDefault();if(e.repeat)return;keys.add(e.key);if(e.key.startsWith('Arrow'))model.setDirection(keys.has('ArrowRight')?1:keys.has('ArrowLeft')?-1:0,{pressed:true});else if(e.key===' '){if($('field-character').value==='healer')previewHealing('random');else if(['girl','haetae'].includes($('field-character').value))model.skill($('field-character').value==='girl'?'charm':'stomp');}else if(e.key==='Shift'){}else if(e.key.toLowerCase()==='c')summon();else if(e.key.toLowerCase()==='e')addEnemy();else pause();});
window.addEventListener('keyup',e=>{keys.delete(e.key);model.setDirection(keys.has('ArrowRight')?1:keys.has('ArrowLeft')?-1:0);});
window.addEventListener('blur',()=>{keys.clear();model.setDirection(0,{cancel:true});});
document.addEventListener('dragstart',e=>e.preventDefault());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&model.status==='playing'){pause();pausedByHidden=true;}else if(!document.hidden&&pausedByHidden){$('status').textContent='다른 탭을 보는 동안 전투를 멈췄습니다. 계속 버튼으로 재개하세요.';pausedByHidden=false;}});
function render(){if(!ready)return;drawMotionPreview();const reaper=model.enemies.find(e=>e.type==='reaper'),reaperImage=reaper&&scene.sprites.get('e'+reaper.id);Object.assign($('game').dataset,{reaperMotion:reaperImage?.travellerVideo?.state??'',reaperCel:reaperImage?.celKey??'',reaperVisible:String(!!reaperImage?.visible),reaperWindup:String(reaper?.windup??0),reaperHp:String(reaper?.hp??0),reaperProjectiles:String(scene.effects.filter(e=>e.type==='projectile'&&e.sourceKind==='reaper').length),reaperDepartures:String(scene.effects.filter(e=>e.type==='depart'&&e.kind==='reaper').length)});Object.assign($('game').dataset,{motionVersion:'144',worldEnd:String(model.roadEnd),monsterQuota:String(model.waves.reduce((n,w)=>n+w.types.length,0)),spawned:String(model.waves.slice(0,model.wave).reduce((n,w)=>n+w.types.length,0)),offscreenAllies:String(model.allies.filter(a=>a.hp>0&&(a.x<scene.offset||a.x>scene.offset+scene.vw)).length),offscreenEnemies:String(model.enemies.filter(e=>e.hp>0&&(e.x<scene.offset||e.x>scene.offset+scene.vw)).length),cowBodyHeight:String(BODY_HEIGHT.cow),cowMotion:[...scene.sprites.values()].find(im=>im.texture?.key?.includes('cowVideo'))?.texture.key??'',girlMotion:scene.girl?.texture.key??'',haetaeMotion:scene.hero?.texture.key??''});const now=performance.now();if(now-lastUI<120)return;lastUI=now;const kind=selectedUnit(),unit=UNITS[kind],cows=model.allies.filter(a=>a.type===kind&&a.hp>0),enemies=model.enemies.filter(e=>e.hp>0);$('hero-hp').textContent='주인공 체력 '+Math.ceil(model.hp)+' / '+MAX_HP;$('cow-count').textContent=unit.name+' '+cows.length+' / 10';$('enemy-count').textContent='적 '+enemies.length;$('damage').textContent='받은 피해 '+totalDamage.toFixed(1);$('healed').textContent='회복량 +'+totalHealed.toFixed(1);$('kills').textContent='처치 '+model.kills;if(!fieldPreview){const displayKind=$('field-character').value,actor=UNITS[displayKind]?cows[0]:null,image=actor?scene.sprites.get('a'+actor.id):displayKind==='girl'?scene.girl:displayKind==='haetae'?scene.hero:null,state=image?.travellerVideo||image?.healerVideo,name=state?.state,spec=VIDEO_MOTION[displayKind]?.[name],cel=image?.celKey?.replace(/^injured[12]__/,'');if(spec&&cel?.startsWith(spec.prefix)){const frame=Number(cel.slice(spec.prefix.length));$('motion-progress').textContent='실전 전투 · '+(motionLabels[kind]?.[name]||motionLabels[name]||name)+' · '+(frame+1)+' / '+spec.frames+' · '+spec.fps+'fps';Object.assign($('game').dataset,{battleCharacter:displayKind,battleActor:actor?'a'+actor.id:displayKind,battleMotion:name,battleFrame:String(frame)});}}const cd=Math.max(0,model.cooldowns[kind]);$('summon').disabled=model.status!=='playing'||model.atSummonLimit(kind)||cd>0||model.coins<unit.cost;$('summon').textContent=cd>0?unit.name+' 소환 '+cd.toFixed(1)+'초':unit.name+' 소환 · C';$('pause').disabled=!['playing','paused'].includes(model.status);$('heal-summon').disabled=model.status!=='playing'||model.atSummonLimit('healer')||model.cooldowns.healer>0||model.coins<UNITS.healer.cost;$('hurt-cow').disabled=model.status!=='playing'||!cows.length;if(['won','lost'].includes(model.status)){$('status').textContent=model.status==='lost'?'전투 종료 · 다시 시작으로 재시험하세요.':'전투 승리 · 다시 시작으로 재시험하세요.';}$('roster').replaceChildren(...cows.map(c=>{const card=document.createElement('div'),label=document.createElement('div'),bar=document.createElement('progress');label.textContent=unit.name+' #'+c.id+' · '+Math.ceil(c.hp)+' / '+Math.ceil(c.maxHp);bar.max=c.maxHp;bar.value=Math.max(0,c.hp);card.append(label,bar);return card;}));$('game').dataset.cows=cows.length;$('game').dataset.enemies=enemies.length;$('game').dataset.damage=totalDamage.toFixed(1);$('game').dataset.status=model.status;$('game').dataset.healed=totalHealed.toFixed(1);}
function events(list){for(const e of list){if(e.damage&&!e.enemy&&['guard','hit','hurt'].includes(e.type)){totalDamage+=e.damage;$('events').textContent=(e.kind==='cow'?'소':'아군')+' 피격 −'+e.damage.toFixed(1);}if(e.type==='heal'&&!e.enemy&&e.amount>0){totalHealed+=e.amount;$('events').textContent=(e.kind==='cow'?'소':'아군')+' 체력 회복 +'+e.amount.toFixed(1);$('status').textContent='의원 치료 중 · 공격받는 동안에도 빛나는 + + +와 회복량을 표시하며 현재 몸동작을 유지합니다. 안전하게 멈춰 있으면 새 치유 모션을 재생합니다.';}if(e.type==='notice')$('events').textContent=e.message;}}
makeGame(model,async(_unused,s)=>{scene=s;try{const idle=new Set(['cow','girl','haetae', $('field-character').value].map(k=>VIDEO_MOTION[k].idle.asset)),movement=new Set(['girl','haetae'].flatMap(k=>['walk','run'].map(n=>VIDEO_MOTION[k][n].asset)));scene.commonKeys=scene.commonKeys.filter(k=>{const f=scene.files.get(k);return !f.video||f.part===0&&idle.has(f.video)||movement.has(f.video);});await scene.prepareStage(0,p=>{$('status').textContent='게임 그림 준비 중 · '+(p.phase==='prepare'?'그림 처리 '+p.prepared+'/'+p.prepareTotal:Math.round(p.percent??0)+'%');});await prepareHealerMotions();ready=true;$('motion-character').disabled=false;motionButtons();$('field-stage').disabled=false;$('field-character').disabled=false;for(const id of['pause','spawn','clear','reset','heal-trial','idle-trial'])$(id).disabled=false;restart();}catch(e){$('status').textContent='그림 준비 실패. 페이지를 새로고침해 주세요. '+e.message;}},render,events);
