document.addEventListener('dragstart', event => event.preventDefault());

// Reuse the header's order and active section; all navigation remains ordinary URLs.
const menuLinks = [...document.querySelectorAll('.page-surface .header .nav a, .page-surface .header .header-book')];
const menuIndex = menuLinks.findIndex(link => link.getAttribute('aria-current') === 'page');
const surface = document.querySelector('.page-surface');
const viewport = document.querySelector('.page-viewport');
if (menuIndex >= 0 && surface && viewport) {
  const previews = new Map();
  let gesture = null;
  let neighbor = null;
  let settling = false;
  let settleTimer = 0;
  let suppressClickUntil = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function loadPreview(index) {
    const link = menuLinks[index];
    if (!link) return Promise.resolve(null);
    if (!previews.has(index)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const request = fetch(link.href, { signal: controller.signal, credentials: 'same-origin' })
        .then(response => {
          if (!response.ok) throw new Error('Page unavailable');
          return response.text();
        })
        .then(html => {
          const page = new DOMParser().parseFromString(html, 'text/html').querySelector('.page-surface');
          if (!page) throw new Error('Missing page surface');
          // A preview is inert. The real destination initializes its calendar on navigation.
          page.querySelectorAll('script').forEach(node => node.remove());
          page.querySelectorAll('iframe').forEach(node => node.removeAttribute('src'));
          page.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
          return page;
        })
        .catch(() => { previews.delete(index); return null; })
        .finally(() => clearTimeout(timeout));
      previews.set(index, request);
    }
    return previews.get(index);
  }

  function reset() {
    clearTimeout(settleTimer);
    gesture = null;
    settling = false;
    neighbor?.remove();
    neighbor = null;
    surface.style.transform = '';
    surface.style.transition = '';
    viewport.classList.remove('is-swiping');
  }

  function showNeighbor(state, index) {
    if (state.index === index) return;
    state.index = index;
    neighbor?.remove();
    neighbor = null;
    loadPreview(index).then(page => {
      if (!page || gesture !== state || state.index !== index) return;
      neighbor = page.cloneNode(true);
      neighbor.classList.add('swipe-neighbor');
      neighbor.setAttribute('aria-hidden', 'true');
      neighbor.inert = true;
      neighbor.style.top = `${scrollY}px`;
      viewport.append(neighbor);
      paint(state);
    });
  }

  function paint(state) {
    const direction = state.dx < 0 ? 1 : -1;
    const exists = Boolean(menuLinks[menuIndex + direction]);
    const dx = exists ? Math.max(-innerWidth, Math.min(innerWidth, state.dx)) : state.dx * 0.2;
    surface.style.transform = `translate3d(${dx}px,0,0)`;
    if (neighbor) neighbor.style.transform = `translate3d(${dx + direction * innerWidth}px,0,0)`;
  }

  function begin(event, point, kind) {
    if (!point || settling === 'leaving') return;
    if (settling === 'returning') reset();
    if (point.clientX < 20 || point.clientX > innerWidth - 20 ||
        event.target.closest('button, input, textarea, select, iframe, video, audio, [contenteditable], [role="slider"], .calendar-shell')) return;
    for (let node = event.target; node && node !== document.body; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 1 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowX)) return;
    }
    gesture = { kind, id: point.identifier ?? point.pointerId, x: point.clientX, y: point.clientY,
      dx: 0, locked: false, index: null, lastX: point.clientX, lastTime: event.timeStamp, velocity: 0 };
    loadPreview(menuIndex - 1);
    loadPreview(menuIndex + 1);
  }

  function move(event, point) {
    const state = gesture;
    if (!state || !point) return;
    const dx = point.clientX - state.x;
    const dy = point.clientY - state.y;
    if (!state.locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { reset(); return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      state.locked = true;
      viewport.classList.add('is-swiping');
    }
    if (!event.cancelable) { reset(); return; }
    event.preventDefault();
    const elapsed = event.timeStamp - state.lastTime;
    if (elapsed > 0) state.velocity = (point.clientX - state.lastX) / elapsed;
    state.lastX = point.clientX;
    state.lastTime = event.timeStamp;
    state.dx = dx;
    showNeighbor(state, menuIndex + (dx < 0 ? 1 : -1));
    paint(state);
  }

  function finish(event, point, cancelled = false) {
    const state = gesture;
    if (!state) return;
    if (!state.locked) { reset(); return; }
    if (event.cancelable) event.preventDefault();
    suppressClickUntil = Date.now() + 400;
    if (point) state.dx = point.clientX - state.x;
    const direction = state.dx < 0 ? 1 : -1;
    const link = menuLinks[menuIndex + direction];
    const recentFlick = event.timeStamp - state.lastTime < 100 &&
      Math.abs(state.velocity) > 0.5 && Math.sign(state.velocity) === Math.sign(state.dx);
    const commit = !cancelled && link && (Math.abs(state.dx) >= Math.min(140, innerWidth * 0.24) ||
      (Math.abs(state.dx) > 36 && recentFlick));
    settling = commit ? 'leaving' : 'returning';
    if (commit && !neighbor) { location.assign(link.href); return; }
    // Keep the ready neighboring page visible until the browser paints its destination.
    gesture = null;
    const duration = reducedMotion.matches ? 0 : (commit ? 220 : 180);
    const transition = `transform ${duration}ms cubic-bezier(.22,.7,.2,1)`;
    surface.style.transition = transition;
    if (neighbor) neighbor.style.transition = transition;
    surface.style.transform = `translate3d(${commit ? -direction * innerWidth : 0}px,0,0)`;
    if (neighbor) neighbor.style.transform = `translate3d(${commit ? 0 : direction * innerWidth}px,0,0)`;
    settleTimer = setTimeout(() => {
      if (commit) location.assign(link.href);
      else reset();
    }, duration);
  }

  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { reset(); return; }
    begin(event, event.touches[0], 'touch');
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (gesture?.kind !== 'touch') return;
    const point = [...event.touches].find(touch => touch.identifier === gesture.id);
    if (event.touches.length !== 1 || !point) { finish(event, null, true); return; }
    move(event, point);
  }, { passive: false });
  document.addEventListener('touchend', event => {
    if (gesture?.kind !== 'touch') return;
    const point = [...event.changedTouches].find(touch => touch.identifier === gesture.id);
    finish(event, point, !point || event.touches.length > 0);
  }, { passive: false });
  document.addEventListener('touchcancel', event => finish(event, null, true), { passive: false });

  // Desktop dragging uses the same movement and release logic as a finger swipe.
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    begin(event, event, 'mouse');
    if (gesture) event.preventDefault();
  });
  document.addEventListener('pointermove', event => {
    if (gesture?.kind === 'mouse') move(event, event);
  });
  document.addEventListener('pointerup', event => {
    if (gesture?.kind === 'mouse') finish(event, event);
  });
  document.addEventListener('pointercancel', event => {
    if (gesture?.kind === 'mouse') finish(event, null, true);
  });
  document.addEventListener('click', event => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  window.addEventListener('pageshow', reset);
  loadPreview(menuIndex - 1);
  loadPreview(menuIndex + 1);
}

const copyButton = document.querySelector('[data-copy-address]');
copyButton?.addEventListener('click', async () => {
  const status = document.querySelector('.copy-result');
  try {
    await navigator.clipboard.writeText('서울 동작구 남부순환로 2077 지하 2층');
    status.textContent = '주소를 복사했습니다.';
  } catch {
    status.textContent = '서울 동작구 남부순환로 2077 지하 2층';
  }
});
const frame = document.querySelector('.calendar-frame');
if (frame) {
  const room = new URLSearchParams(location.search).get('room');
  if (/^[a-e]$/.test(room || '')) {
    frame.addEventListener('load', () => {
      const win = frame.contentWindow;
      const selectRoom = () => {
        if (!win.calendar?._curCal || typeof win.select_room_btn_function !== 'function') return false;
        win.select_room_btn_function(room);
        return true;
      };
      if (!selectRoom()) {
        let attempts = 0;
        const timer = setInterval(() => {
          if (selectRoom() || ++attempts >= 20) clearInterval(timer);
        }, 250);
      }
    });
  }
}
