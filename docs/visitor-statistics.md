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
