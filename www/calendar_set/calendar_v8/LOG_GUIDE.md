# 로그 시스템 사용 가이드

## 개요

이 애플리케이션은 파일 기반 로그 시스템을 사용합니다. 일반적인 디버그 로그는 콘솔에 출력되지 않으며, 에러와 중요한 정보만 localStorage에 기록됩니다.

## 로그 조회 방법

### 브라우저 콘솔에서 확인

1. **모든 로그 보기**
   ```javascript
   viewLogs()
   ```

2. **에러만 보기**
   ```javascript
   viewLogs('ERROR')
   ```

3. **경고만 보기**
   ```javascript
   viewLogs('WARN')
   ```

4. **정보만 보기**
   ```javascript
   viewLogs('INFO')
   ```

### 로그 파일 다운로드

```javascript
downloadLogs()
```

위 명령을 실행하면 `rhythmjoy-logs-YYYY-MM-DD.txt` 형식의 파일이 다운로드됩니다.

### 로그 삭제

```javascript
clearLogs()
```

## 로그 레벨

- **ERROR**: 에러 발생 시 (예: DB 연결 실패, API 오류)
- **WARN**: 경고 (예: 비정상적인 상황)
- **INFO**: 중요 정보 (예: 초기화 완료, 주요 작업 완료)

## 로그 저장 위치

로그는 브라우저의 localStorage에 저장됩니다:
- 키: `rhythmjoy_logs`
- 최대 1,000개 항목 유지
- 용량 초과 시 오래된 로그부터 자동 삭제

## 성능 최적화

- `console.log()`, `console.info()`, `console.warn()`은 모두 비활성화됨
- `console.error()`만 logger로 기록 및 콘솔 출력
- 디버그 로그가 없어 브라우저 부하 크게 감소

## 주의사항

- localStorage 용량 제한(일반적으로 5-10MB)이 있으므로, 장기간 사용 시 주기적으로 로그를 다운로드하고 삭제하는 것을 권장합니다.
- 개인정보나 민감한 정보가 로그에 기록되지 않도록 주의하세요.
