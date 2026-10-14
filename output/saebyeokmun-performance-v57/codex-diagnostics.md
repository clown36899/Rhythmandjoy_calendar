# Codex 프로젝트 화면 부하 진단 — 2026-10-12

최초 측정에서 Codex Renderer PID5561 CPU221.1%, 이후5.8/9.1/5.6%로 내려감. 도구로 본 Codex In-app Browser와 MCP Apps 탭 수는0이라 당시 프로젝트 화면 부하를 게임 탭 실행만으로 설명할 수 없다. 같은 시점 Steam web helper 약87~110%, Wine server 약46~58%의 별도 부하도 관측했다. 해당 앱들을 종료하거나 시스템 설정을 바꾸지 않았다.

공식 OpenAI troubleshooting 문서의 로그 위치만 사용해 현재 실행/현재 날짜 app 로그를 읽었다. ResizeObserver loop completed with undelivered notifications 오류64회가02:02:54~02:16:38 UTC에 기록됐다. 렌더러의3초 OS sample에서 main-thread sample517개 중502개는 mach_msg2_trap의 대기 경로였고 footprint926.1MB/peak1.2GB였다. 단시간 idle sample은 앞선221% spike의 세부 원인을 확정하지 못한다. 심볼 없는 V8 이름으로 특정 JS 함수나 게임 코드 문제를 단정하지 않는다.

경로: 프로젝트 화면 표시/창 크기 또는 새 메시지 → 닫힌 소스의 UI resize/layout 판정 → 반복 ResizeObserver 알림과 화면 렌더 → 앱 renderer CPU spike/큰 메모리. 관련 오류만 조사했으며 프로젝트/전체 로그/사용자 설정을 형식적으로 모두 조사하지 않았다. 원인 후보는 앱 레이아웃 재계산이며 큰 대화/이미지 이력과의 관계는 확인되지 않은 추정이다. 앱의 소유 코드나 해당 호출부/테스트/git 이력에는 접근할 수 없어 app 자체 수정은 하지 않았다.

컴퓨터 사용 도구는 com.openai.codex 앱 제어를 허용하지 않아 우회하지 않았다. 강제 종료·캐시 삭제·GPU/보안 flag 변경·로그 외부 제출을 하지 않았고 사용자 자료를 보존했다. 앱 문제가 재발하면 작업 완료 후 정상 재시작하거나 더 짧은 새 대화에서 비교하는 게 다음 재현 경계다. 공식 안내: https://learn.chatgpt.com/docs/reference/troubleshooting

실제 개선한 게임 부하는별도 비교: 기존 Phaser fps.limit 설정을60으로 연결해50아군/10적 조건에서 브라우저 작업시간 약35.4% 감소, 실제 모델 시계3초 유지. game-profile.json과 review-v57.md에 근거를 저장한다. 이것으로 Codex 프로젝트 관리의 오류 또는 컴퓨터 팬 소음이 해결됐다고 주장하지 않는다.
