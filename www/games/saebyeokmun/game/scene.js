import {ROAD,START,MOTION,motionFrame,walkPose,AREAS,areaIndex,BODY_HEIGHT,PARALLAX,ENEMY_STRIKE,enemyAttackFrame,UNITS} from './data.js?v=16';
const P=window.Phaser;
// Feet stand inside the painted road, not on its distant top edge.
const ROAD_EDGE=514,GROUND=542;
const MODEL_MAP={skirt:'skirt0',horse:'horse',reaper:'reaper',boss:'boss',rabbit:'rabbit',keeper:'keeper1',cow:'cow1',scholar:'scholar1'};
export function makeGame(model,onReady,onFrame,onEvents){
 class RoadScene extends P.Scene{
  constructor(){super('road');this.sprites=new Map();this.effects=[];this.grounding=new Map();this.contacts=new Map();this.offset=0;this.lastX=START;this.heroPose=0;this.shake=0;this.previewAreaIndex=0;}
  preload(){
   this.load.image('allies','./assets/allies.png');this.load.image('enemies','./assets/enemies.png');
   this.load.image('haetaeMotion','./assets/haetae-motion-v14.png');this.load.image('rabbitMotion','./assets/rabbit-motion-v10.png');
   for(const kind of ['girl','haetae'])this.load.image(kind+'Rig','./assets/'+kind+'-rig-v14b.png');this.load.image('reaperDeparture','./assets/reaper-departure-v14.png');this.load.image('actionIcons','./assets/action-icons-v11.png');
   for(const area of AREAS)this.load.image(area.texture,'./assets/'+area.file);
   this.load.image('roadScenery','./assets/road-scenery-v13.png');
   this.load.image('livingScenery','./assets/living-scenery-v11.png');
   this.load.image('enemyAttacks','./assets/enemy-attacks-v11.png');
   for(const [key,file] of Object.entries({keeperWalk:'doryeong-stone-v12',keeperBrushWalk:'doryeong-brush-v12',cowWalk:'cow-walk-gif-v16',cowAttack:'ox-motion-v14',scholarWalk:'scholar-motion-v12',mountWalk:'mounted-haetae-v12'}))this.load.image(key,'./assets/'+file+'.png');
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
  bakeWalk(kind){
   const spec=MOTION[kind],h=192,w=kind==='girl'?230:310,baseline=h-2;
   const parts=Object.fromEntries(['Body','Upper','Lower','Foot'].map(part=>[part,this.textures.get(kind+part).getSourceImage()]));
   const paint=(name,phase,idle=false)=>{
    const texture=this.textures.createCanvas(name,w,h),ctx=texture.getContext(),pose=walkPose(kind,phase,idle);
    ctx.translate(w/2,baseline);ctx.scale(h,h);
    const segment=(part,a,b,width)=>{
     const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),src=parts[part];
     ctx.save();ctx.translate(a.x,a.y);ctx.rotate(Math.atan2(dy,dx)-Math.PI/2);
     ctx.drawImage(src,0,src.height*.12,src.width,src.height*.76,-width/2,-.012,width,len+.025);ctx.restore();
    };
    for(const leg of pose.legs){
     const hip={x:leg.hipX,y:leg.hipY},ankle={x:leg.footX,y:leg.footY-leg.footHeight*.48};
     const dx=ankle.x-hip.x,dy=ankle.y-hip.y,d=Math.max(.001,Math.hypot(dx,dy)),along=(leg.upper**2-leg.lower**2+d*d)/(2*d),side=Math.sqrt(Math.max(0,leg.upper**2-along*along));
     const knee={x:hip.x+dx/d*along+dy/d*side*leg.bend,y:hip.y+dy/d*along-dx/d*side*leg.bend};
     ctx.globalAlpha=leg.far?.84:1;
     segment('Upper',hip,knee,leg.width*1.15);segment('Lower',knee,ankle,leg.width);
     const foot=parts.Foot,fh=leg.footHeight,fw=fh*foot.width/foot.height;
     ctx.save();ctx.translate(leg.footX,leg.footY);ctx.rotate(leg.angle);ctx.drawImage(foot,-fw/2,-fh,fw,fh);ctx.restore();
    }
    ctx.globalAlpha=1;const body=parts.Body,bh=pose.bodyHeight,bw=bh*body.width/body.height;
    ctx.drawImage(body,-bw/2,pose.bodyBottom+pose.bob-bh,bw,bh);
    texture.refresh();this.grounding.set(name,baseline/h);
   };
   for(let i=0;i<spec.walkFrames;i++)paint(kind+i,i/spec.walkFrames);
   paint(kind+spec.idleFrame,0,true);
  }
  create(){
   this.sliceAtlas('allies',['girl','haetae','rabbit','keeper','haetaeStomp','girlCast']);
   this.sliceAtlas('enemies',['skirt0','skirt1','horse','reaper','boss','cloud']);
   this.sliceAtlas('haetaeMotion',Array.from({length:16},(_,i)=>'haetaeSource'+i),4,true,4);
   this.sliceAtlas('rabbitMotion',Array.from({length:8},(_,i)=>'rabbit'+i),4,true);
   this.sliceAtlas('cowAttack',Array.from({length:16},(_,i)=>'cowSource'+i),4,true,4);
   // Extracted video cels use an exact grid and one shared crop/scale. Their
   // original full-body drawings replace only the ox's procedural walk.
   const cowRows=Math.ceil(MOTION.cow.walkFrames/4);
   this.sliceAtlas('cowWalk',Array.from({length:MOTION.cow.walkFrames},(_,i)=>'cow'+i),4,true,cowRows,{x:[0,.25,.5,.75,1],y:Array.from({length:cowRows+1},(_,i)=>i/cowRows)});
   for(const kind of ['girl','haetae']){this.sliceAtlas(kind+'Rig',['Body','Upper','Lower','Foot'].map(part=>kind+part),2,false,2,{x:[0,.65,1],y:[0,.62,1]});this.bakeWalk(kind);}
   // Keep the existing attack art and impact clock for both walk sources.
   const copies=[['cow'+MOTION.cow.idleFrame,'cow10'],...['cow','haetae'].flatMap(kind=>Array.from({length:MOTION[kind].attackFrames},(_,i)=>[kind+(MOTION[kind].walkFrames+i),kind+'Source'+(8+i)]))];
   for(const [name,from] of copies){
    const source=this.textures.get(from).getSourceImage(),texture=this.textures.createCanvas(name,source.width,source.height);
    texture.getContext().drawImage(source,0,0);texture.refresh();this.grounding.set(name,this.grounding.get(from));
   }
   for(const kind of ['cow','haetae'])for(let i=0;i<16;i++)this.textures.remove(kind+'Source'+i);
   this.sliceAtlas('reaperDeparture',Array.from({length:8},(_,i)=>'reaperDepart'+i),4,true);
   for(const kind of ['keeper','keeperBrush','scholar','mount'])this.sliceAtlas(kind+'Walk',Array.from({length:8},(_,i)=>kind+i),4,true);
   this.sliceAtlas('actionIcons',['iconKeeper','iconRabbit','iconCharm','iconStomp','iconShelter','iconSound']);
   this.sliceAtlas('livingScenery',['pine','mist','dragon','grass'],2);
   this.sliceAtlas('enemyAttacks',['skirt','horse','reaper','boss'].flatMap(kind=>Array.from({length:4},(_,i)=>kind+'Strike'+i)),4,4,4);
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
   this.shadows=this.add.graphics();this.root.add(this.shadows);
   this.hero=this.add.image(0,0,'haetae').setOrigin(.5,1);this.girl=this.add.image(0,0,'girl').setOrigin(.5,1);
   this.root.add([this.hero,this.girl]);
   this.cloud=this.add.image(0,0,'cloud').setOrigin(.5,1).setAlpha(0);this.root.add(this.cloud);
   this.fx=this.add.graphics();this.root.add(this.fx);
   this.near=[0,1,2,3,4,5].map(()=>this.add.image(0,0,'grass').setOrigin(.5,1));this.root.add(this.near);
   this.tags=new Map();
   this.exitLabel=this.add.text(0,0,'새벽문',{fontFamily:'AppleMyungjo,serif',fontSize:'22px',color:'#776850'}).setOrigin(.5);
   this.root.add(this.exitLabel);
   this.entryLabel=this.add.text(0,0,'저승문',{fontFamily:'AppleMyungjo,serif',fontSize:'18px',color:'#bbd5c8'}).setOrigin(.5);this.root.add(this.entryLabel);
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
    if(e.type==='coin'){const label=this.add.text(0,0,'+'+e.amount,{fontFamily:'sans-serif',fontSize:e.reason==='defeat'?'21px':'15px',fontStyle:'bold',color:'#a17727',stroke:'#fff5d6',strokeThickness:3}).setOrigin(.5);this.root.add(label);this.effects.push({...e,type:'coin',sprite:label,t:0,duration:1.05});}
    if(['projectile','stomp','hit','vanish','hail','summon','heal','swipe','shelter','charge','guard','hex','claw'].includes(e.type))this.effects.push({...e,t:0,duration:e.type==='hail'?1.2:e.type==='stomp'?.65:e.type==='projectile'?.14:e.type==='shelter'?1:.6});
   }
  }
  drawGate(x,entry=false){
   const g=this.decor;
   if(entry){
    // The arrival threshold stays on the visible right edge; characters walk through it.
    g.fillStyle(0x334647,.87);g.fillRect(x-56,GROUND-221,126,221);
    g.fillStyle(0x183137,.68);g.fillRect(x-35,GROUND-207,91,207);
    for(let i=0;i<7;i++){g.fillStyle(0x83c3bd,.018*(7-i));g.fillEllipse(x-24-i*4,GROUND-96,44+i*18,185+i*4);}
   }
   g.lineStyle(3,0x86775e,1);g.strokeRect(x-85,GROUND-225,16,225);g.strokeRect(x+69,GROUND-225,16,225);
   g.fillStyle(0x929487,.8);g.fillPoints([{x:x-120,y:GROUND-222},{x:x-67,y:GROUND-258},{x:x+67,y:GROUND-258},{x:x+120,y:GROUND-222}],true);
   g.lineStyle(3,0x5c6155,.9);g.strokePoints([{x:x-125,y:GROUND-222},{x:x-67,y:GROUND-258},{x:x+67,y:GROUND-258},{x:x+125,y:GROUND-222}]);
   g.lineStyle(1,0x6f725f,.6);for(let i=-65;i<85;i+=17)g.lineBetween(x+i,GROUND-251,x+i+12,GROUND-223);
   g.fillStyle(0x469795,entry?.18:.06);g.fillRect(x-67,GROUND-220,134,220);g.fillStyle(0xf7f3dc,.2);g.fillEllipse(x,GROUND-115,100,190);
  }
  renderEntity(key,type,x,walk,hp,maxHp,hit,windup,enemy=false,moving=0,action=null,hitDir=1,groundY=GROUND){
   let image=this.sprites.get(key);
   if(!image){image=this.add.image(0,0,MODEL_MAP[type]||type).setOrigin(.5,1);this.root.add(image);this.sprites.set(key,image);}
   if(type==='skirt')image.setTexture(Math.floor(walk*5)%2?'skirt1':'skirt0');
   if(enemy&&(type!=='skirt'||action))image.setTexture(type+'Strike'+(action?enemyAttackFrame(action.elapsed):0));
   if(!enemy&&UNITS[type])image.setTexture((type==='keeper'&&model.keeperRank?'keeperBrush':type)+motionFrame(type,walk,moving,action)).setFlipX(moving<0&&!action);
   const height=BODY_HEIGHT[type]||130;
   this.placeOnGround(image,x-this.offset,height,groundY);
   this.root.bringToTop(image);
   if(enemy&&action){
    const p=action.elapsed/ENEMY_STRIKE.duration,impact=ENEMY_STRIKE.impact/ENEMY_STRIKE.duration,dir=action.dir;
    const thrust=p<impact?-Math.sin(p/impact*Math.PI/2)*7:Math.sin((p-impact)/(1-impact)*Math.PI)*22;
    image.x+=dir*thrust;image.setAngle(dir*(p<impact?-4:7)*Math.sin(p*Math.PI));
    image.setDisplaySize(image.displayWidth*(1+.06*Math.sin(p*Math.PI)),height*(1-.035*Math.sin(p*Math.PI)));
    if(p<impact){this.fx.lineStyle(2,0x9c6958,.35);this.fx.lineBetween(image.x-dir*20,groundY-height*.6,image.x-dir*43,groundY-height*.63);}
   }else if(enemy&&windup>0){image.setAngle(Math.sin(windup*8)*1.8+(type==='horse'?5:0));}
   if(hit>0){
    const response=Math.sin(Math.PI*(1-Math.min(1,hit/.26)));
    image.x+=hitDir*response*(type==='boss'?5:10);
    image.setDisplaySize(image.displayWidth*(1+.07*response),height*(1-.06*response));
   }
   if(MOTION[type])this.trackContact(key,type,walk,moving,x,groundY);
   if(hit>0)image.setTint(enemy?0xe8b3a0:0xa9e2d7);else image.clearTint();
   image.setAlpha(hp<=0?0:1);
   if(hp<maxHp||windup>0){
    const w=type==='boss'?150:46,px=x-this.offset;
    this.fx.fillStyle(0x85755f,.18);this.fx.fillRoundedRect(px-w/2,groundY-height-13,w,3,1);
    this.fx.fillStyle(enemy?0xb76d59:0x388b7e,.8);this.fx.fillRect(px-w/2,groundY-height-13,w*Math.max(0,hp/maxHp),3);
   }
   if(windup>0){
    const px=x-this.offset;
    this.fx.lineStyle(2,0xae6345,.9);
    this.fx.lineBetween(px-4,groundY-height-43,px-4,groundY-height-28);this.fx.fillStyle(0xae6345,1);this.fx.fillCircle(px-4,groundY-height-22,1.8);
    if(type==='horse')this.fx.strokeEllipse(px-60,GROUND+2,160,12);
   }
  }
  drawEffects(dt){
   const g=this.fx;
   for(const e of this.effects){
    e.t+=dt;const p=Math.min(1,e.t/e.duration),fade=1-p;
    if(e.type==='projectile'){
     const seed=e.kind==='seed',stone=e.kind==='stone',ink=e.kind==='ink',seal=e.kind==='seal',dir=Math.sign(e.to-e.from)||1,start=e.from+dir*(seed?27:16),fromY=(e.groundY??GROUND)-(e.sourceKind==='girl'?66:seed?61:76),toY=GROUND-(BODY_HEIGHT[e.targetKind]||120)*.53;
     const x=start+(e.to-start)*p-this.offset,y=fromY+(toY-fromY)*p-Math.sin(p*Math.PI)*(stone?66:seed?6:18);
     const angle=Math.atan2(toY-fromY,e.to-start),dx=Math.cos(angle),dy=Math.sin(angle);
     g.lineStyle(seed?2:3,stone?0x9b8b70:ink?0x526a64:seed?0xb89556:0x55a5a3,fade);g.lineBetween(x-dx*30,y-dy*30,x,y);g.fillStyle(stone?0x8e8672:ink?0x314e47:seed?0x896d3d:0x3c9a99,.9);
     if(stone){g.fillEllipse(x,y,13,10);g.lineStyle(1,0x554f42,fade);g.strokeEllipse(x,y,13,10);}else if(seed)g.fillCircle(x,y,4);else if(ink){g.fillEllipse(x,y,17,6);g.fillCircle(x-dx*15,y-dy*15,2);}else{g.fillPoints([{x:x+dx*11,y:y+dy*11},{x:x-dy*5,y:y+dx*5},{x:x-dx*11,y:y-dy*11},{x:x+dy*5,y:y-dx*5}],true);if(seal){g.lineStyle(1,0x458983,fade);g.strokeCircle(x,y,17);}}
    }
    if(e.type==='stomp'){
     g.lineStyle(3,0x369f9e,fade);g.strokeEllipse(e.x-this.offset+200*p,GROUND-2,70+550*p,14+18*p);
     for(let i=0;i<6;i++)g.lineBetween(e.x-this.offset+50+i*55,GROUND-6,e.x-this.offset+55+i*55,GROUND-20*fade);
    }
    if(e.type==='footstep'){
     const x=e.x-this.offset,y=e.groundY??GROUND;
     g.lineStyle(1,0x9c8662,fade*.3);g.strokeEllipse(x,y+1,9+17*p,3+3*p);
     for(let i=0;i<3;i++){g.fillStyle(0xa88d62,fade*.26);g.fillCircle(x-9+i*8+(i-1)*9*p,y-2-8*Math.sin(p*Math.PI),1.5);}
    }
    if(e.type==='swipe'){
     const dir=Math.sign(e.to-e.x)||1,x=e.x-this.offset+dir*18,end=e.to-this.offset,y=(e.groundY??GROUND)-48;
     g.lineStyle(4,0x8c744a,fade);g.lineBetween(x,y+6,end,y-9);g.lineStyle(2,0x4faaa1,fade);g.lineBetween(x,y+3,end+dir*7*p,y-16);
    }
    if(e.type==='guard'){
     const x=e.x-this.offset+25;
     g.lineStyle(3,0xbda574,fade);for(let i=0;i<4;i++)g.lineBetween(x+15,GROUND-65,x+25+i*10,GROUND-92+i*17);
     g.lineStyle(2,0x9b8864,fade*.5);g.strokeEllipse(x-25,GROUND+1,88,5);
    }
    if(e.type==='hex'){
     const dir=Math.sign(e.to-e.x)||-1,x=e.x+(e.to-e.x)*p-this.offset,y=GROUND-(BODY_HEIGHT[e.sourceKind]*.5+(BODY_HEIGHT[e.targetKind]*.5-BODY_HEIGHT[e.sourceKind]*.5)*p);
     g.lineStyle(2,0x7d708e,fade);g.strokeCircle(x,y,7);g.lineBetween(x-dir*22,y+2,x-dir*5,y);
    }
    if(e.type==='claw'){
     const dir=Math.sign(e.to-e.x)||-1,y=GROUND-(BODY_HEIGHT[e.targetKind]||120)*.5;
     g.lineStyle(2,0x98705b,fade);for(let i=0;i<3;i++)g.lineBetween(e.to-this.offset-dir*(10+i*8),y-17,e.to-this.offset-dir*i*8,y+7);
    }
    if(e.type==='summon'||e.type==='heal'){
     g.lineStyle(2,0x368f82,fade);g.strokeEllipse(e.x-this.offset,GROUND-10-40*p,40+30*p,12);
    }
    if(e.type==='hit'||e.type==='vanish'){
     const h=(BODY_HEIGHT[e.kind]||120)*.53,dir=e.dir||1;
     for(let i=0;i<6;i++){g.fillStyle(e.enemy===false?0x469894:0x87745e,fade*.75);g.fillCircle(e.x-this.offset+dir*(6+i*6)*p,GROUND-h+Math.sin(i*1.7)*25*p,2.5*(1-p)+1);}
     if(p<.3){g.lineStyle(2,0xe5c585,fade);g.strokeCircle(e.x-this.offset,GROUND-h,5+14*p);}
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
    if(e.type==='coin'){
     const x=e.x-this.offset,y=GROUND-(BODY_HEIGHT[e.kind]||120)-20-55*p,count=e.reason==='defeat'?3:1;
     for(let i=0;i<count;i++){const cx=x+(i-(count-1)/2)*19*Math.sin(p*Math.PI),cy=y+22+Math.sin(p*Math.PI)*-15;g.fillStyle(0xd3ac55,fade);g.fillCircle(cx,cy,6);g.lineStyle(1,0x94723e,fade);g.strokeCircle(cx,cy,6);g.fillStyle(0xf4e9d0,fade);g.fillRect(cx-1.5,cy-1.5,3,3);}
     e.sprite.setPosition(x,y-2).setAlpha(Math.min(1,fade*2));this.root.bringToTop(e.sprite);if(p>=1)e.sprite.destroy();
    }
    if(e.type==='hail'){
     for(let i=0;i<13;i++){
      const x=e.x-this.offset-120+i*39,phase=(p+i*.08)%1;
      const y=80+phase*(e.blocked?255:420);
      g.lineStyle(2,0x78b4b0,fade*.85);g.strokeCircle(x,y,4);g.lineBetween(x+4,y-10,x+1,y-3);
     }
    }
   }
   this.effects=this.effects.filter(e=>e.t<e.duration);
  }
  update(time,delta){
   if(!this.ready)return;
   const dt=Math.min(delta/1000,.05),playing=model.status==='playing';
   const intro=model.status==='ready',vw=this.vw;
   const targetOffset=intro?0:Math.max(0,Math.min(ROAD-vw*.58,model.x-vw*.28));
   this.offset+=(targetOffset-this.offset)*Math.min(1,dt*8);
   model.spawnEdge=this.offset+vw;
   if(playing)model.step(dt);
   const events=model.drainEvents();this.playEvents(events);onEvents(events);
   const t=intro?time/1000:model.time;
   const region=intro?this.previewAreaIndex:areaIndex(model.progress()),blend=intro||region===0?1:Math.min(1,(model.progress()-AREAS[region].at)/.035);
   this.drawLandscape(region,blend,t);
   this.decor.clear();this.shadows.clear();this.fx.clear();
   const gateX=ROAD+50-this.offset;this.drawGate(gateX);this.exitLabel.setPosition(gateX,GROUND-280);
   this.entryLabel.setVisible(!intro&&!model.bossDefeated);
   if(!intro&&!model.bossDefeated){this.drawGate(vw-22,true);this.entryLabel.setPosition(vw-52,GROUND-238);}
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
    for(const e of model.enemies){const key='e'+e.id;present.add(key);this.renderEntity(key,e.type,e.x,e.walk,e.hp,e.maxHp,e.hit,e.windup,true,0,e.action,e.hitDir);}
    for(const a of model.allies){const key='a'+a.id,rank=model.allies.filter(b=>b.type===a.type&&b.id<a.id).length;present.add(key);this.renderEntity(key,a.type,a.x,a.walk,a.hp,a.maxHp,a.hit,0,false,a.moving,a.action,a.hitDir,GROUND+(rank%3)*24);}
   }
   for(const [key,obj] of this.sprites)if(!present.has(key)){obj.destroy();this.sprites.delete(key);this.contacts.delete(key);}
   const boss=model.enemies.find(e=>e.type==='boss');
   this.cloud.setAlpha(boss?.8:0);if(boss){this.cloud.setPosition(boss.x-this.offset,GROUND-210).setDisplaySize(530,370);}
   if(model.shield>0){
    const x=heroX;
    this.fx.lineStyle(3,0x499796,.6);this.fx.beginPath();this.fx.arc(x+95,GROUND-145,220,Math.PI,Math.PI*2);this.fx.strokePath();
    this.fx.fillStyle(0x88b6a4,.07);this.fx.fillEllipse(x+95,GROUND-120,445,300);
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
