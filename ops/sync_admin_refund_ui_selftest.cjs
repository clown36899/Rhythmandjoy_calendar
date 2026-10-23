// Start tools/sync-admin-ui-mock.mjs first. All requests stay on its local test data.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
async function waitForFixture(predicate){
 const deadline=Date.now()+10000;
 while(!predicate()){if(Date.now()>deadline)throw new Error('fixture response timed out');await new Promise(r=>setTimeout(r,10));}
}
(async()=>{
require('node:fs').mkdirSync('tmp/refund-check',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 for(const source of ['naver','spacecloud']){
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  await page.clock.setFixedTime(new Date('2026-08-13T03:00:00Z'));
  let sent=null;let release;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('rhythmjoy.syncAdmin.adminToken.v1','ui-test'));
  await page.route('**/api.php**',async route=>{
   const action=new URL(route.request().url()).searchParams.get('action');
   if(action==='cancel_customer_reservation'){
    sent=route.request().postDataJSON();
    await new Promise(r=>{release=r;});
    return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,message:'모의 재시도 오류'})});
   }
   const response=await route.fetch();const data=await response.json();
   if(data.reservations)for(const b of data.reservations) b.source=source;
   await route.fulfill({response,json:data});
  });
  await page.goto('http://127.0.0.1:8765/sync-admin/index.html');
  await page.locator('#activeDate').fill('2026-08-13');await page.locator('#activeDate').dispatchEvent('change');
  await page.locator('.event-block').filter({hasText:'기존 예약'}).first().click();
  await page.locator('#cancelCustomerReservation').click();
  const confirm=page.locator('#confirmEventCancellation');
  assert.equal(await confirm.isDisabled(),true);
  await page.locator('#eventCancellationRefundMode').selectOption('none');
  assert.match(await page.locator('#eventCancellationRefundSummary').innerText(),/환불 0원 · 위약금 100,000원/);
  assert.equal(await confirm.isEnabled(),true);
  if(source==='naver'){
   await page.locator('#eventCancellationRefundMode').selectOption('custom');
   assert.equal(await confirm.isDisabled(),true);
   await page.locator('#eventCancellationRefundAmount').fill('100001');assert.equal(await confirm.isDisabled(),true);
   await page.locator('#eventCancellationRefundAmount').fill('25000');assert.equal(await confirm.isEnabled(),true);
   assert.match(await page.locator('#eventCancellationRefundSummary').innerText(),/환불 25,000원 · 위약금 75,000원/);
  }else assert.equal(await page.locator('#eventCancellationRefundMode option[value="custom"]').isDisabled(),true);
  await confirm.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('#eventCancellationRefund').evaluate(e=>e.draggable),false);
  await page.screenshot({path:`tmp/refund-check/${source}-mobile.png`});
  await confirm.click();
  await page.waitForFunction(()=>document.querySelector('#eventCancellationRefund').disabled);
  assert.equal(await page.locator('#eventCancellationRefundMode').isDisabled(),true);
  release();
  await page.waitForFunction(()=>!document.querySelector('#eventCancellationRefund').disabled);
  assert.deepEqual(sent.refundMode,source==='naver'?'custom':'none');
  if(source==='naver')assert.equal(sent.refundAmount,25000);
  assert.equal(await confirm.isEnabled(),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({source,ui:'passed',sent}));
  await page.close();
 }
 const operationKey='rhythmjoy.syncAdmin.reservationOperation.v1';
 for(const scenario of ['naver-recovered','spacecloud-recovered','failed-read-retry','dismiss-during-read','replace-during-read']){
  const source=scenario==='spacecloud-recovered'?'spacecloud':'naver';
  const sourceType=source==='naver'?'naver_cancel':'spacecloud_cancel';
  const mirrorType=source==='naver'?'delete':'naver_restore';
  const cached={entityType:'customer-ledger',reservationId:77,ledgerId:77,rootTaskId:900,sourcePlatform:source,
   operationType:'customer-cancellation',date:'2026-08-13',room:'A',start:15,end:17,name:'복구 검사',
   reservationStatus:'confirmed',updatedAt:'2026-08-12T11:33:00+09:00',
   tasks:[{id:'live-900',liveTaskId:900,reservationId:77,taskType:sourceType,status:'needs_review',error:'과거 실패 기록',start:15,end:17}]};
  const completed={...cached,reservationStatus:'canceled',updatedAt:'2026-08-13T12:00:00+09:00',
   tasks:[{...cached.tasks[0],status:'done',error:''},{...cached.tasks[0],id:'live-901',liveTaskId:901,taskType:mirrorType,status:'done',error:''}]};
  const replacement={...cached,reservationId:78,ledgerId:78,rootTaskId:902,name:'새 취소 작업',
   tasks:[{...cached.tasks[0],id:'live-902',liveTaskId:902,reservationId:78,status:'pending',error:''}]};
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.clock.install({time:new Date('2026-08-13T03:00:00Z')});
  await page.clock.pauseAt(new Date('2026-08-13T03:00:01Z'));
  let queries=0;let release;let replace=false;let responseHandled=false;const writes=[];const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({key,cached})=>{localStorage.setItem('rhythmjoy.syncAdmin.adminToken.v1','ui-test');localStorage.setItem(key,JSON.stringify(cached));},{key:operationKey,cached});
  await page.route('**/api.php**',async route=>{
   const action=new URL(route.request().url()).searchParams.get('action');
   if(action==='customer_cancellation_status'){
    queries++;assert.deepEqual(route.request().postDataJSON(),{action,ledgerId:77,taskId:900});
    if(scenario==='failed-read-retry'&&queries===1)return route.fulfill({status:503,json:{ok:false,message:'일시 조회 장애'}});
    if(scenario.includes('during-read'))await new Promise(r=>{release=r;});
    await route.fulfill({json:{ok:true,customerCancellationOperation:completed}});responseHandled=true;return;
   }
   if(!['bootstrap','alerts','month_summary'].includes(action))writes.push(action);
   const response=await route.fetch();const data=await response.json();
   if(action==='bootstrap'){
    data.activePanelOperation=replace?replacement:null;
    // A general admin task with the same numeric id must not certify this customer cancellation.
    data.tasks=['upload','naver_block'].map((taskType,i)=>({id:800+i,reservationId:77,taskType,status:'done',date:'2026-08-13',room:'A',startHour:15,endHour:17}));
   }
   await route.fulfill({response,json:data});
  });
  await page.goto('http://127.0.0.1:8765/sync-admin/index.html');
  if(scenario==='failed-read-retry'){
   await page.locator('#reservationOperation .reservation-operation-poll-error').waitFor();
   assert.equal(await page.locator('#reservationOperation.attention').count(),1);
   assert.match(await page.locator('#reservationOperation').innerText(),/과거 실패 기록/);
   await page.clock.runFor(60000);
  }else if(scenario.includes('during-read')){
   await page.waitForFunction(()=>document.querySelector('#reservationOperation [data-operation-refresh]'));
   await waitForFixture(()=>release);
   if(scenario==='dismiss-during-read')await page.locator('[data-operation-dismiss]').click();
   else {
    replace=true;
    await page.locator('#activeDate').fill('2026-08-14');await page.locator('#activeDate').dispatchEvent('change');
    await page.waitForFunction(()=>document.querySelector('#reservationOperation').innerText.includes('#78'));
   }
   release();
   await waitForFixture(()=>responseHandled);
   await page.clock.runFor(100);
   if(scenario==='dismiss-during-read'){
    assert.equal(await page.locator('#reservationOperation').isHidden(),true);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),operationKey),null);
   }else assert.match(await page.locator('#reservationOperation').innerText(),/#78/);
  }
  if(!scenario.includes('during-read')){
   await page.locator('#reservationOperation.done').waitFor();
   const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),operationKey);
   assert.equal(saved.reservationStatus,'canceled');assert.ok(saved.tasks.every(t=>t.status==='done'));
   assert.doesNotMatch(await page.locator('#reservationOperation').innerText(),/과거 실패 기록/);
   assert.equal(queries,scenario==='failed-read-retry'?2:1);
  }
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({scenario,result:'passed',statusReads:queries,mutationRequests:writes.length}));
  await page.close();
 }
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
