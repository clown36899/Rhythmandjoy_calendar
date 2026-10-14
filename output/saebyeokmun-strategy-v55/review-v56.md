# v56 — 새 소 걷기 영상, 의녀 제자리 완전치료, 궁병 5회 사격

기존 구현 있음: v55의 cowVideo atlas/sliceAtlas, 공통 foot anchor, MOTION.cow와 motionFrame, Scene.renderEntity의 걷기·달리기·공격 분기를 그대로 재사용한다. 직접 호출부와 기존 stride/impact/일시정지·공통 grounding 검사, v55 작업 기록 및 원래 공격 시계 도입 이력을 확인했다. 동일 역할의 새 함수·전투 상태·저장 필드가 필요하지 않다. 데이터 흐름은 사용자 걷기 영상 → frame/crop/atlas의 걷기48 및 idle1 셀 → 기존 motionFrame/Scene 표시이며 실제 HP/이동/공격/정산 모델은 변경하지 않는다.

새 영상은1280×720/24fps/6.016초144frame다. 초반 꼬리 자세가 변하는 구간을 제외하고 지지 발 실루엣이 다시 이어지는34→63frame(29frame 주기)를 선택했다. 원순서를 유지해48셀로 retime하고 마지막→처음을 이어 걷는다. 반전·새 그림 생성은 없다. 기존 crop170,75/300×220 및 흰 외부영역 연결 제거를 재사용한다. 새 영상 전체에 동일한 y+5px를 적용해 기존 지지 발 raw193px와 일치시킨다. 프레임별 크기/foot 스냅은 없고, 이전 달리기48/공격48 셀은 그대로 복사한다. 정지 셀은 새 영상 첫 자세를 사용한다.

불변조건: 소의 기존 이동 speed=74/1.44, stride74, walk48/1.44fps, 공격 .72초/impact .36초 및 체력/코인/50명 소환 제한과 화면 경계를 유지한다. 엽전 비행/실제 지급과 기병 동일 ID 복귀도 그대로다. 소 변경은 새 v56 atlas 파일과 참조/cache query만 교체해 자산 롤백이 가능하고 migration/외부 부작용이 없다.

검증 범위: 새 걷기 셀은1112398 pixel이 바뀌며, 기존 달리기·공격 각48셀은 RGBA pixel 차이0이다.145 pose의 동일 crop·foot anchor·실제 renderer와 기존104개 검사(공격 stride·판정/진입·일시정지/합동 기술/경제/UI)를 확인한다. 기존 모션 계약 검사가 있으므로 새 구현 복제 테스트를 만들지 않는다. DB/외부 배포는 클라이언트 자산/전투 변경 경계 밖이므로 제외한다. 로컬 mirror v56으로 반영하며 커밋·푸시·외부 배포는 하지 않는다.

추가 요청의 수정 전 판정: 일부 있음. v55 teamSkill/advanceTeam 및 기존 heal/hurtEnemy/advanceProjectiles를 재사용한다. 해당 미커밋 도입부와 원래 단일 피해/보상·치료 시계 검사, 직접 Scene/app 호출부를 확인했다. v55의 모든 병종 gather→perform→return 및35% 회복/8회 사격이라는 임시 규칙이 새 요청과 다르므로 같은 coordinator의 시작/완료 정책과 기존 projectile 착지 판정을 바꾼다. 별도 합동 모델·치료 함수·정산 구조를 추가하지 않는다.

의녀: skill 버튼 → 입장한 생존5명/부상 환자/기존 cooldown 판정 → 그 자리에서 perform 시작, moving0 →1.4초에 살아 있는 주인공/모든 동료의 현재 HP를 각 maxHp로 설정 →2.5초 종료 즉시 기존 healerPatient/advanceAction으로 일반 치료 재개. gather/return 이동을 실행하지 않으며 기술 도중 손실이면 즉시 일반 행동으로 해제한다. 동시 heal 이벤트는 실제 부족량만 표시하고 HP 상한/부활금지/한 번 판정/resolved를 유지한다.

궁병: 후열로 gather하고 그 자리에서5번 사격한다. TEAM_SKILLS가 volleys5/firstRelease.7/volleyInterval.6/castTime5.5를 소유해 모델 방출과 Scene의 활 당김 pose를 같은 설정에 맞춘다.5명 ×5회 총25투사체 중 첫20발은 기존 실제 지면 접촉 피해다. 마지막5발은 현재 보이는 전방 적 위치를 향해 쏘고 금색 꼬리로 식별한다. projectile의 finishOnScreen 하나가 추가된 판정 속성을 소유한다. 실제 착지 시 radius28 안에 있으며 현재 viewport 안인 살아 있는 적만 현재 hp만큼 hurtEnemy로 피해를 받아 즉사한다. 숫자만 큰 상수 피해나 전방 전원 자동 삭제는 없다. 빗나간 적/화면 밖 대기 적은 그대로이고 문은 기존 경로 목표를 유지한다. 모델 viewport가 없는 headless world 검사는 화면을 제한하지 않는다. 마지막 판정 후5.5초 종료 시 사격 위치에서 일반 전투를 재개하며 home 복귀는 기병만 실행한다.

finishOnScreen은 기존 고정 damage만으로 표현할 수 없는 '현재 HP·실제 접촉·착지 시 현재 화면' 조건을 projectile의 기존 단일 피해 소유자에 연결하기 위한 임시 필드다. 저장/마이그레이션/큐가 없고 다른 투사체에는false로 기본값을 준다. 한 적이 여러 마지막 화살에 맞아도 첫 피해로 HP0이 되어 다음 화살은 건너뛰며 cleanup/awardCoins가 기존 한 번 정산 규칙을 유지한다. 취소 후 이미 날아간 화살은 기존 projectile 정책대로 실제 착지하며 새5회 사격이나 부활/대체 소환이 발생하지 않는다.

추가 회귀 범위: 기존 전략 테스트를 새5회/25발·5번째5발 표시·기존 고각/실제 지면 miss·종료 위치, 화면 안 접촉 즉사/화면 밖 제외/빗나감/무접촉 적 제외/문 보호로 확장한다. 의녀는 제자리 x/walk/moving 불변, 전방위 maxHp 동시 회복, 사망 제외·재판정 금지, 종료 후 기존 일반 치료 선택을 검사한다. app의 손실 후 버튼 검사는 새 '복귀 없이 즉시 해제'에 맞춘다. 테스트 fixture의 setViewport는 left,width 계약을 유지하고 화면 밖 적은 기존 entering 상태를 보존한다.104/104 통과하며 정상 궁병·치료·기병·일시정지/실패 및 기존 경제 검사를 중복 구조 없이 재사용했다.

실제 v56 브라우저: 버튼 클릭 후 의녀5명의 x=[390,475,560,645,730]가 기도 중/치료 판정 뒤 모두 같고, 주인공200/200·6동료 모두 maxHp를 확인했다. 종료 후 기존 healer 행동을 재개했다. 궁병은 행 위치[460,510,560,610,660]에 모여 actor당5발/총25발/마지막 표시5발을 쐈다. 화면 안 말 귀물/강철 우마가 마지막 화살 착지로 죽었고 화면 밖 대기 적은 살아 있으며 문은 남았다. 궁병5명 같은 ID가 행에서 전진하여 일반 전투를 재개했고 원래 소환 위치로 되돌아가지 않았다. 소 cow20/height141/ground542와145 pose의 단일 foot anchor를 확인했다. 667px 일반 로딩에서 hook 없음, overflow0, 버튼opacity1/draggablefalse, 콘솔 오류0이다. 자동화 route와 fixture는 마지막에 제거하고 cache 없는 일반 페이지 재로딩을 확인했다. 스크린샷/실제 수치/실행 스크립트는 output/saebyeokmun-strategy-v55의 v56 파일 및 output/saebyeokmun-ox-v55의 game-walk-v56.png에 보존한다.
