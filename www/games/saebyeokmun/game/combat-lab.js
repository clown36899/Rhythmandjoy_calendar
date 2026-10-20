// Local controller for the real game. Journey, UNITS and Scene retain ownership.
export function connectCombatLab(api){
 const {model,units,enemies={},autoplay}=api,origin=location.origin;
 let readySent=false,busy=false,active=true,endedAt=0,lastSample=performance.now(),previous=0,samples=[];
 const send=data=>parent.postMessage({type:'combat-lab:state',...data},origin);
 const wake=()=>api.scene()?.game?.loop?.wake(),sleep=()=>api.scene()?.game?.loop?.sleep();
 function play(value,rate=1){
  if(value&&!['playing','paused'].includes(model.status))throw Error('전투를 먼저 시작하세요.');
  if(![1,2,4,8].includes(Number(rate)))throw Error('배속을 확인하세요.');
  // Reuse the normal action policy without its tour-only invincibility.
  const invincible=model.invincible;
  if(value){if(!autoplay.active)autoplay.begin();autoplay.setRate(rate);model.setPartyHold(false);}
  else{autoplay.stop();model.auto=false;}
  model.invincible=invincible;
  const scene=api.scene();if(scene)scene.playbackRate=autoplay.rate;
  send({autoplay:autoplay.active,rate:autoplay.rate,invincible});
 }
 const limits={hp:[1,10000],damage:[0,1000],heal:[0,1000],walkSpeed:[0,400],speed:[1,400],runSpeed:[1,500],search:[1,4000],range:[1,2000],period:[.1,60],guard:[0,.95],cost:[0,100],cooldown:[0,120],motionSpeed:[.25,3]};
 function tune(who,values){
  const unit=units[who];if(!unit||!values||typeof values!=='object')throw Error('캐릭터를 확인하세요.');
  for(const [key,value]of Object.entries(values)){const range=limits[key];if(!range||!Number.isFinite(value)||value<range[0]||value>range[1])throw Error('능력치 범위를 확인하세요.');}
  const oldHP=unit.hp;Object.assign(unit,values);
  if(unit.hp!==oldHP)for(const a of model.allies.filter(a=>a.type===who&&a.hp>0)){const ratio=a.hp/a.maxHp;a.maxHp*=unit.hp/oldHP;a.hp=a.maxHp*ratio;}
 }
 window.addEventListener('message',async e=>{
  if(e.origin!==origin||e.source!==parent)return;
  const m=e.data;if(m?.type!=='combat-lab:command')return;
  let ownsStart=false;
  try{
   if(m.command==='active'){active=m.active!==false;if(active){previous=0;lastSample=performance.now();samples=[];wake();}else sleep();return;}
   if(m.command==='uiTheme'){if(!api.applyUITheme)throw Error('하단 UI를 불러오지 못했습니다.');send({uiTheme:api.applyUITheme(m.theme)});return;}
   if(m.command==='tune'){tune(m.character,m.values);send({applied:true,character:m.character});return;}
   if(m.command==='pause'){wake();api.pause();return;}
   if(m.command==='coins'){model.coins=100;return;}
   if(m.command==='invincible'){model.invincible=m.value===true;return;}
   if(m.command==='enemyInvincible'){model.enemyInvincible=m.value===true;send({enemyInvincible:model.enemyInvincible});return;}
   if(m.command==='spawnEnemy'){
    if(busy||model.status!=='playing')throw Error('전투 재생 중에 적을 소환하세요.');
    if(!Object.hasOwn(enemies,m.enemy)||m.enemy==='gate')throw Error('적 종류를 확인하세요.');
    const x=Math.min(model.gateX-50,Math.max(model.x+250,(model.viewport?.right??model.x+700)-100));
    const actor=model.spawn(m.enemy,x);actor.entering=false;actor.entryAt=model.time;wake();send({spawned:actor.type});return;
   }
   if(m.command==='autoplay'){if(!busy){wake();play(m.value===true,m.rate??1);}return;}
   if(m.command==='rate'){if(![1,2,4,8].includes(Number(m.rate)))throw Error('배속을 확인하세요.');autoplay.setRate(m.rate);const scene=api.scene();if(scene)scene.playbackRate=autoplay.rate;return;}
   if(m.command==='start'){
    if(busy||!api.ready())return;
    if(!units[m.character]||!Number.isInteger(m.stage)||m.stage<0||m.stage>=40)throw Error('전투 설정을 확인하세요.');
    busy=true;ownsStart=true;wake();send({busy:true});await api.start(m.character,m.stage);wake();if(m.autoplay&&model.status==='playing')play(true,m.rate??1);endedAt=0;samples=[];previous=0;lastSample=performance.now();send({busy:false,autoplay:autoplay?.active??false,rate:autoplay?.rate??1,invincible:model.invincible});
   }
  }catch(error){send({error:error.message,busy:ownsStart?false:busy});}finally{if(ownsStart)busy=false;}
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden)sleep();else if(active){previous=0;wake();}});
 return {themeChanged:uiTheme=>send({uiTheme}),tick(m,s){
  const now=performance.now();
  // A local trial stays on its selected stage and never enters the tour's next map.
  if(!busy&&autoplay?.active&&['won','lost'].includes(m.status))play(false);
  if(api.ready()&&!readySent){readySent=true;send({ready:true,uiThemes:api.uiThemes||[],enemies:Object.entries(enemies).filter(([key])=>key!=='gate').map(([key,s])=>({key,name:s.name}))});}
  if(previous&&m.status==='playing'&&now-previous<1000)samples.push(now-previous);
  previous=now;
  if(now-lastSample>=1000){
   const sorted=samples.slice().sort((a,b)=>a-b),count=samples.length,total=samples.reduce((a,b)=>a+b,0);
   send({ready:api.ready(),status:m.status,seconds:m.time,allies:m.allies.filter(a=>a.hp>0).length,enemies:m.enemies.filter(a=>a.hp>0).length,
    fps:total?1000*count/total:null,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]??null,
    stalls:samples.filter(t=>t>50).length,frames:count,busy,autoplay:autoplay?.active??false,rate:autoplay?.rate??1,invincible:m.invincible,enemyInvincible:m.enemyInvincible});
   samples=[];lastSample=now;
  }
  if(!busy&&['won','lost'].includes(m.status)){endedAt||=now;if(now-endedAt>3000)sleep();}else endedAt=0;
 }};
}
