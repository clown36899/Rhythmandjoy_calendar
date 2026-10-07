const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../www/calendar_set/calendar_v10/site-preview');
const source = fs.readFileSync(path.join(root, 'site.js'), 'utf8');
const routes = ['', 'spaces', 'pricing', 'location', 'guide', 'schedule'];
let checks = 0;
const ready = () => new Promise(resolve => setImmediate(resolve));

function element() {
  const classes = new Set();
  return {
    style: {}, inert: false, removed: false,
    classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x) },
    querySelectorAll: () => [], setAttribute() {}, removeAttribute() {},
    remove() { this.removed = true; }, cloneNode: () => element(),
  };
}
function page(route, options = {}) {
  const html = fs.readFileSync(path.join(root, route, 'index.html'), 'utf8');
  const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)[1];
  const links = [...header.matchAll(/<a\b([^>]*)>/g)].filter(([, a]) => !a.includes('aria-label='))
    .map(([, a]) => ({ href: a.match(/href="([^"]+)"/)[1], getAttribute: key => key === 'aria-current' && a.includes('aria-current=page') ? 'page' : null }));
  const listeners = new Map(), windows = new Map(), timers = new Map(), navigated = [];
  const surface = element(), viewport = element(), body = {};
  let neighbor, timerId = 0, fetchFails = options.fetchFails;
  viewport.append = e => { neighbor = e; };
  const target = { closest: () => null, parentElement: body, scrollWidth: 100, clientWidth: 100 };
  const document = {
    body, querySelectorAll: () => links,
    querySelector: s => s === '.page-surface' ? surface : s === '.page-viewport' ? viewport : null,
    addEventListener: (name, cb) => listeners.set(name, cb),
  };
  vm.runInNewContext(source, {
    document, innerWidth: 390, scrollY: 0, AbortController,
    matchMedia: () => ({ matches: !!options.reduced }),
    window: { addEventListener: (name, cb) => windows.set(name, cb) },
    getComputedStyle: e => ({ overflowX: e.overflowX || 'visible' }),
    location: { assign: url => navigated.push(url) },
    fetch: async () => { if (fetchFails) throw new Error('offline'); return { ok: true, text: async () => '<html></html>' }; },
    DOMParser: class { parseFromString() { return { querySelector: () => element() }; } },
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
      prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra,
    };
    listeners.get(type)?.(e); return e;
  }
  function settle() {
    for (const [id, timer] of [...timers]) if (timer.ms < 1000) { timers.delete(id); timer.fn(); }
  }
  return { links, navigated, surface, viewport, windows, target, point, fire, settle,
    neighbor: () => neighbor, allowFetch: () => { fetchFails = false; } };
}
async function swipe(route, from, to, options = {}) {
  const p = page(route, options); await ready();
  p.fire('touchstart', from); p.fire('touchmove', to); await ready();
  p.fire('touchend', to); p.settle(); return p;
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
    const p = page('pricing'); await ready(); exercise(p); p.settle();
    assert.deepEqual(p.navigated, [], name);
    assert.equal(p.surface.style.transform || '', '', `${name}: restored`);
    p.target.closest = () => null; p.target.scrollWidth = 100;
    p.fire('touchstart', 240); p.fire('touchmove', 80); await ready(); p.fire('touchend', 80); p.settle();
    assert.deepEqual(p.navigated, [p.links[3].href], `${name}: retry`); checks++;
  }
  const p = page('pricing'); await ready();
  p.fire('touchstart', 250); p.fire('touchmove', 170); await ready();
  assert.equal(p.surface.style.transform, 'translate3d(-80px,0,0)');
  assert.equal(p.neighbor().style.transform, 'translate3d(310px,0,0)');
  assert.equal(p.neighbor().inert, true); checks++;
  p.fire('touchend', 170, 300, { timeStamp: 400 }); p.settle();
  assert.equal(p.surface.style.transform, ''); assert.equal(p.neighbor().removed, true); checks++;
  p.fire('touchstart', 250); p.fire('touchmove', 80, 300, { timeStamp: 1100 }); await ready();
  p.fire('touchend', 80, 300, { timeStamp: 1500 }); p.settle();
  assert.deepEqual(p.navigated, [p.links[3].href]); checks++;
  p.windows.get('pageshow')(); assert.equal(p.surface.style.transform, ''); checks++;
  const fastRetry = page('pricing'); await ready();
  fastRetry.fire('touchstart', 250); fastRetry.fire('touchmove', 220); fastRetry.fire('touchend', 220);
  fastRetry.fire('touchstart', 250); fastRetry.fire('touchmove', 80); await ready();
  fastRetry.fire('touchend', 80); fastRetry.settle();
  assert.deepEqual(fastRetry.navigated, [fastRetry.links[3].href]); checks++;
  const mouse = page('pricing'); await ready();
  mouse.fire('pointerdown', 250); mouse.fire('pointermove', 80); await ready(); mouse.fire('pointerup', 80); mouse.settle();
  assert.deepEqual(mouse.navigated, [mouse.links[3].href]);
  assert.equal(mouse.fire('click').prevented, true); checks++;
  const offline = await swipe('pricing', 250, 80, { fetchFails: true });
  assert.deepEqual(offline.navigated, [offline.links[3].href]); checks++;
  const reduced = await swipe('pricing', 250, 80, { reduced: true });
  assert.match(reduced.surface.style.transition, /0ms/); checks++;
  const noMenu = await swipe('structure', 250, 90);
  assert.deepEqual(noMenu.navigated, []);
  assert.equal(noMenu.fire('dragstart').prevented, true); checks++;
  console.log(`PASS: ${checks} route, visual movement, release, retry and gesture-protection checks.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
