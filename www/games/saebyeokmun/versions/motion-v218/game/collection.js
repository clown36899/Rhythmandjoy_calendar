// Album presentation only. Campaign owns fragments, claims, parties and saved progress.
import {CARD_FRAGMENT_GOAL} from "./campaign.js?v=218-integrated";
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g,'');
export function collectionPage(candidates,{query='',category='',era='',page=0,pageSize=30,status='',stateFor=()=>({fragments:0,owned:false})}={}){
 const terms=String(query).trim().split(/\s+/).filter(Boolean).map(normalize);
 const matches=candidates.filter(c=>(status!=='collecting'||(!stateFor(c.id).owned&&stateFor(c.id).fragments>0))&&(status!=='owned'||stateFor(c.id).owned)&&(!category||(category==='인물'?c.category.endsWith('인물'):c.category===category))&&(!era||c.countryEra.includes(era))&&terms.every(term=>normalize([c.id,c.name,c.baseName,c.displayName,...(c.aliases||[]),c.classification,c.countryEra].join(' ')).includes(term)));
 const pages=Math.max(1,Math.ceil(matches.length/pageSize)),current=Math.max(0,Math.min(pages-1,Number.isFinite(page)?Math.floor(page):0));
 return {total:matches.length,pages,page:current,items:matches.slice(current*pageSize,(current+1)*pageSize)};
}
export function collectionArt(c,sheets){
 const sheet=sheets.find(s=>s.sheet===c.sheet);
 if(!sheet||!/^\.\/assets\/collection-sheet-\d{2}-v155\.png$/.test(sheet.url))throw new Error('Unknown collection sheet');
 const rect=sheet.cells.find(r=>r.cell===c.cell);
 if(!rect)throw new Error('Unknown collection cell');
 return `background-image:url('${sheet.url}');background-size:${sheet.width/rect.width*100}% ${sheet.height/rect.height*100}%;background-position:${rect.x/(sheet.width-rect.width)*100}% ${rect.y/(sheet.height-rect.height)*100}%;--sheet-aspect:${rect.width/rect.height}`;
}
const sourceLink=source=>{
 let url;try{url=new URL(source.url);if(url.protocol!=='https:')return '';}catch{return '';}
 return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" draggable="false">${esc(source.title)} <span aria-hidden="true">↗</span></a>`;
};
export function fragmentSlots(state){
 const filled=state.owned?CARD_FRAGMENT_GOAL:Math.min(CARD_FRAGMENT_GOAL,state.fragments);
 return `<span class="fragment-slots" role="img" aria-label="${state.owned?'확보 완료':`조각 ${state.fragments}/${CARD_FRAGMENT_GOAL}`}" data-ready="${!!state.ready}">${Array.from({length:CARD_FRAGMENT_GOAL},(_,i)=>`<i data-filled="${i<filled}" aria-hidden="true"></i>`).join('')}</span>`;
}
export function mountCollection(doc,{load=()=>import('./collection-catalog.js?v=218-integrated').then(m=>m.default),stateFor=()=>({fragments:0,owned:false,ready:false}),claim=()=>false}={}){
 const $=id=>doc.getElementById(id),panel=$('codex-collection'),grid=$('collection-grid');
 const pageSize=12,search=$('collection-search'),category=$('collection-category'),era=$('collection-era');
 let catalog=null,pending=null,page=0,selected=null,status='',claiming=false;
 function story(open){$('collection-story').hidden=!open;$('collection-front').hidden=open;if(open)$('collection-reading').focus();}
 function selectedCard(){
  const c=catalog?.candidates.find(c=>c.id===selected);if(!c)return;
  const s=stateFor(c.id);$('collection-detail').dataset.state=s.owned?'owned':s.ready?'ready':s.fragments?'collecting':'empty';
  $('collection-picture').setAttribute('style',collectionArt(c,catalog.sheets));$('collection-picture').setAttribute('aria-label',c.baseName+' 원화');
  $('collection-name').textContent=c.baseName;$('collection-name').dataset.long=String([...c.baseName].length>5);
  $('collection-turn').setAttribute('aria-label',c.displayName+' 이야기 보기');
  $('collection-identity').textContent=c.displayName;$('collection-meta').textContent=`${c.countryEra} · ${c.classification}`;
  $('collection-description').textContent=c.summary;$('collection-record').textContent=c.record;
  $('collection-interpretation').textContent=c.artBrief;$('collection-research').textContent=c.researchStatus;
  $('collection-sources').innerHTML=c.sources.map(sourceLink).join('');
  $('collection-pieces').innerHTML=fragmentSlots(s);
  $('collection-fragment-count').textContent=s.owned?'확보 완료':`조각 ${s.fragments}/${CARD_FRAGMENT_GOAL}`;
  $('collection-claim').disabled=claiming||!s.ready;$('collection-claim').textContent=s.owned?'확보 완료':s.ready?'캐릭터 확보':'조각 모으는 중';
  $('collection-stamp').hidden=!s.owned;
 }
 function render(){
  if(!catalog)return;
  const result=collectionPage(catalog.candidates,{query:search.value,category:category.value,era:era.value,page,pageSize,status,stateFor});page=result.page;
  if(!selected)selected='C0014';
  grid.innerHTML=result.items.map(c=>{const s=stateFor(c.id);return `<button class="collection-card" data-card="${c.id}" data-state="${s.owned?'owned':s.ready?'ready':s.fragments?'collecting':'empty'}" aria-label="${esc(c.displayName)} · ${s.owned?'확보':`조각 ${s.fragments}/${CARD_FRAGMENT_GOAL}`}" aria-pressed="${c.id===selected}" draggable="false"><span class="collection-card-face"><span class="collection-art" role="img" aria-label="${esc(c.baseName)} 원화" style="${collectionArt(c,catalog.sheets)}"><i aria-hidden="true"></i></span><strong data-long="${[...c.baseName].length>5}">${esc(c.baseName)}</strong>${s.owned?'<span class="card-owned-seal" aria-hidden="true">확보</span>':''}</span><span class="collection-card-foot">${fragmentSlots(s)}<small>${s.owned?'확보':`조각 ${s.fragments}/${CARD_FRAGMENT_GOAL}`}</small></span></button>`;}).join('');
  $('collection-empty').hidden=result.total!==0;
  $('collection-count').textContent=result.total?`${page*pageSize+1}–${page*pageSize+result.items.length} / ${result.total.toLocaleString('ko-KR')}장`:'찾는 카드가 없습니다';
  $('collection-page').textContent=`${page+1} / ${result.pages}`;
  $('collection-total').textContent=`${catalog.candidates.filter(c=>stateFor(c.id).owned).length} / ${catalog.total.toLocaleString('ko-KR')}`;
  $('collection-prev').disabled=page===0;$('collection-next').disabled=page===result.pages-1;
  for(const key of ['all','collecting','owned'])$('collection-filter-'+key).setAttribute('aria-pressed',String(status===(key==='all'?'':key)));
  selectedCard();
 }
 function select(id){if(!catalog?.candidates.some(c=>c.id===id))return;selected=id;$('collection-detail').dataset.claimed='false';$('collection-message').textContent='';story(false);render();}
 async function open(){
  if(catalog){render();return;}
  if(pending)return pending;
  $('collection-status').hidden=false;$('collection-status').textContent='인연첩을 펼치는 중…';$('collection-retry').hidden=true;
  panel.setAttribute('aria-busy','true');
  pending=(async()=>{try{
   catalog=await load();render();$('collection-status').hidden=true;
  }catch{
   catalog=null;$('collection-status').textContent='인연첩을 불러오지 못했습니다.';$('collection-retry').hidden=false;
  }finally{pending=null;panel.setAttribute('aria-busy','false');}})();return pending;
 }
 for(const node of [search,category,era])node.addEventListener(node===search?'input':'change',()=>{page=0;render();});
 for(const key of ['all','collecting','owned'])$('collection-filter-'+key).addEventListener('click',()=>{status=key==='all'?'':key;page=0;render();});
 $('collection-prev').addEventListener('click',()=>{page--;render();});$('collection-next').addEventListener('click',()=>{page++;render();});
 $('collection-reset').addEventListener('click',()=>{search.value='';category.value='';era.value='';status='';page=0;render();});
 $('collection-turn').addEventListener('click',()=>story(true));$('collection-back').addEventListener('click',()=>{story(false);$('collection-turn').focus();});
 $('collection-retry').addEventListener('click',open);
 grid.addEventListener('click',event=>{const button=event.target.closest('[data-card]');if(button&&grid.contains(button))select(button.dataset.card);});
 $('collection-claim').addEventListener('click',async()=>{
  if(claiming||!selected||!stateFor(selected).ready)return;
  const id=selected;claiming=true;$('collection-message').textContent='';selectedCard();
  try{const ok=await claim(id);if(ok){render();if(id===selected)$('collection-detail').dataset.claimed='true';$('collection-message').textContent='새로운 인연을 맺었습니다.';}
   else $('collection-message').textContent='확보 내용을 저장하지 못했습니다. 다시 시도해 주세요.';
  }catch{$('collection-message').textContent='확보 내용을 저장하지 못했습니다. 다시 시도해 주세요.';}
  finally{claiming=false;selectedCard();}
 });
 panel.addEventListener('dragstart',event=>event.preventDefault());
 return {open};
}
