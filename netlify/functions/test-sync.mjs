// 최소 동기화 테스트 함수 - import 없이
export async function handler(event, context) {
  try {
    console.log('=== 테스트 시작 ===');
    console.log('HTTP Method:', event.httpMethod);
    console.log('Body:', event.body);
    
    // 환경 변수 확인
    const envCheck = {
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasGoogleKey: !!process.env.GOOGLE_CALENDAR_API_KEY,
      hasServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    };
    
    console.log('환경 변수:', JSON.stringify(envCheck, null, 2));
    
    // body 파싱 테스트
    let selectedRooms = null;
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        selectedRooms = body.rooms;
        console.log('선택된 연습실:', selectedRooms);
      } catch (e) {
        console.error('Body 파싱 실패:', e);
      }
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: '테스트 성공',
        env: envCheck,
        selectedRooms
      }, null, 2)
    };
  } catch (error) {
    console.error('테스트 오류:', error);
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
