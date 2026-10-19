import {DEFAULT_PARTY,UNITS,validParty,STAGES,STARTER_PARTY,STAGE_REWARDS} from './data.js?v=169-video-restore';
// Local progression is separate from Journey's capped battle purse. No cash purchases.
export class Campaign {
 constructor(saved={}){
  this.cleared=Array.isArray(saved?.cleared)?[...new Set(saved.cleared.filter(i=>Number.isInteger(i)&&STAGES[i]).map(i=>(saved.routeVersion??1)<2&&i===9?STAGES.length-1:i))]:[];
  this.balance=Number.isSafeInteger(saved?.balance)&&saved.balance>=0?saved.balance:0;
  const legacy=saved?.collectionVersion!==1&&(Array.isArray(saved?.owned)||validParty(saved?.party));
  this.owned=[...new Set([...STARTER_PARTY,...(legacy?DEFAULT_PARTY:[]),...(Array.isArray(saved?.owned)?saved.owned.filter(k=>Object.hasOwn(UNITS,k)):[]),...this.cleared.map(i=>STAGE_REWARDS[i]).filter(Boolean)])];
  const party=Array.isArray(saved?.party)?saved.party.filter(k=>this.owned.includes(k)):[];
  this.party=validParty(party)?[...party]:this.owned.slice(0,5);
  this.run=Number.isSafeInteger(saved?.run)&&saved.run>=0?saved.run:0;
  this.settled=Number.isSafeInteger(saved?.settled)&&saved.settled>=0&&saved.settled<=this.run?saved.settled:this.run;
 }
 begin(){return ++this.run;}
 clear(run,earned,stage){
  if(!Number.isInteger(stage)||!STAGES[stage]||run!==this.run||run<=this.settled||!Number.isFinite(earned)||earned<0)return 0;
  const amount=Math.floor(earned)+50;if(!Number.isSafeInteger(this.balance+amount))return 0;
  this.balance+=amount;this.settled=run;
  if(!this.cleared.includes(stage)){
   this.cleared.push(stage);const kind=STAGE_REWARDS[stage];
   if(kind&&!this.owned.includes(kind)){this.owned.push(kind);if(this.party.length<5)this.party.push(kind);}
  }
  return amount;
 }
 buy(kind){
  const s=UNITS[kind];if(STAGE_REWARDS.includes(kind)||!s||this.owned.includes(kind)||this.balance<s.price)return false;
  this.balance-=s.price;this.owned.push(kind);return true;
 }
 select(party){if(!validParty(party)||party.some(k=>!this.owned.includes(k)))return false;this.party=[...party];return true;}
 snapshot(){return {collectionVersion:1,routeVersion:2,cleared:[...this.cleared],balance:this.balance,owned:[...this.owned],party:[...this.party],run:this.run,settled:this.settled};}
}
