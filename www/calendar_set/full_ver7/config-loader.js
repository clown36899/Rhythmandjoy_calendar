// 서버에서 환경 설정을 로드하는 공용 모듈
(async function() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname.includes('replit');
  
  try {
    // Replit 로컬 환경에서는 API 호출 건너뛰기
    if (isLocal) {
      throw new Error('Replit 환경: env.js 직접 사용');
    }
    
    // 1단계: 서버 API로 환경변수 가져오기 시도 (배포 환경)
    const baseUrl = '/.netlify/functions';
    
    const response = await fetch(`${baseUrl}/get-config`, { timeout: 3000 });
    
    if (response.ok) {
      const config = await response.json();
      
      window.SUPABASE_URL = config.supabaseUrl;
      window.SUPABASE_ANON_KEY = config.supabaseAnonKey;
      window.GOOGLE_CALENDAR_API_KEY = config.googleCalendarApiKey;
      
      console.log('✅ 환경 설정 로드 완료 (서버 API)');
      return;
    }
  } catch (error) {
    console.warn('⚠️ 서버 API 연결 실패, 로컬 env.js 사용:', error.message);
  }
  
  // 2단계: 로컬 env.js 파일 사용 (개발 환경)
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'env.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    
    if (window.SUPABASE_URL) {
      console.log('✅ 환경 설정 로드 완료 (로컬 env.js)');
      return;
    }
  } catch (error) {
    console.warn('⚠️ env.js 파일 로드 실패');
  }
  
  // 3단계: Fallback (하드코딩된 값)
  window.SUPABASE_URL = 'https://izcdhoozlvcmjcbnvwoe.supabase.co';
  window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6Y2Rob296bHZjbWpjYm52d29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2MjgyNjUsImV4cCI6MjA3NzIwNDI2NX0.W32NXxZoFhcWnVX9PqsHtSwxSPm1RFqnWI71wNigcE4';
  console.warn('⚠️ Fallback 설정 사용 중 (읽기 전용)');
})();
