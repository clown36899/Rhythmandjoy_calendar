// Google Service Account 인증 모듈
import { google } from 'googleapis';

let cachedAuth = null;

export function getGoogleAuth() {
  if (cachedAuth) {
    return cachedAuth;
  }

  // Netlify 환경 변수에서 Service Account JSON 파싱
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  
  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 환경 변수가 설정되지 않았습니다');
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패: ' + error.message);
  }

  // 🔍 디버깅: 파싱된 값 확인
  console.log('📋 환경 변수 디버깅:');
  console.log('  - serviceAccountJson 존재:', !!serviceAccountJson);
  console.log('  - serviceAccountJson 길이:', serviceAccountJson?.length);
  console.log('  - credentials 객체:', !!credentials);
  console.log('  - client_email:', credentials?.client_email);
  console.log('  - private_key 존재:', !!credentials?.private_key);
  console.log('  - private_key 길이:', credentials?.private_key?.length);
  console.log('  - private_key 시작:', credentials?.private_key?.substring(0, 50));

  // ⚠️ 검증
  if (!credentials.client_email) {
    throw new Error('client_email이 없습니다!');
  }
  if (!credentials.private_key) {
    throw new Error('private_key가 없습니다!');
  }

  // JWT 인증 클라이언트 생성
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });

  cachedAuth = auth;
  return auth;
}

export function getCalendarClient() {
  const auth = getGoogleAuth();
  return google.calendar({ 
    version: 'v3', 
    auth,
    key: process.env.GOOGLE_CALENDAR_API_KEY // API Key 추가
  });
}
