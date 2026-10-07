# 연습실 홈페이지 구조 미리보기

기존 Cafe24 계정에 별도 경로 `/calendar_set/calendar_v10/site-preview/`로 공개한다. 로그인은 추가하지 않는다. 운영 홈·메뉴·사이트맵에서 연결하지 않고 문서와 HTTP 응답에 `noindex,nofollow,noarchive`를 설정한다. 주소를 알고 있으면 접속할 수 있다.

## 구조와 데이터 소유

기존 구현은 **일부 있음**이다. 기존 v10 안내 자료·요금표·사진·달력·공개 예약 캐시와 로컬 `server.py`를 재사용한다. 빠진 부분인 독립 주소의 소개·공간·요금·위치·이용 안내만 이 디렉터리에서 소유한다.

- `build.py`: 기존 `home_infopage/homepage-section_mobile.html` 요금, `popup_info.html` 크기를 읽어 정적 HTML 12개를 생성한다. 사진은 원래 경로를 참조한다.
- `calendar.html`: 기존 `calendar_10.html`에서 생성한다. 분석 태그·canonical·alternate만 제거하고 검색 제외와 드래그 방지를 넣는다. 달력 런타임과 `server-calendar-sync.js`는 기존 파일을 직접 사용한다.
- 예약 조회 경로: 미리보기 `/schedule/` → `calendar.html` → 기존 `server-calendar-sync.js` → 기존 `/calendar_set/calendar_v10/data/events.json`. 운영 DB 원장에서 생성된 공개 캐시를 조회하며 새 DB·스키마·작업 큐·캐시 소유자는 없다.
- 기존 보호 목적은 DB 원장을 기준으로 한 공개 캐시 조회와 예약 변경 경로의 분리다. 동일한 조회 경로를 유지하며 예약 생성·취소·SMS를 실행하지 않는다.
- 생성 파일은 직접 편집하지 않고 `build.py`에서 재생성한다. `style.css`와 `site.js`가 새 소개 UI를 담당한다. 비드래그 이미지·링크의 기본 드래그는 막는다.

## 빌드와 로컬 실행

```sh
python3 www/calendar_set/calendar_v10/site-preview/build.py
python3 www/calendar_set/calendar_v10/site-preview/serve.py
```

로컬 주소는 `http://localhost:5088/`. 서버는 기존 정적 파일 핸들러를 재사용한다. 로컬에서는 로컬 `data/events.json`을 읽고 Cafe24에서는 운영 공개 캐시를 읽는다. 실제 데이터 확인 기준은 배포 주소다.

## 배포·복구 경계

작업 디렉터리만 커밋·푸시한 뒤 canonical target 설정 `ops/cafe24-production-target.env`의 호스트·APP_ROOT를 검증한다. 그 아래 `calendar_set/calendar_v10/site-preview/`에 HTML·CSS·JS·`.htaccess`만 전송한다. 전체 `deploy-cafe24.sh`는 전체 복구 및 서비스 변경까지 실행하므로 이 정적 미리보기 배포에는 사용하지 않는다. Python·README·로컬 캐시는 업로드하지 않는다.

새 경로 최초 배포이며 기존 홈·Apache 전역 설정·서비스·예약 캐시는 변경하지 않는다. 롤백은 이 디렉터리를 웹 루트 밖으로 이동하면 된다. DB 마이그레이션은 없다.

## 검증 범위

12개 독립 페이지와 정적 참조의 HTTP 성공, 페이지별 고유 제목·H1·검색 제외, PC/모바일 폭, 이미지 드래그 방지, 실제 달력 표시 및 룸 필터를 확인한다. 배포 전후 운영 홈 HTML과 원래 캐시 로더의 해시가 같아야 한다. 데이터 조회만 연결하므로 실제 예약·취소·문자 발송 회귀 동작은 실행하지 않는다.
