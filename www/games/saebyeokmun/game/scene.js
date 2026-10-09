import {ROAD,GATE,START,MOTION,motionFrame,AREAS,areaIndex,BODY_HEIGHT,PARALLAX,ENEMY_STRIKE,enemyAttackFrame,UNITS} from './data.js?v=18';
const P=window.Phaser;
// Feet stand inside the painted road, not on its distant top edge.
const ROAD_EDGE=514,GROUND=542;
const MODEL_MAP={skirt:'skirt0',horse:'horse',reaper:'reaper',boss:'boss',rabbit:'rabbit',keeper:'keeper1',cow:'cow1',scholar:'scholar1'};
// Presentation only: combat and rewards remain exclusively in Journey.
const FX_ART={hit:'Impact',hurt:'Impact',swipe:'Slash',claw:'Curse',hex:'Curse',guard:'Ward',stomp:'Dust',rush:'Slash',charge:'Dust',summon:'Seal',shelter:'Ward',heal:'Leaf',upgrade:'Seal',vanish:'Smoke'};
const FX_LIFE={hit:.32,hurt:.36,swipe:.32,claw:.34,hex:.42,guard:.38,stomp:.68,rush:1.3,charge:.48,summon:.68,shelter:.65,heal:1.05,upgrade:1,vanish:1.05,projectile:.18,hail:1.15};
export function makeGame(model,onReady,onFrame,onEvents){
 class RoadScene extends P.Scene{
  constructor(){super('road');this.sprites=new Map();this.effects=[];this.grounding=new Map();this.contacts=new Map();this.offset=0;this.lastX=START;this.heroPose=0;this.shake=0;this.previewAreaIndex=0;}
  preload(){
   this.load.image('allies','./assets/allies.png');this.load.image('enemies','./assets/enemies.png');
   this.load.image('haetaeMotion','./assets/haetae-motion-v10.png');this.load.image('rabbitMotion','./assets/rabbit-motion-v10.png');
   this.load.image('companionWalk','./assets/companions-walk-v11.png');this.load.image('gate','./assets/underworld-gate-v17.png');this.load.image('enemyWalk','./assets/enemy-walk-v17.png');this.load.image('reaperDeparture','./assets/reaper-departure-v14.png');this.load.image('actionIcons','./assets/action-icons-v11.png');
   for(const area of AREAS)this.load.image(area.texture,'./assets/'+area.file);
   this.load.image('roadScenery','./assets/road-scenery-v13.png');
   this.load.image('livingScenery','./assets/living-scenery-v11.png');
   this.load.image('enemyAttacks','./assets/enemy-attacks-v17.png');
   for(const [key,file] of Object.entries({keeperWalk:'doryeong-stone-v12',keeperBrushWalk:'doryeong-brush-v12',cowWalk:'cow-walk-gif-v16',cowAttack:'ox-motion-v14',scholarWalk:'scholar-motion-v12',mountWalk:'mounted-haetae-v12',combatFX:'combat-fx-v18',magicFX:'magic-fx-v18'}))this.load.image(key,'./assets/'+file+'.png');
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
    const cuts=layout?layout.x.map(v=>Math.round(v*source.width)):gutters(columns,source.width,colInk);
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
   this.sliceAtlas('enemyWalk',['skirt','horse','reaper','boss'].flatMap(kind=>Array.from({length:4},(_,i)=>kind+'Walk'+i)),4,4,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   this.sliceAtlas('reaperDeparture',Array.from({length:8},(_,i)=>'reaperDepart'+i),4,true);
   for(const kind of ['keeper','keeperBrush','scholar','mount'])this.sliceAtlas(kind+'Walk',Array.from({length:8},(_,i)=>kind+i),4,true);
   const cowRows=MOTION.cow.walkFrames/4;
   this.sliceAtlas('cowWalk',Array.from({length:48},(_,i)=>'cow'+i),4,true,cowRows,{x:[0,.25,.5,.75,1],y:Array.from({length:cowRows+1},(_,i)=>i/cowRows)});
   this.sliceAtlas('cowAttack',Array.from({length:16},(_,i)=>'cowSource'+i),4,true,4);
   for(const [name,from] of [['cow56','cow10'],...Array.from({length:8},(_,i)=>['cow'+(48+i),'cowSource'+(8+i)])]){
    const source=this.textures.get(from).getSourceImage(),texture=this.textures.createCanvas(name,source.width,source.height);
    texture.getContext().drawImage(source,0,0);texture.refresh();this.grounding.set(name,this.grounding.get(from));
   }
   for(let i=0;i<16;i++)this.textures.remove('cowSource'+i);
   for(const [sheet,rows] of [['combatFX',['Impact','Slash','Curse','Dust']],['magicFX',['Seal','Ward','Leaf','Smoke']]])this.sliceAtlas(sheet,rows.flatMap(kind=>Array.from({length:4},(_,i)=>'fx'+kind+i)),4,4,4);
   this.sliceAtlas('actionIcons',['iconKeeper','iconRabbit','iconCharm','iconStomp','iconShelter','iconSound']);
   this.sliceAtlas('livingScenery',['pine','mist','dragon','grass'],2);
   this.sliceAtlas('enemyAttacks',['skirt','horse','reaper','boss'].flatMap(kind=>Array.from({length:4},(_,i)=>kind+'Strike'+i)),4,4,4,{x:[0,.25,.5,.75,1],y:[0,.25,.5,.75,1]});
   for(const area of AREAS){const texture=this.textures.get(area.texture),src=texture.getSourceImage();texture.add('far',0,0,0,src.width,Math.floor(src.height/2));texture.add('middle',0,0,Math.floor(src.height/2),src.width,Math.floor(src.height/2));}
   // Unequal atlas cells retain the wide painted path; only runtime texture frames are cropped.
   const roadTexture=this.textures.get('roadScenery'),roadSource=roadTexture.getSourceImage();
   for(const [name,x,y,w,h] of [['path',.02,.276,.66,.195],['cairn',.725,.155,.26,.31],['mile',.10,.55,.32,.37],['flowers',.475,.555,.495,.365]])roadTexture.add(name,0,Math.round(x*roadSource.width),Math.round(y*roadSource.height),Math.round(w*roadSource.width),Math.round(h*roadSource.height));
   this.root=this.add.container(0,0);
   this.sky=this.add.graphics();this.root.add(this.sky);
   this.depths={};
   for(const depth of ['far','middle'])this.depths[depth]=[0,1].map(()=>[0,1,2,3,4,5].map(i=>{const im=this.add.image(0,0,'inwang',depth).setOrigin(0,1).setFlipX(i%2===0);this.root.add(im);return im;}));
   this.mists=[0,1,2].map(()=>this.add.image(0,0,'mist').setAlpha(.25));this.root.add(this.mists);
   this.dragon=this.add.image(0,0,'dragon').setAlpha(.25);this.root.add(this.dragon);
   this.pines=[0,1,2,3].map(()=>this.add.image(0,0,'pine').setOrigin(.5,1).setAlpha(.6));this.root.add(this.pines);
   this.road=this.add.graphics();this.root.add(this.road);
   this.pathTiles=Array.from({length:8},()=>this.add.image(0,0,'roadScenery','path').setOrigin(0,0));this.root.add(this.pathTiles);
   this.pathProps=Array.from({length:9},(_,i)=>this.add.image(0,0,'roadScenery',['cairn','mile','flowers'][i%3]).setOrigin(.5,1));this.root.add(this.pathProps);
   this.decor=this.add.graphics();this.root.add(this.decor);
   this.gate=this.add.image(0,0,'gate').setOrigin(.5,1);this.root.add(this.gate);
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
   const viewHeight=phone?Math.max(440,Math.min(620,620*2.35/(bounds.width/bounds.height))):620;
   this.unit=height/viewHeight;this.vw=width/this.unit;this.root.setScale(this.unit);this.root.y=(viewHeight-620)*this.unit;
   this.game.canvas.dataset.viewHeight=String(Math.round(viewHeight));
   this.game.canvas.dataset.renderDensity=String(density);
  }
  drawLandscape(region,blend,t){
   const vw=this.vw,g=this.sky;g.clear();
   const progress=model.status==='ready'?[.12,.39,.73][region]:model.progress();
   const smooth=n=>{n=Math.max(0,Math.min(1,n));return n*n*(3-2*n);};
   const night=smooth((progress-.24)/.29)*(1-smooth((progress-.88)/.12));
   const dusk=Math.sin(smooth((progress-.23)/.29)*Math.PI);
   const mix=(a,b,v)=>P.Display.Color.Interpolate.ColorWithColor(P.Display.Color.ValueToColor(a),P.Display.Color.ValueToColor(b),1,v);
   const color=(a,b,v)=>{const c=mix(a,b,v);return P.Display.Color.GetColor(c.r,c.g,c.b);};
   const sky=color(color(0xede8db,0xe5ae86,dusk*.5),0x34495d,night*.92);
   g.fillStyle(sky,1);g.fillRect(0,0,vw,620);
   for(let i=0;i<12;i++){g.fillStyle(0xeec293,dusk*.04);g.fillRect(0,410+i*9,vw,12);}
   const sunProgress=progress>.88?(progress-.88)/.12:1-smooth(progress/.5);
   const sunX=vw*(progress>.88?.67:.76),sunY=510-sunProgress*265;
   g.fillStyle(0xe9b46c,(1-night)*.10);g.fillCircle(sunX,sunY,76);g.fillStyle(0xdfa062,(1-night)*.6);g.fillCircle(sunX,sunY,32);
   if(night>.02){
    for(let i=0;i<25;i++){const x=(i*197+43)%Math.max(1,vw),y=210+(i*79)%180;g.fillStyle(0xf4e9c9,night*(.22+.3*(.5+.5*Math.sin(t*.65+i))));g.fillCircle(x,y,i%4===0?1.5:1);}
    g.fillStyle(0xdbe9d4,night*.07);g.fillCircle(vw*.67,255,60);g.fillStyle(0xf4eed5,night*.85);g.fillCircle(vw*.67,255,22);g.fillStyle(sky,night);g.fillCircle(vw*.67+10,248,20);
   }
   const mountainTint=color(0xffffff,0x7fabbc,night*.65),groundTint=color(0xffffff,0x9fafb4,night*.6);
   for(const depth of ['far','middle']){
    const w=depth==='far'?1580:1280,h=depth==='far'?420:270,y=depth==='far'?465:515,shift=this.offset*PARALLAX[depth]%(2*w);
    this.depths[depth].forEach((layer,n)=>layer.forEach((im,i)=>im.setTexture(AREAS[n?region:Math.max(0,region-1)].texture,depth).setDisplaySize(w,h).setPosition(i*w-shift-w,y).setTint(mountainTint).setAlpha((n?blend:1)*(depth==='far'?.55:.75))));
   }
   this.mists.forEach((im,i)=>{const w=280+i*110,src=im.texture.getSourceImage();im.setDisplaySize(w,w*src.height/src.width).setPosition(((i*670+t*(5+i*2)-this.offset*.07)%(vw+650)+vw+650)%(vw+650)-300,140+i*72).setAlpha(.16+i*.025);});
   const fly=(t+8)%75,ds=this.dragon.texture.getSourceImage();this.dragon.setVisible(fly<18).setDisplaySize(140,140*ds.height/ds.width).setPosition(-170+(vw+340)*fly/18,168+Math.sin(fly*.55)*14).setAngle(Math.sin(fly*.8)*3);
   this.pines.forEach((im,i)=>{const src=im.texture.getSourceImage(),h=148+(i%2)*28;im.setDisplaySize(h*src.width/src.height,h).setPosition(i*810-(this.offset*.48)%1620-190,505).setAngle(Math.sin(t*.75+i*2)*1.7);});
   const road=this.road;road.clear();road.fillStyle(color(0xe8dfcb,0x77868a,night*.65),1);road.fillRect(0,ROAD_EDGE, vw,620-ROAD_EDGE);
   road.lineStyle(1,0xa79777,.35);road.lineBetween(0,ROAD_EDGE,vw,ROAD_EDGE);
   // Every ground mark shares the exact world-to-camera transform of the feet.
   for(let i=Math.floor(this.offset/51)-1;i<(this.offset+vw)/51+1;i++){
    const x=i*51-this.offset*PARALLAX.ground,y=GROUND+5+((i*37)%79+79)%79;
    road.lineStyle(1,0xa48b63,.1+(i%3)*.025);road.lineBetween(x,y,x+8+(i%5)*2,y-1);
    if(i%7===0){road.fillStyle(0xab9876,.12);road.fillEllipse(x+15,GROUND+3,27,3);}
   }
   this.pathTiles.forEach((im,i)=>im.setPosition(i*530-(this.offset%530)-530,ROAD_EDGE-3).setDisplaySize(540,102).setTint(groundTint));
   this.pathProps.forEach((im,i)=>{const key=['cairn','mile','flowers'][i%3],frame=im.frame,h=key==='cairn'?72:key==='mile'?80:39,x=i*550-(this.offset*.98)%1650-220;im.setPosition(x,ROAD_EDGE+3).setDisplaySize(h*frame.width/frame.height,h).setAlpha(.78).setTint(groundTint);});
   if(night>.1)for(let i=0;i<10;i++){const x=((i*181+t*9)%Math.max(1,vw)),y=GROUND-30+Math.sin(t*.8+i)*17;road.fillStyle(0xc0e7ae,night*(.2+.3*Math.sin(t*2+i)**2));road.fillCircle(x,y,2);}
   this.near.forEach((im,i)=>{const src=im.texture.getSourceImage(),h=53+(i%2)*18;im.setDisplaySize(h*src.width/src.height,h).setPosition(i*460-(this.offset*PARALLAX.near)%920-100,600+(i%2)*18).setAngle(Math.sin(t*.9+i)*.8);this.root.bringToTop(im);});
  }
  resetPresentation(){
   for(const e of this.effects)e.sprite?.destroy();this.effects=[];this.offset=0;this.heroPose=0;this.shake=0;this.contacts.clear();
  }
  previewTexture(key){return this.textures.get(key).getSourceImage().toDataURL?.('image/png');}
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
    const groundFor=id=>{const actor=model.allies.find(a=>a.id===id);return actor?GROUND+(model.allies.filter(a=>a.type===actor.type&&a.id<actor.id).length%3)*24:GROUND;};
    e.groundY=typeof e.actor==='number'?groundFor(e.actor):GROUND;
    e.targetGroundY=typeof e.targetActor==='number'?groundFor(e.targetActor):GROUND;
    if(e.type==='stomp'||e.type==='charge')this.shake=.16;
    if(e.type==='hurt')this.shake=.12;
    if(e.type==='projectile'&&e.actor==='girl')this.heroPose=.25;
    if(e.type==='vanish'){
     const key=e.kind==='reaper'?'reaperDepart0':MODEL_MAP[e.kind],sprite=this.add.image(0,0,key).setOrigin(.5,this.grounding.get(key)??1);
     const src=sprite.texture.getSourceImage(),h=BODY_HEIGHT[e.kind];sprite.setDisplaySize(h*src.width/src.height,h);this.root.add(sprite);
     this.effects.push({...e,type:'depart',sprite,t:0,duration:e.kind==='reaper'?3.1:e.kind==='boss'?2.1:1.35});
     if(e.kind==='horse'){
      const hat=this.add.image(0,0,'horse').setOrigin(.5,0),src=hat.texture.getSourceImage();
      hat.setCrop(0,0,src.width,Math.floor(src.height*.16)).setDisplaySize(BODY_HEIGHT.horse*src.width/src.height,BODY_HEIGHT.horse);this.root.add(hat);
      this.effects.push({...e,type:'hat',sprite:hat,t:0,duration:1.5});
     }
    }
    if(['hit','guard','hurt'].includes(e.type)&&e.damage){
     const lane=this.effects.filter(a=>a.type==='damage'&&Math.abs(a.x-e.x)<30).length%3;
     const label=this.add.text(0,0,(e.type==='guard'?'막음 ':'')+Math.ceil(e.damage),{fontFamily:'sans-serif',fontSize:e.kind==='boss'?'36px':'32px',fontStyle:'bold',color:e.type==='guard'?'#aeffee':e.enemy?'#fff4ce':'#ffd2b3',stroke:'#263431',strokeThickness:6}).setOrigin(.5);
     this.root.add(label);this.effects.push({...e,type:'damage',lane,sprite:label,t:0,duration:.66});
    }
    if(e.type==='coin'){
     const label=e.reason==='defeat'?this.add.text(0,0,'+'+e.amount,{fontFamily:'sans-serif',fontSize:'24px',fontStyle:'bold',color:'#ffe6a4',stroke:'#614528',strokeThickness:4}).setOrigin(.5):null;
     if(label)this.root.add(label);this.effects.push({...e,type:'coin',sprite:label,t:0,duration:.72});
    }
    if(FX_LIFE[e.type]){
     const art=e.type==='heal'&&e.enemy?'Smoke':FX_ART[e.type];
     const sprite=art?this.add.image(0,0,'fx'+art+'0').setVisible(false):null;
     if(sprite)this.root.add(sprite);
     this.effects.push({...e,art,sprite,t:0,duration:e.type==='vanish'&&e.kind==='reaper'?3.1:FX_LIFE[e.type]});
    }
   }
  }
  drawGate(x,t){
   const g=this.decor,h=350,source=this.gate.texture.getSourceImage(),cleared=model.bossDefeated;
   this.gate.setPosition(x,GROUND+31).setDisplaySize(h*source.width/source.height,h).setVisible(x>-330&&x<this.vw+330);
   this.exitLabel.setVisible(this.gate.visible);
   this.gateMist.setVisible(this.gate.visible).setPosition(x,GROUND+3).setDisplaySize(120,230).setAlpha(.24+Math.sin(t*.8)*.06).setTint(cleared?0xffe3a7:0x91d5cb);
   if(!this.gate.visible)return;
   // The light lives at the same world threshold as the art and enemy arrivals.
   const color=cleared?0xffd67d:0x51d9d7,pulse=.5+.5*Math.sin(t*2.1);
   g.fillStyle(0x233d42,.25);g.fillEllipse(x,GROUND+9,360,23);
   for(let i=4;i>0;i--){g.lineStyle(5+i*5,color,.035*(5-i));g.strokeEllipse(x,GROUND-94,70+i*18,188+i*13);}
   g.fillStyle(color,.10+pulse*.06);g.fillEllipse(x-8,GROUND+3,130,19);
   for(let i=0;i<9;i++){const phase=(t*.24+i/9)%1;g.fillStyle(i%2?0xf5f7d2:color,(1-phase)*.65);g.fillCircle(x+Math.sin(i*2.4+phase*3)*57,GROUND-17-phase*210,2+phase);}
   this.exitLabel.setPosition(x,GROUND-h-1).setText(cleared?'새벽문 · 길이 열렸다':'저승문 · 길의 끝').setColor(cleared?'#816337':'#356f6a');
  }
  renderEntity(key,type,x,walk,hp,maxHp,hit,windup,enemy=false,moving=0,action=null,hitDir=1,groundY=GROUND){
   let image=this.sprites.get(key);
   if(!image){image=this.add.image(0,0,MODEL_MAP[type]||type).setOrigin(.5,1);this.root.add(image);this.sprites.set(key,image);}
   if(enemy)image.setTexture(type+(action||windup>0?'Strike':'Walk')+(action?enemyAttackFrame(action.elapsed):windup>0?1:motionFrame(type,walk,moving,null))).setFlipX(action? action.dir>0 : moving>0);
   if(!enemy&&UNITS[type])image.setTexture((type==='keeper'&&model.keeperRank?'keeperBrush':type)+motionFrame(type,walk,moving,action)).setFlipX(moving<0&&!action);
   const height=BODY_HEIGHT[type]||130;
   this.placeOnGround(image,x-this.offset,height,groundY);
   this.root.bringToTop(image);
   if(enemy&&action){
    const p=action.elapsed/ENEMY_STRIKE.duration,impact=ENEMY_STRIKE.impact/ENEMY_STRIKE.duration,dir=action.dir;
    const thrust=p<impact?-Math.sin(p/impact*Math.PI/2)*7:Math.sin((p-impact)/(1-impact)*Math.PI)*22;
    image.x+=dir*thrust;image.setAngle(dir*(p<impact?-4:7)*Math.sin(p*Math.PI));
    // Whole-body drawings carry the pose; do not distort or hinge individual limbs.
    if(p<impact){this.fx.lineStyle(2,0x9c6958,.35);this.fx.lineBetween(image.x-dir*20,groundY-height*.6,image.x-dir*43,groundY-height*.63);}
   }else if(enemy&&windup>0){image.setAngle(Math.sin(windup*8)*1.8+(type==='horse'?5:0));}
   if(hit>0){
    const response=Math.sin(Math.PI*(1-Math.min(1,hit/.26)));
    image.x+=hitDir*response*(type==='boss'?5:10);
    image.setDisplaySize(image.displayWidth*(1+.07*response),height*(1-.06*response));
   }
   if(MOTION[type])this.trackContact(key,type,walk,moving,x,groundY);
   if(hit>0)image.setTint(enemy?0xe8b3a0:0xa9e2d7);else image.clearTint();
   image.setAlpha(hp<=0?0:enemy?P.Math.Clamp((GATE+55-x)/90,0,1):1);
   if(hp<maxHp||windup>0){
    const w=type==='boss'?150:46,px=x-this.offset;
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
    const q=phase??Math.min(1,e.t/e.duration),frame=q<.09?0:q<.34?1:q<.66?2:3;
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
   for(const e of this.effects){
    e.t=Math.min(e.duration,e.t+dt);const p=e.t/e.duration,fade=1-p,tail=p<.48?1:(1-p)/.52,x=(e.x??e.from??model.x)-this.offset,ground=e.groundY??GROUND;
    if(e.type==='projectile'){
     const stone=e.kind==='stone',seed=e.kind==='seed',ink=e.kind==='ink',seal=e.kind==='seal',dir=Math.sign(e.to-e.from)||1;
     const from=e.from+dir*18,fy=ground-(e.sourceKind==='girl'?65:seed?62:78),ty=GROUND-(e.hit===false?145:(BODY_HEIGHT[e.targetKind]||132)*.52),travel=Math.min(1,p/.8);
     const at=q=>({x:from+(e.to-from)*q-this.offset,y:fy+(ty-fy)*q-Math.sin(q*Math.PI)*(stone?64:seed?16:30)}),head=at(travel);
     const color=stone?0xeac276:seed?0xc3e975:ink?0x53c1b2:0x8fe6d5;
     ribbon(Array.from({length:7},(_,i)=>at(Math.max(0,travel-.45+i*.075))),stone?5:ink?10:6,color,tail);
     if(stone){g.fillStyle(0x574737,tail);g.fillPoints([{x:head.x-12,y:head.y-5},{x:head.x-4,y:head.y-11},{x:head.x+11,y:head.y-6},{x:head.x+10,y:head.y+7},{x:head.x-8,y:head.y+9}],true);g.fillStyle(0xd5b479,tail);g.fillEllipse(head.x-1,head.y-2,15,11);}
     else if(seed){g.fillStyle(0x375840,tail);g.fillEllipse(head.x,head.y,24,15);g.fillStyle(0xe6f4af,tail);g.fillEllipse(head.x+dir*3,head.y-2,15,8);}
     else if(ink){g.fillStyle(0x173e40,tail);g.fillEllipse(head.x,head.y,31,18);g.lineStyle(3,0xa3efe0,tail);g.lineBetween(head.x-dir*10,head.y-5,head.x+dir*11,head.y-1);}
     else{
      // An actual paper shape and vermilion stroke identify a talisman, even without color glow.
      const corners=[{x:head.x-dir*13,y:head.y-15},{x:head.x+dir*12,y:head.y-9},{x:head.x+dir*8,y:head.y+18},{x:head.x-dir*16,y:head.y+12}];
      g.fillStyle(0xffefd0,tail);g.fillPoints(corners,true);g.lineStyle(3,0x334e45,tail);g.strokePoints(corners,true);g.lineStyle(4,0xb64d33,tail);g.lineBetween(head.x,head.y-8,head.x-3,head.y+9);
      if(seal){g.lineStyle(3,0x73d1bd,tail);g.strokeEllipse(head.x,head.y,46,50);}
     }
    }
    if(e.type==='hit'||e.type==='hurt'){
     const y=ground-(BODY_HEIGHT[e.kind]||132)*.52,scale=e.kind==='boss'?1.35:1;
     paint(e,x,y,115*scale,105*scale,(e.dir||1)>0?-12:155,tail);
     if(!e.enemy)e.sprite.setTint(0xffbdac);else e.sprite.clearTint();
     flecks(x,y,p,e.enemy?0xf7cc72:0xe99379,5,75,28);
    }
    if(e.type==='swipe'){
     const dir=Math.sign(e.to-e.x)||1,y=(e.targetGroundY??GROUND)-(BODY_HEIGHT[e.targetKind]||132)*.47;
     paint(e,e.to-this.offset-dir*20,y,150,125,dir>0?-22:158,tail);
     flecks(e.to-this.offset,y,p,0xf6d297,5,70,30);
    }
    if(e.type==='claw'||e.type==='hex'){
     const dir=Math.sign(e.to-e.x)||-1,y=(e.targetGroundY??GROUND)-(BODY_HEIGHT[e.targetKind]||132)*.52,xx=e.to-this.offset;
     if(e.type==='hex'){
      const q=Math.min(1,p*3),startY=GROUND-BODY_HEIGHT.reaper*.64;
      ribbon(Array.from({length:8},(_,i)=>{const a=Math.max(0,q-.5+i*.5/7);return {x:e.x+(e.to-e.x)*a-this.offset,y:startY+(y-startY)*a+Math.sin(a*Math.PI)*-27};}),11,0xb69acf,tail);
     }
     paint(e,xx,y,e.type==='hex'?128:145,120,dir<0?0:180,tail);
     if(e.type==='claw'&&e.kind!=='reaper')e.sprite.setTint(0xffc2a5);
    }
    if(e.type==='guard'){
     const dir=Math.sign((e.from??e.x+1)-e.x)||1,y=ground-70;
     paint(e,x+dir*45,y,130,155,dir>0?90:-90,tail);
     flecks(x+dir*68,y,p,0xffd481,7,72,25);
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
    if(e.type==='summon'||e.type==='upgrade'){
     paint(e,x,ground-80,150,170,0,tail);flecks(x,ground-60,p,0xc1ead4,7,60,120);
    }
    if(e.type==='heal'){
     paint(e,x,ground-92-35*p,180,205,0,tail);
     if(e.enemy)e.sprite.setTint(0xaf8bbe);flecks(x,ground-20,p,e.enemy?0xb596cf:0xc8e59b,8,75,150);
    }
    if(e.type==='shelter')paint(e,x+95,GROUND-113,490,275,0,tail*.85);
    if(e.type==='vanish'){
     const late=e.kind==='reaper'?Math.max(0,p-.22)/.78:p;
     paint(e,x,GROUND-(BODY_HEIGHT[e.kind]||132)*.45-80*late,155,205,0,Math.sin(late*Math.PI)*.7,late);
    }
    if(e.type==='footstep'){
     const q=p*p;g.fillStyle(0x877653,fade*.32);g.fillEllipse(x-8*q,ground,18+30*p,5+5*p);
     flecks(x,ground-2,p,0xc2b08a,3,24,15);
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
     // One fall, then a ground/shield impact. No modulo loop making new rain appear forever.
     for(let i=0;i<14;i++){
      const q=Math.min(1,Math.max(0,(p-i*.026)/.62)),xx=x-120+i*35,end=e.blocked?GROUND-220:GROUND,yy=90+(end-90)*q*q;
      if(q<1){ribbon([{x:xx+24,y:yy-65},{x:xx+12,y:yy-27},{x:xx,y:yy}],5,0xbce7e4,tail);g.fillStyle(0x375f75,tail);g.fillPoints([{x:xx,y:yy-16},{x:xx+12,y:yy},{x:xx,y:yy+16},{x:xx-12,y:yy}],true);g.fillStyle(0xf2ffec,tail);g.fillTriangle(xx,yy-13,xx+8,yy,xx,yy+11);}
      else flecks(xx,end-4,Math.min(1,(p-i*.026-.62)/.3),e.blocked?0xa6efd6:0xc2e5e6,4,35,30);
     }
    }
    if(e.type==='depart'){
     const x=e.x-this.offset,h=BODY_HEIGHT[e.kind],sprite=e.sprite;
     if(e.kind==='reaper'){
      // The same man lifts his chin and opens his arms; only light leaves the eyes.
      const lift=Math.min(1,p/.46),rise=28*(lift*lift*(3-2*lift));
      const dissolve=Math.max(0,Math.min(1,(p-.55)/.45));
      const frame=p<.12?0:p<.23?1:p<.34?2:p<.45?3:p<.59?4:p<.73?5:p<.86?6:7;
      sprite.setTexture('reaperDepart'+frame).setOrigin(.5,this.grounding.get('reaperDepart0'));
      const src=sprite.texture.getSourceImage();sprite.setDisplaySize(h*src.width/src.height,h).setPosition(x,GROUND-rise).setAlpha(1-dissolve);
      this.root.bringToTop(sprite);
      const eyeX=x-sprite.displayWidth*.025,eyeY=GROUND-rise-h*.845;
      const glow=Math.min(1,Math.max(0,(p-.27)/.13))*(1-Math.max(0,(p-.75)/.25));
      for(const dx of [-3,3]){
       g.fillStyle(0x255957,.38*glow);g.fillCircle(eyeX+dx,eyeY,15);
       g.fillStyle(0xbcffe8,.35*glow);g.fillCircle(eyeX+dx,eyeY,11);
       g.fillStyle(0xffffe9,glow);g.fillEllipse(eyeX+dx,eyeY,8,5);
       const length=135*Math.min(1,Math.max(0,(p-.35)/.5));
       for(let j=0;j<12;j++){
        const q=j/12,qq=(j+1)/12,xx=eyeX+dx+Math.sin(q*4+p*3)*8*q,yy=eyeY-length*q;
        g.lineStyle(6*(1-q)+1,j%2?0xa0e4d8:0xf3f4ce,glow*(1-q));
        g.lineBetween(xx,yy,eyeX+dx+Math.sin(qq*4+p*3)*8*qq,eyeY-length*qq);
       }
      }
      if(dissolve>0)for(let i=0;i<18;i++){
       const q=i/18,swirl=Math.sin(i*2.7+p*7),xx=x+swirl*(18+36*dissolve),yy=GROUND-rise-20-q*150-55*dissolve;
       g.fillStyle(i%3?0x89999a:0xb8c6bb,Math.sin(dissolve*Math.PI)*.12);
       g.fillEllipse(xx,yy,14+24*dissolve,8+14*dissolve);
      }
     }else if(e.kind==='skirt'){
      sprite.setPosition(x+20*p,GROUND-30*p).setAlpha(fade*fade).setAngle(p*24);
      for(let i=0;i<9;i++){const xx=x+(i-4)*15*p+40*p,yy=GROUND-35-i*6-95*p;g.lineStyle(3, i%2?0xfaf4df:0xbeb39e,fade);g.lineBetween(xx,yy,xx+Math.sin(p*9+i)*12,yy-15);}
     }else if(e.kind==='horse'){
      sprite.setPosition(x,GROUND).setAlpha(Math.max(0,1-p*2));
      for(let i=0;i<10;i++){g.fillStyle(0x7d7567,fade*.35);g.fillCircle(x+Math.sin(i*2)*35*(1+p),GROUND-i*17-40*p,3+4*p);}
     }else{
      sprite.setPosition(x,GROUND+16*p).setTint(0xa8b6a0).setAlpha(Math.max(0,1-p*1.7));
      if(p>.35){const grow=Math.min(1,(p-.35)*3);g.lineStyle(2,0x558d70,fade+.2);g.lineBetween(x,GROUND,x,GROUND-27*grow);g.fillStyle(0x87b293,fade+.2);g.fillEllipse(x-7*grow,GROUND-16*grow,15*grow,7*grow);g.fillEllipse(x+7*grow,GROUND-23*grow,15*grow,7*grow);}
      for(let i=0;i<9;i++){g.fillStyle(0x6f7164,fade*.3);g.fillCircle(x+(i-4)*11,GROUND-70+60*p+Math.sin(i)*20,7*fade);}
     }
    }
    if(e.type==='hat'){const y=GROUND-BODY_HEIGHT.horse+(BODY_HEIGHT.horse-20)*Math.min(1,p*1.3);e.sprite.setPosition(e.x-this.offset+Math.sin(p*6)*18,y).setAngle(Math.sin(p*7)*12).setAlpha(p<.7?1:(1-p)/.3);}

    if(p>=1)e.sprite?.destroy();
   }
   this.effects=this.effects.filter(e=>e.t<e.duration);
  }
  update(time,delta){
   if(!this.ready)return;
   const dt=Math.min(delta/1000,.05),playing=model.status==='playing';
   const intro=model.status==='ready',vw=this.vw;
   const targetOffset=intro?0:Math.max(0,Math.min(GATE-vw*.80,model.x-vw*.28));
   this.offset+=(targetOffset-this.offset)*Math.min(1,dt*8);
   if(playing)model.step(dt);
   const events=model.drainEvents();this.playEvents(events);onEvents(events);
   const t=intro?time/1000:model.time;
   const region=intro?this.previewAreaIndex:areaIndex(model.progress()),blend=intro||region===0?1:Math.min(1,(model.progress()-AREAS[region].at)/.035);
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
   const mounted=!intro&&model.action?.kind==='rush';
   const heroFrame=mounted?(model.action.elapsed<.18?4:Math.floor(model.action.elapsed*14)%4):motionFrame('haetae',intro?t:model.walk,walking,intro?null:model.action);
   this.hero.setTexture((mounted?'mount':'haetae')+heroFrame).setFlipX(!intro&&model.moving<0&&!model.action);
   this.placeOnGround(this.hero,heroX+37,mounted?188:intro?150:132);
   this.girl.setTexture(this.heroPose>0?'girlCast':'girl'+motionFrame('girl',intro?t:model.walk,walking,null)).setFlipX(!intro&&model.moving<0&&this.heroPose<=0);
   this.placeOnGround(this.girl,heroX-60,intro?145:117);
   this.girl.setVisible(!mounted);this.root.bringToTop(this.hero);this.root.bringToTop(this.girl);
   if(!intro){this.trackContact('haetae','haetae',model.walk,model.moving,model.x+37);if(!mounted)this.trackContact('girl','girl',model.walk,model.moving,model.x-60);}
   this.lastX=model.x;
   const present=new Set();
   if(intro){
    this.renderEntity('previewRabbit','rabbit',vw*.86+this.offset,t*.6,1,1,0,0,false,1);present.add('previewRabbit');
    this.renderEntity('previewKeeper','keeper',vw*.54+this.offset,t*.65,1,1,0,0,false,1);present.add('previewKeeper');
    this.renderEntity('previewCow','cow',vw*.78+this.offset,t*.5,1,1,0,0,false,1);present.add('previewCow');
   }else{
    for(const e of model.enemies){const key='e'+e.id;present.add(key);this.renderEntity(key,e.type,e.x,e.walk,e.hp,e.maxHp,e.hit,e.windup,true,e.moving,e.action,e.hitDir);}
    for(const a of model.allies){const key='a'+a.id,rank=model.allies.filter(b=>b.type===a.type&&b.id<a.id).length;present.add(key);this.renderEntity(key,a.type,a.x,a.walk,a.hp,a.maxHp,a.hit,0,false,a.moving,a.action,a.hitDir,GROUND+(rank%3)*24);}
   }
   for(const [key,obj] of this.sprites)if(!present.has(key)){obj.destroy();this.sprites.delete(key);this.contacts.delete(key);}
   const boss=model.enemies.find(e=>e.type==='boss');
   this.cloud.setAlpha(boss?.8:0);if(boss){this.cloud.setPosition(boss.x-this.offset,GROUND-210).setDisplaySize(530,370);}
   this.ward.setVisible(model.shield>0).setPosition(heroX+95,GROUND+8).setDisplaySize(490,255).setAlpha(Math.min(1,model.shield)*(.52+.06*Math.sin(t*3)));
   if(model.shield>0)this.root.bringToTop(this.ward);
   // Effects render above the units.
   this.root.bringToTop(this.fx);
   if(playing)this.drawEffects(dt);else this.drawEffects(0);this.root.bringToTop(this.fx);
   if(this.shake>0){if(playing)this.shake-=dt;this.root.x=Math.sin(model.time*100)*2*this.unit;}else this.root.x=0;
   onFrame(model,this);
  }
 }
 return new P.Game({type:P.AUTO,parent:'game',width:1280,height:620,transparent:false,backgroundColor:'#eee8d9',antialias:true,scene:RoadScene,scale:{mode:P.Scale.FIT,autoCenter:P.Scale.CENTER_BOTH},render:{roundPixels:false,powerPreference:'low-power'},audio:{noAudio:true},banner:false});
}
