import {ROAD,GATE,stageRoadEnd,stageGateX,START,WALK_SPEED,RUN_SPEED,MAX_HP,MAX_COINS,MAX_MANA,UNITS,ENEMIES,SKILLS,TEAM_SKILLS,ALLY_OUTPUT,MOTION,ENEMY_STRIKE,enemyStrike,ENEMY_OUTPUT,unitStats,SHOT_TIME,SPELL_AREAS,waveBalance,actorLayer,HERO_STANDOFF,ENEMY_FRONT,contactGap,STAGES,ALLY_HIT_TIME,GATE_BREAK_TIME,isBoss,DEFAULT_PARTY,validParty,BODY_HEIGHT,ALLY_TYPE_LIMIT,ALLY_TOTAL_LIMIT,TEST_MODE} from './data.js?v=226';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class Journey {
 constructor(){this.reset();}
 reset(){
  this.status='ready';this.party=[...DEFAULT_PARTY];this.time=0;this.x=START;this.furthest=START;this.hp=MAX_HP;this.coins=70;this.mana=70;
  this.auto=false;this.partyHold=false;this.invincible=false;this.enemyInvincible=false;this.tour=false;this.portal=null;this.direction=0;this.pendingMove=0;this.allies=[];this.enemies=[];this.projectiles=[];this.events=[];this.nextId=0;this.stage=0;this.gateBrokenAt=null;
  this.viewport=null;this.helperArrivals=new Map();this.teamAction=null;this.wave=0;this.waveClearAt=null;this.heroAttack=0;this.shield=0;this.shelterAt=null;this.waterWard=0;this.shieldKind=null;this.cooldowns=Object.fromEntries([...Object.keys(SKILLS),...Object.keys(UNITS),...Object.keys(TEAM_SKILLS)].map(k=>[k,0]));
  this.keeperRank=0;this.kills=0;this.earnedCoins=0;this.summons=0;this.casts=0;this.bossSpawned=false;this.bossDefeated=false;this.hint='집으로 가는 길을 동료와 함께 열어요.';
  delete this.engagedId;this.lastHintAt=0;this.hintSerial=0;this.action=null;this.walk=0;this.moving=0;this.lane=0;
 }
 start(stage=this.stage,party=DEFAULT_PARTY,viewportWidth=null,options={}){this.reset();this.party=validParty(party)?[...party]:[...DEFAULT_PARTY];this.stage=Number.isInteger(stage)&&STAGES[stage]?stage:0;this.tour=options.tour===true;this.x=this.furthest=this.startX;if(Number.isFinite(viewportWidth)&&viewportWidth>0){this.setViewport(0,viewportWidth);this.setViewport(Math.min(0,this.gateX-viewportWidth+this.portalInset),viewportWidth);}this.status='playing';this.emit('summon',{actor:'hero',kind:'haetae',x:this.x});this.say('');if(this.route.deployment&&!this.route.deployment.initialDelay)for(let i=0;i<this.route.deployment.initialWaves;i++)this.deployWave();}
 // Journey owns continuous depth and body clearance; Scene only projects it.
 get startX(){return this.tour?START:STAGES[this.stage].startX??START;}
 get lanes(){return STAGES[this.stage].combatLanes;}
 sameLane(a,b){return !this.lanes||b.type==='gate'||!Number.isFinite(a.lane)||!Number.isFinite(b.lane)||Math.abs(a.lane-b.lane)<.18;}
 canStrike(a,b){const weapon=UNITS[a.type]?.weapon,ranged=a===this||['stone','seed','ink','seal','charm','arrow'].includes(weapon)||a.type==='reaper'||['ranged','heal'].includes(ENEMIES[a.type]?.behavior);return ranged||this.sameLane(a,b)||this.lanes&&((a.x-b.x)/this.bodyClearance(a,b))**2+(((a.lane??0)-(b.lane??0))/.65)**2<=1.01;}
 contactDistance(a,b){return !this.lanes||b.type==='gate'||this.canStrike(a,b)?contactGap(a,b):Math.hypot(a.x-b.x,((a.lane??0)-(b.lane??0))*100)-(ENEMY_FRONT[a.type??'hero']??0)-(ENEMY_FRONT[b.type??'hero']??0);}
 placeLane(actor,side){
  if(!this.lanes||ENEMIES[actor.type]?.stationary)return;
  const bodies=[this,...this.allies,...this.enemies].filter(b=>b!==actor&&b.hp>0),seed=actor.id%3;
  const lanes=[0,1,2].sort((a,b)=>{const cost=k=>bodies.reduce((n,b)=>n+(Math.abs((b.lane??0)-k)<.6?Math.max(0,220-Math.abs(actor.x-b.x)):0),0);return cost(a)-cost(b)||(a-seed+3)%3-(b-seed+3)%3;});
  actor.lane=actor.laneGoal=lanes[0];actor.laneNextAt=this.time+2+(actor.id%7)*.37;
  // Queue a new body behind occupied arrival slots, without displacing a live one.
  for(let i=0;i<bodies.length+1;i++){const b=bodies.find(b=>Math.abs((b.lane??0)-actor.lane)<.65&&Math.abs(actor.x-b.x)<this.bodyClearance(actor,b));if(!b)break;actor.x=b.x+side*this.bodyClearance(actor,b);}
 }
 bodyClearance(a,b){return Math.max(42,((ENEMY_FRONT[a.type??'hero']??45)+(ENEMY_FRONT[b.type??'hero']??45))*.65);}
 planLane(actor,target){
  if(!this.lanes)return;
  if(ENEMIES[actor.type]&&target===this&&Math.abs(actor.x-this.x)<480){actor.laneGoal=0;actor.laneNextAt=this.time;return;}
  // Nearby combat supersedes wandering, while body clearance still owns travel.
  if(target&&target.type!=='gate'&&Math.abs(target.x-actor.x)<650){actor.laneGoal=Math.round(target.lane??0);return;}
  if(this.time<(actor.laneNextAt??0))return;
  const noise=Math.sin(actor.id*12.9898+Math.floor(this.time/3)*78.233)*43758.5453;
  actor.laneGoal=Math.floor((noise-Math.floor(noise))*3);actor.laneNextAt=this.time+2+(actor.id%5)*.4;
 }
 moveBody(actor,dx,dt,speed,target=null){
  if(!this.lanes){actor.x+=dx;return;}
  if(actor!==this)this.planLane(actor,target);
  const from=actor.lane??0,goal=actor===this?0:actor.laneGoal??from;
  let dy=clamp(goal-from,-dt*.8,dt*.8),travel=Math.hypot(dx,dy*52),budget=speed*dt;
  if(travel>budget){dx*=budget/travel;dy*=budget/travel;}
  const enemy=!!ENEMIES[actor.type],living=[this,...this.allies,...this.enemies].filter(b=>b!==actor&&b.hp>0&&!ENEMIES[b.type]?.stationary&&this.time>=(b.entryAt??b.bornAt??0));
  // Same-depth passing stays free. A lateral crossing waits until the painted
  // bodies have separated horizontally, so depth never cuts through a friend.
  if(dy&&living.some(b=>!!ENEMIES[b.type]===enemy&&Math.abs(actor.x-b.x)<this.bodyClearance(actor,b)&&Math.min(from,from+dy)<(b.lane??0)+.65&&Math.max(from,from+dy)>(b.lane??0)-.65))dy=0;
  const bodies=living.filter(b=>!!ENEMIES[b.type]!==enemy);
  // Friendly bodies share the road so reinforcements never queue behind a long-range ally.
  // Opposing bodies keep swept clearance; depth is presentation, not a traffic gate.
  const fraction=(mx,my)=>{let t=1;for(const b of bodies){const rx=this.bodyClearance(actor,b),x=(actor.x-b.x)/rx,y=(from-(b.lane??0))/.65,vx=mx/rx,vy=my/.65,c=x*x+y*y-1,aa=vx*vx+vy*vy,bb=x*vx+y*vy;
    if(aa<1e-12)continue;if(c<-.001){if(bb<0)t=0;continue;}const disc=bb*bb-aa*c;if(bb>=0||disc<=0)continue;const hit=(-bb-Math.sqrt(disc))/aa;if(hit>=0&&hit<t)t=Math.max(0,hit-.0001);}
   return t;};
  let f=fraction(dx,dy);
  if(f<.999){
   const sideways=fraction(0,dy),forward=fraction(dx,0);
   if(Math.abs(dy)>.00001&&sideways>.99){dx=0;f=sideways;}
   else if(forward>.99){dy=0;f=forward;}
   else if(actor!==this&&Math.abs(dx)>.00001){
    const choices=[0,1,2].filter(k=>Math.abs(k-from)>.2).sort((a,b)=>Math.abs(a-from)-Math.abs(b-from));
    const lane=choices.find(k=>fraction(0,Math.sign(k-from)*dt*.8)>.99);
    if(lane!==undefined){actor.laneGoal=lane;actor.laneNextAt=this.time+1.8;dy=clamp(lane-from,-dt*.8,dt*.8);dx=0;f=fraction(0,dy);}
   }
  }
  actor.x+=dx*f;actor.lane=clamp(from+dy*f,0,2);
 }
 walkBody(actor,oldX,oldLane,speed){const dx=actor.x-oldX,distance=Math.hypot(dx,((actor.lane??0)-(oldLane??0))*52);actor.moving=distance>1e-5?(Math.sign(dx)||actor.moving||(ENEMIES[actor.type]?-1:1)):0;actor.walk+=distance/speed;}
 get summonTypes(){return this.tour?Object.keys(UNITS):this.party;}
 get summonCount(){return this.allies.filter(a=>a.hp>0).length;}
 countAllies(type){return this.allies.filter(a=>a.hp>0&&a.type===type).length;}
 atSummonLimit(type){return this.summonCount>=ALLY_TOTAL_LIMIT||this.countAllies(type)>=ALLY_TYPE_LIMIT;}
 // Viewport geometry is input to the one combat model, never a separate display coordinate.
 setViewport(left,width){if(!Number.isFinite(left)||!Number.isFinite(width)||width<=0)return false;this.viewport={left,right:left+width,width};return true;}
 screenPadding(type){return (BODY_HEIGHT[type]||132)+24;}
 get travelStart(){return Math.min(0,(this.viewport?.left??0)+this.screenPadding('girl'));}
 setPartyHold(value){
  this.partyHold=!!value;
  if(!this.partyHold)return;
  this.auto=false;this.direction=0;this.pendingMove=0;this.moving=0;
  for(const a of this.allies)a.moving=0;
 }
 setDirection(direction,{pressed=false,cancel=false}={}){this.direction=Math.sign(direction)||0;if(cancel||this.status!=='playing')this.pendingMove=0;else if(pressed&&this.direction)this.pendingMove=this.direction;}
 advanceEntry(actor,enemy,dt){
  if(enemy&&actor.entering&&Number.isFinite(actor.entryOrigin)){
   if(this.time<(actor.entryAt??actor.bornAt)){if(!this.route.deployment)actor.x=actor.entryOrigin=this.portalX;return true;}
   const speed=ENEMIES[actor.type].speed,edge=actor.entryOrigin-this.screenPadding(actor.type)*.5,gap=actor.x-edge;
   if(gap<=0){actor.entering=false;return false;}const travel=Math.min(gap,speed*this.enemySpeedScale*dt);const oldX=actor.x,oldLane=actor.lane;this.moveBody(actor,-travel,dt,speed*this.enemySpeedScale);this.walkBody(actor,oldX,oldLane,speed);if(actor.x<=edge+1e-6)actor.entering=false;return true;
  }
  if(!this.viewport||!actor.entering)return false;const dir=enemy?-1:1,pad=this.screenPadding(actor.type)*.5,edge=enemy?this.viewport.right-pad:(actor.entryOrigin??this.viewport.left)+pad,gap=(edge-actor.x)*dir;
  if(gap<=0){actor.entering=false;return false;}const speed=enemy?ENEMIES[actor.type].speed:WALK_SPEED,travel=Math.min(gap,speed*(enemy?this.enemySpeedScale:1)*dt);const oldX=actor.x,oldLane=actor.lane;this.moveBody(actor,dir*travel,dt,speed*(enemy?this.enemySpeedScale:1));this.walkBody(actor,oldX,oldLane,speed);if((edge-actor.x)*dir<=1e-6)actor.entering=false;return true;
 }
 constrainScreen(){
  const bounds=this.viewport;if(!bounds||this.route.deployment)return;
  for(const e of this.enemies){if(e.hp<=0||ENEMIES[e.type].stationary)continue;const pad=this.screenPadding(e.type);
   if(e.entering){if(Number.isFinite(e.entryOrigin)||e.x>bounds.right-pad*.5)continue;e.entering=false;}
   if(e.x<bounds.left-pad){
    // A portal crossing cancels the old contact, even if the new position is close to the old aim point.
    for(const shot of this.projectiles)if(!shot.enemy&&shot.targetId===e.id){shot.targetId=null;shot.areaRadius=0;}
    e.x=e.entryOrigin=this.portalX;e.entryAt=this.time;e.entering=true;e.action=null;e.windup=0;delete e.engagedId;}
   else e.x=Math.min(e.x,bounds.right-pad*.5);
  }
 }
 get enemySpeedScale(){return STAGES[this.stage].enemySpeedScale??1;}
 get route(){return this.tour?STAGES[this.stage].tour:STAGES[this.stage];}
 get roadEnd(){return this.route.roadEnd;}
 get gateX(){return this.roadEnd+GATE-ROAD;}
 get portalInset(){return Math.min(120,(this.viewport?.width??1200)*.1);}
 get portalX(){if(this.route.deployment)return this.gateX;return Math.min(this.gateX,this.viewport?this.viewport.right-this.portalInset:this.x+760);}
 get waves(){return this.route.waves;}
 emit(type,data={}){this.events.push({type,at:this.time,...data});}
 say(message){this.hint=message;this.hintSerial++;this.lastHintAt=this.time;this.emit('hint',{message});}
 drainEvents(){const events=this.events;this.events=[];return events;}
 pause(){if(this.status==='playing'){this.status='paused';this.setDirection(0,{cancel:true});}else if(this.status==='paused')this.status='playing';}
 progress(){return clamp((this.furthest-this.startX)/(this.roadEnd-this.startX),0,1);}
 addAlly(type,x){const s=UNITS[type];if(!s||this.atSummonLimit(type))return null;
  // Arrival slots queue in the combat lanes; a new call never pushes a live body.
  const entering=x===undefined&&!!this.viewport;if(x===undefined)x=entering?this.viewport.left-this.screenPadding(type):this.x-65;const a={entering,entryOrigin:entering?this.viewport.left:null,bornAt:this.time,id:++this.nextId,type,x,hp:s.hp,maxHp:s.hp,cd:0,hit:0,walk:0,moving:0,action:null};this.allies.push(a);this.placeLane(a,-1);return a;}
 spawn(type,x,powerScale=1){const s=ENEMIES[type];const a={entering:!!this.viewport&&x>this.viewport.right,id:++this.nextId,type,x,bornAt:this.time,powerScale,hp:s.hp*powerScale,maxHp:s.hp*powerScale,cd:0,stun:0,hit:0,windup:0,action:null,ability:s.ability?.initial??Infinity,walk:0,moving:0};this.enemies.push(a);this.placeLane(a,1);if(isBoss(type)){this.bossSpawned=true;this.bossDefeated=false;}return a;}
 reject(message){this.emit('notice',{message});return false;}
 summon(type){
  if(this.status!=='playing'||!UNITS[type]||!this.summonTypes.includes(type))return false;
  if(this.cooldowns[type]>0)return this.reject('조금만 기다려 주세요.');
  if(this.atSummonLimit(type))return this.reject(this.summonCount>=ALLY_TOTAL_LIMIT?`동료는 총 ${ALLY_TOTAL_LIMIT}명까지 함께할 수 있어요.`:`같은 동료는 ${ALLY_TYPE_LIMIT}명까지 부를 수 있어요.`);
  if(this.coins<UNITS[type].cost)return this.reject('엽전이 조금 더 필요해요.');
  this.coins-=UNITS[type].cost;this.cooldowns[type]=UNITS[type].cooldown;
  const ally=this.addAlly(type);this.summons++;this.emit('summon',{actor:ally.id,kind:type,x:ally.x});return true;
 }
 upgradeKeeper(){
  if(this.status!=='playing')return false;
  if(this.keeperRank)return this.reject('도령은 이미 먹붓을 배웠어요.');
  const price=UNITS.keeper.upgrade.price;if(this.coins<price)return this.reject('수련에는 엽전 45가 필요해요.');
  this.coins-=price;this.keeperRank=1;
  for(const a of this.allies)if(a.type==='keeper'){a.action=null;a.cd=Math.max(a.cd,.3);}
  this.emit('upgrade',{kind:'keeper',x:this.x});this.say('도령이 먹붓을 배웠어요. 지금 동료와 새로 부를 동료 모두 성장해요.');return true;
 }
 // Action.targetId owns one strike. engagedId only retains contact between strikes.
 // Release on death/escape; ties use the same layer as the actual character drawing.
 selectContact(actor,candidates,range){
  if(this.lanes&&actor!==this){const reachable=candidates.filter(b=>this.canStrike(actor,b)&&contactGap(actor,b)<=range+18);if(reachable.length)candidates=reachable;}

  // A valid retained contact already wins over every nearer arrival. Resolve
  // that id first so unrelated bodies do not need distance/layer calculations.
  // Keep the same tie policy even if a diagnostic caller supplies duplicate ids.
  if(actor.engagedId!==undefined){
   let current,gap=Infinity,layer=-Infinity;
   for(const candidate of candidates){
    if(!(candidate.hp>0)||(candidate.id??null)!==actor.engagedId)continue;
    const distance=this.contactDistance(actor,candidate),depth=actorLayer(candidate);
    if(distance<=range+18&&(!current||distance<gap||distance===gap&&depth>layer)){current=candidate;gap=distance;layer=depth;}
   }
   if(current)return current;
  }
  let nearest,current,nearestGap=Infinity,currentGap=Infinity,nearestLayer=-Infinity,currentLayer=-Infinity;
  for(const candidate of candidates){
   if(!(candidate.hp>0))continue;
   const gap=this.contactDistance(actor,candidate),layer=actorLayer(candidate);
   if(!nearest||gap<nearestGap||gap===nearestGap&&layer>nearestLayer){nearest=candidate;nearestGap=gap;nearestLayer=layer;}
   if((candidate.id??null)===actor.engagedId&&gap<=range+18&&(!current||gap<currentGap||gap===currentGap&&layer>currentLayer)){current=candidate;currentGap=gap;currentLayer=layer;}
  }
  const target=current||nearest;
  if(current||(target&&nearestGap<=range+1e-6))actor.engagedId=target.id??null;else delete actor.engagedId;
  return target;
 }
 targetForCharm(){const inRange=this.enemies.filter(e=>e.hp>0&&this.time>=(e.entryAt??e.bornAt)&&e.x>=this.x-30&&contactGap(this,e)<=590);return inRange.find(e=>e.type==='reaper'||ENEMIES[e.type].behavior==='heal')||inRange.find(e=>e.type!=='skirt')||inRange[0];}
 skill(type){
  if(TEAM_SKILLS[type])return this.teamSkill(type);
  if(this.status!=='playing'||!SKILLS[type])return false;
  // Shelter is a maintained skill: releasing it must work even with no mana.
  if(type==='shelter'&&this.shield>0&&this.shieldKind==='umbrella'){
   if(this.action?.kind==='umbrella')return false;
   this.shield=0;this.action={kind:'umbrella',phase:'dismount',elapsed:0};return true;
  }
  if(this.cooldowns[type]>0)return this.reject('기술을 준비하고 있어요.');
  if(['rush','stomp','shelter'].includes(type)&&((this.action&&!(this.action.kind==='haetae'&&this.action.phase==='claw'))||this.shield>0))return this.reject('합동 동작이 끝나면 사용할 수 있어요.');
  if(type==='charm'&&this.moving)return this.reject('멈춘 뒤 부적을 던질 수 있어요.');
  if(this.mana<SKILLS[type].cost)return this.reject('마나가 조금 더 필요해요.');
  const target=type==='charm'?this.targetForCharm():null;
  if(type==='charm'&&!target)return this.reject('아직 부적이 닿을 귀물이 없어요.');
  this.mana-=SKILLS[type].cost;this.cooldowns[type]=type==='shelter'?0:SKILLS[type].cooldown;this.casts++;
  // Explicit joint skills replace a normal swipe only after all spending guards pass.
  if(['rush','stomp','shelter'].includes(type)&&this.action?.kind==='haetae'&&this.action.phase==='claw')this.action=null;
  if(type==='shelter'){this.shield=6;this.shelterAt=this.time;this.shieldKind='umbrella';this.action={kind:'umbrella',phase:'mount',elapsed:0};this.emit('shelter',{x:this.x,kind:'umbrella'});}
  if(type==='waterWard'){this.waterWard=6;this.emit('shelter',{x:this.x,kind:'water'});}
  if(type==='charm'){
   this.launchShot({actor:'girl',sourceKind:'girl',weapon:'charm',from:this.x-60,target,damage:52,high:true,stun:1.3});
   if(target.type==='skirt')this.say('지하지인은 낮아요. 누렁소·돌팔매·발구름으로 막아요.');
  }
  if(type==='rush'){this.action={kind:'rush',elapsed:0,hitIds:[]};this.emit('rush',{x:this.x});}
  if(type==='mend'){this.hp=Math.min(MAX_HP,this.hp+45);for(const a of this.allies)if(a.hp>0)a.hp=Math.min(a.maxHp,a.hp+15);this.emit('heal',{x:this.x});}
  if(type==='stomp'){
   this.action={kind:'haetae',elapsed:0,resolved:false};
  }
  this.cleanup();return true;
 }
 teamCandidates(type){return this.allies.filter(a=>a.hp>0&&a.type===type&&!a.entering).sort((a,b)=>a.id-b.id);}
 teamReady(key){const spec=TEAM_SKILLS[key];return !!spec&&this.status==='playing'&&!this.teamAction&&this.cooldowns[key]<=0&&this.teamCandidates(spec.unit).length>=spec.required;}
 teamSkill(key){
  const spec=TEAM_SKILLS[key];if(!this.teamReady(key))return this.reject(`입장을 마친 동료 ${spec?.required??ALLY_TYPE_LIMIT}명과 기술 준비가 필요해요.`);
  const foes=this.enemies.filter(e=>e.hp>0&&e.type!=='gate'&&e.x>=this.x-70);
  if(key!=='prayer'&&!foes.length)return this.reject('전방에 공격할 적이 없어요.');
  if(key==='prayer'&&![this,...this.allies].some(a=>a.hp>0&&a.hp<(a.maxHp??MAX_HP)))return this.reject('모두 건강해요. 부상한 동료가 생기면 기도해요.');
  const members=this.teamCandidates(spec.unit).slice(0,spec.required),pad=this.screenPadding(spec.unit)*.5,left=this.viewport?this.viewport.left+pad:START-130,right=this.viewport?this.viewport.right-pad:this.gateX-pad;
  const spacing=Math.min(50,(right-left)/(spec.required-1)),base=clamp(this.x+(key==='cavalryCharge'?160:-240),left,Math.max(left,right-spacing*(spec.required-1)));
  const rainStart=Math.max(this.x+80,Math.min(...foes.map(e=>e.x))-90),rainEnd=Math.min(this.gateX+90,Math.max(rainStart+640,...foes.map(e=>e.x+90)));
  const phase=key==='prayer'?'perform':'gather';
  this.teamAction={key,phase,elapsed:0,launched:0,resolved:false,rainStart,rainEnd,members:members.map((a,i)=>({id:a.id,home:a.x,slot:key==='prayer'?a.x:base+i*spacing,chargeEnd:Math.min(right,base+i*spacing+650),hitIds:[]}))};
  for(const a of members){a.action={kind:'team',skill:key,phase,elapsed:0};a.moving=0;delete a.engagedId;}
  this.cooldowns[key]=spec.cooldown;this.casts++;this.emit('team-start',{key,x:this.x,members:members.map(a=>a.id)});if(phase==='perform')this.emit('team-cast',{key,x:this.x});this.say(spec.name+(key==='prayer'?' · 그 자리에서 기도해요.':` · ${spec.required}명이 대형을 갖춰요.`));return true;
 }
 advanceTeam(dt){
  const team=this.teamAction;if(!team)return;const spec=TEAM_SKILLS[team.key];
  const living=team.members.map(m=>({m,a:this.allies.find(a=>a.id===m.id&&a.hp>0)})).filter(p=>p.a);
  if(living.length<spec.required&&team.phase!=='return'){team.phase='return';team.elapsed=0;this.say(team.key==='cavalryCharge'?'대형이 무너졌어요. 남은 동료가 복귀합니다.':'인원이 부족해 기술을 중단하고 일반 전투를 재개합니다.');}
  const move=(a,to,speed)=>{const pad=this.screenPadding(a.type)*.5,lo=this.viewport?this.viewport.left+pad:START-130,hi=this.viewport?this.viewport.right-pad:this.gateX-pad,goal=clamp(to,lo,Math.max(lo,hi)),before=a.x;a.x+=Math.sign(goal-a.x)*Math.min(Math.abs(goal-a.x),speed*dt);a.moving=Math.sign(a.x-before);a.walk+=Math.abs(a.x-before)/UNITS[a.type].speed;return Math.abs(a.x-goal)<1;};
  let completed=false;
  if(team.phase==='gather'||team.phase==='return'){
   let arrived=true;if(team.phase==='gather'||team.key==='cavalryCharge')for(const {m,a}of living)if(!move(a,team.phase==='gather'?m.slot:m.home,UNITS[a.type].speed*1.55))arrived=false;
   if(arrived){if(team.phase==='return')completed=true;else{team.phase='perform';team.elapsed=0;this.emit('team-cast',{key:team.key,x:this.x});}}
  }else{
   team.elapsed+=dt;
   if(team.key==='arrowRain'){
    while(team.launched<spec.volleys&&team.elapsed>=spec.firstRelease+team.launched*spec.volleyInterval){const volley=team.launched++,finishOnScreen=volley===spec.volleys-1;
     const visible=finishOnScreen?this.enemies.filter(e=>e.hp>0&&e.type!=='gate'&&e.x>=this.x-70&&(!this.viewport||e.x>=this.viewport.left&&e.x<=this.viewport.right)).sort((a,b)=>a.x-b.x):[];
     living.forEach(({a},i)=>{const lane=volley*spec.required+i,fraction=finishOnScreen?(i+.5)/spec.required:(lane+.5)/((spec.volleys-1)*spec.required),to=visible.length?visible[i%visible.length].x:team.rainStart+(team.rainEnd-team.rainStart)*fraction;
      this.launchShot({actor:a.id,sourceKind:a.type,weapon:'arrow',from:a.x,to,damage:8*ALLY_OUTPUT,duration:1.9+(i%3)*.18,arc:390+i*35+volley%3*20,areaRadius:28,finishOnScreen});});
    }
   }else if(team.key==='prayer'&&!team.resolved&&team.elapsed>=1.4){
    team.resolved=true;for(const patient of [this,...this.allies])if(patient.hp>0){const max=patient.maxHp??MAX_HP,amount=max-patient.hp;if(amount>0){patient.hp=max;this.emit('heal',{actor:living[0].a.id,sourceKind:'healer',targetActor:patient.id??null,kind:patient.type||'haetae',x:patient.x,amount});}}
    this.emit('team-prayer',{x:this.x});
   }else if(team.key==='cavalryCharge'){
    for(const {m,a}of living){const from=a.x;move(a,m.chargeEnd,420);
     for(const e of this.enemies)if(e.hp>0&&e.x>=from-45&&e.x<=a.x+100&&!m.hitIds.includes(e.id)){m.hitIds.push(e.id);this.hurtEnemy(e,UNITS.cavalry.damage*1.8,a.x,'sword');this.emit('swipe',{actor:a.id,kind:'sword',sourceKind:a.type,targetKind:e.type,targetActor:e.id,x:a.x,from:a.x,to:e.x});e.stun=Math.max(e.stun,.5);e.windup=0;e.action=null;}
    }
   }
   if(team.elapsed>=spec.castTime){team.phase='return';team.elapsed=0;completed=team.key!=='cavalryCharge';}
  }
  if(completed){for(const {a}of living)if(a.action?.kind==='team')a.action=null;this.teamAction=null;this.emit('team-end',{key:team.key,x:this.x,members:living.map(p=>p.a.id)});return;}
  for(const {a}of living)if(a.action?.kind==='team')Object.assign(a.action,{phase:team.phase,elapsed:team.elapsed});
 }
 awardCoins(amount,e,reason){const before=Math.floor(this.coins);this.coins=clamp(this.coins+amount*3,0,MAX_COINS);const received=Math.floor(this.coins)-before;this.earnedCoins+=received;if(received>0)this.emit('coin',{amount:received,total:this.coins,x:e.x,kind:e.type,reason});}
 hurtEnemy(e,damage,sourceX=this.x,weapon='physical'){if(e.hp<=0||this.status!=='playing'||this.time<(e.entryAt??e.bornAt)||!Number.isFinite(damage)||damage<=0)return;if(this.enemyInvincible)damage=0;e.hp-=damage;e.hit=.26;e.hitDir=Math.sign(e.x-sourceX)||1;this.emit('hit',{actor:e.id,x:e.x,from:sourceX,dir:e.hitDir,kind:e.type,weapon,damage,enemy:true});}
 // The gate is an entrance, never an escape route for displaced living enemies.
 // A not-yet-arrived unit keeps its position; knockback cannot pull it out early.
 pushEnemy(e,to){if(ENEMIES[e.type].stationary||this.viewport&&e.entering)return;const right=this.viewport&&!this.route.deployment&&!e.entering?Math.min(this.gateX-45,this.viewport.right-this.screenPadding(e.type)*.5):this.gateX-45;e.x=Math.max(e.x,Math.min(right,to));}
 // A flying attack outlives its launch pose. Journey alone owns contact and rewards.
 launchShot({actor,sourceKind,weapon,from,target,to=target?.x,damage,high=false,stun=0,enemy=false,duration=SHOT_TIME,arc=0,areaRadius=SPELL_AREAS[weapon]??0,finishOnScreen=false}){
  const shot={actor,sourceKind,weapon,from,to,targetId:target?.id??null,targetKind:target?.type||'haetae',damage,high,stun,enemy,t:0,duration,arc,areaRadius,finishOnScreen};
  this.projectiles.push(shot);this.emit('projectile',{...shot,flight:shot,kind:weapon,targetActor:target?.id??null,hit:!high||target?.type!=='skirt'});
 }
 advanceProjectiles(dt){
  for(const shot of this.projectiles){
   if(this.status!=='playing')break;
   shot.t+=dt;if(shot.t+1e-9<shot.duration)continue;
   if(shot.areaRadius){for(const target of shot.enemy?[this,...this.allies]:this.enemies){
    if(this.status!=='playing')break;
    if(target.hp<=0||Math.abs(target.x-shot.to)>shot.areaRadius||(target.type==='gate'&&!SPELL_AREAS[shot.weapon])||(shot.high&&target.type==='skirt'))continue;
    if(shot.finishOnScreen&&this.viewport&&(target.x<this.viewport.left||target.x>this.viewport.right))continue;
    if(shot.enemy){if(target===this)this.hurtHero(shot.damage,shot.from,shot.weapon);else this.hurtAlly(target,shot.damage,shot.from,shot.weapon);}
    else{this.hurtEnemy(target,shot.finishOnScreen?target.hp:shot.damage,shot.from,shot.weapon);if(shot.stun){target.stun=shot.stun;target.windup=0;target.action=null;}}
   }continue;}
   const target=shot.enemy?(shot.targetId===null?this:this.allies.find(a=>a.id===shot.targetId&&a.hp>0)):this.enemies.find(e=>e.id===shot.targetId&&e.hp>0);
   // Keep the original selected target, with a finite contact envelope; no retarget on death.
   if(!target||Math.abs(target.x-shot.to)>55||(shot.high&&target.type==='skirt'))continue;
   if(shot.enemy){if(target===this)this.hurtHero(shot.damage,shot.from,shot.weapon);else this.hurtAlly(target,shot.damage,shot.from,shot.weapon);}
   else{this.hurtEnemy(target,shot.damage,shot.from,shot.weapon);if(shot.stun){target.stun=shot.stun;target.windup=0;target.action=null;}}
  }
  this.projectiles=this.status==='playing'?this.projectiles.filter(s=>s.t+1e-9<s.duration):[];
 }
 // Both test animations use the same action clock; rendering never applies damage.
 advanceAction(actor,dt){
  const action=actor.action;if(!action)return;
  if(action.kind==='team')return;
  if(action.kind==='keeper'&&['transform','approach','returnHuman'].includes(action.phase)){
   const s=unitStats('keeper',this.keeperRank),target=this.enemies.find(e=>e.id===action.targetId&&e.hp>0&&!e.entering&&this.time>=(e.entryAt??e.bornAt)&&e.x>=actor.x-55);
   action.elapsed+=dt;
   if(action.phase==='returnHuman'){
    if(action.elapsed>=MOTION.keeper.returnHuman)actor.action=null;
    return;
   }
   if(action.phase==='transform'){
    if(action.elapsed>=MOTION.keeper.transform){action.phase=target&&!this.partyHold&&contactGap(actor,target)>s.range?'approach':'returnHuman';action.elapsed=0;}
    return;
   }
   // Only the ordinary attack owns release/damage. Canine travel uses the
   // same lane, collision, hold and target-lifetime rules as other allies.
   if(!target||this.partyHold||contactGap(actor,target)<=s.range&&this.canStrike(actor,target)){
    action.phase='returnHuman';action.elapsed=0;return;
   }
   const speed=s.runSpeed??s.speed,travel=Math.sign(target.x-actor.x)*Math.min(Math.max(0,contactGap(actor,target)-s.range),speed*dt);
   this.moveBody(actor,travel,dt,speed,target);
   return;
  }
  if(action.kind==='umbrella'){
   action.elapsed+=dt;
   if(action.phase==='mount'){if(action.elapsed>=MOTION.haetae.shelter.approach+MOTION.haetae.shelter.mount+MOTION.haetae.shelter.open)this.action=null;}
   else if(action.elapsed>=MOTION.haetae.shelter.close+MOTION.haetae.shelter.dismount+MOTION.haetae.shelter.return){this.action=null;this.shieldKind=null;this.shelterAt=null;this.cooldowns.shelter=SKILLS.shelter.cooldown;}
   return;
  }
  const anticipation=action.kind==='cow'&&action.phase==='anger'?MOTION.cow.angerFrames/MOTION.cow.angerFps:action.phase==='anticipation'?MOTION[action.kind]?.anticipation:0;
  if(anticipation){
   action.elapsed+=dt;
   if(action.elapsed>=anticipation){
    // A close encounter commits the calf's windup, even if an ally finishes
    // that target. The normal hit guard still rejects dead/out-of-range foes.
    const gone=action.kind==='cow'&&action.targetId!=null&&!this.enemies.some(e=>e.id===action.targetId&&e.hp>0);
    if(gone){if(actor.cd<=0){actor.cd=unitStats(actor.type,this.keeperRank).period;actor.action={kind:actor.type,elapsed:0,resolved:false,targetId:action.targetId,x:action.x,dir:action.dir};}}
    else actor.action=null;
   }
   return; // Detection reaction never resolves a hit or changes the attack cooldown.
  }
  if(action.kind==='healer'){
   const spec=MOTION.healer,s=UNITS.healer;
   let target=action.targetId===null?this:this.allies.find(a=>a.id===action.targetId&&a.hp>0);
   const valid=target&&target.hp>0&&target.hp<(target.maxHp??MAX_HP)&&Math.abs(target.x-actor.x)<=s.search;
   const moveTo=goal=>{
    // Rear spacing is a preferred approach slot, never a reason to retreat
    // from an already reachable patient (including an overlapping/left one).
    const inRange=Math.abs(target.x-actor.x)<=s.range,gap=goal-actor.x;
    // Follow a walking patient toward the preferred slot continuously; waiting
    // for each range crossing alternates walk/cast on successive frames.
    if(inRange&&!(target.moving>0&&gap>0))return true;
    if(this.partyHold)return inRange;
    this.moveBody(actor,Math.sign(gap)*Math.min(Math.abs(gap),(s.runSpeed??s.speed)*dt),dt,s.runSpeed??s.speed,target);return inRange||Math.abs(goal-actor.x)<1;
   };
   // Lock each wrap to one patient. Reconsider only between wraps or after cancellation.
   if(!target||target.hp<=0||Math.abs(target.x-actor.x)>s.search||(!valid&&!action.resolved))action.phase='return';
   if(action.phase==='return'){
    const next=this.healerPatient(actor);
    if(next){const continuing=action.resolved&&(next.id??null)===action.targetId;target=next;Object.assign(action,{phase:'approach',targetId:next.id??null,elapsed:continuing?spec.notice:0,resolved:false,dir:Math.sign(next.x-actor.x)||1});}
    else{actor.action=null;return;}
   }
   if(action.phase==='approach'){
    // The existing approach clock first owns the stationary discovery gesture.
    // No movement or remote heal happens while noticing a new patient.
    if((action.elapsed??0)<spec.notice){
     action.elapsed=(action.elapsed??0)+dt;
     if(action.elapsed<=spec.notice)return;
     dt=action.elapsed-spec.notice; // Only the part after preparation may travel.
    }else action.elapsed+=dt;
    // Approach a distant patient from behind; keep an existing close position.
    action.dir=1;const goal=target===actor?actor.x:target.x-s.spacing;
    const reached=target===actor||moveTo(goal);
    if(reached&&actor.cd<=0){action.phase='treat';action.elapsed=0;actor.cd=s.period;}
    return;
   }
   // Walking patients keep their treatment clock while the physician follows.
   if(target!==actor)moveTo(target.x-s.spacing);
   if(Math.abs(target.x-actor.x)>s.range)return;
   action.elapsed+=dt*(s.motionSpeed??1);
   if(!action.resolved&&action.elapsed>=spec.impact){
    action.resolved=true;const amount=Math.min(s.heal,(target.maxHp??MAX_HP)-target.hp);
    if(amount>0){target.hp+=amount;this.emit('heal',{actor:actor.id,sourceKind:'healer',targetActor:target.id??null,kind:target.type||'haetae',x:target.x,from:actor.x,amount});}
   }
   // Recheck patients after each wrap; without a patient, hold the care position.
   if(action.elapsed>=spec.duration)action.phase='return';
   return;
  }
  if(isBoss(actor.type)&&action.kind===ENEMIES[actor.type].ability.kind){
   const ability=ENEMIES[actor.type].ability;
   action.elapsed+=dt;
   const impacts=ability.impacts||[ability.impact];let impact=action.impacts??(action.resolved?impacts.length:0);
   while(impact<impacts.length&&action.elapsed>=impacts[impact]){
    const zones=this.bossZones(actor,action.x??this.x,impact),within=target=>zones.some(z=>target.x>=z.left&&target.x<=z.right);
    const blocked=this.shield>0||this.waterWard>0&&[this,...this.allies].some(a=>a.hp>0&&within(a)&&this.shieldBlocks(a,actor.x,action.kind));
    this.emit(action.kind+'-impact',{x:action.x??this.x,from:actor.x,kind:actor.type,blocked});
    if(ability.pattern)this.emit('boss-impact',{x:action.x??this.x,from:actor.x,kind:actor.type,zones,attack:action.kind,blocked});
    if(!this.shield){if(within(this))this.hurtHero(ability.damage*(actor.powerScale??1)*ENEMY_OUTPUT,actor.x,action.kind);for(const a of this.allies)if(within(a))this.hurtAlly(a,ability.splash*(actor.powerScale??1)*ENEMY_OUTPUT,actor.x,action.kind);}
    if(blocked&&!action.guardRewarded){action.guardRewarded=true;this.coins=clamp(this.coins+8,0,MAX_COINS);this.say('큰 공격을 막았어요. 지금 전진해요!');}
    impact++;action.impacts=impact;action.resolved=impact===impacts.length;
   }
   if(action.elapsed>=ability.duration)actor.action=null;
   return;
  }
  if(action.kind==='rush'){
   const before=action.elapsed;action.elapsed+=dt;
   const travel=Math.max(0,Math.min(action.elapsed,1.1)-Math.max(before,.18));
   if(travel>0){
    const from=this.x;this.x=clamp(this.x+travel*420,this.travelStart,this.roadEnd);
    for(const e of this.enemies)if(e.hp>0&&e.x>=from-60&&e.x<=this.x+180){
     if(!action.hitIds.includes(e.id)){action.hitIds.push(e.id);this.hurtEnemy(e,65,from,'rush');this.pushEnemy(e,this.x+430);e.stun=1.2;e.windup=0;e.action=null;}
     else this.pushEnemy(e,this.x+145);
     // Retain the normal contact gap when a live target reaches the gate wall.
     if(e.hp>0)this.x=Math.min(this.x,Math.max(from,e.x-145));
    }
   }
   if(action.elapsed>=1.3)this.action=null;
   return;
  }
  const spec=action.kind==='enemy'?enemyStrike(actor.type):(MOTION[action.kind]?.[action.phase]||MOTION[action.kind]);action.elapsed+=dt*(UNITS[actor.type]?.motionSpeed??1);
  if(!action.resolved&&action.elapsed>=spec.impact){
   action.resolved=true;
   if(action.kind==='enemy'){
    const ally=action.targetId===null?null:this.allies.find(a=>a.id===action.targetId&&a.hp>0);
    const valid=action.targetId===null||!!ally,targetX=ally?.x??this.x;
    const spell=actor.type==='reaper'||['ranged','heal'].includes(ENEMIES[actor.type].behavior);
    if(spell&&Number.isFinite(action.x))this.launchShot({actor:actor.id,sourceKind:actor.type,weapon:'hex',duration:MOTION[actor.type]?.projectileTravel??SHOT_TIME,from:actor.x,target:ally||(action.targetId===null?this:undefined),to:action.x,damage:ENEMIES[actor.type].damage*(actor.powerScale??1)*ENEMY_OUTPUT,enemy:true});
    else if(valid&&this.canStrike(actor,ally||this)&&contactGap(actor,ally||this)<=ENEMIES[actor.type].range+1e-6){
     if(actor.type==='reaper'||['ranged','heal'].includes(ENEMIES[actor.type].behavior))this.launchShot({actor:actor.id,sourceKind:actor.type,weapon:'hex',duration:MOTION[actor.type]?.projectileTravel??SHOT_TIME,from:actor.x,target:ally||this,damage:ENEMIES[actor.type].damage*(actor.powerScale??1)*ENEMY_OUTPUT,enemy:true});
     else {if(ally)this.hurtAlly(ally,ENEMIES[actor.type].damage*(actor.powerScale??1)*ENEMY_OUTPUT,actor.x,actor.type);else this.hurtHero(ENEMIES[actor.type].damage*(actor.powerScale??1)*ENEMY_OUTPUT,actor.x,actor.type);
     this.emit('claw',{x:actor.x,to:targetX+(ally?0:37),kind:actor.type,sourceKind:actor.type,targetKind:ally?.type||'haetae',targetActor:ally?.id});}
    }
   }else if(action.kind==='haetae'&&action.phase==='claw'){
    const target=this.enemies.find(e=>e.id===action.targetId&&e.hp>0);
    if(target&&target.x>=this.x-20&&this.canStrike(this,target)&&contactGap(this,target)<=spec.range+1e-6){
     this.emit('swipe',{kind:'claw',sourceKind:'haetae',targetKind:target.type,targetActor:target.id,x:this.x,from:this.x,to:target.x});
     this.hurtEnemy(target,spec.damage,this.x,'claw');
    }
   }else if(action.kind==='haetae'){
    this.emit('stomp',{x:this.x});
    for(const e of this.enemies)if(e.hp>0&&e.x>=this.x-70&&contactGap(this,e)<=390){this.hurtEnemy(e,44,this.x,'stomp');this.pushEnemy(e,e.x+85);e.stun=2.1;e.windup=0;e.action=null;}
   }else{
    const target=this.enemies.find(e=>e.id===action.targetId&&e.hp>0),unit=unitStats(actor.type,this.keeperRank);
    if(SPELL_AREAS[unit.weapon]&&Number.isFinite(action.x))this.launchShot({actor:actor.id,sourceKind:actor.type,weapon:unit.weapon,from:actor.x,target,to:action.x,damage:unit.damage,high:unit.weapon==='seal',stun:unit.weapon==='seal'?.65:0});
    else if(target&&this.canStrike(actor,target)&&(this.lanes||target.x>=actor.x-55)&&contactGap(actor,target)<=unit.range+1e-6){
     const high=unit.weapon==='seed'||unit.weapon==='seal',hit=!high||target.type!=='skirt';
     if(['horn','spear','sword'].includes(unit.weapon)){this.emit('swipe',{actor:actor.id,kind:unit.weapon,sourceKind:actor.type,targetKind:target.type,targetActor:target.id,x:actor.x,from:actor.x,to:target.x});this.hurtEnemy(target,unit.damage,actor.x,unit.weapon);}
     else this.launchShot({actor:actor.id,sourceKind:actor.type,weapon:unit.weapon,from:actor.x,target,damage:unit.damage,high,stun:unit.weapon==='seal'?.65:0});
    }
   }
  }
  if(action.elapsed>=spec.duration)actor.action=null;
 }
 shieldBlocks(actor,sourceX,weapon){
  return this.waterWard>0&&Math.abs(actor.x-this.x)<=SKILLS.waterWard.radius||this.shield>0&&(weapon==='hail'||sourceX!==null&&sourceX>=actor.x);
 }
 hurtAlly(a,damage,sourceX=null,weapon='physical'){
  if(a.hp<=0||this.status!=='playing')return;
  if(this.shieldBlocks(a,sourceX,weapon)){this.emit('guard',{actor:a.id,x:a.x,from:sourceX,dir:-1,kind:a.type,weapon,damage:0,umbrella:true,enemy:false});return;}
  const guard=sourceX!==null&&sourceX>=a.x?UNITS[a.type].guard:0;
  const amount=damage*(1-guard);a.hp-=amount;a.hit=ALLY_HIT_TIME;a.hitDir=sourceX===null?0:Math.sign(a.x-sourceX);
  this.emit(guard?'guard':'hit',{actor:a.id,x:a.x,from:sourceX,dir:a.hitDir,kind:a.type,weapon,damage:amount,enemy:false});
 }
 bossZones(actor,focus=this.x,impact=0){
  const a=ENEMIES[actor.type].ability,r=a.radius||200,pattern=a.pattern||(a.kind==='hail'?'all':'front');
  if(pattern==='all')return[{left:-Infinity,right:Infinity}];
  if(pattern==='focus')return[{left:focus-r,right:focus+r}];
  if(pattern==='ring')return[{left:focus-r,right:focus-a.inner},{left:focus+a.inner,right:focus+r}];
  if(pattern==='pincer')return[-230,230].map(d=>({left:focus+d-r,right:focus+d+r}));
  if(pattern==='alternating'){const x=focus+(impact%2?190:-190);return[{left:x-r,right:x+r}];}
  if(pattern==='rear')return[{left:focus-(a.range||750),right:focus-70}];
  return[{left:actor.x-(a.pattern?a.range:a.kind==='quake'?520:950),right:actor.x+90}];
 }
 hurtHero(damage,sourceX=this.x+80,weapon='physical'){
  if(this.status!=='playing')return;
  if(this.invincible)return;
  if(this.shieldBlocks(this,sourceX,weapon)){this.emit('guard',{x:this.x+37,from:sourceX,dir:-1,kind:'haetae',weapon,damage:0,umbrella:true,enemy:false});return;}
  this.hp=clamp(this.hp-damage,0,MAX_HP);this.emit('hurt',{x:this.x+37,from:sourceX,dir:Math.sign(this.x-sourceX)||-1,kind:'haetae',weapon,damage});if(this.hp<=0){const mounted=this.action?.kind==='rush'||this.shield>0&&this.shieldKind!=='water';this.emit('vanish',{actor:'hero',x:this.x+37,kind:mounted?'mount':'haetae',enemy:false});if(!mounted)this.emit('vanish',{actor:'girl',x:this.x-60,kind:'girl',enemy:false});this.finish('lost');}
 }
 cleanup(){
  for(const e of this.enemies)if(e.hp<=0&&!e.dead){e.dead=true;if(e.type==='gate'){this.gateBrokenAt=this.time;this.furthest=this.roadEnd;this.emit('gate-break',{x:e.x,kind:'gate',style:STAGES[this.stage].gateStyle});continue;}this.kills++;this.awardCoins(ENEMIES[e.type].reward,e,'defeat');this.emit('vanish',{actor:e.id,x:e.x,kind:e.type,lane:e.lane,enemy:true,dir:e.hitDir||1});if(isBoss(e.type)){this.bossDefeated=!this.enemies.some(other=>other.hp>0&&isBoss(other.type));if(this.bossDefeated)this.say('');}}
  for(const a of this.allies)if(a.hp<=0)this.emit('vanish',{actor:a.id,x:a.x,kind:a.type,lane:a.lane,enemy:false,dir:a.hitDir||-1});
  this.enemies=this.enemies.filter(e=>!e.dead);this.allies=this.allies.filter(a=>a.hp>0);
  if(this.bossDefeated&&this.wave>=this.waves.length&&this.gateBrokenAt===null&&(!this.viewport||this.route.deployment||this.portalX>=this.gateX-1)&&!this.enemies.some(e=>e.type==='gate')){const gate=this.spawn('gate',this.gateX);gate.hp=gate.maxHp=STAGES[this.stage].gateHp;}
 }
 finish(status){if(this.status!=='playing')return;this.status=status;this.setDirection(0,{cancel:true});for(const a of this.allies)if(a.action?.kind==='team')a.action=null;this.teamAction=null;this.emit('finish',{status});}
 healerPatient(actor){
  const s=UNITS.healer;
  return [this,...this.allies].filter(b=>b.hp>0&&b.hp<(b.maxHp??MAX_HP)&&Math.abs(b.x-actor.x)<=s.search).sort((b,c)=>b.hp/(b.maxHp??MAX_HP)-c.hp/(c.maxHp??MAX_HP)||Math.abs(b.x-actor.x)-Math.abs(c.x-actor.x))[0]||null;
 }
 healerHome(actor){
  // Healthy support follows the independent front line, never traveller input.
  const s=UNITS.healer,leaders=this.allies.filter(a=>a.hp>0&&a.type!=='healer'&&!a.entering);
  const formation=Math.min(this.roadEnd-90,leaders.length?Math.max(...leaders.map(a=>a.x))-s.spacing:this.roadEnd-90);
  const front=this.enemies.reduce((front,e)=>e.hp>0&&e.x>actor.x-55&&(!front||e.x-ENEMY_FRONT[e.type]<front.x-ENEMY_FRONT[front.type])?e:front,null);
  // Rear spacing must be applied before the support can pass that slot.
  // This remains a forward goal; it never pulls an already standing actor back.
  return Math.max(START-130,Math.min(formation,front?actor.x+contactGap(actor,front)-HERO_STANDOFF+s.formation:formation));
 }
 // Stage placement and replenishment share the existing wave index and budget.
 deployWave(){
  const index=this.wave,w=this.waves[index];if(!w)return false;
  const d=this.route.deployment,scale=waveBalance(index,this.stage,this.waves).scale;
  this.wave++;this.waveClearAt=null;
  if(!this.portal){this.portal={x:this.portalX,openedAt:this.time,style:STAGES[this.stage].gateStyle};this.emit('portal-open',{x:this.portal.x,style:this.portal.style});}
  if(d)this.portal.openedAt=this.time;
  // Opening groups occupy the middle of the whole road; reinforcements use its gate.
  const initial=d&&index<d.initialWaves,centre=this.roadEnd/2;
  w.types.forEach((type,i)=>{const origin=initial&&d.initialAtScreenEdge?(this.viewport?this.viewport.right+(this.startX-START):this.x+1200)+this.screenPadding(type)*.5:centre,e=this.spawn(type,initial?origin+index*300+i*75:this.portal.x,scale);e.entering=!initial||!!d?.initialAtScreenEdge&&initial;if(e.entering){e.entryOrigin=initial?origin:this.portal.x;e.entryAt=this.time+i*.85;}});
  if(w.helper&&!d)this.helperArrivals.set(index,false);
  this.say(w.message);return true;
 }
 step(dt){
  if(this.status!=='playing'||!Number.isFinite(dt)||dt<=0)return;
  const oldX=this.x;dt=Math.min(dt,.1);this.time+=dt;this.coins=clamp(this.coins+dt*2.2,0,MAX_COINS);this.mana=clamp(this.mana+dt*2.2,0,MAX_MANA);
  if(this.portal)this.portal.x=this.portalX;
  this.advanceProjectiles(dt);if(this.status!=='playing')return;
  if(this.shelterAt===null)this.shield=Math.max(0,this.shield-dt);this.waterWard=Math.max(0,this.waterWard-dt);this.heroAttack-=dt;
  for(const k of Object.keys(this.cooldowns))this.cooldowns[k]=Math.max(0,this.cooldowns[k]-dt);
  this.advanceAction(this,dt);
  const active=this.enemies.filter(e=>e.hp>0&&this.time>=(e.entryAt??e.bornAt));
  const front=active.reduce((front,e)=>e.x>=this.x-20&&this.sameLane(this,e)&&(!front||e.x-ENEMY_FRONT[e.type]<front.x-ENEMY_FRONT[front.type])?e:front,null);
  const manual=this.direction||this.pendingMove;this.pendingMove=0;
  let direction=manual|| (this.auto?1:0);
  const sheltered=this.shield>0&&this.shieldKind==='umbrella',speed=manual&&!sheltered?RUN_SPEED:WALK_SPEED;
  let movement=direction*speed*dt;
  if(this.action||this.teamAction&&!manual)movement=0;
  const stopAt=manual?145:this.allies.some(a=>a.hp>0)?HERO_STANDOFF:145;
  if(movement>0&&front)movement=Math.min(movement,Math.max(0,contactGap(this,front)-stopAt));
  this.moveBody(this,clamp(this.x+movement,this.travelStart,this.roadEnd)-this.x,dt,speed);this.moving=Math.sign(this.x-oldX);if(this.moving)this.walk+=Math.abs(this.x-oldX)/WALK_SPEED;
  this.furthest=Math.max(this.furthest,this.x);
  this.advanceTeam(dt);
  // A full wave already spends the reference power budget. Distance unlocks the
  // next one, but never stacks two full budgets (including after a player rush).
  const waveEmpty=!this.enemies.some(e=>e.hp>0);
  if(this.wave>0&&waveEmpty&&this.waveClearAt===null)this.waveClearAt=this.time;
  if(!waveEmpty)this.waveClearAt=null;
  const deployment=this.route.deployment;
  if(deployment){
   const next=this.waves[this.wave];
   if(this.wave===0&&this.time>=(deployment.initialDelay||0)){for(let i=0;i<deployment.initialWaves;i++)this.deployWave();}
   else if(next&&this.wave>0&&this.time-(this.portal?.openedAt??0)>=deployment.interval&&this.enemies.filter(e=>e.hp>0).length+next.types.length<=deployment.limit)this.deployWave();
   const reached=Math.max(this.furthest,...this.allies.filter(a=>a.hp>0).map(a=>a.x));
   this.waves.forEach((w,i)=>{if(w.helper&&reached>=w.x&&!this.helperArrivals.has(i))this.helperArrivals.set(i,false);});
  }else if(this.wave<this.waves.length&&waveEmpty&&(this.furthest>=this.waves[this.wave].x||this.waveClearAt!==null&&this.time-this.waveClearAt>=(this.waves[this.wave].afterClear??Infinity)))this.deployWave();
  // Reached helper waves wait for capacity; the same wave index can arrive only once.
  for(const [i,arrived] of this.helperArrivals){const type=this.waves[i].helper;if(arrived||this.atSummonLimit(type))continue;const a=this.addAlly(type);a.helper=true;this.helperArrivals.set(i,true);this.emit('summon',{actor:a.id,kind:a.type,x:a.x});}
  // The girl casts manual special skills; the guardian owns nearby normal attacks.
  const claw=MOTION.haetae.claw,heroTarget=this.selectContact(this,active.filter(e=>e.x>=this.x-20),claw.range);
  if(!this.moving&&!this.shield&&!this.action&&this.heroAttack<=0&&heroTarget&&this.canStrike(this,heroTarget)&&contactGap(this,heroTarget)<=claw.range){
   this.heroAttack=claw.period;this.action={kind:'haetae',phase:'claw',elapsed:0,resolved:false,targetId:heroTarget.id};
  }
  for(const a of [...this.allies].sort((a,b)=>a.id-b.id)){
   if(a.hp<=0)continue;
   const s=unitStats(a.type,this.keeperRank),oldAX=a.x,oldLane=a.lane;
   if(a.action?.kind==='team'){a.cd=Math.max(0,a.cd-dt);a.hit=Math.max(0,a.hit-dt);continue;}
   a.cd-=dt;a.hit=Math.max(0,a.hit-dt);a.moving=0;if(a.entering&&this.partyHold)continue;if(this.advanceEntry(a,false,dt))continue;
   // Detection and run speed belong to the companion, independent of player input.
   if(s.runSpeed&&a.type!=='cow'&&!MOTION[a.type]?.anticipation)a.alerted=this.enemies.some(e=>e.hp>0&&!e.entering&&this.time>=(e.entryAt??e.bornAt)&&e.x>=a.x-55&&contactGap(a,e)<=s.search);
   const reactionPhase=a.type==='cow'?'anger':MOTION[a.type]?.anticipation?'anticipation':null;
   if(reactionPhase){
    const threatened=this.enemies.some(e=>e.hp>0&&!e.entering&&e.bornAt<=this.time&&e.x>=a.x-55&&this.canStrike(a,e)&&contactGap(a,e)<=s.range+30+1e-6);
    if(!threatened){
     const committed=a.type==='cow'&&a.action?.phase==='anger'&&a.action.targetId!=null&&!this.enemies.some(e=>e.id===a.action.targetId&&e.hp>0);
     a.alerted=committed;if(a.action?.phase===reactionPhase&&!committed)a.action=null;
    }
    else if(!a.alerted&&!a.action){
     a.alerted=true;a.action={kind:a.type,phase:reactionPhase,elapsed:0};
     if(a.type==='cow'){const close=this.selectContact(a,this.enemies.filter(e=>e.hp>0&&!e.entering&&e.x>=a.x-55&&this.canStrike(a,e)),s.range);if(close&&contactGap(a,close)<=s.range)Object.assign(a.action,{targetId:close.id,x:close.x,dir:Math.sign(close.x-a.x)||1});}
    }
   }
   this.advanceAction(a,dt);
   if(a.action){this.walkBody(a,oldAX,oldLane,s.speed);continue;}
   if(s.heal){
    const patient=this.healerPatient(a);
    if(patient){
     a.action={kind:'healer',phase:'approach',elapsed:0,resolved:false,targetId:patient.id??null,dir:Math.sign(patient.x-a.x)||1};
    }else{
     const goal=this.healerHome(a),gap=goal-a.x,speed=s.walkSpeed??WALK_SPEED;
     this.moveBody(a,this.partyHold?0:Math.max(0,Math.min(gap,speed*dt)),dt,speed);
    }
    this.walkBody(a,oldAX,oldLane,s.speed);continue;
   }
   const ahead=this.enemies.filter(e=>e.hp>0&&(this.lanes?this.time>=(e.entryAt??e.bornAt):e.x>a.x-55));
   const hittable=['rabbit','scholar'].includes(a.type)?ahead.filter(e=>e.type!=='skirt'):ahead;
   const target=this.selectContact(a,hittable.length?hittable:ahead,s.range);
   const contactFront=ahead.filter(e=>this.sameLane(a,e)).reduce((front,e)=>!front||e.x-ENEMY_FRONT[e.type]<front.x-ENEMY_FRONT[front.type]?e:front,null);
   // Companions march independently of traveller input, stopping at firing range.
   const goal=Math.min(this.roadEnd-90,contactFront?a.x+contactGap(a,contactFront)-s.range:this.roadEnd-90),gap=goal-a.x;
   if(target&&this.canStrike(a,target)&&contactGap(a,target)<=s.range+1e-6&&a.cd<=0&&(a.type!=='cow'||a.alerted)){
    a.cd=s.period;a.action={kind:a.type,elapsed:0,resolved:false,targetId:target.id??null,x:target.x,dir:Math.sign(target.x-a.x)||1};
   }else if(a.type==='keeper'&&!this.keeperRank&&!this.partyHold&&target&&!target.entering&&contactGap(a,target)>s.range&&contactGap(a,target)<=s.search){
    a.action={kind:'keeper',phase:'transform',elapsed:0,targetId:target.id,dir:Math.sign(target.x-a.x)||1};
   }else{const speed=s.runSpeed&&a.alerted?s.runSpeed:(s.walkSpeed??(s.runSpeed?s.speed:WALK_SPEED)),travel=this.lanes&&target?(contactGap(a,target)>s.range?Math.sign(target.x-a.x)*Math.min(contactGap(a,target)-s.range,speed*dt):0):Math.max(0,Math.min(gap,speed*dt));this.moveBody(a,this.partyHold?0:travel,dt,speed,target);}
   this.walkBody(a,oldAX,oldLane,s.speed);
  }
  for(const e of this.enemies){
   if(e.hp<=0)continue;
   if(ENEMIES[e.type].stationary){e.hit=Math.max(0,e.hit-dt);continue;}
   const s=ENEMIES[e.type];e.moving=0;e.cd-=dt;e.hit=Math.max(0,e.hit-dt);
   if(e.stun>0){e.stun-=dt;e.action=null;continue;}
   if(this.advanceEntry(e,true,dt))continue;
   if(e.action){this.advanceAction(e,dt);if(this.status!=='playing')break;continue;}
   const candidates=[...this.allies.filter(a=>a.hp>0&&(this.lanes||a.x<e.x+50)),this];
   const intercept=this.lanes&&(this.moving>0||this.auto)&&Math.abs(e.x-this.x)<480;
   const touching=this.lanes?candidates.filter(a=>this.canStrike(e,a)&&contactGap(e,a)<=s.range+18):[];
   const chosen=this.selectContact(e,touching.length?touching:intercept?[this]:candidates,e.windup>0&&s.ability?s.ability.range:s.range);
   const target={x:chosen.x,a:chosen===this?null:chosen},gap=contactGap(e,chosen);
   const attackTarget=(amount)=>{
    if(target.a)this.hurtAlly(target.a,amount*(e.powerScale??1)*ENEMY_OUTPUT,e.x,e.type);
    else this.hurtHero(amount*(e.powerScale??1)*ENEMY_OUTPUT,e.x,e.type);
   };
   e.ability-=dt;
   // One eligible recipient set owns both ritual admission and restoration.
   const patients=s.ability&&(e.type==='reaper'||s.behavior==='heal')?this.enemies.filter(other=>other.hp>0&&other.hp<other.maxHp&&!ENEMIES[other.type].stationary&&(!this.route.deployment||Math.abs(other.x-e.x)<=s.ability.range)):null;
   if(e.windup>0){
    e.windup-=dt;
    if(e.windup<=0){
     if(isBoss(e.type)){
      e.action={kind:s.ability.kind,elapsed:0,resolved:false,x:e.focus??this.x};
      if(!s.ability.pattern)this.emit(s.ability.kind,{x:e.focus??target.x,from:e.x,kind:e.type});
      e.ability=s.ability.cooldown;
     }else if(e.type==='horse'||s.behavior==='charge'){e.x=Math.min(e.x,Math.max(e.x-gap+s.range,e.x-150));attackTarget(s.ability.damage);e.ability=s.ability.cooldown;this.emit('charge',{x:e.x,to:target.x,kind:e.type});}
     else if(e.type==='reaper'||s.behavior==='heal'){
      for(const other of patients)other.hp=Math.min(other.maxHp,other.hp+s.ability.heal*(e.powerScale??1)*ENEMY_OUTPUT);
      this.emit('heal',{x:e.x,enemy:true,kind:e.type});e.ability=s.ability.cooldown;
     }
    }
    if(this.status!=='playing')break;
    continue;
   }
   if(s.ability&&e.ability<=0&&gap<s.ability.range&&(!patients||patients.length)){
    e.windup=s.ability.windup;
    e.focus=target.x;
    this.emit('warning',{x:e.x,kind:e.type});
    if(isBoss(e.type))this.say(s.ability.name?s.ability.name+'! 빛나는 바닥을 피하거나 비막이를 펼쳐요.':e.type==='boss'?'우박이 쏟아져요! 비막이를 펼쳐 주세요.':e.type==='warden'?'돌창을 들어요! 내려찍기에 비막이!':'큰 파도가 밀려와요! 비막이를 준비해요.');
    else if(e.type==='horse')this.say('말이 돌진을 준비해요. 발구름!');
    continue;
   }
   if(gap>s.range+1e-6||!this.canStrike(e,chosen)){const oldEX=e.x,oldLane=e.lane,dx=Math.min(s.speed*this.enemySpeedScale*dt,Math.max(0,gap-s.range),Math.max(0,e.x-((s.stopAt===undefined?undefined:this.roadEnd-(ROAD-s.stopAt))??(this.viewport&&!this.route.deployment?this.viewport.left-this.screenPadding(e.type)-1:START-120))));this.moveBody(e,this.lanes&&chosen.x>e.x?Math.min(s.speed*this.enemySpeedScale*dt,Math.max(0,gap-s.range),this.gateX-e.x):-dx,dt,s.speed*this.enemySpeedScale,chosen);this.walkBody(e,oldEX,oldLane,s.speed);}
   else if(e.cd<=0){e.cd=s.period;e.action={kind:'enemy',elapsed:0,resolved:false,targetId:target.a?.id??null,x:target.x,dir:Math.sign(target.x-e.x)||-1};}
   if(this.status!=='playing')break;
  }
  if(this.status==='playing')this.constrainScreen();
  this.cleanup();
  if(this.status==='playing'&&this.bossDefeated&&this.gateBrokenAt!==null&&this.time-this.gateBrokenAt>=GATE_BREAK_TIME&&this.enemies.length===0)this.finish('won');
 }
}
