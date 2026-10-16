import {HEALER_VIDEO} from './healer-motion.js?v=100';
import {TRAVELLER_VIDEO} from './traveller-motion.js?v=103';
import {ROAD,GATE,stageGateX,START,MOTION,motionFrame,AREAS,skyState,ROAD_SECTIONS,SHOT_TIME,BODY_HEIGHT,PARALLAX,ENEMY_STRIKE,enemyAttackFrame,bossPose,UNITS,SKILLS,MAX_HP,injuryLevel,REAPER_DEPARTURE_TIME,reaperDepartureFrame,enemyDepartureFrame,actorLayer,ALLY_HIT_TIME,GATE_BREAK_TIME,ENEMIES,isBoss,healerPose,travellerIdleFrame,TEAM_SKILLS,STAGES,GATE_STYLES,contactGap} from './data.js?v=103';
import {AssetDownloads} from './downloads.js?v=70';
import {ASSET_BYTES} from './asset-sizes.js?v=102';
const P=window.Phaser;
const VIDEO_MOTION={healer:HEALER_VIDEO,...TRAVELLER_VIDEO};
const VIDEO_SHEETS=Object.values(VIDEO_MOTION).flatMap(clips=>Object.values(clips));
const LEGACY_FOE_SHEETS={skirt:['enemyWalk','enemyAttacks','enemyDefeat'],horse:['enemyWalk','enemyAttacks','enemyDefeat'],reaper:['enemyWalk','enemyAttacks','reaperDeparture'],boss:['bossMotion','enemyDefeat'],warden:['wardenMotion'],ferryman:['ferrymanMotion'],waterghost:['waterghostMotion'],mangtae:['stageFoes','foeAttacks'],shadow:['stageFoes','foeAttacks']};
const OPTIONAL_SHEETS=new Set([...Object.values(LEGACY_FOE_SHEETS).flat(),'battle','distantTroops','nightRoad','castleRoad','storybookRoad','gate']);
// Feet stand inside the painted road, not on its distant top edge.
const GROUND=542;
const COIN_FLIGHT_TIME=.72;
const COW_REST={asset:'cowRest',prefix:'cowRestVideo',frames:72,fps:12,rows:9};
const COW_IDLE=[{asset:'cowIdle',prefix:'cowIdleVideo',frames:77,fps:12,rows:10},{asset:'cowIdleSniff',prefix:'cowIdleSniffVideo',frames:133,fps:12,rows:17}];
const COW_HEAL={frames:49,fps:18,duration:49/18};
// The overlapping source gutter is composited at draw time, preserving native artwork pixels.
const LANDSCAPE_OVERLAP=160;
const MODEL_MAP={king:'king1',prince:'prince1',minister:'minister1',cavalry:'cavalry1',spearman:'spearman0',archer:'archer0',mangtae:'mangtaeWalk0',shadow:'shadowWalk0',skirt:'skirt0',horse:'horse',reaper:'reaper',boss:'boss',rabbit:'rabbit',keeper:'keeper1',cow:'cow1',scholar:'scholar1',healer:'healer1',warden:'wardenWalk0',ferryman:'ferrymanWalk0',waterghost:'waterghostWalk0'};
// Presentation only: combat and rewards remain exclusively in Journey.
const FX_ART={hit:'CleanImpact',hurt:'CleanImpact',hex:'CleanCurse',guard:'CleanGuard',stomp:'Dust',rush:'CleanSlash',charge:'Dust',summon:'Dust',shelter:'Ward',heal:'Leaf',upgrade:'Seal',vanish:'Smoke'};
const FX_LIFE={hit:.20,hurt:.42,swipe:.16,claw:.16,hex:.28,guard:.42,stomp:.68,rush:1.3,charge:.48,summon:1.1,shelter:.65,heal:1.05,'team-prayer':1.8,upgrade:1,vanish:1.05,projectile:SHOT_TIME,hail:1.15,quake:1.25,tide:1.45,'boss-impact':.9};
const BOSS_COLORS={embers:0xf5b173,roots:0x9ec38d,bells:0xe7d598,inkstorm:0xbdaee0,frost:0xccecff,chains:0xc5b4ca,tide:0x9fe6ed,mirage:0xe4c5ef,quake:0xe5bc8c,spikes:0xbce0a5,hail:0xcdeef4,seals:0xf4d49c};
// Surface landmarks belong to each whole-body cel, not the padded atlas rectangle.
// x/y are the torso centre; w/h its surface extent. Only sockets move: never the art/limbs.
const WOUNDS={
 king:{muzzle:[.82,.55],materials:['Cloth','Scar'],size:[.25,.3],poses:[[.5,.6,0]],attack:[[.5,.6,0]]},
 prince:{muzzle:[.87,.5],materials:['Cloth','Scar'],size:[.25,.3],poses:[[.5,.6,0]],attack:[[.5,.6,0]]},
 minister:{muzzle:[.85,.52],materials:['Cloth','Scar'],size:[.25,.3],poses:[[.5,.6,0]],attack:[[.5,.6,0]]},
 cavalry:{muzzle:[.84,.4],materials:['Fur','Cloth'],size:[.25,.3],poses:[[.5,.65,0]],attack:[[.5,.65,0]]},
 spearman:{muzzle:[.83,.57],materials:['Dark','Cloth'],size:[.25,.3],poses:[[.5,.6,0]],attack:[[.5,.6,0]]},
 archer:{muzzle:[.84,.44],materials:['Dark','Cloth'],size:[.25,.3],poses:[[.5,.6,0]],attack:[[.5,.6,0]]},
 mangtae:{materials:['Fur','Scar'],size:[.45,.5],poses:[[.5,.5,0]],attack:[[.5,.5,0]]},
 shadow:{materials:['Fur','Scar'],size:[.5,.35],poses:[[.5,.6,0]],attack:[[.5,.6,0]]},
 cow:{materials:['Fur','Scar'],size:[.44,.43],poses:[[.48,.55,-.05],[.48,.55,-.03],[.47,.56,0],[.49,.56,.04],[.50,.55,.02],[.49,.54,-.03]],attack:[[.49,.55,-.03],[.48,.55,.12],[.49,.57,.28],[.50,.59,.33],[.49,.60,.36],[.50,.56,.13],[.49,.54,-.04],[.49,.55,-.02]]},
 haetae:{materials:['Fur','Scar'],size:[.48,.37],poses:[[.46,.61,0],[.47,.60,.04],[.46,.61,-.03],[.47,.59,.02]],attack:[[.47,.60,0],[.45,.58,-.13],[.49,.63,.09],[.47,.62,0]]},
 mount:{materials:['Fur','Scar'],size:[.46,.28],poses:[[.48,.73,0],[.49,.72,.03],[.48,.74,-.02],[.48,.73,0]],attack:[[.46,.70,-.14],[.48,.71,-.06],[.50,.74,.08],[.48,.73,0]]},
 rabbit:{muzzle:[.79,.67],materials:['Scar','Scar'],size:[.22,.22],poses:[[.48,.75,-.08],[.50,.74,.03],[.48,.75,0],[.49,.74,-.04]],attack:[[.47,.75,-.08],[.46,.75,-.10],[.48,.74,.06],[.48,.75,0]]},
 girl:{muzzle:[.77,.53],materials:['Cloth','Cloth'],size:[.32,.28],poses:[[.49,.75,.03],[.51,.76,-.04],[.49,.75,.04],[.50,.76,-.02]],attack:[[.52,.75,-.06]]},
 keeper:{muzzle:[.80,.52],materials:['Cloth','Cloth'],size:[.21,.23],poses:[[.51,0.66,-.10],[.50,0.65,-.06],[.50,0.66,-.07],[.50,0.65,-.09]],attack:[[.52,0.66,0],[.51,0.65,-.09],[.41,0.66,.21],[.46,0.66,.10]]},
 keeperBrush:{muzzle:[.84,.53],materials:['Cloth','Cloth'],size:[.22,.25],poses:[[.50,0.67,-.07],[.51,0.67,0],[.50,0.68,-.08],[.51,0.67,-.03]],attack:[[.51,0.67,0],[.47,0.66,-.16],[.47,0.67,.14],[.49,0.67,.04]]},
 scholar:{spots:[[-.12,.18],[.20,.38]],muzzle:[.79,.51],materials:['Cloth','Cloth'],size:[.25,.32],poses:[[.54,.70,.02],[.55,.69,.02],[.54,.70,.03],[.55,.69,.01]],attack:[[.52,.71,0],[.49,.72,.10],[.47,.72,.16],[.51,.71,.04]]},
 healer:{muzzle:[.87,.43],materials:['Cloth','Cloth'],size:[.26,.25],poses:[[.54,.55,0],[.54,.55,.03],[.54,.55,0],[.54,.55,-.03]],attack:[[.54,.55,0],[.52,.57,-.09],[.53,.57,-.12],[.54,.55,0]]},
 skirt:{materials:['Cloth','Cloth'],size:[.50,.47],poses:[[.49,.38,-.06],[.50,.37,.05],[.49,.38,-.04],[.50,.37,.05]],attack:[[.48,.38,-.08],[.47,.39,-.13],[.54,.40,.12],[.51,.38,.04]]},
 horse:{spots:[[-.1,.34],[.20,.48]],materials:['Dark','Cloth'],size:[.20,.29],poses:[[.51,.65,-.07],[.52,.65,-.02],[.50,.64,-.06],[.51,.65,-.03]],attack:[[.51,.63,-.08],[.55,.61,-.20],[.48,.66,.12],[.52,.65,.03]]},
 reaper:{spots:[[-.12,.34],[.18,.48]],muzzle:[.28,.57],materials:['Dark','Dark'],size:[.23,.35],poses:[[.53,.66,.04],[.52,.66,.02],[.53,.66,.04],[.52,.66,.02]],attack:[[.54,.67,0],[.55,.66,-.05],[.53,.67,.05],[.54,.67,0]]},
 boss:{materials:['Fur','Scar'],size:[.40,.30],poses:[[.56,.64,-.02],[.57,.66,.03],[.56,.64,-.02],[.56,.65,.02],[.57,.67,.03],[.57,.63,-.02]],attack:[[.56,.64,0],[.58,.67,.06],[.58,.7,.1],[.57,.71,.06],[.57,.68,0],[.55,.62,-.05]],cast:[[.56,.68,.04],[.56,.49,-.3],[.58,.5,-.35],[.56,.63,0]]}
};
const IMPACT={horn:{size:95,stop:.035,shake:.055},stone:{size:72},seed:{size:58},ink:{size:85},seal:{size:90},charm:{size:84},hex:{size:90},stomp:{size:125,stop:.055,shake:.11},rush:{size:115,stop:.045,shake:.08},boss:{size:115,stop:.05,shake:.1},horse:{size:90,shake:.04},hail:{size:64},physical:{size:75}};
export function makeGame(model,onReady,onFrame,onEvents){
 class RoadScene extends P.Scene{
  constructor(){super('road');this.sprites=new Map();this.effects=[];this.grounding=new Map();this.celScale=new Map();this.registrationX=new Map();this.idleSince=null;this.contacts=new Map();this.offset=0;this.lastX=START;this.heroPose=0;this.shake=0;this.hitStop=0;this.impactCooldown=0;this.previewAreaIndex=0;this.injuryTextures=new Map();}
  registerAssets(){
   const files=new Map(),load={image:(key,url)=>files.set(key,{key,url,type:"image"}),json:(key,url)=>files.set(key,{key,url,type:"json"})};
   load.image('hellgates','./assets/hellgates-v61.webp');load.json('hellgateLayout','./assets/hellgates-v61.json');
   const loadedAtlases=new Set();for(const [kind,spec]of Object.entries(ENEMIES))if(spec.atlas){const key=spec.atlasGroups?'enemyAtlas:'+spec.atlas:kind+'Motion';if(!loadedAtlases.has(key)){load.image(key,'./assets/'+spec.atlas);loadedAtlases.add(key);}}
   for(const kind of ["king","prince","minister","cavalry"])load.image(kind+"Atlas","./assets/"+kind+"-v39.webp");
   load.image("storybookRoad","./assets/storybook-road-v39.webp");
   for(const kind of ['warden','ferryman','waterghost'])load.image(kind+'Motion','./assets/'+kind+'-v36.webp');
   for(const key of ['girlIdle','haetaeIdle','battle','humanRecovery','creatureRecovery'])load.image(key,'./assets/'+({girlIdle:'girl-idle',haetaeIdle:'haetae-idle',battle:'distant-war',humanRecovery:'human-recovery',creatureRecovery:'creature-recovery'}[key])+'-v38.webp');
   load.image('distantTroops','./assets/joseon-distant-troops-v38.webp');load.image('troopsWalk','./assets/joseon-troops-walk-v38.webp');load.image('troopsAttack','./assets/joseon-troops-attack-v38.webp');
   load.image('stageFoes','./assets/stage-two-foes-v38.webp');load.image('foeAttacks','./assets/hanyang-battle-v38.webp');
   load.image('castleRoad','./assets/hanyang-road-simple-v40.webp');
   load.image('enemyDefeat','./assets/enemy-defeat-v35.webp');
   load.image('allyDefeat','./assets/ally-defeat-v35.webp');
   load.image('allyHurt','./assets/ally-hurt-v32.webp');
   load.image('healerMovingCare','./assets/healer-moving-care-v37.webp');load.image('healerWalk','./assets/healer-care-v36.webp');load.image('umbrellaMotion','./assets/umbrella-motion-v32.webp');
   load.image('healerPrayer','./assets/healer-prayer-v55.webp');load.image('cowVideo','./assets/cow-motion-v100.webp');load.json('cowVideoMeta','./assets/cow-motion-v100.json');
   for(const spec of VIDEO_SHEETS)load.image(spec.asset,'./assets/'+spec.file);
   load.image('waterWard','./assets/haetae-water-ward-v101.webp');
   load.image('cowRest','./assets/cow-rest-v100.webp');load.json('cowRestMeta','./assets/cow-rest-v100.json');
   load.image('cowIdleSniff','./assets/cow-idle-sniff-v100.webp');load.json('cowIdleSniffMeta','./assets/cow-idle-sniff-v100.json');
   load.image('cowIdle','./assets/cow-idle-v100.webp');load.json('cowIdleMeta','./assets/cow-idle-v100.json');
   load.image('cowHealing','./assets/cow-healing-v100.webp');load.json('cowHealingMeta','./assets/cow-healing-v100.json');
   load.image('allies','./assets/allies.webp');load.image('enemies','./assets/enemies.webp');
   load.image('haetaeMotion','./assets/haetae-motion-v10.webp');load.image('rabbitMotion','./assets/rabbit-motion-v10.webp');
   load.image('companionWalk','./assets/companions-walk-v11.webp');load.image('gate','./assets/underworld-gate-v17.webp');load.image('enemyWalk','./assets/enemy-walk-v17.webp');load.image('reaperDeparture','./assets/reaper-departure-v35.webp');load.image('actionIcons','./assets/action-icons-v11.webp');
   for(const area of AREAS){load.image(area.texture,'./assets/'+area.file);for(const [suffix,file] of [['Sky',area.skyFile],['Clouds',area.cloudFile],['Moon',area.moonFile]])if(file)load.image(area.texture+suffix,'./assets/'+file);area.detailFiles.forEach((file,i)=>load.image(area.texture+'Detail'+i,'./assets/'+file));if(area.roadAtlas)load.image(area.texture+'RoadAtlas','./assets/'+area.roadAtlas);else area.roadTiles?.forEach((tile,i)=>load.image(area.texture+'Road'+i,'./assets/'+tile.file));}
   load.image('nightRoad','./assets/night-road-v32.webp');load.image('moon','./assets/moon-v32.webp');
   load.image('livingScenery','./assets/living-scenery-v11.webp');
   load.image('enemyAttacks','./assets/enemy-attacks-v17.webp');
   load.image('bossMotion','./assets/boss-motion-v25.webp');
   for(const [key,file] of Object.entries({keeperWalk:'doryeong-stone-v12',keeperBrushWalk:'doryeong-brush-v12',scholarWalk:'joseon-scholar-v38b',mountWalk:'mounted-haetae-v12',combatFX:'combat-fx-v18',magicFX:'magic-fx-v18',cleanFX:'clean-fx-v19',woundArt:'wounds-v20'}))load.image(key,'./assets/'+file+'.webp');
   return files;
  }
  create(){
   this.files=this.registerAssets();
   const urls=[...this.files.values()].map(f=>f.url),retainUrls=[...new Set(urls.filter((url,i)=>urls.indexOf(url)!==i))];
   // New delivery bytes invalidate old browser/CDN copies; logical cache keys stay stable.
   this.downloads=new AssetDownloads(ASSET_BYTES,{retainUrls,fetcher:(url,options)=>fetch(url+(/-v10[01]\.(webp|json)$/.test(url)?'?delivery=102':'?delivery=64'),options)});
   this.recipes=[];this.recording=true;this.registerRecipes();this.recording=false;
   this.loadedFiles=new Set();this.processedRecipes=new Set();this.stageKeys=new Set();
   this.commonKeys=[...this.files.keys()].filter(key=>!this.areaKeys().has(key)&&!this.enemySheetKeys().has(key)&&!OPTIONAL_SHEETS.has(key));
   onReady(null,this);
  }
  areaKeys(index=null){
   const result=new Set();for(const a of index===null?AREAS:[AREAS[index]]){
    result.add(a.texture);for(const [suffix,file]of [['Sky',a.skyFile],['Clouds',a.cloudFile],['Moon',a.moonFile]])if(file)result.add(a.texture+suffix);
    a.detailFiles.forEach((_,i)=>result.add(a.texture+'Detail'+i));
    if(a.roadAtlas)result.add(a.texture+'RoadAtlas');else a.roadTiles?.forEach((_,i)=>result.add(a.texture+'Road'+i));
   }return result;
  }
  enemySheetKeys(){return new Set(Object.entries(ENEMIES).filter(([,s])=>s.atlas).map(([k,s])=>s.atlasGroups?'enemyAtlas:'+s.atlas:k+'Motion'));}
  stageFiles(index){
   const keys=this.areaKeys(index);
   for(const kind of new Set([...STAGES[index].waves,...STAGES[index].tour.waves].flatMap(w=>w.types))){const s=ENEMIES[kind];if(s?.atlas)keys.add(s.atlasGroups?'enemyAtlas:'+s.atlas:kind+'Motion');else for(const key of LEGACY_FOE_SHEETS[kind]||[])keys.add(key);}
   if(index===1){keys.add('battle');keys.add('distantTroops');}
   const area=AREAS[index];if(!area.paintingSingle&&!area.roadTiles&&area.ground!=='water')keys.add(area.ground);
   return [...keys];
  }
  observeLoad(job,onProgress){
   if(!onProgress)return job;
   const observers=this.loadObservers??=new Set();observers.add(onProgress);
   if(this.loadProgress)onProgress(this.loadProgress);
   return job.finally(()=>observers.delete(onProgress));
  }
  loadFiles(keys,onProgress){
   const job=(this.loadQueue||Promise.resolve()).catch(()=>{}).then(async()=>{
    try{return await this.consumeFiles(keys,p=>{this.loadProgress=p;for(const fn of this.loadObservers||[])fn(p);});}
    finally{this.loadProgress=null;}
   });this.loadQueue=job;return this.observeLoad(job,onProgress);
  }
  async consumeFiles(keys,onProgress=()=>{}){
   const missing=[...new Set(keys)].filter(k=>!this.loadedFiles.has(k)),files=missing.map(k=>this.files.get(k)).sort((a,b)=>(a.type==='json'?0:1)-(b.type==='json'?0:1));
   await this.downloads.batch(files,onProgress);
   const blobs=new Map([...new Set(files.map(f=>f.url))].map(url=>[url,this.downloads.take(url)]));
   for(let i=0;i<files.length;i++){
    const f=files[i],blob=blobs.get(f.url);
    if(!blob)throw new Error('그림 준비가 중단됐어요. 다시 시도해 주세요.');
    if(f.type==='json')this.cache.json.add(f.key,JSON.parse(await blob.text()));
    else {const url=URL.createObjectURL(blob);try{const image=new Image();image.src=url;await image.decode();this.textures.addImage(f.key,image);}finally{URL.revokeObjectURL(url);}}
    // Decode and split one sheet at a time instead of holding every full-size source on the GPU.
    for(const [recipe,args]of this.recipes.entries())if(args[0]===f.key&&!this.processedRecipes.has(recipe)){
     this.sliceAtlas(...args);this.processedRecipes.add(recipe);
    }
    if(this.recipes.some(args=>args[0]===f.key)&&this.textures.exists(f.key))this.textures.remove(f.key);
    this.loadedFiles.add(f.key);if(!files.slice(i+1).some(next=>next.url===f.url))blobs.delete(f.url);
    onProgress({...this.downloads.lastProgress,phase:'prepare',prepared:i+1,prepareTotal:files.length});
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }

  async ensureCommon(onProgress){
   if(this.commonReady)return;
   if(this.commonPromise)return this.observeLoad(this.commonPromise,onProgress);
   this.commonPromise=(async()=>{
    await this.loadFiles(this.commonKeys,onProgress);
    const cowNames=[...Array.from({length:48},(_,i)=>'cow'+i),...Array.from({length:48},(_,i)=>'cowRun'+i),...Array.from({length:48},(_,i)=>'cow'+(48+i)),'cow96',...Array.from({length:29},(_,i)=>'cowEmotion'+i),'hurtcow',...Array.from({length:MOTION.cow.angerFrames},(_,i)=>'cowAnger'+i),...Array.from({length:12},(_,i)=>'cowRageRun'+i)];
    const registered=this.cache.json.get('cowVideoMeta');for(const [i,key] of cowNames.entries()){if(i>=48||!this.grounding.has(key))this.grounding.set(key,registered.ground);this.celScale.set(key,registered.scale);this.registrationX.set(key,registered.originX);}
    // Registered healing cells use the same world pixel scale and floor as v93.
    const heal=this.cache.json.get('cowHealingMeta');
    for(let i=0;i<COW_HEAL.frames;i++){const key='cowRecoverVideo'+i;this.grounding.set(key,heal.ground);this.celScale.set(key,heal.scale);this.registrationX.set(key,heal.originX);}
    for(const spec of [COW_REST,...COW_IDLE]){const idle=this.cache.json.get(spec.asset+'Meta');for(let i=0;i<spec.frames;i++){const key=spec.prefix+i;this.grounding.set(key,idle.ground);this.celScale.set(key,idle.scale);this.registrationX.set(key,idle.originX);}}
    // Walking always has a supporting foot: keep the slicer's per-cel measurement.
    // Running retains the registered floor so airborne poses do not stick to the ground.
    for(const clips of Object.values(VIDEO_MOTION))for(const [name,spec] of Object.entries(clips))for(let i=0;i<spec.frames;i++){const key=spec.prefix+i;if(name!=='walk'||!this.grounding.has(key))this.grounding.set(key,spec.ground);this.celScale.set(key,spec.scale);this.registrationX.set(key,spec.originX);}
    this.initializeWorld();this.commonReady=true;
   })();try{await this.commonPromise;}finally{this.commonPromise=null;}
  }
  async prepareStage(index,onProgress){
   this.ready=false;
   const keys=this.stageFiles(index);await this.loadFiles([...this.commonKeys,...keys],onProgress);
   await this.ensureCommon();this.prepareArea(index);
   this.releaseStage(keys);this.previewAreaIndex=index;this.ready=true;
  }
  prepareArea(index){
   const area=AREAS[index];if(!area.paintingSingle&&!area.roadTiles&&area.ground!=='water'){const t=this.textures.get(area.ground),s=t.getSourceImage();ROAD_SECTIONS.forEach((part,i)=>{if(!t.has(part.frame))t.add(part.frame,0,0,i*s.height/4,s.width,s.height/4);});}
   const tex=this.textures.get(area.texture),src=tex.getSourceImage(),split=Math.floor(src.height*area.split);
   if(!tex.has('far')){tex.add('far',0,0,0,src.width,split);tex.add('middle',0,0,split,src.width,src.height-split);}
   if(area.detailOverlap!==0){const t=this.textures.get(area.texture+'Detail1'),s=t.getSourceImage();if(!t.has('join')){t.add('join',0,0,0,LANDSCAPE_OVERLAP,s.height);t.add('body',0,LANDSCAPE_OVERLAP,0,s.width-LANDSCAPE_OVERLAP,s.height);}}
   if(area.roadAtlas){const t=this.textures.get(area.texture+'RoadAtlas');for(const part of area.roadTiles)if(!t.has(part.frame))t.add(part.frame,0,part.x,part.sourceY,part.width,part.sourceHeight);}
   if(area.panorama&&!area.paintingSingle){const t=this.textures.get(area.texture+'Detail0'),s=t.getSourceImage(),o=area.detailOverlap;if(!t.has('body')){t.add('body',0,0,0,s.width-o,s.height);t.add('tail',0,s.width-o,0,o,s.height);}}
   if(area.paintingFoot!==undefined){const t=this.textures.get(area.paintingSingle?area.texture:area.texture+'Detail0'),s=t.getSourceImage();if(!t.has('waterFooter'))t.add('waterFooter',0,Math.floor(s.width*.36),Math.floor(s.height*.91),Math.floor(s.width*.28),Math.floor(s.height*.09));}
  }
  releaseStage(keys){
   for(const [id,image]of this.sprites){image.destroy();this.sprites.delete(id);}this.resetPresentation();
   this.stageKeys=new Set(keys);this.previewSheets=[];this.retainFiles(keys);
  }
  retainFiles(keys){
   const keep=new Set([...this.commonKeys,...keys]);
   for(const key of this.loadedFiles)if(!keep.has(key)){
    if(this.textures.exists(key))this.textures.remove(key);this.loadedFiles.delete(key);
    for(const [i,args]of this.recipes.entries())if(args[0]===key){for(const name of args[1]){
     for(const texture of [name,'injured1__'+name,'injured2__'+name]){if(this.textures.exists(texture))this.textures.remove(texture);this.injuryTextures.delete(texture);}
     this.grounding.delete(name);this.celScale.delete(name);this.registrationX.delete(name);
    }this.processedRecipes.delete(i);}
   }
   this.previewCache?.clear();
  }
  prefetchStage(index,onProgress){
   if(!STAGES[index])return Promise.resolve();
   return this.downloads.prefetch(this.stageFiles(index).filter(k=>!this.loadedFiles.has(k)).map(k=>this.files.get(k)),onProgress);
  }
  async ensurePreview(kind){
   // Collection portraits reuse the registered slicing recipe, without loading the battle bundle.
   if(UNITS[kind]){const recipe=this.recipes.find(args=>args[1].includes(kind+'1'));if(recipe)await this.loadFiles([recipe[0]]);return;}
   const s=ENEMIES[kind];if(!s)return;
   const keys=s.atlas?[s.atlasGroups?'enemyAtlas:'+s.atlas:kind+'Motion']:LEGACY_FOE_SHEETS[kind]||[];await this.loadFiles(keys);
   this.previewSheets=[...(this.previewSheets||[]).filter(k=>!keys.includes(k)),...keys].slice(-12);
   this.retainFiles([...this.stageKeys,...this.previewSheets]);
  }
  sliceAtlas(sheet,names,columns=3,sharedBounds=false,rows=2,layout=null,scaleReference=null,atlasGroup=null,maxCell=null){
   if(this.recording){this.recipes.push([sheet,names,columns,sharedBounds,rows,layout,scaleReference,atlasGroup,maxCell]);return;}
   if(sheet==='hellgates')layout=this.cache.json.get('hellgateLayout');
   const source=this.textures.get(sheet).getSourceImage(),sw=source.width/columns;let sh=source.height/rows;
   const scratch=document.createElement('canvas');scratch.width=source.width;scratch.height=source.height;
   const ctx=scratch.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);
   const atlas=ctx.getImageData(0,0,source.width,source.height).data;
   // Generated sheets have real gutters near, but not exactly on, equal-grid boundaries.
   // Find those transparent bands before cropping so the previous row's shoes cannot leak in.
   const gutters=(count,size,occupied)=>{
    const result=[0],cell=size/count;
    for(let i=1;i<count;i++){
     const center=i*cell,lo=Math.max(0,Math.floor(center-cell*.18)),hi=Math.min(size,Math.ceil(center+cell*.18));
     let best=Math.round(center),distance=Infinity,begin=-1;
     for(let n=lo;n<=hi;n++){
      if(n<hi&&!occupied[n]){if(begin<0)begin=n;}
      else if(begin>=0){if(n-begin>=4){const mid=Math.round((begin+n)/2),d=Math.abs(mid-center);if(d<distance){best=mid;distance=d;}}begin=-1;}
     }
     result.push(best);
    }
    return [...result,size];
   };
   const rowInk=new Uint8Array(source.height);
   for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(atlas[(y*source.width+x)*4+3]>175){rowInk[y]=1;break;}
   const groupStart=(atlasGroup?.index||0)*rows,allRows=rows*(atlasGroup?.count||1);
   const fullRowCuts=layout?layout.y.map(v=>Math.round(v*source.height)):gutters(allRows,source.height,rowInk),rowCuts=fullRowCuts.slice(groupStart,groupStart+rows+1),cells=[];
   sh=(rowCuts.at(-1)-rowCuts[0])/rows;
   for(let row=0;row<rows;row++){
    const colInk=new Uint8Array(source.width);
    for(let x=0;x<source.width;x++)for(let y=rowCuts[row];y<rowCuts[row+1];y++)if(atlas[(y*source.width+x)*4+3]>175){colInk[x]=1;break;}
    const cuts=layout?(Array.isArray(layout.x[0])?layout.x[row+groupStart]:layout.x).map(v=>Math.round(v*source.width)):gutters(columns,source.width,colInk);
    // Padding owns no motion: integer placement avoids filtering native pixels during slicing.
    for(let col=0;col<columns;col++)cells.push({x:cuts[col],y:rowCuts[row],w:cuts[col+1]-cuts[col],h:rowCuts[row+1]-rowCuts[row],dx:Math.round(sw*.25+cuts[col]-col*sw),dy:Math.round(sh*.25+rowCuts[row]-rowCuts[0]-row*sh)});
   }
   const cw=Math.ceil(Math.max(sw*1.5,...cells.map(c=>c.dx+c.w))),ch=Math.ceil(Math.max(sh*1.5,...cells.map(c=>c.dy+c.h)));scratch.width=cw;scratch.height=ch;
   const drawCell=i=>{const c=cells[i];ctx.clearRect(0,0,cw,ch);ctx.drawImage(source,c.x,c.y,c.w,c.h,c.dx,c.dy,c.w,c.h);};
   const bounds=names.map((name,i)=>{
    drawCell(i);
    const rgba=ctx.getImageData(0,0,cw,ch).data;
    let x0=cw,y0=ch,x1=0,y1=0;
    // Read the visible character bounds inside each already generated atlas cell.
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)if(rgba[(y*cw+x)*4+3]>175){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    if(x1<=x0){x0=0;y0=0;x1=cw-1;y1=ch-1;}
    const footY=y1;let footLeft=cw,footRight=0;
    if(scaleReference)for(let y=Math.max(y0,footY-Math.max(4,Math.round((footY-y0)*.035)));y<=footY;y++)for(let x=x0;x<=x1;x++)if(rgba[(y*cw+x)*4+3]>175){footLeft=Math.min(footLeft,x);footRight=Math.max(footRight,x);}
    const footX=footRight>=footLeft?(footLeft+footRight)/2:(x0+x1)/2;
    x0=Math.max(0,x0-3);y0=Math.max(0,y0-3);x1=Math.min(cw-1,x1+3);y1=Math.min(ch-1,y1+3);
    return {x0,y0,x1,y1,footY,footX};
   });
   // Animation cells share one crop and one scale; per-frame trimming makes feet slide.
   names.forEach((name,i)=>{
    const groupSize=sharedBounds===true?names.length:sharedBounds||1,start=Math.floor(i/groupSize)*groupSize,group=bounds.slice(start,start+groupSize);
    const {x0,y0,x1,y1}={x0:Math.min(...group.map(b=>b.x0)),y0:Math.min(...group.map(b=>b.y0)),x1:Math.max(...group.map(b=>b.x1)),y1:Math.max(...group.map(b=>b.y1))};
    drawCell(i);
    const nativeWidth=x1-x0+1,nativeHeight=y1-y0+1,reduction=maxCell?Math.min(1,maxCell/Math.max(nativeWidth,nativeHeight)):1;
    const texture=this.textures.createCanvas(name,Math.ceil(nativeWidth*reduction),Math.ceil(nativeHeight*reduction));
    texture.getContext().drawImage(scratch,x0,y0,nativeWidth,nativeHeight,0,0,texture.width,texture.height);texture.refresh();
    // Preserve shared dimensions, but anchor each frame by its visible supporting foot.
    this.grounding.set(name,(bounds[i].footY-y0)/nativeHeight);
    if(scaleReference){const b=bounds[scaleReference[i]];this.celScale.set(name,nativeHeight/(b.footY-b.y0+4));this.registrationX.set(name,(bounds[i].footX-x0)/nativeWidth);}
   });
  }
  registerRecipes(){
   for(const spec of VIDEO_SHEETS)this.sliceAtlas(spec.asset,Array.from({length:spec.frames},(_,i)=>spec.prefix+i),8,true,spec.rows,{x:Array.from({length:9},(_,i)=>i/8),y:Array.from({length:spec.rows+1},(_,i)=>i/spec.rows)});
   this.sliceAtlas('hellgates',GATE_STYLES.map(s=>s.texture),3,false,4,null,null,null,420);
   for(const [kind,spec]of Object.entries(ENEMIES))if(spec.atlas){
    this.sliceAtlas(spec.atlasGroups?'enemyAtlas:'+spec.atlas:kind+'Motion',['Walk','Strike','Depart'].flatMap(mode=>Array.from({length:4},(_,i)=>mode==='Depart'?'depart'+kind+i:kind+mode+i)),4,true,3,spec.atlasLayout??null,Array(12).fill(0),spec.atlasGroups?{index:spec.atlasGroup,count:spec.atlasGroups}:null);
    MODEL_MAP[kind]=kind+'Walk0';
   }
   for(const kind of ['king','prince','minister','cavalry'])this.sliceAtlas(kind+'Atlas',[...Array.from({length:8},(_,i)=>kind+i),'hurt'+kind,kind+'Idle0','defeat'+kind+'0','defeat'+kind+'1'],4,true,3,null,Array(12).fill(0));
   this.sliceAtlas('allies',['girl','haetae','rabbit','keeper','haetaeStomp','girlCast']);
   for(const kind of ['girl','haetae'])this.sliceAtlas(kind+'Idle',Array.from({length:12},(_,i)=>kind+'Idle'+i),4,true,3,null,Array(12).fill(0));
   this.sliceAtlas('battle',['spear','archer','mangtae','shadow'].flatMap(k=>Array.from({length:4},(_,i)=>(['spear','archer'].includes(k)?'legacybattle':'battle')+k+i)),4,4,4);
   const newFoes=['spearman','archer','mangtae','shadow'];
   this.sliceAtlas('distantTroops',['spear','archer'].flatMap(k=>Array.from({length:4},(_,i)=>'battle'+k+i)),4,4,2);
   this.sliceAtlas('stageFoes',newFoes.flatMap(k=>[...Array.from({length:4},(_,i)=>(['spearman','archer'].includes(k)?'legacy'+k:k)+'Walk'+i),'depart'+(['spearman','archer'].includes(k)?'legacy'+k:k)+'0','depart'+(['spearman','archer'].includes(k)?'legacy'+k:k)+'1']),6,6,4,null,newFoes.flatMap((_,i)=>Array(6).fill(i*6)));
   this.sliceAtlas('foeAttacks',newFoes.flatMap(k=>Array.from({length:4},(_,i)=>(['spearman','archer'].includes(k)?'legacy'+k:k)+'Strike'+i)),4,4,4);
   this.sliceAtlas('troopsWalk',['spearman','archer'].flatMap(k=>[...Array.from({length:4},(_,i)=>k+i),'defeat'+k+'0','defeat'+k+'1']),6,6,2,null,[...Array(6).fill(0),...Array(6).fill(6)]);
   this.sliceAtlas('troopsAttack',['spearman','archer'].flatMap(k=>Array.from({length:4},(_,i)=>k+(i+4))),4,4,2,null,[0,0,0,0,4,4,4,4]);
   this.sliceAtlas('humanRecovery',['girl','keeper','scholar','healer'].flatMap(k=>[k==='scholar'?'legacyScholarRecover0':k+'Recover0',k==='scholar'?'legacyScholarRecover1':k+'Recover1']),4,2,2,null,Array.from({length:8},(_,i)=>Math.floor(i/2)*2+1));
   this.sliceAtlas('creatureRecovery',['haetae','cow','rabbit'].flatMap(k=>[k+'Recover0',k+'Recover1']),3,2,2,null,[1,1,3,3,5,5]);
   this.sliceAtlas('enemies',['skirt0','skirt1','horse','reaper','boss','cloud']);
   for(const kind of ['haetae','rabbit'])this.sliceAtlas(kind+'Motion',Array.from({length:8},(_,i)=>kind+i),4,true);
   this.sliceAtlas('companionWalk',Array.from({length:4},(_,i)=>'girl'+i),4,4);
   this.sliceAtlas('enemyWalk',['skirt','horse','reaper','bossLegacy'].flatMap(kind=>Array.from({length:4},(_,i)=>kind+'Walk'+i)),4,4,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   this.sliceAtlas('bossMotion',[...Array.from({length:6},(_,i)=>'bossWalk'+i),...Array.from({length:6},(_,i)=>'bossStrike'+i),...Array.from({length:4},(_,i)=>'bossCast'+i)],4,true,4);
   this.sliceAtlas('reaperDeparture',Array.from({length:8},(_,i)=>'reaperDepart'+i),4,true);
   this.sliceAtlas('woundArt',['Cloth','Scar','Fur','Dark'].map(k=>'wound'+k+'1').concat(['Cloth','Scar','Fur','Dark'].map(k=>'wound'+k+'2')),4,false,2,{x:[0,.25,.5,.75,1],y:[0,.5,1]});
   for(const kind of ['keeper','keeperBrush','mount'])this.sliceAtlas(kind+'Walk',Array.from({length:8},(_,i)=>kind+i),4,true);
   this.sliceAtlas('healerMovingCare',Array.from({length:4},(_,i)=>'healerCareWalk'+i),4,true,1);
   this.sliceAtlas('healerWalk',[...Array.from({length:8},(_,i)=>'healer'+i),...Array.from({length:4},(_,i)=>'healerIdle'+i)],4,true,3);
   for(const kind of ['warden','ferryman','waterghost'])this.sliceAtlas(kind+'Motion',[
    ...['Walk','Strike',...(kind==='waterghost'?[]:['Cast'])].flatMap(mode=>Array.from({length:4},(_,i)=>kind+mode+i)),
    ...Array.from({length:4},(_,i)=>'depart'+kind+i)
   ],4,true,kind==='waterghost'?3:4);
   this.sliceAtlas('enemyDefeat',['skirt','horse','boss'].flatMap(k=>Array.from({length:4},(_,i)=>'depart'+k+i)),4,4,3);
   this.sliceAtlas('allyDefeat',['girl','haetae','cow','keeper','rabbit','scholar','healer','mount'].flatMap(k=>[k==='scholar'?'legacyDefeatScholar0':'defeat'+k+'0',k==='scholar'?'legacyDefeatScholar1':'defeat'+k+'1']),4,2,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   this.sliceAtlas('allyHurt',['girl','haetae','cow','keeper','rabbit','scholar','healer','mount','umbrella','keeperBrush'].map(k=>k==='scholar'?'legacyHurtScholar':k==='cow'?'legacyHurtCow':'hurt'+k),5,false,2,{x:[[0,354,824,1266,1675,1983],[0,360,732,1184,1650,1983]].map(row=>row.map(x=>x/1983)),y:[0,384/793,1]});
   this.sliceAtlas('scholarWalk',[...Array.from({length:8},(_,i)=>'scholar'+i),'hurtscholar','scholarIdle0','scholarRecover0','scholarRecover1','defeatscholar0','defeatscholar1','scholarIdle1','scholarDisplay'],4,true,4,{x:[[0,328,654,984,1312],[0,318,706,1035,1312],[0,340,656,984,1312],[0,334,656,980,1312]].map(row=>row.map(x=>x/1312)),y:[0,349/1199,646/1199,927/1199,1]},Array(16).fill(0));
   this.sliceAtlas('umbrellaMotion',Array.from({length:8},(_,i)=>'umbrella'+i),4,true);
   this.sliceAtlas('healerPrayer',['healerPray0','healerPray1'],2,true,1);
   const cowNames=[...Array.from({length:48},(_,i)=>'cow'+i),...Array.from({length:48},(_,i)=>'cowRun'+i),...Array.from({length:48},(_,i)=>'cow'+(48+i)),'cow96',...Array.from({length:29},(_,i)=>'cowEmotion'+i),'hurtcow',...Array.from({length:MOTION.cow.angerFrames},(_,i)=>'cowAnger'+i),...Array.from({length:12},(_,i)=>'cowRageRun'+i)];
   this.sliceAtlas('cowVideo',cowNames,12,true,24,{x:Array.from({length:13},(_,i)=>i/12),y:Array.from({length:25},(_,i)=>i/24)});
   for(const spec of [COW_REST,...COW_IDLE])this.sliceAtlas(spec.asset,Array.from({length:spec.frames},(_,i)=>spec.prefix+i),8,true,spec.rows,{x:Array.from({length:9},(_,i)=>i/8),y:Array.from({length:spec.rows+1},(_,i)=>i/spec.rows)});
   this.sliceAtlas('cowHealing',Array.from({length:COW_HEAL.frames},(_,i)=>'cowRecoverVideo'+i),8,true,7,{x:Array.from({length:9},(_,i)=>i/8),y:Array.from({length:8},(_,i)=>i/7)});
   for(const [sheet,rows] of [['combatFX',['Impact','Slash','Curse','Dust']],['magicFX',['Seal','Ward','Leaf','Smoke']]])this.sliceAtlas(sheet,rows.flatMap(kind=>Array.from({length:4},(_,i)=>'fx'+kind+i)),4,4,4);
   this.sliceAtlas('cleanFX',['CleanImpact','CleanSlash','CleanCurse','CleanGuard'].flatMap(kind=>Array.from({length:4},(_,i)=>'fx'+kind+i)),4,4,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   this.sliceAtlas('actionIcons',['iconKeeper','iconRabbit','iconCharm','iconStomp','iconShelter','iconSound']);
   this.sliceAtlas('livingScenery',['pine','mist','dragon','grass'],2);
   this.sliceAtlas('enemyAttacks',['skirt','horse','reaper','bossLegacy'].flatMap(kind=>Array.from({length:4},(_,i)=>kind+'Strike'+i)),4,4,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
  }
  initializeWorld(){
   this.root=this.add.container(0,0);
   this.sky=this.add.graphics();this.root.add(this.sky);
   this.skyPlate=this.add.image(0,0,'__WHITE').setOrigin(0,0).setVisible(false);this.root.add(this.skyPlate);
   this.moon=this.add.image(0,0,'moon');this.root.add(this.moon);
   this.depths={};
   this.mists=[0,1,2].map(()=>this.add.image(0,0,'mist').setAlpha(.12));this.root.add(this.mists[0]);
   this.depths.far=[this.add.image(0,0,'__WHITE').setOrigin(0,1)];this.root.add(this.depths.far);
   // Atmospheric mist belongs behind the near architecture, never over its fine lines.
   this.root.add(this.mists.slice(1));
   const detailArea=AREAS.find(area=>area.detailFiles.length&&area.detailOverlap!==0);
   this.depths.middle=[0,1,2].map(i=>this.add.image(0,0,'__WHITE').setOrigin(0,1));this.root.add(this.depths.middle);
   this.detailJoin=this.add.image(0,0,'__WHITE').setOrigin(0,1).setAlpha(0,1,0,1);this.root.add(this.detailJoin);
   // Fixed decoration pool: distant warfare never joins the playable combat model.
   this.battleFX=this.add.graphics();this.root.add(this.battleFX);
   this.battleGroups=[.21,.51,.81].map(u=>({u,actors:['spear','archer','mangtae','shadow'].map(k=>this.add.image(0,0,'__WHITE').setOrigin(.5,1))}));
   for(const group of this.battleGroups)this.root.add(group.actors);
   this.dragon=this.add.image(0,0,'dragon').setAlpha(.25);this.root.add(this.dragon);
   this.pines=[0,1,2,3].map(()=>this.add.image(0,0,'pine').setOrigin(.5,1).setAlpha(.6));this.root.add(this.pines);
   this.road=this.add.graphics();this.root.add(this.road);
   // Reflections sit over the river but below opaque stones; transparent arches reveal them.
   this.reflections=new Map();this.waterReflections=this.add.container(0,0);this.root.add(this.waterReflections);
   this.pathTiles=ROAD_SECTIONS.map(part=>this.add.image(0,0,'__WHITE').setOrigin(0,0));this.root.add(this.pathTiles);
   this.decor=this.add.graphics();this.root.add(this.decor);
   this.gate=this.add.image(0,0,'__WHITE').setOrigin(.5,1);this.root.add(this.gate);
   this.gateLip=this.add.image(0,0,'__WHITE').setOrigin(.5,1);this.root.add(this.gateLip);
   this.gateFragments=Array.from({length:3},()=>this.add.image(0,0,'__WHITE').setOrigin(.5,1).setVisible(false));this.root.add(this.gateFragments);
   this.gateMist=this.add.image(0,0,'fxSmoke1').setOrigin(.5,1);this.root.add(this.gateMist);
   this.shadows=this.add.graphics();this.root.add(this.shadows);
   this.hero=this.add.image(0,0,'haetae').setOrigin(.5,1);this.girl=this.add.image(0,0,'girl').setOrigin(.5,1);
   this.root.add([this.hero,this.girl]);
   this.ward=this.add.image(0,0,'fxWard1').setOrigin(.5,1).setVisible(false);this.root.add(this.ward);
   this.waterWard=this.add.image(0,0,'waterWard').setOrigin(.5,1).setVisible(false);this.root.add(this.waterWard);
   this.cloud=this.add.image(0,0,'cloud').setOrigin(.5,1).setAlpha(0);this.root.add(this.cloud);
   this.fx=this.add.graphics();this.root.add(this.fx);
   this.near=[0,1,2,3,4,5].map(()=>this.add.image(0,0,'grass').setOrigin(.5,1));this.root.add(this.near);
   this.tags=new Map();
   this.exitLabel=this.add.text(0,0,'집으로 가는 길',{fontFamily:'AppleMyungjo,serif',fontSize:'22px',color:'#776850'}).setOrigin(.5);
   this.root.add(this.exitLabel);
   this.resize();this.scale.on('resize',()=>this.resize(false));
   // Browser toolbar movement changes the stage without always resizing the layout viewport.
   this.stageObserver=new ResizeObserver(()=>this.resize());this.stageObserver.observe(document.getElementById('game'));
   this.events.once('shutdown',()=>this.stageObserver.disconnect());
   this.input.keyboard?.on('keydown',e=>{if(['ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();});
  }
  resize(syncScale=true){
   if(!this.root)return;
   const bounds=document.getElementById('game').getBoundingClientRect(),density=Math.min(3,Math.max(1.5,window.devicePixelRatio||1));
   const width=Math.round(bounds.width*density),height=Math.round(bounds.height*density);
   if(width<=0||height<=0)return;
   // ResizeObserver can run before Phaser polls the parent. FIT must consume the
   // current CSS bounds before it refreshes the high-density drawing surface.
   // Phaser refresh emits resize synchronously. Its listener only lays out the
   // scene; the DOM observer owns synchronization back into ScaleManager.
   if(syncScale){
    const parentChanged=this.scale.getParentBounds();
    if(this.scale.gameSize.width!==width||this.scale.gameSize.height!==height)this.scale.setGameSize(width,height);
    else if(parentChanged)this.scale.refresh();
   }
   const phone=bounds.width<=760;
   // Keep the old battle viewport and foot height while painting more river behind the deck.
   const deck=document.querySelector('.control-deck').getBoundingClientRect().height;
   const battleHeight=Math.max(1,bounds.height-deck),viewHeight=phone?Math.max(440,Math.min(620,620*2.35/(bounds.width/battleHeight))):620;
   const tiled=AREAS.find(area=>area.roadTiles)?.roadTiles;
   if(tiled){const cycle=tiled.reduce((sum,tile)=>sum+tile.width,0),needed=(Math.ceil(width/(battleHeight*density/viewHeight)/cycle)+1)*tiled.length;
    while(this.pathTiles.length<needed){const im=this.add.image(0,0,'__WHITE').setOrigin(0,0);this.pathTiles.push(im);this.root.addAt(im,this.root.getIndex(this.pathTiles[0]));}}
   this.viewHeight=viewHeight;this.unit=battleHeight*density/viewHeight;this.vw=width/this.unit;this.root.setScale(this.unit);this.root.y=(viewHeight-620)*this.unit;
   this.sceneBottom=620+deck*density/this.unit;
   this.game.canvas.dataset.viewHeight=String(Math.round(viewHeight));
   this.game.canvas.dataset.renderDensity=String(density);
  }
  drawLandscape(region,blend,t){
   const vw=this.vw,g=this.sky,bottom=this.sceneBottom||780;g.clear();
   const area=AREAS[region],panorama=area.panorama,painting=area.paintingFoot!==undefined;
   const state=skyState(model.progress(),t,region),day=state.night===0,waterway=area.ground==='water';
   g.fillGradientStyle(day?0xa8d4e5:0x1b304d,day?0xc8e7ee:0x253e59,day?0xf5eacd:0x7994a2,day?0xd0dabb:0x5c7d90,1);g.fillRect(0,0,vw,bottom);
   const top=620-(this.viewHeight||620),moonY=top+(panorama?160:200)-state.moon.height*(panorama?85:140);
   let moonX=(state.moon.x+(panorama?.29-skyState(0,0,region).moon.x:0))*vw;
   g.fillStyle(0xf9df9e,.045);g.fillCircle(moonX,moonY,109);
   this.moon.setTexture(area.moonFile?area.texture+'Moon':'moon').setPosition(moonX,moonY).setDisplaySize(panorama?190:145,panorama?190:145).setVisible(state.moon.visible);
   if(day){g.fillStyle(0xfff4c5,.13);g.fillCircle(moonX,moonY,73);g.fillStyle(0xfff9dc,.95);g.fillCircle(moonX,moonY,39);}
   for(let i=0;i<(day||panorama?0:27);i++){const x=(i*197+43)%Math.max(1,vw),y=top+35+(i*79)%190;g.fillStyle(0xf4e9c9,.18+.23*(.5+.5*Math.sin(t*.45+i)));g.fillCircle(x,y,i%4===0?1.3:.8);}
   this.skyPlate.setVisible(!!panorama&&!painting);
   // Finished paintings keep their fine brushwork; the same moon stays on its existing clock.
   const moonBackdrop=painting?this.detailJoin:this.skyPlate;
   if(this.root.getIndex(this.moon)!==this.root.getIndex(moonBackdrop)+1)this.root.moveAbove(this.moon,moonBackdrop);
   if(area.paintingSingle){
    // One authored painting covers the short chapter; no mirrored or transparent terrain seams.
    const src=this.textures.get(area.texture).getSourceImage(),scale=Math.max((GROUND-top)/(src.height*area.paintingFoot),(vw+Math.max(4800,stageGateX(region))*PARALLAX.far+80)/src.width);
    const left=-40-this.offset*PARALLAX.far,paintingTop=GROUND-src.height*area.paintingFoot*scale,floor=paintingTop+src.height*scale;
    this.depths.far.forEach(im=>im.setVisible(false));this.mists.forEach(im=>im.setVisible(false));
    this.depths.middle[0].setTexture(area.texture).setOrigin(0,0).setPosition(left,paintingTop).setDisplaySize(src.width*scale,src.height*scale).setAlpha(1).setVisible(true).setFlipX(false);
    this.depths.middle.slice(1).forEach(im=>im.setVisible(false));this.detailJoin.setVisible(false);
    this.skyPlate.setTexture(area.texture,'waterFooter').setOrigin(0,0).setPosition(0,floor-.5).setDisplaySize(vw,Math.max(1,bottom-floor+1)).setVisible(bottom>floor);
    moonX=left+(state.moon.x+.29-skyState(0,0,region).moon.x)*src.width*scale;
    this.moon.setPosition(moonX,paintingTop+src.height*(.275-state.moon.height*.16)*scale).setDisplaySize(src.height*.225*scale,src.height*.225*scale);
    if(area.skyInPainting)this.moon.setVisible(false);
   }else if(panorama){
    const src=this.textures.get(area.texture).getSourceImage(),w=Math.max(vw+stageGateX(region)*PARALLAX.far+80,(bottom-top)*src.width/src.height),h=w*src.height/src.width;
    if(!painting)this.skyPlate.setTexture(area.texture+'Sky').setPosition(-40,top).setDisplaySize(w,h);
    if(!painting)this.mists[0].setTexture(area.texture+'Clouds').setOrigin(0,0).setPosition(-40+Math.sin(t/180)*120,top).setDisplaySize(w,h).setAlpha(.82).setVisible(true);else this.mists[0].setVisible(false);
    this.mists.slice(1).forEach(im=>im.setVisible(false));
    this.depths.far[0].setTexture(area.texture).setOrigin(0,0).setFlipX(false).setPosition(-40-this.offset*PARALLAX.far,top).setDisplaySize(w,h).setTint(0xffffff).setAlpha(1).setVisible(!painting);
    const sources=area.detailFiles.map((_,i)=>this.textures.get(area.texture+'Detail'+i).getSourceImage()),overlap=area.detailOverlap;
    const total=sources.reduce((sum,image)=>sum+image.width,0)-overlap;
    // A complete landscape shares the mountain plane, rather than cropping its sky as near scenery.
    const parallax=painting?PARALLAX.far:PARALLAX.middle;
    const scale=Math.max(painting?(GROUND-top)/(sources[0].height*area.paintingFoot):w/src.width,(vw+4800*parallax+80)/total),left=-40-this.offset*parallax;
    const detailTop=painting?GROUND-sources[0].height*area.paintingFoot*scale:top;
    // Extend only the river below the painting behind the controls; never enlarge its sky to fill the deck.
    if(painting){const floor=detailTop+sources[0].height*scale;this.skyPlate.setTexture(area.texture+'Detail0','waterFooter').setPosition(0,floor-.5).setDisplaySize(vw,Math.max(1,bottom-floor+1)).setVisible(bottom>floor);}
    if(painting){moonX=left+(state.moon.x+.29-skyState(0,0,region).moon.x)*sources[0].width*scale;const size=sources[0].height*.225*scale;this.moon.setPosition(moonX,detailTop+sources[0].height*(.275-state.moon.height*.16)*scale).setDisplaySize(size,size);}
    const edge=left+(sources[0].width-overlap)*scale;
    this.depths.middle[0].setTexture(area.texture+'Detail0','body').setOrigin(0,0).setPosition(left,detailTop).setDisplaySize((sources[0].width-overlap)*scale,sources[0].height*scale).setAlpha(1).setVisible(true).setFlipX(false);
    this.depths.middle[1].setTexture(area.texture+'Detail1','body').setOrigin(0,0).setPosition(edge+overlap*scale,detailTop).setDisplaySize((sources[1].width-overlap)*scale,sources[1].height*scale).setAlpha(1).setVisible(true).setFlipX(false);
    // Both sides of an alpha scene fade across the same gutter, including pine branches.
    this.depths.middle[2].setTexture(area.texture+'Detail0','tail').setOrigin(0,0).setPosition(edge,detailTop).setDisplaySize(overlap*scale,sources[0].height*scale).setAlpha(...(painting?[1]:[1,0,1,0])).setVisible(true).setFlipX(false);
    this.detailJoin.setTexture(area.texture+'Detail1','join').setOrigin(0,0).setPosition(edge,detailTop).setDisplaySize(overlap*scale,sources[1].height*scale).setVisible(true);
   }else for(const depth of ['far','middle']){
    // Authored sections overlap in world space; never mirror, repeat or stretch a small atlas row.
    const area=AREAS[region],pool=this.depths[depth],parts=depth==='far'?pool:pool.slice(0,area.detailFiles.length),w=Math.max(depth==='far'?2300:2800,vw+stageGateX(region)*PARALLAX[depth]+80);
    const sources=parts.map((_,i)=>this.textures.get(depth==='far'?area.texture:area.texture+'Detail'+i).getSourceImage());
    pool.forEach((im,i)=>im.setVisible(i<parts.length));
    const overlap=depth==='middle'?(area.detailOverlap??LANDSCAPE_OVERLAP):0,total=sources.reduce((sum,src)=>sum+src.width,0)-overlap*(parts.length-1),scale=w/total;
    let x=-40-this.offset*PARALLAX[depth];
    parts.forEach((im,i)=>{
     const src=sources[i],h=depth==='far'?Math.floor(src.height*area.split):src.height;
     const join=i?overlap:0;
     im.setTexture(depth==='far'?area.texture:area.texture+'Detail'+i,depth==='far'?'far':i&&overlap?'body':'__BASE').setFlipX(false).setDisplaySize((src.width-join)*scale,h*scale).setOrigin(0,1).setPosition(x+join*scale,depth==='far'?525:544).setTint(0xffffff).setAlpha(depth==='far'?(day?.86:.94):1);
     this.detailJoin.setVisible(overlap>0);
     if(join)this.detailJoin.setTexture(area.texture+'Detail'+i,'join').setOrigin(0,1).setDisplaySize(join*scale,h*scale).setPosition(x,544);
     x+=(src.width-overlap)*scale;
    });
   }
   this.drawBackgroundBattle(region,t);
   this.mists.forEach((im,i)=>{if(panorama)return;im.setTexture('mist').setOrigin(.5).setVisible(true);const w=390+i*170,src=im.texture.getSourceImage();im.setDisplaySize(w,w*src.height/src.width).setPosition(((i*670+t*(3+i)-this.offset*.07)%(vw+650)+vw+650)%(vw+650)-300,top+100+i*94).setTint(0xc4d2dd).setAlpha(day?.055:.12+i*.015);});
   const fly=(t+8)%75,ds=this.dragon.texture.getSourceImage();this.dragon.setVisible(!panorama&&fly<18).setDisplaySize(140,140*ds.height/ds.width).setPosition(-170+(vw+340)*fly/18,top+95+Math.sin(fly*.55)*14).setAngle(Math.sin(fly*.8)*3);
   this.pines.forEach((im,i)=>{const src=im.texture.getSourceImage(),h=230+(i%2)*55;im.setDisplaySize(h*src.width/src.height,h).setPosition(i*1040-this.offset*.48-80,534).setVisible(!panorama&&!waterway&&region===0).setTint(day?0xb9c7a3:0x83969a).setAlpha(day?.16:.78).setAngle(Math.sin(t*.6+i*2)*1.1);});
   const water=this.road;water.clear();
   if(!panorama){water.fillGradientStyle(day?0xc6b792:waterway?0x629eaa:0x7794a2,day?0xbca985:waterway?0x387b91:0x55798c,day?0x776e55:0x1b354a,day?0x68634e:0x152b3e,1);water.fillRect(0,535,vw,bottom-535);}
   // The lunar reflection widens toward the viewer; waves drift independently of solid ground.
   for(let i=0;i<(day?0:47);i++){
    const y=540+i*6;if(y>bottom)break;
    const spread=24+i*3.1,x=moonX+Math.sin(i*1.7+t*.8)*spread*.35;
    water.lineStyle(i%4===0?2.3:1,waterway?0xe6f4ff:0xffe2a1,.07+(i%5)*.026);
    water.lineBetween(x-spread*.5,y,x+spread*.5+Math.sin(t+i)*9,y);
   }
   for(let i=0;i<(day||panorama?0:80);i++){
    const x=((i*173-this.offset*.14+t*(i%3+1))%(vw+240)+vw+240)%(vw+240)-120,y=545+(i*37)%Math.max(1,bottom-545);
    water.lineStyle(1,i%3?0xb3c9cb:0xeee8cf,.08+(i%4)*.027);water.lineBetween(x,y,x+17+i%5*8,y);
   }
   // Scenery only: the seven authored tiles wrap in order without any reflection.
   this.pathTiles.forEach((im,i)=>{
    if(area.paintingSingle){im.setVisible(false);return;}
    if(!area.roadTiles&&i>=ROAD_SECTIONS.length){im.setVisible(false);return;}
    const tiles=area.roadTiles,part=tiles?tiles[i%tiles.length]:ROAD_SECTIONS[i];
    const total=tiles?tiles.reduce((sum,tile)=>sum+tile.width,0):1536*ROAD_SECTIONS.length;
    let x=tiles?part.x+Math.floor(i/tiles.length)*total-((this.offset*PARALLAX.ground%total)+total)%total:part.x-this.offset*PARALLAX.ground;
    if(!tiles&&model.status==='ready')x=((x+part.width)%total+total)%total-part.width;
    const foot=tiles?part.foot:area.roadFeet?.[i]??part.foot;
    im.setTexture(tiles?area.roadAtlas?area.texture+'RoadAtlas':area.texture+'Road'+i%tiles.length:waterway?'nightRoad':area.ground,tiles?area.roadAtlas?part.frame:'__BASE':part.frame).setFlipX(false).setPosition(x,GROUND-foot).setDisplaySize(part.width+(tiles?0:.5),part.height).setTint(tiles||day?0xffffff:0xd7e2e5).setVisible(!waterway&&x<vw&&x+part.width>0);
   });
   // Endless water has no artificial walking boundary or decorative land islands.
   for(let i=0;i<(waterway?0:12);i++){const x=((i*181+t*5)%Math.max(1,vw)),y=GROUND-25+Math.sin(t*.8+i)*17;water.fillStyle(0xdceab3,.2+.3*Math.sin(t*2+i)**2);water.fillCircle(x,y,1.7);}
   this.near.forEach((im,i)=>{const src=im.texture.getSourceImage(),h=64+(i%2)*31;im.setDisplaySize(h*src.width/src.height,h).setPosition(i*560-this.offset*PARALLAX.near-100,bottom+8).setVisible(!panorama&&!waterway&&region===0).setTint(day?0xa9a478:0x9fb5bd).setAlpha(.8).setAngle(Math.sin(t*.9+i)*.8);this.root.bringToTop(im);});
  }
  drawBackgroundBattle(region,t){
   if(!this.battleGroups)return;
   const g=this.battleFX;g.clear();
   const panorama=Math.max(2800,this.vw+stageGateX(region)*PARALLAX.middle+80),left=-40-this.offset*PARALLAX.middle;
   this.battleGroups.forEach((group,i)=>{
    const x=left+group.u*panorama,visible=region===1&&x>-220&&x<this.vw+220;
    group.actors.forEach(im=>im.setVisible(visible));if(!visible)return;
    const period=5.4+i*.6,q=((t+i*1.3)%period)/period;
    const spear=q<.15?0:q<.28?1:q<.44?2:3,archer=q<.14?0:q<.29?1:q<.49?2:3;
    const struck=q>=.40&&q<.54,reply=q>=.66&&q<.8;
    const frames=[spear,archer,struck?2:reply?1:0,struck?2:reply?1:0],positions=[x-33,x-108,x+35+(struck?14:0)-(reply?10:0),x+93+(struck?10:0)-(reply?20:0)];
    const sizes=[38,36,37,35],base=495-i%2*9;
    group.actors.forEach((im,j)=>{const key='battle'+['spear','archer','mangtae','shadow'][j]+frames[j],src=this.textures.get(key).getSourceImage();im.setTexture(key).setOrigin(.5,this.grounding.get(key)??1).setDisplaySize(sizes[j]*src.width/src.height,sizes[j]).setPosition(positions[j],base).setAlpha(.9).setTint(0xd9d8c0);});
    // Draw -> release -> flight -> recoil. A single phase owns every distant consequence.
    if(q>=.29&&q<.41){const p=(q-.29)/.12,ax=x-90+p*129,ay=base-39-Math.sin(p*Math.PI)*10;g.lineStyle(2,0x453c2c,.85);g.lineBetween(ax-12,ay,ax+7,ay-1);g.fillStyle(0xece0b1,.95);g.fillTriangle(ax+7,ay-1,ax+2,ay-4,ax+2,ay+2);}
    if(struck){const a=1-(q-.4)/.14;g.lineStyle(2,0xffecb1,a);for(let k=0;k<5;k++){const angle=k*1.26;g.lineBetween(x+36+Math.cos(angle)*3,base-36+Math.sin(angle)*3,x+36+Math.cos(angle)*14,base-36+Math.sin(angle)*14);}}
    if(reply){g.lineStyle(2,0x678b92,.55);g.beginPath();g.arc(x-6,base-38,20,-1.5,.8);g.strokePath();}
    for(let k=0;k<3;k++){const phase=(t*.08+i*.21+k*.3)%1;g.fillStyle(0x574e45,(1-phase)*.12);g.fillEllipse(x+82+k*13+Math.sin(phase*5)*9,base-18-phase*78,17+phase*31,21+phase*40);}
    const ember=(t*.4+i*.13)%1;g.fillStyle(0xe9af53,(1-ember)*.7);g.fillCircle(x+71,base-5-ember*28,1.5);
   });
  }
  patientUnderAttack(targetActor){
   // Read existing combat ownership; no new combat state or delayed heal queue.
   const patient=targetActor==null?model:model.allies.find(a=>a.id===targetActor&&a.hp>0);
   if(!patient)return true;
   return patient.hit>0||model.enemies.some(e=>e.hp>0&&!(e.stun>0)&&(
    e.action?.kind==='enemy'&&e.action.targetId===targetActor||
    e.engagedId===targetActor&&contactGap(e,patient)<=ENEMIES[e.type].range+18
   ))||model.projectiles.some(p=>p.enemy&&p.targetId===targetActor);
  }
  recoveryCel(kind,targetActor){
   if(!['girl','haetae','cow','keeper','rabbit','scholar','healer'].includes(kind))return null;
   const effect=this.effects.find(e=>e.type==='heal'&&!e.enemy&&e.amount>0&&e.targetActor===targetActor),age=effect?model.time-(effect.at??model.time-effect.t):Infinity;
   if((kind==='cow'||TRAVELLER_VIDEO[kind])&&this.patientUnderAttack(targetActor))return null;
   if(kind==='cow')return age>=0&&age<COW_HEAL.duration?'cowRecoverVideo'+Math.min(COW_HEAL.frames-1,Math.floor(age*COW_HEAL.fps)):null;
   if(VIDEO_MOTION[kind]){const spec=VIDEO_MOTION[kind].receiveHeal;return age>=0&&age<spec.frames/spec.fps?spec.prefix+Math.min(spec.frames-1,Math.floor(age*spec.fps)):null;}
   return age>=0&&age<.9?kind+'Recover'+(age<.24?0:1):null;
  }
  drawPatientRecovery(patient,kind,p,tail,effect){
   if(!patient)return;
   const g=this.fx,point=this.bodyPoint(patient,kind),w=patient.displayWidth,h=patient.displayHeight,dir=patient.flipX?-1:1;
   const styles={king:[0xffdd91,.1,.6,3],prince:[0xb9e8ed,.16,.58,2],minister:[0xa8edcd,.12,.62,3],cavalry:[0xe4d8a4,.28,.78,4],cow:[0xffd98b,.28,.72,3],haetae:[0xb8f1d8,.25,.69,4],girl:[0xffe3a6,.17,.62,2],keeper:[0xccf2cc,.12,.58,2],rabbit:[0xd7f3a8,.16,.78,3],scholar:[0xb0f0ce,.12,.60,2],healer:[0xb6e3fb,.16,.62,2]},style=styles[kind]||styles.haetae;
   const [color,side,vertical,count]=style,bandX=patient.x+dir*w*side,bandY=patient.y-(patient.originY-vertical)*h;
   g.fillStyle(color,tail*.12);g.fillEllipse(point.x,point.y,Math.min(130,w*.7),h*.45);
   // Floating crosses leave the body once emitted; store world space on this
   // existing effect so pose/recoil cannot shake them and camera movement stays correct.
   const origins=effect?(effect.recoveryOrigins??={}):{},origin=origins[kind]??(origins[kind]={x:point.x+this.offset,y:point.y-h*.23,spacing:Math.min(25,w*.18)});
   // The source video contains only the character. Transparent green light and
   // warm flecks share the real healing event, never an independent HP clock.
   if(effect?.sourceKind==='healer'){
    const glowX=origin.x-this.offset,glowY=origin.y+24-12*p,pulse=Math.sin(Math.PI*Math.min(1,p*3));
    for(let radius=32;radius>=8;radius-=4){g.fillStyle(0x8bea91,Math.max(0,pulse)*.025);g.fillCircle(glowX,glowY,radius*(1+p*.25));}
    for(let i=0;i<9;i++){const a=i*2.399,reach=10+30*p;g.fillStyle(i%2?0xf3d28c:0x9aebac,tail*.7);g.fillCircle(glowX+Math.cos(a)*reach,glowY+Math.sin(a)*reach-28*p,1.4+tail);}
   }
   for(let i=0;i<count;i++){const xx=origin.x-this.offset+(i-(count-1)/2)*origin.spacing,yy=origin.y-40*p-i%2*12,r=5+(1-p)*2;g.lineStyle(6,0x215747,tail);g.lineBetween(xx-r,yy,xx+r,yy);g.lineBetween(xx,yy-r,xx,yy+r);g.lineStyle(3,color,tail);g.lineBetween(xx-r,yy,xx+r,yy);g.lineBetween(xx,yy-r,xx,yy+r);}
   // Cloth wraps the specific sleeve/paw, rather than a common cloud hiding the face.
   for(let i=0;i<3;i++){g.lineStyle(2.5,0xfff7db,tail*.85);g.beginPath();g.arc(bandX,bandY+i*3,Math.min(12,w*.075),-.35,Math.PI+.2);g.strokePath();}
   if(kind==='haetae'||kind==='cow'){g.lineStyle(2,color,tail*.65);for(let i=0;i<2;i++){g.beginPath();g.arc(point.x+(i?1:-1)*w*.19,point.y-10-12*p,8+10*p,-p*3,p*3+2.7);g.strokePath();}}
   if(kind==='rabbit'){for(let i=0;i<2;i++){g.fillStyle(color,tail*.7);g.fillCircle(patient.x+dir*(i?8:-8),patient.y-h*.85-8*p,2.8);}}
   if(kind==='scholar'){g.lineStyle(2,color,tail*.65);g.strokeRect(point.x+dir*w*.1-6,point.y-7,12,16);}
   if(kind==='girl'||kind==='healer'||kind==='keeper'){g.lineStyle(2,color,tail*.65);g.strokeEllipse(bandX,bandY,17+15*p,11+7*p);}
  }
  drawReflections(t){
   // Reuse the rendered cel, injury texture, facing and foot origin; no second animation clock.
   const actors=[...this.sprites.entries(),['hero',this.hero],['girl',this.girl]],present=new Set();
   for(const [key,body] of actors){
    if(model.stage===1||!body.visible||body.x<-250||body.x>this.vw+250)continue;
    present.add(key);let strips=this.reflections.get(key);
    if(!strips){strips=[this.add.image(0,0,body.texture.key)];this.waterReflections.add(strips);this.reflections.set(key,strips);}
    // A continuous silhouette cannot tear at crop boundaries. Ripples belong to the water.
    strips[0].setTexture(body.texture.key).setOrigin(body.originX,1-body.originY).setFlipX(body.flipX).setFlipY(true)
     .setDisplaySize(body.displayWidth,body.displayHeight*.78)
     .setPosition(body.x+Math.sin(t*.8+body.x*.006)*1.4,GROUND+(AREAS[model.stage].ground==='water'?4:68)+(GROUND-body.y)*.78)
     .setAngle(-(body.angle||0)).setTint(model.stage===1?0x699c93:0xa2baca).setAlpha((AREAS[model.stage].ground==='water'?.29:.19)*(body.alpha??1));
   }
   for(const [key,strips] of this.reflections)if(!present.has(key)){strips.forEach(im=>im.destroy());this.reflections.delete(key);}
  }
  resetPresentation(){
   for(const image of [...this.sprites.values(),this.hero,this.girl].filter(Boolean)){delete image.healerVideo;delete image.travellerVideo;}
   for(const strips of this.reflections?.values()||[])strips.forEach(im=>im.destroy());this.reflections?.clear();
   for(const e of this.effects)e.sprite?.destroy();this.effects=[];this.offset=model.viewport?.left??0;this.heroPose=0;this.idleSince=null;this.shake=0;this.hitStop=0;this.impactCooldown=0;this.contacts.clear();
  }
  previewTexture(key){if(!this.textures.exists(key))return '';this.previewCache??=new Map();if(!this.previewCache.has(key))this.previewCache.set(key,this.textures.get(key).getSourceImage().toDataURL?.('image/png')||'');return this.previewCache.get(key);}
  previewReady(kind){return (!ENEMIES[kind]?.atlas||this.textures.exists(kind+'Walk0'))&&(LEGACY_FOE_SHEETS[kind]||[]).every(k=>this.loadedFiles.has(k));}
  bodyPose(base,kind){
   base=base.replace(/^injured[12]__/, '');
   const profile=WOUNDS[base.startsWith('keeperBrush')?'keeperBrush':kind];
   if(!profile)return {x:.5,y:.5,w:.4,h:.4,angle:0};
   let n=Number(base.match(/(\d+)$/)?.[1]||0),poses=profile.poses;
   if(base.includes('Idle')||base.includes('Recover')){const a=profile.poses[0];return {x:a[0],y:a[1],angle:0,w:profile.size[0],h:profile.size[1]};}
   if(base.includes('Cast')&&profile.cast){const a=profile.cast[n%profile.cast.length];return {x:a[0],y:a[1],angle:a[2],w:profile.size[0],h:profile.size[1]};}
   if(kind==='cow'&&n===56)n=10;
   const attack=base.includes('Strike')||base.endsWith('Cast')||(!base.includes('Walk')&&n>=(kind==='cow'?48:4));
   if(attack){poses=profile.attack;n=base.includes('Strike')?n:Math.max(0,n-(kind==='cow'?48:4));}
   // The imported cow video has 48 exposures: interpolate the measured torso sockets only.
   const phase=kind==='cow'&&!attack?n/8:n,i=Math.floor(phase)%poses.length,j=(i+1)%poses.length,q=phase%1;
   const a=poses[i],b=poses[j];
   return {x:a[0]+(b[0]-a[0])*q,y:a[1]+(b[1]-a[1])*q,angle:a[2]+(b[2]-a[2])*q,w:profile.size[0],h:profile.size[1]};
  }
  bodyPoint(image,kind,side=0,weapon=false){
   const base=image.texture.key.replace(/^injured[12]__/, ''),profile=WOUNDS[base.startsWith('keeperBrush')?'keeperBrush':kind];
   const body=weapon&&profile?.muzzle?{x:profile.muzzle[0],y:profile.muzzle[1],w:0}:this.bodyPose(base,kind),sx=(image.flipX?-1:1),angle=image.rotation||0;
   const x=((sx<0?1-body.x:body.x)-(image.originX??.5)+side*body.w*.38)*image.displayWidth,y=(body.y-(image.originY??1))*image.displayHeight;
   return {x:image.x+x*Math.cos(angle)-y*Math.sin(angle),y:image.y+x*Math.sin(angle)+y*Math.cos(angle)};
  }
  injuryTexture(base,kind,hp,maxHp){
   // Bounded by existing poses × two health bands; never allocated every draw or per actor.
   base=base.replace(/^injured[12]__/, '');
   const level=injuryLevel(hp,maxHp);if(!level||!WOUNDS[kind])return base;
   const key='injured'+level+'__'+base;if(this.injuryTextures.has(key))return key;
   const source=this.textures.get(base).getSourceImage(),height=Math.min(source.height,Math.ceil((BODY_HEIGHT[kind]||188)*2));
   const width=Math.max(1,Math.round(height*source.width/source.height));
   const patch=document.createElement('canvas');patch.width=width;patch.height=height;
   const paint=patch.getContext('2d');
   const body=this.bodyPose(base,kind),profile=WOUNDS[base.startsWith('keeperBrush')?'keeperBrush':kind];
   // Existing scars persist at low HP; the second mark is additive, not a replacement sticker.
   for(let i=0;i<level;i++){
    const mark=this.textures.get('wound'+profile.materials[i]+(i?2:1)).getSourceImage();
    const h=height*body.h*(i?.37:.47),w=h*mark.width/mark.height;
    paint.save();paint.translate(body.x*width,body.y*height);paint.rotate(body.angle);
    const spot=profile.spots?.[i]||[i?.19:-.16,i?.15:-.10];paint.translate(spot[0]*body.w*width,spot[1]*body.h*height);
    paint.globalAlpha=i?.72:.82;paint.rotate(i?.22:-.12);paint.drawImage(mark,-w/2,-h/2,w,h);paint.restore();
   }
   paint.globalCompositeOperation='destination-in';paint.drawImage(source,0,0,width,height);
   const texture=this.textures.createCanvas(key,width,height),ctx=texture.getContext();ctx.drawImage(source,0,0,width,height);
   // Multiply lets the character's own watercolour and cloth folds remain visible through damage.
   ctx.globalCompositeOperation=profile.materials[0]==='Dark'?'source-over':'multiply';ctx.drawImage(patch,0,0);ctx.globalCompositeOperation='source-over';texture.refresh();
   this.grounding.set(key,this.grounding.get(base)??1);if(this.celScale.has(base))this.celScale.set(key,this.celScale.get(base));if(this.registrationX.has(base))this.registrationX.set(key,this.registrationX.get(base));this.injuryTextures.set(key,true);return key;
  }
  placeOnGround(image,x,height,groundY=GROUND){
   const src=image.texture.getSourceImage();height*=this.celScale.get(image.texture.key)??1;
   const rx=this.registrationX.get(image.texture.key)??.5;
   image.setOrigin(image.flipX?1-rx:rx,this.grounding.get(image.texture.key)??1).setDisplaySize(height*src.width/src.height,height).setPosition(x,groundY).setAngle(0);
   if(AREAS[model.stage].ground==='water'){const pulse=.5+.5*Math.sin(model.time*2+x*.02);this.shadows.lineStyle(1,0xeaf5ff,.28);this.shadows.strokeEllipse(x,groundY+2,Math.min(130,image.displayWidth*.8)+pulse*9,10+pulse*3);return;}
   const contactWidth=Math.min(image.displayWidth*.92,image.displayHeight*1.15);
   this.shadows.fillStyle(0x18221f,.24);this.shadows.fillEllipse(x,groundY+3,contactWidth,12);
   this.shadows.fillStyle(0x101916,.48);this.shadows.fillEllipse(x,groundY+1,contactWidth*.84,5);
  }
  trackContact(key,kind,walk,moving,x,groundY=GROUND){
   const beat=Math.floor(walk*MOTION[kind].walkFps/(MOTION[kind].walkFrames||4)*2),previous=this.contacts.get(key);
   this.contacts.set(key,beat);
   if(model.status!=='playing'||!moving||previous===undefined||previous===beat)return;
   const e={type:'footstep',kind,x,groundY};this.effects.push({...e,t:0,duration:AREAS[model.stage].ground==='water'?.65:.32});
   onEvents([e]);
  }
  playEvents(events){
   // Allocate once at event intake. Painting (including paused painting) never adds effects.
   for(const event of events){
    const e={...event};
    // Overlapping actors share the road; summon order must never change foot height.
    e.groundY=GROUND;e.targetGroundY=GROUND;
    if(['hit','guard','hurt'].includes(e.type)){
     const profile=IMPACT[e.weapon]||IMPACT.physical;
     if(e.type!=='guard'&&this.impactCooldown<=0&&profile.stop){this.hitStop=profile.stop;this.impactCooldown=.2;}
     this.shake=Math.max(this.shake,profile.shake||0);
     if(e.weapon==='hex')e.art='CleanCurse';
    }
    if(['hail-impact','quake-impact','tide-impact'].includes(e.type))for(const fx of this.effects)if(fx.type===e.type.replace('-impact','')){fx.blocked=e.blocked;fx.impacted=true;}
    if(e.type==='projectile'&&e.actor==='girl')this.heroPose=.85;
    if(e.type==='vanish'){
     const living=e.actor==='hero'?this.hero:e.actor==='girl'?this.girl:this.sprites.get((e.enemy===false?'a':'e')+e.actor);
     const death=e.enemy===false?VIDEO_MOTION[e.kind]?.death:null;
     const key=death?death.prefix+'0':e.enemy===false?'defeat'+e.kind+'0':e.kind==='reaper'?'reaperDepart0':'depart'+e.kind+'0';
     const sprite=this.add.image(0,0,key).setOrigin(.5,this.grounding.get(key)??1).setFlipX(living?.flipX||false);
     const src=sprite.texture.getSourceImage(),h=BODY_HEIGHT[e.kind];sprite.setDisplaySize(h*src.width/src.height,h);this.root.add(sprite);
     this.effects.push({...e,groundY:living?.y??e.groundY,type:'depart',sprite,t:0,duration:e.kind==='reaper'?REAPER_DEPARTURE_TIME:death?death.frames/death.fps:e.enemy===false?1.8:isBoss(e.kind)?2.7:2.1});
     if(death?.audio)onEvents([{type:'motion-audio',actor:e.actor,sound:e.kind+'-death',x:e.x}]);

    }
    if(['hit','guard','hurt'].includes(e.type)&&e.damage){
     const lane=this.effects.filter(a=>a.type==='damage'&&Math.abs(a.x-e.x)<30).length%3;
     const label=this.add.text(0,0,(e.enemy===false||e.type==='hurt'?'−':'')+Math.ceil(e.damage),{fontFamily:'sans-serif',fontSize:e.enemy===false||e.type==='hurt'?'38px':e.kind==='boss'?'36px':'32px',fontStyle:'bold',color:e.enemy===false||e.type==='hurt'?'#ffad91':e.enemy?'#fff4ce':'#ffad91',stroke:'#263431',strokeThickness:6}).setOrigin(.5);
     this.root.add(label);this.effects.push({...e,type:'damage',lane,sprite:label,t:0,duration:e.enemy===false||e.type==='hurt'?.95:.66});
    }
    if(e.type==='heal'&&!e.enemy&&e.amount>0){
     const label=this.add.text(0,0,'+'+Math.round(e.amount),{fontFamily:'sans-serif',fontSize:'34px',fontStyle:'bold',color:'#c5ffd8',stroke:'#183c37',strokeThickness:6}).setOrigin(.5);
     this.root.add(label);this.effects.push({...e,type:'healingAmount',sprite:label,t:0,duration:1.05});
    }
    if(e.type==='coin'){
     const label=e.reason==='defeat'?this.add.text(0,0,'+'+e.amount,{fontFamily:'sans-serif',fontSize:'30px',fontStyle:'bold',color:'#ffe6a4',stroke:'#614528',strokeThickness:4}).setOrigin(.5):null;
     if(label)this.root.add(label);this.effects.push({...e,type:'coin',sprite:label,t:0,duration:COIN_FLIGHT_TIME+.24});
    }
    if(FX_LIFE[e.type]&&!(e.type==='vanish'&&e.enemy===false)){
     const art=e.art||(e.type==='summon'?({cow:'Dust',keeper:'Dust',rabbit:'Leaf',scholar:'Seal',healer:'Leaf',haetae:'Seal'}[e.kind]||'Seal'):e.type==='heal'&&e.enemy?'Smoke':FX_ART[e.type]);
     const sprite=art?this.add.image(0,0,'fx'+art+'0').setVisible(false):null;
     if(sprite)this.root.add(sprite);
     const recovery=e.type==='heal'&&!e.enemy&&e.amount>0?VIDEO_MOTION[e.kind]?.receiveHeal:null;
     this.effects.push({...e,art,sprite,t:0,duration:recovery?recovery.frames/recovery.fps:e.type==='heal'&&!e.enemy&&e.kind==='cow'&&e.amount>0?COW_HEAL.duration:e.type==='projectile'?e.duration:e.type==='vanish'&&e.kind==='reaper'?REAPER_DEPARTURE_TIME:e.type==='vanish'?(isBoss(e.kind)?2.7:2.1):e.type==='hit'&&e.enemy===false?ALLY_HIT_TIME:FX_LIFE[e.type]});
    }
   }
  }
  drawGate(x,t){
   const g=this.decor,front=this.fx,style=GATE_STYLES[STAGES[model.stage].gateStyle],gate=model.enemies.find(e=>e.type==='gate');
   const endedAt=model.gateBrokenAt,broken=endedAt!==undefined&&endedAt!==null;
   const p=broken?Math.min(1,(model.time-endedAt)/GATE_BREAK_TIME):0,ratio=gate?Math.max(0,gate.hp/gate.maxHp):broken?0:1;
   const visible=!!model.portal&&p<1&&x>-330&&x<this.vw+330,h=350,color=style.color,mode=style.destruction;
   this.gate.setTexture(style.texture);const source=this.gate.texture.getSourceImage(),w=h*source.width/source.height;
   const tremor=gate?.hit>0?Math.sin(t*95)*4:0;
   this.gate.setPosition(x+tremor,GROUND+13).setDisplaySize(w,h).setVisible(visible&&!broken).setAlpha(1).setTint(ratio<.34?0xc0bbb0:0xffffff);
   this.gateLip?.setTexture(style.texture).setCrop(source.width*.62,0,source.width*.38,source.height).setPosition(x+tremor,GROUND+13).setDisplaySize(w,h).setVisible(visible&&!broken).setAlpha(1).setTint(ratio<.34?0xc0bbb0:0xffffff);
   const emerging=model.enemies.some(e=>e.entering&&model.time>=(e.entryAt??e.bornAt));
   this.exitLabel.setVisible(visible);this.gateMist.setVisible(visible).setPosition(x,GROUND+3).setDisplaySize(110,230).setAlpha(broken?.6*(1-p):emerging?.38+.12*Math.sin(t*8):.16).setTint(color);
   this.gateFragments?.forEach((im,i)=>{
    const dir=i===1?-1:i===2?1:0,regions=[[0,0,source.width,source.height*.36],[0,source.height*.36,source.width/2,source.height*.64],[source.width/2,source.height*.36,source.width/2,source.height*.64]];
    let dx=dir*100*p,dy=-95*Math.sin(p*Math.PI)+170*p*p,angle=(i===0?18:dir*27)*p,alpha=1-p*p;
    if(mode==='fall'){dx=dir*32*p;dy=210*p*p;angle=dir*65*p;}
    if(mode==='unravel'){dx=dir*170*p;dy=-85*p;angle=dir*90*p;}
    if(mode==='chains'){dx=dir*220*p;dy=80*p*p;angle=dir*120*p;}
    if(['embers','paper','light'].includes(mode)){dx=dir*65*p+Math.sin(p*5+i)*20*p;dy=-(mode==='light'?260:160)*p;angle=(i-1)*55*p;alpha=1-p;}
    if(mode==='wave'){dx=dir*85*p;dy=140*p;angle=dir*16*p;alpha=1-p;}
    if(mode==='ice'||mode==='mirror'){dx=dir*180*p;dy=110*p*p;angle=dir*160*p;}
    im.setTexture(style.texture).setVisible(visible&&broken).setCrop(...regions[i]).setDisplaySize(w,h).setPosition(x+dx,GROUND+13+dy).setAngle(angle).setAlpha(Math.max(0,alpha));
   });
   if(!visible)return;
   g.fillStyle(0x233d42,.25);g.fillEllipse(x,GROUND+9,270,20);
   if(!broken){
    g.lineStyle(3,color,.45);g.strokeEllipse(x,GROUND-100,105,195);
    for(let i=0;i<7;i++){const q=(t*.3+i/7)%1;g.fillStyle(color,(1-q)*.7);g.fillCircle(x+Math.sin(i*2.4+q*3)*45,GROUND-15-q*190,2+q);}
    if(ratio<.67)for(let i=0;i<(ratio<.34?7:3);i++){
     const xx=x-75+i*24,yy=GROUND-255+i%3*48;
     front.lineStyle(2,color,.9);front.beginPath();front.moveTo(xx,yy);front.lineTo(xx-9,yy+27);front.lineTo(xx+11,yy+44);front.lineTo(xx-5,yy+76);front.strokePath();
    }
   }else{
    for(let i=0;i<18;i++){
     const a=i*2.399,xx=x+Math.sin(a)*(25+160*p),yy=GROUND-70-Math.cos(a)*80*p;
     front.lineStyle(2,color,1-p);front.fillStyle(color,1-p);
     if(mode==='wave'){front.strokeEllipse(x,GROUND+2,60+360*p+i*5,10+45*p);if(i>2)break;}
     else if(mode==='unravel'){front.beginPath();front.moveTo(x,GROUND-40);front.lineTo(xx,yy);front.lineTo(xx+Math.sin(i+p*7)*30,yy-65*p);front.strokePath();}
     else if(mode==='chains')front.strokeEllipse(xx,yy+160*p*p,14,22);
     else if(mode==='paper')front.fillRect(xx,yy-140*p,10,18);
     else if(mode==='light'){front.lineBetween(xx,yy,xx,yy-90*p);}
     else if(mode==='embers')front.fillCircle(xx,yy-130*p,2+i%3);
     else front.fillTriangle(xx-5,yy+110*p*p,xx+8,yy-12+110*p*p,xx+3,yy+12+110*p*p);
    }
   }
   this.exitLabel.setPosition(x,GROUND-h-1).setText(broken?'봉인 해제':gate?style.name+' · '+(ratio>.67?'함께 열어요':ratio>.34?'균열':'열리기 직전'):style.name+' · 귀물의 통로').setColor('#ffe3ad');
  }
  drawBossTelegraphs(){
   for(const e of model.enemies){
    if(!isBoss(e.type)||e.hp<=0||(!e.windup&&!e.action)||model.time<(e.entryAt??e.bornAt))continue;
    const a=ENEMIES[e.type].ability;if(e.action&&e.action.kind!==a.kind)continue;
    const impact=e.action?.impacts||0,color=BOSS_COLORS[a.kind]||0xd4b7e7,pulse=.55+.35*Math.sin(model.time*9)**2;
    for(const z of model.bossZones(e,e.action?.x??e.focus,impact)){
     const left=Math.max(-10,z.left-this.offset),right=Math.min(this.vw+10,z.right-this.offset);if(right<=left)continue;
     this.fx.fillStyle(color,.16*pulse);this.fx.fillRect(left,GROUND-10,right-left,14);this.fx.lineStyle(3,color,pulse);this.fx.lineBetween(left,GROUND-10,right,GROUND-10);
     for(let xx=left+12;xx<right;xx+=55){this.fx.fillStyle(color,pulse);this.fx.fillTriangle(xx,GROUND-16,xx-5,GROUND-25,xx+5,GROUND-25);}
    }
   }
  }
  drawBossCloud(boss,t){
   const departure=this.effects.find(e=>e.type==='depart'&&e.kind==='boss'),alive=!!boss;
   if(!alive&&!departure){this.cloud.setAlpha(0);return;}
   const fade=alive?1:Math.max(0,1-(t-(departure.at??t))/departure.duration);
   const charge=alive&&boss.windup>0?1-boss.windup/2.6:alive&&boss.action?.kind==='hail'?1:0;
   const x=(boss?.x??departure.x)-this.offset,y=GROUND-260+Math.sin(t*1.8)*8;
   const expansion=alive?1:1+(1-fade)*.45;
   this.cloud.setPosition(x+Math.sin(t*.75)*12,y).setDisplaySize((410+Math.sin(t*1.4)*16)*expansion,220+Math.cos(t*1.7)*9).setAngle(Math.sin(t*.8)*2).setAlpha((.76+charge*.16)*fade).setTint(charge>.7?0xd9c7ef:0xaab8cc);
   const g=this.fx;
   // A rolling rim and occasional internal lightning; hail itself uses its existing impact clock.
   for(let i=0;i<7;i++){
    const phase=(t*.16+i/7)%1,xx=x+Math.cos(phase*Math.PI*2)*145,yy=y-65+Math.sin(phase*Math.PI*2)*24;
    g.lineStyle(2,charge?0xd3c8ed:0x98bbca,fade*(.2+charge*.25));g.beginPath();g.arc(xx,yy,12+i%3*5,phase*6,phase*6+Math.PI*1.35);g.strokePath();
   }
   const flash=charge>.45&&Math.sin(t*17)>.82;
   if(flash){g.lineStyle(7,0x968bcc,.35*fade);g.lineBetween(x-48,y-127,x-15,y-95);g.lineBetween(x-15,y-95,x-38,y-68);g.lineStyle(2,0xf2edff,fade);g.lineBetween(x-48,y-127,x-15,y-95);g.lineBetween(x-15,y-95,x-38,y-68);}
   if(charge>0)for(let i=0;i<5;i++){const q=(t*.85+i*.2)%1;g.fillStyle(0xdaebfc,fade*charge*(1-q)*.7);g.fillCircle(x-115+i*57,y+q*35,2+i%2);}
  }
  videoPose(image,walk,moving,action,hit,key,kind='healer',clock=model.time,idleAllowed=true){
   // Presentation is attached to the existing sprite and discarded with it.
   const clips=VIDEO_MOTION[kind],field=kind==='healer'?'healerVideo':'travellerVideo';
   let v=image[field];if(!v||v.at>clock)v=image[field]={at:clock,since:clock,idleSince:clock,state:'idle',cast:'castHeal',cycle:-1};
   const treating=action?.kind==='healer'&&action.phase==='treat';
   if(treating&&(!v.treating||action.elapsed<v.elapsed)){
    const names=['castHeal','castHealLight','castHealBless'];v.cast=names[Math.floor(Math.random()*names.length)];v.cycle=(v.cycle+1)%HEALER_VIDEO[v.cast].cycles.length;
   }
   v.treating=treating;v.elapsed=action?.elapsed??0;
   if(moving||action||hit>0||!idleAllowed)v.idleSince=clock;
   const running=kind==='healer'?action?.phase==='approach':model.direction!==0;
   let name=hit>0?'hurt':action?.kind===kind&&kind!=='healer'?'attack':moving?(running?'run':'walk'):treating?v.cast:'idle';
   let recoveryFrame=null;
   if(name==='idle'&&!action){
    const recovery=this.recoveryCel(kind,kind==='healer'?Number(key.slice(1)):null);
    if(recovery){name='receiveHeal';recoveryFrame=Number(recovery.slice(clips.receiveHeal.prefix.length));}
    const age=clock-v.idleSince,slot=Math.floor((age-8)/14),within=(age-8)%14;
    if(!recovery&&age>8){if(v.slot!==slot){v.slot=slot;v.idle=Math.random()<.5?'dance':'annoyed';}if(within<6)name=v.idle;}
   }
   if(v.state!==name){v.state=name;v.since=clock;}
   // Supplied videos keep their source cadence. Travel distance must not slow auto walking.
   const spec=clips[name],elapsed=Math.max(0,clock-v.since);
   const cycle=moving&&spec.cycles?.[0],loopStart=cycle?.start??0,loopFrames=cycle?cycle.end-loopStart+1:spec.frames;
   let frame=recoveryFrame??loopStart+Math.floor(elapsed*spec.fps)%loopFrames;
   if(treating&&name===v.cast){const cue=spec.cycles[v.cycle],t=action.elapsed,clock=MOTION.healer;frame=Math.round(t<=clock.impact?cue.start+(cue.impact-cue.start)*Math.min(1,t/clock.impact):cue.impact+(cue.end-cue.impact)*Math.min(1,(t-clock.impact)/(clock.duration-clock.impact)));}
   if(name==='attack'&&spec.cue){const cue=spec.cue,t=action.elapsed,span=kind==='girl'?{impact:0,duration:.85}:MOTION[kind];frame=Math.round(t<span.impact?cue.start+(cue.impact-cue.start)*t/span.impact:cue.impact+(cue.end-cue.impact)*Math.min(1,(t-span.impact)/(span.duration-span.impact)));}
   const soundCycle=Math.floor(elapsed/(loopFrames/spec.fps)),playing=model.status==='playing';
   if(spec.audio&&(v.soundState!==name||v.soundCycle!==soundCycle||v.soundPlaying!==playing)){
    v.soundState=name;v.soundCycle=soundCycle;v.soundPlaying=playing;
    onEvents([{type:'motion-audio',actor:key,sound:playing?kind+'-'+name:null,offset:frame/spec.fps,x:kind==='healer'?model.allies.find(a=>'a'+a.id===key)?.x:model.x}]);
   }
   return spec.prefix+Math.max(0,Math.min(spec.frames-1,frame));
  }
  renderEntity(key,type,x,walk,hp,maxHp,hit,windup,enemy=false,moving=0,action=null,hitDir=1,groundY=GROUND,bornAt=-Infinity,entryOrigin=null,entering=false){
   let image=this.sprites.get(key);
   if(!image){image=this.add.image(0,0,MODEL_MAP[type]||type).setOrigin(.5,1);this.root.add(image);this.sprites.set(key,image);}
   if(enemy&&model.time<bornAt){image.setVisible(false);return;}image.setVisible(true).setCrop();
   if(enemy)image.setTexture(isBoss(type)?bossPose(walk,moving,action,windup,type):type+(action||windup>0?'Strike':'Walk')+(action?enemyAttackFrame(action.elapsed):windup>0?1:motionFrame(type,walk,moving,null))).setFlipX(action? action.dir>0 : moving>0);
   const teamPose=action?.kind==='team',poseAction=teamPose?null:action;
   if(!enemy&&UNITS[type])image.setTexture(type==='healer'?healerPose(walk,moving,poseAction,model.time+(Number(key.slice(1))||0)*.4):(type==='keeper'&&model.keeperRank?'keeperBrush':type)+motionFrame(type,walk,moving,poseAction)).setFlipX(type==='healer'?(poseAction?.phase==='treat'?poseAction.dir<0:moving?moving<0:image.flipX):poseAction?false:moving?moving<0:image.flipX);
   if(!enemy&&type==='cow'&&poseAction?.phase==='anger')image.setTexture('cowAnger'+Math.min(MOTION.cow.angerFrames-1,Math.floor(poseAction.elapsed*MOTION.cow.angerFps)));
   if(teamPose&&action.phase==='perform'&&type==='healer')image.setTexture('healerPray'+(action.elapsed<.65?0:1)).setFlipX(false);
   if(teamPose&&action.phase==='perform'&&type==='archer'){
    const spec=TEAM_SKILLS.arrowRain,t=action.elapsed-(spec.firstRelease-spec.volleyInterval*.5),frame=t<0||t>=spec.volleys*spec.volleyInterval?0:4+Math.min(3,Math.floor(t%spec.volleyInterval/spec.volleyInterval*4));
    image.setTexture('archer'+frame).setFlipX(false);
   }
   if(!enemy&&type==='cow'&&moving&&!action&&moving>0&&model.enemies.some(e=>e.hp>0&&e.x>=x-55&&e.x<x+550))image.setTexture('cowRun'+Math.floor(walk*MOTION.cow.runFps)%MOTION.cow.runFrames);
   if(!enemy&&type==='cow'){
    // Presentation uses the existing action/distance clocks; it never changes combat.
    const alerted=model.allies.find(a=>'a'+a.id===key)?.alerted;
    const nearby=alerted||model.enemies.some(e=>e.hp>0&&Math.abs(e.x-x)<550);
    if(alerted&&!action)image.setTexture(moving?'cowRageRun'+Math.floor(walk*24)%12:'cowAnger97');
    if(image.cowIdleSince===undefined||image.cowIdleSince>model.time)image.cowIdleSince=model.time;
    const rest=COW_REST.prefix+Math.floor(Math.max(0,model.time-image.cowIdleSince)*COW_REST.fps)%COW_REST.frames;
    if(!moving&&!action&&!alerted)image.setTexture(rest);
    if(moving||action||hit>0||nearby)image.cowIdleSince=model.time;
    else{
     if(image.cowIdleSince===undefined||image.cowIdleSince>model.time)image.cowIdleSince=model.time;
     const elapsed=model.time-image.cowIdleSince,t=elapsed%20,at=image.cowIdleSince+Math.floor(elapsed/20)*20;
     // Choose once per idle interval, never per render; pause and each calf stay independent.
     if(image.cowIdleChoice?.at!==at)image.cowIdleChoice={at,index:Math.floor(Math.random()*(COW_IDLE.length+1))};
     const spec=COW_IDLE[image.cowIdleChoice.index-1];
     const frame=t<8||t>=10?null:t<8.6?Math.min(28,Math.floor((t-8)*48)):t<9?28:Math.max(0,28-Math.floor((t-9)*29));
     image.setTexture(spec?(t>=8&&t<8+spec.frames/spec.fps?spec.prefix+Math.min(spec.frames-1,Math.floor((t-8)*spec.fps)):rest):frame===null?rest:'cowEmotion'+frame);
    }
   }
   if(!enemy&&['king','prince','minister','cavalry'].includes(type)&&!moving&&!action)image.setTexture(type+'Idle0');
   if(!enemy&&type==='scholar'&&!moving&&!action)image.setTexture('scholarIdle'+Math.floor(model.time/2.8)%2);
   if(!enemy&&!moving&&!action&&hit<=0&&!(type==='keeper'&&model.keeperRank)){const recovery=this.recoveryCel(type,Number(key.slice(1)));if(recovery)image.setTexture(recovery);}
   if(!enemy&&hit>0&&!['cow','spearman','archer'].includes(type))image.setTexture('hurt'+(type==='keeper'&&model.keeperRank?'keeperBrush':type));
   if(!enemy&&type==='healer'&&!teamPose)image.setTexture(this.videoPose(image,walk,moving,action,hit,key));
   image.setTexture(this.injuryTexture(image.texture.key,type,hp,maxHp));
   const height=BODY_HEIGHT[type]||130;
   this.placeOnGround(image,x-this.offset,height,groundY);
   this.root.bringToTop(image);
   if(enemy&&action?.kind==='enemy'){
    const p=Math.min(1,action.elapsed/ENEMY_STRIKE.duration),impact=ENEMY_STRIKE.impact/ENEMY_STRIKE.duration,dir=action.dir??-1;
    const thrust=p<impact?-Math.sin(p/impact*Math.PI)*7:22*(1-(p-impact)/(1-impact))**2;
    image.x+=dir*thrust;image.setAngle(dir*(p<impact?-4*Math.sin(p/impact*Math.PI):5*(1-p)/(1-impact)));
    // Whole-body drawings carry the pose; do not distort or hinge individual limbs.
    if(p<impact){this.fx.lineStyle(2,0x9c6958,.35);this.fx.lineBetween(image.x-dir*20,groundY-height*.6,image.x-dir*43,groundY-height*.63);}
   }else if(enemy&&windup>0){image.setAngle(Math.sin(windup*8)*1.8+(type==='horse'?5:0));}
   if(hit>0&&(enemy||type!=='cow')){
    const total=enemy?.26:ALLY_HIT_TIME,age=total-hit,response=age<.05?1:Math.max(0,1-(age-.05)/(total-.05))**2;
    image.x+=hitDir*response*(type==='boss'?5:10);
    image.setAngle(hitDir*response*(type==='boss'?2:5));
   }
   if(MOTION[type])this.trackContact(key,type,walk,moving,x,groundY);
   // Calf hit feedback preserves its current action cel and position: color only.
   if(!enemy&&type==='cow'&&hit>0){const fade=Math.min(1,hit/.14);image.setTint((255<<16)|(Math.round(255-120*fade)<<8)|Math.round(255-145*fade));}
   else if(!enemy&&type==='cow')image.clearTint();
   else if(hit>(enemy?.225:ALLY_HIT_TIME-.035))image.setTintFill(0xfff7dd);else if(hit>0)image.setTint(enemy?0xf3c9b9:0xffae99);else image.clearTint();
   const arrival=this.effects.find(e=>e.type==='summon'&&e.actor===Number(key.slice(1))),entry=P.Math.Clamp((model.time-bornAt)/.8,0,1);
   // Whole-body walk cels emerge from the dark aperture at full opacity.
   // Only the still-inside part is occluded; no fading or second spawn entity.
   image.setAlpha(hp<=0?0:enemy?1:arrival?Math.min(1,.35+(model.time-arrival.at)*3):1);
   if(enemy&&entering&&Number.isFinite(entryOrigin)){
    const q=P.Math.Clamp((entryOrigin-x)/(model.screenPadding(type)*.5),0,1),src=image.texture.getSourceImage();
    image.setCrop(0,0,Math.max(1,src.width*q),src.height);
   }
   if(enemy&&entry<1){
    const q=entry,px=x-this.offset,color=type==='reaper'?0xb2daee:type==='skirt'?0xcebb88:0xb5a3ce;
    for(let i=0;i<5;i++){
     const xx=px+Math.sin(model.time*3+i)*28,yy=groundY-20-i*24;this.fx.fillStyle(color,(1-q)*.65);
     if(type==='skirt'){this.fx.lineStyle(2,color,(1-q)*.8);this.fx.lineBetween(xx,yy+45,xx+12,yy+25);}
     else if(type==='horse')this.fx.fillEllipse(xx+20,groundY-4-i%2*6,18+q*25,7+q*6);
     else if(type==='reaper')this.fx.fillTriangle(xx-4,yy+9,xx+4,yy+9,xx+Math.sin(model.time*4+i)*5,yy-12);
     else this.fx.fillCircle(xx,yy,2+i%3);
    }
   }
   if(hp<maxHp||windup>0){
    const w=isBoss(type)?150:enemy?46:66,px=x-this.offset;
    this.fx.fillStyle(0x263d3b,.8);this.fx.fillRoundedRect(px-w/2-1,groundY-height-15,w+2,7,2);
    this.fx.fillStyle(enemy?0xeb9976:0x6ed6ba,1);this.fx.fillRect(px-w/2,groundY-height-14,w*Math.max(0,hp/maxHp),5);
   }
   if(windup>0){
    const px=x-this.offset,yy=groundY-height-34,pulse=.65+.35*Math.sin(model.time*13)**2;
    this.fx.fillStyle(0x5a352d,.9);this.fx.fillTriangle(px,yy-24,px-17,yy+8,px+17,yy+8);
    this.fx.lineStyle(3,0xffbd79,pulse);this.fx.strokeTriangle(px,yy-24,px-17,yy+8,px+17,yy+8);
    this.fx.lineStyle(4,0xfff2c6,1);this.fx.lineBetween(px,yy-13,px,yy-4);this.fx.fillStyle(0xfff2c6,1);this.fx.fillCircle(px,yy+2,2);
    if(type==='horse')for(let i=0;i<3;i++){
     const ax=px-45-i*48;this.fx.fillStyle(0xc97651,pulse*(.75-i*.13));
     this.fx.fillPoints([{x:ax,y:GROUND-2},{x:ax+22,y:GROUND-10},{x:ax+31,y:GROUND-10},{x:ax+9,y:GROUND-2},{x:ax+31,y:GROUND+6},{x:ax+22,y:GROUND+6}],true);
    }

   }
  }
  pendingCoinAmount(){return this.effects.filter(e=>e.type==='coin'&&e.t<COIN_FLIGHT_TIME).reduce((sum,e)=>sum+e.amount,0);}
  coinArrivalActive(){return this.effects.some(e=>e.type==='coin'&&e.t>=COIN_FLIGHT_TIME&&e.t<e.duration);}
  coinTarget(){
   const target=document.getElementById?.('coins')?.getBoundingClientRect?.(),canvas=this.game?.canvas?.getBoundingClientRect?.();
   if(!target||!canvas?.width||!this.unit)return {x:this.vw-120,y:50};
   const cssUnit=canvas.width/this.game.canvas.width*this.unit;
   return {x:(target.left+target.width*.5-canvas.left)/cssUnit-(this.root.x||0)/this.unit,y:(target.top+target.height*.5-canvas.top)/cssUnit-(this.root.y||0)/this.unit};
  }
  drawEffects(dt){
   const g=this.fx;
   const coinTarget=this.coinTarget();
   // A short opaque peak carries the hit; dry brush fragments carry the quieter tail.
   const paint=(e,x,y,w,h,angle=0,alpha=1,phase=null)=>{
    const q=phase??Math.min(1,e.t/e.duration),frame=q<.16?0:q<.38?1:q<.69?2:3;
    e.sprite.setTexture('fx'+e.art+frame).setPosition(x,y).setDisplaySize(w,h).setAngle(angle).setAlpha(alpha).setVisible(true);
    this.root.bringToTop(e.sprite);
   };
   const ribbon=(points,width,color,alpha=1)=>{
    const left=[],right=[];
    for(let i=0;i<points.length;i++){
     const p=points[i],next=points[Math.min(i+1,points.length-1)],prev=points[Math.max(0,i-1)],angle=Math.atan2(next.y-prev.y,next.x-prev.x),w=width*(.14+.86*i/(points.length-1));
     left.push({x:p.x-Math.sin(angle)*w,y:p.y+Math.cos(angle)*w});right.push({x:p.x+Math.sin(angle)*w,y:p.y-Math.cos(angle)*w});
    }
    g.fillStyle(0x283e3b,alpha*.78);g.fillPoints([...left,...right.reverse()],true);
    g.lineStyle(Math.max(2,width*.85),color,alpha);g.beginPath();g.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))g.lineTo(p.x,p.y);g.strokePath();
   };
   const flecks=(x,y,p,color,count=6,spread=65,rise=45)=>{
    for(let i=0;i<count;i++){
     const angle=i*2.399,xx=x+Math.cos(angle)*spread*p,yy=y+Math.sin(angle)*spread*p*.45-rise*Math.sin(p*Math.PI),r=(3+i%3)*(1-p);
     g.fillStyle(color,Math.min(1,(1-p)*1.7));g.fillTriangle(xx-r,yy,xx+r,yy-r,xx,yy+r*2);
    }
   };
   const contact=e=>{
    const actor=e.type==='hurt'?this.hero:this.sprites.get((e.enemy?'e':'a')+e.actor);
    if(actor){const at=this.bodyPoint(actor,e.kind,-(e.dir||1));e.contact={x:at.x+this.offset,y:at.y};}
    const at=e.contact||{x:e.x,y:(e.groundY??GROUND)-(BODY_HEIGHT[e.kind]||132)*.52};
    return {x:at.x-this.offset,y:at.y};
   };
   for(const e of this.effects){
    e.t=Math.min(e.duration,['won','lost'].includes(model.status)?e.t+dt:e.flight?e.flight.t:e.at!==undefined?Math.max(0,model.time-e.at):e.t+dt);const p=e.t/e.duration,fade=1-p,tail=p<.48?1:(1-p)/.52,x=(e.x??e.from??model.x)-this.offset,ground=e.groundY??GROUND;
    if(e.type==='projectile'){
     if(p>=1)continue; // The contact flash replaces the projectile on the same model tick.
     const stone=e.kind==='stone',seed=e.kind==='seed',ink=e.kind==='ink',seal=e.kind==='seal',hex=e.kind==='hex',arrow=e.kind==='arrow',dir=Math.sign(e.to-e.from)||1;
     const source=e.actor==='girl'?this.girl:this.sprites.get((e.enemy?'e':'a')+e.actor);
     const target=e.areaRadius?null:e.targetActor===null?this.hero:this.sprites.get((e.enemy?'a':'e')+e.targetActor);
     if(!e.launchPoint){const at=source?this.bodyPoint(source,e.sourceKind,0,true):{x:e.from-this.offset+dir*18,y:ground-78};e.launchPoint={x:at.x+this.offset,y:at.y};}
     const close=target&&Math.abs((target.x+this.offset)-(e.to+(e.targetActor===null?37:0)))<=55;
     const end=close?this.bodyPoint(target,e.targetKind,-dir):{x:e.to-this.offset,y:e.areaRadius?GROUND-8:(e.targetGroundY??GROUND)-(BODY_HEIGHT[e.targetKind]||132)*.52};
     if(e.hit===false)end.y=(e.targetGroundY??GROUND)-145;
     const from=e.launchPoint.x,fy=e.launchPoint.y,ty=end.y,travel=p;
     const at=q=>({x:(from-this.offset)+(end.x-(from-this.offset))*q,y:fy+(ty-fy)*q-Math.sin(q*Math.PI)*(e.arc|| (stone?28:seed?8:16))}),head=at(travel);
     const color=hex?0xc49ae6:stone?0xeac276:seed?0xc3e975:ink?0x53c1b2:0x8fe6d5;
     if(!arrow)ribbon(Array.from({length:5},(_,i)=>at(Math.max(0,travel-.2+i*.05))),stone?3:ink?6:4,color,1);
     if(arrow&&e.finishOnScreen)ribbon(Array.from({length:5},(_,i)=>at(Math.max(0,travel-.12+i*.03))),5,0xffd788,.8);
     if(arrow){const next=at(Math.min(1,travel+.01)),angle=Math.atan2(next.y-head.y,next.x-head.x),point=(u,v)=>({x:head.x+Math.cos(angle)*u-Math.sin(angle)*v,y:head.y+Math.sin(angle)*u+Math.cos(angle)*v}),a=point(-19,0),b=point(12,0),tip=point(18,0),l=point(8,-5),r=point(8,5);g.lineStyle(3,0x433724,1);g.lineBetween(a.x,a.y,b.x,b.y);g.lineStyle(1.5,0xf6e3a9,.9);g.lineBetween(a.x,a.y,b.x,b.y);g.fillStyle(0xe9e6d6,1);g.fillTriangle(tip.x,tip.y,l.x,l.y,r.x,r.y);const tail=point(-24,-5),tail2=point(-24,5);g.lineStyle(2,0xbc6151,.9);g.lineBetween(a.x,a.y,tail.x,tail.y);g.lineBetween(a.x,a.y,tail2.x,tail2.y);}
     else if(hex){g.fillStyle(0x6b3e91,1);g.fillEllipse(head.x,head.y,23,14);g.fillStyle(0xf3defb,1);g.fillEllipse(head.x-dir*3,head.y-2,12,6);}
     else if(stone){g.fillStyle(0x574737,1);g.fillPoints([{x:head.x-12,y:head.y-5},{x:head.x-4,y:head.y-11},{x:head.x+11,y:head.y-6},{x:head.x+10,y:head.y+7},{x:head.x-8,y:head.y+9}],true);g.fillStyle(0xd5b479,1);g.fillEllipse(head.x-1,head.y-2,15,11);}
     else if(seed){g.fillStyle(0x375840,1);g.fillEllipse(head.x,head.y,24,15);g.fillStyle(0xe6f4af,1);g.fillEllipse(head.x+dir*3,head.y-2,15,8);}
     else if(ink){g.fillStyle(0x173e40,1);g.fillEllipse(head.x,head.y,31,18);g.lineStyle(3,0xa3efe0,1);g.lineBetween(head.x-dir*10,head.y-5,head.x+dir*11,head.y-1);}
     else{
      // An actual paper shape and vermilion stroke identify a talisman, even without color glow.
      const corners=[{x:head.x-dir*13,y:head.y-15},{x:head.x+dir*12,y:head.y-9},{x:head.x+dir*8,y:head.y+18},{x:head.x-dir*16,y:head.y+12}];
      g.fillStyle(0xffefd0,1);g.fillPoints(corners,true);g.lineStyle(3,0x334e45,1);g.strokePoints(corners,true);g.lineStyle(4,0xb64d33,1);g.lineBetween(head.x,head.y-8,head.x-3,head.y+9);
      if(seal){g.lineStyle(3,0x73d1bd,1);g.strokeEllipse(head.x,head.y,46,50);}
     }
    }
    if(e.type==='hit'||e.type==='hurt'||e.type==='guard'){
     const at=contact(e),dir=e.dir||1,blocked=e.type==='guard',profile=IMPACT[e.weapon]||IMPACT.physical;
     const color=e.enemy===false||e.type==='hurt'?0xff8c6e:blocked?0x9be2d6:e.weapon==='seed'?0xc4e88b:e.weapon==='hex'?0xd2b2ef:['ink','seal','charm'].includes(e.weapon)?0x8be3d9:0xffd485;
     const size=profile.size*(e.enemy===false||e.type==='hurt'?.72:.48),peak=Math.max(0,1-e.t/.065),remain=(1-p)**2;
     // One compact, immediate contact. The broad painted image is only a low-alpha trailing wisp.
     if(e.sprite)paint(e,at.x,at.y,size*1.3,size,dir>0?0:180,remain*.30,Math.max(.38,p));
     if(blocked){
      g.lineStyle(4,0x3b605c,remain);g.beginPath();g.arc(at.x-dir*8,at.y,20+9*p,dir>0?-.9:Math.PI-.9,dir>0?.9:Math.PI+.9);g.strokePath();
      g.lineStyle(2,color,remain);g.beginPath();g.arc(at.x-dir*8,at.y,18+9*p,dir>0?-.9:Math.PI-.9,dir>0?.9:Math.PI+.9);g.strokePath();
     }else{
      const radius=5+size*.30*Math.sqrt(p);
      g.lineStyle(3,color,remain);g.strokeCircle(at.x,at.y,radius);
      if(peak>0){const r=5+size*.10*peak;g.fillStyle(0x34484a,peak);g.fillPoints([{x:at.x-r*1.8,y:at.y},{x:at.x,y:at.y-r*1.6},{x:at.x+r*1.8,y:at.y},{x:at.x,y:at.y+r*1.6}],true);g.fillStyle(0xfff9df,peak);g.fillCircle(at.x,at.y,r);}
     }
     for(let i=0;i<4;i++){
      const angle=(i-1.5)*.58,spread=(8+26*p),xx=at.x+dir*Math.cos(angle)*spread,yy=at.y+Math.sin(angle)*spread;
      g.lineStyle(i%2?2:3,color,remain);g.lineBetween(xx,yy,xx+dir*Math.cos(angle)*(7+8*p),yy+Math.sin(angle)*7);
     }
    }
    if(e.type==='swipe'||e.type==='claw'||e.type==='hex'){
     const dir=Math.sign(e.to-e.x)||1,target=this.sprites.get((e.type==='swipe'?'e':'a')+e.targetActor);
     const end=target?this.bodyPoint(target,e.targetKind,-dir):{x:e.to-this.offset,y:(e.targetGroundY??GROUND)-(BODY_HEIGHT[e.targetKind]||132)*.52};
     // A thin directional follow-through, not a second impact explosion.
     g.lineStyle(3,e.type==='swipe'?0xe2b775:0xc8b0b9,(1-p)**2*.7);g.beginPath();g.arc(end.x-dir*19,end.y,21+10*p,dir>0?-.9:Math.PI-.9,dir>0?.9:Math.PI+.9);g.strokePath();
     if(e.sprite)e.sprite.setVisible(false);
    }
    if(e.type==='stomp'){
     const q=1-(1-p)**3,cx=x+160;
     paint(e,cx,GROUND-34,170+290*q,115,0,tail);
     g.lineStyle(12,0x4a6857,tail*.8);g.strokeEllipse(cx,GROUND+1,70+390*q,14+28*q);
     g.lineStyle(5,0xffe0a0,tail);g.strokeEllipse(cx,GROUND+1,70+390*q,14+28*q);
     flecks(cx,GROUND-13,p,0xc5b180,13,220,100);
    }
    if(e.type==='rush'){
     const xx=model.x-this.offset+108,q=Math.min(1,Math.max(0,(e.t-.18)/.92));
     paint(e,xx,GROUND-87,170,190,0,tail);
     ribbon(Array.from({length:7},(_,i)=>({x:xx-230+i*34,y:GROUND-45-Math.sin(i*.55+q*2)*14})),14,0x7bd9bd,tail*.8);
     flecks(xx-70,GROUND-3,p,0xc7b88d,9,170,25);
    }
    if(e.type==='charge'){
     paint(e,x+50,GROUND-25,230,100,0,tail);flecks(e.to-this.offset,GROUND-45,p,0xc79273,9,110,55);
    }
    if(e.type==='upgrade'){paint(e,x,ground-80,150,170,0,tail);flecks(x,ground-60,p,0xc1ead4,7,60,120);}
    if(e.type==='summon'){
     const body=e.actor==='hero'?this.hero:this.sprites.get('a'+e.actor),cx=body?.x??x,q=1-(1-p)**3;
     if(e.kind==='cow'){
      paint(e,cx-30,ground-12,160,65,0,tail*.7);flecks(cx,ground-3,p,0xd5b685,11,95,32);
      g.lineStyle(2,0xffd98f,tail);g.strokeEllipse(cx+20,ground-76,30+q*45,28+q*25);
     }else if(e.kind==='keeper'){
      paint(e,cx-18,ground-8,88,48,0,tail*.55);for(let i=0;i<5;i++){const xx=cx-25+i*13-30*p,yy=ground-4-Math.sin(p*Math.PI)*(15+i*5);g.fillStyle(0xa59270,tail);g.fillEllipse(xx,yy,7,5);}
     }else if(e.kind==='rabbit'||e.kind==='healer'){
      paint(e,cx,ground-36-50*p,e.kind==='healer'?95:65,120,0,tail*.65);
      for(let i=0;i<7;i++){const a=i*2.4+q*2,xx=cx+Math.cos(a)*(15+q*40),yy=ground-15-i*9-50*p;g.fillStyle(e.kind==='healer'?0x9fe9ca:0xd1e39a,tail);g.fillEllipse(xx,yy,10,4);}
     }else{
      paint(e,cx,ground-50,125,140,0,tail*.35);
      g.lineStyle(3,e.kind==='haetae'?0xf5d28a:0x8de1d4,tail);g.strokeEllipse(cx,ground-3,25+q*115,8+q*19);
      for(let i=0;i<3;i++){const xx=cx+(i-1)*32;g.lineStyle(2,e.kind==='haetae'?0xffe6ad:0xb5ebe2,tail);g.lineBetween(xx,ground-20-60*p,xx+9,ground-32-60*p);}
     }
    }
    if(e.type==='heal'){
     const patient=e.targetActor==null?this.hero:this.sprites.get('a'+e.targetActor);
     if(e.enemy){paint(e,x,ground-92-35*p,180,205,0,tail);e.sprite?.setTint(0xaf8bbe);flecks(x,ground-20,p,0xb596cf,8,75,150);}
     else {e.sprite?.setVisible(false);this.drawPatientRecovery(patient,e.targetActor==null?(model.shield>0&&model.shieldKind!=='water'||model.action?.kind==='rush'?'mount':'haetae'):e.kind,p,tail,e);if(e.targetActor==null&&this.girl?.visible)this.drawPatientRecovery(this.girl,'girl',p,tail,e);}
    }
    if(e.type==='shelter'){e.sprite.setVisible(false);flecks(x+90,GROUND-185,p,0xaee6dc,7,60,70);}
    if(e.type==='vanish'){
     const late=e.kind==='reaper'?Math.max(0,p-.22)/.78:Math.max(0,p-.65)/.35;
     paint(e,x,GROUND-(BODY_HEIGHT[e.kind]||132)*.45-80*late,155,205,0,Math.sin(late*Math.PI)*.7,late);
    }
    if(e.type==='footstep'){
     if(AREAS[model.stage].ground==='water'){g.lineStyle(1.6,0xf3faff,fade*.72);g.strokeEllipse(x,ground+2,16+105*p,4+22*p);g.lineStyle(1,0xb4d6f4,fade*.55);g.strokeEllipse(x,ground+2,12+73*p,3+15*p);g.lineStyle(1,0xffffff,fade*.4);g.strokeEllipse(x,ground+2,8+40*p,2+9*p);}
     else {const q=p*p;g.fillStyle(0x877653,fade*.32);g.fillEllipse(x-8*q,ground,18+30*p,5+5*p);flecks(x,ground-2,p,0xc2b08a,3,24,15);}
    }
    if(e.type==='healingAmount'){
     const patient=e.targetActor==null?this.hero:this.sprites.get('a'+e.targetActor);
     e.sprite.setPosition(patient?.x??x,ground-(BODY_HEIGHT[e.kind]||132)-18-38*p).setAlpha(Math.min(1,fade*3));this.root.bringToTop(e.sprite);
    }
    if(e.type==='damage'){
     const xx=x+(e.enemy?10:-14)+(e.lane-1)*18,yy=ground-(BODY_HEIGHT[e.kind]||132)*.7-42*(1-(1-p)**2)-e.lane*15;
     e.sprite.setPosition(xx,yy).setScale(1+Math.max(0,.14-p)*1.7).setAlpha(Math.min(1,fade*2.5));this.root.bringToTop(e.sprite);
    }
    if(e.type==='coin'){
     const count=e.reason==='defeat'?3:1,travel=Math.min(1,e.t/COIN_FLIGHT_TIME);
     if(!e.coinOrigin)e.coinOrigin={x:e.x,y:GROUND-(BODY_HEIGHT[e.kind]||132)*.55};
     if(e.t<.26){const burst=e.t/.26;g.lineStyle(2,0xffe1a0,(1-burst)*.8);g.strokeEllipse(e.coinOrigin.x-this.offset,e.coinOrigin.y,24+75*burst,18+45*burst);flecks(e.coinOrigin.x-this.offset,e.coinOrigin.y,burst,0xffdd85,count===3?8:4,58,30);}
     for(let i=0;i<count&&travel<1;i++){
      const startX=e.coinOrigin.x-this.offset+(i-(count-1)*.5)*28,startY=e.coinOrigin.y-i*14,q=Math.max(0,Math.min(1,(travel-.18)/.82)),ease=q*q,xx=startX+(coinTarget.x-startX)*ease,yy=startY+(coinTarget.y-startY)*ease-70*Math.sin(travel*Math.PI),size=13.5*(1-.65*q);
      const past=Math.max(0,travel-.075),back=Math.max(0,(past-.18)/.82)**2,bx=startX+(coinTarget.x-startX)*back,by=startY+(coinTarget.y-startY)*back-70*Math.sin(past*Math.PI);
      g.lineStyle(8,0xf5c264,.18);g.lineBetween(bx,by,xx,yy);g.lineStyle(2,0xffe6a4,.85);g.lineBetween(bx,by,xx,yy);
      g.fillStyle(0xffd780,.13);g.fillCircle(xx,yy,size*1.8);
      g.fillStyle(0x76552b,1);g.fillCircle(xx,yy,size);g.fillStyle(0xf3cf77,1);g.fillCircle(xx,yy-1,size*.78);g.fillStyle(0x695033,1);g.fillRect(xx-size*.22,yy-size*.3,size*.44,size*.44);
      const shine=2+3*Math.sin(travel*Math.PI);g.lineStyle(1.5,0xfff8dc,.95);g.lineBetween(xx-size*.4-shine,yy-size*.4,xx-size*.4+shine,yy-size*.4);g.lineBetween(xx-size*.4,yy-size*.4-shine,xx-size*.4,yy-size*.4+shine);
     }
     if(travel===1){const landed=(e.t-COIN_FLIGHT_TIME)/.24,alpha=1-landed;g.fillStyle(0xffd36f,.22*alpha);g.fillCircle(coinTarget.x,coinTarget.y,13+22*landed);g.lineStyle(2,0xffedb3,alpha);g.strokeCircle(coinTarget.x,coinTarget.y,10+26*landed);flecks(coinTarget.x,coinTarget.y,landed,0xffedb3,6,40,12);}
     if(e.sprite){e.sprite.setPosition(e.coinOrigin.x-this.offset,e.coinOrigin.y-25-25*travel).setAlpha(Math.max(0,1-travel*2.5));this.root.bringToTop(e.sprite);}
    }
    if(e.type==='team-prayer'){
     g.lineStyle(3,0xbde9d9,tail*.8);g.strokeEllipse(x,GROUND-8,220+760*p,45+100*p);
     for(let i=0;i<9;i++){const xx=x-260+i*65;g.lineStyle(2,0xd7ffe4,tail*.45);g.lineBetween(xx,GROUND-110,xx+Math.sin(i)*20,GROUND-300-80*p);}
    }
    if(e.type==='boss-impact'){
     const color=e.blocked?0xa6efd6:BOSS_COLORS[e.attack]||0xe1c6e6;
     for(const zone of e.zones){
      const l=Math.max(-20,zone.left-this.offset),r=Math.min(this.vw+20,zone.right-this.offset);if(r<=l)continue;
      const y=e.blocked?GROUND-180:GROUND;
      g.lineStyle(4,color,fade);g.lineBetween(l,y,r,y);
      for(let xx=l+18;xx<r;xx+=60){
       g.lineStyle(3,color,fade);g.fillStyle(color,fade*.7);
       if(['frost','spikes'].includes(e.attack))g.fillTriangle(xx-13,y,xx+14,y,xx+5,y-120*Math.sin(p*Math.PI));
       else if(['bells','seals'].includes(e.attack))g.strokeEllipse(xx,y-45,25+65*p,25+90*p);
       else if(e.attack==='chains'){g.lineBetween(e.from-this.offset,GROUND-160,xx,y);for(let k=0;k<4;k++)g.strokeEllipse(xx-k*14,y-k*12,14,20);}
       else if(['tide','quake'].includes(e.attack))g.strokeEllipse(xx-60+120*p,y,45+45*p,20+35*p);
       else if(e.attack==='roots'){g.beginPath();g.moveTo(xx,y);g.lineTo(xx+15,y-50*Math.sin(p*Math.PI));g.lineTo(xx-10,y-100*Math.sin(p*Math.PI));g.strokePath();}
       else if(e.attack==='mirage'){g.strokeEllipse(xx,y-80,35+30*p,150*(1-p));}
       else {const yy=y-240*(1-p)**2;g.fillTriangle(xx-6,yy,xx+8,yy-13,xx+5,yy+10);g.lineBetween(xx+16,yy-40,xx,yy);}
      }
     }
    }
    if(e.type==='hail'){
     if(!e.impacted)e.blocked=model.shield>0;
     // One fall, then a ground/shield impact. No modulo loop making new rain appear forever.
     for(let i=0;i<14;i++){
      const q=Math.min(1,e.t/.7),xx=x-120+i*35,end=e.blocked?GROUND-220:GROUND,yy=90-i*7+(end-90+i*7)*q*q;
      if(q<1){ribbon([{x:xx+24,y:yy-65},{x:xx+12,y:yy-27},{x:xx,y:yy}],5,0xbce7e4,tail);g.fillStyle(0x375f75,tail);g.fillPoints([{x:xx,y:yy-16},{x:xx+12,y:yy},{x:xx,y:yy+16},{x:xx-12,y:yy}],true);g.fillStyle(0xf2ffec,tail);g.fillTriangle(xx,yy-13,xx+8,yy,xx,yy+11);}
      else flecks(xx,end-4,Math.min(1,Math.max(0,(e.t-.7)/.30)),e.blocked?0xa6efd6:0xc2e5e6,4,35,30);
     }
    }
    if(e.type==='quake'){
     const px=(e.from??e.x)-this.offset-70,impact=.75,active=Math.max(0,(e.t-impact)/.5);
     if(e.t<impact){g.lineStyle(4,0xf0c47b,.6);g.lineBetween(px-460,GROUND,px,GROUND);}
     else {const cx=px-active*460;g.lineStyle(8,0xf5d090,fade);g.strokeEllipse(cx,GROUND,55+active*65,25+active*20);flecks(cx,GROUND,active,0xd8b57d,9,120,90);}
    }
    if(e.type==='tide'){
     const q=Math.min(1,e.t/.85),xx=(e.from??e.x)-this.offset-q*800,yy=e.blocked?GROUND-190:GROUND;
     g.lineStyle(17,0x3ba9bc,tail*.65);g.beginPath();g.arc(xx,yy-38,62,-Math.PI*.95,Math.PI*.45);g.strokePath();
     g.lineStyle(5,0xe4ffef,tail);g.beginPath();g.arc(xx-4,yy-40,62,-Math.PI*.95,Math.PI*.45);g.strokePath();
     for(let i=0;i<6;i++){g.lineStyle(2,0xc8f6f4,tail*.8);g.lineBetween(xx+i*17,yy+4+i%2*4,xx+110+i*19,yy+4+i%2*4);}
    }
    if(e.type==='depart'){
     const x=e.x-this.offset,h=BODY_HEIGHT[e.kind]*(e.kind==='boss'?.64:1),sprite=e.sprite;
     if(e.kind==='reaper'){
      // The same man lifts his chin and opens his arms; only light leaves the eyes.
      const lift=Math.min(1,p/.46),rise=28*(lift*lift*(3-2*lift));
      const dissolve=Math.max(0,Math.min(1,(p-.55)/.45));
      const frame=reaperDepartureFrame(p);
      sprite.setTexture('reaperDepart'+frame).setOrigin(.5,this.grounding.get('reaperDepart0'));
      const src=sprite.texture.getSourceImage();sprite.setDisplaySize(h*src.width/src.height,h).setPosition(x,GROUND-rise).setAlpha(1-dissolve);
      this.root.bringToTop(sprite);
      // Black facial ink and the two eye flames are painted into each death cel.
      // Keep extra wisps above the hat, so no detached white eyes cover the living face.
      const glow=Math.min(1,Math.max(0,(p-.17)/.16))*(1-Math.max(0,(p-.78)/.22));
      for(let i=0;i<5;i++){
       const q=(p*1.8+i/5)%1;
       g.fillStyle(i%2?0xd5ffff:0x64d8e8,glow*(1-q)*.65);
       g.fillEllipse(x-8+Math.sin(q*5+i)*10,GROUND-rise-h*(.91+q*.24),2+2*(1-q),4+5*(1-q));
      }
      if(dissolve>0)for(let i=0;i<18;i++){
       const q=i/18,swirl=Math.sin(i*2.7+p*7),xx=x+swirl*(18+36*dissolve),yy=GROUND-rise-20-q*150-55*dissolve;
       g.fillStyle(i%3?0x89999a:0xb8c6bb,Math.sin(dissolve*Math.PI)*.12);
       g.fillEllipse(xx,yy,14+24*dissolve,8+14*dissolve);
      }
     }else if(e.enemy===false&&VIDEO_MOTION[e.kind]){
      const spec=VIDEO_MOTION[e.kind].death,frame=Math.min(spec.holdFrom??spec.frames-1,Math.floor(e.t*spec.fps));
      sprite.setTexture(spec.prefix+frame);this.placeOnGround(sprite,x,h,e.groundY??GROUND);sprite.setAlpha(Math.max(0,Math.min(1,(e.duration-e.t)/.5)));this.root.bringToTop(sprite);
     }else if(e.enemy===false){
      const key='defeat'+e.kind+(p<.32?'0':'1'),src=this.textures.get(key).getSourceImage(),rx=this.registrationX.get(key)??.5,scaledH=h*.88*(this.celScale.get(key)??1);
      sprite.setTexture(key).setOrigin(sprite.flipX?1-rx:rx,this.grounding.get(key)??1).setDisplaySize(scaledH*src.width/src.height,scaledH).setPosition(x+(e.dir||-1)*8*Math.min(1,p/.32),e.groundY??GROUND).setAngle(0).setAlpha(p<.62?1:Math.max(0,(1-p)/.38));
      if(p>.60)flecks(x,GROUND-h*.25,(p-.60)/.40,0xbad9c9,8,65,60);
     }else{
      const key='depart'+e.kind+enemyDepartureFrame(p,ENEMIES[e.kind]?.departureFrames),src=this.textures.get(key).getSourceImage(),rx=this.registrationX.get(key)??.5,scaledH=h*(this.celScale.get(key)??1);
      sprite.setTexture(key).setOrigin(sprite.flipX?1-rx:rx,this.grounding.get(key)??1).setDisplaySize(scaledH*src.width/src.height,scaledH).setPosition(x,GROUND).setAlpha(p<.68?1:Math.max(0,(1-p)/.32));
      this.root.bringToTop(sprite);
      if(p>.60)flecks(x,GROUND-h*.2,(p-.60)/.40,e.kind==='boss'?0x97b5a2:0xaebcb9,8,85,70);
     }
    }

    if(p>=1)e.sprite?.destroy();
   }
   this.effects=this.effects.filter(e=>e.t<e.duration);
  }
  update(time,delta){
   if(!this.ready){if(this.commonReady)onFrame(model,this);return;}
   const rawDt=Math.min(delta/1000,.05),playing=model.status==='playing',rate=playing&&[1,2,4,8].includes(this.playbackRate)?this.playbackRate:1;
   const scaledDt=rawDt*rate,dt=playing?Math.max(0,scaledDt-this.hitStop):rawDt;
   if(playing){this.hitStop=Math.max(0,this.hitStop-scaledDt);this.impactCooldown=Math.max(0,this.impactCooldown-scaledDt);}
   const intro=model.status==='ready',vw=this.vw;
   // One camera follows the traveller inside the existing 28–65% safe region.
   // A dead zone preserves immediate stopping; companions cannot move the camera.
   // Keep bounded simulation steps, including accelerated observer playback.
   const steps=playing?Math.max(1,Math.ceil(dt/.05)):1,stepDt=dt/steps;
   for(let i=0;i<steps;i++){
    if(model.status==='playing'){model.setViewport(this.offset,vw);model.step(stepDt);}
    const targetOffset=intro?(time/1000*30)%4800:Math.max(Math.min(0,model.gateX-vw+model.portalInset),Math.min(model.gateX-vw+model.portalInset,Math.max(model.x-vw*.65,Math.min(model.x-vw*.28,this.offset))));
    if(intro)this.offset+=(targetOffset-this.offset)*Math.min(1,stepDt*8);else this.offset=targetOffset;
    if(model.status==='playing')model.setViewport(this.offset,vw);
   }
   const events=model.drainEvents();this.playEvents(events);onEvents(events);
   const t=intro?time/1000:model.time;
   const region=intro?this.previewAreaIndex:model.stage,blend=1;
   this.drawLandscape(region,blend,t);
   this.decor.clear();this.shadows.clear();this.fx.clear();
   this.drawGate((model.portal?.x??model.gateX)-this.offset,t);this.drawBossTelegraphs();
   // Small distance markers make scrolling legible, rather than a static left-side base.
   for(let p=800;p<model.roadEnd&&AREAS[model.stage].ground!=='water';p+=800){
    const x=p-this.offset;if(x<-50||x>vw+50)continue;
    this.decor.fillStyle(0x978367,.5);this.decor.fillRect(x,GROUND-35,4,35);
    this.decor.lineStyle(1,0xb19b75,.65);this.decor.lineBetween(x-12,GROUND-35,x+19,GROUND-35);
   }
   const heroX=intro?vw*.68:model.x-this.offset;
   const walking=intro||model.moving!==0;
   if(playing)this.heroPose=model.moving?0:Math.max(0,this.heroPose-dt);
   const sheltering=!intro&&model.shield>0&&model.shieldKind!=='water',mounted=!intro&&(model.action?.kind==='rush'||sheltering);
   const opening=sheltering?6-model.shield:0;
   const heroFrame=sheltering?(opening<.6?Math.min(3,Math.floor(opening/.15)):walking?4+motionFrame('haetae',model.walk,true,null):7):mounted?(model.action.elapsed<.18?4:Math.floor(model.action.elapsed*14)%4):motionFrame('haetae',intro?t:model.walk,walking,intro?null:model.action);
   const heroHurt=!intro&&this.effects.some(e=>e.type==='hurt'&&model.time-(e.at??model.time-e.t)<ALLY_HIT_TIME);
   const idleEligible=!intro&&!walking&&!mounted&&!model.action&&!heroHurt&&this.heroPose<=0&&!model.enemies.some(e=>e.hp>0&&Math.abs(e.x-model.x)<450);
   if(!idleEligible)this.idleSince=null;else if(this.idleSince===null)this.idleSince=t;
   const idleElapsed=this.idleSince===null?0:t-this.idleSince,haetaeIdle=travellerIdleFrame('haetae',idleElapsed,region),girlIdle=travellerIdleFrame('girl',idleElapsed,region);
   const heroRecovery=!walking&&!mounted&&!model.action?this.recoveryCel('haetae',null):null,girlRecovery=!walking&&!mounted&&this.heroPose<=0?this.recoveryCel('girl',null):null;
   const haetaeBase=mounted?heroHurt?'hurt'+(sheltering?'umbrella':'mount'):(sheltering?'umbrella':'mount')+heroFrame:this.videoPose(this.hero,intro?t:model.walk,walking,intro?null:model.action,heroHurt?1:0,'hero','haetae',t,idleEligible);
   const girlCast=this.heroPose>0?{kind:'girl',elapsed:.85-this.heroPose}:null;
   const girlBase=this.videoPose(this.girl,intro?t:model.walk,walking,girlCast,heroHurt?1:0,'girl','girl',t,idleEligible);
   this.hero.setTexture(this.injuryTexture(haetaeBase,mounted?'mount':'haetae',intro?MAX_HP:model.hp,MAX_HP)).setFlipX(sheltering||intro||model.action?false:model.moving?model.moving<0:this.hero.flipX);
   this.placeOnGround(this.hero,heroX+37,sheltering?BODY_HEIGHT.umbrella:mounted?BODY_HEIGHT.mount:intro?150:BODY_HEIGHT.haetae);
   this.girl.setTexture(this.injuryTexture(girlBase,'girl',intro?MAX_HP:model.hp,MAX_HP)).setFlipX(intro||this.heroPose>0?false:model.moving?model.moving<0:this.girl.flipX);
   this.placeOnGround(this.girl,heroX-60,intro?145:BODY_HEIGHT.girl);
   this.hero.setVisible(model.hp>0);this.girl.setVisible(!mounted&&model.hp>0);
   if(heroHurt){this.hero.setTint(0xffb39c);this.girl.setTint(0xffb39c);}else{this.hero.clearTint();this.girl.clearTint();}
   if(!intro){this.trackContact('haetae','haetae',model.walk,model.moving,model.x+37);if(!mounted)this.trackContact('girl','girl',model.walk,model.moving,model.x-60);}
   this.lastX=model.x;
   const present=new Set();
   if(intro){
    this.renderEntity('previewRabbit','rabbit',vw*.86+this.offset,t*.6,1,1,0,0,false,1);present.add('previewRabbit');
    this.renderEntity('previewKeeper','keeper',vw*.54+this.offset,t*.65,1,1,0,0,false,1);present.add('previewKeeper');
    this.renderEntity('previewCow','cow',vw*.78+this.offset,t*.5,1,1,0,0,false,1);present.add('previewCow');
   }else{
    for(const e of model.enemies.filter(e=>e.type!=='gate').sort((a,b)=>actorLayer(a)-actorLayer(b))){const key='e'+e.id;present.add(key);this.renderEntity(key,e.type,e.x,e.walk,e.hp,e.maxHp,e.hit,e.windup,true,e.moving,e.action,e.hitDir,GROUND,e.entryAt??e.bornAt,e.entryOrigin,e.entering);}
    for(const a of [...model.allies].sort((a,b)=>actorLayer(a)-actorLayer(b))){const key='a'+a.id;present.add(key);this.renderEntity(key,a.type,a.x,a.walk,a.hp,a.maxHp,a.hit,0,false,a.moving,a.action,a.hitDir);}
   }
   for(const [key,obj] of this.sprites)if(!present.has(key)){obj.destroy();this.sprites.delete(key);this.contacts.delete(key);}
   // All summons finish ordering first: the traveller remains visible at every party size.
   this.root.bringToTop(this.hero);this.root.bringToTop(this.girl);
   if(this.gateLip)this.root.bringToTop(this.gateLip);
   this.drawReflections(t);
   const boss=model.enemies.find(e=>e.type==='boss');
   this.drawBossCloud(boss,t);
   this.ward.setVisible(false);
   this.waterWard?.setVisible(!intro&&model.waterWard>0&&model.hp>0);
   if(this.waterWard?.visible){const w=SKILLS.waterWard.radius*2;this.waterWard.setPosition(heroX,GROUND+12).setDisplaySize(w,w*.60).setAlpha(Math.min(1,model.waterWard/.5)*.85).setAngle(0);this.root.bringToTop(this.waterWard);}
   if(sheltering){
    const cx=heroX+37+this.hero.displayWidth*.16,cy=GROUND-this.hero.displayHeight*.73,radius=this.hero.displayHeight*.31,alpha=Math.min(1,model.shield)*Math.min(1,opening/.45);
    this.fx.lineStyle(9,0x69c7ae,.12*alpha);this.fx.beginPath();this.fx.arc(cx,cy,radius,-Math.PI*.68,Math.PI*.12);this.fx.strokePath();
    this.fx.lineStyle(2,0xe7f6d5,.72*alpha);this.fx.beginPath();this.fx.arc(cx,cy,radius,-Math.PI*.68,Math.PI*.12);this.fx.strokePath();
   }
   // Effects render above the units.
   this.root.bringToTop(this.fx);
   if(playing||['won','lost'].includes(model.status))this.drawEffects(dt);else this.drawEffects(0);this.root.bringToTop(this.fx);
   // Values must remain legible above the painted motes, including while paused.
   for(const e of this.effects)if(e.sprite&&['damage','healingAmount','coin'].includes(e.type))this.root.bringToTop(e.sprite);
   if(this.shake>0){if(playing)this.shake-=dt;this.root.x=Math.sin(model.time*100)*2*this.unit;}else this.root.x=0;
   onFrame(model,this);
  }
 }
 return new P.Game({type:P.AUTO,parent:'game',width:1280,height:620,transparent:false,backgroundColor:'#eee8d9',antialias:true,scene:RoadScene,fps:{target:60,limit:60},scale:{mode:P.Scale.FIT,autoCenter:P.Scale.CENTER_BOTH},render:{roundPixels:false,powerPreference:'low-power'},audio:{noAudio:true},banner:false});
}
