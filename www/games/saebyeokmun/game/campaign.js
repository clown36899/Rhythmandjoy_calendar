import {DEFAULT_PARTY,UNITS,validParty,STAGES,STARTER_PARTY,STAGE_REWARDS} from './data.js?v=226';
export const CARD_FRAGMENT_GOAL=5,CARD_CATALOG_SIZE=1000;
export const companionCardId=kind=>'U-'+kind;
export const cardUnit=id=>typeof id==='string'&&id.startsWith('U-')&&Object.hasOwn(UNITS,id.slice(2))?id.slice(2):null;
const validCard=id=>!!cardUnit(id)||typeof id==='string'&&/^C\d{4}$/.test(id)&&Number(id.slice(1))>=1&&Number(id.slice(1))<=CARD_CATALOG_SIZE;
const INITIAL_COMPANIONS=['cow','healer'];
// Local progression is separate from Journey's capped battle purse. No cash purchases.
export class Campaign {
 constructor(saved={}){
  this.cleared=Array.isArray(saved?.cleared)?[...new Set(saved.cleared.filter(i=>Number.isInteger(i)&&STAGES[i]).map(i=>(saved.routeVersion??1)<2&&i===9?STAGES.length-1:i))]:[];
  this.balance=Number.isSafeInteger(saved?.balance)&&saved.balance>=0?saved.balance:0;
  const legacy=saved?.collectionVersion!==1&&(Array.isArray(saved?.owned)||validParty(saved?.party));
  // Existing playtest saves keep their access; a new journey earns companions by puzzle.
  const existing=saved&&Object.keys(saved).some(k=>k!=='cleared'||saved.cleared?.length);
  this.owned=[...new Set([...INITIAL_COMPANIONS,...(existing&&saved?.puzzleVersion!==1?STARTER_PARTY:[]),...(legacy?DEFAULT_PARTY:[]),...(Array.isArray(saved?.owned)?saved.owned.filter(k=>Object.hasOwn(UNITS,k)):[])])];
  const party=Array.isArray(saved?.party)?saved.party.filter(k=>this.owned.includes(k)):[];
  this.party=validParty(party)?[...party]:this.owned.slice(0,5);
  this.run=Number.isSafeInteger(saved?.run)&&saved.run>=0?saved.run:0;
  this.settled=Number.isSafeInteger(saved?.settled)&&saved.settled>=0&&saved.settled<=this.run?saved.settled:this.run;
  // Historical paintings remain separate; only explicit U-* companion cards unlock units.
  this.cards={owned:[...new Set((Array.isArray(saved?.cards?.owned)?saved.cards.owned:[]).filter(validCard))],fragments:Object.fromEntries(Object.entries(saved?.cards?.fragments&&typeof saved.cards.fragments==='object'&&!Array.isArray(saved.cards.fragments)?saved.cards.fragments:{}).filter(([id,n])=>validCard(id)&&Number.isSafeInteger(n)&&n>=0))};
  for(const id of this.cards.owned){const kind=cardUnit(id);if(kind&&!this.owned.includes(kind))this.owned.push(kind);}
  this.fragmentCheckpoint=Number.isInteger(saved?.fragmentCheckpoint)&&saved.fragmentCheckpoint>=0&&saved.fragmentCheckpoint<=5?saved.fragmentCheckpoint:0;
 }
 begin(){this.fragmentCheckpoint=0;return ++this.run;}
 collectBattleFragments(run,kills,stage){
  if(run!==this.run||run<=this.settled||!STAGES[stage]||!Number.isSafeInteger(kills)||kills<0)return [];
  const checkpoint=Math.min(5,Math.floor(kills/8)),awards=[];
  const pool=[...STAGE_REWARDS.slice(stage%STAGE_REWARDS.length),...STAGE_REWARDS.slice(0,stage%STAGE_REWARDS.length)];
  while(this.fragmentCheckpoint<checkpoint){
   const kind=pool.find(k=>!this.owned.includes(k)&&!this.cardState(companionCardId(k)).ready)
    ||pool.find(k=>!this.cardState(companionCardId(k)).owned&&!this.cardState(companionCardId(k)).ready);
   this.fragmentCheckpoint++;if(!kind)continue;
   const id=companionCardId(kind);this.addCardFragments(id,1);awards.push({id,kind,fragments:this.cardState(id).fragments});
  }
  return awards;
 }
 clear(run,earned,stage){
  if(!Number.isInteger(stage)||!STAGES[stage]||run!==this.run||run<=this.settled||!Number.isFinite(earned)||earned<0)return 0;
  const amount=Math.floor(earned)+50;if(!Number.isSafeInteger(this.balance+amount))return 0;
  this.balance+=amount;this.settled=run;
  if(!this.cleared.includes(stage)){
   this.cleared.push(stage);
  }
  return amount;
 }
 buy(kind){
  const s=UNITS[kind];if(STAGE_REWARDS.includes(kind)||!s||this.owned.includes(kind)||this.balance<s.price)return false;
  this.balance-=s.price;this.owned.push(kind);return true;
 }
 select(party){if(!validParty(party)||party.some(k=>!this.owned.includes(k)))return false;this.party=[...party];return true;}
 cardState(id){const fragments=this.cards.fragments[id]||0,owned=this.cards.owned.includes(id);return {fragments,goal:CARD_FRAGMENT_GOAL,owned,ready:validCard(id)&&!owned&&fragments>=CARD_FRAGMENT_GOAL};}
 addCardFragments(id,amount){if(!validCard(id)||!Number.isSafeInteger(amount)||amount<=0||!Number.isSafeInteger((this.cards.fragments[id]||0)+amount))return false;this.cards.fragments[id]=(this.cards.fragments[id]||0)+amount;return true;}
 claimCard(id,placement){
  if(!this.cardState(id).ready)return false;
  const kind=cardUnit(id);
  if(kind&&(!Array.isArray(placement)||placement.length!==5||placement.some((v,i)=>v!==i)))return false;
  this.cards.fragments[id]-=CARD_FRAGMENT_GOAL;this.cards.owned.push(id);
  if(kind&&!this.owned.includes(kind))this.owned.push(kind);
  return true;
 }
 snapshot(){return {collectionVersion:1,puzzleVersion:1,routeVersion:2,cleared:[...this.cleared],balance:this.balance,owned:[...this.owned],party:[...this.party],run:this.run,settled:this.settled,fragmentCheckpoint:this.fragmentCheckpoint,cards:{owned:[...this.cards.owned],fragments:{...this.cards.fragments}}};}
}
