# 리듬앤조이 홍보/검색/분석 개선 기록

작성일: 2026-06-15

## 현재 상태 요약

- 브랜드 검색인 `리듬앤조이`, `리듬앤조이 연습실`은 공식 일정표 사이트가 상위에 노출된다.
- 일반 수요 검색인 `사당연습실`, `사당역 연습실`, `사당 댄스연습실`은 경쟁 연습실/공간대여 플랫폼이 먼저 잡히는 편이다.
- 운영 사이트는 예약 캘린더/안내/가격/지도/환불 정보가 이미 잘 모여 있지만, 검색엔진에 주는 대표 제목/설명/구조화 데이터/크롤러 안내가 부족했다.
- 외부 플랫폼(네이버 플레이스, 스페이스클라우드, 인스타그램, 블로그)은 운영자가 직접 관리해야 하므로 이 문서는 사이트 코드에서 처리 가능한 부분만 다룬다.

## 이번에 반영한 사이트 개선

- 대표 캘린더 페이지 제목을 `사당연습실 리듬앤조이 | 실시간 예약 캘린더`로 변경했다.
- 대표/모바일 페이지에 description, canonical, Open Graph, robots, 네이버 소유확인 메타를 정리했다.
- LocalBusiness 구조화 데이터로 상호, 주소, 전화번호, 영업시간, 연결 사이트를 명시했다.
- FAQPage 구조화 데이터로 예약 방법, 위치, 주차, 새벽 통대관, 이용 용도를 명시했다.
- `robots.txt`를 추가하고 `sitemap.xml`에 최신 수정일을 추가했다.
- 안내 공유 URL을 내부 파일 경로가 아니라 대표 주소 `/` 기준으로 통일했다.
- SwipeCalendar 내부 observer가 비정상 대상에 붙을 때 나는 콘솔 오류를 방어하는 가드를 추가했다.
- `browser-guards.js`를 추가해 MutationObserver 대상이 비정상일 때 전체 페이지 오류로 번지지 않게 했다.

## 방문/사용/연결 추적

추적 스크립트: `www/calendar_set/calendar_v10/tracking.js`

추적 방식:

- 기존 GA4/GTM 설치를 그대로 사용한다.
- `gtag("event", ...)`와 `dataLayer.push(...)`를 함께 보낸다.
- 안내 iframe 안에서 발생한 클릭은 부모 페이지로 `postMessage`를 보내 부모 페이지의 GA/GTM에서 함께 기록한다.
- 이름/전화번호/예약자 정보 같은 개인정보는 저장하지 않는다.

현재 기록하는 이벤트:

- `site_visit_ready`: 페이지 준비 완료, 유입 referrer, 랜딩 URL, 화면 크기, 딥링크 섹션
- `naver_booking_click`: 네이버 예약 이동
- `naver_my_click`: 네이버 MY 예약 확인/취소 이동
- `naver_map_click`: 네이버 지도 이동
- `phone_click`: 전화 링크 클릭
- `sms_click`: 문자 링크 클릭
- `naver_blog_click`: 네이버 블로그 이동
- `booking_info_open`: 예약 정보 패널 열기
- `phone_copy_click`: 전화번호 복사
- `guide_share_click`: 안내 공유 버튼 클릭
- `guide_section_click`: 안내 탭 이동
- `guide_menu_click`: 데스크톱 안내 메뉴 클릭
- `gallery_open`: 시설/룸 사진 열기
- `calendar_view_click`: 월/주 보기 전환
- `calendar_nav_click`: 이전/오늘/다음 이동
- `room_focus_click`: 특정 룸 버튼 선택
- `room_toggle_click`: 룸 표시 토글

확인 위치:

- GA4 관리자/보고서의 Events 또는 DebugView에서 `rhythmjoy_*` 또는 위 이벤트 이름을 확인한다.
- GTM을 쓸 경우 dataLayer 이벤트 이름은 `rhythmjoy_이벤트명` 형태로 들어간다.
- 배포 후 최소 확인 항목: 네이버예약 클릭, 지도 클릭, 안내 탭 클릭, 룸 토글 클릭.

## 다음 개선 우선순위

1. GA4에서 위 이벤트가 실제로 들어오는지 확인하고, `naver_booking_click`을 전환 이벤트로 지정한다.
2. 예약 정보 패널의 첫 화면에서 `사당역 7번 출구 1분`, `A-E홀`, `실시간 예약`, `네이버 즉시 예약` 문구가 더 잘 보이게 조정한다.
3. Search Console/네이버 서치어드바이저에 sitemap 제출 후 `사당연습실`, `사당역 연습실`, `리듬앤조이` 검색어 변화를 주기적으로 기록한다.
4. 내부 안내 페이지를 별도 정적 SEO 페이지로 분리할지 검토한다. 지금은 캘린더 앱 중심이라 검색엔진이 렌더링을 해야 내용을 충분히 읽는다.
5. 광고를 집행한다면 먼저 소액으로 `사당연습실`, `사당역 연습실`, `사당 댄스연습실` 키워드만 테스트하고 `naver_booking_click` 기준으로 판단한다.

## 배포 후 점검 체크리스트

- `https://xn--xy1b23ggrmm5bfb82ees967e.com/robots.txt`가 200으로 열리는지 확인한다.
- `https://xn--xy1b23ggrmm5bfb82ees967e.com/sitemap.xml`에 `2026-06-15` lastmod가 보이는지 확인한다.
- 사이트 제목이 `사당연습실 리듬앤조이 | 실시간 예약 캘린더`로 잡히는지 확인한다.
- 예약 정보 딥링크 `/?openInfo=true&section=map`이 안내 패널을 열고 오시는길 섹션으로 이동하는지 확인한다.
- GA4 DebugView 또는 실시간 이벤트에서 `site_visit_ready`, `naver_booking_click`, `guide_section_click`이 들어오는지 확인한다.
