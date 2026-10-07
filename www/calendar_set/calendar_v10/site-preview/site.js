document.addEventListener('dragstart', event => event.preventDefault());
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
