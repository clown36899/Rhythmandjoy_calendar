import {DEFAULT_PARTY,UNITS,validParty,TEST_MODE,STAGES} from './data.js?v=40';
// Local progression is separate from Journey's capped battle purse. No cash purchases.
export class Campaign {
 constructor(saved={}){
  this.cleared=Array.isArray(saved?.cleared)?[...new Set(saved.cleared.filter(i=>Number.isInteger(i)&&STAGES[i]))]:[];
  this.balance=Number.isSafeInteger(saved?.balance)&&saved.balance>=0?saved.balance:0;
  this.owned=[...new Set([...DEFAULT_PARTY,...(Array.isArray(saved?.owned)?saved.owned.filter(k=>Object.hasOwn(UNITS,k)):[])])];
  this.party=validParty(saved?.party)&&(TEST_MODE||saved.party.every(k=>this.owned.includes(k)))?[...saved.party]:[...DEFAULT_PARTY];
  this.run=Number.isSafeInteger(saved?.run)&&saved.run>=0?saved.run:0;
  this.settled=Number.isSafeInteger(saved?.settled)&&saved.settled>=0&&saved.settled<=this.run?saved.settled:this.run;
 }
 begin(){return ++this.run;}
 clear(run,earned,stage){
  if(!Number.isInteger(stage)||!STAGES[stage]||run!==this.run||run<=this.settled||!Number.isFinite(earned)||earned<0)return 0;
  const amount=Math.floor(earned)+50;if(!Number.isSafeInteger(this.balance+amount))return 0;
  this.balance+=amount;this.settled=run;if(!this.cleared.includes(stage))this.cleared.push(stage);return amount;
 }
 buy(kind){
  const s=UNITS[kind];if(!s||this.owned.includes(kind)||this.balance<s.price)return false;
  this.balance-=s.price;this.owned.push(kind);return true;
 }
 select(party){if(!validParty(party)||(!TEST_MODE&&party.some(k=>!this.owned.includes(k))))return false;this.party=[...party];return true;}
 snapshot(){return {cleared:[...this.cleared],balance:this.balance,owned:[...this.owned],party:[...this.party],run:this.run,settled:this.settled};}
}
