// Single source of sample tuning. All folklore-derived combat roles are game inventions.
export const ROAD=4200;
export const START=220;
export const MAX_HP=200;
export const MAX_COINS=100;
export const BODY_HEIGHT={haetae:132,girl:117,keeper:133,cow:141,scholar:156,rabbit:124,skirt:102,horse:198,reaper:202,boss:228};
export const AREAS=[{at:0,name:'인왕산 · 비 갠 바위',texture:'inwang',file:'inwang-layers-v11.png'},{at:.3,name:'남한산성 · 노을 성곽',texture:'namhan',file:'namhan-layers-v11.png'},{at:.68,name:'금강산 · 구름 봉우리',texture:'geumgang',file:'geumgang-layers-v11.png'}];
export function areaIndex(progress){return progress>=AREAS[2].at?2:progress>=AREAS[1].at?1:0;}
export const PARALLAX={far:.035,middle:.34,ground:1,near:1.18};
export const ENEMY_STRIKE={duration:.6,impact:.28};
export function enemyAttackFrame(elapsed){return elapsed<.14?0:elapsed<ENEMY_STRIKE.impact?1:elapsed<.44?2:3;}

export const UNITS={
 cow:{name:'누렁소',role:'방어 · 몸으로 버티기',hp:245,speed:65,range:73,damage:12,period:1.35,cost:30,cooldown:4,formation:460,spacing:110,guard:.6,weapon:'horn'},
 keeper:{name:'돌팔매 도령',role:'공격 · 짱돌 던지기',hp:60,speed:80,range:235,damage:17,period:1.15,cost:18,cooldown:3.5,formation:245,spacing:70,guard:0,weapon:'stone',upgrade:{price:45,stats:{name:'먹붓 도령',damage:28,range:275,weapon:'ink'}}},
 rabbit:{name:'달토끼',role:'공격 · 씨앗 사격',hp:48,speed:72,range:310,damage:24,period:1.35,cost:24,cooldown:4,formation:140,spacing:62,guard:0,weapon:'seed'},
 scholar:{name:'선비',role:'지원 · 술법 봉인',hp:56,speed:68,range:405,damage:16,period:2.1,cost:34,cooldown:5,formation:-65,spacing:70,guard:0,weapon:'seal'}
};
export function unitStats(type,keeperRank=0){const s=UNITS[type];return type==='keeper'&&keeperRank?{...s,...s.upgrade.stats}:s;}
// Four walk frames followed by four attack frames; simulation owns the impact clock.
export const MOTION={haetae:{duration:.64,impact:.32,walkFps:7},rabbit:{duration:.64,impact:.32,walkFps:7},girl:{walkFps:7},keeper:{duration:.64,impact:.32,walkFps:7},cow:{duration:.72,impact:.36,walkFps:6},scholar:{duration:.8,impact:.4,walkFps:6}};
export function motionFrame(kind,walk,moving,action){
 const s=MOTION[kind];
 return action?4+Math.min(3,Math.floor(action.elapsed/s.duration*4)):moving?Math.floor(walk*s.walkFps)%4:1;
}
export const COMPANIONS=[
 {name:'여행자와 해태',asset:'haetae',tag:'주인공 · 탑승과 합동기',text:'평소에는 나란히 걷습니다. 돌진 필살기를 쓰면 아이가 해태에 올라타 앞길을 뚫고 다시 내려옵니다.',counter:'출발 전 필살기 편성 · Q / E / R 세 자리',motion:true},
 {name:'누렁소',asset:'cow',tag:'방어 · 튼튼한 앞줄',text:'법술 대신 넓은 몸과 뿔로 앞줄을 지킵니다. 정면 피해를 60% 줄이지만 뒤에서 오는 공격과 우박은 그대로 맞습니다.',counter:'체력 245 · 엽전 30 · 정면 방어',motion:true},
 {name:'돌팔매 도령',asset:'keeper',tag:'공격 · 짱돌에서 먹붓으로',text:'처음에는 주머니에서 짱돌을 꺼내 던집니다. 상단 수련 버튼에 엽전 45를 쓰면 옷과 무기가 바뀌어 먹붓 공격을 합니다.',counter:'소환 18 · 수련 45 · 공격 17 → 28',motion:true},
 {name:'달토끼',asset:'rabbit',tag:'공격 · 씨앗 사격',text:'대나무 통으로 뒤에서 씨앗탄을 쏩니다. 낮은 귀물에는 빗나가므로 누렁소와 도령이 길을 열어줘야 합니다.',counter:'체력 48 · 공격 24 · 소환 24',motion:true},
 {name:'선비',asset:'scholar',tag:'지원 · 붓으로 술법 봉인',text:'장부를 펼친 저승사자를 먼저 노립니다. 붓으로 쓴 봉인이 잠깐 기절시키고 적의 술법과 공격 준비를 끊습니다.',counter:'소환 34 · 짧은 봉인 · 후열 지원',motion:true}
];
export const ENEMIES={
 skirt:{name:'지하지인',hp:44,speed:33,range:45,damage:7,period:1.15,reward:9},
 horse:{name:'갓 쓴 말',hp:110,speed:26,range:65,damage:12,period:1.5,reward:15},
 reaper:{name:'저승사자',hp:90,speed:20,range:290,damage:8,period:2,reward:18},
 boss:{name:'강철',hp:1280,speed:8,range:140,damage:14,period:1.4,reward:40}
};
export const SKILLS={
 charm:{name:'날림부적',cost:12,cooldown:3.2,icon:'iconCharm',role:'봉인',description:'저승사자를 먼저 겨냥해 술법을 끊어요.'},
 stomp:{name:'합동 발구름',cost:20,cooldown:7,icon:'iconStomp',role:'제압',description:'가까운 적을 밀고 돌진 준비를 끊어요.'},
 rush:{name:'해태 타고 돌진',cost:32,cooldown:12,icon:'mount1',role:'돌파',description:'잠깐 해태에 올라타 돌진하며 길을 열어요.'},
 shelter:{name:'비막이',cost:16,cooldown:11,icon:'iconShelter',role:'보호',description:'6초 동안 행렬을 우박에서 보호해요.'},
 mend:{name:'숨 돌리기',cost:30,cooldown:18,icon:'iconSound',role:'회복',description:'행렬의 기운 45, 동료 체력 15를 회복해요.'}
};
export const DEFAULT_LOADOUT=['charm','rush','shelter'];
export function validLoadout(value){return Array.isArray(value)&&value.length===3&&new Set(value).size===3&&value.every(key=>Object.hasOwn(SKILLS,key));}
export const WAVES=[
 {x:420,types:['skirt','skirt'],message:'치마 아래를 노려요. 돌팔매와 합동 발구름!'},
 {x:960,types:['horse','skirt','skirt'],message:'말이 앞발을 들면 돌진! 발구름으로 끊어 주세요.'},
 {x:1600,types:['reaper','horse','skirt'],message:'장부를 펴는 저승사자에게 날림부적을 보내요.'},
 {x:2260,types:['horse','skirt','skirt','reaper'],message:'동료를 번갈아 불러 길을 열어요.'},
 {x:2960,types:['horse','horse','skirt'],message:'먹구름이 가까워졌어요. 비막이를 남겨 두세요.'},
 {x:3500,types:['boss','skirt','skirt'],message:'강철이 길을 막았어요. 우박 예고에 비막이!'}
];
export const CODEX=[
 {name:'지하지인',tag:'근접 · 낮은 공격',asset:'skirt',text:'텅 빈 치마와 가느다란 다리. 높은 부적은 머리 위로 지나갑니다.',counter:'누렁소 · 도령 · 발구름',source:'곽재식 강연 5:03',url:'https://www.youtube.com/watch?v=fK2mzliPjcQ&t=303s'},
 {name:'갓 쓴 말',tag:'공격 · 돌진 돌파',asset:'horse',text:'앞발을 들고 잠깐 멈췄다가 달려듭니다. 예고 중 밀어내면 돌진이 끊깁니다.',counter:'발구름 · 동료 전선',source:'사용자 아이디어를 바탕으로 한 창작'},
 {name:'저승사자',tag:'마법 · 원거리와 회복',asset:'reaper',text:'뒤에서 장부를 펴 다른 귀물의 기운을 회복합니다. 부적으로 장부를 덮게 하세요.',counter:'날림부적',source:'외형·전투 역할은 게임용 창작'},
 {name:'강철',tag:'보스 · 근접과 우박',asset:'boss',text:'모습이 기록마다 다른 귀물. 이 게임에서는 소 같은 몸과 우박을 엮었습니다.',counter:'우박에는 비막이',source:'곽재식 강연 17:52',url:'https://www.youtube.com/watch?v=fK2mzliPjcQ&t=1072s'}
];
