# 리듬앤조이 방문자 통계

## 지표 정의

- `오늘`: 한국시간(KST) 당일에 승인된 1st-party 브라우저 식별자 수
- `누적`: 집계를 시작한 뒤 승인된 서로 다른 1st-party 브라우저 식별자 수
- 새로고침과 같은 날의 재방문은 순방문자 수를 늘리지 않고 `page_views`만 늘린다.
- 쿠키 삭제, 다른 브라우저 또는 다른 기기는 새 방문자로 잡힐 수 있으므로 사람 수가 아니라 순방문 브라우저 수다.
- 과거 Google Analytics 수치는 섞거나 추정하지 않는다. 누적값은 이 원장을 배포한 시점부터 시작한다.

## 판정 및 중복 제거

1. 알려진 크롤러·CLI·헤드리스·자동화 UA를 거부한다.
2. 일반 브라우저 형태의 UA만 허용한다.
3. 동일 출처 요청에 서버 서명 challenge를 발급하고, 화면이 실제로 2.5초 이상 보인 뒤에만 확정 요청을 받는다.
4. `navigator.webdriver`, 화면 신호, challenge 만료·변조, 요청 출처를 서버에서 다시 검사한다.
5. 서버가 서명한 `HttpOnly; Secure; SameSite=Lax` 쿠키를 HMAC 처리해 DB 고유키로 사용한다.
6. KST 일자별 고유키와 누적 고유키를 DB 제약으로 중복 제거한다.
7. 쿠키를 계속 지워 숫자를 부풀리는 공격은 일별 네트워크 HMAC의 트랜잭션 잠금 카운터로 제한한다.
8. `RHYTHMJOY_VISITOR_EXCLUDED_IPS`에 등록한 내부 IP/CIDR는 집계하지 않는다.

IAB/GA의 알려진 봇 제외 및 이중 필터링 원칙을 참고한 자체 1st-party 집계다. 유료 IAB 목록 인증이나 사람 신원 확인을 주장하지 않으며, 분산된 실제 브라우저 봇까지 완벽히 구별할 수는 없다. 판정 규칙 버전은 각 DB 행의 `filter_version`에 남는다.

참고 기준: [Google Analytics 알려진 봇 제외](https://support.google.com/analytics/answer/9888366?hl=ko), [IAB Tech Lab Spiders & Bots 안내](https://dev.iabtechlab.com/software/iababc-international-spiders-and-bots-list/)

## DB 테이블

- `rhythmjoy_site_visitors`: 누적 순방문 브라우저 원장
- `rhythmjoy_site_daily_visitors`: 날짜별 순방문 브라우저 및 page view 원장
- `rhythmjoy_site_network_limits`: 같은 네트워크에서 생성되는 신규 식별자의 원자적 일일 상한

원시 IP, 전체 User-Agent, 전체 referrer URL은 저장하지 않는다. IP는 비밀키 HMAC과 KST 날짜를 섞은 일일 키로만 저장되어 날짜가 바뀌면 서로 연결되지 않는다.

## 운영 설정

`/home/clown313python/myapp/.env`에 다음 값을 설정할 수 있다.

```dotenv
RHYTHMJOY_VISITOR_STATS_SECRET=<32자 이상의 별도 랜덤 비밀값>
RHYTHMJOY_VISITOR_EXCLUDED_IPS=203.0.113.7,198.51.100.0/24
RHYTHMJOY_VISITOR_NEW_IDS_PER_IP_DAY=100
```

별도 통계 비밀값이 비어 있으면 기존 `SECRET_KEY`에서 용도 분리된 HMAC 키를 파생한다. 네트워크 상한은 10~1000 사이로 제한된다.

## 검사

```bash
/usr/bin/php www/calendar_set/calendar_v10/visitor-stats.php self-test
RHYTHMJOY_ENV_FILE=/home/clown313python/myapp/.env \
  /usr/bin/php ops/rhythmjoy_visitor_stats_db_selftest.php
```

두 번째 검사는 운영 테이블을 가리는 connection-scoped `TEMPORARY TABLE`만 사용하므로 실제 방문자 행을 만들지 않는다. 배포 복구 절차가 두 검사를 자동으로 실행한다.

## 2026-10-08 공개 홈페이지 통계 표시

- 요청 경로: 홈페이지 하단의 **총·오늘** 버튼 → 기존 `visitor-stats.js`의 스냅샷과
  `visitor-stats.php?action=history&days=7|30|90` 조회 → 날짜별 그래프/표 표시.
  조회 자체에는 방문 기록 쓰기나 외부 예약·문자 부작용이 없다.
- **기존 구현 일부 있음**: `8f3bf12`가 서명 쿠키, 봇/화면 체류 검사, 날짜별 고유키,
  네트워크 제한과 3개 원장 테이블을 도입했다. `7754a1f`가 새 홈페이지에서 집계를
  연결했지만 공개 표시/날짜별 조회가 없었다. 이 두 부분만 기존 소유자에 연결한다.
- 총 방문자는 원장 전체의 서로 다른 브라우저 수이며, 일별 방문자의 합이 아니다.
  기간 내 방문자도 날짜 간 중복을 제거한다. 일별 조회 수는 기존 `page_views`를 그대로
  읽는다. SPA 메뉴 전환 전체를 새 조회로 세거나, GA 수치를 합치지 않는다.
- 과거 원장(기존 캘린더 포함)을 보존한다. 첫 집계 전 날짜는 `null`/‘집계 전’, 이후
  방문이 없는 날짜는 0이다. 공개 응답은 날짜와 합계만 포함하며 IP·식별자·유입 URL을
  공개하지 않는다. 로그인, 새 테이블, 별도 집계기, 작업 큐나 마이그레이션은 없다.
- 공통 생성기 `site-preview/build.py`가 공개 11페이지에만 같은 버튼/대화상자를 넣는다.
  대화상자는 스와이프 교체 영역 밖에 1개만 유지한다. 열린 대화상자 안에서의 제스처는
  홈페이지 메뉴 이동으로 이어지지 않는다. 기존 미리보기의 검색 제외/집계 제외는 유지한다.
- PHP 5.4 운영 런타임에서 기존 필터 자체 검사와 MySQL 임시 테이블 검사를 확장한다.
  같은 브라우저/다음 KST 날짜/조회 수/기간 중복 제거/집계 전·빈 기간/조회 전용/제한 범위를
  검증한다. `ops/visitor_stats_ui_selftest.cjs`는 실제 운영 DB의 읽기 전용 집계 스냅샷으로
  모바일·PC, 기간 변경 경쟁, 오류/재시도, 빈 데이터, 닫기/포커스, SPA 이동을 검사한다.
  기존 스와이프 회귀도 수행한다. 예약 원장·문자·외부 자동화는 변경 경계 밖이므로 제외한다.
- 배포는 위 검사를 마친 코드의 커밋·푸시 후 해당 정적 파일과 통계 PHP/JS만 교체한다.
  서버 백업의 같은 파일을 복원하면 롤백된다. 스키마·환경변수·vhost 변경은 없다.

UI 검사 예시(Playwright와 Chrome 설치 필요):

```bash
VISITOR_HISTORY_FIXTURE=/path/to/aggregate-history.json node ops/visitor_stats_ui_selftest.cjs
```

스냅샷은 `{ "7": <visitor_read_history 결과>, "30": ..., "90": ... }` 형식이다.
개인 방문 행을 내려받지 않고 집계 결과만 사용한다.
