#!/bin/bash
echo "🔧 환경 변수 주입 중..."

cat > calendar_set/full_ver7/env.js << EOF
// Netlify 빌드 시 자동 생성되는 환경 변수 파일
window.SUPABASE_URL = '${SUPABASE_URL}';
window.SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
console.log('✅ Supabase 환경 변수 로드 완료');
EOF

echo "✅ env.js 파일 생성 완료"
echo "📦 배포 준비 완료"
