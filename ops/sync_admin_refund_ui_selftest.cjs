// Start tools/sync-admin-ui-mock.mjs first. All requests stay on its local test data.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
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
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
