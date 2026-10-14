async(page)=>{
 const session=await page.context().newCDPSession(page);await session.send('Network.setCacheDisabled',{cacheDisabled:true});await session.send('Performance.enable');
 let limited=false;
 await page.unrouteAll();
 await page.route('**/app.js?v=57',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__perf={model,getScene:()=>scene};\n'});});
 await page.route('**/game/scene.js?v=57',async route=>{const response=await route.fetch(),body=await response.text();await route.fulfill({response,body:limited?body:body.replace('fps:{target:60,limit:60},','')});});
 const results=[];
 for(const cap of [false,true]){
  limited=cap;await page.goto('http://127.0.0.1:4173/?performance='+String(cap));await page.waitForFunction(()=>window.__perf?.getScene()?.ready);
  await page.locator('#enter-map').click();await page.locator('#stage-0').click();await page.locator('#start').click();
  await page.evaluate(()=>{const {model:m,getScene}=window.__perf;m.start();m.auto=false;m.wave=m.waves.length;m.heroAttack=999;m.x=700;m.furthest=700;m.allies=[];
   for(const type of m.party)for(let i=0;i<10;i++){const a=m.addAlly(type,800);a.cd=999;}
   for(let i=0;i<10;i++){const e=m.spawn('horse',1200+i*12);e.stun=999;}
   window.__renderCount=0;getScene().game.events.on(Phaser.Core.Events.PRE_STEP,()=>window.__renderCount++);
  });
  await page.waitForTimeout(3500);const a=await session.send('Performance.getMetrics'),before=await page.evaluate(()=>({frame:window.__renderCount,time:window.__perf.model.time}));
  await page.waitForTimeout(3000);const b=await session.send('Performance.getMetrics'),after=await page.evaluate(()=>({frame:window.__renderCount,time:window.__perf.model.time,limit:window.__perf.getScene().game.loop.fpsLimit,allies:window.__perf.model.allies.length,enemies:window.__perf.model.enemies.length,heapMB:Math.round(performance.memory.usedJSHeapSize/1048576)}));
  const map=r=>Object.fromEntries(r.metrics.map(x=>[x.name,x.value])),am=map(a),bm=map(b),elapsed=bm.Timestamp-am.Timestamp;results.push({limited:cap,frames:after.frame-before.frame,fps:(after.frame-before.frame)/elapsed,modelSeconds:after.time-before.time,taskCPUSeconds:bm.TaskDuration-am.TaskDuration,scriptCPUSeconds:bm.ScriptDuration-am.ScriptDuration,elapsed,allies:after.allies,enemies:after.enemies,limit:after.limit,heapMB:after.heapMB});
 }
 await page.locator('#pause').click();const paused=await page.evaluate(()=>window.__perf.model.time);await page.waitForTimeout(150);const frozen=(await page.evaluate(()=>window.__perf.model.time))===paused;
 await session.detach();return results;
}
