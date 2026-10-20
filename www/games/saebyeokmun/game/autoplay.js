import {UNITS,STAGES,isBoss} from './data.js?v=226';

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
  // Use the actual party (or tour roster), filling underrepresented kinds first.
  // Journey still owns eligibility, currency, limits, cooldowns and the summon.
  const candidates=m.summonTypes.filter(type=>UNITS[type]&&!m.atSummonLimit(type)&&m.cooldowns[type]<=0);
  candidates.sort((a,b)=>m.countAllies(a)-m.countAllies(b));
  const type=candidates[0];
  // Save for the next missing kind instead of endlessly spending on cheaper repeats.
  if(type&&m.coins>=UNITS[type].cost)m.summon(type);
  if(!m.shield&&m.action?.kind!=='umbrella'&&m.enemies.some(e=>isBoss(e.type)&&e.windup>0))m.skill('shelter');
  if(m.enemies.some(e=>e.hp>0&&Math.abs(e.x-m.x)<370))m.skill('stomp');
  if(m.mana>35)m.skill('charm');
  return null;
 }
}
