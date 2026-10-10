import {ROAD,GATE,START,MAX_HP,MAX_COINS,UNITS,ENEMIES,SKILLS,MOTION,ENEMY_STRIKE,ENEMY_OUTPUT,unitStats,SHOT_TIME,waveBalance,actorLayer,HERO_STANDOFF,ENEMY_FRONT,contactGap,STAGES,ALLY_HIT_TIME,GATE_BREAK_TIME,isBoss,DEFAULT_PARTY,validParty} from './data.js?v=40';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class Journey {
 constructor(){this.reset();}
 reset(){
  this.status='ready';this.party=[...DEFAULT_PARTY];this.time=0;this.x=START;this.furthest=START;this.hp=MAX_HP;this.coins=70;
  this.auto=true;this.direction=0;this.allies=[];this.enemies=[];this.projectiles=[];this.events=[];this.nextId=0;this.stage=0;this.gateBrokenAt=null;
  this.wave=0;this.heroAttack=0;this.shield=0;this.cooldowns=Object.fromEntries([...Object.keys(SKILLS),...Object.keys(UNITS)].map(k=>[k,0]));
  this.keeperRank=0;this.kills=0;this.earnedCoins=0;this.summons=0;this.casts=0;this.bossSpawned=false;this.bossDefeated=false;this.hint='동료와 함께 오른쪽 새벽문까지 가요.';
  delete this.engagedId;this.lastHintAt=0;this.hintSerial=0;this.action=null;this.walk=0;this.moving=0;
 }
 start(stage=this.stage,party=DEFAULT_PARTY){this.reset();this.party=validParty(party)?[...party]:[...DEFAULT_PARTY];this.stage=Number.isInteger(stage)&&STAGES[stage]?stage:0;this.status='playing';const first=this.addAlly(this.party[0],this.x+130);this.emit('summon',{actor:first.id,kind:first.type,x:first.x});this.emit('summon',{actor:'hero',kind:'haetae',x:this.x});this.say('자동 전진 중이에요. 달토끼를 불러 함께 출발해요.');}
 get summonCount(){return this.allies.filter(a=>a.hp>0&&!a.helper).length;}
 get waves(){return STAGES[this.stage].waves;}
 emit(type,data={}){this.events.push({type,at:this.time,...data});}
 say(message){this.hint=message;this.hintSerial++;this.lastHintAt=this.time;this.emit('hint',{message});}
 drainEvents(){const events=this.events;this.events=[];return events;}
 pause(){if(this.status==='playing'){this.status='paused';this.direction=0;}else if(this.status==='paused')this.status='playing';}
 progress(){return clamp((this.furthest-START)/(ROAD-START),0,1);}
 addAlly(type,x){const s=UNITS[type];
  // Same-kind companions share their slot; adding one never pushes an existing body.
  if(x===undefined)x=this.x-65;const a={id:++this.nextId,type,x,hp:s.hp,maxHp:s.hp,cd:0,hit:0,walk:0,moving:0,action:null};this.allies.push(a);return a;}
 spawn(type,x,powerScale=1){const s=ENEMIES[type];const a={id:++this.nextId,type,x,bornAt:this.time,powerScale,hp:s.hp*powerScale,maxHp:s.hp*powerScale,cd:0,stun:0,hit:0,windup:0,action:null,ability:s.ability?.initial??Infinity,walk:0,moving:0};this.enemies.push(a);if(isBoss(type))this.bossSpawned=true;return a;}
 reject(message){this.emit('notice',{message});return false;}
 summon(type){
  if(this.status!=='playing'||!UNITS[type]||!this.party.includes(type))return false;
  if(this.cooldowns[type]>0)return this.reject('조금만 기다려 주세요.');
  if(this.summonCount>=7)return this.reject('동료는 일곱까지 함께 걸을 수 있어요.');
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
  const sorted=candidates.filter(a=>a.hp>0).sort((a,b)=>contactGap(actor,a)-contactGap(actor,b)||actorLayer(b)-actorLayer(a));
  const current=sorted.find(a=>(a.id??null)===actor.engagedId&&contactGap(actor,a)<=range+18);
  const target=current||sorted[0];
  if(current||(target&&contactGap(actor,target)<=range+1e-6))actor.engagedId=target.id??null;else delete actor.engagedId;
  return target;
 }
 targetForCharm(){const inRange=this.enemies.filter(e=>e.hp>0&&e.x>=this.x-30&&e.x<=this.x+590);return inRange.find(e=>e.type==='reaper')||inRange.find(e=>e.type!=='skirt')||inRange[0];}
 skill(type){
  if(this.status!=='playing'||!SKILLS[type])return false;
  if(this.cooldowns[type]>0)return this.reject('기술을 준비하고 있어요.');
  if(['rush','stomp','shelter'].includes(type)&&(this.action||this.shield>0))return this.reject('합동 동작이 끝나면 사용할 수 있어요.');
  if(this.coins<SKILLS[type].cost)return this.reject('엽전이 조금 더 필요해요.');
  const target=type==='charm'?this.targetForCharm():null;
  if(type==='charm'&&!target)return this.reject('아직 부적이 닿을 귀물이 없어요.');
  this.coins-=SKILLS[type].cost;this.cooldowns[type]=SKILLS[type].cooldown;this.casts++;
  if(type==='shelter'){this.shield=6;this.emit('shelter',{x:this.x});}
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
 awardCoins(amount,e,reason){const before=Math.floor(this.coins);this.coins=clamp(this.coins+amount,0,MAX_COINS);const received=Math.floor(this.coins)-before;this.earnedCoins+=received;if(received>0)this.emit('coin',{amount:received,total:this.coins,x:e.x,kind:e.type,reason});}
 hurtEnemy(e,damage,sourceX=this.x,weapon='physical'){if(e.hp<=0||this.status!=='playing'||!Number.isFinite(damage)||damage<=0)return;e.hp-=damage;e.hit=.26;e.hitDir=Math.sign(e.x-sourceX)||1;this.emit('hit',{actor:e.id,x:e.x,from:sourceX,dir:e.hitDir,kind:e.type,weapon,damage,enemy:true});this.awardCoins(1,e,'hit');}
 // The gate is an entrance, never an escape route for displaced living enemies.
 // A not-yet-arrived unit keeps its position; knockback cannot pull it out early.
 pushEnemy(e,to){if(ENEMIES[e.type].stationary)return;e.x=Math.max(e.x,Math.min(GATE-45,to));}
 // A flying attack outlives its launch pose. Journey alone owns contact and rewards.
 launchShot({actor,sourceKind,weapon,from,target,damage,high=false,stun=0,enemy=false}){
  const shot={actor,sourceKind,weapon,from,to:target.x,targetId:target.id??null,targetKind:target.type||'haetae',damage,high,stun,enemy,t:0,duration:SHOT_TIME};
  this.projectiles.push(shot);this.emit('projectile',{...shot,flight:shot,kind:weapon,targetActor:target.id??null,hit:!high||target.type!=='skirt'});
 }
 advanceProjectiles(dt){
  for(const shot of this.projectiles){
   if(this.status!=='playing')break;
   shot.t+=dt;if(shot.t+1e-9<shot.duration)continue;
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
  if(action.kind==='healer'){
   const spec=MOTION.healer,s=UNITS.healer;
   let target=action.targetId===null?this:this.allies.find(a=>a.id===action.targetId&&a.hp>0);
   const valid=target&&target.hp>0&&target.hp<(target.maxHp??MAX_HP)&&Math.abs(target.x-actor.x)<=s.search;
   const moveTo=goal=>{const gap=goal-actor.x;actor.x+=Math.sign(gap)*Math.min(Math.abs(gap),s.speed*dt);return Math.abs(goal-actor.x)<1;};
   // Lock each wrap to one patient. Reconsider only between wraps or after cancellation.
   if(!target||target.hp<=0||Math.abs(target.x-actor.x)>s.search||(!valid&&!action.resolved))action.phase='return';
   if(action.phase==='return'){
    const next=this.healerPatient(actor);
    if(next){target=next;Object.assign(action,{phase:'approach',targetId:next.id??null,elapsed:0,resolved:false,dir:Math.sign(next.x-actor.x)||1});}
    else{if(moveTo(this.healerHome(actor)))actor.action=null;return;}
   }
   if(action.phase==='approach'){
    const dx=target.x-actor.x;action.dir=Math.sign(dx)||action.dir||1;
    if(target!==actor)moveTo(target.x-action.dir*52);
    if(Math.abs(target.x-actor.x)<=52.01&&actor.cd<=0){action.phase='treat';action.elapsed=0;actor.cd=s.period;}
    return;
   }
   // Walking patients keep their treatment clock while the physician follows.
   if(target!==actor)moveTo(target.x-action.dir*52);
   if(Math.abs(target.x-actor.x)>s.range)return;
   action.elapsed+=dt;
   if(!action.resolved&&action.elapsed>=spec.impact){
    action.resolved=true;const amount=Math.min(s.heal,(target.maxHp??MAX_HP)-target.hp);
    if(amount>0){target.hp+=amount;this.emit('heal',{actor:actor.id,sourceKind:'healer',targetActor:target.id??null,kind:target.type||'haetae',x:target.x,from:actor.x,amount});}
   }
   // Return is a patient check, not an unconditional trip home after every wrap.
   if(action.elapsed>=spec.duration)action.phase='return';
   return;
  }
  if(isBoss(actor.type)&&action.kind===ENEMIES[actor.type].ability.kind){
   const ability=ENEMIES[actor.type].ability;
   action.elapsed+=dt;
   if(!action.resolved&&action.elapsed>=ability.impact){
    action.resolved=true;const blocked=this.shield>0;
    this.emit(action.kind+'-impact',{x:action.x??this.x,from:actor.x,kind:actor.type,blocked});
    const within=target=>action.kind==='hail'||(target.x>=actor.x-(action.kind==='quake'?520:950)&&target.x<=actor.x+90);
    if(!blocked){if(within(this))this.hurtHero(ability.damage*(actor.powerScale??1)*ENEMY_OUTPUT,actor.x,action.kind);for(const a of this.allies)if(within(a))this.hurtAlly(a,ability.splash*(actor.powerScale??1)*ENEMY_OUTPUT,actor.x,action.kind);}
    else{this.coins=clamp(this.coins+8,0,MAX_COINS);this.say('큰 공격을 막았어요. 지금 전진해요!');}
   }
   if(action.elapsed>=ability.duration)actor.action=null;
   return;
  }
  if(action.kind==='rush'){
   const before=action.elapsed;action.elapsed+=dt;
   const travel=Math.max(0,Math.min(action.elapsed,1.1)-Math.max(before,.18));
   if(travel>0){
    const from=this.x;this.x=clamp(this.x+travel*420,START,ROAD);
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
  const spec=action.kind==='enemy'?ENEMY_STRIKE:MOTION[action.kind];action.elapsed+=dt;
  if(!action.resolved&&action.elapsed>=spec.impact){
   action.resolved=true;
   if(action.kind==='enemy'){
    const ally=action.targetId===null?null:this.allies.find(a=>a.id===action.targetId&&a.hp>0);
    const valid=action.targetId===null||!!ally,targetX=ally?.x??this.x;
    if(valid&&contactGap(actor,{x:targetX})<=ENEMIES[actor.type].range+24){
     if(actor.type==='reaper')this.launchShot({actor:actor.id,sourceKind:actor.type,weapon:'hex',from:actor.x,target:ally||this,damage:ENEMIES[actor.type].damage*(actor.powerScale??1)*ENEMY_OUTPUT,enemy:true});
     else {if(ally)this.hurtAlly(ally,ENEMIES[actor.type].damage*(actor.powerScale??1)*ENEMY_OUTPUT,actor.x,actor.type);else this.hurtHero(ENEMIES[actor.type].damage*(actor.powerScale??1)*ENEMY_OUTPUT,actor.x,actor.type);
     this.emit('claw',{x:actor.x,to:targetX+(ally?0:37),kind:actor.type,sourceKind:actor.type,targetKind:ally?.type||'haetae',targetActor:ally?.id});}
    }
   }else if(action.kind==='haetae'){
    this.emit('stomp',{x:this.x});
    for(const e of this.enemies)if(e.hp>0&&e.x>=this.x-70&&e.x<=this.x+390){this.hurtEnemy(e,44,this.x,'stomp');this.pushEnemy(e,e.x+85);e.stun=2.1;e.windup=0;e.action=null;}
   }else{
    const target=this.enemies.find(e=>e.id===action.targetId&&e.hp>0),unit=unitStats(actor.type,this.keeperRank);
    if(target&&target.x>=actor.x-55&&contactGap(actor,target)<=unit.range+1e-6){
     const high=unit.weapon==='seed'||unit.weapon==='seal',hit=!high||target.type!=='skirt';
     if(['horn','spear','sword'].includes(unit.weapon)){this.emit('swipe',{actor:actor.id,kind:unit.weapon,sourceKind:actor.type,targetKind:target.type,targetActor:target.id,x:actor.x,from:actor.x,to:target.x});this.hurtEnemy(target,unit.damage,actor.x,unit.weapon);}
     else this.launchShot({actor:actor.id,sourceKind:actor.type,weapon:unit.weapon,from:actor.x,target,damage:unit.damage,high,stun:unit.weapon==='seal'?.65:0});
    }
   }
  }
  if(action.elapsed>=spec.duration)actor.action=null;
 }
 hurtAlly(a,damage,sourceX=null,weapon='physical'){
  if(a.hp<=0||this.status!=='playing')return;
  if(this.shield>0&&(weapon==='hail'||(sourceX!==null&&sourceX>=a.x))){this.emit('guard',{actor:a.id,x:a.x,from:sourceX,dir:-1,kind:a.type,weapon,damage:0,umbrella:true,enemy:false});return;}
  const guard=sourceX!==null&&sourceX>=a.x?UNITS[a.type].guard:0;
  const amount=damage*(1-guard);a.hp-=amount;a.hit=ALLY_HIT_TIME;a.hitDir=sourceX===null?0:Math.sign(a.x-sourceX);
  this.emit(guard?'guard':'hit',{actor:a.id,x:a.x,from:sourceX,dir:a.hitDir,kind:a.type,weapon,damage:amount,enemy:false});
 }
 hurtHero(damage,sourceX=this.x+80,weapon='physical'){
  if(this.status!=='playing')return;
  if(this.shield>0&&(weapon==='hail'||(sourceX!==null&&sourceX>=this.x))){this.emit('guard',{x:this.x+37,from:sourceX,dir:-1,kind:'haetae',weapon,damage:0,umbrella:true,enemy:false});return;}
  this.hp=clamp(this.hp-damage,0,MAX_HP);this.emit('hurt',{x:this.x+37,from:sourceX,dir:Math.sign(this.x-sourceX)||-1,kind:'haetae',weapon,damage});if(this.hp<=0){const mounted=this.action?.kind==='rush'||this.shield>0;this.emit('vanish',{actor:'hero',x:this.x+37,kind:mounted?'mount':'haetae',enemy:false});if(!mounted)this.emit('vanish',{actor:'girl',x:this.x-60,kind:'girl',enemy:false});this.finish('lost');}
 }
 cleanup(){
  for(const e of this.enemies)if(e.hp<=0&&!e.dead){e.dead=true;if(e.type==='gate'){this.gateBrokenAt=this.time;this.furthest=ROAD;this.emit('gate-break',{x:e.x,kind:'gate'});continue;}this.kills++;this.awardCoins(ENEMIES[e.type].reward,e,'defeat');this.emit('vanish',{actor:e.id,x:e.x,kind:e.type,enemy:true,dir:e.hitDir||1});if(isBoss(e.type)){this.bossDefeated=true;this.say('문을 지키던 귀물이 사라졌어요. 저승문을 부숴 길을 열어요!');}}
  for(const a of this.allies)if(a.hp<=0)this.emit('vanish',{actor:a.id,x:a.x,kind:a.type,enemy:false,dir:a.hitDir||-1});
  this.enemies=this.enemies.filter(e=>!e.dead);this.allies=this.allies.filter(a=>a.hp>0);
  if(this.bossDefeated&&this.wave>=this.waves.length&&this.gateBrokenAt===null&&!this.enemies.some(e=>e.type==='gate')){const gate=this.spawn('gate',GATE);gate.hp=gate.maxHp=STAGES[this.stage].gateHp;}
 }
 finish(status){if(this.status!=='playing')return;this.status=status;this.direction=0;this.emit('finish',{status});}
 healerPatient(actor){
  const s=UNITS.healer;
  return [this,...this.allies].filter(b=>b.hp>0&&b.hp<(b.maxHp??MAX_HP)&&Math.abs(b.x-actor.x)<=s.search).sort((b,c)=>b.hp/(b.maxHp??MAX_HP)-c.hp/(c.maxHp??MAX_HP)||Math.abs(b.x-actor.x)-Math.abs(c.x-actor.x))[0]||null;
 }
 healerHome(actor){
  const s=UNITS.healer,formation=Math.min(ROAD-90,this.x+s.formation);
  const front=this.enemies.filter(e=>e.hp>0&&e.x>actor.x-55).sort((a,b)=>(a.x-ENEMY_FRONT[a.type])-(b.x-ENEMY_FRONT[b.type]))[0];
  const engaged=front&&front.x<=Math.max(formation,actor.x)+HERO_STANDOFF-s.formation+180;
  return Math.max(START-130,engaged?front.x-ENEMY_FRONT[front.type]-HERO_STANDOFF+s.formation:formation);
 }
 step(dt){
  if(this.status!=='playing'||!Number.isFinite(dt)||dt<=0)return;
  const oldX=this.x;dt=Math.min(dt,.1);this.time+=dt;this.coins=clamp(this.coins+dt*2.2,0,MAX_COINS);
  this.advanceProjectiles(dt);if(this.status!=='playing')return;
  this.shield=Math.max(0,this.shield-dt);this.heroAttack-=dt;this.advanceAction(this,dt);
  for(const k of Object.keys(this.cooldowns))this.cooldowns[k]=Math.max(0,this.cooldowns[k]-dt);
  const active=this.enemies.filter(e=>e.hp>0);
  const front=active.filter(e=>e.x>=this.x-20).sort((a,b)=>(a.x-ENEMY_FRONT[a.type])-(b.x-ENEMY_FRONT[b.type]))[0];
  let direction=this.direction|| (this.auto?1:0);
  let movement=direction*(this.direction?76:36)*dt;
  if(this.action)movement=0;
  const stopAt=this.direction?145:this.allies.some(a=>a.hp>0)?HERO_STANDOFF:145;
  if(movement>0&&front)movement=Math.min(movement,Math.max(0,front.x-ENEMY_FRONT[front.type]-this.x-stopAt));
  this.x=clamp(this.x+movement,START,ROAD);this.moving=Math.sign(this.x-oldX);if(this.moving)this.walk+=Math.abs(this.x-oldX)/76;
  this.furthest=Math.max(this.furthest,this.x);
  // A full wave already spends the reference power budget. Distance unlocks the
  // next one, but never stacks two full budgets (including after a player rush).
  if(this.wave<this.waves.length&&this.furthest>=this.waves[this.wave].x&&!this.enemies.some(e=>e.hp>0)){
   const scale=waveBalance(this.wave,this.stage).scale,w=this.waves[this.wave++];w.types.forEach((type,i)=>this.spawn(type,GATE+24+i*125,scale));
   // The existing monotonic wave cursor owns each one-time helper arrival.
   if(w.helper){const a=this.addAlly(w.helper,this.x-65);a.helper=true;this.emit('summon',{actor:a.id,kind:a.type,x:a.x});}
   this.say(w.message);
  }
  const heroTarget=this.selectContact(this,active.filter(e=>e.x>=this.x-20&&e.type!=='skirt'),480);
  if(!this.shield&&this.action?.kind!=='rush'&&this.heroAttack<=0&&heroTarget&&contactGap(this,heroTarget)<480){this.heroAttack=1.35;this.launchShot({actor:'girl',sourceKind:'girl',weapon:'charm',from:this.x-60,target:heroTarget,damage:10,high:true});}
  for(const a of [...this.allies].sort((a,b)=>a.id-b.id)){
   if(a.hp<=0)continue;
   const s=unitStats(a.type,this.keeperRank),oldAX=a.x;
   const formation=Math.min(ROAD-90,this.x+s.formation);
   a.cd-=dt;a.hit=Math.max(0,a.hit-dt);a.moving=0;this.advanceAction(a,dt);
   if(a.action){const dx=a.x-oldAX;a.moving=Math.sign(dx);a.walk+=Math.abs(dx)/s.speed;continue;}
   const ahead=this.enemies.filter(e=>e.hp>0&&e.x>a.x-55).sort((b,c)=>(b.x-ENEMY_FRONT[b.type])-(c.x-ENEMY_FRONT[c.type]));
   if(s.heal){
    const patient=this.healerPatient(a);
    if(patient){
     a.action={kind:'healer',phase:'approach',elapsed:0,resolved:false,targetId:patient.id??null,dir:Math.sign(patient.x-a.x)||1};
    }else{
     const goal=this.healerHome(a),gap=goal-a.x,retreat=this.direction<0&&a.x>goal+170;
     if(gap>0||retreat)a.x+=Math.sign(gap)*Math.min(Math.abs(gap),s.speed*dt);
    }
    const dx=a.x-oldAX;a.moving=Math.abs(dx)>.00001?Math.sign(dx):0;a.walk+=Math.abs(dx)/s.speed;continue;
   }
   const hittable=['rabbit','scholar'].includes(a.type)?ahead.filter(e=>e.type!=='skirt'):ahead;
   const target=this.selectContact(a,hittable.length?hittable:ahead,s.range);
   const contactFront=ahead[0];
   // Enemy-relative slots stay put if the free-moving traveller dashes through the line.
   const engaged=contactFront&&contactFront.x<=Math.max(this.x+s.formation,a.x)+s.range+180;
   let goal=engaged?contactFront.x-ENEMY_FRONT[contactFront.type]-s.range:formation;
   const retreat=this.direction<0&&a.x>formation+170;
   if(retreat)goal=Math.min(goal,formation+170);
   const gap=goal-a.x,backing=gap<-18&&retreat;
   // Approach each firing distance; hold when crowded. Only left input permits retreat.
   if(!retreat&&target&&contactGap(a,target)<=s.range+1e-6&&a.cd<=0){
    a.cd=s.period;a.action={kind:a.type,elapsed:0,resolved:false,targetId:target.id??null,dir:Math.sign(target.x-a.x)||1};
   }else if(backing||gap>1e-6){a.x+=Math.sign(gap)*Math.min(Math.abs(gap),s.speed*dt);}
   const dx=a.x-oldAX;a.moving=Math.abs(dx)>.00001?Math.sign(dx):0;a.walk+=Math.abs(dx)/s.speed;
  }
  for(const e of this.enemies){
   if(e.hp<=0)continue;
   if(ENEMIES[e.type].stationary){e.hit=Math.max(0,e.hit-dt);continue;}
   const s=ENEMIES[e.type];e.moving=0;e.cd-=dt;e.hit=Math.max(0,e.hit-dt);
   if(e.stun>0){e.stun-=dt;e.action=null;continue;}
   if(e.action){this.advanceAction(e,dt);if(this.status!=='playing')break;continue;}
   const candidates=[...this.allies.filter(a=>a.hp>0&&a.x<e.x+50),this];
   const chosen=this.selectContact(e,candidates,e.windup>0&&s.ability?s.ability.range:s.range);
   const target={x:chosen.x,a:chosen===this?null:chosen},gap=contactGap(e,chosen);
   const attackTarget=(amount)=>{
    if(target.a)this.hurtAlly(target.a,amount*(e.powerScale??1)*ENEMY_OUTPUT,e.x,e.type);
    else this.hurtHero(amount*(e.powerScale??1)*ENEMY_OUTPUT,e.x,e.type);
   };
   e.ability-=dt;
   if(e.windup>0){
    e.windup-=dt;
    if(e.windup<=0){
     if(isBoss(e.type)){
      e.action={kind:s.ability.kind,elapsed:0,resolved:false,x:this.x};
      this.emit(s.ability.kind,{x:this.x,from:e.x,kind:e.type});
      e.ability=s.ability.cooldown;
     }else if(e.type==='horse'){e.x=Math.max(target.x+45,e.x-150);attackTarget(s.ability.damage);e.ability=s.ability.cooldown;this.emit('charge',{x:e.x,to:target.x,kind:e.type});}
     else if(e.type==='reaper'){
      for(const other of this.enemies.filter(other=>!ENEMIES[other.type].stationary))other.hp=Math.min(other.maxHp,other.hp+s.ability.heal*(e.powerScale??1)*ENEMY_OUTPUT);
      this.emit('heal',{x:e.x,enemy:true,kind:e.type});e.ability=s.ability.cooldown;
     }
    }
    if(this.status!=='playing')break;
    continue;
   }
   if(s.ability&&e.ability<=0&&gap<s.ability.range){
    e.windup=s.ability.windup;
    this.emit('warning',{x:e.x,kind:e.type});
    if(isBoss(e.type))this.say(e.type==='boss'?'우박이 쏟아져요! 비막이를 펼쳐 주세요.':e.type==='warden'?'돌창을 들어요! 내려찍기에 비막이!':'큰 파도가 밀려와요! 비막이를 준비해요.');
    else if(e.type==='horse')this.say('말이 돌진을 준비해요. 발구름!');
    continue;
   }
   if(gap>s.range){const dx=Math.min(s.speed*dt,gap-s.range,Math.max(0,e.x-(s.stopAt??START-120)));e.x-=dx;e.moving=dx>0?-1:0;e.walk+=dx/s.speed;}
   else if(e.cd<=0){e.cd=s.period;e.action={kind:'enemy',elapsed:0,resolved:false,targetId:target.a?.id??null,dir:Math.sign(target.x-e.x)||-1};}
   if(this.status!=='playing')break;
  }
  this.cleanup();
  if(this.status==='playing'&&this.bossDefeated&&this.gateBrokenAt!==null&&this.time-this.gateBrokenAt>=GATE_BREAK_TIME&&this.enemies.length===0)this.finish('won');
 }
}
