// 서버에서 환경 설정을 로드하는 공용 모듈
(async function() {
  try {
    const baseUrl = (window.location.hostname === 'localhost' || window.location.hostname.includes('replit'))
      ? 'http://localhost:8888/.netlify/functions'
      : '/.netlify/functions';
    
    const response = await fetch(`${baseUrl}/get-config`);
    const config = await response.json();
    
    // 전역 변수로 설정 (Supabase 클라이언트 초기화용)
    window.SUPABASE_URL = config.supabaseUrl;
    window.SUPABASE_ANON_KEY = config.supabaseAnonKey;
    window.GOOGLE_CALENDAR_API_KEY = config.googleCalendarApiKey;
    
    console.log('✅ 환경 설정 로드 완료');
  } catch (error) {
    console.error('❌ 환경 설정 로드 실패:', error);
    // Fallback to hardcoded values
    window.SUPABASE_URL = 'https://izcdhoozlvcmjcbnvwoe.supabase.co';
    window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6Y2Rob296bHZjbWpjYm52d29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2MjgyNjUsImV4cCI6MjA3NzIwNDI2NX0.W32NXxZoFhcWnVX9PqsHtSwxSPm1RFqnWI71wNigcE4';
    console.warn('⚠️ Fallback 설정 사용 중');
  }
})();
