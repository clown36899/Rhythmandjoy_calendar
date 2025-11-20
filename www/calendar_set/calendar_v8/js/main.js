let calendar;

document.addEventListener("DOMContentLoaded", async () => {
  if (window.logger) logger.info('App starting');

  calendar = new Calendar("calendarContainer");
  window.calendar = calendar;

  await calendar.init();

  setupAdminButton();
  setupInfoButton();
  setupBottomLayoutObserver();
  
  checkAndOpenInfoPage();

  if (window.logger) logger.info('App initialized');
});

function setupAdminButton() {
  const adminBtn = document.getElementById("adminBtn");
  if (adminBtn) {
    adminBtn.addEventListener("click", () => {
      window.location.href = "admin.html";
    });
  }
}

function setupInfoButton() {
  const infoBtn = document.getElementById("infoBtn");
  if (infoBtn) {
    infoBtn.addEventListener("click", () => {
      openInfoPage();
    });
  }
}

// 예약정보 페이지 열기
function openInfoPage() {
  const overlay = document.getElementById("infoPageOverlay");
  
  // 슬라이드 인
  requestAnimationFrame(() => {
    overlay.classList.add("active");
  });
}

// 예약정보 페이지 닫기
function closeInfoPage() {
  const overlay = document.getElementById("infoPageOverlay");
  overlay.classList.remove("active");
}

// 메시지 리스너 (homepage-section_mobile.html에서 닫기 요청)
window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "closeInfo") {
    closeInfoPage();
  }
});

// 전역 함수로 노출
window.openInfoPage = openInfoPage;
window.closeInfoPage = closeInfoPage;

// URL 파라미터로 예약정보 페이지 자동 열기
function checkAndOpenInfoPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const shouldOpen = urlParams.get('openInfo');
  const section = urlParams.get('section');
  
  if (shouldOpen === 'true') {
    // iframe이 로드될 때까지 대기 후 열기
    const iframe = document.getElementById('infoPageFrame');
    
    iframe.addEventListener('load', function onLoad() {
      // iframe 로드 완료 후 열기
      openInfoPage();
      
      // section 파라미터가 있으면 iframe 내부로 전달
      if (section && iframe.contentWindow) {
        setTimeout(() => {
          iframe.contentWindow.postMessage({ 
            type: 'showSection', 
            section: section 
          }, '*');
        }, 500);
      }
      
      iframe.removeEventListener('load', onLoad);
    });
    
    // 이미 로드되어 있을 수 있으므로 체크
    if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
      openInfoPage();
      
      if (section && iframe.contentWindow) {
        setTimeout(() => {
          iframe.contentWindow.postMessage({ 
            type: 'showSection', 
            section: section 
          }, '*');
        }, 500);
      }
    }
  }
}

function setupBottomLayoutObserver() {
  const updateBottomHeights = () => {
    const bottomControls = document.querySelector(".bottom-controls");
    const roomSelector = document.querySelector(".room-selector");
    
    if (bottomControls && roomSelector) {
      const bottomControlsHeight = bottomControls.offsetHeight;
      const roomSelectorHeight = roomSelector.offsetHeight;
      
      document.documentElement.style.setProperty("--bottom-controls-height", `${bottomControlsHeight}px`);
      document.documentElement.style.setProperty("--room-selector-height", `${roomSelectorHeight}px`);
    }
  };

  updateBottomHeights();

  const resizeObserver = new ResizeObserver(() => {
    updateBottomHeights();
  });

  const bottomControls = document.querySelector(".bottom-controls");
  const roomSelector = document.querySelector(".room-selector");
  
  if (bottomControls) resizeObserver.observe(bottomControls);
  if (roomSelector) resizeObserver.observe(roomSelector);

  window.addEventListener("resize", updateBottomHeights);
  window.addEventListener("orientationchange", updateBottomHeights);
}
