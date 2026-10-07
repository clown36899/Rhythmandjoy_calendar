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

## 2026-10-08 개편 홈페이지 검색 재점검

이 절이 위의 6월 상태/후속 작업을 갱신한다. 검색 순위는 보장하지 않으며,
수집 가능 여부·색인 여부·키워드 노출 실적을 구분한다.

### 변경 전 근거와 판정

- 경로: 검색어 입력 → 검색엔진이 수집·색인한 HTML/대표 URL/링크로 순위 판단 → 검색 결과 노출 → 홈페이지 유입.
  기준은 Search Console URL 검사·실적·사이트맵, Search Advisor 등록 목록, 운영 HTTP 응답이다.
  예약 원장·문자 발송·자동 동기화는 이 경로의 변경 대상이 아니다.
- **기존 구현 일부 있음**: `site-preview/build.py`가 11개 공개 페이지의 제목/설명/본문/canonical/사이트맵을 소유한다.
  기존 LocalBusiness, 네이버 소유확인, GA/GTM도 재사용한다. 별도 SEO 페이지 생성기·DB·큐를 만들지 않는다.
- 이력: `3491434`가 기존 SEO/소유확인/분석을 도입, `521ec27`가 검색 제외 미리보기를 생성,
  `7754a1f`가 10월 8일 02:41 이후 공개 루트와 11개 정적 페이지로 연결했다.
  `470bf1e`/`c6a53ea`의 호스트·구버전 라우팅은 기존 캘린더 호환 및 인증서 갱신을 보호한다.

| 점검 경계 | 확인한 결과 / 조치 |
| --- | --- |
| Google 색인 | 대표 `/`는 색인되어 있고 선언/선택 canonical이 일치. 미등록 전체 차단 상태가 아님 |
| 실제 키워드 실적 | Search Console 2026-07-05~10-04: 전체 130회 노출/26클릭. 공개 검색어 행 중 `사당 연습실` 1회 노출/0클릭/평균 3.0. 한 건이므로 지속적인 3위라는 뜻이 아니며 익명 처리된 검색어는 표에 나타나지 않음 |
| 최근 수집 시점 | URL 검사: 2026-10-08 01:35:21, 스마트폰 Googlebot, 가져오기 성공. 새 홈페이지 공개 전이므로 개편 효과를 이미 평가한 수치가 아님 |
| Google 사이트맵 | 기존 `/sitemap.xml` 등록은 있었으나 마지막 읽기 2026-04-02, 발견 페이지 1개. 개편 11개 페이지 재제출 필요 |
| Naver 속성 | 계정에 HTTP 주소만 등록. HTTPS 속성 추가와 기존 소유확인 태그 재사용 진행. 보안문자 단계는 사용자 확인 대기 |
| 수집 차단 | 공개 홈페이지/룸/robots/sitemap에 Googlebot·Yeti UA + 정상 Accept 헤더로 200. 공개 HTML noindex 없음. 이는 UA 응답 점검이며 검색엔진 전체 색인을 보장하는 검사가 아님 |
| 대표 주소 | HTTP 302, www·index.html·물리 생성 경로가 중복 200. 도메인 전용 vhost에서 HTTPS/non-www/clean path로 301 통일 |
| 본문/내부 링크 | 11개 페이지가 JavaScript 실행 전 HTML에 실제 사진·룸 크기·요금·주소와 일반 href 링크 포함. `사당연습실`/`사당 연습실`/`리듬앤조이` 이미 포함 |
| 검색 표시 정보 | 기존 LocalBusiness 보존, 홈 WebSite 이름 정보 및 보이는 탐색경로와 일치하는 BreadcrumbList 보완. 클라이언트 이동 때도 도착 페이지 구조화 데이터로 갱신 |
| 수정일 | 사이트맵 lastmod는 실제 개편일 2026-10-08. 빌드 실행일이나 실시간 예약 변경 시각으로 부풀리지 않음 |
| 경쟁 사이트 | 네이버 `사당연습실` 결과에 에이블의 imweb 하위 도메인과 공간·요금 하위 링크가 보임. 키워드 한글 도메인 구매가 노출의 필수조건이라는 근거는 없음 |
| Google 매장 | 기존 열린 탭의 인증 대기 표시는 오래된 상태였다. business.google.com에서 새 진입한 관리 화면에는 정상 매장 패널과 공식 홈페이지 링크가 표시됨 |
| Naver 플레이스 | 공개 홈에는 블로그 링크만 표시. 공식 홈페이지 링크 누락 확인 및 기존 업체정보 화면 점검 |
| 성능 | Search Console 코어 웹 바이탈은 실사용 데이터 없음. 속도가 현재 순위의 원인이라고 단정하지 않음. 기존 사진 decode/메모리 재사용·스와이프 보존 |

### 수정 경계와 검증

- 공개/미리보기 생성 소유자는 기존 `build.py` 하나. 기존 가격·사업장 데이터 재사용.
- 도메인 전용 vhost만 변경. 다른 도메인의 공용 DocumentRoot, v10 캘린더, 독립 v11,
  예약 원장, events.json 동기화, no-store 보호, ACME 인증서 경로 보존.
- 기존 `site_preview_swipe_selftest.cjs`를 확장하여 공개 11개 페이지의 구조화 데이터와
  이동 후 일치 여부를 검증. 기존 70개 제스처/실패 복구/방문통계 보호에 사이트맵 검사 1개 추가.
- 배포 전 커밋/푸시, Apache 후보 설정 구문검사, 배포 후 HTTP/www/index/물리 경로/query 보존,
  공개 HTML/사이트맵/미리보기 noindex/레거시 캘린더를 검사한다.
- 예약 저장·발송·수집기 회귀는 변경하지 않은 경계이므로 실행하지 않는다. SEO 확인을 위해
  예약을 생성하거나 운영 데이터를 변경하지 않는다.

### 공식 근거와 후속 판단 기준

- [네이버 수집·색인·랭킹 단계](https://searchadvisor.naver.com/guide/report-crawl-refine)
- [네이버 사이트 등록은 수집/노출 자체의 필수조건이 아님](https://searchadvisor.naver.com/guide/faq-start-register)
- [네이버 콘텐츠: 정확한 제목과 고유한 본문, 반복 키워드 지양](https://searchadvisor.naver.com/guide/content-basic)
- [네이버 수집 요청은 즉시 방문/노출 보장이 아님](https://searchadvisor.naver.com/guide/request-crawl)
- [Google SEO: 키워드 도메인 효과는 작으며 meta keywords는 사용하지 않음](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google 대표 URL 통일](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google 사이트 이름](https://developers.google.com/search/docs/appearance/site-names)
- [Google 사이트맵 수정일·제출](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google 지역 검색의 관련성·거리·인지도](https://support.google.com/business/answer/7091?hl=ko)

추가 도메인 구매보다 기존 주소의 수집 갱신·콘텐츠 평가·공식 채널 연결을 우선한다.
키워드별 복제 페이지, 숨김 텍스트, 임의 평점/리뷰, 키워드 반복, 유료 광고 집행은 추가하지 않는다.
다음 평가에서는 재수집 날짜가 개편 이후인지, 11개 정적 페이지가 발견/색인되는지,
`사당연습실`·`사당 연습실`·`리듬앤조이` 각각의 28일 노출/클릭이 증가하는지 비교한다.
새벽 대관 SMS 문구, 예약 메뉴 집중, 로고 제거, 00~06시 요금과 기존 스와이프는 유지한다.

실행 중 확인: 정적 11개 페이지의 H1/내부 링크/이미지 비드래그 검사 및 기존 확장 selftest 71개 통과.
Apache 후보 설정 `httpd -t` 통과. 네이버 스마트플레이스 부가정보에 공식 HTTPS 홈페이지 URL을 추가해 저장했으며 기존 블로그 링크를 유지했다.
