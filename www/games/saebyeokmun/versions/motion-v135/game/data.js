import {EXTRA_CHAPTERS,GATE_STYLES,BOSS_ATTACKS} from './expansion.js?v=70';
import {EXTRA_MONSTERS} from './expansion-monsters.js?v=70';
export {GATE_STYLES};
// Single source of sample tuning. All folklore-derived combat roles are game inventions.
export const ROAD=4200;
// The final world seal is separate from each wave’s authored entrance position.
export const GATE=ROAD+80;
export const START=220;
export const MAX_HP=200;
export const MAX_COINS=100;
export const ALLY_HP_SCALE=.7*1.15*1.1;
export const ALLY_OUTPUT=1.1;
export const ALLY_TYPE_LIMIT=10;
export const ALLY_TOTAL_LIMIT=50;
export const BODY_HEIGHT={king:165,prince:156,minister:165,cavalry:205,umbrella:185,mount:188,haetae:132,girl:117,keeper:133,cow:141,scholar:156,healer:165,rabbit:124,skirt:102,horse:198,reaper:202,boss:300,warden:230,ferryman:245,waterghost:180,spearman:158,archer:154,mangtae:148,shadow:140,dokkaebi:160,bulgasari:205,changgwi:180,gumiho:142,bandit:166,pirate:170,gate:350};
const CORE_AREAS=[
 {at:0,name:'몽유도원 · 달빛 산수',texture:'inwang',detailFiles:['inwang-near0-v44.webp','inwang-near1-v44.webp'],detailOverlap:160,file:'inwang-far-v44.webp',skyFile:'inwang-sky-v44.webp',cloudFile:'inwang-clouds-v44.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'nightRoad',panorama:true,roadAtlas:'mongyudowon-terrain-v54.webp',roadTiles:[[0,680],[680,1000],[1680,340],[2020,200],[2220,800],[3020,260],[3280,356],[3636,680],[4316,1000],[5316,1212],[6528,744]].map(([x,width],i)=>({frame:'path'+i,x,width,height:720,foot:500,sourceY:0,sourceHeight:720}))},
 {at:1,name:'수원 · 높은 버들숲',texture:'home1',detailFiles:[],detailOverlap:0,file:'homecoming-02-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'nightRoad',panorama:true,paintingSingle:true,paintingFoot:.68}, {at:2,name:'공주 · 금강의 기와다리',texture:'home2',detailFiles:[],detailOverlap:0,file:'homecoming-03-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'nightRoad',panorama:true,paintingSingle:true,paintingFoot:.59}, {at:3,name:'부여 · 사막의 꿈',texture:'home3',detailFiles:[],detailOverlap:0,file:'homecoming-04-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'nightRoad',panorama:true,paintingSingle:true,paintingFoot:.62}, {at:4,name:'군산 · 푸른 바닷가',texture:'home4',detailFiles:[],detailOverlap:0,file:'homecoming-05-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'water',panorama:true,paintingSingle:true,paintingFoot:.70}, {at:5,name:'전주 · 돌아오는 장터',texture:'home5',detailFiles:[],detailOverlap:0,file:'homecoming-06-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'nightRoad',panorama:true,paintingSingle:true,paintingFoot:.70}, {at:6,name:'남원 · 전쟁의 꿈',texture:'home6',detailFiles:[],detailOverlap:0,file:'homecoming-07-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'nightRoad',panorama:true,paintingSingle:true,paintingFoot:.70}, {at:7,name:'광양 · 지옥의 꿈',texture:'home7',detailFiles:[],detailOverlap:0,file:'homecoming-08-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'nightRoad',panorama:true,paintingSingle:true,paintingFoot:.70}, {at:8,name:'여수 · 끝없는 물길',texture:'home8',detailFiles:[],detailOverlap:0,file:'homecoming-09-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'water',panorama:true,paintingSingle:true,paintingFoot:.70}, {at:9,name:'순천 · 갈대늪 너머 집',texture:'home9',detailFiles:[],detailOverlap:0,file:'homecoming-10-v59.webp',moonFile:'inwang-moon-v44.webp',split:1,ground:'nightRoad',panorama:true,paintingSingle:true,paintingFoot:.70}
];
// v134 viewpoint trial: one broad painted deck, four stable presentation depths.
// Journey retains its existing horizontal combat and travel coordinates.
Object.assign(CORE_AREAS[0],{roadAtlas:null,roadFlipX:true,roadTopTrim:10,actorScale:.45,actorFloors:[380,440,500,560],cameraAnchor:.5,gateFile:'stage1-gate-isometric-v134.webp',gateOrigin:[.48,.83],gateGround:470,gateHeight:650,gateColor:0xd34e31,gateLipStart:.63,roadTiles:[{file:'stage1-isometric-road-v134.webp',x:0,width:1983,height:793,foot:500,top:300}]});
// These authored foregrounds match their own clean plates, including the sea's
// near water. Later paintings keep their original no-generic-ground protection.
for(const [i,scale,foot] of [[1,1.4,550],[2,2.4,469],[3,1.4,497],[4,1.4,566]]){
 Object.assign(CORE_AREAS[i],{file:`home${i}-background-v131.webp`,roadTiles:[{file:`home${i}-terrain-v131.webp`,x:0,width:Math.round(1942*scale),height:Math.round((i===4?809:810)*scale),foot:foot*scale}]});
}
export const AREAS=[...CORE_AREAS.slice(0,9),...EXTRA_CHAPTERS.map((s,i)=>({at:i+9,name:s.place+' · '+s.name,texture:'journey'+(i+10),detailFiles:[],detailOverlap:0,file:s.asset,skyInPainting:true,split:1,ground:s.ground,panorama:true,paintingSingle:true,paintingFoot:s.paintingFoot})),{...CORE_AREAS[9],at:39}];
for(const s of EXTRA_MONSTERS)BODY_HEIGHT[s.key]=s.height;
// One presentation size table serves every cel, wound and departure.
// The measured contact envelope below separately owns readable combat spacing.
for(const kind of Object.keys(BODY_HEIGHT))if(kind!=='gate')BODY_HEIGHT[kind]=Math.round(BODY_HEIGHT[kind]*1.4);
// User-reviewed calf size: every pose, shadow and departure uses this table.
BODY_HEIGHT.cow*=.95;
// One chosen landscape and its celestial body follow the existing simulation clock.
// The HUD and landscape read this same presentation state; there is no second clock.
export function skyState(progress,time=0,stage=0){
 const q=((Math.max(0,Number.isFinite(time)?time:0)+160)%840)/840,angle=Math.PI*q,day=STAGES[stage]?.time==='낮';
 // Exit and re-enter beyond the viewport during very long battles, without changing night/day.
 const orb={x:-.15+1.3*q,height:Math.sin(angle)};
 return {phase:day?.25:.75,night:day?0:1,dusk:0,sun:{...orb,visible:day},moon:{...orb,visible:!day},name:day?'낮':'밤'};
}
// Four distinct authored sections cover the level, including the camera beyond the gate.
// These are scenery coordinates, never a second collision or travel model.
export const ROAD_SECTIONS=['bank','bridge','causeway','approach'].map((frame,i)=>({frame,x:-650+i*1536,width:1536,height:256,foot:70}));
export const SHOT_TIME=.18;
// One overlap order for painting and equal-distance target selection. The player stays visible.
export const actorLayer=actor=>actor.id??Number.MAX_SAFE_INTEGER;
export const HERO_STANDOFF=400;
// Painted frontage in road units. Keep the legacy export name; both sides of
// contact use this one owner, including companion cels populated below.
export const ENEMY_FRONT={skirt:35,horse:70,reaper:45,boss:165,warden:80,ferryman:95,waterghost:45,mangtae:43,shadow:52,dokkaebi:46,bulgasari:85,changgwi:43,gumiho:63,bandit:45,pirate:48,gate:85};
for(const s of EXTRA_MONSTERS)ENEMY_FRONT[s.key]=s.frontage;
export const contactGap=(a,b)=>Math.abs(a.x-b.x)-(ENEMY_FRONT[a.type??'hero']??0)-(ENEMY_FRONT[b.type??'hero']??0);
export function combatPower(s){return Math.sqrt(s.hp/(1-(s.guard||0))*s.damage/s.period);}

export const PARALLAX={far:.035,middle:.34,ground:1,near:1.18};
// Keep wave HP/arrival budgets; reduce all hostile damage and restoration together.
export const ENEMY_OUTPUT=.85;
export const ENEMY_STRIKE={duration:.6,impact:.28};
export const REAPER_DEPARTURE_TIME=3.1;
export const ALLY_HIT_TIME=.42;
export const GATE_BREAK_TIME=1.7;
export function enemyDepartureFrame(p,frames=4){if(frames===2)return p<.38?0:1;return p<.16?0:p<.34?1:p<.56?2:3;}
export function reaperDepartureFrame(p){return p<.06?0:p<.17?1:p<.29?2:p<.42?3:p<.56?4:p<.70?5:p<.85?6:7;}
// Health already owns the state; these are display bands, not another injury system.
export function injuryLevel(hp,maxHp){return !Number.isFinite(hp)||!Number.isFinite(maxHp)||maxHp<=0||hp>=maxHp?0:hp>maxHp*.4?1:2;}
export function enemyAttackFrame(elapsed){return elapsed<.14?0:elapsed<ENEMY_STRIKE.impact?1:elapsed<.44?2:3;}
// Whole-body boss cels share the real walk, melee contact and hail clocks.
export function bossPose(walk,moving,action=null,windup=0,kind='boss'){
 const ability=ENEMIES[kind].ability;
 if(ENEMIES[kind].atlas){if(windup>0)return kind+'Strike'+(1-windup/ability.windup<.5?0:1);return kind+(action?'Strike':'Walk')+(action?Math.min(3,Math.floor(action.elapsed/(action.kind==='enemy'?ENEMY_STRIKE.duration:ability.duration)*4)):motionFrame(kind,walk,moving,null));}
 if(kind!=='boss'){
  if(action&&action.kind===ability.kind)return kind+'Cast'+(action.elapsed<ability.impact?1:action.elapsed<ability.impact+.2?2:3);
  if(windup>0)return kind+'Cast'+(1-windup/ability.windup<.45?0:1);
  if(action?.kind==='enemy')return kind+'Strike'+enemyAttackFrame(action.elapsed);
  return kind+'Walk'+motionFrame(kind,walk,moving,null);
 }
 if(action?.kind==='hail')return 'bossCast'+(action.elapsed<ENEMIES.boss.ability.impact?2:3);
 if(windup>0){const p=1-windup/ENEMIES.boss.ability.windup;return 'bossCast'+(p<.2?0:p<.55?1:2);}
 if(action?.kind==='enemy'){const t=action.elapsed;return 'bossStrike'+(t<.08?0:t<.18?1:t<ENEMY_STRIKE.impact?2:t<.38?3:t<.48?4:5);}
 return 'bossWalk'+motionFrame('boss',walk,moving,null);
}

export const TEST_MODE=false;
// Conditional formations live outside the three equipped hero skills; the existing clock/cooldowns own them.
export const TEAM_SKILLS={
 arrowRain:{name:'궁병 화살비',unit:'archer',required:5,cost:0,cooldown:40,icon:'archer1',castTime:5.5,volleys:5,firstRelease:.7,volleyInterval:.6,description:'궁병 5명이 후열에 모여 5번 사격합니다. 다섯 번째 화살에 실제로 맞은 화면 안의 적은 즉사하고 궁병은 사격한 위치에서 전투를 계속합니다.'},
 prayer:{name:'의녀 합동기도',unit:'healer',required:5,cost:0,cooldown:50,icon:'healerPray1',castTime:2.5,description:'의녀 5명이 현재 위치에서 기도해 주인공과 살아 있는 동료 전원을 한 번에 완전히 치료하고 일반 치료를 재개합니다.'},
 cavalryCharge:{name:'기병 일제돌진',unit:'cavalry',required:5,cost:0,cooldown:45,icon:'cavalry1',castTime:3.2,description:'기병 5명이 전방에 줄을 맞춰 돌진하고 같은 기병들이 돌아와 전투를 계속합니다.'}
};
export const DEFAULT_PARTY=['cow','keeper','rabbit','scholar','healer'];
// Rebuilt companions are available from first play; girl/haetae are the base heroes.
export const STARTER_PARTY=['cow','healer'];
// One reward schedule shared by settlement, collection UI and stage tuning.
export const STAGE_REWARDS=['keeper','rabbit','healer','spearman','archer','scholar','prince','minister','cavalry','king'];
export function validParty(value){return Array.isArray(value)&&value.length>=1&&value.length<=5&&new Set(value).size===value.length&&value.every(k=>Object.hasOwn(UNITS,k));}
// Apply companion tuning once at its owner, including healing and trained attacks.
// Exact multipliers keep the authored enemy budget independent of companion buffs.
export const UNITS=Object.fromEntries(Object.entries({
 cow:{price:0,name:'누렁소',role:'방어 · 몸으로 버티기',hp:245,speed:74/1.44,range:95,damage:12,period:1.35,cost:30,cooldown:4,formation:305,spacing:0,guard:.6,weapon:'horn'},
 keeper:{price:0,name:'돌팔매 도령',role:'공격 · 짱돌 던지기',hp:60,speed:80,range:275,damage:17,period:1.15,cost:18,cooldown:3.5,formation:125,spacing:0,guard:0,weapon:'stone',upgrade:{price:45,stats:{name:'먹붓 도령',role:'공격 · 먹붓 날리기',damage:28,range:295,weapon:'ink'}}},
 rabbit:{price:0,name:'달토끼',role:'공격 · 씨앗 사격',hp:48,speed:72,range:185,damage:24,period:1.35,cost:24,cooldown:4,formation:215,spacing:0,guard:0,weapon:'seed'},
 scholar:{price:0,name:'선비',role:'지원 · 붓과 부채로 봉인',hp:56,speed:68,range:540,damage:16,period:2.1,cost:34,cooldown:5,formation:-140,spacing:0,guard:0,weapon:'seal'},
 spearman:{name:'조선 창병',role:'조력 · 전방 창 찌르기',price:80,hp:130,speed:74,range:120,damage:10,period:1.8,cost:26,cooldown:4.5,formation:270,spacing:0,guard:.15,weapon:'spear'},
 archer:{name:'조선 궁병',role:'조력 · 후열 화살',price:100,hp:72,speed:70,range:420,damage:10,period:2.3,cost:24,cooldown:4.5,formation:20,spacing:0,guard:0,weapon:'arrow'},
 king:{name:'조선 왕',role:'지원 · 어보 봉인',price:260,hp:95,speed:65,range:380,damage:20,period:2.4,cost:38,cooldown:5.5,formation:0,spacing:0,guard:.1,weapon:'seal'},
 prince:{name:'세자',role:'공격 · 활 사격',price:180,hp:65,speed:82,range:330,damage:22,period:1.5,cost:30,cooldown:4.5,formation:90,spacing:0,guard:0,weapon:'arrow'},
 minister:{name:'영의정',role:'지원 · 교지 봉인',price:220,hp:85,speed:62,range:500,damage:14,period:2.2,cost:32,cooldown:5,formation:-80,spacing:0,guard:.05,weapon:'seal'},
 cavalry:{name:'기마 무관',role:'돌파 · 기마 검격',price:240,hp:170,speed:90,range:100,damage:18,period:1.7,cost:40,cooldown:6,formation:295,spacing:0,guard:.3,weapon:'sword'},
 healer:{price:0,name:'약방 의원',role:'회복 · 뒤에서 치유 시전',hp:62,speed:115,range:240,search:980,damage:0,heal:14,period:3.4,cost:36,cooldown:6,formation:-230,spacing:170,guard:0,weapon:'medicine'}
}).map(([kind,stats])=>[kind,{...stats,hp:stats.hp*ALLY_HP_SCALE,damage:stats.damage*ALLY_OUTPUT,...(stats.heal?{heal:stats.heal*ALLY_OUTPUT}:{}),...(stats.upgrade?{upgrade:{...stats.upgrade,stats:{...stats.upgrade.stats,damage:stats.upgrade.stats.damage*ALLY_OUTPUT}}}:{})}]));
export function unitStats(type,keeperRank=0){const s=UNITS[type];return type==='keeper'&&keeperRank?{...s,...s.upgrade.stats}:s;}
// One shared party clearance preserves the authored differences between
// firing slots. Visual combat review selects90: close without hiding faces.
// Using the complete horn/hoof envelope (141) left an excessive visible gap.
ENEMY_FRONT.hero=90;
for(const kind of Object.keys(UNITS))ENEMY_FRONT[kind]=ENEMY_FRONT.hero;
// The ox uses the supplied video: 48 walk, 48 run and 48 retimed attack cels.
// Its 74-unit stride / 1.44s cadence stays coupled to actual travel; other bodies stay four cels.
export const MOTION={dokkaebi:{walkFps:5,walkFrames:4},bulgasari:{walkFps:5,walkFrames:4},changgwi:{walkFps:5,walkFrames:4},gumiho:{walkFps:5,walkFrames:4},bandit:{walkFps:5,walkFrames:4},pirate:{walkFps:5,walkFrames:4},king:{duration:.9,impact:.45,walkFps:5,walkFrames:4},prince:{duration:.8,impact:.4,walkFps:6,walkFrames:4},minister:{duration:1,impact:.5,walkFps:5,walkFrames:4},cavalry:{duration:.8,impact:.4,walkFps:6,walkFrames:4},haetae:{duration:.64,impact:.32,walkFps:7,walkFrames:4},rabbit:{duration:.64,impact:.32,walkFps:7,walkFrames:4},girl:{walkFps:7,walkFrames:4},keeper:{duration:.64,impact:.32,walkFps:7,walkFrames:4},cow:{duration:.72,impact:.36,angerFrames:98,angerFps:48,walkFps:48/1.44,walkFrames:48,runFps:48/1.05,runFrames:48,attackFrames:48,idleFrame:96},scholar:{duration:.8,impact:.4,walkFps:6,walkFrames:4},healer:{duration:3.2,impact:1.45,notice:29/24,walkFps:8,walkFrames:4},warden:{walkFps:4,walkFrames:4},ferryman:{walkFps:4,walkFrames:4},waterghost:{walkFps:4,walkFrames:4},spearman:{duration:.8,impact:.4,walkFps:5,walkFrames:4},archer:{duration:1,impact:.5,walkFps:5,walkFrames:4},mangtae:{walkFps:6,walkFrames:4},shadow:{walkFps:7,walkFrames:4},skirt:{walkFps:106/72*4,walkFrames:4},horse:{walkFps:66/94*4,walkFrames:4},reaper:{walkFps:58/78*4,walkFrames:4},boss:{walkFps:16/40*6,walkFrames:6,idleFrame:0}};
export function motionFrame(kind,walk,moving,action){
 const s=MOTION[kind],walkFrames=s.walkFrames||4,attackFrames=s.attackFrames||4;
 return action?walkFrames+Math.min(attackFrames-1,Math.floor(action.elapsed/s.duration*attackFrames)):(moving||walk>0)?Math.floor(walk*s.walkFps)%walkFrames:(s.idleFrame??1);
}
// Idle illustrations use the existing game clock, never shift the actor's feet.
export function healerPose(walk,moving,action,time=0){
 if(action?.kind==='healer'&&(!action.phase||action.phase==='treat'))return moving?'healerCareWalk'+Math.floor(walk*MOTION.healer.walkFps)%4:'healer'+motionFrame('healer',walk,0,action);
 return moving?'healer'+motionFrame('healer',walk,moving,null):'healerIdle'+Math.floor(time/1.15)%4;
}
// Existing simulation time drives whole-body idle cels; moving resumes distance-based walking.
export function travellerIdleFrame(kind,elapsed,stage=0){
 if(elapsed<2)return null;
 const cycle=Math.floor((elapsed-2)/7),phase=(elapsed-2)%7;
 if(phase>=3)return 0;
 const row=kind==='girl'?cycle%3:AREAS[stage]?.ground==='water'?2:cycle%2;
 const cel=phase<.55?0:phase<1.1?1:phase<2.25?2:3;
 return row*4+cel;
}
export const COMPANIONS=[
 ...['king','prince','minister','cavalry'].map(k=>({name:UNITS[k].name,asset:k,tag:UNITS[k].role,motion:true,text:'메인 동료 편성에서 선택할 수 있어요. 구매 전에도 테스트 편성으로 체험할 수 있습니다.',counter:'구매 '+UNITS[k].price+' · 전투 소환 '+UNITS[k].cost})),
 {name:'조선 창병',asset:'spearman',tag:'한양 · 자동 합류 조력자',motion:true,text:'두 번째 무리와 만날 때 한 명만 합류합니다. 전방에서 창으로 요괴를 찌르며, 같은 여정에서 쓰러져도 다시 나오지 않습니다.',counter:'2스테이지 자동 합류 1명 · 직접 편성 가능'},
 {name:'조선 궁병',asset:'archer',tag:'한양 · 자동 합류 조력자',motion:true,text:'네 번째 무리와 만날 때 한 명만 합류합니다. 후열에서 화살로 요괴를 공격하고, 같은 여정에서 쓰러져도 다시 나오지 않습니다.',counter:'2스테이지 자동 합류 1명 · 직접 편성 가능'},
 {name:'여행자와 해태',asset:'haetae',tag:'주인공 · 탑승과 합동기',text:'평소에는 나란히 걷습니다. 돌진 필살기를 쓰면 아이가 해태에 올라타 앞길을 뚫고 다시 내려옵니다.',counter:'출발 전 필살기 편성 · Q / E / R 세 자리',motion:true},
 {name:'누렁소',asset:'cow',tag:'방어 · 튼튼한 앞줄',text:'넓은 몸과 뿔로 앞줄을 지킵니다. 같은 종류는 앞줄을 함께 쓰며, 겹쳐 있어도 각각 뿔로 밀어붙입니다. 정면 피해 60% 감소, 우박에는 취약합니다.',counter:'체력 '+Math.round(UNITS.cow.hp)+' · 엽전 30 · 정면 방어',motion:true},
 {name:'돌팔매 도령',asset:'keeper',tag:'공격 · 짱돌에서 먹붓으로',text:'처음에는 주머니에서 짱돌을 꺼내 던집니다. 설정의 도령 수련에 엽전 45를 쓰면 옷과 무기가 바뀌어 먹붓 공격을 합니다.',counter:'소환 18 · 수련 45 · 공격 '+UNITS.keeper.damage.toFixed(1)+' → '+UNITS.keeper.upgrade.stats.damage.toFixed(1),motion:true},
 {name:'달토끼',asset:'rabbit',tag:'공격 · 씨앗 사격',text:'대나무 통으로 뒤에서 씨앗탄을 쏩니다. 낮은 귀물에는 빗나가므로 누렁소와 도령이 길을 열어줘야 합니다.',counter:'체력 '+Math.round(UNITS.rabbit.hp)+' · 공격 '+UNITS.rabbit.damage.toFixed(1)+' · 소환 24',motion:true},
 {name:'선비',asset:'scholar',tag:'지원 · 붓으로 술법 봉인',text:'사거리에 먼저 들어온 상대를 노립니다. 갓과 망건을 갖춘 조선 선비. 부채를 펼치고 붓으로 쓴 봉인이 잠깐 기절시키고 적의 술법과 공격 준비를 끊습니다.',counter:'소환 34 · 짧은 봉인 · 후열 지원',motion:true},
 {name:'약방 의원',asset:'healer',tag:'회복 · 약통을 멘 성인 여성 의원',text:'약통을 메고 동행합니다. 움직이는 동료도 따라가며 붕대를 감습니다. 치료할 동료가 없으면 다른 동료 뒤에서 앞으로 걷고, 다친 동료를 발견하면 뛰어가 치료합니다. 기다리는 동안 땀을 닦거나 약재를 정리합니다. 사망한 동료는 되살리지 못합니다.',counter:'소환 36 · 회복 '+UNITS.healer.heal.toFixed(1)+' · 치료 간격 3.4초',motion:true}
];
for(const s of EXTRA_MONSTERS)MOTION[s.key]={walkFps:6,walkFrames:4};
const addedBosses=EXTRA_MONSTERS.filter(s=>s.boss);
const addedEnemies=Object.fromEntries(EXTRA_MONSTERS.map((s,i)=>{
 const role=s.boss?'boss':s.role,attack=BOSS_ATTACKS[[1,0,2,3,4,5,6,10,8,9,7,11][addedBosses.indexOf(s)]];
 const ability=role==='boss'?{...attack,initial:3,cooldown:7+i%3,windup:2.2,range:attack.range??900,damage:20,splash:13,impact:attack.impacts[0],duration:attack.impacts.at(-1)+.6}:role==='charge'?{initial:4.5,cooldown:6,windup:1.7,range:350,damage:23}:role==='heal'?{initial:5,cooldown:8,windup:1.7,range:570,heal:15}:undefined;
 return[s.key,{name:s.name,hp:s.boss?1800:85+i%5*22,speed:s.boss?22:role==='charge'?88:role==='ranged'?58:62+i%4*7,range:role==='ranged'||role==='heal'?290:s.boss?150:75,damage:s.boss?15:9+i%4,period:s.boss?1.7:1.4+i%3*.15,reward:s.boss?44:12+i%5,boss:s.boss,behavior:role,atlas:s.atlas,atlasGroup:s.atlasGroup,atlasGroups:s.atlasGroups,atlasLayout:s.atlasLayout,description:s.description,theme:s.theme,ability}];
}));
export const ENEMIES={...addedEnemies,
 dokkaebi:{name:'도깨비',hp:105,speed:70,range:72,damage:9,period:1.7,reward:12,atlas:'folklore-dokkaebi-v59.webp',atlasLayout:{x:[0,350/1448,685/1448,1080/1448,1],y:[0,420/1086,780/1086,1]}},
 bulgasari:{name:'불가살이',hp:300,speed:38,range:90,damage:16,period:2.1,reward:23,atlas:'folklore-bulgasari-v59.webp'},
 changgwi:{name:'창귀',hp:85,speed:82,range:145,damage:10,period:1.8,reward:14,atlas:'folklore-changgwi-v59.webp',atlasLayout:{x:[0,.25,.5,.75,1],y:[0,395/1086,745/1086,1]}},
 gumiho:{name:'구미호',hp:160,speed:91,range:80,damage:12,period:1.65,reward:18,atlas:'folklore-gumiho-v59.webp',atlasLayout:{x:[0,362/1448,724/1448,1110/1448,1],y:[0,1/3,2/3,1]}},
 bandit:{name:'산적',hp:125,speed:65,range:78,damage:10,period:1.6,reward:13,atlas:'folklore-bandit-v59.webp',atlasLayout:{x:[0,.25,.5,.75,1],y:[0,400/1086,755/1086,1]}},
 pirate:{name:'수적',hp:140,speed:68,range:95,damage:11,period:1.7,reward:14,atlas:'folklore-pirate-v59.webp'},
 gate:{name:'길을 막는 봉인',hp:360,speed:0,range:0,damage:0,period:Infinity,reward:0,stationary:true},
 skirt:{name:'지하지인',hp:58,speed:106,range:45,damage:7,period:1.15,reward:9},
 horse:{name:'갓 쓴 말',hp:155,speed:66,range:65,damage:12,period:1.5,reward:15,ability:{initial:4.5,cooldown:6,windup:1.7,range:350,damage:23}},
 reaper:{name:'저승사자',hp:120,speed:58,range:290,damage:8,period:2,reward:18,ability:{initial:5,cooldown:8,windup:1.7,range:570,heal:15}},
 boss:{name:'강철',boss:true,hp:1900,speed:16,stopAt:ROAD-180,range:140,damage:14,period:1.4,reward:40,ability:{kind:'hail',initial:3,cooldown:9,windup:2.6,range:720,damage:24,splash:15,impact:.7,duration:1.15}},
 warden:{name:'성곽 수문장',boss:true,hp:1750,speed:22,stopAt:ROAD-200,range:135,damage:16,period:1.8,reward:44,ability:{kind:'quake',initial:3,cooldown:7,windup:1.8,range:650,damage:19,splash:13,impact:.75,duration:1.25}},
 ferryman:{name:'망각의 나루지기',boss:true,hp:1650,speed:20,stopAt:ROAD-200,range:200,damage:12,period:1.6,reward:48,ability:{kind:'tide',initial:4,cooldown:8,windup:2.1,range:920,damage:22,splash:12,impact:.85,duration:1.45}},
 mangtae:{name:'망태 요괴',hp:95,speed:78,range:68,damage:8,period:1.4,reward:11,departureFrames:2},
 shadow:{name:'그림자 짐승',hp:130,speed:98,range:58,damage:10,period:1.6,reward:14,departureFrames:2},
 waterghost:{name:'물귀신',hp:105,speed:72,range:155,damage:9,period:1.5,reward:13}

};
export const isBoss=kind=>!!ENEMIES[kind]?.boss;
export const SKILLS={
 charm:{name:'날림부적',cost:12,cooldown:3.2,icon:'iconCharm',role:'봉인',description:'저승사자를 먼저 겨냥해 술법을 끊어요.'},
 stomp:{name:'합동 발구름',cost:20,cooldown:7,icon:'iconStomp',role:'제압',description:'가까운 적을 밀고 돌진 준비를 끊어요.'},
 rush:{name:'해태 타고 돌진',cost:32,cooldown:12,icon:'mount1',role:'돌파',description:'잠깐 해태에 올라타 돌진하며 길을 열어요.'},
 shelter:{name:'비막이',cost:16,cooldown:11,icon:'umbrella3',role:'보호',description:'해태에 올라 우산을 전방 45도로 펼쳐요. 6초 동안 앞쪽 공격과 우박을 막고, 뒤쪽 공격은 막지 못해요.'},
 waterWard:{name:'물의 수호막',cost:16,cooldown:11,radius:340,icon:'waterWard',role:'범위 보호',description:'해태가 넓은 물 보호막을 펼쳐 6초 동안 안에 있는 동료를 지켜요. 비막이와 따로 사용할 수 있어요.'},
 mend:{name:'숨 돌리기',cost:30,cooldown:18,icon:'iconSound',role:'회복',description:'행렬의 기운 45, 동료 체력 15를 회복해요.'}
};
export const DEFAULT_LOADOUT=['charm','rush','shelter'];
export function validLoadout(value){return Array.isArray(value)&&value.length===3&&new Set(value).size===3&&value.every(key=>Object.hasOwn(SKILLS,key));}
export const WAVES=[
 {x:START,types:['skirt','skirt'],message:'집으로 가는 이정표가 가려졌어요. 누렁소와 도령을 준비해요.'},
 {x:960,types:['horse','skirt','skirt'],message:'말이 앞발을 들면 돌진! 발구름으로 끊어 주세요.'},
 {x:1600,types:['reaper','horse','skirt'],message:'장부를 펴는 저승사자에게 날림부적을 보내요.'},
 {x:2260,types:['horse','skirt','skirt','reaper'],message:'동료를 번갈아 불러 길을 열어요.'},
 {x:2960,types:['horse','horse','skirt'],message:'먹구름이 가까워졌어요. 비막이를 남겨 두세요.'},
 {x:3320,types:['boss','skirt','skirt'],message:'강철이 길을 막았어요. 우박 예고에 비막이!'}
];
// Campaign and battle share these authored stage definitions. No second wave scheduler.
const CORE_STAGES=[
 {name:'손을 놓친 달빛길',place:'한양',time:'밤',mapX:40.7,mapY:55.8,subtitle:'1장 · 집을 기억하는 아이',brief:'장터에서 부모님의 손을 놓쳤다. 몽유도원 같은 산수 속에서 해태와 동료를 만나, 귀물이 가린 첫 이정표를 되찾는다.',clue:'돌등 아래 남쪽을 가리키는 작은 표식. 부모님이 향하던 고향은 남쪽이었다.',hint:'집으로 가는 이정표가 가려졌어요. 함께 앞길을 열어요.',encounters:[['dokkaebi','skirt','mangtae'],['bandit','horse','shadow'],['reaper','dokkaebi','shadow'],['warden','mangtae']]},
 {name:'높은 버들가지 아래',place:'수원',time:'낮',mapX:41.3,mapY:58.4,subtitle:'2장 · 숲이 알려 준 방향',brief:'머리 위로 길게 늘어진 버들숲. 길을 막는 산적과 장난꾸러기 도깨비를 지나며 도움을 주는 조선 군사들을 만난다.',clue:'“금강의 다리를 건너면 고향길로 이어진단다.” 창병이 다음 길을 알려 주었다.',hint:'버들가지 아래 길을 막는 산적이 보여요.',encounters:[['dokkaebi','bandit'],['mangtae','shadow'],['bandit','dokkaebi'],['warden']]},
 {name:'금강의 기와 나무다리',place:'공주',time:'밤',mapX:40.5,mapY:64.2,subtitle:'3장 · 강을 건너는 약속',brief:'기와 지붕을 얹은 나무다리를 건너 금강 너머로 간다. 나루를 빼앗은 수적과 귀물이 다리의 등불을 가리고 있다.',clue:'강 건너 등롱의 종이에 부여로 가는 길이 그려져 있었다.',hint:'수적이 다리를 막아요. 나루의 등불을 되찾아요.',encounters:[['pirate','dokkaebi'],['pirate','waterghost'],['reaper','pirate'],['ferryman','pirate']]},
 {name:'모래로 덮인 이정표',place:'부여',time:'밤',mapX:38.7,mapY:66.2,subtitle:'4장 · 사막의 꿈',brief:'두려움이 익숙한 길을 사막처럼 바꾸었다. 조선의 실제 사막이 아닌 아이의 꿈. 구미호가 보여 주는 가짜 집 불빛을 지나 진짜 표식을 찾는다.',clue:'모래가 걷히자 바다 냄새가 났다. 다음 표식은 군산의 포구를 가리켰다.',hint:'이곳은 사막의 꿈이에요. 가짜 집 불빛에 흔들리지 말아요.',encounters:[['gumiho','bandit'],['gumiho','shadow'],['changgwi','gumiho'],['boss','gumiho']]},
 {name:'하얀 파문과 푸른 바다',place:'군산',time:'밤',mapX:35.8,mapY:69.1,subtitle:'5장 · 바닷가의 발자국',brief:'파랑과 흰색으로 열린 바닷가. 발을 디딜 때 생기는 하얀 파문을 따라 포구를 지나간다. 물길을 막는 수적과 물귀신을 물리친다.',clue:'포구의 노인이 전주 장터에 부모님을 닮은 사람을 보았다고 말했다.',hint:'하얀 파문을 따라 걸어요. 물길에도 동료가 함께해요.',encounters:[['pirate','waterghost'],['waterghost','dokkaebi'],['pirate','waterghost','reaper'],['ferryman','waterghost']]},
 {name:'장터에 남은 온기',place:'전주',time:'밤',mapX:41.8,mapY:70.8,subtitle:'6장 · 익숙한 등롱',brief:'낡은 마을의 등롱 사이로 수풀길이 이어진다. 쇠붙이에 이끌린 불가살이가 길을 가로막았다. 집과 닮은 따뜻한 빛을 기억하며 앞으로 간다.',clue:'찻집 주인이 같은 길을 간 가족을 기억했다. 남원의 고개를 넘어가 보라 했다.',hint:'쇠를 먹는 불가살이가 길을 막았어요. 앞줄을 지켜요.',encounters:[['bandit','dokkaebi'],['bulgasari','bandit'],['bulgasari','changgwi'],['warden','bulgasari']]},
 {name:'깃발만 남은 들판',place:'남원',time:'밤',mapX:46.5,mapY:74.8,subtitle:'7장 · 전쟁의 꿈',brief:'버려진 깃발과 쇠붙이 사이로 길이 이어진다. 실제 전쟁의 복원이 아닌 두려운 꿈. 불가살이와 창귀가 가린 고개를 넘어야 한다.',clue:'흩어진 깃발 사이에서 부모님이 매던 것과 같은 매듭을 찾았다.',hint:'전쟁의 꿈 속에서도 집으로 가는 방향을 놓치지 말아요.',encounters:[['changgwi','bulgasari'],['bandit','bulgasari'],['changgwi','reaper'],['warden','bulgasari']]},
 {name:'붉은 안개 너머',place:'광양',time:'밤',mapX:53,mapY:78.9,subtitle:'8장 · 지옥의 꿈',brief:'붉은 안개와 타오르는 듯한 봉우리. 지옥은 실제 지역이 아닌 아이의 악몽이다. 창귀가 만든 두려움을 걷어 내고 길을 되찾는다.',clue:'붉은 안개 뒤에서 바다에 비친 고향집 불빛이 보였다. 여수 쪽 물길이 남아 있었다.',hint:'지옥의 꿈이에요. 붉은 안개를 지나 진짜 길을 찾아요.',encounters:[['changgwi','reaper'],['gumiho','changgwi'],['bulgasari','reaper'],['boss','changgwi']]},
 {name:'끝없는 물 위를 걷다',place:'여수',time:'밤',mapX:54.4,mapY:81.8,subtitle:'9장 · 물길의 꿈',brief:'땅도 다리도 없는 끝없는 푸른 수면. 발밑의 하얀 파문만 길을 보여 준다. 수적과 구미호의 환영을 지나, 순천으로 돌아가는 등불을 찾는다.',clue:'물결 위의 빛이 갈대숲으로 이어졌다. 집은 이제 멀지 않다.',hint:'끝없는 물 위에서도 발밑 파문이 길을 보여 줘요.',encounters:[['pirate','gumiho'],['waterghost','pirate'],['gumiho','waterghost'],['ferryman','gumiho']]},
 {name:'갈대늪 너머, 집',place:'순천',time:'밤',mapX:50.7,mapY:79,subtitle:'10장 · 돌아갈 곳',brief:'갈대늪 너머 작은 집의 따뜻한 불빛. 마지막 환영을 걷어 내고 부모님의 품으로 돌아간다. 아이와 동료가 되찾은 길의 끝이다.',clue:'집에 도착했다. 부모님의 손을 다시 꼭 잡았다. 길을 잃어도, 함께라면 돌아올 수 있다.',hint:'갈대 너머 집 불빛이 보여요. 마지막 길을 함께 열어요.',encounters:[['gumiho','dokkaebi'],['changgwi','gumiho'],['dokkaebi','bulgasari'],['boss','gumiho']]}
].map(({encounters,...stage},i)=>({...stage,roadEnd:1800,enemySpeedScale:.8,gateHp:260+Math.min(i,5)*18,waves:encounters.map((types,j)=>({...WAVES[j],types,x:[START,600,980,1380][j],balanceIndex:j,helper:i===1&&j===1?'spearman':i===1&&j===3?'archer':null,message:i===1&&j===1?'창병이 금강으로 가는 길을 알려 주며 합류했어요.':i===1&&j===3?'궁병도 동행해요. 귀물을 지나 봉인을 열어요.':j===3?'길을 막는 큰 귀물이에요. 비막이와 동료를 준비해요!':stage.hint}))}));
// Region assignments connect the same bestiary to its landscape; every family has a home.
const stageFamilies=[['a07','a02'],['a02'],['b05'],['c04'],['b04'],['a04'],['c01'],['c02','c05','c07'],['b04'],['a05'],['a01'],['a07'],['b07'],['b07'],['a04'],['a01'],['a05'],['b05'],['a02'],['b02'],['b02'],['b04'],['b02'],['a08'],['b05'],['a08'],['c05'],['a03'],['c01'],['c03'],['a06'],['a06'],['c06'],['a05'],['b03'],['c04'],['a03'],['c05','c02','c07'],['b01'],['b01','b06']];
export const STAGES=[...CORE_STAGES.slice(0,9),...EXTRA_CHAPTERS,CORE_STAGES[9]].map((stage,i)=>{
 const family=EXTRA_MONSTERS.filter(s=>stageFamilies[i].includes(s.family)),ordinary=[...new Set([...family.filter(s=>!s.boss).map(s=>s.key),...(stage.waves?.flatMap(w=>w.types).filter(k=>!isBoss(k))||[])])];
 const fallback=stage.waves?.slice(0,3).map(w=>w.types)||[['dokkaebi','bandit'],['pirate','waterghost'],['changgwi','gumiho']];
 const boss=family.find(s=>s.boss)?.key||addedBosses[i%Math.max(1,addedBosses.length)]?.key||['boss','warden','ferryman'][i%3];
 const endTypes=stage.waves?.at(-1).types||[boss,ordinary.at(-1)||'shadow'];
 const roadEnd=i<5?[3300,6000,6900,7200,8400][i]:i<10?1500+i*150:stage.waves?3600+i%5*480:stage.roadEnd;
 // A bounded stream of four keeps the requested total without spawning a crowd.
 // The final boss is included; the exit gate is scenery, not a monster quota.
 const total=i<5?50+i*10:null,count=total?Math.ceil((total-1)/4)+1:i<10?3+Math.ceil(i/2):2*Math.max(6+i%4,Math.ceil(ordinary.length/2)+1);
 const finale=[...new Set([...endTypes,...family.filter(s=>s.boss).map(s=>s.key)])];
 const waves=Array.from({length:count},(_,j)=>({x:Math.round(START+j*(roadEnd-START-420)/(count-1)),types:i<10?(j===count-1?[endTypes.find(isBoss)||boss]:Array.from({length:total?Math.min(4,total-1-j*4):Math.min(2+Math.floor(i/3),4)},(_,n)=>(stage.waves?.[j%3].types.filter(k=>!isBoss(k))||fallback[j%fallback.length])[n%(stage.waves?.[j%3].types.filter(k=>!isBoss(k)).length||fallback[j%fallback.length].length)])):j===count-1?finale:ordinary.length?Array.from({length:4},(_,n)=>ordinary[(j*4+n)%ordinary.length]):fallback[j%fallback.length],balanceIndex:j===count-1?3:total?Math.min(2,Math.floor(j*3/(count-1))):Math.min(j,4),helper:i===1&&j===1?'spearman':i===1&&j===3?'archer':null,message:j===count-1?'지옥문 안에서 큰 귀물이 나와요. 예고를 살펴 함께 막아요.':stage.hint}));
 // The short observer route covers every regional identity, not just first/last waves.
 const tourEnd=980,tourTypes=[...new Set([...ordinary,...finale.filter(k=>!isBoss(k))])],tourGroups=Array.from({length:Math.ceil(tourTypes.length/4)},(_,j)=>tourTypes.slice(j*4,j*4+4));
 tourGroups.push(finale.filter(isBoss));
 const tourWaves=tourGroups.map((types,j)=>({...waves[Math.min(j,waves.length-1)],types,x:Math.round(START+j*(tourEnd-START-320)/(tourGroups.length-1)),balanceIndex:j===tourGroups.length-1?3:Math.min(j,4)}));
 return{...stage,deployment:i<5?{initialWaves:3,interval:6,limit:12}:undefined,reward:STAGE_REWARDS[i]||null,pressure:i<10?.40+i*.045:1,subtitle:stage.subtitle.replace(/^\d+장/,i+1+'장'),roadEnd,enemySpeedScale:.8,gateHp:i<10?100+i*20:300+i%6*24,waves,gateStyle:i%GATE_STYLES.length,tour:{roadEnd:tourEnd,waves:tourWaves},act:Math.floor(i/10)};
});

// Stage definitions own travel bounds; previews, HUD and simulation share these derived coordinates.
export const stageRoadEnd=stage=>STAGES[stage]?.roadEnd??ROAD;
export const stageGateX=stage=>stageRoadEnd(stage)+(GATE-ROAD);

// Preserve the authored enemy budget when companion HP or output changes. Never scale to the live party.
// HP and sustained output (including telegraphed abilities) scale together.
export const BALANCE_REFERENCE=[
 {party:['cow','cow','keeper','keeper'],rank:0},
 {party:['cow','cow','keeper','keeper','rabbit'],rank:0},
 {party:['cow','cow','keeper','keeper','rabbit','scholar'],rank:0},
 {party:['cow','cow','keeper','keeper','rabbit','rabbit','scholar'],rank:0},
 {party:['cow','cow','keeper','keeper','rabbit','rabbit','scholar'],rank:1},
 {party:['cow','cow','keeper','keeper','rabbit','rabbit','scholar'],rank:1}
];
export function waveBalance(index,stage=0,routeWaves=null){
 const waves=routeWaves||STAGES[stage]?.waves||WAVES,i=Math.max(0,Math.min(waves.length-1,index)),authored=BALANCE_REFERENCE[waves[i].balanceIndex??i],available=['cow',...STAGE_REWARDS.slice(0,stage)],ref=stage<10?{party:authored.party.map(k=>available.includes(k)?k:'cow'),rank:0}:authored;
 const budget=ref.party.reduce((n,k)=>n+UNITS[k].cost,0)+(ref.rank?UNITS.keeper.upgrade.price:0);
 const allies=ref.party.reduce((n,k)=>n+combatPower(unitStats(k,ref.rank)),0);
 const enemyStats=waves[i].types.map(k=>{
  const s=ENEMIES[k],a=s.ability;
  if(!a)return s;
  const cycle=a.cooldown+a.windup+(a.duration||0),hits=a.impacts?.length??1,output=((a.damage||0)+(a.splash||0)*ref.party.length)*hits+(a.heal||0)*waves[i].types.length;
  return {...s,damage:s.damage*a.cooldown/cycle+output*s.period/cycle};
 });
 const baseEnemy=enemyStats.reduce((n,s)=>n+combatPower(s),0),pressure=STAGES[stage]?.pressure??1,scale=allies/Math.sqrt(ALLY_HP_SCALE*ALLY_OUTPUT)/baseEnemy/1.03*pressure;
 const enemies=baseEnemy*scale*Math.sqrt(ENEMY_OUTPUT);
 return {budget,allies,enemies,scale,enemyStats,pressure,reference:ref,advantage:allies/enemies-1};
}
export const CODEX=[
 ...EXTRA_MONSTERS.map(s=>({name:s.name,tag:s.boss?'지옥문 보스 · '+ENEMIES[s.key].ability.name:'귀물 · '+(s.baseFolklore??s.theme),asset:s.key,motion:true,text:s.description+' 꿈속의 문에 홀려 집으로 가는 길을 막습니다. 복장·무기·전투 능력은 게임을 위한 각색입니다.',counter:s.boss?'예고 범위를 살피고 비막이로 막아요.':s.role==='heal'?'날림부적으로 회복을 끊어요.':s.role==='ranged'?'튼튼한 앞줄과 원거리 동료로 대응해요.':'동료 전선 · 발구름',source:s.sourceUrl?'전승 근거: '+s.sourceLabel:s.source,sourceUrl:s.sourceUrl})),
 {name:'도깨비',tag:'전승 · 방망이로 길막기',asset:'dokkaebi',motion:true,text:'석보상절과 해동잡록에 나타나는 도깨비 모티브. 장난을 걸며 길을 가리지만 모두 악한 존재는 아닙니다. 옷차림과 공격은 게임 창작입니다.',counter:'앞줄 방어 · 돌팔매',source:'한국민족문화대백과사전 · 도깨비',url:'https://encykorea.aks.ac.kr/Article/E0015527'},
 {name:'불가살이',tag:'전승 · 쇠를 먹는 괴수',asset:'bulgasari',motion:true,text:'대동운부군옥·송남잡지에 연결되는 쇠 먹는 괴물 설화. 전쟁터의 쇠붙이에 이끌리는 튼튼한 적으로 해석했습니다. 갑옷과 전투 역할은 창작입니다.',counter:'튼튼한 동료 · 지속 공격',source:'한국민족문화대백과사전 · 불가사리 설화',url:'https://encykorea.aks.ac.kr/Article/E0030766'},
 {name:'창귀',tag:'전승 · 안개 속의 원혼',asset:'changgwi',motion:true,text:'유몽인의 호정문과 박지원의 호질에 등장하는 호랑이와 연결된 원혼. 게임에서는 등불로 길을 헷갈리게 하는 안개 속 귀물로 그렸습니다.',counter:'선비 봉인 · 날림부적',source:'한국민족문화대백과사전 · 호정문',url:'https://encykorea.aks.ac.kr/Article/E0063851'},
 {name:'구미호',tag:'전승 · 아홉 꼬리 여우',asset:'gumiho',motion:true,text:'단종실록 1453년 기사에 사람을 비유하는 구미호 표현이 있습니다. 실제 출현 기록은 아닙니다. 가짜 집 불빛과 전투는 게임의 환상 설정입니다.',counter:'동료 전선 · 발구름',source:'조선왕조실록 · 단종 1년 6월24일',url:'https://sillok.history.go.kr/id/kfa_10106024_002'},
 {name:'산적',tag:'인간 적 · 산길을 막는 무리',asset:'bandit',motion:true,text:'조선 복식에서 착안한 가상의 산적. 짧은 무기로 통행을 막습니다. 특정 역사 사건이나 실존 집단을 재현한 캐릭터는 아닙니다.',counter:'누렁소 · 궁병',source:'게임용 창작'},
 {name:'수적',tag:'인간 적 · 물길의 무리',asset:'pirate',motion:true,text:'강가의 노와 두건에서 착안한 가상의 수적. 공주·군산·여수 구간에 등장합니다. 지역 고유 전승을 주장하는 배치는 아닙니다.',counter:'앞줄 방어 · 원거리 공격',source:'게임용 창작'},
 {name:'망태 요괴',tag:'한양 · 짚과 망태',asset:'mangtae',motion:true,text:'짚과 망태를 걸치고 팔을 휘두르는 귀물.',counter:'돌팔매 · 앞줄 방어',source:'망태 모티브의 게임용 창작'},
 {name:'그림자 짐승',tag:'한양 · 빠른 접근',asset:'shadow',motion:true,text:'검은 털과 연기 사이에서 푸른 눈이 빛나요.',counter:'발구름 · 누렁소',source:'게임용 창작'},

 {name:'지하지인',tag:'근접 · 낮은 공격',asset:'skirt',text:'텅 빈 치마와 가느다란 다리. 높은 부적은 머리 위로 지나갑니다.',counter:'누렁소 · 도령 · 발구름',source:'곽재식 강연 5:03',url:'https://www.youtube.com/watch?v=fK2mzliPjcQ&t=303s'},
 {name:'갓 쓴 말',tag:'공격 · 돌진 돌파',asset:'horse',text:'앞발을 들고 잠깐 멈췄다가 달려듭니다. 예고 중 밀어내면 돌진이 끊깁니다.',counter:'발구름 · 동료 전선',source:'사용자 아이디어를 바탕으로 한 창작'},
 {name:'저승사자',tag:'마법 · 원거리와 회복',asset:'reaper',text:'뒤에서 장부를 펴 다른 귀물의 기운을 회복합니다. 부적으로 장부를 덮게 하세요.',counter:'날림부적',source:'외형·전투 역할은 게임용 창작'},
 {name:'물귀신',tag:'수면 · 물손 휘두르기',asset:'waterghost',text:'젖은 옷자락과 물결을 끌고 다가옵니다. 손에 물이 모이면 타격이 이어져요.',counter:'동료 전선 · 부적',source:'한국 물귀신 모티브의 게임용 창작'},
 {name:'성곽 수문장',tag:'방어 보스 · 내려찍기',asset:'warden',text:'성곽의 돌이 깨어난 수문장. 돌창을 들면 앞쪽 지면에 충격파가 번져요.',counter:'예고 구간 · 비막이',source:'수원화성 모티브의 게임용 창작'},
 {name:'망각의 나루지기',tag:'물길 보스 · 밀려오는 파도',asset:'ferryman',text:'버려진 이름을 강 너머로 옮기던 뱃사공. 노를 들면 긴 파도가 행렬을 덮칩니다.',counter:'파도 예고 · 비막이',source:'게임용 창작'},
 {name:'강철',tag:'보스 · 근접과 우박',asset:'boss',text:'모습이 기록마다 다른 귀물. 이 게임에서는 소 같은 몸과 우박을 엮었습니다.',counter:'우박에는 비막이',source:'곽재식 강연 17:52',url:'https://www.youtube.com/watch?v=fK2mzliPjcQ&t=1072s'}
];
