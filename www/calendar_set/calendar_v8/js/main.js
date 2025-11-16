let calendar;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 리듬앤조이 일정표 v8 시작');
  
  calendar = new Calendar('calendarContainer');
  window.calendar = calendar;
  
  await calendar.init();
  
  setupAdminButton();
  setupAutoScale();
  
  console.log('✅ 초기화 완료');
});

function setupAdminButton() {
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) {
    adminBtn.addEventListener('click', () => {
      window.location.href = '../full_ver7/admin.html';
    });
  }
}

function setupAutoScale() {
  const wrapper = document.querySelector('.scale-wrapper');
  
  function updateScale() {
    // 달력의 최소 크기 (픽셀)
    const minWidth = 800;
    const minHeight = 600;
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // 화면이 최소 크기보다 작으면 축소
    const scaleX = viewportWidth < minWidth ? viewportWidth / minWidth : 1;
    const scaleY = viewportHeight < minHeight ? viewportHeight / minHeight : 1;
    const scale = Math.min(scaleX, scaleY);
    
    wrapper.style.transform = `scale(${scale})`;
    
    console.log(`📏 Scale: ${scale.toFixed(2)}, Viewport: ${viewportWidth}x${viewportHeight}`);
  }
  
  updateScale();
  window.addEventListener('resize', updateScale);
  window.addEventListener('orientationchange', () => {
    setTimeout(updateScale, 100);
  });
}
