import {ROAD,GATE,START,MOTION,motionFrame,AREAS,skyState,ROAD_SECTIONS,SHOT_TIME,BODY_HEIGHT,PARALLAX,ENEMY_STRIKE,enemyAttackFrame,bossPose,UNITS,MAX_HP,injuryLevel,REAPER_DEPARTURE_TIME,reaperDepartureFrame,enemyDepartureFrame,actorLayer,ALLY_HIT_TIME,GATE_BREAK_TIME} from './data.js?v=35';
const P=window.Phaser;
// Feet stand inside the painted road, not on its distant top edge.
const GROUND=542;
const MODEL_MAP={skirt:'skirt0',horse:'horse',reaper:'reaper',boss:'boss',rabbit:'rabbit',keeper:'keeper1',cow:'cow1',scholar:'scholar1',healer:'healer1'};
// Presentation only: combat and rewards remain exclusively in Journey.
const FX_ART={hit:'CleanImpact',hurt:'CleanImpact',hex:'CleanCurse',guard:'CleanGuard',stomp:'Dust',rush:'CleanSlash',charge:'Dust',summon:'Dust',shelter:'Ward',heal:'Leaf',upgrade:'Seal',vanish:'Smoke'};
const FX_LIFE={hit:.20,hurt:.42,swipe:.16,claw:.16,hex:.28,guard:.42,stomp:.68,rush:1.3,charge:.48,summon:1.1,shelter:.65,heal:1.05,upgrade:1,vanish:1.05,projectile:SHOT_TIME,hail:1.15};
// Surface landmarks belong to each whole-body cel, not the padded atlas rectangle.
// x/y are the torso centre; w/h its surface extent. Only sockets move: never the art/limbs.
const WOUNDS={
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
  constructor(){super('road');this.sprites=new Map();this.effects=[];this.grounding=new Map();this.contacts=new Map();this.offset=0;this.lastX=START;this.heroPose=0;this.shake=0;this.hitStop=0;this.impactCooldown=0;this.previewAreaIndex=0;this.injuryTextures=new Map();}
  preload(){
   this.load.image('enemyDefeat','./assets/enemy-defeat-v35.png');
   this.load.image('allyDefeat','./assets/ally-defeat-v35.png');
   this.load.image('allyHurt','./assets/ally-hurt-v32.png');
   this.load.image('healerWalk','./assets/healer-motion-v32.png');this.load.image('umbrellaMotion','./assets/umbrella-motion-v32.png');
   this.load.image('allies','./assets/allies.png');this.load.image('enemies','./assets/enemies.png');
   this.load.image('haetaeMotion','./assets/haetae-motion-v10.png');this.load.image('rabbitMotion','./assets/rabbit-motion-v10.png');
   this.load.image('companionWalk','./assets/companions-walk-v11.png');this.load.image('gate','./assets/underworld-gate-v17.png');this.load.image('enemyWalk','./assets/enemy-walk-v17.png');this.load.image('reaperDeparture','./assets/reaper-departure-v35.png');this.load.image('actionIcons','./assets/action-icons-v11.png');
   for(const area of AREAS)this.load.image(area.texture,'./assets/'+area.file);
   this.load.image('nightRoad','./assets/night-road-v32.png');this.load.image('moon','./assets/moon-v32.png');
   this.load.image('livingScenery','./assets/living-scenery-v11.png');
   this.load.image('enemyAttacks','./assets/enemy-attacks-v17.png');
   this.load.image('bossMotion','./assets/boss-motion-v25.png');
   for(const [key,file] of Object.entries({keeperWalk:'doryeong-stone-v12',keeperBrushWalk:'doryeong-brush-v12',cowWalk:'cow-walk-gif-v16',cowAttack:'ox-motion-v14',scholarWalk:'scholar-motion-v12',mountWalk:'mounted-haetae-v12',combatFX:'combat-fx-v18',magicFX:'magic-fx-v18',cleanFX:'clean-fx-v19',woundArt:'wounds-v20'}))this.load.image(key,'./assets/'+file+'.png');
   this.load.on('loaderror',()=>onReady(new Error('그림을 불러오지 못했어요. 새로고침해 주세요.')));
  }
  sliceAtlas(sheet,names,columns=3,sharedBounds=false,rows=2,layout=null){
   const source=this.textures.get(sheet).getSourceImage(),sw=source.width/columns,sh=source.height/rows;
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
   const rowCuts=layout?layout.y.map(v=>Math.round(v*source.height)):gutters(rows,source.height,rowInk),cells=[];
   for(let row=0;row<rows;row++){
    const colInk=new Uint8Array(source.width);
    for(let x=0;x<source.width;x++)for(let y=rowCuts[row];y<rowCuts[row+1];y++)if(atlas[(y*source.width+x)*4+3]>175){colInk[x]=1;break;}
    const cuts=layout?(Array.isArray(layout.x[0])?layout.x[row]:layout.x).map(v=>Math.round(v*source.width)):gutters(columns,source.width,colInk);
    for(let col=0;col<columns;col++)cells.push({x:cuts[col],y:rowCuts[row],w:cuts[col+1]-cuts[col],h:rowCuts[row+1]-rowCuts[row],dx:sw*.25+cuts[col]-col*sw,dy:sh*.25+rowCuts[row]-row*sh});
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
    const footY=y1;
    x0=Math.max(0,x0-3);y0=Math.max(0,y0-3);x1=Math.min(cw-1,x1+3);y1=Math.min(ch-1,y1+3);
    return {x0,y0,x1,y1,footY};
   });
   // Animation cells share one crop and one scale; per-frame trimming makes feet slide.
   names.forEach((name,i)=>{
    const groupSize=sharedBounds===true?names.length:sharedBounds||1,start=Math.floor(i/groupSize)*groupSize,group=bounds.slice(start,start+groupSize);
    const {x0,y0,x1,y1}={x0:Math.min(...group.map(b=>b.x0)),y0:Math.min(...group.map(b=>b.y0)),x1:Math.max(...group.map(b=>b.x1)),y1:Math.max(...group.map(b=>b.y1))};
    drawCell(i);
    const texture=this.textures.createCanvas(name,x1-x0+1,y1-y0+1);
    texture.getContext().drawImage(scratch,x0,y0,texture.width,texture.height,0,0,texture.width,texture.height);texture.refresh();
    // Preserve shared dimensions, but anchor each frame by its visible supporting foot.
    this.grounding.set(name,(bounds[i].footY-y0)/texture.height);
   });
  }
  create(){
   this.sliceAtlas('allies',['girl','haetae','rabbit','keeper','haetaeStomp','girlCast']);
   this.sliceAtlas('enemies',['skirt0','skirt1','horse','reaper','boss','cloud']);
   for(const kind of ['haetae','rabbit'])this.sliceAtlas(kind+'Motion',Array.from({length:8},(_,i)=>kind+i),4,true);
   this.sliceAtlas('companionWalk',Array.from({length:4},(_,i)=>'girl'+i),4,4);
   this.sliceAtlas('enemyWalk',['skirt','horse','reaper','bossLegacy'].flatMap(kind=>Array.from({length:4},(_,i)=>kind+'Walk'+i)),4,4,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   this.sliceAtlas('bossMotion',[...Array.from({length:6},(_,i)=>'bossWalk'+i),...Array.from({length:6},(_,i)=>'bossStrike'+i),...Array.from({length:4},(_,i)=>'bossCast'+i)],4,true,4);
   this.sliceAtlas('reaperDeparture',Array.from({length:8},(_,i)=>'reaperDepart'+i),4,true);
   this.sliceAtlas('woundArt',['Cloth','Scar','Fur','Dark'].map(k=>'wound'+k+'1').concat(['Cloth','Scar','Fur','Dark'].map(k=>'wound'+k+'2')),4,false,2,{x:[0,.25,.5,.75,1],y:[0,.5,1]});
   for(const kind of ['keeper','keeperBrush','scholar','mount','healer'])this.sliceAtlas(kind+'Walk',Array.from({length:8},(_,i)=>kind+i),4,true);
   this.sliceAtlas('enemyDefeat',['skirt','horse','boss'].flatMap(k=>Array.from({length:4},(_,i)=>'depart'+k+i)),4,4,3);
   this.sliceAtlas('allyDefeat',['girl','haetae','cow','keeper','rabbit','scholar','healer','mount'].flatMap(k=>['defeat'+k+'0','defeat'+k+'1']),4,2,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   this.sliceAtlas('allyHurt',['girl','haetae','cow','keeper','rabbit','scholar','healer','mount','umbrella','keeperBrush'].map(k=>'hurt'+k),5,false,2,{x:[[0,354,824,1266,1675,1983],[0,360,732,1184,1650,1983]].map(row=>row.map(x=>x/1983)),y:[0,384/793,1]});
   this.sliceAtlas('umbrellaMotion',Array.from({length:8},(_,i)=>'umbrella'+i),4,true);
   const cowRows=MOTION.cow.walkFrames/4;
   this.sliceAtlas('cowWalk',Array.from({length:48},(_,i)=>'cow'+i),4,true,cowRows,{x:[0,.25,.5,.75,1],y:Array.from({length:cowRows+1},(_,i)=>i/cowRows)});
   this.sliceAtlas('cowAttack',Array.from({length:16},(_,i)=>'cowSource'+i),4,true,4);
   for(const [name,from] of [['cow56','cow10'],...Array.from({length:8},(_,i)=>['cow'+(48+i),'cowSource'+(8+i)])]){
    const source=this.textures.get(from).getSourceImage(),texture=this.textures.createCanvas(name,source.width,source.height);
    texture.getContext().drawImage(source,0,0);texture.refresh();this.grounding.set(name,this.grounding.get(from));
   }
   for(let i=0;i<16;i++)this.textures.remove('cowSource'+i);
   for(const [sheet,rows] of [['combatFX',['Impact','Slash','Curse','Dust']],['magicFX',['Seal','Ward','Leaf','Smoke']]])this.sliceAtlas(sheet,rows.flatMap(kind=>Array.from({length:4},(_,i)=>'fx'+kind+i)),4,4,4);
   this.sliceAtlas('cleanFX',['CleanImpact','CleanSlash','CleanCurse','CleanGuard'].flatMap(kind=>Array.from({length:4},(_,i)=>'fx'+kind+i)),4,4,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   this.sliceAtlas('actionIcons',['iconKeeper','iconRabbit','iconCharm','iconStomp','iconShelter','iconSound']);
   this.sliceAtlas('livingScenery',['pine','mist','dragon','grass'],2);
   this.sliceAtlas('enemyAttacks',['skirt','horse','reaper','bossLegacy'].flatMap(kind=>Array.from({length:4},(_,i)=>kind+'Strike'+i)),4,4,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   for(const area of AREAS){const texture=this.textures.get(area.texture),src=texture.getSourceImage(),split=Math.floor(src.height*(area.texture==='inwang'?395/724:.5));texture.add('far',0,0,0,src.width,split);texture.add('middle',0,0,split,src.width,src.height-split);}
   const roadTexture=this.textures.get('nightRoad'),roadSource=roadTexture.getSourceImage();
   ROAD_SECTIONS.forEach((part,i)=>roadTexture.add(part.frame,0,0,i*roadSource.height/4,roadSource.width,roadSource.height/4));
   this.root=this.add.container(0,0);
   this.sky=this.add.graphics();this.root.add(this.sky);
   this.moon=this.add.image(0,0,'moon');this.root.add(this.moon);
   this.depths={};
   for(const depth of ['far','middle']){const im=this.add.image(0,0,'inwang',depth).setOrigin(0,1);this.root.add(im);this.depths[depth]=im;}
   this.mists=[0,1,2].map(()=>this.add.image(0,0,'mist').setAlpha(.25));this.root.add(this.mists);
   this.dragon=this.add.image(0,0,'dragon').setAlpha(.25);this.root.add(this.dragon);
   this.pines=[0,1,2,3].map(()=>this.add.image(0,0,'pine').setOrigin(.5,1).setAlpha(.6));this.root.add(this.pines);
   this.road=this.add.graphics();this.root.add(this.road);
   // Reflections sit over the river but below opaque stones; transparent arches reveal them.
   this.reflections=new Map();this.waterReflections=this.add.container(0,0);this.root.add(this.waterReflections);
   this.pathTiles=ROAD_SECTIONS.map(part=>this.add.image(0,0,'nightRoad',part.frame).setOrigin(0,0));this.root.add(this.pathTiles);
   this.decor=this.add.graphics();this.root.add(this.decor);
   this.gate=this.add.image(0,0,'gate').setOrigin(.5,1);this.root.add(this.gate);
   this.gateFragments=Array.from({length:3},()=>this.add.image(0,0,'gate').setOrigin(.5,1).setVisible(false));this.root.add(this.gateFragments);
   this.gateMist=this.add.image(0,0,'fxSmoke1').setOrigin(.5,1);this.root.add(this.gateMist);
   this.shadows=this.add.graphics();this.root.add(this.shadows);
   this.hero=this.add.image(0,0,'haetae').setOrigin(.5,1);this.girl=this.add.image(0,0,'girl').setOrigin(.5,1);
   this.root.add([this.hero,this.girl]);
   this.ward=this.add.image(0,0,'fxWard1').setOrigin(.5,1).setVisible(false);this.root.add(this.ward);
   this.cloud=this.add.image(0,0,'cloud').setOrigin(.5,1).setAlpha(0);this.root.add(this.cloud);
   this.fx=this.add.graphics();this.root.add(this.fx);
   this.near=[0,1,2,3,4,5].map(()=>this.add.image(0,0,'grass').setOrigin(.5,1));this.root.add(this.near);
   this.tags=new Map();
   this.exitLabel=this.add.text(0,0,'새벽문',{fontFamily:'AppleMyungjo,serif',fontSize:'22px',color:'#776850'}).setOrigin(.5);
   this.root.add(this.exitLabel);
   this.ready=true;this.resize();this.scale.on('resize',()=>this.resize());
   // Browser toolbar movement changes the stage without always resizing the layout viewport.
   this.stageObserver=new ResizeObserver(()=>this.resize());this.stageObserver.observe(document.getElementById('game'));
   this.events.once('shutdown',()=>this.stageObserver.disconnect());
   this.input.keyboard?.on('keydown',e=>{if(['ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();});
   onReady(null,this);
  }
  resize(){
   if(!this.root)return;
   const bounds=document.getElementById('game').getBoundingClientRect(),density=Math.min(2,Math.max(1.5,window.devicePixelRatio||1));
   const width=Math.round(bounds.width*density),height=Math.round(bounds.height*density);
   if(width<=0||height<=0)return;
   // FIT owns the input/display transform; CSS pixels do not set drawing resolution.
   if(this.scale.gameSize.width!==width||this.scale.gameSize.height!==height)this.scale.setGameSize(width,height);
   const phone=window.matchMedia('(max-width:1000px) and (orientation:landscape)').matches;
   // Keep the old battle viewport and foot height while painting more river behind the deck.
   const deck=document.querySelector('.control-deck').getBoundingClientRect().height;
   const battleHeight=Math.max(1,bounds.height-deck),viewHeight=phone?Math.max(440,Math.min(620,620*2.35/(bounds.width/battleHeight))):620;
   this.viewHeight=viewHeight;this.unit=battleHeight*density/viewHeight;this.vw=width/this.unit;this.root.setScale(this.unit);this.root.y=(viewHeight-620)*this.unit;
   this.sceneBottom=620+deck*density/this.unit;
   this.game.canvas.dataset.viewHeight=String(Math.round(viewHeight));
   this.game.canvas.dataset.renderDensity=String(density);
  }
  drawLandscape(region,blend,t){
   const vw=this.vw,g=this.sky,bottom=this.sceneBottom||780;g.clear();
   const state=skyState(model.progress(),t,region),day=state.night===0;
   g.fillGradientStyle(day?0xa8d4e5:0x1b304d,day?0xc8e7ee:0x253e59,day?0xf5eacd:0x7994a2,day?0xd0dabb:0x5c7d90,1);g.fillRect(0,0,vw,bottom);
   const top=620-(this.viewHeight||620),moonX=state.moon.x*vw,moonY=top+200-state.moon.height*140;
   g.fillStyle(0xf9df9e,.045);g.fillCircle(moonX,moonY,109);
   this.moon.setPosition(moonX,moonY).setDisplaySize(145,145).setVisible(state.moon.visible);
   if(day){g.fillStyle(0xfff4c5,.13);g.fillCircle(moonX,moonY,73);g.fillStyle(0xfff9dc,.95);g.fillCircle(moonX,moonY,39);}
   for(let i=0;i<(day?0:27);i++){const x=(i*197+43)%Math.max(1,vw),y=top+35+(i*79)%190;g.fillStyle(0xf4e9c9,.18+.23*(.5+.5*Math.sin(t*.45+i)));g.fillCircle(x,y,i%4===0?1.3:.8);}
   for(const depth of ['far','middle']){
    // One authored panorama per depth covers the whole journey: no mirrored tiles or modulo seams.
    const w=Math.max(depth==='far'?2300:2800,vw+GATE*PARALLAX[depth]+80),h=depth==='far'?420:430,y=depth==='far'?525:544;
    this.depths[depth].setTexture(AREAS[region].texture,depth).setFlipX(false).setDisplaySize(w,h).setPosition(-40-this.offset*PARALLAX[depth],y).setTint(0xffffff).setAlpha(depth==='far'?.94:.82);
   }
   this.mists.forEach((im,i)=>{const w=390+i*170,src=im.texture.getSourceImage();im.setDisplaySize(w,w*src.height/src.width).setPosition(((i*670+t*(3+i)-this.offset*.07)%(vw+650)+vw+650)%(vw+650)-300,top+100+i*94).setTint(0xc4d2dd).setAlpha(.19+i*.025);});
   const fly=(t+8)%75,ds=this.dragon.texture.getSourceImage();this.dragon.setVisible(fly<18).setDisplaySize(140,140*ds.height/ds.width).setPosition(-170+(vw+340)*fly/18,top+95+Math.sin(fly*.55)*14).setAngle(Math.sin(fly*.8)*3);
   this.pines.forEach((im,i)=>{const src=im.texture.getSourceImage(),h=230+(i%2)*55;im.setDisplaySize(h*src.width/src.height,h).setPosition(i*1040-this.offset*.48-80,534).setTint(day?0xb9c7a3:0x83969a).setAlpha(day?.42:.78).setAngle(Math.sin(t*.6+i*2)*1.1);});
   const water=this.road;water.clear();
   water.fillGradientStyle(day?0x9bc4bc:0x7794a2,day?0x93bbae:0x55798c,day?0x668f88:0x1b354a,day?0x4d7f79:0x152b3e,1);water.fillRect(0,535,vw,bottom-535);
   // The lunar reflection widens toward the viewer; waves drift independently of solid ground.
   for(let i=0;i<47;i++){
    const y=540+i*6;if(y>bottom)break;
    const spread=24+i*3.1,x=moonX+Math.sin(i*1.7+t*.8)*spread*.35;
    water.lineStyle(i%4===0?2.3:1,0xffe2a1,.07+(i%5)*.026);
    water.lineBetween(x-spread*.5,y,x+spread*.5+Math.sin(t+i)*9,y);
   }
   for(let i=0;i<80;i++){
    const x=((i*173-this.offset*.14+t*(i%3+1))%(vw+240)+vw+240)%(vw+240)-120,y=545+(i*37)%Math.max(1,bottom-545);
    water.lineStyle(1,i%3?0xb3c9cb:0xeee8cf,.08+(i%4)*.027);water.lineBetween(x,y,x+17+i%5*8,y);
   }
   // Each long section is fixed in the world, with no modulo repeating the same road.
   this.pathTiles.forEach((im,i)=>{const part=ROAD_SECTIONS[i],x=part.x-this.offset*PARALLAX.ground;im.setPosition(x,GROUND-part.foot).setDisplaySize(part.width+.5,part.height).setTint(day?0xfff1d5:0xd7e2e5).setVisible(x<vw&&x+part.width>0);});
   for(let i=0;i<12;i++){const x=((i*181+t*5)%Math.max(1,vw)),y=GROUND-25+Math.sin(t*.8+i)*17;water.fillStyle(0xdceab3,.2+.3*Math.sin(t*2+i)**2);water.fillCircle(x,y,1.7);}
   this.near.forEach((im,i)=>{const src=im.texture.getSourceImage(),h=64+(i%2)*31;im.setDisplaySize(h*src.width/src.height,h).setPosition(i*560-this.offset*PARALLAX.near-100,bottom+8).setTint(0x9fb5bd).setAlpha(.8).setAngle(Math.sin(t*.9+i)*.8);this.root.bringToTop(im);});
  }
  drawReflections(t){
   // Reuse the rendered cel, injury texture, facing and foot origin; no second animation clock.
   const actors=[...this.sprites.entries(),['hero',this.hero],['girl',this.girl]],present=new Set();
   for(const [key,body] of actors){
    if(!body.visible||body.x<-250||body.x>this.vw+250)continue;
    present.add(key);let strips=this.reflections.get(key);
    if(!strips){strips=[this.add.image(0,0,body.texture.key)];this.waterReflections.add(strips);this.reflections.set(key,strips);}
    // A continuous silhouette cannot tear at crop boundaries. Ripples belong to the water.
    strips[0].setTexture(body.texture.key).setOrigin(body.originX,1-body.originY).setFlipX(body.flipX).setFlipY(true)
     .setDisplaySize(body.displayWidth,body.displayHeight*.78)
     .setPosition(body.x+Math.sin(t*.8+body.x*.006)*1.4,GROUND+68+(GROUND-body.y)*.78)
     .setAngle(-(body.angle||0)).setTint(model.stage===1?0x699c93:0xa2baca).setAlpha(.19*(body.alpha??1));
   }
   for(const [key,strips] of this.reflections)if(!present.has(key)){strips.forEach(im=>im.destroy());this.reflections.delete(key);}
  }
  resetPresentation(){
   for(const strips of this.reflections?.values()||[])strips.forEach(im=>im.destroy());this.reflections?.clear();
   for(const e of this.effects)e.sprite?.destroy();this.effects=[];this.offset=0;this.heroPose=0;this.shake=0;this.hitStop=0;this.impactCooldown=0;this.contacts.clear();
  }
  previewTexture(key){return this.textures.get(key).getSourceImage().toDataURL?.('image/png');}
  bodyPose(base,kind){
   base=base.replace(/^injured[12]__/, '');
   const profile=WOUNDS[base.startsWith('keeperBrush')?'keeperBrush':kind];
   if(!profile)return {x:.5,y:.5,w:.4,h:.4,angle:0};
   let n=Number(base.match(/(\d+)$/)?.[1]||0),poses=profile.poses;
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
   const x=((body.x-.5)*sx+side*body.w*.38)*image.displayWidth,y=(body.y-(image.originY??1))*image.displayHeight;
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
   this.grounding.set(key,this.grounding.get(base)??1);this.injuryTextures.set(key,true);return key;
  }
  placeOnGround(image,x,height,groundY=GROUND){
   const src=image.texture.getSourceImage();
   image.setOrigin(.5,this.grounding.get(image.texture.key)??1).setDisplaySize(height*src.width/src.height,height).setPosition(x,groundY).setAngle(0);
   this.shadows.fillStyle(0x554b36,.15);this.shadows.fillEllipse(x,groundY+2,Math.min(145,image.displayWidth*.77),9);
   this.shadows.fillStyle(0x524731,.29);this.shadows.fillEllipse(x,groundY+1,Math.min(105,image.displayWidth*.6),3.5);
  }
  trackContact(key,kind,walk,moving,x,groundY=GROUND){
   const beat=Math.floor(walk*MOTION[kind].walkFps/(MOTION[kind].walkFrames||4)*2),previous=this.contacts.get(key);
   this.contacts.set(key,beat);
   if(model.status!=='playing'||!moving||previous===undefined||previous===beat)return;
   const e={type:'footstep',kind,x,groundY};this.effects.push({...e,t:0,duration:.32});
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
    if(e.type==='hail-impact')for(const fx of this.effects)if(fx.type==='hail'){fx.blocked=e.blocked;fx.impacted=true;}
    if(e.type==='projectile'&&e.actor==='girl')this.heroPose=.25;
    if(e.type==='vanish'){
     const living=e.actor==='hero'?this.hero:e.actor==='girl'?this.girl:this.sprites.get((e.enemy===false?'a':'e')+e.actor);
     const key=e.enemy===false?'defeat'+e.kind+'0':e.kind==='reaper'?'reaperDepart0':'depart'+e.kind+'0';
     const sprite=this.add.image(0,0,key).setOrigin(.5,this.grounding.get(key)??1).setFlipX(living?.flipX||false);
     const src=sprite.texture.getSourceImage(),h=BODY_HEIGHT[e.kind];sprite.setDisplaySize(h*src.width/src.height,h);this.root.add(sprite);
     this.effects.push({...e,groundY:living?.y??e.groundY,type:'depart',sprite,t:0,duration:e.kind==='reaper'?REAPER_DEPARTURE_TIME:e.enemy===false?1.8:e.kind==='boss'?2.7:2.1});

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
     const label=e.reason==='defeat'?this.add.text(0,0,'+'+e.amount,{fontFamily:'sans-serif',fontSize:'24px',fontStyle:'bold',color:'#ffe6a4',stroke:'#614528',strokeThickness:4}).setOrigin(.5):null;
     if(label)this.root.add(label);this.effects.push({...e,type:'coin',sprite:label,t:0,duration:.72});
    }
    if(FX_LIFE[e.type]&&!(e.type==='vanish'&&e.enemy===false)){
     const art=e.art||(e.type==='summon'?({cow:'Dust',keeper:'Dust',rabbit:'Leaf',scholar:'Seal',healer:'Leaf',haetae:'Seal'}[e.kind]||'Seal'):e.type==='heal'&&e.enemy?'Smoke':FX_ART[e.type]);
     const sprite=art?this.add.image(0,0,'fx'+art+'0').setVisible(false):null;
     if(sprite)this.root.add(sprite);
     this.effects.push({...e,art,sprite,t:0,duration:e.type==='vanish'&&e.kind==='reaper'?REAPER_DEPARTURE_TIME:e.type==='vanish'?(e.kind==='boss'?2.7:2.1):e.type==='hit'&&e.enemy===false?ALLY_HIT_TIME:FX_LIFE[e.type]});
    }
   }
  }
  drawGate(x,t){
   const g=this.decor,front=this.fx,h=350,source=this.gate.texture.getSourceImage(),gate=model.enemies.find(e=>e.type==='gate');
   const ratio=gate?Math.max(0,gate.hp/gate.maxHp):model.gateBrokenAt!==null?0:1,broken=model.gateBrokenAt!==null;
   const p=broken?Math.min(1,(model.time-model.gateBrokenAt)/GATE_BREAK_TIME):0,w=h*source.width/source.height,visible=x>-330&&x<this.vw+330;
   const tremor=gate?.hit>0?Math.sin(t*95)*4:0;
   this.gate.setPosition(x+tremor,GROUND+31).setDisplaySize(w,h).setVisible(visible&&!broken).setAlpha(1).setTint(ratio<.34?0xc0bbb0:0xffffff);
   this.exitLabel.setVisible(visible);
   this.gateMist.setVisible(visible).setPosition(x,GROUND+3).setDisplaySize(120,230).setAlpha(broken?.6*(1-p):.2).setTint(broken?0xffe3a7:0x91d5cb);
   this.gateFragments?.forEach((im,i)=>{
    const regions=[[0,0,source.width,source.height*.36],[0,source.height*.36,source.width/2,source.height*.64],[source.width/2,source.height*.36,source.width/2,source.height*.64]],dir=i===1?-1:i===2?1:0;
    im.setVisible(visible&&broken&&p<1).setCrop(...regions[i]).setDisplaySize(w,h).setPosition(x+dir*100*p,GROUND+31-95*Math.sin(p*Math.PI)+170*p*p).setAngle((i===0?18:dir*27)*p).setAlpha(Math.max(0,1-p*p));
   });
   if(!visible)return;
   const color=broken?0xffd67d:gate?0xffbc73:0x51d9d7;
   g.fillStyle(0x233d42,.25);g.fillEllipse(x,GROUND+9,340,22);
   if(!broken){
    g.lineStyle(3,color,.4);g.strokeEllipse(x,GROUND-103,108,201);
    for(let i=0;i<7;i++){const q=(t*.3+i/7)%1;g.fillStyle(color,(1-q)*.7);g.fillCircle(x+Math.sin(i*2.4+q*3)*52,GROUND-15-q*200,2+q);}
    if(ratio<.67)for(let i=0;i<(ratio<.34?7:3);i++){
     const xx=x-90+i*29,yy=GROUND-255+(i%3)*48;
     for(const [width,c] of [[7,0x26302e],[2,color]]){front.lineStyle(width,c,.9);front.beginPath();front.moveTo(xx,yy);front.lineTo(xx-9,yy+27);front.lineTo(xx+11,yy+44);front.lineTo(xx-5,yy+76);front.strokePath();}
    }
   }
   if(broken||ratio<.34){
    for(let i=0;i<18;i++){const q=i/18,travel=broken?p:.12,xx=x+Math.sin(i*2.4)*(40+160*travel),yy=GROUND+10-110*Math.sin(travel*Math.PI)+120*travel*travel+(i%3)*5;
     front.fillStyle(i%2?0x718081:0xaaa792,broken?1-p*.4:.85);front.fillTriangle(xx-5-i%4,yy,xx+7,yy-7,xx+10,yy+6);}
   }
   if(broken){front.lineStyle(8,color,(1-p)*.8);front.strokeEllipse(x,GROUND-100,80+230*p,120+230*p);}
   this.exitLabel.setPosition(x,GROUND-h-1).setText(broken?'봉인 해제':!gate?'저승문 · 문지기의 봉인':ratio>.67?'저승문 · 문짝을 부수세요':ratio>.34?'저승문 · 균열':'저승문 · 붕괴 직전').setColor(model.stage===1?'#463e36':'#ffe3ad');
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
  renderEntity(key,type,x,walk,hp,maxHp,hit,windup,enemy=false,moving=0,action=null,hitDir=1,groundY=GROUND){
   let image=this.sprites.get(key);
   if(!image){image=this.add.image(0,0,MODEL_MAP[type]||type).setOrigin(.5,1);this.root.add(image);this.sprites.set(key,image);}
   if(enemy)image.setTexture(type==='boss'?bossPose(walk,moving,action,windup):type+(action||windup>0?'Strike':'Walk')+(action?enemyAttackFrame(action.elapsed):windup>0?1:motionFrame(type,walk,moving,null))).setFlipX(action? action.dir>0 : moving>0);
   if(!enemy&&UNITS[type])image.setTexture((type==='keeper'&&model.keeperRank?'keeperBrush':type)+motionFrame(type,walk,moving,action)).setFlipX(type==='healer'&&action?action.dir<0:action?false:moving?moving<0:image.flipX);
   if(!enemy&&hit>0)image.setTexture('hurt'+(type==='keeper'&&model.keeperRank?'keeperBrush':type));
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
   if(hit>0){
    const total=enemy?.26:ALLY_HIT_TIME,age=total-hit,response=age<.05?1:Math.max(0,1-(age-.05)/(total-.05))**2;
    image.x+=hitDir*response*(type==='boss'?5:10);
    image.setAngle(hitDir*response*(type==='boss'?2:5));
   }
   if(MOTION[type])this.trackContact(key,type,walk,moving,x,groundY);
   if(hit>(enemy?.225:ALLY_HIT_TIME-.035))image.setTintFill(0xfff7dd);else if(hit>0)image.setTint(enemy?0xf3c9b9:0xffae99);else image.clearTint();
   const arrival=this.effects.find(e=>e.type==='summon'&&e.actor===Number(key.slice(1)));
   image.setAlpha(hp<=0?0:enemy?P.Math.Clamp((GATE+55-x)/90,0,1):arrival?Math.min(1,.35+(model.time-arrival.at)*3):1);
   if(enemy&&x>GATE-65&&x<GATE+45){
    const q=P.Math.Clamp((GATE+45-x)/110,0,1),px=x-this.offset,color=type==='reaper'?0xb2daee:type==='skirt'?0xcebb88:0xb5a3ce;
    for(let i=0;i<5;i++){
     const xx=px+Math.sin(model.time*3+i)*28,yy=groundY-20-i*24;this.fx.fillStyle(color,(1-q)*.65);
     if(type==='skirt'){this.fx.lineStyle(2,color,(1-q)*.8);this.fx.lineBetween(xx,yy+45,xx+12,yy+25);}
     else if(type==='horse')this.fx.fillEllipse(xx+20,groundY-4-i%2*6,18+q*25,7+q*6);
     else if(type==='reaper')this.fx.fillTriangle(xx-4,yy+9,xx+4,yy+9,xx+Math.sin(model.time*4+i)*5,yy-12);
     else this.fx.fillCircle(xx,yy,2+i%3);
    }
   }
   if(hp<maxHp||windup>0){
    const w=type==='boss'?150:enemy?46:66,px=x-this.offset;
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
    if(type==='boss'){
     // Hail hits the party, not an ellipse under the distant caster.
     const left=model.x-this.offset-125;
     this.fx.fillStyle(0x775587,.13*pulse);this.fx.fillRoundedRect(left,GROUND-4,480,12,5);
     this.fx.lineStyle(3,0xd4b7e7,pulse);this.fx.lineBetween(left,GROUND-4,left+480,GROUND-4);
     for(let i=0;i<7;i++){const xx=left+20+i*70;this.fx.fillStyle(0xd6c1e5,pulse*.75);this.fx.fillTriangle(xx,GROUND-13,xx-6,GROUND-24,xx+6,GROUND-24);}
    }
   }
  }
  drawEffects(dt){
   const g=this.fx;
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
     const stone=e.kind==='stone',seed=e.kind==='seed',ink=e.kind==='ink',seal=e.kind==='seal',hex=e.kind==='hex',dir=Math.sign(e.to-e.from)||1;
     const source=e.actor==='girl'?this.girl:this.sprites.get((e.enemy?'e':'a')+e.actor);
     const target=e.targetActor===null?this.hero:this.sprites.get((e.enemy?'a':'e')+e.targetActor);
     if(!e.launchPoint){const at=source?this.bodyPoint(source,e.sourceKind,0,true):{x:e.from-this.offset+dir*18,y:ground-78};e.launchPoint={x:at.x+this.offset,y:at.y};}
     const close=target&&Math.abs((target.x+this.offset)-(e.to+(e.targetActor===null?37:0)))<=55;
     const end=close?this.bodyPoint(target,e.targetKind,-dir):{x:e.to-this.offset,y:(e.targetGroundY??GROUND)-(BODY_HEIGHT[e.targetKind]||132)*.52};
     if(e.hit===false)end.y=(e.targetGroundY??GROUND)-145;
     const from=e.launchPoint.x,fy=e.launchPoint.y,ty=end.y,travel=p;
     const at=q=>({x:(from-this.offset)+(end.x-(from-this.offset))*q,y:fy+(ty-fy)*q-Math.sin(q*Math.PI)*(stone?28:seed?8:16)}),head=at(travel);
     const color=hex?0xc49ae6:stone?0xeac276:seed?0xc3e975:ink?0x53c1b2:0x8fe6d5;
     ribbon(Array.from({length:5},(_,i)=>at(Math.max(0,travel-.2+i*.05))),stone?3:ink?6:4,color,1);
     if(hex){g.fillStyle(0x6b3e91,1);g.fillEllipse(head.x,head.y,23,14);g.fillStyle(0xf3defb,1);g.fillEllipse(head.x-dir*3,head.y-2,12,6);}
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
     const patient=e.targetActor===null?this.hero:this.sprites.get('a'+e.targetActor);
     const cx=patient?.x??x;
     if(!e.enemy)for(let i=0;i<4;i++){const xx=cx+(i-1.5)*25,yy=ground-55-i%2*28-70*p,r=5+(1-p)*2;g.lineStyle(6,0x1d6554,tail);g.lineBetween(xx-r,yy,xx+r,yy);g.lineBetween(xx,yy-r,xx,yy+r);g.lineStyle(3,0xa4ffd0,tail);g.lineBetween(xx-r,yy,xx+r,yy);g.lineBetween(xx,yy-r,xx,yy+r);}
     paint(e,x,ground-92-35*p,180,205,0,tail);
     if(e.enemy)e.sprite.setTint(0xaf8bbe);flecks(x,ground-20,p,e.enemy?0xb596cf:0xc8e59b,8,75,150);
     if(e.sourceKind==='healer'){
      const from=e.from-this.offset;
      for(let i=0;i<9;i++){const q=Math.min(1,p*2+i*.035),xx=from+(x-from)*q,yy=GROUND-85-Math.sin(q*Math.PI)*30;g.fillStyle(i%2?0xeaf0b8:0x81dbc7,(1-p)*.7);g.fillCircle(xx,yy,2+(i%3));}
     }
    }
    if(e.type==='shelter'){e.sprite.setVisible(false);flecks(x+90,GROUND-185,p,0xaee6dc,7,60,70);}
    if(e.type==='vanish'){
     const late=e.kind==='reaper'?Math.max(0,p-.22)/.78:Math.max(0,p-.65)/.35;
     paint(e,x,GROUND-(BODY_HEIGHT[e.kind]||132)*.45-80*late,155,205,0,Math.sin(late*Math.PI)*.7,late);
    }
    if(e.type==='footstep'){
     const q=p*p;g.fillStyle(0x877653,fade*.32);g.fillEllipse(x-8*q,ground,18+30*p,5+5*p);
     flecks(x,ground-2,p,0xc2b08a,3,24,15);
    }
    if(e.type==='healingAmount'){
     const patient=e.targetActor===null?this.hero:this.sprites.get('a'+e.targetActor);
     e.sprite.setPosition(patient?.x??x,ground-(BODY_HEIGHT[e.kind]||132)-18-38*p).setAlpha(Math.min(1,fade*3));this.root.bringToTop(e.sprite);
    }
    if(e.type==='damage'){
     const xx=x+(e.enemy?10:-14)+(e.lane-1)*18,yy=ground-(BODY_HEIGHT[e.kind]||132)*.7-42*(1-(1-p)**2)-e.lane*15;
     e.sprite.setPosition(xx,yy).setScale(1+Math.max(0,.14-p)*1.7).setAlpha(Math.min(1,fade*2.5));this.root.bringToTop(e.sprite);
    }
    if(e.type==='coin'){
     const y=GROUND-(BODY_HEIGHT[e.kind]||132)-12-70*p,count=e.reason==='defeat'?3:1;
     for(let i=0;i<count;i++){
      const xx=x+(i-1)*18*Math.sin(p*Math.PI),yy=y+18+i*6;
      g.fillStyle(0x76552b,tail);g.fillCircle(xx,yy,9);g.fillStyle(0xf3cf77,tail);g.fillCircle(xx,yy-1,7);g.fillStyle(0x695033,tail);g.fillRect(xx-2,yy-3,4,4);
     }
     if(e.sprite){e.sprite.setPosition(x,y-10).setAlpha(tail);this.root.bringToTop(e.sprite);}
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
     }else if(e.enemy===false){
      const key='defeat'+e.kind+(p<.32?'0':'1'),src=this.textures.get(key).getSourceImage();
      sprite.setTexture(key).setOrigin(.5,this.grounding.get(key)??1).setDisplaySize(h*.88*src.width/src.height,h*.88).setPosition(x+(e.dir||-1)*8*Math.min(1,p/.32),e.groundY??GROUND).setAngle(0).setAlpha(p<.62?1:Math.max(0,(1-p)/.38));
      if(p>.60)flecks(x,GROUND-h*.25,(p-.60)/.40,0xbad9c9,8,65,60);
     }else{
      const key='depart'+e.kind+enemyDepartureFrame(p),src=this.textures.get(key).getSourceImage();
      sprite.setTexture(key).setOrigin(.5,this.grounding.get(key)??1).setDisplaySize(h*src.width/src.height,h).setPosition(x,GROUND).setAlpha(p<.68?1:Math.max(0,(1-p)/.32));
      this.root.bringToTop(sprite);
      if(p>.60)flecks(x,GROUND-h*.2,(p-.60)/.40,e.kind==='boss'?0x97b5a2:0xaebcb9,8,85,70);
     }
    }

    if(p>=1)e.sprite?.destroy();
   }
   this.effects=this.effects.filter(e=>e.t<e.duration);
  }
  update(time,delta){
   if(!this.ready)return;
   const rawDt=Math.min(delta/1000,.05),playing=model.status==='playing',dt=playing?Math.max(0,rawDt-this.hitStop):rawDt;
   if(playing){this.hitStop=Math.max(0,this.hitStop-rawDt);this.impactCooldown=Math.max(0,this.impactCooldown-rawDt);}
   const intro=model.status==='ready',vw=this.vw;
   // Keep the rear support visible when possible, while a freely moving hero stays on screen.
   const partyLeft=Math.min(model.x-110,...model.allies.filter(a=>a.hp>0).map(a=>a.x-(BODY_HEIGHT[a.type]||130)*.5));
   const targetOffset=intro?0:Math.max(0,model.x-vw*.65,Math.min(GATE-vw*.80,model.x-vw*.28,partyLeft-35));
   this.offset+=(targetOffset-this.offset)*Math.min(1,dt*8);
   if(playing)model.step(dt);
   const events=model.drainEvents();this.playEvents(events);onEvents(events);
   const t=intro?12:model.time;
   const region=intro?this.previewAreaIndex:model.stage,blend=1;
   this.drawLandscape(region,blend,t);
   this.decor.clear();this.shadows.clear();this.fx.clear();
   this.drawGate(GATE-this.offset,t);
   // Small distance markers make scrolling legible, rather than a static left-side base.
   for(let p=800;p<ROAD;p+=800){
    const x=p-this.offset;if(x<-50||x>vw+50)continue;
    this.decor.fillStyle(0x978367,.5);this.decor.fillRect(x,GROUND-35,4,35);
    this.decor.lineStyle(1,0xb19b75,.65);this.decor.lineBetween(x-12,GROUND-35,x+19,GROUND-35);
   }
   const heroX=intro?vw*.68:model.x-this.offset;
   const walking=intro||model.moving!==0;
   if(playing)this.heroPose=Math.max(0,this.heroPose-dt);
   const sheltering=!intro&&model.shield>0,mounted=!intro&&(model.action?.kind==='rush'||sheltering);
   const opening=sheltering?6-model.shield:0;
   const heroFrame=sheltering?(opening<.6?Math.min(3,Math.floor(opening/.15)):walking?4+motionFrame('haetae',model.walk,true,null):7):mounted?(model.action.elapsed<.18?4:Math.floor(model.action.elapsed*14)%4):motionFrame('haetae',intro?t:model.walk,walking,intro?null:model.action);
   const heroHurt=!intro&&this.effects.some(e=>e.type==='hurt'&&model.time-(e.at??model.time-e.t)<ALLY_HIT_TIME);
   this.hero.setTexture(this.injuryTexture(heroHurt?'hurt'+(sheltering?'umbrella':mounted?'mount':'haetae'):(sheltering?'umbrella':mounted?'mount':'haetae')+heroFrame,mounted?'mount':'haetae',intro?MAX_HP:model.hp,MAX_HP)).setFlipX(sheltering||intro||model.action?false:model.moving?model.moving<0:this.hero.flipX);
   this.placeOnGround(this.hero,heroX+37,sheltering?BODY_HEIGHT.umbrella:mounted?BODY_HEIGHT.mount:intro?150:BODY_HEIGHT.haetae);
   this.girl.setTexture(this.injuryTexture(heroHurt?'hurtgirl':this.heroPose>0?'girlCast':'girl'+motionFrame('girl',intro?t:model.walk,walking,null),'girl',intro?MAX_HP:model.hp,MAX_HP)).setFlipX(intro||this.heroPose>0?false:model.moving?model.moving<0:this.girl.flipX);
   this.placeOnGround(this.girl,heroX-60,intro?145:117);
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
    for(const e of model.enemies.filter(e=>e.type!=='gate').sort((a,b)=>actorLayer(a)-actorLayer(b))){const key='e'+e.id;present.add(key);this.renderEntity(key,e.type,e.x,e.walk,e.hp,e.maxHp,e.hit,e.windup,true,e.moving,e.action,e.hitDir);}
    for(const a of [...model.allies].sort((a,b)=>actorLayer(a)-actorLayer(b))){const key='a'+a.id;present.add(key);this.renderEntity(key,a.type,a.x,a.walk,a.hp,a.maxHp,a.hit,0,false,a.moving,a.action,a.hitDir);}
   }
   for(const [key,obj] of this.sprites)if(!present.has(key)){obj.destroy();this.sprites.delete(key);this.contacts.delete(key);}
   // All summons finish ordering first: the traveller remains visible at every party size.
   this.root.bringToTop(this.hero);this.root.bringToTop(this.girl);
   this.drawReflections(t);
   const boss=model.enemies.find(e=>e.type==='boss');
   this.drawBossCloud(boss,t);
   this.ward.setVisible(false);
   if(model.shield>0){
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
 return new P.Game({type:P.AUTO,parent:'game',width:1280,height:620,transparent:false,backgroundColor:'#eee8d9',antialias:true,scene:RoadScene,scale:{mode:P.Scale.FIT,autoCenter:P.Scale.CENTER_BOTH},render:{roundPixels:false,powerPreference:'low-power'},audio:{noAudio:true},banner:false});
}
