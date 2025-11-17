// 로컬 개발용 환경 변수 파일
window.SUPABASE_URL = 'https://izcdhoozlvcmjcbnvwoe.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6Y2Rob296bHZjbWpjYm52d29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2MjgyNjUsImV4cCI6MjA3NzIwNDI2NX0.W32NXxZoFhcWnVX9PqsHtSwxSPm1RFqnWI71wNigcE4';
window.GOOGLE_CALENDAR_API_KEY = 'AIzaSyCLqM39X5vTjrNt1Vl5miRryXWkLYPqky8';
window.ENV = { ADMIN_PASSWORD: 'admin123' };

// 개발/프로덕션 모드 설정 (localhost이면 개발, 아니면 프로덕션)
window.IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// 개발 모드에서만 로그 출력하는 헬퍼
window.devLog = function(...args) {
  if (window.IS_DEV) {
    console.log(...args);
  }
};

if (window.IS_DEV) {
  console.log('✅ 로컬 환경 변수 로드 완료 (개발 모드)');
}
