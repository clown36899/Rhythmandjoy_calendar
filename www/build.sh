#!/bin/bash
echo "🔧 환경 변수 주입 중..."

# Netlify Functions 패키지 설치
if [ -n "$NETLIFY" ]; then
  echo "📦 Functions 패키지 설치 중..."
  cd ../netlify/functions
  npm install --production
  cd ../../www
fi

# Netlify 환경인지 확인
if [ -n "$NETLIFY" ]; then
  echo "📦 Netlify 프로덕션 빌드"
  MODE="production"
else
  echo "🔨 로컬 개발 빌드"
  MODE="development"
fi

cat > calendar_set/full_ver7/env.js << EOF
// Netlify 빌드 시 자동 생성되는 환경 변수 파일
window.SUPABASE_URL = '${SUPABASE_URL}';
window.SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
window.GOOGLE_CALENDAR_API_KEY = '${GOOGLE_CALENDAR_API_KEY}';
window.ENV = { ADMIN_PASSWORD: '${ADMIN_PASSWORD}' };
console.log('✅ Supabase 환경 변수 로드 완료 (${MODE} 모드)');
EOF

echo "✅ env.js 파일 생성 완료"
echo "📦 배포 준비 완료"
