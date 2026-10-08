const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../www/calendar_set/calendar_v10/site-preview');
const source = fs.readFileSync(path.join(root, 'site.js'), 'utf8');
const routes = ['', 'spaces', 'pricing', 'location', 'guide', 'schedule'];
let checks = 0;
const ready = () => new Promise(resolve => setImmediate(resolve));
const structuredText = html => html.match(/<script id="site-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] || '[]';
const metaElements = html => Object.fromEntries([...html.matchAll(/<meta (name|property)="([^"]+)" content="([^"]*)"/g)].map(([, attr, key, content]) => [`meta[${attr}="${key}"]`, {content}]));

function element() {
  const classes = new Set(), attrs = new Map();
  return {
    setPointerCapture(id) { this.captured = id; }, hasPointerCapture(id) { return this.captured === id; }, releasePointerCapture() { this.captured = null; },
    style: {}, dataset: {}, inert: false, removed: false,
    classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x) },
    querySelectorAll: () => [], querySelector: () => null, closest: () => null, focus() {},
    setAttribute(k, v) { attrs.set(k, v); }, getAttribute: k => attrs.get(k),
    removeAttribute(k) { attrs.delete(k); }, hasAttribute: k => attrs.has(k),
    remove() { this.removed = true; }, cloneNode: () => element(),
  };
}
function page(route, options = {}) {
  const contentRoot = options.public ? path.resolve(root, '../site') : root;
  const base = options.public ? 'http://localhost/' : 'http://localhost/calendar_set/calendar_v10/site-preview/';
  const html = fs.readFileSync(path.join(contentRoot, route, 'index.html'), 'utf8');
  const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)[1];
  const links = [...header.matchAll(/<a\b([^>]*)>/g)].filter(([, a]) => !a.includes('aria-label='))
    .map(([, a]) => Object.assign(element(), { href: new URL(a.match(/href="([^"]+)"/)[1], base).href, getAttribute: key => key === 'aria-current' && a.includes('aria-current=page') ? 'page' : null }));
  const listeners = new Map(), windows = new Map(), timers = new Map(), navigated = [];
  const surface = element(), viewport = element(), body = {};
  const fetched = [], decoded = [];
  const structured = options.public ? { textContent: structuredText(html) } : null;
  const metas = metaElements(html);
  const location = { href: base + (route ? route + "/" : ""), assign: url => navigated.push(url) };
  const history = { state: {}, replaceState(state) { this.state = state; }, pushState(state, _, url) { this.state = state; location.href = url; navigated.push(url); } };
  let neighbor, timerId = 0, fetchFails = options.fetchFails;
  viewport.append = e => { neighbor = e; };
  const target = { closest: () => null, parentElement: body, scrollWidth: 100, clientWidth: 100 };
  const document = {
    body, title: route, importNode: node => node, querySelectorAll: () => links,
    querySelector: s => s === '.page-surface' ? surface : s === '.page-viewport' ? viewport : s === '#site-structured-data' ? structured : metas[s] || null,
    addEventListener: (name, cb) => listeners.set(name, [...(listeners.get(name) || []), cb]),
  };
  vm.runInNewContext(source, {
    document, PointerEvent: options.modern ? function PointerEvent() {} : undefined, innerWidth: 390, scrollY: 0, AbortController, URL, history, clearInterval, navigator: {connection:{saveData:!!options.saveData}},
    matchMedia: () => ({ matches: !!options.reduced }),
    window: { scrollTo: o => { viewport.scrolledTo = o.top; }, addEventListener: (name, cb) => windows.set(name, cb) },
    getComputedStyle: e => ({ overflowX: e.overflowX || 'visible' }),
    location,
    fetch: async url => { fetched.push(url); if (fetchFails) throw new Error('offline'); return { ok: true, text: async () => url }; },
    DOMParser: class { parseFromString(url) {
      const route = new URL(url).pathname.replace(new URL(base).pathname, '').replace(/\/$/, '');
      const html = fs.readFileSync(path.join(contentRoot, route, 'index.html'), 'utf8');
      const parsedMetas = metaElements(html);
      const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)[1];
      const active = [...header.matchAll(/<a\b([^>]*)>/g)].find(([, a]) => a.includes('aria-current=page'));
      const node = element();
      const imgs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map(([, src]) => ({ loading: 'lazy', decode: async () => { decoded.push(src); } }));
      node.querySelectorAll = s => s === 'img' ? imgs : [];
      return { title: route, querySelector: s => s === '.page-surface' ? node : s === '#site-structured-data' ? {textContent:structuredText(html)} : s.startsWith('.header') && active ? {href:new URL(active[1].match(/href="([^"]+)"/)[1],base).href} : parsedMetas[s] || null };
    } },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const point = (x, y = 300, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  function fire(type, x = 220, y = 300, extra = {}) {
    const touch = point(x, y);
    const e = {
      type, target, cancelable: true, timeStamp: type.endsWith('start') || type === 'pointerdown' ? 0 : 200,
      ...touch, pointerType: 'mouse', pointerId: 1, button: 0,
      touches: type === 'touchend' ? [] : [touch], changedTouches: [touch],
      prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra,
    };
    for (const cb of listeners.get(type) || []) { cb(e); if (e.stopped) break; } return e;
  }
  async function settle() {
    for (const [id, timer] of [...timers]) if (timer.ms < 1000) { timers.delete(id); timer.fn(); }
    await ready();
  }
  return { links, fetched, decoded, location, history, navigated, surface, viewport, windows, target, point, fire, settle, structured, metas,
    neighbor: () => neighbor, allowFetch: () => { fetchFails = false; } };
}
async function swipe(route, from, to, options = {}) {
  const p = page(route, options); await ready();
  p.fire('touchstart', from); p.fire('touchmove', to); await ready();
  p.fire('touchend', to); await p.settle(); return p;
}
(async () => {
  for (let i = 0; i < routes.length; i++) for (const direction of [-1, 1]) {
    const p = await swipe(routes[i], 195, direction === 1 ? 55 : 335);
    assert.deepEqual(p.navigated, p.links[i + direction] ? [p.links[i + direction].href] : []);
    checks++;
  }
  for (const room of 'abcde') {
    const p = await swipe(`spaces/${room}`, 250, 90);
    assert.deepEqual(p.navigated, [p.links[2].href]); checks++;
  }
  const guards = {
    tap: p => { p.fire('touchstart'); p.fire('touchend'); },
    short: p => { p.fire('touchstart', 220); p.fire('touchmove', 190); p.fire('touchend', 190); },
    vertical: p => { p.fire('touchstart'); p.fire('touchmove', 210, 430); p.fire('touchend', 80, 430); },
    diagonal: p => { p.fire('touchstart'); p.fire('touchmove', 170, 390); p.fire('touchend', 90, 390); },
    stationaryHold: p => { p.fire('touchstart'); p.fire('touchend', 220, 300, { timeStamp: 1200 }); },
    leftEdge: p => { p.fire('touchstart', 10); p.fire('touchend', 200); },
    rightEdge: p => { p.fire('touchstart', 380); p.fire('touchend', 200); },
    pinch: p => { p.fire('touchstart'); p.fire('touchstart', 220, 300, { touches: [p.point(220), p.point(250, 300, 2)] }); p.fire('touchend', 80); },
    multiMove: p => { p.fire('touchstart'); p.fire('touchmove', 80, 300, { touches: [p.point(80), p.point(250, 300, 2)] }); p.fire('touchend', 80); },
    cancelled: p => { p.fire('touchstart'); p.fire('touchmove', 80); p.fire('touchcancel'); },
    browserScroll: p => { p.fire('touchstart'); p.fire('touchmove', 80, 300, { cancelable: false }); p.fire('touchend', 80); },
    differentFinger: p => { p.fire('touchstart'); p.fire('touchend', 80, 300, { changedTouches: [p.point(80, 300, 2)] }); },
    calendarOrControl: p => { p.target.closest = () => ({}); p.fire('touchstart'); p.fire('touchend', 80); },
    horizontalScroller: p => { p.target.scrollWidth = 500; p.target.overflowX = 'auto'; p.fire('touchstart'); p.fire('touchend', 80); },
  };
  for (const [name, exercise] of Object.entries(guards)) {
    const p = page('pricing'); await ready(); exercise(p); await p.settle();
    assert.deepEqual(p.navigated, [], name);
    assert.equal(p.surface.style.transform || '', '', `${name}: restored`);
    p.target.closest = () => null; p.target.scrollWidth = 100;
    p.fire('touchstart', 240); p.fire('touchmove', 80); await ready(); p.fire('touchend', 80); await p.settle();
    assert.deepEqual(p.navigated, [p.links[3].href], `${name}: retry`); checks++;
  }
  const p = page('pricing'); await ready();
  p.fire('touchstart', 250); p.fire('touchmove', 190); await ready();
  assert.equal(p.surface.style.transform, 'translate3d(-60px,0,0)');
  assert.equal(p.neighbor().style.transform, 'translate3d(330px,0,0)');
  assert.equal(p.neighbor().inert, true); checks++;
  p.fire('touchend', 190, 300, { timeStamp: 400 }); await p.settle();
  assert.equal(p.surface.style.transform, ''); assert.equal(p.neighbor().removed, true); checks++;
  p.fire('touchstart', 250); p.fire('touchmove', 80, 300, { timeStamp: 1100 }); await ready();
  p.fire('touchend', 80, 300, { timeStamp: 1500 }); await p.settle();
  assert.deepEqual(p.navigated, [p.links[3].href]); checks++;
  p.windows.get('pageshow')(); assert.equal(p.surface.style.transform, ''); checks++;
  const fastRetry = page('pricing'); await ready();
  fastRetry.fire('touchstart', 250); fastRetry.fire('touchmove', 220); fastRetry.fire('touchend', 220);
  fastRetry.fire('touchstart', 250); fastRetry.fire('touchmove', 80); await ready();
  fastRetry.fire('touchend', 80); await fastRetry.settle();
  assert.deepEqual(fastRetry.navigated, [fastRetry.links[3].href]); checks++;
  const mouse = page('pricing'); await ready();
  mouse.fire('pointerdown', 250); mouse.fire('pointermove', 80); await ready(); mouse.fire('pointerup', 80); await mouse.settle();
  assert.deepEqual(mouse.navigated, [mouse.links[3].href]);
  assert.equal(mouse.fire('click').prevented, true); checks++;
  const offline = await swipe('pricing', 250, 80, { fetchFails: true });
  assert.deepEqual(offline.navigated, [offline.links[3].href]); checks++;
  const reduced = await swipe('pricing', 250, 80, { reduced: true });
  assert.equal(reduced.navigated.length, 1); checks++;
  const noMenu = await swipe('structure', 250, 90);
  assert.deepEqual(noMenu.navigated, []);
  assert.equal(noMenu.fire('dragstart').prevented, true); checks++;
  const reuse = page('pricing'); await ready();
  assert.ok(reuse.decoded.length >= 2, 'neighbor photos decoded before input'); checks++;
  const photosBefore = reuse.decoded.length;
  reuse.target.closest = selector => selector === 'a[href]' ? reuse.links[1] : null;
  reuse.fire('click'); await ready();
  assert.equal(reuse.location.href, reuse.links[1].href);
  assert.equal(reuse.fetched.filter(url => url === reuse.links[1].href).length, 1);
  const backURL = reuse.links[2].href;
  reuse.location.href = backURL;
  reuse.windows.get('popstate')({ state: { previewScroll: 460 } }); await ready();
  assert.equal(reuse.viewport.scrolledTo, 460);
  reuse.target.closest = selector => selector === 'a[href]' ? reuse.links[1] : null;
  reuse.fire('click'); await ready();
  assert.equal(reuse.fetched.filter(url => url === reuse.links[1].href).length, 1, 'revisit keeps loaded DOM');
  assert.ok(reuse.decoded.length >= photosBefore); checks++;
  const rapid = page('pricing'); await ready();
  rapid.target.closest = selector => selector === 'a[href]' ? rapid.links[3] : null;
  rapid.fire('click');
  rapid.target.closest = selector => selector === 'a[href]' ? rapid.links[4] : null;
  rapid.fire('click'); await ready();
  assert.deepEqual(rapid.navigated, [rapid.links[4].href], 'last requested page wins'); checks++;
  const saver = page('pricing', {saveData:true}); await ready();
  assert.equal(saver.fetched.length, 0, 'no speculative downloads with save-data'); checks++;
  const native = page('pricing'); await ready();
  native.target.closest = selector => selector === 'a[href]' ? native.links[3] : null;
  assert.equal(native.fire('click', 220, 300, {ctrlKey:true}).prevented, false);
  assert.deepEqual(native.navigated, []); checks++;
  const modifiedHTML = fs.readFileSync(path.join(root,'schedule/index.html'),'utf8');
  assert.ok(modifiedHTML.indexOf('</header>') < modifiedHTML.indexOf('class="page-surface"'));
  assert.match(modifiedHTML, /12~13일로 넘어가는 새벽 A홀 통대관 가능한가요/);
  const calendarHTML = fs.readFileSync(path.join(root,'calendar-v11/index.html'),'utf8');
  assert.doesNotMatch(calendarHTML, /room-toggle|bar_btn|close_bottom|show-toggle/);
  for (const key of ['A','B','C','D','E','ALL']) assert.ok(calendarHTML.includes(`${key}btn_pick_oneroom`));
  checks++;
  for (const pointerType of ['touch','pen','mouse']) {
    const input = page('pricing', {modern:true}); await ready();
    const extra = {pointerType,isPrimary:true};
    input.fire('pointerdown',260,300,extra);
    input.fire('pointermove',120,320,extra); await ready();
    assert.equal(input.viewport.captured,1);
    input.windows.get('resize')(); // Address-bar height changes must not cancel a horizontal gesture.
    assert.equal(input.surface.style.transform,'translate3d(-140px,0,0)');
    input.fire('pointerup',120,320,extra); await input.settle();
    assert.deepEqual(input.navigated,[input.links[3].href]); checks++;
  }
  const ambiguous = page('pricing',{modern:true}); await ready();
  ambiguous.fire('pointerdown',260,300,{pointerType:'touch'});
  ambiguous.fire('pointermove',251,310,{pointerType:'touch'});
  ambiguous.fire('pointermove',160,325,{pointerType:'touch'}); await ready();
  ambiguous.fire('pointerup',160,325,{pointerType:'touch'}); await ambiguous.settle();
  assert.deepEqual(ambiguous.navigated,[ambiguous.links[3].href]); checks++;
  for (const cancel of ['pointercancel','vertical','secondPointer']) {
    const input = page('pricing',{modern:true}); await ready();
    input.fire('pointerdown',260,300,{pointerType:'touch'});
    if (cancel === 'vertical') input.fire('pointermove',250,410,{pointerType:'touch'});
    else {
      input.fire('pointermove',210,300,{pointerType:'touch'});
      if(cancel==='secondPointer') input.fire('pointerdown',200,300,{pointerType:'touch',isPrimary:false,pointerId:2});
      else input.fire('pointercancel',210,300,{pointerType:'touch'});
    }
    input.fire('pointerup',100,300,{pointerType:'touch'}); await input.settle();
    assert.deepEqual(input.navigated,[],cancel); checks++;
  }
  assert.match(fs.readFileSync(path.join(root,'style.css'),'utf8'),/touch-action:pan-y pinch-zoom/); checks++;
  for (const route of [...routes, ...[...'abcde'].map(r=>`spaces/${r}`)]) {
    const p = page(route,{public:true,modern:true}); await ready();
    p.fire('pointerdown',260,300,{pointerType:'touch'});
    p.fire('pointermove',80,300,{pointerType:'touch'}); await ready();
    p.fire('pointerup',80,300,{pointerType:'touch'}); await p.settle();
    const index = route.startsWith('spaces/') ? 1 : routes.indexOf(route);
    assert.deepEqual(p.navigated, p.links[index+1] ? [p.links[index+1].href] : []);
    const html = fs.readFileSync(path.resolve(root,'../site',route,'index.html'),'utf8');
    assert.doesNotMatch(html,/noindex|class="brand"|홈페이지 미리보기/);
    assert.ok(html.includes('rel="canonical"'));
    assert.ok(html.includes('naver-site-verification'));
    const data = JSON.parse(structuredText(html));
    const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
    if (!route) {
      assert.equal(data.find(item => item['@type'] === 'WebSite').url, canonical);
      assert.equal(data.find(item => item['@type'] === 'LocalBusiness').url, canonical);
      assert.equal(data.find(item => item['@type'] === 'LocalBusiness').description, metaElements(html)['meta[name="description"]'].content, 'Business summary must use the current public copy');
    } else {
      const trail = data.find(item => item['@type'] === 'BreadcrumbList').itemListElement;
      assert.equal(trail.at(-1).item, canonical);
      assert.deepEqual(trail.map(item=>item.position), trail.map((_,i)=>i+1));
      assert.equal(trail.length,route.startsWith('spaces/') ? 3 : 2);
    }
    const targetRoute = p.navigated.length ? new URL(p.location.href).pathname : '/' + route;
    const targetHTML = fs.readFileSync(path.resolve(root,'../site',targetRoute.replace(/^\//,''),'index.html'),'utf8');
    assert.equal(p.structured.textContent,structuredText(targetHTML), 'Navigation metadata must match the visible destination, not the first page');
    for (const property of ['og:image','og:image:alt']) {
      assert.equal(p.metas[`meta[property="${property}"]`].content, metaElements(targetHTML)[`meta[property="${property}"]`].content, 'Sharing image must follow navigation');
    }
    if (route.startsWith('spaces/')) {
      const gallery = html.match(/<div class="gallery">([\s\S]*?)<\/div>/)[1];
      const alts = [...gallery.matchAll(/alt="([^"]+)"/g)].map(([, alt])=>alt);
      assert.equal(new Set(alts).size, alts.length, 'Different gallery photos need distinct descriptions');
      assert.equal((gallery.match(/<figcaption>/g)||[]).length, alts.length);
      assert.equal((gallery.match(/draggable="false"/g)||[]).length, alts.length);
      assert.match(metaElements(html)['meta[property="og:image"]'].content, new RegExp(`/room${route.at(-1).toUpperCase()}/`));
    }
    checks++;
  }
  const sitemap = fs.readFileSync(path.resolve(root,'../site/sitemap.xml'),'utf8');
  assert.equal((sitemap.match(/<loc>/g)||[]).length,11);
  assert.equal((sitemap.match(/<lastmod>2026-10-08<\/lastmod>/g)||[]).length,11);
  assert.doesNotMatch(sitemap,/site-preview|calendar_10|\/structure\//);
  checks++;
  const visitorSource = fs.readFileSync(path.resolve(root,'../visitor-stats.js'),'utf8');
  // Cached pre-baseline HTML must still initialize collection with the new JS.
  {
    const requests = [];
    const node = {addEventListener(){},querySelector(){return this},querySelectorAll(){return []}};
    const document = {currentScript:{src:'https://example.com/calendar_set/calendar_v10/visitor-stats.js'},readyState:'complete',visibilityState:'visible',addEventListener(){},querySelectorAll(){return []},getElementById(id){return id==='visitor-baseline' ? null : node}};
    vm.runInNewContext(visitorSource,{document,window:{location:{pathname:'/'},performance:{now:()=>100},addEventListener(){}},URL,Date,XMLHttpRequest:class{open(method,url){requests.push(url)}setRequestHeader(){}send(){}}});
    assert.equal(new URL(requests[0]).searchParams.get('action'),'challenge');
    checks++;
  }
  for (const pathname of ['/','/spaces/a/','/schedule/','/calendar_set/calendar_v10/calendar_10.html','/calendar_set/calendar_v10/calendar_mobile_10.html']) {
    const requests=[];
    const document={currentScript:{src:'https://example.com/calendar_set/calendar_v10/visitor-stats.js?v=1'},readyState:'complete',visibilityState:'visible',addEventListener(){},getElementById(){return null}};
    vm.runInNewContext(visitorSource,{document,window:{location:{pathname},performance:{now:()=>100}},URL,XMLHttpRequest:class{open(method,url){requests.push(url)}setRequestHeader(){}send(){}},Date});
    assert.equal(new URL(requests[0]).pathname,'/calendar_set/calendar_v10/visitor-stats.php');
    assert.equal(new URL(requests[0]).searchParams.get('page_path'),pathname);
    checks++;
  }
  // A soft navigation during the dwell timer must keep the signed entry path.
  {
    let clock = 100;
    const timers = [], posts = [];
    const window = {location:{pathname:'/'},performance:{now:()=>clock},dispatchEvent(){},innerWidth:390,innerHeight:844};
    const document = {currentScript:{src:'https://example.com/calendar_set/calendar_v10/visitor-stats.js'},readyState:'complete',visibilityState:'visible',addEventListener(){},getElementById(){return null}};
    vm.runInNewContext(visitorSource, {document,window,URL,Date,navigator:{webdriver:false},CustomEvent:class{},clearTimeout(){},setTimeout(fn){timers.push(fn)},XMLHttpRequest:class{
      open(method){this.method=method}setRequestHeader(){}
      send(body){
        if(this.method==='POST'){posts.push(JSON.parse(body));return;}
        this.readyState=4;this.status=200;this.responseText=JSON.stringify({ok:true,eligible:true,challenge:'signed-entry',minimumVisibleMs:2500,stats:{today:1,total:1}});this.onreadystatechange();
      }
    }});
    window.location.pathname='/pricing/';clock=2700;timers.shift()();
    assert.equal(posts.length,1);
    assert.equal(posts[0].page_path,'/');
    assert.equal(posts[0].challenge,'signed-entry');
    assert.ok(posts[0].visible_ms>=2500);
    checks++;
  }
  // Exercise the embed's lifecycle independently from calendar data fetching:
  // view changes, repeated renders, resize feedback, and CSS-height restoration.
  const embedSource = fs.readFileSync(path.join(root,'calendar-v11/embed.js'),'utf8');
  let monthHeight = 429.5, controlsHeight = 96, heightWrites = 0;
  let frameHeight = '', scheduled = [], mutationCallback;
  const embedEvents = new Map();
  const embedFrame = { matches: () => true, style: {
    get height() { return frameHeight; },
    set height(value) { frameHeight = value; heightWrites++; },
    removeProperty() { frameHeight = ''; },
  } };
  const embedRoot = {};
  vm.runInNewContext(embedSource, {
    window: {frameElement:embedFrame,addEventListener:(name,fn)=>embedEvents.set(name,fn)},
    document: {addEventListener(){},getElementById:()=>embedRoot,
      querySelector: selector => selector.includes('swiper-slide-active')
        ? (monthHeight ? {offsetHeight:monthHeight,getBoundingClientRect:()=>({height:monthHeight})} : null)
        : {getBoundingClientRect:()=>({height:selector==='.bottomtop'?controlsHeight:34})}},
    MutationObserver: class {constructor(fn){mutationCallback=fn}observe(target){assert.equal(target,embedRoot)}},
    requestAnimationFrame: fn => {scheduled.push(fn);return scheduled.length},
  });
  const flushEmbed = () => {const jobs=scheduled;scheduled=[];jobs.forEach(fn=>fn())};
  flushEmbed();assert.equal(frameHeight,'562px');checks++;
  for(let i=0;i<20;i++) mutationCallback();
  assert.equal(scheduled.length,1,'coalesce calendar render mutations');flushEmbed();
  embedEvents.get('resize')();flushEmbed();
  assert.equal(heightWrites,1,'resizing the frame must not create a resize-write loop');checks++;
  monthHeight=509.5;mutationCallback();flushEmbed();assert.equal(frameHeight,'642px');checks++;
  monthHeight=349.5;mutationCallback();flushEmbed();assert.equal(frameHeight,'482px');checks++;
  controlsHeight=54;embedEvents.get('resize')();flushEmbed();assert.equal(frameHeight,'440px');checks++;
  monthHeight=0;mutationCallback();flushEmbed();assert.equal(frameHeight,'','week restores stylesheet height');checks++;
  monthHeight=429.5;mutationCallback();flushEmbed();assert.equal(frameHeight,'520px');checks++;
  vm.runInNewContext(embedSource,{window:{frameElement:null},document:{addEventListener(){}}});checks++;
  console.log(`PASS: ${checks} route, visual movement, release, retry, gesture-protection and calendar sizing checks.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
