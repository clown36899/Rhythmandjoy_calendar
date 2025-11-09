// 간단한 테스트 버전 - 502 원인 파악용

export async function handler(event, context) {
  console.log('✅ Function 시작됨');
  
  try {
    // 환경 변수 확인
    const hasSupabaseUrl = !!process.env.SUPABASE_URL;
    const hasSupabaseKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    const hasGoogleKey = !!process.env.GOOGLE_CALENDAR_API_KEY;
    
    console.log('환경 변수 체크:', { hasSupabaseUrl, hasSupabaseKey, hasGoogleKey });
    
    // 모듈 import 테스트
    let importStatus = {};
    
    try {
      const { createClient } = await import('@supabase/supabase-js');
      importStatus.supabase = 'OK';
      console.log('✅ Supabase import 성공');
    } catch (e) {
      importStatus.supabase = e.message;
      console.error('❌ Supabase import 실패:', e.message);
    }
    
    try {
      const { google } = await import('googleapis');
      importStatus.googleapis = 'OK';
      console.log('✅ googleapis import 성공');
    } catch (e) {
      importStatus.googleapis = e.message;
      console.error('❌ googleapis import 실패:', e.message);
    }
    
    try {
      const { calculatePrice } = await import('./lib/price-calculator.mjs');
      importStatus.priceCalculator = 'OK';
      console.log('✅ price-calculator import 성공');
    } catch (e) {
      importStatus.priceCalculator = e.message;
      console.error('❌ price-calculator import 실패:', e.message);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Function 정상 작동',
        env: { hasSupabaseUrl, hasSupabaseKey, hasGoogleKey },
        imports: importStatus,
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('❌ 오류:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      })
    };
  }
}
