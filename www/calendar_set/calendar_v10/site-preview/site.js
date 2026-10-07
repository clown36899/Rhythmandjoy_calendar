document.addEventListener('dragstart', event => event.preventDefault());

// The header owns both the route order and the active section, including room details.
const menuLinks = [...document.querySelectorAll('.header .nav a, .header .header-book')];
const menuIndex = menuLinks.findIndex(link => link.getAttribute('aria-current') === 'page');
if (menuIndex >= 0) {
  let swipe = null;
  document.addEventListener('touchstart', event => {
    swipe = null;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    // Keep browser edge gestures, controls, and the independent calendar untouched.
    if (touch.clientX < 24 || touch.clientX > innerWidth - 24 ||
        event.target.closest('button, input, textarea, select, iframe, video, audio, [contenteditable], [role="slider"], .calendar-shell')) return;
    for (let node = event.target; node && node !== document.body; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 1 &&
          /^(auto|scroll)$/.test(getComputedStyle(node).overflowX)) return;
    }
    swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, started: event.timeStamp };
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    if (!swipe) return;
    const touch = [...event.touches].find(point => point.identifier === swipe.id);
    if (event.touches.length !== 1 || !touch) {
      swipe = null;
      return;
    }
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) * 2 >= Math.abs(dx)) {
      swipe = null;
      return;
    }
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 2) {
      if (!event.cancelable) {
        swipe = null;
        return;
      }
      if (menuLinks[menuIndex + (dx < 0 ? 1 : -1)]) event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', event => {
    const start = swipe;
    swipe = null;
    if (!start || event.touches.length || !event.cancelable) return;
    const touch = [...event.changedTouches].find(point => point.identifier === start.id);
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 64 || Math.abs(dx) <= Math.abs(dy) * 2 ||
        event.timeStamp - start.started > 800) return;
    const next = menuLinks[menuIndex + (dx < 0 ? 1 : -1)];
    if (!next) return;
    event.preventDefault(); // A swipe starting on a link must not also activate that link.
    location.assign(next.href);
  }, { passive: false });
  document.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });
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
