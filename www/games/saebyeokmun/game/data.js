// Single source of sample tuning. All folklore-derived combat roles are game inventions.
export const ROAD=4200;
// One world-space threshold owns both the gate drawing and every automatic arrival.
export const GATE=ROAD+80;
export const START=220;
export const MAX_HP=200;
export const MAX_COINS=100;
export const BODY_HEIGHT={king:165,prince:156,minister:165,cavalry:205,umbrella:185,mount:188,haetae:132,girl:117,keeper:133,cow:141,scholar:156,healer:165,rabbit:124,skirt:102,horse:198,reaper:202,boss:300,warden:230,ferryman:245,waterghost:180,spearman:158,archer:154,mangtae:148,shadow:140,gate:350};
export const AREAS=[
 {at:0,name:'인왕산 · 달빛 물길',texture:'inwang',detailFiles:['inwang-near-left-v37.png','inwang-near-right-v37.png'],file:'inwang-night-layers-v32.png',split:395/724,ground:'nightRoad'},
 {at:1,name:'한양 · 요괴의 전쟁터',texture:'hwaseong',detailFiles:['hanyang-simple-left-v40.png','hanyang-simple-right-v40.png'],detailOverlap:160,file:'simple-hills-v40.png',split:.62,ground:'castleRoad',roadFeet:[163,129,160,118]},
 {at:2,name:'망각의 나루 · 수면 위',texture:'waterway',detailFiles:['waterway-near-0-v39b.png','waterway-near-1-v39c.png'],file:'waterway-far-v39b.png',split:.62,ground:'water'},
 {at:3,name:'먹빛 꽃숲 · 그림체 비교',texture:'storybook',detailFiles:['storybook-near-0-v39b.png','storybook-near-1-v39b.png'],detailOverlap:160,file:'storybook-far-v39.png',split:.5,ground:'storybookRoad',roadFeet:[125,92,169,126]},
 {at:4,name:'작은 연꽃 나루 · 캐릭터 붓결',texture:'waterTest',detailFiles:['water-test-left-v40.png','water-test-right-v40.png'],detailOverlap:160,file:'simple-hills-v40.png',split:.62,ground:'water'}
];
// One chosen landscape and its celestial body follow the existing simulation clock.
// The HUD and landscape read this same presentation state; there is no second clock.
export function skyState(progress,time=0,stage=0){
 const q=((Math.max(0,Number.isFinite(time)?time:0)+160)%840)/840,angle=Math.PI*q,day=stage===1;
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
// Painted enemy frontage, measured in road units; all contact checks share it.
export const ENEMY_FRONT={skirt:35,horse:70,reaper:45,boss:165,warden:80,ferryman:95,waterghost:45,mangtae:43,shadow:52,gate:85};
export const contactGap=(a,b)=>Math.abs(a.x-b.x)-(ENEMY_FRONT[a.type]??ENEMY_FRONT[b.type]??0);
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

export const TEST_MODE=true;
export const DEFAULT_PARTY=['cow','keeper','rabbit','scholar','healer'];
export function validParty(value){return Array.isArray(value)&&value.length===5&&new Set(value).size===5&&value.every(k=>Object.hasOwn(UNITS,k));}
export const UNITS={
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
 healer:{price:0,name:'약방 의원',role:'회복 · 찾아가는 붕대 치료',hp:62,speed:115,range:105,search:980,damage:0,heal:14,period:3.4,cost:36,cooldown:6,formation:-230,spacing:0,guard:0,weapon:'medicine'}
};
export function unitStats(type,keeperRank=0){const s=UNITS[type];return type==='keeper'&&keeperRank?{...s,...s.upgrade.stats}:s;}
// Only the ox returns to the imported 48-slot exposure sheet (33 original video poses).
// Its 74-unit stride / 1.44s cadence stays coupled to actual travel; other bodies stay four cels.
export const MOTION={king:{duration:.9,impact:.45,walkFps:5,walkFrames:4},prince:{duration:.8,impact:.4,walkFps:6,walkFrames:4},minister:{duration:1,impact:.5,walkFps:5,walkFrames:4},cavalry:{duration:.8,impact:.4,walkFps:6,walkFrames:4},haetae:{duration:.64,impact:.32,walkFps:7,walkFrames:4},rabbit:{duration:.64,impact:.32,walkFps:7,walkFrames:4},girl:{walkFps:7,walkFrames:4},keeper:{duration:.64,impact:.32,walkFps:7,walkFrames:4},cow:{duration:.72,impact:.36,walkFps:48/1.44,walkFrames:48,attackFrames:8,idleFrame:56},scholar:{duration:.8,impact:.4,walkFps:6,walkFrames:4},healer:{duration:1.3,impact:.72,walkFps:8,walkFrames:4},warden:{walkFps:4,walkFrames:4},ferryman:{walkFps:4,walkFrames:4},waterghost:{walkFps:4,walkFrames:4},spearman:{duration:.8,impact:.4,walkFps:5,walkFrames:4},archer:{duration:1,impact:.5,walkFps:5,walkFrames:4},mangtae:{walkFps:6,walkFrames:4},shadow:{walkFps:7,walkFrames:4},skirt:{walkFps:106/72*4,walkFrames:4},horse:{walkFps:66/94*4,walkFrames:4},reaper:{walkFps:58/78*4,walkFrames:4},boss:{walkFps:16/40*6,walkFrames:6,idleFrame:0}};
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
 {name:'누렁소',asset:'cow',tag:'방어 · 튼튼한 앞줄',text:'넓은 몸과 뿔로 앞줄을 지킵니다. 같은 종류는 앞줄을 함께 쓰며, 겹쳐 있어도 각각 뿔로 밀어붙입니다. 정면 피해 60% 감소, 우박에는 취약합니다.',counter:'체력 245 · 엽전 30 · 정면 방어',motion:true},
 {name:'돌팔매 도령',asset:'keeper',tag:'공격 · 짱돌에서 먹붓으로',text:'처음에는 주머니에서 짱돌을 꺼내 던집니다. 설정의 도령 수련에 엽전 45를 쓰면 옷과 무기가 바뀌어 먹붓 공격을 합니다.',counter:'소환 18 · 수련 45 · 공격 17 → 28',motion:true},
 {name:'달토끼',asset:'rabbit',tag:'공격 · 씨앗 사격',text:'대나무 통으로 뒤에서 씨앗탄을 쏩니다. 낮은 귀물에는 빗나가므로 누렁소와 도령이 길을 열어줘야 합니다.',counter:'체력 48 · 공격 24 · 소환 24',motion:true},
 {name:'선비',asset:'scholar',tag:'지원 · 붓으로 술법 봉인',text:'사거리에 먼저 들어온 상대를 노립니다. 갓과 망건을 갖춘 조선 선비. 부채를 펼치고 붓으로 쓴 봉인이 잠깐 기절시키고 적의 술법과 공격 준비를 끊습니다.',counter:'소환 34 · 짧은 봉인 · 후열 지원',motion:true},
 {name:'약방 의원',asset:'healer',tag:'회복 · 약통을 멘 성인 여성 의원',text:'약통을 메고 동행합니다. 움직이는 동료도 따라가며 붕대를 감습니다. 치료할 동료가 없을 때만 후열로 돌아오며, 복귀 중에도 환자를 발견하면 다시 찾아갑니다. 기다리는 동안 땀을 닦거나 약재를 정리합니다. 사망한 동료는 되살리지 못합니다.',counter:'소환 36 · 회복 14 · 치료 간격 3.4초',motion:true}
];
export const ENEMIES={
 gate:{name:'저승문',hp:360,speed:0,range:0,damage:0,period:Infinity,reward:0,stationary:true},
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
 mend:{name:'숨 돌리기',cost:30,cooldown:18,icon:'iconSound',role:'회복',description:'행렬의 기운 45, 동료 체력 15를 회복해요.'}
};
export const DEFAULT_LOADOUT=['charm','rush','shelter'];
export function validLoadout(value){return Array.isArray(value)&&value.length===3&&new Set(value).size===3&&value.every(key=>Object.hasOwn(SKILLS,key));}
export const WAVES=[
 {x:START,types:['skirt','skirt'],message:'멀리 저승문에서 귀물이 와요. 누렁소와 도령을 준비해요.'},
 {x:960,types:['horse','skirt','skirt'],message:'말이 앞발을 들면 돌진! 발구름으로 끊어 주세요.'},
 {x:1600,types:['reaper','horse','skirt'],message:'장부를 펴는 저승사자에게 날림부적을 보내요.'},
 {x:2260,types:['horse','skirt','skirt','reaper'],message:'동료를 번갈아 불러 길을 열어요.'},
 {x:2960,types:['horse','horse','skirt'],message:'먹구름이 가까워졌어요. 비막이를 남겨 두세요.'},
 {x:3320,types:['boss','skirt','skirt'],message:'강철이 길을 막았어요. 우박 예고에 비막이!'}
];
// Campaign and battle share these authored stage definitions. No second wave scheduler.
export const STAGES=[
 {name:'달빛 물길',place:'인왕산',time:'밤',gateHp:360,waves:WAVES,subtitle:'첫 번째 문 · 잃어버린 이름',brief:'달빛 나루의 귀물을 물리치고, 이름을 가둔 첫 저승문을 부수세요.',clue:'문 안쪽에 아이의 이름 한 획이 남아 있었다. 나머지는 낮이 멈춘 성곽 너머에 있다.'},
 {name:'한양의 멈춘 전쟁',place:'한양 도성',time:'낮',gateHp:460,waves:WAVES.map((w,i)=>({...w,types:[['mangtae','shadow'],['mangtae','shadow','skirt'],['shadow','mangtae','reaper'],['mangtae','shadow','horse'],['shadow','mangtae','reaper'],['warden','shadow']][i],helper:i===1?'spearman':i===3?'archer':null,message:i===5?'성곽 수문장의 내려찍기! 빛나는 지면을 살펴요.':i===1?'조선 창병이 합류했어요. 함께 앞길을 지켜요.':i===3?'조선 궁병이 합류했어요. 뒤에서 화살로 도와줘요.':'망태 요괴와 그림자 짐승이 길을 막아요.'})),subtitle:'두 번째 문 · 맡겨 둔 약속',brief:'도성 밖에서 조선 군사들이 요괴를 막고 있어요. 행렬은 전쟁터를 지나, 약속의 장부를 지키는 돌 수문장과 두 번째 저승문을 넘어갑니다.',clue:'문지기의 장부에는 이렇게 적혀 있었다. “이 이름은 빼앗은 것이 아니다. 아이가 스스로 맡겼다.” 그 이유는 망각의 나루 건너편에 남아 있다.'},
 {name:'물 위에 남은 발자국',place:'망각의 나루',time:'밤',gateHp:480,waves:WAVES.map((w,i)=>({...w,types:[['waterghost','skirt'],['waterghost','waterghost'],['waterghost','reaper','skirt'],['horse','waterghost','waterghost'],['reaper','waterghost','waterghost'],['ferryman','waterghost']][i],message:i===5?'나루지기가 파도를 불러요. 비막이를 준비해요!':'물 위의 발자국을 따라가요. 물귀신이 나루에서 다가와요.'})),subtitle:'세 번째 문 · 잊기로 한 날',brief:'발밑 물결을 따라 망각의 강을 건너세요. 나루지기를 물리치고 수면 위 저승문을 부수세요.',clue:'물에 젖지 않은 종이 한 장. “내 이름을 잊으면, 그 사람은 돌아올 수 있나요?” 아이가 맡긴 것은 이름뿐이 아니었다.'},
 {name:'먹빛 꽃숲',place:'동화의 길',time:'밤',gateHp:360,waves:WAVES,subtitle:'비교 스테이지 · 캐릭터와 같은 붓결',brief:'둥근 먹빛 나무와 푸른 꽃 사이를 걸어요. 캐릭터와 같은 수채화 배경을 비교하는 테스트 길입니다.',clue:'먹 번짐 속에 꽃이 피었다. 아직 지워지지 않은 이름들이 길을 비춘다.'}
];
// Same encounter conditions as the third river; only scenery differs in this comparison.
STAGES.push({...STAGES[2],name:'작은 연꽃 나루',place:'그림체 실험',subtitle:'물길 비교 · 캐릭터와 같은 선과 면',brief:'캐릭터처럼 단순한 갈색 윤곽과 큰 수채화 면으로 그린 물길입니다. 3번과 같은 전투를 비교해 보세요.',clue:'버드나무 사이로 작은 배 한 척. 같은 여정을 다른 붓결로 걸었다.'});

// Authored equal-budget reference, never scaled to the live player's choices.
// HP and sustained output (including telegraphed abilities) scale together.
export const BALANCE_REFERENCE=[
 {party:['cow','cow','keeper','keeper'],rank:0},
 {party:['cow','cow','keeper','keeper','rabbit'],rank:0},
 {party:['cow','cow','keeper','keeper','rabbit','scholar'],rank:0},
 {party:['cow','cow','keeper','keeper','rabbit','rabbit','scholar'],rank:0},
 {party:['cow','cow','keeper','keeper','rabbit','rabbit','scholar'],rank:1},
 {party:['cow','cow','keeper','keeper','rabbit','rabbit','scholar'],rank:1}
];
export function waveBalance(index,stage=0){
 const waves=STAGES[stage]?.waves||WAVES,i=Math.max(0,Math.min(waves.length-1,index)),ref=BALANCE_REFERENCE[i];
 const budget=ref.party.reduce((n,k)=>n+UNITS[k].cost,0)+(ref.rank?UNITS.keeper.upgrade.price:0);
 const allies=ref.party.reduce((n,k)=>n+combatPower(unitStats(k,ref.rank)),0);
 const enemyStats=waves[i].types.map(k=>{
  const s=ENEMIES[k],a=s.ability;
  if(!a)return s;
  const cycle=a.cooldown+a.windup+(a.duration||0),output=(a.damage||0)+(a.splash||0)*ref.party.length+(a.heal||0)*waves[i].types.length;
  return {...s,damage:s.damage*a.cooldown/cycle+output*s.period/cycle};
 });
 const baseEnemy=enemyStats.reduce((n,s)=>n+combatPower(s),0),scale=allies/baseEnemy/1.03;
 const enemies=baseEnemy*scale*Math.sqrt(ENEMY_OUTPUT);
 return {budget,allies,enemies,scale,enemyStats,advantage:allies/enemies-1};
}
export const CODEX=[
 {name:'망태 요괴',tag:'한양 · 짚과 망태',asset:'mangtae',motion:true,text:'짚과 망태를 걸치고 팔을 휘두르는 귀물.',counter:'돌팔매 · 앞줄 방어',source:'망태 모티브의 게임용 창작'},
 {name:'그림자 짐승',tag:'한양 · 빠른 접근',asset:'shadow',motion:true,text:'검은 털과 연기 사이에서 푸른 눈이 빛나요.',counter:'발구름 · 누렁소',source:'게임용 창작'},

 {name:'지하지인',tag:'근접 · 낮은 공격',asset:'skirt',text:'텅 빈 치마와 가느다란 다리. 높은 부적은 머리 위로 지나갑니다.',counter:'누렁소 · 도령 · 발구름',source:'곽재식 강연 5:03',url:'https://www.youtube.com/watch?v=fK2mzliPjcQ&t=303s'},
 {name:'갓 쓴 말',tag:'공격 · 돌진 돌파',asset:'horse',text:'앞발을 들고 잠깐 멈췄다가 달려듭니다. 예고 중 밀어내면 돌진이 끊깁니다.',counter:'발구름 · 동료 전선',source:'사용자 아이디어를 바탕으로 한 창작'},
 {name:'저승사자',tag:'마법 · 원거리와 회복',asset:'reaper',text:'뒤에서 장부를 펴 다른 귀물의 기운을 회복합니다. 부적으로 장부를 덮게 하세요.',counter:'날림부적',source:'외형·전투 역할은 게임용 창작'},
 {name:'물귀신',tag:'수면 · 물손 휘두르기',asset:'waterghost',text:'젖은 옷자락과 물결을 끌고 다가옵니다. 손에 물이 모이면 타격이 이어져요.',counter:'동료 전선 · 부적',source:'한국 물귀신 모티브의 게임용 창작'},
 {name:'성곽 수문장',tag:'둘째 보스 · 내려찍기',asset:'warden',text:'성곽의 돌이 깨어난 수문장. 돌창을 들면 앞쪽 지면에 충격파가 번져요.',counter:'예고 구간 · 비막이',source:'수원화성 모티브의 게임용 창작'},
 {name:'망각의 나루지기',tag:'셋째 보스 · 밀려오는 파도',asset:'ferryman',text:'버려진 이름을 강 너머로 옮기던 뱃사공. 노를 들면 긴 파도가 행렬을 덮칩니다.',counter:'파도 예고 · 비막이',source:'게임용 창작'},
 {name:'강철',tag:'보스 · 근접과 우박',asset:'boss',text:'모습이 기록마다 다른 귀물. 이 게임에서는 소 같은 몸과 우박을 엮었습니다.',counter:'우박에는 비막이',source:'곽재식 강연 17:52',url:'https://www.youtube.com/watch?v=fK2mzliPjcQ&t=1072s'}
];
