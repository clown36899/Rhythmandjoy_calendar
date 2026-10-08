import {ROAD,GATE,START,MOTION,motionFrame,AREAS,areaIndex,BODY_HEIGHT,PARALLAX,ENEMY_STRIKE,enemyAttackFrame,UNITS} from './data.js?v=17';
const P=window.Phaser;
// Feet stand inside the painted road, not on its distant top edge.
const ROAD_EDGE=514,GROUND=542;
const MODEL_MAP={skirt:'skirt0',horse:'horse',reaper:'reaper',boss:'boss',rabbit:'rabbit',keeper:'keeper1',cow:'cow1',scholar:'scholar1'};
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
   for(const [key,file] of Object.entries({keeperWalk:'doryeong-stone-v12',keeperBrushWalk:'doryeong-brush-v12',cowWalk:'ox-guard-v12',scholarWalk:'scholar-motion-v12',mountWalk:'mounted-haetae-v12'}))this.load.image(key,'./assets/'+file+'.png');
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
   for(const kind of ['keeper','keeperBrush','cow','scholar','mount'])this.sliceAtlas(kind+'Walk',Array.from({length:8},(_,i)=>kind+i),4,true);
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
   this.shadows=this.add.graphics();this.root.add(this.shadows);
   this.hero=this.add.image(0,0,'haetae').setOrigin(.5,1);this.girl=this.add.image(0,0,'girl').setOrigin(.5,1);
   this.root.add([this.hero,this.girl]);
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
   for(const e of events){
    if(typeof e.actor==='number'){const actor=model.allies.find(a=>a.id===e.actor);if(actor)e.groundY=GROUND+(model.allies.filter(a=>a.type===actor.type&&a.id<actor.id).length%3)*24;}
    if(e.type==='stomp')this.shake=.15;
    if(e.type==='projectile'&&e.actor==='girl')this.heroPose=.25;
    if(e.type==='hurt')this.shake=.13;
    if(e.type==='vanish'){
     const departure=this.add.image(0,0,e.kind==='reaper'?'reaperDepart0':MODEL_MAP[e.kind]).setOrigin(.5,this.grounding.get(e.kind==='reaper'?'reaperDepart0':MODEL_MAP[e.kind])??1);
     const src=departure.texture.getSourceImage(),h=BODY_HEIGHT[e.kind];departure.setDisplaySize(h*src.width/src.height,h);this.root.add(departure);
     this.effects.push({...e,type:'depart',sprite:departure,t:0,duration:e.kind==='reaper'?3.1:e.kind==='boss'?2.1:1.35});
     if(e.kind==='horse'){
      const hat=this.add.image(0,0,'horse').setOrigin(.5,0),src=hat.texture.getSourceImage(),h=BODY_HEIGHT.horse;
      hat.setCrop(0,0,src.width,Math.floor(src.height*.16)).setDisplaySize(h*src.width/src.height,h);this.root.add(hat);this.effects.push({...e,type:'hat',sprite:hat,t:0,duration:1.75});
     }
    }
    if(['hit','guard','hurt'].includes(e.type)&&e.damage){
     const label=this.add.text(0,0,(e.type==='guard'?'막음 ':'')+Math.ceil(e.damage),{fontFamily:'sans-serif',fontSize:e.kind==='boss'?'29px':'25px',fontStyle:'bold',color:e.enemy?'#ffedac':e.type==='guard'?'#c9fff4':'#ffc0a0',stroke:'#343b34',strokeThickness:5}).setOrigin(.5);this.root.add(label);this.effects.push({...e,type:'damage',sprite:label,t:0,duration:.8});
    }
    if(e.type==='coin'){const label=this.add.text(0,0,'+'+e.amount,{fontFamily:'sans-serif',fontSize:e.reason==='defeat'?'21px':'15px',fontStyle:'bold',color:'#a17727',stroke:'#fff5d6',strokeThickness:3}).setOrigin(.5);this.root.add(label);this.effects.push({...e,type:'coin',sprite:label,t:0,duration:1.05});}
    if(['projectile','stomp','hit','vanish','hail','summon','heal','swipe','shelter','charge','rush','guard','hex','claw','hurt'].includes(e.type))this.effects.push({...e,t:0,duration:e.type==='hail'?1.2:e.type==='stomp'?.65:e.type==='projectile'?.22:e.type==='shelter'?1:e.type==='rush'?1.1:.55});
   }
  }
  drawGate(x,t){
   const g=this.decor,h=350,source=this.gate.texture.getSourceImage(),cleared=model.bossDefeated;
   this.gate.setPosition(x,GROUND+31).setDisplaySize(h*source.width/source.height,h).setVisible(x>-330&&x<this.vw+330);
   this.exitLabel.setVisible(this.gate.visible);
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
    if(type==='horse'||type==='boss'){
     this.fx.fillStyle(0xe37952,.12*pulse);this.fx.fillEllipse(px-130,GROUND+1,280,22);
     this.fx.lineStyle(3,0xdb804e,pulse);this.fx.strokeEllipse(px-130,GROUND+1,280,22);
    }
   }
  }
  drawEffects(dt){
   const g=this.fx;
   // Dark under-strokes and pale cores remain legible on both paper and night scenery.
   const beam=(x1,y1,x2,y2,color,width=5,alpha=1)=>{
    g.lineStyle(width+5,0x30443f,alpha*.75);g.lineBetween(x1,y1,x2,y2);
    g.lineStyle(width,color,alpha);g.lineBetween(x1,y1,x2,y2);
    g.lineStyle(Math.max(1,width*.27),0xfff9da,alpha*.95);g.lineBetween(x1,y1,x2,y2);
   };
   const burst=(x,y,p,color,scale=1)=>{
    const fade=1-p,r=(9+34*Math.sin(p*Math.PI/2))*scale;
    g.fillStyle(color,fade*.14);g.fillCircle(x,y,r*1.5);
    g.lineStyle(5,0x394637,fade*.7);g.strokeCircle(x,y,r*.7);
    g.lineStyle(2.5,color,fade);g.strokeCircle(x,y,r*.7);
    for(let i=0;i<7;i++){const a=i*Math.PI*2/7+.2,inner=r*.38,outer=r*(i%2?.85:1.25);beam(x+Math.cos(a)*inner,y+Math.sin(a)*inner,x+Math.cos(a)*outer,y+Math.sin(a)*outer,color,4*scale,fade);}
    if(p<.22){g.fillStyle(0xfffce7,1-p/.22);g.fillCircle(x,y,13*scale);}
   };
   for(const e of this.effects){
    e.t+=dt;const p=Math.min(1,e.t/e.duration),fade=1-p;
    if(e.type==='projectile'){
     const seed=e.kind==='seed',stone=e.kind==='stone',ink=e.kind==='ink',seal=e.kind==='seal',dir=Math.sign(e.to-e.from)||1,start=e.from+dir*(seed?27:16),fromY=(e.groundY??GROUND)-(e.sourceKind==='girl'?66:seed?61:76),toY=GROUND-(BODY_HEIGHT[e.targetKind]||120)*.53;
     const x=start+(e.to-start)*p-this.offset,y=fromY+(toY-fromY)*p-Math.sin(p*Math.PI)*(stone?60:seed?8:22);
     const angle=Math.atan2(toY-fromY,e.to-start),dx=Math.cos(angle),dy=Math.sin(angle),color=stone?0xffcc79:seed?0xcbe66a:0x65e8dc;
     g.fillStyle(color,.14);g.fillCircle(x,y,20);beam(x-dx*44,y-dy*44,x,y,color,seed?4:7,.95);
     g.fillStyle(stone?0xa38a5b:ink?0x245d64:color,1);
     if(stone){g.fillEllipse(x,y,20,16);g.lineStyle(3,0x3c4a3d,1);g.strokeEllipse(x,y,20,16);g.fillStyle(0xffecc1,1);g.fillEllipse(x-3,y-4,8,4);}
     else if(seed){g.fillCircle(x,y,7);g.fillStyle(0xffffd6,1);g.fillCircle(x,y,3);}
     else if(ink){g.fillEllipse(x,y,24,12);g.lineStyle(3,0x92eee1,1);g.strokeEllipse(x,y,24,12);}
     else{g.fillStyle(0xffefb6,1);g.fillPoints([{x:x+dx*16,y:y+dy*16},{x:x-dy*8,y:y+dx*8},{x:x-dx*16,y:y-dy*16},{x:x+dy*8,y:y-dx*8}],true);g.lineStyle(2,0x21554f,1);g.strokeCircle(x,y,seal?23:13);}
     for(let i=1;i<=3;i++){g.fillStyle(color,(1-i/4)*.8);g.fillCircle(x-dx*i*16,y-dy*i*16,4-i*.7);}
    }
    if(e.type==='stomp'){
     const x=e.x-this.offset;
     g.lineStyle(12,0x254e49,fade*.8);g.strokeEllipse(x+155*p,GROUND-2,80+630*p,22+45*p);
     g.lineStyle(6,0x6de9d6,fade);g.strokeEllipse(x+155*p,GROUND-2,80+630*p,22+45*p);
     g.lineStyle(2,0xfff2bb,fade);g.strokeEllipse(x+155*p,GROUND-4,55+570*p,15+30*p);
     for(let i=0;i<9;i++){const xx=x-30+i*53;beam(xx,GROUND-5,xx+Math.sin(i)*12,GROUND-18-60*Math.sin(p*Math.PI),0xffde88,4,fade);}
    }
    if(e.type==='footstep'){
     const x=e.x-this.offset,y=e.groundY??GROUND;
     g.lineStyle(1.5,0x90754e,fade*.45);g.strokeEllipse(x,y+1,10+21*p,4+4*p);
     for(let i=0;i<3;i++){g.fillStyle(0xb09462,fade*.38);g.fillCircle(x-9+i*8+(i-1)*10*p,y-2-10*Math.sin(p*Math.PI),2);}
    }
    if(e.type==='swipe'){
     const dir=Math.sign(e.to-e.x)||1,x=e.x-this.offset+dir*18,end=e.to-this.offset,y=(e.groundY??GROUND)-55;
     beam(x,y+20,end+dir*16,y-29,0xffd27c,9,fade);
     beam(x+dir*12,y+28,end+dir*25,y-7,0x8ce3c6,4,fade*.9);
     burst(end,GROUND-(BODY_HEIGHT[e.targetKind]||120)*.5,p,0xffd77e,.8);
    }
    if(e.type==='guard'){
     const dir=Math.sign((e.from??e.x+1)-e.x)||1,x=e.x-this.offset+dir*47,y=(e.groundY??GROUND)-65;
     g.lineStyle(10,0x25504e,fade*.85);g.beginPath();g.arc(x-dir*22,y,48,dir>0?-1.05:Math.PI-1.05,dir>0?1.05:Math.PI+1.05);g.strokePath();
     g.lineStyle(5,0x87efda,fade);g.strokePath();
     for(let i=0;i<4;i++)beam(x,y,x+dir*(27+i*9),y-35+i*22,0xffe3a0,3,fade);
    }
    if(e.type==='hex'){
     const dir=Math.sign(e.to-e.x)||-1,x=e.x+(e.to-e.x)*Math.min(1,p*2)-this.offset,y=GROUND-(BODY_HEIGHT[e.sourceKind]*.5+(BODY_HEIGHT[e.targetKind]*.5-BODY_HEIGHT[e.sourceKind]*.5)*Math.min(1,p*2));
     beam(x-dir*45,y+6,x,y,0xaf98f1,8,fade);g.fillStyle(0x59436d,fade);g.fillCircle(x,y,12);g.lineStyle(4,0xe4ceff,fade);g.strokeCircle(x,y,15);
     if(p>.45)burst(e.to-this.offset,GROUND-(BODY_HEIGHT[e.targetKind]||132)*.5,(p-.45)/.55,0xceaeff,.9);
    }
    if(e.type==='claw'){
     const dir=Math.sign(e.to-e.x)||-1,y=GROUND-(BODY_HEIGHT[e.targetKind]||120)*.5;
     for(let i=0;i<3;i++)beam(e.to-this.offset-dir*(20+i*15),y-36+i*5,e.to-this.offset+dir*(9-i*13),y+20,0xff9b70,5,fade);
    }
    if(e.type==='summon'||e.type==='heal'||e.type==='shelter'){
     const x=e.x-this.offset,color=e.type==='heal'?0xbce98b:0x71e5d2;
     g.lineStyle(7,0x355d4c,fade*.8);g.strokeEllipse(x,GROUND-5,50+95*p,15+12*p);g.lineStyle(3,color,fade);g.strokeEllipse(x,GROUND-5,50+95*p,15+12*p);
     for(let i=0;i<7;i++){const xx=x+Math.sin(i*2.3)*(23+30*p),yy=GROUND-12-100*p-i*8;beam(xx,yy+12,xx,yy-6,color,3,fade);}
    }
    if(e.type==='rush'||e.type==='charge'){
     const x=(e.type==='rush'?model.x:e.x)-this.offset,dir=e.type==='rush'?1:-1;
     for(let i=0;i<5;i++)beam(x-dir*(50+i*18),GROUND-20-i*20,x-dir*(150+60*p+i*12),GROUND-20-i*20,e.type==='rush'?0x73e6d0:0xffbd79,4,fade);
     g.lineStyle(4,0xffe8b2,fade);g.strokeEllipse(x,GROUND,100+120*p,18+12*p);
    }
    if(e.type==='hit'||e.type==='hurt'||e.type==='vanish'){
     const y=(e.groundY??GROUND)-(BODY_HEIGHT[e.kind]||132)*.53;
     burst(e.x-this.offset,y,p,e.type==='vanish'?0x9ff0d3:e.enemy?0xffd77b:0xff9b78,e.kind==='boss'?1.3:.85);
    }
    if(e.type==='damage'){
     const x=e.x-this.offset+(e.enemy?13:-14),y=(e.groundY??GROUND)-(BODY_HEIGHT[e.kind]||132)*.74-38*p;
     e.sprite.setPosition(x,y).setScale(1+Math.max(0,.18-p)*1.2).setAlpha(Math.min(1,fade*2.3));this.root.bringToTop(e.sprite);if(p>=1)e.sprite.destroy();
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
       g.fillStyle(0x81ded5,.1*glow);g.fillCircle(eyeX+dx,eyeY,15);
       g.fillStyle(0xf7ffe1,glow);g.fillEllipse(eyeX+dx,eyeY,4.5,2.8);
       const length=135*Math.min(1,Math.max(0,(p-.35)/.5));
       for(let j=0;j<12;j++){
        const q=j/12,qq=(j+1)/12,xx=eyeX+dx+Math.sin(q*4+p*3)*8*q,yy=eyeY-length*q;
        g.lineStyle(3*(1-q)+.5,j%2?0xa0e4d8:0xf3f4ce,glow*(1-q)*.8);
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
     if(p>=1)sprite.destroy();
    }
    if(e.type==='hat'){const y=GROUND-BODY_HEIGHT.horse+(BODY_HEIGHT.horse-20)*Math.min(1,p*1.3);e.sprite.setPosition(e.x-this.offset+Math.sin(p*6)*18,y).setAngle(Math.sin(p*7)*12).setAlpha(p<.7?1:(1-p)/.3);if(p>=1)e.sprite.destroy();}
    if(['hit','guard','hurt'].includes(e.type)&&e.damage){
     const label=this.add.text(0,0,(e.type==='guard'?'막음 ':'')+Math.ceil(e.damage),{fontFamily:'sans-serif',fontSize:e.kind==='boss'?'29px':'25px',fontStyle:'bold',color:e.enemy?'#ffedac':e.type==='guard'?'#c9fff4':'#ffc0a0',stroke:'#343b34',strokeThickness:5}).setOrigin(.5);this.root.add(label);this.effects.push({...e,type:'damage',sprite:label,t:0,duration:.8});
    }
    if(e.type==='coin'){
     const x=e.x-this.offset,y=GROUND-(BODY_HEIGHT[e.kind]||120)-20-55*p,count=e.reason==='defeat'?3:1;
     for(let i=0;i<count;i++){const cx=x+(i-(count-1)/2)*19*Math.sin(p*Math.PI),cy=y+22+Math.sin(p*Math.PI)*-15;g.fillStyle(0xd3ac55,fade);g.fillCircle(cx,cy,6);g.lineStyle(1,0x94723e,fade);g.strokeCircle(cx,cy,6);g.fillStyle(0xf4e9d0,fade);g.fillRect(cx-1.5,cy-1.5,3,3);}
     e.sprite.setPosition(x,y-2).setAlpha(Math.min(1,fade*2));this.root.bringToTop(e.sprite);if(p>=1)e.sprite.destroy();
    }
    if(e.type==='hail'){
     for(let i=0;i<17;i++){
      const x=e.x-this.offset-130+i*34,phase=(p+i*.08)%1,y=80+phase*(e.blocked?255:460);
      beam(x+14,y-32,x,y,0xc0f1f2,4,fade);
      g.fillStyle(0xe5ffff,fade);g.fillPoints([{x,y:y-9},{x:x+7,y},{x,y:y+9},{x:x-7,y}],true);g.lineStyle(2,0x337f92,fade);g.strokeCircle(x,y,8);
      if(phase>.86){g.lineStyle(3,e.blocked?0xa7fff1:0xffcd92,fade);g.strokeEllipse(x,e.blocked?335:GROUND,18+24*(phase-.86),8);}
     }
    }
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
   if(mounted){this.fx.lineStyle(3,0x68a9a2,.45);for(let i=0;i<4;i++)this.fx.lineBetween(heroX-95-i*12,GROUND-24-i*21,heroX-20,GROUND-24-i*21);}
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
   if(model.shield>0){
    const x=heroX;
    this.fx.lineStyle(8,0x285c5b,.9);this.fx.beginPath();this.fx.arc(x+95,GROUND-145,220,Math.PI,Math.PI*2);this.fx.strokePath();this.fx.lineStyle(4,0x9ef1df,.95);this.fx.strokePath();
    this.fx.fillStyle(0x88d6bb,.10);this.fx.fillEllipse(x+95,GROUND-120,445,300);
   }
   // Effects render above the units.
   this.root.bringToTop(this.fx);
   if(playing)this.drawEffects(dt);else this.drawEffects(0);this.root.bringToTop(this.fx);
   if(this.shake>0){if(playing)this.shake-=dt;this.root.x=Math.sin(model.time*100)*2*this.unit;}else this.root.x=0;
   onFrame(model,this);
  }
 }
 return new P.Game({type:P.AUTO,parent:'game',width:1280,height:620,transparent:false,backgroundColor:'#eee8d9',antialias:true,scene:RoadScene,scale:{mode:P.Scale.FIT,autoCenter:P.Scale.CENTER_BOTH},render:{roundPixels:false,powerPreference:'low-power'},audio:{noAudio:true},banner:false});
}
