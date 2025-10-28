# 리듬앤조이 연습실 예약 시스템

## 프로젝트 개요
리듬앤조이 음악 연습실의 예약 일정을 표시하는 웹 애플리케이션입니다.
- **유형**: 정적 웹사이트 (HTML/JavaScript/CSS)
- **주요 기능**: Google Calendar 연동 캘린더, 연습실 예약 현황 확인
- **언어**: JavaScript, HTML, CSS (한국어 UI)

## 프로젝트 구조
```
.
├── server.py                    # Python HTTP 정적 파일 서버
├── www/                         # 웹 루트 디렉토리
│   ├── index.html              # 메인 페이지 리디렉션
│   └── calendar_set/full_ver7/  # 메인 애플리케이션
│       ├── calendar_7.html      # 메인 캘린더 페이지
│       ├── fullcal.js          # 캘린더 로직
│       ├── fullcal_02.js       # 추가 캘린더 기능
│       ├── style.css           # 메인 스타일
│       ├── packages/           # FullCalendar 라이브러리
│       ├── home_infopage/      # 홈페이지 정보 섹션
│       ├── img/                # 이미지 리소스
│       └── js/                 # JavaScript 라이브러리
```

## 주요 기술 스택
- **Frontend**:
  - FullCalendar (Google Calendar 연동)
  - jQuery & jQuery UI
  - Bootstrap 5
  - Font Awesome 6.5.1

- **Backend**:
  - Python 3.11 (정적 파일 서버)
  - 포트: 5000

## 연습실 정보
- **A홀** - 노란색 (#F6BF26)
- **B홀** - 파란색 (rgb(87, 150, 200))
- **C홀** - 청록색 (rgb(129, 180, 186))
- **D홀** - 초록색 (rgb(125, 157, 106))
- **E홀** - 회색 (#4c4c4c)

## 실행 방법
1. **개발 환경**: 
   - 워크플로우 "웹서버"가 자동으로 실행됩니다
   - 브라우저에서 자동으로 프리뷰가 표시됩니다

2. **수동 실행**:
   ```bash
   python3 server.py
   ```

## 배포 설정
- **배포 타입**: Autoscale (정적 웹사이트용)
- **실행 명령**: `python3 server.py`
- **포트**: 5000

## 최근 변경사항 (2025-10-28)
- Replit 환경에 맞게 프로젝트 설정
- Python HTTP 서버 구성 (캐시 무효화 헤더 포함)
- Font Awesome integrity 오류 수정 (6.5.1로 업데이트)
- 동적 로드 HTML 파일의 중복 CSS 링크 제거
- 포트 재사용 문제 해결 (SO_REUSEADDR 설정)

## 주의사항
- Google Calendar API를 사용하여 실시간 예약 현황을 표시합니다
- 브라우저 캐시 문제를 방지하기 위해 서버에서 no-cache 헤더를 설정했습니다
- 모든 정적 파일은 `www/` 디렉토리에서 제공됩니다

## 문제 해결
### 서버가 시작되지 않을 때
- 포트 5000이 이미 사용 중인지 확인
- 워크플로우를 재시작해보세요

### 캘린더가 표시되지 않을 때
- 브라우저 개발자 도구에서 콘솔 오류 확인
- Google Calendar API 키가 올바른지 확인

## 라이선스
이 프로젝트는 리듬앤조이 연습실의 소유입니다.
