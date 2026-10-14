# v57 — 고주사율 화면의 불필요한 프레임 제한

수정 전 경로: 페이지 실행 → makeGame의 Phaser3.90 TimeStep(config) → limit 기본0/모니터 RAF 빈도 → Scene update·model.step·canvas render/UI → 같은 장면을 초당 약120회 처리. 기존 scene.js887의 Game 설정과 직접 Scene/model/app 호출부, 관련 pause/attack/motion/합동/경제 테스트 및26089fd2 git blame/log만 확인했다. 이 설정은 low-power GPU와 선명한 그림, 단일 게임·오디오 소유자 및 시간 기반 전투를 유지하기 위한 것이며 기존 target 기본60은 상한이 아니다.

판정: 기존 구현 있음. Phaser TimeStep의 fps.limit는3.60부터 있는 설정이며3.90.0 공식 source에서 확인했다. 새 프레임 scheduler·성능 상태·DB·큐·프로파일 객체를 제품에 만들지 않는다. Game 기존 설정에 fps:{target:60,limit:60}만 연결하고 cache query를 v57로 바꾼다. library private field나 시스템 GPU/보안 설정을 바꾸지 않는다. 저해상도/화질 축소/캐릭터 모션 생략은 없다.

유지한 불변조건: RoadScene의 실시간 delta와 기존 .05초 cap, 모델의 이동/공격·치료 판정·cooldown/일시정지, v56 의녀 제자리 완전치료·궁병5회/실제5번째 적중 및 viewport 확인·사격 위치 유지·기병 동일 ID 복귀, 체력/50명 제한/재화 단일 정산과 사용자 저장 선택, 비드래그 및 선명한 버튼을 그대로 유지한다. callback 빈도만60fps 이하로 제한한다. 실제 브라우저/OS scheduling에 따라60에 못 미칠 수 있고 반드시 고정60을 보장한다고 주장하지 않는다.

비교: 같은 최신 게임 코드/뷰포트/자동화 브라우저에서 제한 설정만 끄거나 켜고 아군50·적10을 유지해3초씩 측정했다. 제한 전361render/약120.24fps, 브라우저 TaskDuration .842056초/ScriptDuration .674342초. 제한 후142render/약47.28fps(상한60), TaskDuration .544050초/ScriptDuration .372328초. 같은 구간의 브라우저 작업시간 약35.4% 감소, script 시간 약44.8% 감소다. 모델 진행은 전3.00854초/실제3.002334초, 후3.00000초/실제3.003155초로 시간 기반 전투 속도를 유지했다. 이 값은 해당 탭의 main-thread 작업량이며 전체 기기 CPU/GPU 전력·팬소음·실제 모바일 결과로 확대하지 않는다.

검증: 기존104/104 통과. 실제 capped browser에서 로딩/50명·10적/일반 버튼·정상 시간 진행과 pause/resume 경계를 확인한다. 설정 변경을 그대로 복제하는 신규 단위 테스트는 만들지 않고 기존 공격 stride/impact/한번 판정·동료 진입·한계·화면 반복·경제·합동 행동·UI/일시정지 검사로 회귀 범위를 한정했다. 외부 원장/DB/결제/운영 데이터는 변경하지 않아 제외한다. 성능 측정 hook/route는 QA 브라우저에만 주입하고 dist에는 없다.

배포 경계: 기존 .openai/hosting.json의 project_id와 public audience를 재사용한다. 승인된 v51~56 누적 게임 변경과 본 설정을 같은 source checkout에서 source helper로 커밋·푸시한 뒤 그 commit의 static dist archive를 저장·배포한다. 새 사이트/접근권한/부트스트랩을 만들지 않는다. perf sample 및 OS/app 로그는 로컬에서만 보관하며 사이트 archive에는 포함하지 않는다. 사용자 프로젝트 관리 앱의 renderer 문제는 별개여서 이 Game 설정으로 고쳤다고 보고하지 않는다.
