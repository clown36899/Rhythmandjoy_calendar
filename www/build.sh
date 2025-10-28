#!/bin/bash
echo "🔧 환경 변수 주입 중..."

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
console.log('✅ Supabase 환경 변수 로드 완료 (${MODE} 모드)');
EOF

echo "✅ env.js 파일 생성 완료"
echo "📦 배포 준비 완료"
