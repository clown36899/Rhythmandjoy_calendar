const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../www/calendar_set/calendar_v10/site-preview');
const source = fs.readFileSync(path.join(root, 'site.js'), 'utf8');
const routes = ['', 'spaces', 'pricing', 'location', 'guide', 'schedule'];
let checks = 0;

function page(route) {
  const html = fs.readFileSync(path.join(root, route, 'index.html'), 'utf8');
  const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)[1];
  const links = [...header.matchAll(/<a\b([^>]*)>/g)]
    .filter(([, attrs]) => !attrs.includes('aria-label='))
    .map(([, attrs]) => ({
      href: attrs.match(/href="([^"]+)"/)[1],
      getAttribute: key => key === 'aria-current' && attrs.includes('aria-current=page') ? 'page' : null,
    }));
  const listeners = new Map();
  const navigated = [];
  const body = {};
  const target = { closest: () => null, parentElement: body, scrollWidth: 100, clientWidth: 100 };
  const document = {
    body,
    querySelectorAll: () => links,
    querySelector: () => null,
    addEventListener: (type, fn) => listeners.set(type, fn),
  };
  vm.runInNewContext(source, {
    document, innerWidth: 390,
    getComputedStyle: node => ({ overflowX: node.overflowX || 'visible' }),
    location: { assign: url => navigated.push(url) },
  });
  const point = (x, y = 300, identifier = 1) => ({ clientX: x, clientY: y, identifier });
  function fire(type, x = 220, y = 300, extra = {}) {
    const touch = point(x, y);
    const event = {
      target, cancelable: true, timeStamp: type === 'touchstart' ? 0 : 200,
      touches: type === 'touchend' ? [] : [touch], changedTouches: [touch],
      prevented: false, preventDefault() { this.prevented = true; }, ...extra,
    };
    listeners.get(type)?.(event);
    return event;
  }
  return { links, navigated, listeners, target, fire, point };
}

function swipe(route, from, to) {
  const p = page(route);
  p.fire('touchstart', from);
  p.fire('touchmove', to);
  const end = p.fire('touchend', to);
  return { ...p, end };
}

for (let i = 0; i < routes.length; i++) {
  for (const direction of [-1, 1]) {
    const p = swipe(routes[i], 195, direction === 1 ? 70 : 320);
    const next = p.links[i + direction];
    assert.deepEqual(p.navigated, next ? [next.href] : []);
    assert.equal(p.end.prevented, Boolean(next));
    checks++;
  }
}
// All room details use the active Space menu, not a separate route list.
for (const room of 'abcde') {
  const p = swipe(`spaces/${room}`, 250, 90);
  assert.deepEqual(p.navigated, [p.links[2].href]);
  checks++;
}

const guards = {
  tap: p => { p.fire('touchstart'); p.fire('touchend'); },
  short: p => { p.fire('touchstart', 220); p.fire('touchend', 180); },
  vertical: p => { p.fire('touchstart'); p.fire('touchmove', 210, 430); p.fire('touchend', 80, 430); },
  diagonal: p => { p.fire('touchstart'); p.fire('touchend', 90, 390); },
  longPress: p => { p.fire('touchstart'); p.fire('touchend', 80, 300, { timeStamp: 900 }); },
  leftEdge: p => { p.fire('touchstart', 10); p.fire('touchend', 200); },
  rightEdge: p => { p.fire('touchstart', 380); p.fire('touchend', 200); },
  pinch: p => {
    p.fire('touchstart');
    p.fire('touchstart', 220, 300, { touches: [p.point(220), p.point(250, 300, 2)] });
    p.fire('touchend', 80);
  },
  multiMove: p => {
    p.fire('touchstart');
    p.fire('touchmove', 80, 300, { touches: [p.point(80), p.point(250, 300, 2)] });
    p.fire('touchend', 80);
  },
  cancelled: p => { p.fire('touchstart'); p.fire('touchcancel'); p.fire('touchend', 80); },
  browserScroll: p => { p.fire('touchstart'); p.fire('touchmove', 80, 300, { cancelable: false }); p.fire('touchend', 80); },
  differentFinger: p => { p.fire('touchstart'); p.fire('touchend', 80, 300, { changedTouches: [p.point(80, 300, 2)] }); },
  calendarOrControl: p => { p.target.closest = () => ({}); p.fire('touchstart'); p.fire('touchend', 80); },
  horizontalScroller: p => {
    p.target.scrollWidth = 500; p.target.overflowX = 'auto';
    p.fire('touchstart'); p.fire('touchend', 80);
  },
};
for (const [name, exercise] of Object.entries(guards)) {
  const p = page('pricing');
  exercise(p);
  assert.deepEqual(p.navigated, [], name);
  // A rejected gesture must not poison the following intentional swipe.
  p.target.closest = () => null; p.target.scrollWidth = 100;
  p.fire('touchstart', 240); p.fire('touchmove', 80); p.fire('touchend', 80);
  assert.deepEqual(p.navigated, [p.links[3].href], `${name}: retry`);
  checks++;
}
const noMenu = swipe('structure', 250, 90);
assert.deepEqual(noMenu.navigated, []);
assert.equal(noMenu.fire('dragstart').prevented, true);
assert.equal(page('pricing').fire('dragstart').prevented, true);
console.log(`PASS: ${checks + 3} menu, room, gesture-conflict and drag-guard checks.`);
