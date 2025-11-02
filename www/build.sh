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

echo "✅ 환경 변수는 Netlify Functions를 통해 제공됩니다"
echo "📦 배포 준비 완료"
