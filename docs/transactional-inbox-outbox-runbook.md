# 예약 이메일 Transactional Inbox + Outbox 운영 기록

작성일: 2026-08-03  
기준 커밋: `f521b2b` (`Make email handoff transactional`)

이 문서는 네이버·스페이스클라우드 예약 이메일 수집에서 같은 누락을 다시 만들지 않기 위한 설계 기록이자 변경 체크리스트다. 활성 구현은 `ops/rhythmjoy_email_import.py`이고, `ops/naver_booking_googleimport/import_email.py`는 참고용 레거시 코드일 뿐 운영 수집기로 사용하면 안 된다.

## 확인된 과거 구조 문제

두 문제가 동시에 존재했다.

1. 이메일 이벤트, 예약 원장, 상대 플랫폼 작업, 이메일 처리상태를 각각 별도의 autocommit DB 연결로 저장했다. 중간 저장이 실패하면 원장만 있고 Outbox 작업은 없는 반쪽 상태가 가능했다.
2. IMAP 본문을 `(INTERNALDATE RFC822)`로 먼저 전부 가져왔다. `RFC822` 조회는 서버에서 메일을 `\Seen`으로 바꿀 수 있으므로, 앞 메일 처리 실패 시 아직 처리하지 않은 뒤 메일까지 다음 `UNSEEN` 조회에서 사라질 수 있었다.

두 번째 문제는 “메일은 들어왔는데 DB에 없다”는 간헐 누락을 만들 수 있는 직접 경로다. 단순 재정렬이나 사후 DB 보정만으로 해결할 수 없으며, 본문 조회 방식과 트랜잭션 경계를 함께 고쳐야 한다.

## 현재 보장해야 하는 처리 순서

```text
UNSEEN 검색
  → BODY.PEEK[]로 원문 조회(읽음 상태 유지)
  → 수신시각, IMAP 순번 기준 오래된 메일부터 정렬
  → Inbox 이메일 이벤트 영구 저장
  → 트랜잭션 시작
      → 같은 Inbox 행 SELECT ... FOR UPDATE
      → 예약 원장 upsert
      → Outbox 작업 upsert
      → Inbox 처리상태 갱신
    → 전부 commit 또는 전부 rollback
  → commit 성공 후에만 IMAP \Seen 표시
```

적용되는 네 경로는 다음과 같다.

| 원본 이벤트 | 예약 원장 상태 | Outbox 작업 |
|---|---|---|
| 네이버 예약확정 | `confirmed` | `upload` |
| 네이버 예약취소 | `canceled` | `delete` |
| 스페이스클라우드 예약확정 | `confirmed` | `naver_block` |
| 스페이스클라우드 예약취소 | `canceled` | `naver_restore` |

Telegram 알림과 플랫폼 조회 같은 외부 네트워크 호출은 DB 트랜잭션 밖에서 실행한다. 트랜잭션 안에서 외부 호출을 기다리면 잠금 장기화와 불확실한 재시도가 생긴다.

## 절대 깨뜨리면 안 되는 불변조건

1. IMAP 전체 본문 조회는 반드시 `BODY.PEEK[]`를 사용한다. 활성 수집기에 `RFC822` 또는 읽음 상태를 바꾸는 `BODY[]`를 사용하지 않는다.
2. `mark_seen()`은 DB handoff commit 뒤에만 호출한다.
3. 원장, Outbox, Inbox 처리상태는 반드시 같은 `conn`을 전달받아 한 트랜잭션에서 변경한다.
4. 공유 연결을 받은 DB 함수는 예외를 삼키거나 자체적으로 연결을 닫지 않는다. 예외를 바깥 트랜잭션까지 다시 던져 전체 rollback시킨다.
5. 처리 실패 메일은 읽음 처리하지 않는다. 이미 만들어진 Inbox에는 `failed` 상태와 오류를 남기며 다음 주기에 같은 원문을 재시도할 수 있어야 한다.
6. `mail_key`, `ledger_key`, `dedupe_key` 고유키를 제거하지 않는다. commit 뒤 프로세스가 죽어 메일이 다시 들어와도 중복 부작용을 막는 장치다.
7. 네이버 논리 예약은 예약번호를 기준으로 합친다. 스페이스클라우드는 방·날짜·시작·종료·정규화한 예약자 이름을 기준으로 합친다.
8. 이메일 도착시각보다 오래된 확정·취소가 현재 원장 상태를 뒤집지 못하도록 `last_event_at` 비교를 유지한다.
9. 파싱 실패 이메일을 자동으로 정상 처리했다고 표시하지 않는다. Inbox 기록과 감사 경고가 남아야 한다.
10. 운영 기능 플래그가 켜진 경로에서 필수 원장 또는 Outbox가 없으면 fail closed로 중단한다.

## 이메일 기록과 논리 예약 원장의 차이

`rhythmjoy_naver_email_events`는 모든 수신 이메일의 이력이고, `rhythmjoy_booking_ledger`는 논리 예약의 최신 상태다. 따라서 여러 이메일이 하나의 원장으로 합쳐지는 것이 정상이다.

- 같은 네이버 예약번호가 두 번 들어오면 Inbox 행은 두 개일 수 있지만 원장과 `upload` 작업은 하나다.
- 스페이스클라우드에서 예약→취소→재예약이 들어오면 세 Inbox 행이 남고, 하나의 원장이 취소와 최신 재확정 시각을 가진다.
- 원장의 `confirmed_email_event_id`와 `canceled_email_event_id`는 각 상태를 만든 최신 이벤트를 가리킨다. 과거의 모든 이벤트 ID를 나열하는 필드가 아니다.

따라서 누락 감사에서 “모든 Inbox ID가 원장의 최신 이벤트 ID 필드에 직접 남아 있는가”를 사용하면 정상 병합을 누락으로 오판한다. 반드시 원본 payload로 `ledger_key`와 예상 `dedupe_key`를 다시 계산해 논리 예약 단위로 확인한다. 2026-08-03의 100항목 감사에서도 이메일 377/378과 422/430/461이 이 차이 때문에 처음에는 의심 건으로 잡혔지만, 논리키 검증 결과 모두 정상 병합이었다.

## 변경 전 필수 점검

- 활성 수집기가 `ops/rhythmjoy_email_import.py`인지 확인한다.
- 네 운영 플래그와 `RHYTHMJOY_EMAIL_DB_REQUIRED=1`을 확인한다.
- 세 핵심 테이블의 엔진이 모두 InnoDB인지 확인한다.
- DB 변경 함수가 공유 `conn`을 계속 받는지 확인한다.
- 외부 API 호출이 `with db_transaction(...)` 블록 안으로 들어가지 않았는지 확인한다.
- 새 이벤트 유형을 추가하면 원장 상태, Outbox 작업 유형, dedupe 규칙, 감사 규칙을 동시에 추가한다.

로컬 회귀 테스트:

```bash
python3 -m py_compile ops/rhythmjoy_email_import.py ops/rhythmjoy_email_import_selftest.py
python3 ops/rhythmjoy_email_import_selftest.py
git diff --check
```

## 배포 후 필수 점검

운영 DB의 실제 commit/rollback을 검증한다. 이 명령은 `transaction_selftest` 상태의 실행 불가능한 테스트 작업을 사용하고 정확한 고유키로 즉시 정리한다.

```bash
RHYTHMJOY_ENV_FILE=/home/clown313python/myapp/.env \
/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8 \
/home/clown313python/rhythmjoy_ops/rhythmjoy_email_import.py --transaction-selftest
```

다음 결과를 모두 확인한다.

- 의도적 실패에서 Inbox는 `received`로 남고 원장·Outbox·상태변경은 rollback된다.
- 정상 경로에서 Inbox 처리상태·원장·Outbox가 함께 commit된다.
- `tx-selftest:%` 테스트 행이 세 테이블에 0건이다.
- 서비스가 `active`이고 단일 MainPID로 실행된다.
- 최근 Inbox의 `received`, `failed`, `parse_failed`가 0건이다.
- 원본 Inbox가 없는 고아 Outbox가 0건이다.
- 논리키 기준 원장 누락과 Outbox 누락이 0건이다.
- 모든 운영 편지함의 오래된 `UNSEEN`이 0건이다.

전체 반영 감사:

```bash
/home/clown313python/.pyenv/versions/3.8.12/envs/enve/bin/python3.8 \
/home/clown313python/rhythmjoy_ops/rhythmjoy_reflection_audit.py \
--env-file /home/clown313python/myapp/.env --json
```

`issueCount`, `duplicateCount`, `calendarMismatchCount`, `ingestionGapCount`가 모두 0이어야 한다.

## 장애 발생 시 원칙

1. 원본 플랫폼과 이메일, Inbox, 논리 원장, Outbox, 반대 플랫폼 실제 상태, DB 공개 일정 순으로 사실을 확인한다.
2. 이메일 ID 직접 연결만 보고 누락으로 단정하지 말고 논리키로 다시 확인한다.
3. 실제 원본 예약이 없는 것이 확실할 때만 잘못된 원장·작업을 정리한다.
4. 과거 기록도 삭제로 덮지 않는다. 취소 상태와 원본 이메일 이력을 보존해 통계가 흐트러지지 않게 한다.
5. 수동 DB 보정 전에 재발 경로가 코드에 남아 있는지 먼저 찾는다. 사후 데이터만 고치는 작업으로 종료하지 않는다.
6. 수정 뒤에는 성공 경로뿐 아니라 원장 실패, Outbox 실패, 상태변경 실패, commit 직후 종료, IMAP 읽음 실패를 각각 검증한다.

## 2026-08-03 검증 기준점

- 로컬·서버 회귀 테스트 10개 통과
- 서로 다른 구조·경계값·장애주입·중복·운영 점검 100개 통과
- 운영 반영 감사 575/575 정상
- 최근 논리 원장 누락 0건
- 필수 Outbox 누락 0건
- 고아 Outbox 0건
- 운영 편지함 `UNSEEN` 0건
- 운영 반영 커밋 `f521b2b`

이 수치는 이후 데이터가 늘어나면 달라질 수 있다. 고정 숫자 자체가 아니라 누락·불일치·고아·미처리 건수가 0이라는 조건을 유지한다.
