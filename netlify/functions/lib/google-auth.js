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

  // JWT 인증 클라이언트 생성
  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/calendar']
  );

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
