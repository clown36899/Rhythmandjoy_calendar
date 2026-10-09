import {ROAD,GATE,START,MAX_HP,MAX_COINS,UNITS,ENEMIES,SKILLS,WAVES,MOTION,ENEMY_STRIKE,unitStats,SHOT_TIME,waveBalance,AREAS} from './data.js?v=24';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class Journey {
 constructor(){this.reset();}
 reset(){
  this.status='ready';this.time=0;this.x=START;this.furthest=START;this.hp=MAX_HP;this.coins=70;
  this.auto=true;this.direction=0;this.allies=[];this.enemies=[];this.projectiles=[];this.events=[];this.nextId=0;this.stage=0;
  this.wave=0;this.heroAttack=0;this.shield=0;this.cooldowns=Object.fromEntries([...Object.keys(SKILLS),...Object.keys(UNITS)].map(k=>[k,0]));
  this.keeperRank=0;this.kills=0;this.earnedCoins=0;this.summons=0;this.casts=0;this.bossSpawned=false;this.bossDefeated=false;this.hint='동료와 함께 오른쪽 새벽문까지 가요.';
  this.lastHintAt=0;this.hintSerial=0;this.action=null;this.walk=0;this.moving=0;
 }
 start(stage=this.stage){this.reset();this.stage=Number.isInteger(stage)&&AREAS[stage]?stage:0;this.status='playing';this.addAlly('cow',this.x+130);this.say('자동 전진 중이에요. 달토끼를 불러 함께 출발해요.');}
 emit(type,data={}){this.events.push({type,at:this.time,...data});}
 say(message){this.hint=message;this.hintSerial++;this.lastHintAt=this.time;this.emit('hint',{message});}
 drainEvents(){const events=this.events;this.events=[];return events;}
 pause(){if(this.status==='playing'){this.status='paused';this.direction=0;}else if(this.status==='paused')this.status='playing';}
 progress(){return clamp((this.furthest-START)/(ROAD-START),0,1);}
 addAlly(type,x){const s=UNITS[type];
  // Summons enter from the tail; travel spacing is not a combat collision barrier.
  if(x===undefined){const line=this.allies.filter(a=>a.hp>0&&a.type===type);x=Math.min(this.x-65,...line.map(a=>a.x-s.spacing));}const a={id:++this.nextId,type,x,hp:s.hp,maxHp:s.hp,cd:0,hit:0,walk:0,moving:0,action:null};this.allies.push(a);return a;}
 spawn(type,x,powerScale=1){const s=ENEMIES[type];const a={id:++this.nextId,type,x,powerScale,hp:s.hp*powerScale,maxHp:s.hp*powerScale,cd:0,stun:0,hit:0,windup:0,action:null,ability:s.ability?.initial??Infinity,walk:0,moving:0};this.enemies.push(a);if(type==='boss')this.bossSpawned=true;return a;}
 reject(message){this.emit('notice',{message});return false;}
 summon(type){
  if(this.status!=='playing'||!UNITS[type])return false;
  if(this.cooldowns[type]>0)return this.reject('조금만 기다려 주세요.');
  if(this.allies.filter(a=>a.hp>0).length>=7)return this.reject('동료는 일곱까지 함께 걸을 수 있어요.');
  if(this.coins<UNITS[type].cost)return this.reject('엽전이 조금 더 필요해요.');
  this.coins-=UNITS[type].cost;this.cooldowns[type]=UNITS[type].cooldown;
  const ally=this.addAlly(type);this.summons++;this.emit('summon',{kind:type,x:ally.x});return true;
 }
 upgradeKeeper(){
  if(this.status!=='playing')return false;
  if(this.keeperRank)return this.reject('도령은 이미 먹붓을 배웠어요.');
  const price=UNITS.keeper.upgrade.price;if(this.coins<price)return this.reject('수련에는 엽전 45가 필요해요.');
  this.coins-=price;this.keeperRank=1;
  for(const a of this.allies)if(a.type==='keeper'){a.action=null;a.cd=Math.max(a.cd,.3);}
  this.emit('upgrade',{kind:'keeper',x:this.x});this.say('도령이 먹붓을 배웠어요. 지금 동료와 새로 부를 동료 모두 성장해요.');return true;
 }
 targetForCharm(){const inRange=this.enemies.filter(e=>e.hp>0&&e.x>=this.x-30&&e.x<=this.x+590);return inRange.find(e=>e.type==='reaper')||inRange.find(e=>e.type!=='skirt')||inRange[0];}
 skill(type){
  if(this.status!=='playing'||!SKILLS[type])return false;
  if(this.cooldowns[type]>0)return this.reject('기술을 준비하고 있어요.');
  if(['rush','stomp'].includes(type)&&this.action)return this.reject('합동 동작이 끝나면 사용할 수 있어요.');
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
  if(action.kind==='hail'){
   const ability=ENEMIES.boss.ability;
   action.elapsed+=dt;
   if(!action.resolved&&action.elapsed>=ability.impact){
    action.resolved=true;const blocked=this.shield>0;
    this.emit('hail-impact',{x:this.x,blocked});
    if(!blocked){this.hurtHero(ability.damage*(actor.powerScale??1),actor.x,'hail');for(const a of this.allies)this.hurtAlly(a,ability.splash*(actor.powerScale??1),null,'hail');}
    else{this.coins=clamp(this.coins+8,0,MAX_COINS);this.say('우박을 막았어요. 지금 전진해요!');}
   }
   if(action.elapsed>=ability.duration)actor.action=null;
   return;
  }
  if(action.kind==='rush'){
   const before=action.elapsed;action.elapsed+=dt;
   const travel=Math.max(0,Math.min(action.elapsed,1.1)-Math.max(before,.18));
   if(travel>0){
    const from=this.x;this.x=clamp(this.x+travel*420,START,ROAD);
    for(const e of this.enemies)if(e.hp>0&&e.x>=from-60&&e.x<=this.x+180&&!action.hitIds.includes(e.id)){
     action.hitIds.push(e.id);this.hurtEnemy(e,65,from,'rush');e.x=Math.min(ROAD+330,Math.max(e.x,this.x+430));e.stun=1.2;e.windup=0;e.action=null;
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
    if(valid&&Math.abs(actor.x-targetX)<=ENEMIES[actor.type].range+24){
     if(actor.type==='reaper')this.launchShot({actor:actor.id,sourceKind:'reaper',weapon:'hex',from:actor.x,target:ally||this,damage:ENEMIES.reaper.damage*(actor.powerScale??1),enemy:true});
     else {if(ally)this.hurtAlly(ally,ENEMIES[actor.type].damage*(actor.powerScale??1),actor.x,actor.type);else this.hurtHero(ENEMIES[actor.type].damage*(actor.powerScale??1),actor.x,actor.type);
     this.emit('claw',{x:actor.x,to:targetX+(ally?0:37),kind:actor.type,sourceKind:actor.type,targetKind:ally?.type||'haetae',targetActor:ally?.id});}
    }
   }else if(action.kind==='haetae'){
    this.emit('stomp',{x:this.x});
    for(const e of this.enemies)if(e.hp>0&&e.x>=this.x-70&&e.x<=this.x+390){this.hurtEnemy(e,44,this.x,'stomp');e.x=Math.min(ROAD+330,e.x+85);e.stun=2.1;e.windup=0;e.action=null;}
   }else{
    const target=this.enemies.find(e=>e.id===action.targetId&&e.hp>0),unit=unitStats(actor.type,this.keeperRank);
    if(target&&target.x>=actor.x-55&&target.x-actor.x<=unit.range){
     const high=unit.weapon==='seed'||unit.weapon==='seal',hit=!high||target.type!=='skirt';
     if(unit.weapon==='horn'){this.emit('swipe',{actor:actor.id,kind:unit.weapon,sourceKind:actor.type,targetKind:target.type,targetActor:target.id,x:actor.x,from:actor.x,to:target.x});this.hurtEnemy(target,unit.damage,actor.x,unit.weapon);}
     else this.launchShot({actor:actor.id,sourceKind:actor.type,weapon:unit.weapon,from:actor.x,target,damage:unit.damage,high,stun:unit.weapon==='seal'?.65:0});
    }
   }
  }
  if(action.elapsed>=spec.duration)actor.action=null;
 }
 hurtAlly(a,damage,sourceX=null,weapon='physical'){
  if(a.hp<=0)return;
  const guard=sourceX!==null&&sourceX>=a.x?UNITS[a.type].guard:0;
  const amount=damage*(1-guard);a.hp-=amount;a.hit=.26;a.hitDir=sourceX===null?0:Math.sign(a.x-sourceX);
  this.emit(guard?'guard':'hit',{actor:a.id,x:a.x,from:sourceX,dir:a.hitDir,kind:a.type,weapon,damage:amount,enemy:false});
 }
 hurtHero(damage,sourceX=this.x+80,weapon='physical'){if(this.status!=='playing')return;this.hp=clamp(this.hp-damage,0,MAX_HP);this.emit('hurt',{x:this.x+37,from:sourceX,dir:Math.sign(this.x-sourceX)||-1,kind:'haetae',weapon,damage});if(this.hp<=0)this.finish('lost');}
 cleanup(){
  for(const e of this.enemies)if(e.hp<=0&&!e.dead){e.dead=true;this.kills++;this.awardCoins(ENEMIES[e.type].reward,e,'defeat');this.emit('vanish',{actor:e.id,x:e.x,kind:e.type,enemy:true,dir:e.hitDir||1});if(e.type==='boss'){this.bossDefeated=true;this.say('먹구름이 걷혔어요. 이제 새벽문까지 함께 가요.');}}
  for(const a of this.allies)if(a.hp<=0)this.emit('vanish',{actor:a.id,x:a.x,kind:a.type,enemy:false,dir:a.hitDir||-1});
  this.enemies=this.enemies.filter(e=>!e.dead);this.allies=this.allies.filter(a=>a.hp>0);
 }
 finish(status){if(this.status!=='playing')return;this.status=status;this.direction=0;this.emit('finish',{status});}
 step(dt){
  if(this.status!=='playing'||!Number.isFinite(dt)||dt<=0)return;
  const oldX=this.x;dt=Math.min(dt,.1);this.time+=dt;this.coins=clamp(this.coins+dt*2.2,0,MAX_COINS);
  this.advanceProjectiles(dt);if(this.status!=='playing')return;
  this.shield=Math.max(0,this.shield-dt);this.heroAttack-=dt;this.advanceAction(this,dt);
  for(const k of Object.keys(this.cooldowns))this.cooldowns[k]=Math.max(0,this.cooldowns[k]-dt);
  const active=this.enemies.filter(e=>e.hp>0);
  const front=active.filter(e=>e.x>=this.x-20).sort((a,b)=>a.x-b.x)[0];
  let direction=this.direction|| (this.auto?1:0);
  let movement=direction*(this.direction?76:36)*dt;
  if(this.action)movement=0;
  if(movement>0&&front&&front.x-this.x<145)movement=0;
  this.x=clamp(this.x+movement,START,ROAD);this.moving=Math.sign(this.x-oldX);if(this.moving)this.walk+=Math.abs(this.x-oldX)/76;
  this.furthest=Math.max(this.furthest,this.x);
  // A full wave already spends the reference power budget. Distance unlocks the
  // next one, but never stacks two full budgets (including after a player rush).
  if(this.wave<WAVES.length&&this.furthest>=WAVES[this.wave].x&&!this.enemies.some(e=>e.hp>0)){
   const scale=waveBalance(this.wave).scale,w=WAVES[this.wave++];w.types.forEach((type,i)=>this.spawn(type,GATE+24+i*125,scale));this.say(w.message);
  }
  if(this.action?.kind!=='rush'&&this.heroAttack<=0&&front&&front.type!=='skirt'&&front.x-this.x<200){this.heroAttack=1.35;this.launchShot({actor:'girl',sourceKind:'girl',weapon:'charm',from:this.x-60,target:front,damage:10,high:true});}
  for(const a of [...this.allies].sort((a,b)=>a.id-b.id)){
   if(a.hp<=0)continue;
   const s=unitStats(a.type,this.keeperRank),oldAX=a.x;
   const preceding=this.allies.filter(other=>other.hp>0&&other.type===a.type&&other.id<a.id).sort((b,c)=>c.id-b.id);
   const formation=Math.min(ROAD-90,this.x+s.formation-preceding.length*s.spacing);
   a.cd-=dt;a.hit=Math.max(0,a.hit-dt);a.moving=0;this.advanceAction(a,dt);
   if(a.action){const dx=a.x-oldAX;a.moving=Math.sign(dx);a.walk+=Math.abs(dx)/s.speed;continue;}
   const ahead=this.enemies.filter(e=>e.hp>0&&e.x>a.x-55).sort((b,c)=>b.x-c.x);
   const target=(a.type==='scholar'?ahead.find(e=>e.type==='reaper'&&e.x-a.x<=s.range):null)||(['rabbit','scholar'].includes(a.type)?ahead.find(e=>e.type!=='skirt'&&e.x-a.x<=s.range):null)||ahead[0];
   // Every melee ally shares the front during combat. Formation slots only guide travel.
   const engaged=target&&s.weapon==='horn'&&target.x<=this.x+s.formation+s.range+120;
   const goal=engaged?target.x-s.range+Math.min(24,preceding.length*12):formation;
   if(target&&target.x-a.x<=s.range){
    if(a.cd<=0){
     a.cd=s.period;
     a.action={kind:a.type,elapsed:0,resolved:false,targetId:target.id};
    }
   }else if(a.x<goal){a.x=Math.min(a.x+s.speed*dt,goal);}
   // Regroup only on deliberate retreat; ending combat must never teleport the line.
   if(this.direction<0&&a.x>formation+170){a.x=Math.max(a.x-s.speed*dt,formation+170);}
   const dx=a.x-oldAX;a.moving=Math.abs(dx)>.00001?Math.sign(dx):0;a.walk+=Math.abs(dx)/s.speed;
  }
  for(const e of this.enemies){
   if(e.hp<=0)continue;
   const s=ENEMIES[e.type];e.moving=0;e.cd-=dt;e.hit=Math.max(0,e.hit-dt);
   if(e.stun>0){e.stun-=dt;e.action=null;continue;}
   if(e.action){this.advanceAction(e,dt);if(this.status!=='playing')break;continue;}
   let targets=this.allies.filter(a=>a.hp>0&&a.x<e.x+50).map(a=>({x:a.x,a}));
   targets.push({x:this.x,a:null});
   targets.sort((a,b)=>b.x-a.x);const target=targets[0],gap=e.x-target.x;
   const attackTarget=(amount)=>{
    if(target.a)this.hurtAlly(target.a,amount*(e.powerScale??1),e.x,e.type);
    else this.hurtHero(amount*(e.powerScale??1),e.x,e.type);
   };
   e.ability-=dt;
   if(e.windup>0){
    e.windup-=dt;
    if(e.windup<=0){
     if(e.type==='boss'){
      e.action={kind:'hail',elapsed:0,resolved:false};
      this.emit('hail',{x:this.x});
      e.ability=s.ability.cooldown;
     }else if(e.type==='horse'){e.x=Math.max(target.x+45,e.x-150);attackTarget(s.ability.damage);e.ability=s.ability.cooldown;this.emit('charge',{x:e.x,to:target.x,kind:e.type});}
     else if(e.type==='reaper'){
      for(const other of this.enemies)other.hp=Math.min(other.maxHp,other.hp+s.ability.heal*(e.powerScale??1));
      this.emit('heal',{x:e.x,enemy:true,kind:e.type});e.ability=s.ability.cooldown;
     }
    }
    if(this.status!=='playing')break;
    continue;
   }
   if(s.ability&&e.ability<=0&&gap<s.ability.range){
    e.windup=s.ability.windup;
    this.emit('warning',{x:e.x,kind:e.type});
    if(e.type==='boss')this.say('우박이 쏟아져요! 비막이를 펼쳐 주세요.');
    else if(e.type==='horse')this.say('말이 돌진을 준비해요. 발구름!');
    continue;
   }
   if(gap>s.range){const dx=Math.min(s.speed*dt,gap-s.range,Math.max(0,e.x-(s.stopAt??START-120)));e.x-=dx;e.moving=dx>0?-1:0;e.walk+=dx/s.speed;}
   else if(e.cd<=0){e.cd=s.period;e.action={kind:'enemy',elapsed:0,resolved:false,targetId:target.a?.id??null,dir:Math.sign(target.x-e.x)||-1};}
   if(this.status!=='playing')break;
  }
  this.cleanup();
  if(this.status==='playing'&&this.x>=ROAD&&this.bossDefeated&&this.enemies.every(e=>e.x>ROAD+180))this.finish('won');
 }
}
