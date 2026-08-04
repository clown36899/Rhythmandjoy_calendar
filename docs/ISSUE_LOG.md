# Issue Log

## 2026-08-04 — 입금대기 예약메일 반복 실패 알림

- 상태: 해결
- 현상: 네이버 `입금대기` 예약메일 한 건이 약 1분마다 재처리되며 Telegram에 `Required SpaceCloud upload task was not created` 오류를 반복 전송했다.
- 원인: 결제완료 예약만 SpaceCloud 업로드 대상으로 삼는 기존 정책과, 활성화된 업로드 경로에서 모든 예약메일에 필수 Outbox 생성을 요구하는 트랜잭션 검증이 충돌했다. `입금대기`는 의도대로 업로드 작업 생성을 건너뛰었지만 필수 handoff 실패로 오인되어 메일이 읽음 처리되지 않았다.
- 해결: 결제완료 전 예약메일을 `reservation_pending` / `payment_pending`으로 보존하고 읽음 처리하며, 예약 원장과 SpaceCloud Outbox는 만들지 않도록 분기했다. 결제완료 후 도착하는 별도 메일은 기존 원장·Outbox 트랜잭션 경로를 그대로 사용한다. 과거 자료 백필도 결제대기 예약을 확정 원장으로 만들지 않도록 제외했다.
- 검증: 로컬 및 운영 Python 3.8 환경에서 이메일 파이프라인 자체 테스트 11개가 통과했다. 운영 재처리에서 입금대기 메일은 `payment_pending`으로 종료됐고, 뒤이어 도착한 결제완료 메일은 SpaceCloud 작업 `#462`를 생성했다. 최종 반영 감사는 295/295 정상, 문제 0건, 대기 0건, 중복 0건이었으며 이후 수집 주기 2회도 처리 0건·오류 없이 종료됐다.
- 관련 파일: `ops/rhythmjoy_email_import.py`, `ops/rhythmjoy_email_import_selftest.py`
