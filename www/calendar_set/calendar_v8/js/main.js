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
      window.location.href = "./home_infopage/homepage-section_mobile.html";
    });
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
