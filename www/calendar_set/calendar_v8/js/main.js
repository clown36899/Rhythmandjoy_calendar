let calendar;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 리듬앤조이 일정표 v8 시작');
  
  calendar = new Calendar('calendarContainer');
  window.calendar = calendar;
  
  await calendar.init();
  
  setupAdminButton();
  
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
