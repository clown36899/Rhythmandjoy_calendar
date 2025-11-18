let calendar;

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 리듬앤조이 일정표 v8 시작");

  calendar = new Calendar("calendarContainer");
  window.calendar = calendar;

  await calendar.init();

  setupAdminButton();
  setupInfoButton();
  setupBottomLayoutObserver();

  console.log("✅ 초기화 완료");
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
  const iframe = document.getElementById("infoPageFrame");
  
  // iframe src 설정 (처음 열 때만)
  if (!iframe.src) {
    iframe.src = "./home_infopage/homepage-section_mobile.html";
  }
  
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

function setupBottomLayoutObserver() {
  const updateBottomHeights = () => {
    const bottomControls = document.querySelector(".bottom-controls");
    const roomSelector = document.querySelector(".room-selector");
    
    if (bottomControls && roomSelector) {
      const bottomControlsHeight = bottomControls.offsetHeight;
      const roomSelectorHeight = roomSelector.offsetHeight;
      
      console.log("📏 [높이측정] bottom-controls:", bottomControlsHeight + "px");
      console.log("📏 [높이측정] room-selector:", roomSelectorHeight + "px");
      console.log("📏 [높이측정] 합계:", (bottomControlsHeight + roomSelectorHeight) + "px");
      
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
