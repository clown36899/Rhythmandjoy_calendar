// Run with NODE_PATH pointing to an installed Playwright runtime and a read-only
// aggregate snapshot: VISITOR_HISTORY_FIXTURE=/path/to/db-history.json node ...
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../www');
const out = path.resolve(__dirname, '../output/visitor-stats-20261008');
const histories = JSON.parse(fs.readFileSync(process.env.VISITOR_HISTORY_FIXTURE || path.join(out, 'db-history.json')));
const stats = histories['30'].stats;
let requests = [], fail = false, race = false, empty = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.endsWith('/visitor-stats.php')) {
    const action = url.searchParams.get('action'), days = url.searchParams.get('days') || '30';
    requests.push({ action, days, method:req.method });
    if (fail && action === 'history') { res.writeHead(503); res.end('{}'); return; }
    let history = structuredClone(histories[days]);
    if (empty) {
      history.stats = { ...stats, today:0, total:0, collectionStartedOn:null };
      history.visitors = history.pageViews = 0;
      history.daily.forEach(row => { row.visitors = row.pageViews = null; });
    }
    const payload = action === 'history' ? { ok:true, history } : { ok:true, eligible:false, stats };
    const send = () => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(payload)); };
    if (race && days === '90') setTimeout(send, 250); else send();
    return;
  }
  let relative = decodeURIComponent(url.pathname);
  if (!relative.startsWith('/calendar_set/')) relative = '/calendar_set/calendar_v10/site' + relative;
  if (relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(root, '.' + relative);
  if (!file.startsWith(root + '/') || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png'}[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, {'Content-Type':type}); fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  let checks = 0;
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors=[];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      await page.goto(base, {waitUntil:'networkidle'});
      await page.locator('#visitor-open [data-visitor-total]').getByText(stats.total.toLocaleString('ko-KR'), {exact:true}).waitFor();
      assert.equal(await page.locator('#visitor-open [data-visitor-today]').innerText(), stats.today.toLocaleString('ko-KR')); checks++;
      await page.locator('#visitor-open').scrollIntoViewIfNeeded();
      await page.locator('img').evaluateAll(images => Promise.all(images.filter(img => {
        const rect = img.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight;
      }).map(img => img.decode().catch(() => {}))));
      await page.screenshot({path:path.join(out, 'counter-' + width + '.png')});
      const before = requests.length;
      await page.locator('#visitor-open').click();
      await page.locator('#visitor-report:not([hidden])').waitFor();
      assert.equal(await page.locator('#visitor-daily-rows tr').count(), 30);
      assert.equal(await page.locator('dialog[open]').count(), 1);
      assert.equal(await page.locator('#visitor-period-summary').innerText(), `기간 내 방문자 ${histories['30'].visitors.toLocaleString('ko-KR')} · 조회 수 ${histories['30'].pageViews.toLocaleString('ko-KR')} (오늘 포함)`); checks++;
      await page.screenshot({path:path.join(out, 'dialog-' + width + '.png')});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#visitor-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true); checks++;
      const initialURL = page.url();
      await page.locator('#visitor-chart').dispatchEvent('pointerdown',{clientX:250,clientY:550,button:0,pointerId:9,isPrimary:true,pointerType:'touch'});
      await page.locator('#visitor-chart').dispatchEvent('pointermove',{clientX:70,clientY:550,button:0,pointerId:9,isPrimary:true,pointerType:'touch'});
      await page.locator('#visitor-chart').dispatchEvent('pointerup',{clientX:70,clientY:550,button:0,pointerId:9,isPrimary:true,pointerType:'touch'});
      assert.equal(page.url(), initialURL); checks++;
      race = true;
      await page.locator('[data-visitor-days="90"]').click();
      await page.locator('[data-visitor-days="7"]').click();
      await page.locator('#visitor-range').getByText('최근 7일 · 일별 방문자',{exact:true}).waitFor();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#visitor-daily-rows tr').count(),7); checks++;
      race = false;
      await page.locator('.visitor-daily summary').click();
      assert.equal(await page.locator('.visitor-daily').getAttribute('open'), ''); checks++;
      fail = true;
      await page.locator('#visitor-refresh').click();
      await page.locator('#visitor-status').getByText('통계를 불러오지 못했습니다. 잠시 후 새로고침을 눌러주세요.',{exact:true}).waitFor();
      assert.equal(await page.locator('#visitor-report').isHidden(),true);
      fail = false;
      await page.locator('#visitor-refresh').click();
      await page.locator('#visitor-report:not([hidden])').waitFor(); checks++;
      empty = true;
      await page.locator('#visitor-refresh').click();
      await page.locator('#visitor-status').getByText('선택한 기간에 집계된 방문 기록이 없습니다.',{exact:true}).waitFor();
      assert.equal(await page.locator('#visitor-collection').innerText(),'아직 집계된 방문 기록이 없습니다.'); checks++;
      empty = false;
      await page.locator('#visitor-refresh').click();
      await page.locator('#visitor-report:not([hidden])').waitFor();
      assert.equal(requests.slice(before).every(r => r.method === 'GET' && r.action === 'history'),true); checks++;
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(),0);
      assert.equal(await page.evaluate(() => document.activeElement.id),'visitor-open'); checks++;
      // The persistent UI survives the site's actual soft navigation and cache reuse.
      await page.locator('.header .nav a[href="/pricing/"]').click();
      await page.waitForURL(base + '/pricing/');
      assert.equal(await page.locator('#visitor-open').count(),1);
      await page.locator('#visitor-open').click();
      await page.locator('#visitor-report:not([hidden])').waitFor();
      assert.equal(await page.locator('#visitor-dialog').count(),1);
      await page.locator('.visitor-close').click(); checks++;
      assert.deepEqual(errors,[]); checks++;
      await page.close();
    }
    console.log('PASS: ' + checks + ' visitor UI checks (real aggregate snapshot, mobile/desktop, periods/race, error/retry, empty, read-only, gestures, focus, soft navigation).');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
