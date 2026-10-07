document.addEventListener('dragstart', event => event.preventDefault());

// The existing header owns routes. Cached DOM pages reuse already decoded images.
const menuLinks = [...document.querySelectorAll('.header .nav a, .header .header-book')];
let menuIndex = menuLinks.findIndex(link => link.getAttribute('aria-current') === 'page');
let surface = document.querySelector('.page-surface');
const viewport = document.querySelector('.page-viewport');
if (menuIndex >= 0 && surface && viewport) {
  const previews = new Map();
  const activePage = { surface, title: document.title, index: menuIndex,
    description: document.querySelector('meta[name="description"]')?.content || '' };
  let navigationId = 0;
  let currentURL = location.href;
  let currentScroll = scrollY;
  let cleanupPage = initPage(surface, currentURL);
  const pageKey = href => new URL(href, location.href).href;
  previews.set(pageKey(currentURL), Promise.resolve(activePage));
  history.scrollRestoration = 'manual';
  history.replaceState({ ...history.state, previewScroll: scrollY }, '');

  let gesture = null;
  let neighbor = null;
  let settling = false;
  let settleTimer = 0;
  let suppressClickUntil = 0;
  let viewportWidth = innerWidth;
  const usePointerEvents = typeof PointerEvent !== 'undefined';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function loadPage(href) {
    const key = pageKey(href);
    if (!previews.has(key)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const request = fetch(key, { signal: controller.signal, credentials: 'same-origin' })
        .then(response => {
          if (!response.ok) throw new Error('Page unavailable');
          return response.text();
        })
        .then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const parsed = doc.querySelector('.page-surface');
          if (!parsed) throw new Error('Missing page surface');
          parsed.querySelectorAll('script').forEach(node => node.remove());
          parsed.querySelectorAll('iframe').forEach(frame => {
            frame.dataset.pageSrc = frame.getAttribute('src');
            frame.removeAttribute('src');
          });
          const page = document.importNode(parsed, true);
          const entry = { surface: page, title: doc.title,
            description: doc.querySelector('meta[name="description"]')?.content || '',
            index: menuLinks.findIndex(link => new URL(link.href).pathname ===
              new URL(doc.querySelector('.header [aria-current="page"]')?.href || key, key).pathname) };
          // Decode the first screen's photos before it is exposed. Later photos stay lazy.
          const images = [...page.querySelectorAll('img')].slice(0, 2);
          entry.ready = Promise.all(images.map(img => {
            img.loading = 'eager';
            return img.decode?.().catch(() => {});
          }));
          return entry;
        })
        .catch(() => { previews.delete(key); return null; })
        .finally(() => clearTimeout(timeout));
      previews.set(key, request);
      // Bounded per-tab memory, with no persistent cache or booking data ownership.
      if (previews.size > 8) {
        for (const old of previews.keys()) {
          if (old !== key && old !== pageKey(currentURL)) { previews.delete(old); break; }
        }
      }
    }
    return previews.get(key);
  }

  function loadPreview(index) {
    return menuLinks[index] ? loadPage(menuLinks[index].href) : Promise.resolve(null);
  }

  function prefetchNeighbors() {
    if (navigator.connection?.saveData || menuIndex < 0) return;
    loadPreview(menuIndex - 1);
    loadPreview(menuIndex + 1);
  }

  async function navigate(href, { pop = false, y = 0 } = {}) {
    const id = ++navigationId;
    const destination = pageKey(href);
    if (!pop) history.replaceState({ ...history.state, previewScroll: currentScroll }, '');
    viewport.setAttribute('aria-busy', 'true');
    const entry = await loadPage(destination);
    // Do not keep a user waiting indefinitely for a failed image.
    let imageTimer;
    if (entry) await Promise.race([entry.ready, new Promise(resolve => { imageTimer = setTimeout(resolve, 1200); })]);
    clearTimeout(imageTimer);
    if (id !== navigationId) return;
    if (!entry) { location.assign(destination); return; }
    cleanupPage();
    reset();
    surface.remove();
    surface = entry.surface;
    surface.classList.remove('swipe-neighbor');
    surface.removeAttribute('aria-hidden');
    surface.inert = false;
    surface.style.cssText = '';
    viewport.append(surface);
    menuIndex = entry.index;
    currentURL = destination;
    if (!pop) history.pushState({ previewScroll: 0 }, '', destination);
    document.title = entry.title;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = entry.description;
    menuLinks.forEach((link, index) => {
      if (index === menuIndex) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    cleanupPage = initPage(surface, destination);
    viewport.removeAttribute('aria-busy');
    window.scrollTo({ top: y, behavior: 'instant' });
    currentScroll = y;
    surface.querySelector('main')?.focus({ preventScroll: true });
    prefetchNeighbors();
  }

  function reset() {
    clearTimeout(settleTimer);
    if (gesture && viewport.hasPointerCapture?.(gesture.id)) viewport.releasePointerCapture(gesture.id);
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
    loadPreview(index).then(entry => {
      if (!entry || gesture !== state || state.index !== index) return;
      neighbor = entry.surface;
      neighbor.style.transition = "";
      neighbor.querySelector('main')?.removeAttribute('id');
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
    if (!point || menuIndex < 0 || settling === 'leaving') return;
    if (settling === 'returning') reset();
    if (point.clientX < 20 || point.clientX > innerWidth - 20 ||
        event.target.closest('.site-header, button, input, textarea, select, iframe, video, audio, [contenteditable], [role="slider"], .calendar-shell')) return;
    for (let node = event.target; node && node !== document.body; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 1 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowX)) return;
    }
    gesture = { kind, id: point.identifier ?? point.pointerId, x: point.clientX, y: point.clientY,
      dx: 0, locked: false, index: null, lastX: point.clientX, lastTime: event.timeStamp, velocity: 0 };
    prefetchNeighbors();
  }

  function move(event, point) {
    const state = gesture;
    if (!state || !point) return;
    const dx = point.clientX - state.x;
    const dy = point.clientY - state.y;
    if (!state.locked) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.3) { reset(); return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      state.locked = true;
      if (state.kind !== 'touch') viewport.setPointerCapture?.(state.id);
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
    const commit = !cancelled && link && (Math.abs(state.dx) >= Math.min(112, innerWidth * 0.20) ||
      (Math.abs(state.dx) > 36 && recentFlick));
    settling = commit ? 'leaving' : 'returning';
    if (commit && !neighbor) { gesture = null; navigate(link.href); return; }
    // Keep the prepared neighboring DOM and images through the transition.
    gesture = null;
    const duration = reducedMotion.matches ? 0 : (commit ? 220 : 180);
    const transition = `transform ${duration}ms cubic-bezier(.22,.7,.2,1)`;
    surface.style.transition = transition;
    if (neighbor) neighbor.style.transition = transition;
    surface.style.transform = `translate3d(${commit ? -direction * innerWidth : 0}px,0,0)`;
    if (neighbor) neighbor.style.transform = `translate3d(${commit ? 0 : direction * innerWidth}px,0,0)`;
    settleTimer = setTimeout(() => {
      if (commit) navigate(link.href);
      else reset();
    }, duration);
  }

  // Older browsers retain the same gesture core through Touch Events.
  if (!usePointerEvents) {
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

  }

  // Pointer capture keeps touch, pen and mouse input continuous across child elements.
  document.addEventListener('pointerdown', event => {
    if ((!usePointerEvents && event.pointerType !== 'mouse') || event.button !== 0) return;
    if (event.isPrimary === false) { reset(); return; }
    begin(event, event, event.pointerType === 'mouse' ? 'mouse' : 'pointer');
    if (gesture && event.pointerType === 'mouse') event.preventDefault();
  });
  document.addEventListener('pointermove', event => {
    if (gesture && gesture.kind !== 'touch' && gesture.id === event.pointerId) move(event, event);
  });
  document.addEventListener('pointerup', event => {
    if (gesture && gesture.kind !== 'touch' && gesture.id === event.pointerId) finish(event, event);
  });
  document.addEventListener('pointercancel', event => {
    if (gesture && gesture.kind !== 'touch' && gesture.id === event.pointerId) finish(event, null, true);
  });
  document.addEventListener('click', event => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    const base = new URL(menuLinks[0].href);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.hash ||
        !url.pathname.endsWith('/') || link.closest('.swipe-neighbor')) return;
    event.preventDefault();
    navigate(url.href);
  });
  document.addEventListener('pointerover', event => {
    const link = event.target.closest('a[href]');
    if (link && menuLinks.includes(link) && !navigator.connection?.saveData) loadPage(link.href);
  }, { passive: true });
  window.addEventListener('scroll', () => { currentScroll = scrollY; }, { passive: true });
  window.addEventListener('popstate', event => {
    reset();
    navigate(location.href, { pop: true, y: event.state?.previewScroll || 0 });
  });
  window.addEventListener('blur', reset);
  window.addEventListener('resize', () => {
    if (innerWidth !== viewportWidth) { viewportWidth = innerWidth; reset(); }
  });
  window.addEventListener('pageshow', reset);
  prefetchNeighbors();
} else if (surface) {
  initPage(surface, location.href);
}

function initPage(root, href) {
  root.querySelector('main')?.setAttribute('id', 'main');
  const timers = new Set();
  const copyButton = root.querySelector('[data-copy-address]');
  if (copyButton) copyButton.onclick = async () => {
    const status = root.querySelector('.copy-result');
    try {
      await navigator.clipboard.writeText('서울 동작구 남부순환로 2077 지하 2층');
      status.textContent = '주소를 복사했습니다.';
    } catch {
      status.textContent = '서울 동작구 남부순환로 2077 지하 2층';
    }
  };
  const frame = root.querySelector('.calendar-frame');
  if (frame) {
    const room = new URL(href).searchParams.get('room');
    frame.onload = () => {
      if (!/^[a-e]$/.test(room || '')) return;
      const win = frame.contentWindow;
      const selectRoom = () => {
        if (!win.calendar?._curCal || typeof win.select_room_btn_function !== 'function') return false;
        win.select_room_btn_function(room);
        return true;
      };
      if (!selectRoom()) {
        let attempts = 0;
        const timer = setInterval(() => {
          if (!frame.isConnected || selectRoom() || ++attempts >= 20) { clearInterval(timer); timers.delete(timer); }
        }, 250);
        timers.add(timer);
      }
    };
    if (frame.dataset.pageSrc) frame.src = frame.dataset.pageSrc;
  }
  return () => {
    timers.forEach(clearInterval);
    if (frame) {
      frame.onload = null;
      frame.dataset.pageSrc = frame.getAttribute('src') || frame.dataset.pageSrc;
      frame.removeAttribute('src');
    }
  };
}
