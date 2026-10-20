import {DEFAULT_PARTY,UNITS,STAGES,isBoss} from './data.js?v=218-integrated';

// A disposable observer session: decisions call the ordinary combat API.
// The app owns stage entry and saved rewards; this owner never writes a save.
export class Autoplay {
 constructor(model){this.model=model;this.stop();}
 stop(){this.active=false;this.paused=false;this.complete=false;this.rate=1;this.elapsed=0;this.clears=[];this.wait=null;this.nextOrder=0;this.model.invincible=false;}
 begin(){this.stop();this.active=true;return 0;}
 enter(){this.model.invincible=true;this.wait=null;this.nextOrder=0;}
 setRate(rate){if([1,2,4,8].includes(Number(rate)))this.rate=Number(rate);}
 update(dt,blocked=false){
  const m=this.model;if(!this.active||this.complete||this.paused||blocked||m.status==='paused')return null;
  this.elapsed+=Math.max(0,Math.min(dt,.25));
  if(m.status==='won'){
   if(this.wait===null){this.clears.push({stage:m.stage,time:m.time,kills:m.kills});this.wait=1.2;}
   else this.wait-=Math.max(0,Math.min(dt,.25));
   if(this.wait>0)return null;
   if(m.stage===STAGES.length-1){this.complete=true;m.invincible=false;return null;}
   return m.stage+1;
  }
  if(m.status!=='playing')return null;
  m.auto=true;m.direction=0;
  if(m.time<this.nextOrder)return null;this.nextOrder=m.time+.6;
  // The same normal-action policy already used to verify the short chapters.
  if(m.countAllies('cow')<3)m.summon('cow');
  else for(const type of DEFAULT_PARTY.filter(k=>k!=='cow'))if(!m.atSummonLimit(type)&&m.coins>=UNITS[type].cost&&m.cooldowns[type]===0){m.summon(type);break;}
  if(m.enemies.some(e=>isBoss(e.type)&&e.windup>0))m.skill('shelter');
  if(m.enemies.some(e=>e.hp>0&&Math.abs(e.x-m.x)<370))m.skill('stomp');
  if(m.coins>35)m.skill('charm');
  return null;
 }
}
