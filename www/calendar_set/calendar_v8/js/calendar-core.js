/**
 * Calendar.js - 전체 Calendar 클래스 (수정 및 개선 버전)
 * 목표: IndexedDB 기반 1년치 데이터 사전 로드 및 효율적인 주간/월간 뷰 렌더링
 * * 🔴 주요 수정 사항:
 * 1. 구문 오류 수정 (refreshCurrentViewWithWebhook 내)
 * 2. weekDataCache (주간)와 monthDataCache (월간) 분리 및 통합 관리
 * 3. loadMonthDataToCache: API/DB 요청 후 두 가지 캐시(월간, 주간) 모두 업데이트
 * 4. navigate, toggleRoom, toggleAllRooms 등에서 캐시 무효화 및 로드 로직 최적화
 */

class Calendar {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentDate = new Date();
    this.currentView = "week";
    this.selectedRooms = new Set(Object.keys(CONFIG.rooms));
    this.events = [];
    this.hammer = null;

    // 💡 [개선] 상태 머신: 'IDLE', 'PANNING', 'ANIMATING'
    this.swipeState = "IDLE";

    this.hasPendingGestureNavigation = false;
    this.isInitialLoading = true;
    this.currentSlideIndex = 3;

    // 🔴 [임시] 에러 방지용 (추후 완전 제거 예정)
    this.weekDataCache = new Map();
    this.monthDataCache = new Map();

    this.timeUpdateInterval = null;
    this.renderPromise = null;

    // 월간 보기 관련
    this.monthPanelOpen = false;
    this.monthHammer = null;
    this.monthIsDragging = false;
    this.monthClickLocked = false;

    // 🔑 [신규] 월간 패널 상태 추적
    this.monthPanelOpenedDate = null; // 월간 패널 열 때의 currentDate 저장
    this.monthPanelNavigated = false; // 월간 패널에서 이동했는지 여부

    // 🔄 [신규] 스와이프 중 업데이트 대기 플래그
    this.pendingRefresh = false;
  }



  setupResizeObserver() {
    // viewport 크기 변경 시 레이아웃 재조정
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.currentView === "week") {
          this.adjustWeekViewLayout();
        }
      });
      this.resizeObserver.observe(this.container);
    }
  }

  setupEventListeners() {
    // ⚠️ 월간 버튼 리스너는 main.js의 setupMonthToggle()에서 처리

    // 푸터 네비게이션
    document.getElementById("prevWeekBtn").addEventListener("click", () => {
      window._originalConsole.log(
        "🔵 [prevWeekBtn 클릭] setupEventListeners에서 호출",
      );
      // 💡 [수정] 상태 머신에 맞춰 수정: IDLE 상태일 때만 애니메이션 시작
      if (this.swipeState !== "IDLE" || this.isInitialLoading) return;
      this.swipeState = "ANIMATING";
      this.navigate(-1);
    });
    document.getElementById("nextWeekBtn").addEventListener("click", () => {
      window._originalConsole.log(
        "🔵 [nextWeekBtn 클릭] setupEventListeners에서 호출",
      );
      // 💡 [수정] 상태 머신에 맞춰 수정: IDLE 상태일 때만 애니메이션 시작
      if (this.swipeState !== "IDLE" || this.isInitialLoading) return;
      this.swipeState = "ANIMATING";
      this.navigate(1);
    });
    document.getElementById("todayBtn").addEventListener("click", () => {
      window._originalConsole.log(
        "🔵 [todayBtn 클릭] setupEventListeners에서 호출",
      );
      // 💡 [개선] 애니메이션 중에는 재렌더링 버튼 동작 방지
      if (this.swipeState !== "IDLE") return;
      this.goToToday();
    });

    // 방 선택
    document.querySelectorAll(".room-btn[data-room]").forEach((btn) => {
      btn.addEventListener("click", () => this.toggleRoom(btn.dataset.room));
    });

    document
      .getElementById("allRoomsBtn")
      .addEventListener("click", () => this.toggleAllRooms());

    // 🔄 [신규] 데이터 변경 알림 리스너 (SyncManager -> UI)
    window.addEventListener('calendar-data-changed', async (e) => {
      const { year, month } = e.detail;

      // 💡 [전략 변경] 즉시 렌더링하지 않고, 캐시만 조용히 비웁니다. (Cache Invalidation)
      // 사용자가 화면을 넘길 때(navigate), 캐시가 없으면 그때 IndexedDB에서 최신 데이터를 가져옵니다.
      // 이렇게 하면 스와이프 충돌이나 불필요한 렌더링 부하가 완전히 사라집니다.

      // 🔑 [핵심] 해당 월의 캐시 무효화 (항상 수행)
      const changedDate = new Date(year, month, 1);
      const monthKey = CacheRules.getMonthCacheKey(changedDate);
      this.monthDataCache.delete(monthKey);

      // 🚨 [Fix] 해당 월의 1일이 포함된 주만 지우면, 다른 주(예: 23일)의 캐시는 남아있어 갱신되지 않음.
      // 안전하게 모든 주간 캐시를 비웁니다. (DB에서 다시 읽으면 됨)
      this.weekDataCache.clear();

      console.log(`🧹 [UI] 데이터 변경 감지 -> 캐시 삭제 완료 (렌더링 대기): ${year}-${month + 1}`);

      // 💡 [신규] 사용자가 보고 있는 화면 즉시 갱신 요청
      // (refreshCurrentView 내부에서 스와이프 중인지 확인하고 안전하게 처리함)
      if (window.FORCE_LOG) window.FORCE_LOG(`🔄 [UI] 보고 있는 화면 갱신 요청`);
      this.refreshCurrentView();
    });
  }

  /**
   * 💡 [개선] 영구적인 스와이프 제스처 설정
   * 앱 초기화 시 단 한 번만 호출되어 안정성을 높입니다.
   */
  setupPersistentSwipeGestures() {
    if (typeof Hammer === "undefined") {
      window._originalConsole.error("❌ Hammer.js가 로드되지 않았습니다!");
      return;
    }

    // 이벤트 위임(Event Delegation)을 위해 상위 컨테이너에 Hammer를 연결합니다.
    this.hammer = new Hammer(this.container, {
      touchAction: "pan-y", // 🔴 [수정] auto -> pan-y (수평 스와이프 감지)
    });

    this.hammer.get("pan").set({
      direction: Hammer.DIRECTION_HORIZONTAL,
      threshold: 10, // 10px 이상 움직여야 pan 시작
      enable: true,
    });

    let swipeStartTime = 0;
    let slideStarts = [-100, 0, 100];

    this.hammer.on("panstart", (e) => {
      // 1. 상태 확인: IDLE 상태가 아니면 아무것도 하지 않음
      if (this.swipeState !== "IDLE") {
        return;
      }

      // 2. 초기 로딩 중 스와이프 차단
      if (this.isInitialLoading) {
        return;
      }

      // 3. 스와이프 시작점 확인: calendar-slider 안에서 시작했는지 확인
      if (!e.target.closest(".calendar-slider")) {
        // window._originalConsole.log(`[Swipe] slider 외부 터치`);
        return;
      }

      const slides = this.container.querySelectorAll(".calendar-slide");

      // 4. 스와이프 시작 처리
      this.swipeState = "PANNING";

      // 🔴 3주 무한 스크롤: 3개 슬라이드
      if (slides.length === 3) {
        // 드래그하는 동안 부드럽게 움직이도록 transition 제거
        slides.forEach((slide, i) => {
          slide.style.transition = "none";
        });
        slideStarts = [-100, 0, 100];
        swipeStartTime = Date.now();
      }
    });

    this.hammer.on("panmove", (e) => {
      // 1. 상태 확인: PANNING 상태가 아니면 무시
      if (this.swipeState !== "PANNING") {
        return;
      }

      // 2. 슬라이드 이동
      const slides = this.container.querySelectorAll(".calendar-slide");
      if (slides.length === 3) {
        const sliderElement = this.container.querySelector(".calendar-slider");
        const sliderWidth = sliderElement
          ? sliderElement.offsetWidth
          : this.container.offsetWidth;
        const percentMove = (e.deltaX / sliderWidth) * 100;
        slides.forEach((slide, i) => {
          const newPos = slideStarts[i] + percentMove;
          slide.style.transform = `translateX(${newPos}%)`;
        });
      }
    });

    this.hammer.on("panend", (e) => {
      // 1. 상태 확인: PANNING 상태가 아니면 무시
      if (this.swipeState !== "PANNING") {
        return;
      }

      // 2. 상태 변경: 애니메이션 시작
      this.swipeState = "ANIMATING";

      const slides = this.container.querySelectorAll(".calendar-slide");
      // 🔴 3주 무한 스크롤: 3개 슬라이드 확인
      if (slides.length !== 3) {
        this.snapBack();
        return;
      }

      if (slides.length === 3) {
        const swipeEndTime = Date.now();
        const duration = swipeEndTime - swipeStartTime;
        const distance = Math.abs(e.deltaX);
        const velocity = e.velocityX;

        // 3. 애니메이션 활성화
        slides.forEach((slide) => {
          slide.style.transition = `transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)`;
        });

        // 4. 이동 결정 로직
        const sliderWidth =
          this.container.querySelector(".calendar-slider").offsetWidth;
        // 💡 [개선] 민감도 재조정: 빠른 플링(fling)에 더 민감하게 반응하도록 속도 기준을 낮추고, 의도치 않은 이동을 줄이기 위해 거리 기준을 약간 높입니다.
        const distanceThreshold = sliderWidth * 0.15;
        const velocityThreshold = 0.1;

        const shouldNavigate =
          distance > distanceThreshold || Math.abs(velocity) > velocityThreshold;

        if (shouldNavigate) {
          const direction = e.deltaX < 0 ? 1 : -1;
          this.navigate(direction);
        } else {
          this.snapBack();
        }
      }
    });

    this.hammer.on("pancancel", (e) => {
      if (this.swipeState === "PANNING") {
        this.swipeState = "ANIMATING";
        this.snapBack();
      }
    });

    this.hammer.on("tap", (e) => {


      const eventEl = e.target.closest(".week-event");
      if (eventEl) {
        // 🔴 [수정] DayView 폐기. 주간 보기에서 이벤트를 클릭하면 월간 보기의 일간 모달을 띄웁니다.
        const eventDateStr = eventEl.dataset.eventDate;
        if (eventDateStr) {
          const clickedDate = new Date(eventDateStr);

          // 현재 주의 캐시에서 해당 날짜의 모든 이벤트를 가져옵니다.
          const weekCacheKey = this.getWeekCacheKey(clickedDate);
          const allWeekEvents = CacheRules.getWeekEvents(this.weekDataCache, weekCacheKey);

          const dayStart = new Date(clickedDate);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(clickedDate);
          dayEnd.setHours(23, 59, 59, 999);

          const dayEvents = allWeekEvents.filter(event => {
            const eventStart = new Date(event.start);
            const eventEnd = new Date(event.end);
            return eventStart < dayEnd && eventEnd > dayStart;
          });

          // app-init.js에 정의된 전역 함수를 호출합니다.
          if (typeof window.showMonthDayModal === 'function') {
            window.showMonthDayModal(clickedDate, dayEvents);
          }
        }
      }
    });
  }

  /**
   * 💡 [개선] 제자리로 돌아가는 애니메이션
   */
  snapBack() {
    const slides = this.container.querySelectorAll(".calendar-slide");
    // 🔴 3주 무한 스크롤: 3개 슬라이드
    if (slides.length !== 3) {
      this.swipeState = "IDLE";
      return;
    }

    slides.forEach((slide, i) => {
      slide.style.transition =
        "transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)";
      slide.style.transform = `translateX(${[-100, 0, 100][i]}%)`;
    });

    let finalized = false;
    const onFinish = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timeoutId);

      if (this.swipeState === "ANIMATING") {
        this.swipeState = "IDLE";
        this.checkPendingRefresh(); // 🔄 대기 중인 갱신 확인
      }
    };

    const transitionEndHandler = (e) => {
      if (e.propertyName !== "transform") return;
      onFinish();
    };

    slides[1].addEventListener("transitionend", transitionEndHandler, {
      once: true,
    });

    const timeoutId = setTimeout(() => {
      onFinish();
    }, 400);
  }

  /**
   * 🆕 [통합] 모든 네비게이션을 하나의 함수로 처리
   * @param {number|string} direction - 1(next), -1(prev), 'today', 또는 Date 객체
   * @param {string} viewType - 'week', 'month', null(현재 뷰 사용)
   */
  async navigate(direction, viewType = null) {
    // 🔑 [수정] let으로 변경 (재할당 가능하도록)
    let targetView = viewType || this.currentView;

    // 주간 이동은 스와이프 애니메이션 (기존 로직 유지)
    if (targetView === 'week' && typeof direction === 'number') {
      return this._navigateWeekWithAnimation(direction);
    }

    // 🔴 [방어 로직] 월간 패널 닫혀있으면 'month' 모드 차단
    if (targetView === 'month' && !this.monthPanelOpen) {
      window._originalConsole.log(
        `[⚠️ navigate] 월간 패널 닫혔는데 month 모드 요청 → week로 변경`
      );
      targetView = 'week';
    }

    // 월간 이동 또는 'today'
    const targetDate = this._calculateTargetDate(direction, targetView);

    // IndexedDB에서 데이터 조회 (syncMonth가 TTL 확인 후 동기화)
    const { start, end } = this._getDateRange(targetDate, targetView);
    const roomIds = Array.from(this.selectedRooms);

    window._originalConsole.log(
      `\n[🚀 navigate] ${targetView === 'week' ? '주간' : '월간'} 이동`,
      `\n   📅 범위: ${start.toLocaleDateString('ko-KR')} ~ ${end.toLocaleDateString('ko-KR')}`,
      `\n   🏠 방: ${roomIds.join(', ')}`
    );

    // 🔑 핵심: syncMonth()가 TTL 확인 → IndexedDB 업데이트 → UI 갱신
    await window.syncManager.syncMonth(targetDate.getFullYear(), targetDate.getMonth());

    // 날짜 및 뷰 업데이트 후 렌더링
    this.currentDate = targetDate;
    this.currentView = targetView;
    this.updateCalendarTitle();
    await this.render();

    if (this.monthPanelOpen) {
      this.renderAndSetupMonthSlider();
    }



    window._originalConsole.log(`[✅ navigate] 완료\n`);
  }

  /**
   * 🆕 [Preload] 다음 달 데이터가 IndexedDB에 없으면 2달치 API 요청
   * @param {Date} currentDate - 현재 날짜
   */

  /**
   * 🔴 [내부] 날짜 계산
   */
  _calculateTargetDate(direction, viewType) {
    let target;

    if (direction === 'today') {
      target = new Date();
    } else if (direction instanceof Date) {
      target = new Date(direction);
    } else {
      target = new Date(this.currentDate);

      if (viewType === 'week') {
        target.setDate(target.getDate() + direction * 7);
      } else {
        // 월간: 매달 1일로 이동
        target.setMonth(target.getMonth() + direction);
        target.setDate(1);
      }
    }

    // 🔴 [수정] 주간 뷰는 항상 일요일로 정규화
    if (viewType === 'week') {
      const dayOfWeek = target.getDay();
      target.setDate(target.getDate() - dayOfWeek);
    }

    target.setHours(0, 0, 0, 0);
    return target;
  }

  /**
   * 🔴 [내부] 범위 계산 (주간 또는 월간)
   */
  _getDateRange(date, viewType) {
    if (viewType === 'week') {
      return this.getWeekRange(date);
    } else {
      // 월간: 해당 달 1일 ~ 말일
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }

  /**
   * 🔴 [내부] 주간 스와이프 애니메이션 (기존 로직)
   */
  async _navigateWeekWithAnimation(direction) {
    // 상태 머신으로 중복 실행 방지
    if (this.swipeState !== "ANIMATING") {
      return;
    }

    if (this.renderPromise) {
      // 🔴 [진단] 렌더링 잠금으로 인해 대기 중임을 명확히 로깅합니다.
      console.error(`[DEBUG] 🟡 렌더링 잠금 대기 중... (소유자: ${this.renderPromise.owner || '알 수 없음'})`);
      await this.renderPromise;
      console.error(`[DEBUG] 🟢 렌더링 잠금 해제됨. 갱신을 계속합니다.`);
    }

    const slides = this.container.querySelectorAll(".calendar-slide");
    // 🔴 3주 무한 스크롤: 3개 슬라이드
    if (slides.length !== 3) {
      this.swipeState = "IDLE";
      return;
    }

    // 🔴 [중요] currentDate를 새로운 주의 시작일(일요일)로 설정
    const newDate = new Date(this.currentDate);
    newDate.setDate(newDate.getDate() + direction * 7);

    // newDate를 이용해 해당 주의 시작일(일요일) 구하기
    const dayOfWeek = newDate.getDay();
    newDate.setDate(newDate.getDate() - dayOfWeek);
    newDate.setHours(0, 0, 0, 0);

    this.currentDate = newDate;

    this.updateCalendarTitle();

    // 🚀 [Fix] 주간 이동 시에도 데이터 동기화 트리거 (Optimistic UI + Background Sync)
    // 주가 걸쳐있는 모든 달을 동기화해야 함 (예: 1월 말 ~ 2월 초)
    const { start: wStart, end: wEnd } = this.getWeekRange(newDate);
    const monthsToSync = new Set([
      `${wStart.getFullYear()}-${wStart.getMonth()}`,
      `${wEnd.getFullYear()}-${wEnd.getMonth()}`
    ]);

    monthsToSync.forEach(key => {
      const [y, m] = key.split('-').map(Number);
      // 비동기로 실행 (UI 차단 방지)
      window.syncManager.syncMonth(y, m).catch(e => console.error(e));
    });

    // 💡 [Fix] 애니메이션 시작 전에 대상 슬라이드의 내용을 최신 데이터로 갱신
    // (캐시가 비워진 상태라면 DB에서 다시 가져옴 -> 스와이프 시 최신 데이터 보장)
    if (window.FORCE_LOG) window.FORCE_LOG(`🔄 [UI] 스와이프 전 대상 슬라이드 갱신 시도: ${newDate.toLocaleDateString()}`);

    // 1. DB에서 데이터 가져오기 (캐시 미스 시)
    await this.loadWeekDataToCache(newDate);

    // 2. DOM 업데이트
    await this.updateSlideContent(newDate);

    // 각 슬라이드를 100% 이동 (3개)
    const currentPositions = [-100, 0, 100];
    const targets = currentPositions.map(
      (pos) => pos + (direction === 1 ? -100 : 100),
    );
    slides.forEach((slide, i) => {
      slide.style.transform = `translateX(${targets[i]}%)`;
    });

    // 💡 [수정] transitionend와 setTimeout의 경합(Race Condition)을 방지하는 '게이트키퍼' 로직
    let finalized = false;
    const onFinish = async () => {
      if (finalized) return; // 중복 실행 방지
      finalized = true;

      // 타이머가 실행되지 않도록 정리
      clearTimeout(timeoutId);

      await this.finalizeNavigation(direction, slides);
    };

    // transitionend 대기 (중앙 슬라이드 = 인덱스 1)
    const handleTransitionEnd = (e) => {
      // transform 애니메이션이 끝났을 때만 반응
      if (e.propertyName !== "transform") return;
      onFinish();
    };

    // { once: true } 옵션으로 리스너가 단 한 번만 실행되도록 보장
    slides[1].addEventListener("transitionend", handleTransitionEnd, {
      once: true,
    });

    // 안전장치: 500ms 후 강제 완료
    const timeoutId = setTimeout(() => {
      onFinish();
    }, 500);
  }

  /**
   * 🆕 [월간 뷰] 스와이프로 다음/이전 달로 이동 (주간 뷰 패턴 참조)
   * @param {number} direction - 1(다음달) 또는 -1(이전달)
   */
  async _navigateMonthWithAnimation(direction) {
    // 중복 실행 방지 (monthClickLocked 사용)
    if (this.monthClickLocked) {
      window._originalConsole.log(`[🔒 월간 네비게이션] 락 걸림 - 무시`);
      return;
    }

    this.monthClickLocked = true;

    // 🔑 [신규] 월간 패널에서 이동했음을 표시
    this.monthPanelNavigated = true;

    window._originalConsole.log(
      `\n[🚀 월간 네비게이션] direction=${direction > 0 ? "→" : "←"} 시작`
    );

    try {
      // 🔑 [1단계] 새로운 날짜 계산 (direction 방향으로 1달 이동)
      const newDate = new Date(this.currentDate);
      newDate.setMonth(newDate.getMonth() + direction);
      newDate.setDate(1); // 해당 달의 1일로 설정
      newDate.setHours(0, 0, 0, 0);

      window._originalConsole.log(
        `   📅 이동 대상: ${newDate.toLocaleDateString('ko-KR')}`
      );

      // 🔑 [2단계] currentDate 업데이트 (즉시 반영)
      this.currentDate = newDate;
      this.updateCalendarTitle();

      // 🔑 [3단계] 낙관적 렌더링 (Optimistic Rendering)
      // 데이터를 기다리지 않고 즉시 화면을 그립니다. (데이터가 없으면 빈 달력이 보임)
      window._originalConsole.log(`   🎨 [Optimistic] 즉시 렌더링 실행`);
      this.renderAndSetupMonthSlider();

      // 🔴 [핵심] 브라우저가 화면을 그릴 시간을 확보 (Double RAF)
      // 네트워크 요청 시작 전에 UI가 확실히 업데이트되도록 합니다.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // 🔑 [4단계] 데이터 로드 (백그라운드 실행)
      window._originalConsole.log(`   📥 [Background] 3개월 데이터 로드 시작...`);

      // await를 제거하여 UI 차단을 방지합니다.
      this.loadMonthEventsForCurrentDate().then(() => {
        window._originalConsole.log(`   ✅ [Background] 데이터 로드 완료 → 재렌더링`);
        // 데이터 로드가 완료되면 화면을 다시 그려 이벤트를 채워 넣습니다.
        // 사용자가 그 사이에 다른 달로 이동했을 수 있으므로 확인
        if (this.currentView === 'month' || this.monthPanelOpen) {
          this.renderAndSetupMonthSlider();
        }
      });

      // 🔴 [신규] 성능 최적화: 인접한 달(±2개월) 미리 로드 (Prefetching)
      const prefetchDirection = direction;
      const prefetchDate = new Date(this.currentDate);
      prefetchDate.setMonth(prefetchDate.getMonth() + (prefetchDirection * 2));

      this.loadMonthDataToCache(prefetchDate).catch(err => {
        window._originalConsole.warn(`   ⚠️ [Prefetch] 실패 (무시됨)`, err);
      });

      window._originalConsole.log(`[✅ 월간 네비게이션] 즉시 완료 처리 (데이터는 백그라운드 로딩)\n`);
    } catch (error) {
      window._originalConsole.error(`[❌ 월간 네비게이션] 에러:`, error);
    } finally {
      setTimeout(() => {
        this.monthClickLocked = false;
      }, 100);
    }
  }

  async finalizeNavigation(direction, slidesArray) {
    const slides = Array.from(slidesArray); // NodeList를 Array로 변환
    // 🔴 3주 무한 스크롤: 3개 슬라이드 기대
    if (slides.length !== 3) {
      this.swipeState = "IDLE"; // 비정상 상태에서 복구
      this.checkPendingRefresh(); // 🔄 대기 중인 갱신 확인
      return;
    }



    const slider = this.container.querySelector(".calendar-slider");

    // 🚨 방어 코드: slider 또는 slides가 DOM에서 제거되었는지 확인
    if (!slider || !slider.contains(slides[0]) || !slider.contains(slides[2])) {
      window._originalConsole?.error(`[❌ finalizeNavigation] DOM 불일치 - slider 또는 slides가 제거됨`);
      this.swipeState = "IDLE";
      return;
    }

    // 트랜지션 비활성화
    slides.forEach((slide) => {
      slide.style.transition = "none";
    });

    // 🔴 [무한 스크롤] DOM 재배열: 슬라이드를 실제로 옮겨 무한 스크롤 구현
    if (direction === 1) {
      // 오른쪽 스와이프(다음 주): 첫 슬라이드를 끝으로
      slider.appendChild(slides[0]);
    } else {
      // 왼쪽 스와이프(이전 주): 끝 슬라이드를 처음으로
      slider.insertBefore(slides[2], slides[0]);
    }

    // 각 슬라이드를 원위치로 리셋 (transition 없이)
    const slideList = this.container.querySelectorAll(".calendar-slide");
    slideList.forEach((slide, i) => {
      slide.style.transform = `translateX(${[-100, 0, 100][i]}%)`;
    });

    // 🔴 [달력 갱신] DOM 재배열 후 새로 추가되는 슬라이드의 달력 콘텐츠 업데이트
    // direction === 1: slides[0] → 끝으로 이동 → 새 slideList[2]
    // direction === -1: slides[2] → 처음으로 이동 → 새 slideList[0]
    const newSlideIndex = direction === 1 ? 2 : 0;
    const newSlideDate = new Date(this.currentDate);
    if (direction === 1) {
      newSlideDate.setDate(newSlideDate.getDate() + 7);
    } else {
      newSlideDate.setDate(newSlideDate.getDate() - 7);
    }

    // 🔴 [진단] 새 슬라이드 날짜 확인
    const { start: newWeekStart, end: newWeekEnd } =
      this.getWeekRange(newSlideDate);
    const newWeekRangeStr = `${newWeekStart.getMonth() + 1}월 ${newWeekStart.getDate()}~${newWeekEnd.getMonth() + 1}월 ${newWeekEnd.getDate()}일`;
    // window._originalConsole.log(`\n🔵 [finalizeNavigation 달력 갱신]`);
    // window._originalConsole.log(`   newSlideIndex: ${newSlideIndex}`);
    // window._originalConsole.log(`   currentDate: ${this.currentDate.toDateString()}`);
    // window._originalConsole.log(`   newSlideDate: ${newSlideDate.toDateString()}`);
    // window._originalConsole.log(`   새로 나올 주: ${newWeekRangeStr}`);
    // window._originalConsole.log(`   기존 slides 내용:`);
    // slideList.forEach((s, i) => {
    //   window._originalConsole.log(`      slides[${i}] data-week-key: ${s.getAttribute('data-week-key')}`);
    // });

    const newWeekContent = this.renderWeekViewContent(newSlideDate, true); // true = 이벤트 없이
    // 🔴 [통일] 슬라이드에 통일된 키 저장 (2025-11-23T15:00:00)
    const weekKey = this.getWeekCacheKey(newSlideDate);
    const newSlide = slideList[newSlideIndex];

    // 🔴 [중요 수정] 전체 슬라이드 내용을 교체 (HTML 전체)
    // renderWeekViewContent는 <div class="week-view">...</div>를 반환하므로 전체 innerHTML 교체
    newSlide.innerHTML = newWeekContent;
    newSlide.setAttribute("data-week-key", weekKey);
    // window._originalConsole.log(`   ✅ 새 슬라이드 업데이트 완료: ${newWeekKey}\n`);

    // 레이아웃 조정
    this.adjustWeekViewLayout(true);

    // 현재 시간 표시
    requestAnimationFrame(() => {
      this.updateCurrentTimeIndicator();
    });

    // 다음 프레임에서 트랜지션 재활성화
    requestAnimationFrame(() => {
      slideList.forEach((slide) => {
        slide.style.transition = "";
      });
    });

    // 🔴 [중요] navigate에서 이미 currentDate = 다음주로 설정됨
    // finalizeNavigation에서는 currentDate 그 자체가 화면 중앙의 주
    const { start: displayWeekStart, end: displayWeekEnd } = this.getWeekRange(
      this.currentDate,
    );

    // 전체 주의 범위 표시 (시작일 포함)
    const displayRangeStr =
      displayWeekStart.getMonth() === displayWeekEnd.getMonth()
        ? `${displayWeekStart.getMonth() + 1}월 ${displayWeekStart.getDate()}~${displayWeekEnd.getDate()}일`
        : `${displayWeekStart.getMonth() + 1}월 ${displayWeekStart.getDate()}~${displayWeekEnd.getMonth() + 1}월 ${displayWeekEnd.getDate()}일`;

    // window._originalConsole.log(`\n🔵 finalizeNavigation: 현재 보이는 주 이벤트 로드`);
    // window._originalConsole.log(`   direction: ${direction === 1 ? '→' : '←'}`);
    // window._originalConsole.log(`   현재 보이는 주 date: ${displayRangeStr}`);

    // 💡 [성능 개선] 스와이프 애니메이션이 끝난 후, 새로 화면 가장자리에 위치하게 된 다음 주 데이터를 미리 로드합니다.
    // 이렇게 하면 다음 스와이프 시 네트워크 요청을 기다리지 않아도 되어 매우 부드럽게 느껴집니다.
    this.loadWeekDataToCache(newSlideDate).then(() => {
      this.updateSlideContent(newSlideDate);
    });

    // ✅ 중요: 모든 작업이 끝난 후 상태를 IDLE로 되돌려 다음 입력을 받을 준비를 합니다.
    this.swipeState = "IDLE";
    this.checkPendingRefresh(); // 🔄 대기 중인 갱신 확인

    // ✅ [신규] 스와이프 후 오늘 버튼 상태 업데이트
    this.updateTodayButtonState();


  }

  updateCalendarTitle() {
    const titleElement = document.getElementById("calendarTitle");
    if (!titleElement) {
      window._originalConsole.warn('[⚠️ updateCalendarTitle] titleElement not found');
      return;
    }

    // 🔴 [핵심] 주간 뷰 && 월간 패널 닫힘: 월경계 체크하여 "11~12월" 표시
    if (this.currentView === 'week' && !this.monthPanelOpen) {
      const { start, end } = this.getWeekRange(this.currentDate);
      const startMonth = start.getMonth() + 1;
      const endMonth = end.getMonth() + 1;

      // window._originalConsole.log(
      //   `\n[📅 updateCalendarTitle] ${this.currentView === 'week' ? '주간' : '월간'} 뷰 (월간 패널 ${this.monthPanelOpen ? '열림' : '닫힘'}) `,
      //   `\n   currentDate: ${this.currentDate.toLocaleDateString('ko-KR')} `,
      //   `\n   주 범위: ${start.toLocaleDateString('ko-KR')} ~ ${end.toLocaleDateString('ko-KR')} `,
      //   `\n   startMonth: ${startMonth}, endMonth: ${endMonth}`
      // );

      let title = '';
      if (startMonth === endMonth) {
        title = `${startMonth}월`;
      } else {
        title = `${startMonth}~${endMonth}월`;
      }
      titleElement.textContent = title;
      // window._originalConsole.log(`   ✅ 제목 설정: "${title}"\n`);
    } else {
      // 월간 뷰 또는 월간 패널 열림: "11월" (단일 월만)
      const title = `${this.currentDate.getMonth() + 1}월`;
      titleElement.textContent = title;
      window._originalConsole.log(
        `[📅 updateCalendarTitle] 월간 뷰 또는 월간 패널 열림: "${title}"\n`
      );
    }
  }



  async goToToday() {
    window._originalConsole.log("🟢 [goToToday 진입]");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 🔴 [최적화] navigate 함수 내부 로직을 직접 구현하여 낙관적 렌더링 적용
    // await this.navigate(today); 대신 아래 로직 사용

    // 1. 상태 업데이트
    this.currentDate = today;
    // 오늘로 가면 보통 주간 뷰로 전환하거나 현재 뷰 유지
    // 여기서는 뷰 전환 없이 날짜만 이동한다고 가정 (또는 navigate의 기본 동작 따름)

    this.updateCalendarTitle();

    // 2. 즉시 렌더링 (낙관적)
    window._originalConsole.log("   🎨 [Optimistic] 즉시 렌더링");
    // render()는 내부적으로 _doRender()를 호출하며, 이는 현재 뷰(주간/월간)에 맞춰 그립니다.
    // await 없이 호출하여 UI 차단 방지 (단, render 내부의 잠금 로직은 유지됨)
    this.render();

    if (this.monthPanelOpen) {
      this.renderAndSetupMonthSlider();
    }

    // 3. 데이터 로드 (백그라운드)
    window._originalConsole.log("   📥 [Background] 데이터 로드 시작");

    const { start, end } = this._getDateRange(today, this.currentView);
    const roomIds = Array.from(this.selectedRooms);

    window.syncManager.syncMonth(today.getFullYear(), today.getMonth()).then(async () => {
      window._originalConsole.log("   ✅ [Background] 데이터 로드 완료 → 재렌더링");
      // 데이터 로드 후 다시 렌더링하여 이벤트 표시
      await this.render();
      if (this.monthPanelOpen) {
        this.renderAndSetupMonthSlider();
      }
    });

    window._originalConsole.log(`[goToToday] ✅ 즉시 완료 처리\n`);
  }

  async goToPrevMonth() {
    window._originalConsole.log(`\n🔵🔵🔵 [goToPrevMonth] 시작`);
    window._originalConsole.log(`   현재 currentDate: ${this.currentDate.toLocaleDateString('ko-KR')} (${this.currentDate.toISOString()})`);
    window._originalConsole.log(`   현재 currentView: ${this.currentView}`);
    window._originalConsole.log(`   월간 패널 열림: ${this.monthPanelOpen}`);

    // 🔑 [월간 패널 열림] 스와이프 애니메이션
    if (this.monthPanelOpen) {
      window._originalConsole.log(`   → 월간 패널 열림 → _navigateMonthWithAnimation(-1) 호출`);
      return this._navigateMonthWithAnimation(-1);
    }

    window._originalConsole.log(`   → 주간 뷰 → 이전 달 1일 포함 주로 이동 시작`);

    // 🔑 [주간 뷰] 이전 달 1일이 포함된 주로 이동
    const targetDate = new Date(this.currentDate);
    window._originalConsole.log(`   1️⃣ targetDate 복사: ${targetDate.toLocaleDateString('ko-KR')}`);

    targetDate.setMonth(targetDate.getMonth() - 1);
    // 💡 [Fix] 애니메이션 시작 전에 대상 슬라이드의 내용을 최신 데이터로 갱신
    // (캐시가 비워진 상태라면 DB에서 다시 가져옴 -> 스와이프 시 최신 데이터 보장)
    if (window.FORCE_LOG) window.FORCE_LOG(`🔄 [UI] 스와이프 전 대상 슬라이드 갱신 시도: ${targetDate.toLocaleDateString()}`);

    // 1. DB에서 데이터 가져오기 (캐시 미스 시)
    await this.loadWeekDataToCache(targetDate);

    // 2. DOM 업데이트
    await this.updateSlideContent(targetDate);

    window._originalConsole.log(`   2️⃣ setMonth(-1): ${targetDate.toLocaleDateString('ko-KR')} (${targetDate.toISOString()})`);

    targetDate.setDate(1); // 이전 달 1일
    window._originalConsole.log(`   3️⃣ setDate(1): ${targetDate.toLocaleDateString('ko-KR')} (${targetDate.toISOString()})`);

    targetDate.setHours(0, 0, 0, 0);
    window._originalConsole.log(`   4️⃣ setHours(0,0,0,0): ${targetDate.toISOString()}`);

    // 1일이 포함된 주의 일요일 찾기
    const dayOfWeek = targetDate.getDay();
    window._originalConsole.log(`   5️⃣ dayOfWeek: ${dayOfWeek} (0=일요일)`);

    const weekStart = new Date(targetDate);
    weekStart.setDate(targetDate.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    window._originalConsole.log(`   6️⃣ weekStart (일요일): ${weekStart.toLocaleDateString('ko-KR')} (${weekStart.toISOString()})`);

    // 🔴 [최적화] 이미 같은 주에 있으면 이동하지 않음
    const currentWeekKey = this.getWeekCacheKey(this.currentDate);
    const targetWeekKey = this.getWeekCacheKey(weekStart);


    window._originalConsole.log(`   7️⃣ currentWeekKey: ${currentWeekKey}`);
    window._originalConsole.log(`   8️⃣ targetWeekKey: ${targetWeekKey}`);

    if (currentWeekKey === targetWeekKey) {
      window._originalConsole.log(
        `   ❌ 같은 주 → 이동 없음\n`
      );
      return;
    }

    // 🔑 [핵심 수정] navigate() 대신 직접 처리 + 낙관적 렌더링
    // → currentDate를 targetDate(달 1일)로 설정하여 다음 클릭 시 올바른 날짜에서 시작
    window._originalConsole.log(`   9️⃣ [직접 처리] currentDate를 달 1일로 업데이트: ${targetDate.toLocaleDateString('ko-KR')}`);

    // 1. 상태 업데이트
    this.currentDate = targetDate;
    this.updateCalendarTitle();

    // 2. 즉시 렌더링 (낙관적)
    window._originalConsole.log("   🎨 [Optimistic] 즉시 렌더링");
    this.render();

    // 3. 데이터 로드 (백그라운드)
    const { start, end } = this.getWeekRange(weekStart);
    const roomIds = Array.from(this.selectedRooms);

    window._originalConsole.log("   📥 [Background] 데이터 로드 시작");
    window.syncManager.fetchEventsForPeriod(start, end, roomIds).then(async () => {
      window._originalConsole.log("   ✅ [Background] 데이터 로드 완료 → 재렌더링");
      await this.render();
    });

    window._originalConsole.log(`   ✅ 완료 - currentDate: ${this.currentDate.toLocaleDateString('ko-KR')}\n`);
  }

  async goToNextMonth() {
    window._originalConsole.log(`\n🔵🔵🔵 [goToNextMonth] 시작`);
    window._originalConsole.log(`   현재 currentDate: ${this.currentDate.toLocaleDateString('ko-KR')} (${this.currentDate.toISOString()})`);
    window._originalConsole.log(`   현재 currentView: ${this.currentView}`);
    window._originalConsole.log(`   월간 패널 열림: ${this.monthPanelOpen}`);

    // 🔑 [월간 패널 열림] 스와이프 애니메이션
    if (this.monthPanelOpen) {
      window._originalConsole.log(`   → 월간 패널 열림 → _navigateMonthWithAnimation(1) 호출`);
      return this._navigateMonthWithAnimation(1);
    }

    window._originalConsole.log(`   → 주간 뷰 → 다음 달 1일 포함 주로 이동 시작`);

    // 🔑 [주간 뷰] 다음 달 1일이 포함된 주로 이동
    const targetDate = new Date(this.currentDate);
    window._originalConsole.log(`   1️⃣ targetDate 복사: ${targetDate.toLocaleDateString('ko-KR')}`);

    targetDate.setMonth(targetDate.getMonth() + 1);
    window._originalConsole.log(`   2️⃣ setMonth(+1): ${targetDate.toLocaleDateString('ko-KR')} (${targetDate.toISOString()})`);

    targetDate.setDate(1); // 다음 달 1일
    window._originalConsole.log(`   3️⃣ setDate(1): ${targetDate.toLocaleDateString('ko-KR')} (${targetDate.toISOString()})`);

    targetDate.setHours(0, 0, 0, 0);
    window._originalConsole.log(`   4️⃣ setHours(0,0,0,0): ${targetDate.toISOString()}`);

    // 1일이 포함된 주의 일요일 찾기
    const dayOfWeek = targetDate.getDay();
    window._originalConsole.log(`   5️⃣ dayOfWeek: ${dayOfWeek} (0=일요일)`);

    const weekStart = new Date(targetDate);
    weekStart.setDate(targetDate.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    window._originalConsole.log(`   6️⃣ weekStart (일요일): ${weekStart.toLocaleDateString('ko-KR')} (${weekStart.toISOString()})`);

    // 🔴 [최적화] 이미 같은 주에 있으면 이동하지 않음
    const currentWeekKey = this.getWeekCacheKey(this.currentDate);
    const targetWeekKey = this.getWeekCacheKey(weekStart);
    window._originalConsole.log(`   7️⃣ currentWeekKey: ${currentWeekKey}`);
    window._originalConsole.log(`   8️⃣ targetWeekKey: ${targetWeekKey}`);

    if (currentWeekKey === targetWeekKey) {
      window._originalConsole.log(
        `   ❌ 같은 주 → 이동 없음\n`
      );
      return;
    }

    // 🔑 [핵심 수정] navigate() 대신 직접 처리 + 낙관적 렌더링
    // → currentDate를 targetDate(달 1일)로 설정하여 다음 클릭 시 올바른 날짜에서 시작
    window._originalConsole.log(`   9️⃣ [직접 처리] currentDate를 달 1일로 업데이트: ${targetDate.toLocaleDateString('ko-KR')}`);

    // 1. 상태 업데이트
    this.currentDate = targetDate;
    this.updateCalendarTitle();

    // 2. 즉시 렌더링 (낙관적)
    window._originalConsole.log("   🎨 [Optimistic] 즉시 렌더링");
    this.render();

    // 3. 데이터 로드 (백그라운드)
    const { start, end } = this.getWeekRange(weekStart);
    const roomIds = Array.from(this.selectedRooms);

    window._originalConsole.log("   📥 [Background] 데이터 로드 시작");
    window.syncManager.fetchEventsForPeriod(start, end, roomIds).then(async () => {
      window._originalConsole.log("   ✅ [Background] 데이터 로드 완료 → 재렌더링");
      await this.render();
    });

    window._originalConsole.log(`   ✅ 완료 - currentDate: ${this.currentDate.toLocaleDateString('ko-KR')}\n`);
  }

  checkPendingRefresh() {
    if (this.pendingRefresh) {
      window._originalConsole?.log('🔄 [checkPendingRefresh] 대기 중인 갱신 실행');
      this.pendingRefresh = false;
      this.refreshCurrentView();
    }
  }

  async refreshCurrentView() {
    // 🚨 스와이프 진행 중에는 화면 갱신 지연 (DOM 충돌 방지)
    if (this.swipeState && this.swipeState !== "IDLE") {
      window._originalConsole?.warn(`[⚠️ refreshCurrentView] 스와이프 진행 중 (${this.swipeState}) - 갱신 예약`);
      this.pendingRefresh = true; // 🔄 갱신 예약
      return;
    }

    // 💡 [개선] 진단 로그가 추가된 잠금(Lock) 메커니즘 + 타임아웃 안전장치
    if (this.renderPromise) {
      window._originalConsole.log(`[DEBUG] 🟡 렌더링 잠금 대기 중... (소유자: ${this.renderPromise.owner || '알 수 없음'})`);

      // 🚀 [신규] 3초 이상 대기 시 강제 진행 (Deadlock 방지)
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          window._originalConsole.warn(`[⚠️ refreshCurrentView] 렌더링 잠금 대기 타임아웃 (3s) - 강제 진행`);
          resolve('timeout');
        }, 3000);
      });

      const result = await Promise.race([this.renderPromise, timeoutPromise]);

      if (result !== 'timeout') {
        window._originalConsole.log(`[DEBUG] 🟢 렌더링 잠금 해제됨. 갱신을 계속합니다.`);
      }
    }

    let releaseLock;
    const myPromise = new Promise((resolve) => {
      releaseLock = resolve;
    });
    myPromise.owner = "refreshCurrentView"; // 디버깅을 위한 잠금 소유자 정보
    this.renderPromise = myPromise;

    try {
      // 🔴 [수정] 교착 상태(Deadlock) 해결: render()를 건너뛰고 _doRender()를 직접 호출합니다.
      // refreshCurrentView 함수가 이미 renderPromise 잠금을 관리하고 있기 때문입니다.
      window._originalConsole.log('🎨 [refreshCurrentView] 렌더링 잠금 획득. _doRender() 호출 시작');

      // 🚀 [신규] 월간 패널이 열려 있으면 패널 데이터도 함께 갱신
      if (this.monthPanelOpen) {
        window._originalConsole.log('🎨 [refreshCurrentView] 월간 패널 갱신 중...');
        await this.loadMonthEventsForCurrentDate();
        this.renderAndSetupMonthSlider();
      }

      await this._doRender();
      window._originalConsole.log('🎨 [refreshCurrentView] _doRender() 호출 완료');
    } catch (err) {
      window._originalConsole.error('❌ [refreshCurrentView] 렌더링 중 오류 발생:', err);
    } finally {
      window._originalConsole.log('🎨 [refreshCurrentView] 렌더링 잠금 해제.');
      if (releaseLock) releaseLock();
      this.renderPromise = null;
    }
  }



  async invalidateAndRefreshWeeks(weekStartDates) {
    // 1. 해당 주의 캐시만 무효화
    weekStartDates.forEach((weekStart) => {
      const weekKey = this.getWeekCacheKey(new Date(weekStart));
      CacheRules.deleteWeekEvents(this.weekDataCache, weekKey);
    });

    // 2. 변경된 주의 데이터만 병렬로 다시 로드
    const datesToRefresh = weekStartDates.map((ws) => new Date(ws));
    const loadPromises = datesToRefresh.map((date) =>
      this.loadWeekDataToCache(date),
    );
    await Promise.all(loadPromises);

    // 3. 현재 화면에 보이는 슬라이드 중, 변경된 슬라이드만 찾아 내용 업데이트
    const allSlides = Array.from(
      this.container.querySelectorAll(".calendar-slide"),
    );
    if (allSlides.length !== 7) return;

    const currentSlideDates = [];
    for (let i = -3; i <= 3; i++) {
      const date = new Date(this.currentDate);
      date.setDate(date.getDate() + i * 7);
      currentSlideDates.push(date);
    }

    for (const refreshDate of datesToRefresh) {
      const refreshWeekKey = this.getWeekCacheKey(refreshDate).split("T")[0]; // 날짜 부분만 비교

      const slideIndex = currentSlideDates.findIndex((slideDate) => {
        const slideWeekKey = this.getWeekCacheKey(slideDate).split("T")[0];
        return slideWeekKey === refreshWeekKey;
      });

      if (slideIndex !== -1) {
        await this.updateSlideContent(refreshDate);
      }
    }

    // 4. 레이아웃 재조정
    this.adjustWeekViewLayout(true);
  }

  /**
   * 🧹 [신규] 모든 메모리 캐시 초기화 (데이터 갱신 시 호출)
   */
  clearAllCaches() {
    window._originalConsole.log('🧹 [Calendar] 모든 메모리 캐시 초기화');
    this.weekDataCache.clear();
    this.monthDataCache.clear();
  }

  async toggleRoom(roomId) {
    // 🔴 [수정] 방 선택 변경 시 weekDataCache와 monthDataCache 모두 무효화하여 필터링이 다시 적용되도록 합니다.
    this.weekDataCache.clear();
    this.monthDataCache.clear();

    // 단일 방만 선택
    this.selectedRooms.clear();
    this.selectedRooms.add(roomId);

    // 모든 버튼 비활성화 후 선택한 버튼만 활성화
    document.querySelectorAll(".room-btn[data-room]").forEach((btn) => {
      btn.classList.remove("active");
    });
    document.getElementById("allRoomsBtn").classList.remove("active");

    const btn = document.querySelector(`.room-btn[data-room="${roomId}"]`);
    btn.classList.add("active");

    // body에 single-room-view 클래스 추가
    document.body.classList.add("single-room-view");

    await this.render();

    // 🔴 [신규] 월간 패널이 열려있으면 해당 달 데이터 다시 로드 (방 필터링 적용)
    if (this.monthPanelOpen) {
      try {
        // 이전달, 현재달, 다음달 병렬 로드
        await this.loadMonthEventsForCurrentDate();
        this.renderAndSetupMonthSlider();
      } catch (error) { }
    }
  }

  async toggleAllRooms() {
    // 🔴 [수정] 방 선택 변경 시 weekDataCache와 monthDataCache 모두 무효화하여 필터링이 다시 적용되도록 합니다.
    this.weekDataCache.clear();
    this.monthDataCache.clear();

    const allBtn = document.getElementById("allRoomsBtn");
    const allRoomIds = Object.keys(CONFIG.rooms);

    // 모든 방 선택
    this.selectedRooms = new Set(allRoomIds);

    document.querySelectorAll(".room-btn[data-room]").forEach((btn) => {
      btn.classList.add("active");
    });
    allBtn.classList.remove("active");

    // body에서 single-room-view 클래스 제거
    document.body.classList.remove("single-room-view");

    await this.render();

    // 🔴 [신규] 월간 패널이 열려있으면 해당 달 데이터 다시 로드 (모든 방 표시)
    if (this.monthPanelOpen) {
      try {
        // 이전달, 현재달, 다음달 병렬 로드
        await this.loadMonthEventsForCurrentDate();
        this.renderAndSetupMonthSlider();
      } catch (error) { }
    }
  }


  getDateRange(date = null) {
    const targetDate = date || this.currentDate;
    if (this.currentView === "week") {
      return this.getWeekRange(targetDate);

    } else {
      return this.getMonthRange(targetDate);
    }
  }

  getDayRange(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  getWeekRange(date) {
    const current = new Date(date);
    const day = current.getDay();

    // 🔴 [최종 수정] 정확한 주 범위 계산: 일요일(0) 00:00 ~ 토요일(6) 23:59:59
    const start = new Date(current);
    start.setDate(current.getDate() - day); // 일요일로 이동
    start.setHours(0, 0, 0, 0); // 00:00:00

    const end = new Date(start);
    end.setDate(start.getDate() + 6); // 토요일로 이동 (6일 후 = 같은 주의 마지막 날)
    end.setHours(23, 59, 59, 999); // 23:59:59.999

    return { start, end };
  }

  getMonthRange(date) {
    // 마스터 키는 연도만 필요 (이벤트 필터링은 각 이벤트의 start/end 사용)
    const year = date.getFullYear();
    const month = date.getMonth();

    const start = new Date(year, month, 1);
    start.setHours(0, 0, 0, 0);

    const firstDay = start.getDay();
    start.setDate(start.getDate() - firstDay);

    const end = new Date(year, month + 1, 0);
    const lastDay = end.getDay();
    end.setDate(end.getDate() + (6 - lastDay));
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  /**
   * 현재 주가 화면에 표시되는지 확인
   * (현재 주 = 오늘을 포함하는 주)
   */
  isCurrentWeekDisplayed() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { start, end } = this.getWeekRange(this.currentDate);
    return today >= start && today <= end;
  }

  /**
   * 오늘 버튼의 활성 상태 업데이트
   */
  updateTodayButtonState() {
    const todayBtn = document.getElementById("todayBtn");
    if (!todayBtn) return;

    if (this.isCurrentWeekDisplayed()) {
      // 현재 주가 표시 중 → 활성 상태
      todayBtn.classList.add("active");
    } else {
      // 다른 주 표시 중 → 비활성 상태
      todayBtn.classList.remove("active");
    }
  }

  async render() {
    // 💡 [개선] 진단 로그가 추가된 잠금(Lock) 메커니즘
    if (this.renderPromise) {
      await this.renderPromise;
      return;
    }

    let releaseLock;
    const myPromise = new Promise((resolve) => {
      releaseLock = resolve;
    });
    myPromise.owner = "render"; // 디버깅을 위한 잠금 소유자 정보
    this.renderPromise = myPromise;

    try {
      // 실제 렌더링 작업 수행
      await this._doRender();
    } finally {
      releaseLock();
      this.renderPromise = null;
    }
  }

  handleInitialView() {
    const urlParams = new URLSearchParams(window.location.search);

    // 1. 날짜 설정
    const dateParam = urlParams.get('date');
    if (dateParam) {
      const date = new Date(dateParam);
      if (!isNaN(date.getTime())) {
        this.currentDate = date;
        // window._originalConsole.log(`🔧[InitialView] 날짜 설정: ${ this.currentDate.toLocaleDateString() } `);
      }
    }

    // 2. 뷰 모드 설정
    const viewParam = urlParams.get('view');
    if (viewParam === 'month') {
      this.currentView = 'month';
      this.monthPanelOpen = true;
      const monthPanel = document.getElementById("monthPanel");
      if (monthPanel) monthPanel.classList.add("open");
      // window._originalConsole.log(`🔧[InitialView] 뷰 모드: 월간`);
    }

    // 3. 룸 필터 설정
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const rooms = roomParam.split(',').map(r => r.trim().toUpperCase());
      const validRooms = rooms.filter(r => ['A', 'B', 'C', 'D', 'E'].includes(r));
      if (validRooms.length > 0) {
        this.selectedRooms = new Set(validRooms);
        // window._originalConsole.log(`🔧[InitialView] 룸 필터: ${ Array.from(this.selectedRooms).join(', ') } `);

        // UI 업데이트
        const roomBtns = document.querySelectorAll('.room-btn[data-room]');
        roomBtns.forEach(btn => {
          const room = btn.dataset.room.toUpperCase();
          if (this.selectedRooms.has(room)) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });

        // ALL 버튼 상태 업데이트
        const allRoomsBtn = document.getElementById('allRoomsBtn');
        if (allRoomsBtn) {
          if (this.selectedRooms.size === 5) {
            allRoomsBtn.classList.add('active');
          } else {
            allRoomsBtn.classList.remove('active');
          }
        }
      }
    }
  }

  async init(preloadPromise = null) {
    console.log("🚀 Calendar.init()-> calendat-core.init() ");
    if (this.initialized) return;
    this.initialized = true;

    // 초기 뷰 설정 (URL 파라미터 등 확인)
    this.handleInitialView();

    // 초기 렌더링
    await this._doRender(preloadPromise);

    // 윈도우 리사이즈 이벤트 리스너
    window.addEventListener("resize", () => {
      this.adjustWeekViewLayout();
      this.updateCurrentTimeIndicator();
      this.updateRoomBottomLabelsPosition();
    });

    // 주기적 시간 업데이트 시작
    this.startCurrentTimeUpdater();

    // 💡 [수정] 스와이프 제스처 설정 (누락된 호출 추가)
    this.setupPersistentSwipeGestures();

    // 🔴 [신규] 화면 크기 변경 시 월간 이벤트 다시 계산 (Debounce 적용)
    let resizeTimeout;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.adjustMonthEventsOverflow();
      }, 200);
    });

    // 💡 [수정] 버튼 이벤트 리스너 설정 (누락된 호출 추가)
    this.setupEventListeners();
  }

  async _doRender(preloadPromise = null) {
    window._originalConsole.log(`calendat-core.init()->_doRender() currentView: ${this.currentView} `);

    // 🔑 [수정] 제목 직접 설정 대신 updateCalendarTitle() 호출
    this.updateCalendarTitle();

    if (this.currentView === "week") {
      // window._originalConsole.log(`[_doRender]    🟢 renderWeekViewWithSlider 호출`);
      await this.renderWeekViewWithSlider(preloadPromise);
      // window._originalConsole.log(`[_doRender]    ✅ renderWeekViewWithSlider 완료`);

    } else {
      // window._originalConsole.log(`[_doRender]    🟡 month view 렌더링 준비`);
      await this.loadMonthDataToCache(this.currentDate);
      this.renderMonthView();
    }

    // ✅ [신규] 오늘 버튼 상태 업데이트
    this.updateTodayButtonState();
    // window._originalConsole.log(`[_doRender] ✅ 완료\n`);
  }

  async renderWeekViewWithSlider(preloadPromise = null) {
    window._originalConsole.log(`  _doRender()->[renderWeekViewWithSlider() START]`);
    this.isInitialLoading = true;

    // 🔴 [초기 로딩] 3주만 생성 (이전주, 현재주, 다음주)
    const normalizedCurrentDate = new Date(this.currentDate);
    const day = normalizedCurrentDate.getDay();
    normalizedCurrentDate.setDate(normalizedCurrentDate.getDate() - day);

    const dates = [];
    for (let i = -1; i <= 1; i++) {
      const date = new Date(normalizedCurrentDate);
      date.setDate(date.getDate() + i * 7);
      dates.push(date);
    }

    // 🔴 [최적화] 기존 DOM 재사용 가능 여부 확인 (Blinking 방지)
    const existingSlider = this.container.querySelector('.calendar-slider');
    const existingSlides = this.container.querySelectorAll('.calendar-slide');
    let canReuse = false;

    if (existingSlider && existingSlides.length === 3) {
      const keysMatch = Array.from(existingSlides).every((slide, i) => {
        return slide.getAttribute('data-week-key') === this.getWeekCacheKey(dates[i]);
      });
      if (keysMatch) {
        canReuse = true;
        // window._originalConsole.log('♻️ [UI] 기존 슬라이더 DOM 재사용 (Blinking 방지)');
      }
    }

    if (!canReuse) {
      // 🔴 [분리] 1단계: 달력 HTML만 먼저 렌더링 (이벤트 없이)
      let html = this.renderTimeColumn();
      html += '<div class="calendar-slider">';
      const translateValues = [-100, 0, 100];
      dates.forEach((date, i) => {
        const weekKey = this.getWeekCacheKey(date);
        const weekContent = this.renderWeekViewContent(date, true); // true = 이벤트 없이 렌더링
        html += `<div class="calendar-slide" data-week-key="${weekKey}" style="transform: translateX(${translateValues[i]}%)">`;
        html += weekContent;
        html += "</div>";
      });
      html += "</div>";

      // DOM에 달력 렌더링
      this.container.innerHTML = html;
      this.adjustWeekViewLayout(true);
      requestAnimationFrame(() => {
        this.updateCurrentTimeIndicator();
      });
    }


    //인덱스db에서 데이터가져오기
    // window._originalConsole.log("🔄 [renderWeekViewWithSlider] i인덱스db에서 데이터가져오기 ");
    const loadPromises = dates.map(date => this.loadWeekDataToCache(date));
    await Promise.all(loadPromises);


    // 🔍 여기서 확인!
    const currentWeekKey = this.getWeekCacheKey(this.currentDate);
    const events = this.weekDataCache.get(currentWeekKey) || [];

    if (events.length === 0) {
      console.log("⚠️ [UI] 인덱스DB에 데이터가 없습니다! (app-init.js에서 인덱스를 로드합니다.(싱크매니저이용)))");
    } else {
      console.log(`✅ [UI] 인덱스DB에서 ${events.length}개 이벤트 로드 완료`);
    }



    // 로드된 데이터를 기반으로 3개의 모든 슬라이드의 콘텐츠를 업데이트합니다.
    // 💡 [최적화] 병렬 실행으로 렌더링 속도 향상
    await Promise.all(dates.map(date => this.updateSlideContent(date)));

    this.isInitialLoading = false;
  }

  // 🔴 [통일] getIndexedDBCacheKey, convertAndStoreEvents는 CacheRules.js에서 관리
  // 🔴 [로컬] getWeekCacheKey는 calendar의 getWeekRange에 의존하므로 여기서 관리
  getWeekCacheKey(date) {
    const { start } = this.getWeekRange(date);
    const year = start.getFullYear();
    const month = String(start.getMonth() + 1).padStart(2, "0");
    const day = String(start.getDate()).padStart(2, "0");
    const localDateStr = `${year}-${month}-${day}T15:00:00`;
    return localDateStr;
  }

  /**
   * 현재 표시 중인 중앙 주의 캐시 키 반환
   * data-manager.js의 웹훅 화면 갱신에서 사용
   */
  getCenterWeekKey() {
    return this.getWeekCacheKey(this.currentDate);
  }

  // ✅ [최적화] 월간 이동 시 필요한 달들만 로드 (전 월, 현재 월, 다음 월)
  async checkAndLoadNewMonths(date = this.currentDate) {
    // 이 함수는 월간 이동 시에만 호출되며, 필요한 달들만 로드합니다.

    const neededMonths = new Set();

    // 월간 이동이므로 전달, 현재달, 다음달만 필요
    for (let i = -1; i <= 1; i++) {
      const d = new Date(date.getFullYear(), date.getMonth() + i, 1);
      neededMonths.add(`month_${d.getFullYear()}_${d.getMonth()} `);
    }

    const loadPromises = [];
    for (const monthKey of neededMonths) {
      // 🔴 [수정] "month_"를 제거한 후 year, month 추출
      const match = monthKey.match(/month_(\d+)_(\d+)/);
      if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]);
        const monthDate = new Date(year, month, 1);

        // 💡 로컬 캐시에 해당 월의 데이터가 없으면 API 요청
        loadPromises.push(this.loadMonthDataToCache(monthDate));
      }
    }

    await Promise.all(loadPromises);
  }

  // 🔴 [신규] Event 객체 생성 (중복 제거)
  _createEventObject(event, eventStart, eventEnd) {
    const eventRoomId = event._roomId;
    if (!eventRoomId) return null;

    return {
      id: `${eventRoomId}_${event.id} `,
      title: event.summary,
      start: eventStart,
      end: eventEnd,
      roomId: eventRoomId,
      description: event.description,
      googleEventId: event.id,
    };
  }

  // 🔴 [신규] DB 이벤트 객체를 캘린더 내부 포맷으로 변환
  _convertDBEventToCalendarEvent(dbEvent) {
    return {
      id: `${dbEvent.roomId}_${dbEvent.id || dbEvent.googleEventId}`,
      title: dbEvent.title || dbEvent.summary,
      start: new Date(dbEvent.start),
      end: new Date(dbEvent.end),
      roomId: dbEvent.roomId || dbEvent.room_id,
      description: dbEvent.description,
      googleEventId: dbEvent.id || dbEvent.googleEventId,
    };
  }

  // 🔴 [신규] 월간 데이터 로드 (전체 달 1~31일) - IndexedDB 전용
  async loadMonthDataToCache(date, forceReload = false) {
    const monthKey = CacheRules.getMonthCacheKey(date);
    const monthLabel = `${date.getFullYear()}년 ${date.getMonth() + 1} 월`;

    // window._originalConsole.log(`[🔍 loadMonthDataToCache] 시작: ${monthLabel} | 캐시 키: ${monthKey}`);

    // 1. monthDataCache 확인 (메모리 캐시)
    if (CacheRules.hasMonthEvents(this.monthDataCache, monthKey) && !forceReload) {
      // window._originalConsole.log(`   [✅ loadMonthDataToCache] 메모리 캐시 HIT`);
      return;
    }

    try {
      const year = date.getFullYear();
      const month = date.getMonth();

      // 월간 캘린더의 첫 주 시작일(일요일)과 마지막 주 종료일(토요일) 계산
      const monthFirstDay = new Date(year, month, 1);
      const monthLastDay = new Date(year, month + 1, 0);
      const monthFirstWeekStart = new Date(monthFirstDay);
      monthFirstWeekStart.setDate(monthFirstDay.getDate() - monthFirstDay.getDay());
      const monthLastWeekEnd = new Date(monthLastDay);
      monthLastWeekEnd.setDate(monthLastDay.getDate() + (6 - monthLastDay.getDay()));
      monthLastWeekEnd.setHours(23, 59, 59, 999);

      // 🚀 [Clean Local-First] 네트워크 요청 없이 로컬 DB에서만 조회
      // 🔑 [핵심] UI는 IndexedDB만 바라봄 (API 호출 없음)
      window._originalConsole.log(`📖 [UI → IndexedDB] 데이터 읽기: ${monthFirstWeekStart.toLocaleDateString()} ~ ${monthLastWeekEnd.toLocaleDateString()}`);
      const dbEvents = await window.indexedDBManager.getEvents(monthFirstWeekStart, monthLastWeekEnd);
      window._originalConsole.log(`✅ [IndexedDB → UI] ${dbEvents.length}개 이벤트 로드됨`);

      // 룸 필터링 및 포맷 변환
      const selectedRoomIds = Array.from(this.selectedRooms);
      const monthEvents = dbEvents
        .filter(event => selectedRoomIds.includes(event.roomId || event.room_id))
        .map(event => this._convertDBEventToCalendarEvent(event));

      this.monthDataCache.set(monthKey, monthEvents);
      // window._originalConsole.log(`   [✅ loadMonthDataToCache] 로컬 DB로부터 ${monthEvents.length}개 이벤트 로드 완료`);

      // 🚀 [온디맨드 싱크] 백그라운드에서 동기화 트리거 (TTL 체크는 SyncManager가 수행)
      if (window.syncManager) {
        window.syncManager.syncMonth(year, month).catch(err => {
          window._originalConsole.warn(`[⚠️ On-Demand Sync] ${monthLabel} 실패:`, err);
        });
      }

    } catch (error) {
      window._originalConsole.error(`[❌ loadMonthDataToCache] 실패: `, error);
      this.monthDataCache.set(monthKey, []);
    }
  }

  // ✅ [정리] 현재 달 캐시에 로드 (IndexedDB 1년치 데이터 활용)
  async loadMonthEventsForCurrentDate(isMonthSwipe = false) {
    // window._originalConsole.log(`🟣[월간패널] 3개월(이전 / 현재 / 다음달) 병렬 로드 시작`);
    const loadPromises = [];
    for (let i = -1; i <= 1; i++) {
      const monthDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + i, 1);
      loadPromises.push(this.loadMonthDataToCache(monthDate));
    }
    await Promise.all(loadPromises);
    // window._originalConsole.log(`🟣[월간패널] 3개월 병렬 로드 완료\n`);
  }

  // ✅ [정리] 월간 이동도 캐시 채우기
  async loadMonthEventsForSwipe(direction) {
    const checkDate = new Date(this.currentDate);
    checkDate.setMonth(checkDate.getMonth() + (direction === "next" ? 1 : -1));
    await this.checkAndLoadNewMonths(checkDate);
  }



  async loadWeekDataToCache(date, forceReload = false) {
    const weekCacheKey = this.getWeekCacheKey(date);
    // window._originalConsole.log(`\n[loadWeekDataToCache] 🔵 시작 | 키: ${weekCacheKey}`);

    if (this.weekDataCache.has(weekCacheKey) && !forceReload) {
      // window._originalConsole.log(`   [loadWeekDataToCache] ✅ 메모리 캐시 HIT`);
      return;
    }

    if (forceReload) {
      this.weekDataCache.delete(weekCacheKey);
    }

    try {
      const { start, end } = this.getWeekRange(date);

      // 🚀 [Clean Local-First] 네트워크 요청 없이 로컬 DB에서만 조회
      // 🔑 [핵심] UI는 IndexedDB만 바라봄 (API 호출 없음)
      // window._originalConsole.log(`📖 [UI → IndexedDB] 주간 데이터 읽기: ${start.toLocaleDateString()} ~ ${end.toLocaleDateString()}`);
      const dbEvents = await window.indexedDBManager.getEvents(start, end);
      // window._originalConsole.log(`✅ [IndexedDB → UI] ${dbEvents.length}개 이벤트 로드됨`);

      // 룸 필터링 및 포맷 변환
      const selectedRoomIds = Array.from(this.selectedRooms);
      const weekEvents = dbEvents
        .filter(event => selectedRoomIds.includes(event.roomId || event.room_id))
        .map(event => this._convertDBEventToCalendarEvent(event));

      this.weekDataCache.set(weekCacheKey, weekEvents);
      // window._originalConsole.log(`   [✅ loadWeekDataToCache] 로컬 DB로부터 ${weekEvents.length}개 이벤트 로드 완료`);

    } catch (error) {
      window._originalConsole.error(`[❌ loadWeekDataToCache] 실패: `, error);
      this.weekDataCache.set(weekCacheKey, []);
    }
  }

  getMergedEventsFromCache(dates) {
    const allEvents = [];
    const seenIds = new Set();
    const cacheDebug = [];

    dates.forEach((date) => {
      // 🔴 [통일] IndexedDB 규칙으로 불러오기
      const weekCacheKey = this.getWeekCacheKey(date);
      const allWeekEventsForYear = CacheRules.getWeekEvents(this.weekDataCache, weekCacheKey);

      // 해당 주의 이벤트만 필터링
      const { start: weekStart, end: weekEnd } = this.getWeekRange(date);
      const weekEvents = allWeekEventsForYear.filter((event) => {
        return event.start < weekEnd && event.end > weekStart;
      });

      cacheDebug.push(`${weekCacheKey}: ${weekEvents.length} 개`);

      weekEvents.forEach((event) => {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      });
    });

    if (allEvents.length === 0 && cacheDebug.length > 0) {
      // window._originalConsole.log(`📊[weekDataCache 상태] ${ cacheDebug.join(' | ') } `);
    }

    return allEvents;
  }

  renderWeekView() {
    return this.renderWeekViewContent(this.currentDate);
  }

  async updateSlideContent(date) {
    window._originalConsole.log('renderWeekViewWithSlider->[updateSlideContent] 인덱스db기반 슬라이드찾기');
    const slides = this.container.querySelectorAll(".calendar-slide");
    let slideToUpdate = null;

    // 🔴 [통일] 통일된 키로 슬라이드 찾기 (12month-2025)
    const targetWeekKey = this.getWeekCacheKey(date);
    // window._originalConsole.log(`[updateSlideContent]    📅 대상 키: ${targetWeekKey} `);

    // DOM의 모든 슬라이드를 확인해서 일치하는 것 찾기
    for (let slide of slides) {
      const domIdbKey = slide.getAttribute("data-week-key");
      if (domIdbKey === targetWeekKey) {
        slideToUpdate = slide;
        break;
      }
    }

    if (slideToUpdate) {
      // window._originalConsole.log('[updateSlideContent]    ✅ 슬라이드 찾음 → 이벤트 렌더링');
      const newHTML = this.renderWeekViewContent(date);

      slideToUpdate.innerHTML = newHTML;
      // 슬라이드 업데이트 후 높이 계산 재적용
      this.adjustWeekViewLayout(true);
    } else {
      window._originalConsole.log(`[updateSlideContent]    ❌ 슬라이드 찾기 실패: ${targetWeekKey} `);
    }
  }

  renderWeekViewContent(date, skipEvents = false) {
    // 🔴 분리: skipEvents=true면 이벤트 없이 렌더링 (초기 로딩용)
    window._originalConsole.log('[updateSlideContent]->renderWeekViewContent    ✅ 슬라이드 찾음 → 이벤트 렌더링');

    const { start } = this.getWeekRange(date);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      d.setHours(0, 0, 0, 0);
      days.push(d);
    }

    if (!days || days.length === 0) {
      return '<div class="week-view"></div>';
    }

    // 🔴 [통일] IndexedDB 규칙으로 weekDataCache 조회
    const weekCacheKey = this.getWeekCacheKey(date);
    const allWeekEventsForYear = CacheRules.getWeekEvents(this.weekDataCache, weekCacheKey);

    // 해당 주의 이벤트만 필터링
    const { start: weekStart, end: weekEnd } = this.getWeekRange(date);
    const weekEvents = allWeekEventsForYear.filter((event) => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return eventStart < weekEnd && eventEnd > weekStart;
    });

    if (!skipEvents) {
      // window._originalConsole.log(`[renderWeekViewContent] 📅 주: ${start.toLocaleDateString('ko-KR')} ~${end.toLocaleDateString('ko-KR')} | 캐시 이벤트: ${weekEvents.length} 개 | skipEvents: ${skipEvents} `);
    }

    const singleRoomClass =
      this.selectedRooms.size === 1 ? " single-room-mode" : "";
    let html = `<div class="week-view${singleRoomClass}">`;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Header
    html += '<div class="week-header">';
    days.forEach((day) => {
      const isToday = day.getTime() === today.getTime();
      const isSunday = day.getDay() === 0;
      html += `<div class="day-header ${isSunday ? "sunday" : ""} ${isToday ? "today" : ""}">
                <span class="day-name">${CONFIG.dayNames[day.getDay()]}</span>
                <span class="day-date">${day.getDate()}</span>
            </div>`;
    });
    html += "</div>";

    // Time grid
    CONFIG.hoursDisplay.forEach((hourLabel, hourIndex) => {
      html += '<div class="time-row">';
      days.forEach((day) => {
        const timeClass = this.getTimeSlotClass(hourIndex, day);
        let boundaryClass = "";
        if (hourIndex === 6) boundaryClass = " time-boundary-dawn";
        if (hourIndex === 16) boundaryClass = " time-boundary-evening";
        html += `<div class="time-cell ${timeClass}${boundaryClass}" data-date="${day.toISOString()}" data-hour="${hourIndex}"></div>`;
      });
      html += "</div>";
    });

    // Labels
    html += '<div class="time-row room-label-row">';
    days.forEach((day) => {
      const isToday = day.getTime() === today.getTime();
      if (isToday && this.selectedRooms.size !== 1) {
        html += `<div class="time-cell weekday-evening room-labels-cell">${this.renderRoomLabelsInCell()}</div>`;
      } else {
        html += `<div class="time-cell weekday-evening"></div>`;
      }
    });
    html += "</div>";

    // Events (skipEvents=true면 건너뛰기)
    if (!skipEvents) {
      days.forEach((day, dayIndex) => {
        // weekEvents에서 이 day에 해당하는 것만 필터링
        const dayStart = new Date(day);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(23, 59, 59, 999);

        const dayEvents = weekEvents
          .filter((event) => {
            const eventStart = new Date(event.start);
            const eventEnd = new Date(event.end);
            return eventStart < dayEnd && eventEnd > dayStart;
          })
          .map((event) => {
            const eventStart = new Date(event.start);
            const eventEnd = new Date(event.end);
            const segmentStart = eventStart < dayStart ? dayStart : eventStart;
            const segmentEnd = eventEnd > dayEnd ? dayEnd : eventEnd;
            return {
              ...event,
              displayStart: segmentStart,
              displayEnd: segmentEnd,
            };
          });

        const dayWidth = `calc((100% / 7) - 1px)`;
        const dayLeft = `calc((100% / 7 * ${dayIndex}) + ${dayIndex + 1}px)`;

        const isToday = day.getTime() === today.getTime();
        html += `<div class="day-events-container" style="left: ${dayLeft}; width: ${dayWidth};">`;

        if (isToday) {
          html += this.renderRoomDividers();
        }

        dayEvents.forEach((event) => {
          html += this.renderWeekEvent(event, false);
        });

        html += "</div>";
      });
    }

    html += "</div>";
    return html;
  }

  getWeekDays(date) {
    const { start } = this.getWeekRange(date);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      day.setHours(0, 0, 0, 0);
      weekDays.push(day);
    }
    return weekDays;
  }



  renderTimeColumn() {
    let html = '<div class="time-column-fixed">';

    // 헤더 빈 공간
    html += '<div class="time-header-space"></div>';

    // 시간 라벨들
    CONFIG.hoursDisplay.forEach((hourLabel, hourIndex) => {
      let timeLabelClass = "";
      if (hourIndex >= 0 && hourIndex < 6) {
        timeLabelClass = "dawn-time";
      } else if (hourIndex >= 6 && hourIndex < 16) {
        timeLabelClass = "day-time";
      } else if (hourIndex >= 16 && hourIndex < 24) {
        timeLabelClass = "evening-time";
      }

      html += `<div class="time-label ${timeLabelClass}">${hourLabel}</div>`;
    });

    // ✅ 24시 아래에 라벨용 셀 추가
    html += '<div class="time-label room-label-row"></div>';

    html += "</div>";
    return html;
  }

  updateCurrentTimeIndicator() {
    // 기존 인디케이터 제거
    const existing = this.container.querySelectorAll(
      ".current-time-indicator, .current-time-triangle",
    );
    existing.forEach((el) => el.remove());

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 현재 주의 날짜 범위 확인
    const { start, end } = this.getWeekRange(this.currentDate);

    // 현재 시간이 표시된 주에 속하는지 확인
    if (now < start || now > end) {
      return;
    }

    // 🔴 [수정] 24시 이후(다음날 0시)에는 인디케이터 표시 안 함
    // 시간 진행도가 24 이상이면 다음 날로 넘어가야 함
    const hourProgress = currentHour + currentMinute / 60;
    if (hourProgress >= 24) {
      return;
    }

    // 첫 번째 week-view에서 높이 계산
    const firstWeekView = this.container.querySelector(".week-view");
    if (!firstWeekView) return;

    const headerElement = firstWeekView.querySelector(".day-header");
    if (!headerElement) return;

    const headerHeight = headerElement.getBoundingClientRect().height;
    const weekViewHeight = firstWeekView.clientHeight;

    // 🔴 [수정] 라벨 행 높이 계산 (DOM이 0일 경우 계산된 값 사용)
    // adjustWeekViewLayout 로직과 동일하게 width의 20%로 계산
    const dayWidth = firstWeekView.clientWidth / 7;
    const calculatedLabelRowHeight = dayWidth * 0.2;
    const domLabelRowHeight = firstWeekView.querySelector(".room-label-row")?.getBoundingClientRect().height || 0;

    // DOM 높이가 유효하면 그것을, 아니면 계산된 값 사용 (최소 1px 이상이어야 유효로 간주)
    const labelRowHeight = domLabelRowHeight > 1 ? domLabelRowHeight : calculatedLabelRowHeight;

    // 🔴 [수정] 24시간 영역만 사용 (25번째 라벨 행 제외)
    // 전체 높이에서 헤더와 라벨행을 뺀 것이 24시간 영역
    const timeGridHeight = weekViewHeight - headerHeight - labelRowHeight;

    // 🔴 [수정] 시간 위치 계산 - 24시간 그리드 내에서만 계산 (0시 = 0%, 24시 = 100%)
    const topPosition = headerHeight + timeGridHeight * (hourProgress / 24);

    // 1. 시간 컬럼 위 삼각형만
    const triangle = document.createElement("div");
    triangle.className = "current-time-triangle";
    triangle.style.top = `${topPosition}px`;
    this.container.appendChild(triangle);

    // 2. 오늘 날짜 열 찾기 - 중간 슬라이드(현재 주)에서 찾기
    const allSlides = this.container.querySelectorAll(".calendar-slide");
    // 🔴 [수정] 무한 스크롤 구조가 7개에서 3개 슬라이드로 변경됨에 따라, 현재 주를 나타내는 중앙 슬라이드의 인덱스를 3에서 1로 수정합니다.
    const currentSlide = allSlides[1];

    if (!currentSlide) {
      window._originalConsole.warn("[⚠️ updateCurrentTimeIndicator] 현재 주(중앙) 슬라이드를 찾지 못했습니다.");
      return;
    }

    const currentWeekView = currentSlide.querySelector(".week-view");
    if (!currentWeekView) {
      return;
    }

    const allDayHeaders = currentWeekView.querySelectorAll(".day-header");
    let todayIndex = -1;

    allDayHeaders.forEach((header, index) => {
      if (header.classList.contains("today")) {
        todayIndex = index;
      }
    });

    // 오늘 날짜가 있으면 해당 열에만 라인 표시
    if (todayIndex !== -1) {
      // 오늘 날짜 헤더의 실제 위치와 너비 가져오기
      const todayHeader = allDayHeaders[todayIndex];
      if (todayHeader) {
        const headerRect = todayHeader.getBoundingClientRect();
        const slideRect = currentSlide.getBoundingClientRect();

        // 슬라이드 기준 상대 위치 계산 (슬라이드 안에 넣어서 스와이프 시 함께 이동)
        const dayLeft = headerRect.left - slideRect.left;
        const dayWidth = headerRect.width;

        const indicator = document.createElement("div");
        indicator.className = "current-time-indicator";
        indicator.style.top = `${topPosition}px`;
        indicator.style.left = `${dayLeft}px`;
        indicator.style.width = `${dayWidth}px`;
        currentSlide.appendChild(indicator);
      }
    }
  }

  startCurrentTimeUpdater() {
    // 현재 렌더링된 날짜 키 저장
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.lastRenderedDayKey = today.toDateString();

    // 10초마다 현재 시간 표시 업데이트 (더 부드러운 실시간 표시)
    this.updateCurrentTimeIndicator();
    this.updateRoomBottomLabelsPosition();

    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
    }

    this.timeUpdateInterval = setInterval(() => {
      this.updateCurrentTimeIndicator();
      this.updateRoomBottomLabelsPosition();

      // 날짜가 바뀌었는지 확인
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const currentDayKey = now.toDateString();

      if (this.lastRenderedDayKey !== currentDayKey) {
        this.lastRenderedDayKey = currentDayKey;
        this.goToToday();
      }
    }, 10000); // 10초마다 업데이트
  }

  stopCurrentTimeUpdater() {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }
  }

  adjustWeekViewLayout(immediate = false) {
    const doLayout = () => {
      // 첫 번째 week-view를 기준으로 높이 계산
      const firstWeekView = this.container.querySelector(".week-view");
      if (!firstWeekView) return;

      const headerElement = firstWeekView.querySelector(".day-header");
      if (!headerElement) return;

      const headerHeight = headerElement.getBoundingClientRect().height;
      const weekViewHeight = firstWeekView.clientHeight;

      // badge 높이를 기준으로 라벨 행 높이 계산 (width 20% = height with aspect-ratio 1/1)
      const dayWidth = firstWeekView.clientWidth / 7;
      const labelRowHeight = dayWidth * 0.2; // badge width 20%와 동일

      const availableHeight = weekViewHeight - headerHeight - labelRowHeight; // 라벨 행 공간 확보
      const rowHeight = availableHeight / 24; // 24시간을 남은 공간에 맞춤

      // 모든 슬라이드의 week-view 조정
      const allWeekViews = this.container.querySelectorAll(".week-view");

      allWeekViews.forEach((weekView) => {
        // Grid 행 높이: 헤더 + 24시간 + 라벨행
        weekView.style.gridTemplateRows = `${headerHeight}px repeat(24, ${rowHeight}px) ${labelRowHeight}px`;

        // 이 weekView 안의 이벤트 컨테이너들 조정 (7개 요일만)
        const eventContainers = weekView.querySelectorAll(
          ".day-events-container",
        );

        // 주간 보기인지 일간 보기인지 확인
        const isDayView = weekView.classList.contains("day-view-mode");

        eventContainers.forEach((container, index) => {
          const weekViewWidth = weekView.clientWidth;
          const dayWidth = weekViewWidth / 7;

          let dayLeft, dayWidthAdjusted;
          if (isDayView || eventContainers.length === 1) {
            // 일간 보기: 간격 없이
            dayLeft = dayWidth * index;
            dayWidthAdjusted = dayWidth;
          } else {
            // 주간 보기: 컨테이너 좌우 여백으로 날짜 사이 간격 생성
            const gap = 1; // 좌우 및 중간 간격
            dayLeft = dayWidth * index + gap;
            dayWidthAdjusted = dayWidth - gap * 3;
          }

          container.style.left = `${dayLeft}px`;
          container.style.width = `${dayWidthAdjusted}px`;
          container.style.top = `${headerHeight}px`;
          container.style.bottom = "0";
          container.style.paddingTop = "0";
          container.style.height = `${availableHeight}px`;
        });
      });

      // 고정된 시간 열의 헤더 및 각 시간 라벨 높이 조정
      const timeHeaderSpace =
        this.container.querySelector(".time-header-space");
      if (timeHeaderSpace) {
        timeHeaderSpace.style.height = `${headerHeight}px`;
      }

      // 각 시간 라벨의 높이를 week-view의 row 높이와 동일하게 설정
      const timeLabels = this.container.querySelectorAll(
        ".time-column-fixed .time-label",
      );
      timeLabels.forEach((label) => {
        // 라벨 행이 아닌 시간 라벨만 조정
        if (!label.classList.contains("room-label-row")) {
          label.style.height = `${rowHeight}px`;
          label.style.minHeight = `${rowHeight}px`;
          label.style.maxHeight = `${rowHeight}px`;
        } else {
          // 라벨 행은 고정 높이
          label.style.height = `${labelRowHeight}px`;
          label.style.minHeight = `${labelRowHeight}px`;
          label.style.maxHeight = `${labelRowHeight}px`;
        }
      });

      // 레이아웃 변경 후 시간 인디케이터 및 방 라벨 위치 재계산 (화면 크기 변경 대응)
      this.updateCurrentTimeIndicator();
      this.updateRoomBottomLabelsPosition();
    };

    if (immediate) {
      doLayout();
    } else {
      requestAnimationFrame(doLayout);
    }
  }

  renderMonthView() {
    // 🔴 [수정] 주간 범위 대신 전체 월 범위 사용
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    // 월의 첫 날
    const monthStart = new Date(year, month, 1);
    monthStart.setHours(0, 0, 0, 0);

    // 월의 마지막 날
    const monthEnd = new Date(year, month + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    // 첫 주의 일요일로 시작
    const firstDay = monthStart.getDay();
    const calendarStart = new Date(monthStart);
    calendarStart.setDate(calendarStart.getDate() - firstDay);

    // 마지막 주의 토요일로 끝남
    const lastDay = monthEnd.getDay();
    const calendarEnd = new Date(monthEnd);
    calendarEnd.setDate(calendarEnd.getDate() + (6 - lastDay));

    const days = [];
    const current = new Date(calendarStart);

    while (current <= calendarEnd) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    // 주 수 계산
    const weekCount = Math.ceil(days.length / 7);

    let html =
      '<div class="month-view" style="grid-template-rows: repeat(' +
      weekCount +
      ', minmax(0, 1fr));">';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = this.currentDate.getMonth();

    // 🔴 [수정] 월간 캐시에서 현재 달의 모든 이벤트 가져오기
    const monthCacheKey = CacheRules.getMonthCacheKey(this.currentDate);
    const monthCachedEvents =
      CacheRules.getMonthEvents(this.monthDataCache, monthCacheKey) || [];

    days.forEach((day) => {
      const isToday = day.getTime() === today.getTime();
      const isSunday = day.getDay() === 0;
      const isOtherMonth = day.getMonth() !== thisMonth;

      html += `<div class="month-day ${isSunday ? "sunday" : ""} ${isToday ? "today" : ""} ${isOtherMonth ? "other-month" : ""}" data-date="${day.toISOString()}">`;
      html += `<div class="month-day-number">${day.getDate()}</div>`;

      // 이벤트 표시 (전체 달의 이벤트)
      const dayEvents = monthCachedEvents.filter((event) => {
        const eventDate = new Date(event.start);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate.getTime() === day.getTime();
      });

      dayEvents.forEach((event) => {
        html += this.renderMonthEvent(event);
      });

      html += "</div>";
    });

    html += "</div>";
    this.container.innerHTML = html;
  }

  // 💡 [신규] 월간 패널 토글
  async toggleMonthPanel() {
    window._originalConsole.log(
      `🟣[월간패널 토글] monthPanelOpen: ${this.monthPanelOpen} → ${!this.monthPanelOpen} `,
    );

    this.monthPanelOpen = !this.monthPanelOpen;
    const monthPanel = document.getElementById("monthPanel");

    // 🔴 [신규] 뷰 전환 버튼 상태 업데이트
    const viewWeekBtn = document.getElementById("viewWeekBtn");
    const viewMonthBtn = document.getElementById("viewMonthBtn");

    if (this.monthPanelOpen) {
      // 월간 뷰 활성화
      if (viewWeekBtn) viewWeekBtn.classList.remove("active");
      if (viewMonthBtn) viewMonthBtn.classList.add("active");

      // 🔴 [신규] 월간 뷰 활성 클래스 추가 (하단 버튼 숨기기용)
      document.body.classList.add('month-view-active');

      // 🔑 [핵심] 월간 패널 열 때: 현재 주간 뷰 상태 저장
      this.monthPanelOpenedDate = new Date(this.currentDate);
      this.monthPanelNavigated = false;

      window._originalConsole.log(
        `🟣[월간패널 OPEN] currentDate: ${this.currentDate.toDateString()} `,
        `\n   💾 저장된 날짜: ${this.monthPanelOpenedDate.toLocaleDateString('ko-KR')} `,
      );
      monthPanel.classList.add("open");

      // 🔴 [신규] 월간 데이터 로드 (3개월) - 로딩 스피너 제거 (낙관적 렌더링)
      // 💡 [최적화] 즉시 렌더링 후 백그라운드 데이터 로드
      window._originalConsole.log(`🟣[월간렌더링] 즉시 렌더링(캐시 / 빈화면)`);
      this.renderAndSetupMonthSlider();

      // 스피너 제거 (사용자 경험 향상)
      // const loadingSpinner = document.getElementById('monthPanelLoading');
      // if (loadingSpinner) loadingSpinner.classList.add('active');

      // 백그라운드에서 데이터 로드
      this.loadMonthEventsForCurrentDate().then(() => {
        window._originalConsole.log(`🟣[월간데이터] 백그라운드 로드 완료 → 재렌더링`);
        this.renderAndSetupMonthSlider();
        // if (loadingSpinner) loadingSpinner.classList.remove('active');
      }).catch(error => {
        window._originalConsole.error(`🟣[월간데이터 에러]`, error);
        // if (loadingSpinner) loadingSpinner.classList.remove('active');
      });
    } else {
      // 주간 뷰 활성화
      if (viewWeekBtn) viewWeekBtn.classList.add("active");
      if (viewMonthBtn) viewMonthBtn.classList.remove("active");

      window._originalConsole.log(`🟣[월간패널 CLOSE]`);
      // 🔴 [신규] 월간 뷰 활성 클래스 제거
      document.body.classList.remove('month-view-active');

      monthPanel.classList.remove("open");

      // 🔑 [핵심 수정] 이동 여부에 따라 분기
      if (!this.monthPanelNavigated) {
        // ✅ 이동하지 않음 → 원래 주간 뷰로 복원
        this.currentDate = new Date(this.monthPanelOpenedDate);
        window._originalConsole.log(
          `🟣[월간패널→주간] 이동 없음 → 원래 주로 복원: ${this.currentDate.toLocaleDateString('ko-KR')} `
        );
      } else {
        // ✅ 이동함 → 현재 보고 있는 달의 1일이 포함된 주의 일요일로 설정
        const targetDate = new Date(this.currentDate);
        targetDate.setDate(1); // 해당 달의 1일
        targetDate.setHours(0, 0, 0, 0);

        // 🔑 [핵심] 1일이 포함된 주의 일요일로 정규화
        const weekStart = this.getWeekRange(targetDate).start;
        this.currentDate = weekStart;

        window._originalConsole.log(
          `🟣[월간패널→주간] 이동함 → ${targetDate.toLocaleDateString('ko-KR')} 1일 포함 주의 일요일: ${weekStart.toLocaleDateString('ko-KR')} `
        );
      }

      this.currentView = 'week';

      // 🔴 [신규] 상태 복원 후 제목 강제 업데이트 (동기화 보장)
      this.updateCalendarTitle();

      // 주간 뷰 렌더링
      this.render();
    }
  }

  // 💡 [신규] 3개월 슬라이더 렌더링 + 스와이프 설정 (통합)
  renderAndSetupMonthSlider() {
    window._originalConsole.log("🎨 [renderAndSetupMonthSlider] 시작");

    const slider = document.getElementById("monthSlider");
    if (!slider) {
      window._originalConsole.error("❌ [renderAndSetupMonthSlider] monthSlider 요소를 찾을 수 없음!");
      return;
    }

    window._originalConsole.log("✅ [renderAndSetupMonthSlider] monthSlider 요소 확인됨", {
      sliderWidth: slider.offsetWidth,
      sliderHeight: slider.offsetHeight
    });

    // 요소를 유지하면서 innerHTML만 변경
    // Hammer destroy/재생성은 setupMonthSwipe()에서만 처리

    // 이전달, 현재달, 다음달 3개월 항상 로드
    const dates = [];
    for (let i = -1; i <= 1; i++) {
      const d = new Date(this.currentDate);
      d.setMonth(d.getMonth() + i);
      dates.push(d);
    }

    // 🔴 [신규] 요일 헤더 생성
    const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
    let weekdayHtml = '<div class="month-weekdays">';
    weekdayLabels.forEach((label) => {
      weekdayHtml += `<div class="month-weekday">${label}</div>`;
    });
    weekdayHtml += "</div>";

    window._originalConsole.log("📅 [renderAndSetupMonthSlider] 3개월 달력 생성 시작", {
      dates: dates.map(d => d.toLocaleDateString('ko-KR'))
    });

    let html = "";
    dates.forEach((date, dateIndex) => {
      try {
        window._originalConsole.log(`  📆[${dateIndex}번째 달력] ${date.getFullYear()}년 ${date.getMonth() + 1}월 렌더링 시작`);

        // 마스터 키는 연도만 필요 (이벤트 필터링은 각 이벤트의 start/end 사용)
        const year = date.getFullYear();
        const month = date.getMonth();

        // 월간 달력용 범위 계산 (5-6주 = 35-42개 셀)
        const start = new Date(year, month, 1);
        start.setHours(0, 0, 0, 0);

        const firstDay = start.getDay();
        start.setDate(start.getDate() - firstDay);

        const monthEnd = new Date(year, month + 1, 0);
        const lastDay = monthEnd.getDay();
        const end = new Date(year, month + 1, 0);
        end.setDate(end.getDate() + (6 - lastDay));

        const days = [];
        const current = new Date(start);

        while (current < end) {
          days.push(new Date(current));
          current.setDate(current.getDate() + 1);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const thisMonth = date.getMonth();
        const monthYear = `${date.getMonth() + 1} 월`;

        let monthHtml = `<div class="month-header">${monthYear}</div>`;

        // 🔴 [수정] 모든 달력에 요일 헤더 표시 (기본적으로 포함)
        monthHtml += weekdayHtml;
        monthHtml += `<div class="month-view">`;

        // 🔴 [신규] 캐시에서 이번 달의 모든 이벤트 가져오기
        const monthCacheKey = CacheRules.getMonthCacheKey(date);
        const monthCachedEvents = CacheRules.getMonthEvents(this.monthDataCache, monthCacheKey) || [];

        // 🚀 [최적화] 이벤트 버킷팅 (O(N*M) -> O(N))
        const eventsByDate = {};
        monthCachedEvents.forEach(event => {
          const eStart = new Date(event.start);
          const eEnd = new Date(event.end);

          let current = new Date(eStart);
          current.setHours(0, 0, 0, 0);

          const endLimit = new Date(eEnd);
          endLimit.setHours(23, 59, 59, 999);

          if (current < start) current = new Date(start);

          while (current <= endLimit && current <= end) {
            const dateKey = current.toDateString();
            if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
            eventsByDate[dateKey].push(event);

            current.setDate(current.getDate() + 1);
          }
        });

        days.forEach((day) => {
          const isToday = day.getTime() === today.getTime();
          const isSunday = day.getDay() === 0;
          const isOtherMonth = day.getMonth() !== thisMonth;
          const dayOfWeek = ["일", "월", "화", "수", "목", "금", "토"][day.getDay()];

          monthHtml += `<div class="month-day ${isSunday ? "sunday" : ""} ${isToday ? "today" : ""} ${isOtherMonth ? "other-month" : ""}" data-date="${day.toISOString()}">`;
          // 🔴 [수정] 날짜 + 요일 표시 (예: 8 (화))
          monthHtml += `<div class="month-day-number">${day.getDate()} (${dayOfWeek})</div>`;

          // 🚀 [최적화] 버킷에서 조회 (O(1))
          const dayEvents = eventsByDate[day.toDateString()] || [];

          // 🔴 [수정] 모든 이벤트 렌더링하되, 4번째부터는 초기 숨김 (DOM 부하 방지)
          dayEvents.forEach((event, index) => {
            const initialDisplay = index < 4 ? "" : 'display: none';
            monthHtml += this.renderMonthEvent(event, initialDisplay);
          });

          monthHtml += "</div>";
        });

        monthHtml += "</div>";
        // 🔴 [수정] pending-adjustment 클래스 제거 (전체 깜빡임 원인)
        html += `<div class="month-slider-item">${monthHtml}</div>`;

        window._originalConsole.log(`  ✅[${dateIndex}번째 달력] HTML 생성 완료, 크기: ${monthHtml.length} 자`);
      } catch (monthError) {
        window._originalConsole.error(`  ❌[${dateIndex}번째 달력] 렌더링 실패:`, monthError);
        // 에러 발생 시 빈 영역이라도 생성하여 슬라이더 구조 유지
        html += `<div class="month-slider-item"><div class="month-view-error">렌더링 오류</div></div>`;
      }
    });

    window._originalConsole.log("📝 [renderAndSetupMonthSlider] 최종 HTML 크기:", html.length, "자");
    window._originalConsole.log("🎯 [renderAndSetupMonthSlider] slider.innerHTML 설정 중...");

    // 🔴 [핵심 수정] innerHTML만 변경 (요소는 유지)
    slider.innerHTML = html;
    slider.style.transition = "none";
    slider.style.transform = "translateX(-33.33%)";

    window._originalConsole.log("✅ [renderAndSetupMonthSlider] slider.innerHTML 설정 완료", {
      childElementCount: slider.childElementCount,
      innerHTML길이: slider.innerHTML.length
    });

    // 🔴 [개선] 더 큰 높이로 설정 - 이벤트가 모두 보이도록
    // 🔴 [수정] 높이 자동 조정 로직 제거 (CSS flex: 1, height: 100% 사용)
    /*
    setTimeout(() => {
      // ... 높이 계산 로직 제거됨 ...
    }, 50);
    */

    // ✅ [핵심 최종 수정] 매번 setupMonthSwipe() 호출!
    this.setupMonthSwipe();

    // 🔴 [신규] 동적 이벤트 높이 조정 호출
    // 💡 [수정] setTimeout 제거: 렌더링 직후 동기적으로 실행하여 FOUC(깜빡임) 방지
    // innerHTML 설정 후 바로 레이아웃을 강제 계산(reflow)하여 조정된 상태로 첫 프레임이 그려지게 함
    // 🔴 [신규] 동적 이벤트 높이 조정 호출
    // 💡 [수정] 즉시 호출 + 더블 RAF를 통한 지연 호출로 레이아웃 안정성 확보
    this.adjustMonthEventsOverflow();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.adjustMonthEventsOverflow();
      });
    });

    // 🔴 [신규] 월간 이벤트 클릭 리스너 재설정
    if (typeof setupMonthEventListeners === "function") {
      setupMonthEventListeners();
    }
  }

  // 🔴 [신규] 월간 보기 이벤트 동적 높이 조정 함수
  adjustMonthEventsOverflow() {
    const slider = document.getElementById("monthSlider");
    if (!slider) return;

    const items = slider.querySelectorAll(".month-slider-item");
    items.forEach(item => {
      const monthDays = item.querySelectorAll(".month-day");

      monthDays.forEach(day => {
        const dayNumber = day.querySelector(".month-day-number");
        const events = day.querySelectorAll(".month-event:not(.month-more)");

        if (!dayNumber || events.length === 0) return;

        const dayHeight = day.clientHeight;
        const dayNumberHeight = dayNumber.offsetHeight;
        const paddingBottom = 5; // 하단 여유 공간
        const moreHeight = 18; // +N 표시 높이 예상값

        // 🔴 [최적화] 첫 번째 이벤트 높이 측정 (모든 이벤트 높이 동일 가정)
        let eventHeight = 18; // 기본값
        if (events.length > 0) {
          // 첫 번째 이벤트가 숨겨져 있을 수 있으므로 잠시 표시해서 측정
          const firstEvent = events[0];
          const originalDisplay = firstEvent.style.display;
          firstEvent.style.display = "flex";
          eventHeight = firstEvent.offsetHeight + 2; // 마진 포함
          firstEvent.style.display = originalDisplay;
        }

        // 가용 높이 계산
        const availableHeight = dayHeight - dayNumberHeight - paddingBottom;

        // 🔴 [추가] 가용 높이가 없으면(아직 렌더링 전이면) 조정 스킵
        if (availableHeight <= 0) return;

        // 최대 표시 가능 개수 계산 (수학적 계산으로 리플로우 방지)
        // 공간 = (이벤트개수 * 높이) + (더보기버튼 높이)
        // N * H + M <= Available
        // N <= (Available - M) / H

        // 일단 +N 버튼 공간을 뺀 상태에서 몇 개 들어가는지 계산
        let maxEvents = Math.floor((availableHeight - moreHeight) / eventHeight);

        // 만약 모든 이벤트가 다 들어간다면 +N 공간 필요 없음
        if (events.length * eventHeight <= availableHeight) {
          maxEvents = events.length;
        }

        // 최소 1개는 보여주기 (공간이 너무 작아도)
        if (maxEvents < 0) maxEvents = 0;

        // 🔴 [최적화] 계산된 개수만큼만 표시/숨김 적용
        let hiddenCount = 0;

        for (let i = 0; i < events.length; i++) {
          if (i < maxEvents) {
            events[i].style.display = "flex"; // flex로 복구
          } else {
            events[i].style.display = "none";
            hiddenCount++;
          }
        }

        // +N 표시 처리
        const existingMore = day.querySelector(".month-more");
        if (existingMore) existingMore.remove();

        if (hiddenCount > 0) {
          const moreDiv = document.createElement("div");
          moreDiv.className = "month-event month-more";
          moreDiv.textContent = `+ ${hiddenCount} `;
          day.appendChild(moreDiv);
        }
      });

      // 🔴 [신규] 조정 완료 후 투명도 복구 (클래스 제거 로직 삭제)
      // item.classList.remove("pending-adjustment");
    });
  }

  // 💡 [신규] 월간 슬라이더 스와이프 설정 (매번 호출됨)
  setupMonthSwipe() {
    const slider = document.getElementById("monthSlider");
    if (!slider) {
      //   window._originalConsole.warn("⚠️ [월간 스와이프] monthSlider 요소를 찾을 수 없음");
      return;
    }

    // window._originalConsole.log("🔧 [월간 스와이프] setupMonthSwipe() 호출됨");

    // ✅ [핵심 수정] 기존 Hammer destroy 후 재생성
    if (this.monthHammer) {
      window._originalConsole.log("🔧 [월간 스와이프] 기존 Hammer 객체 destroy");
      this.monthHammer.destroy();
      this.monthHammer = null;
    }

    // 🔴 [수정] Hammer.js가 수직 스크롤(pan-y)은 브라우저에 맡기고, 수평 스와이프만 감지하도록 touchAction을 설정합니다.
    // 이렇게 하면 세로 스크롤과 가로 스와이프가 충돌하지 않습니다.
    this.monthHammer = new Hammer(slider, {
      touchAction: 'pan-y'
    });

    this.monthHammer.get("pan").set({
      direction: Hammer.DIRECTION_HORIZONTAL,
      threshold: 10
    });

    // window._originalConsole.log("✅ [월간 스와이프] Hammer 객체 생성 완료", {
    //   direction: "HORIZONTAL",
    //   threshold: 10
    // });

    let startX = -33.33; // 시작 위치
    this.monthIsDragging = false; // 💡 클래스 변수로 변경 (month-day 클릭에서도 접근 가능)
    let isTransitioning = false;
    let isHorizontalGesture = false;
    let panStartTime = 0; // 🔴 [신규] 클릭과 스와이프 구분을 위해 팬 시작 시간 기록

    this.monthHammer.on("panstart", (e) => {
      // 가로 제스처인지 확인
      const deltaX = Math.abs(e.deltaX);
      const deltaY = Math.abs(e.deltaY);
      // 🔴 [수정] 제스처 방향 판단 로직 수정: 수평 이동이 수직 이동보다 클 때만 수평 제스처로 인식합니다.
      isHorizontalGesture = deltaX > deltaY;

      // window._originalConsole.log("👆 [월간 스와이프] PANSTART 발생", {
      //   deltaX: e.deltaX,
      //   deltaY: e.deltaY,
      //   isHorizontalGesture
      // });

      if (!isHorizontalGesture) {
        //window._originalConsole.log("⏭️ [월간 스와이프] 세로 제스처 → 무시");
        return;
      }

      panStartTime = Date.now(); // 🔴 [신규] 시간 기록
      this.monthIsDragging = true;

      // 가로 스와이프 중임을 표시 - 세로 스크롤 차단
      slider.classList.add("swiping");

      // 현재 transform 값을 읽어서 startX 설정
      const computedStyle = window.getComputedStyle(slider);
      const transform = computedStyle.transform;

      if (transform && transform !== "none") {
        // transform: "matrix(1, 0, 0, 1, pixelX, 0)" 형태에서 pixelX 추출
        try {
          const values = transform.match(/matrix\(([^)]+)\)/)[1].split(", ");
          const pixelX = parseFloat(values[4]);
          // pixel을 percent로 변환
          startX = (pixelX / slider.offsetWidth) * 100;
          // window._originalConsole.log("📏 [월간 스와이프] 현재 transform 읽기 성공", {
          //   transform,
          //   pixelX,
          //   startX: startX.toFixed(2) + "%",
          //   sliderWidth: slider.offsetWidth
          // });
        } catch (err) {
          startX = -33.33; // 파싱 실패시 기본값
          // window._originalConsole.warn("⚠️ [월간 스와이프] transform 파싱 실패, 기본값 사용", err);
        }
      } else {
        startX = -33.33;
        //window._originalConsole.log("📏 [월간 스와이프] transform 없음, 기본값 사용", { startX });
      }

      slider.style.transition = "none";
    });

    this.monthHammer.on("pan", (e) => {
      if (!isHorizontalGesture || !this.monthIsDragging) {
        return;
      }

      const delta = (e.deltaX / slider.offsetWidth) * 100;
      const newPos = startX + delta;

      // window._originalConsole.log("👉 [월간 스와이프] PAN 중", {
      //   deltaX: e.deltaX.toFixed(1),
      //   deltaPercent: delta.toFixed(2) + "%",
      //   startX: startX.toFixed(2) + "%",
      //   newPos: newPos.toFixed(2) + "%"
      // });

      slider.style.transform = `translateX(${newPos}%)`;
    });

    const handlePanEnd = (e) => {
      if (!isHorizontalGesture || !this.monthIsDragging) {
        // window._originalConsole.log("⏭️ [월간 스와이프] PANEND 무시", {
        //   isHorizontalGesture,
        //   monthIsDragging: this.monthIsDragging
        // });
        isHorizontalGesture = false; // 리셋
        return;
      }

      // 🔴 [수정] 클릭과 스와이프 구분 강화: 드래그 상태 해제를 지연시킵니다.
      // 이렇게 하면 panend 직후에 발생하는 click 이벤트를 app-init.js의 리스너에서 무시할 수 있습니다.
      setTimeout(() => {
        this.monthIsDragging = false;
        //window._originalConsole.log("🔓 [월간 스와이프] 드래그 상태 해제 (Click 허용)");
      }, 100);

      isHorizontalGesture = false; // 리셋

      // 가로 스와이프 종료 - 세로 스크롤 복원
      slider.classList.remove("swiping");

      const panDuration = Date.now() - panStartTime; // 🔴 [신규] 지속 시간 계산
      const delta = (e.deltaX / slider.offsetWidth) * 100;
      const moved = Math.abs(delta);
      const velocity = Math.abs(e.velocity);
      let targetPos = -33.33;
      let directionChange = 0; // 월 변경 여부

      // window._originalConsole.log("🛑 [월간 스와이프] PANEND 발생", {
      //   deltaX: e.deltaX.toFixed(1),
      //   deltaPercent: delta.toFixed(2) + "%",
      //   moved: moved.toFixed(2) + "%",
      //   velocity: velocity.toFixed(3)
      // });

      // 거리(10% 이상) 또는 속도(0.3 이상) 기반으로 플링(fling) 감지
      if (moved > 10 || velocity > 0.3) {
        if (delta > 0) {
          // 오른쪽 드래그: 이전달
          targetPos = 0;
          directionChange = -1;
          // window._originalConsole.log("⬅️ [월간 스와이프] 이전 달로 이동 결정", { targetPos, directionChange });
        } else {
          // 왼쪽 드래그: 다음달
          targetPos = -66.66;
          directionChange = 1;
          // window._originalConsole.log("➡️ [월간 스와이프] 다음 달로 이동 결정", { targetPos, directionChange });
        }
      } else {
        //window._originalConsole.log("↩️ [월간 스와이프] 중앙으로 복귀 결정", { moved, velocity, targetPos });
      }

      // transition과 transform을 항상 적용 (중간에 멈춤 방지)
      slider.style.transition = "transform 0.35s ease-out";
      slider.style.transform = `translateX(${targetPos}%)`;

      // window._originalConsole.log("🎬 [월간 스와이프] 애니메이션 시작", { targetPos: targetPos + "%" });

      // 🔴 [수정] setTimeout 안전장치를 제거하고, transitionend 이벤트만 사용하도록 단순화합니다.
      // { once: true } 옵션으로 이벤트가 한 번만 실행되도록 보장합니다.
      const transitionEndHandler = () => {
        if (directionChange !== 0) {
          this._navigateMonthWithAnimation(directionChange);
        } else {
          slider.style.transition = "none";
        }
      };

      slider.addEventListener("transitionend", transitionEndHandler, { once: true });

      // 🔴 [신규] 스와이프 종료 후 대기 중인 갱신 확인
      // 네비게이션이 발생하지 않더라도(중앙 복귀) 갱신이 필요할 수 있음
      if (directionChange === 0) {
        setTimeout(() => {
          this.checkPendingRefresh();
        }, 350); // 트랜지션 시간(0.35s) 후 실행
      }
    };

    this.monthHammer.on("panend", handlePanEnd);

    // pancancel 이벤트도 처리 (제스처가 취소되었을 때)
    this.monthHammer.on("pancancel", (e) => {
      //window._originalConsole.log("❌ [월간 스와이프] PANCANCEL 발생 - 중앙으로 복귀");

      if (this.monthIsDragging) {
        this.monthIsDragging = false;

        // 세로 스크롤 복원
        slider.classList.remove("swiping");

        // 중앙으로 복귀
        slider.style.transition = "transform 0.3s ease-out";
        slider.style.transform = "translateX(-33.33%)"; // 중앙 복귀

        // 🔴 [신규] 취소 시에도 대기 중인 갱신 확인
        setTimeout(() => {
          this.checkPendingRefresh();
        }, 300);

        setTimeout(() => {
          slider.style.transition = "none";
        }, 300);
      }
    });

    //window._originalConsole.log("✅ [월간 스와이프] 이벤트 리스너 등록 완료 (panstart, pan, panend, pancancel)");
  }

  getTimeSlotClass(hourIndex, date) {
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (isWeekend) {
      if (hourIndex >= 0 && hourIndex < 6) {
        return "weekend-dawn";
      }
      if (hourIndex >= 6 && hourIndex < 24) {
        return "weekend-day";
      }
    } else {
      if (hourIndex >= 0 && hourIndex < 6) {
        return "weekday-dawn";
      }
      if (hourIndex >= 6 && hourIndex < 16) {
        return "weekday-day";
      }
      if (hourIndex >= 16 && hourIndex < 24) {
        return "weekday-evening";
      }
    }
    return "";
  }

  getEventsForCell(date, hour) {
    const cellStart = new Date(date);
    cellStart.setHours(hour, 0, 0, 0);
    const cellEnd = new Date(cellStart);
    cellEnd.setHours(hour + 1, 0, 0, 0);

    return this.events
      .filter((event) => {
        return event.start < cellEnd && event.end > cellStart;
      })
      .sort((a, b) => {
        // Sort by room for consistent display
        return a.roomId.localeCompare(b.roomId);
      });
  }

  getEventsForDay(day, eventsSource) {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const dayStr = day.toLocaleDateString("ko-KR");

    // 여러 날에 걸친 이벤트를 하루 단위로 분할
    const dayEvents = [];
    let matched = 0,
      filtered = 0;

    eventsSource.forEach((event) => {
      // 🔴 [상세진단] 시간 범위 검증
      const isOverlap = event.start < dayEnd && event.end > dayStart;
      if (isOverlap) matched++;

      // 이벤트가 이 날짜와 겹치는지 확인
      if (isOverlap) {
        filtered++;
        // 이 날짜에 해당하는 부분만 추출
        const segmentStart = event.start < dayStart ? dayStart : event.start;
        const segmentEnd = event.end > dayEnd ? dayEnd : event.end;

        // 자정넘어가는 이벤트 로그
        if (event.start < dayStart || event.end > dayEnd) {
        }

        dayEvents.push({
          ...event,
          displayStart: segmentStart,
          displayEnd: segmentEnd,
        });
      }
    });

    return dayEvents;
  }

  renderRoomDividers() {
    const isSingleRoom = this.selectedRooms.size === 1;

    // 5개 방을 구분하는 4개의 세로선 (20%, 40%, 60%, 80% 위치)
    const dividers = [
      { position: 20 },
      { position: 40 },
      { position: 60 },
      { position: 80 },
    ];

    // 5개 방 영역의 중앙에 텍스트 표시 (한 글자씩)
    const roomLabels = [
      { position: 10, label: "A홀예약가능", roomName: "A" }, // A홀: 0-20% 중앙
      { position: 30, label: "B홀예약가능", roomName: "B" }, // B홀: 20-40% 중앙
      { position: 50, label: "C홀예약가능", roomName: "C" }, // C홀: 40-60% 중앙
      { position: 70, label: "D홀예약가능", roomName: "D" }, // D홀: 60-80% 중앙
      { position: 90, label: "E홀예약가능", roomName: "E" }, // E홀: 80-100% 중앙
    ];

    // 단일 방 선택 시 hide-content 클래스 추가 (배경색만 보이고 내용은 숨김)
    let html = `<div class="room-dividers-container${isSingleRoom ? " hide-content" : ""}">`;

    // 세로선 렌더링
    dividers.forEach((divider) => {
      html += `<div class="room-divider-line" style="left: ${divider.position}%;"></div>`;
    });

    // 방 라벨 렌더링 (위쪽, 아래쪽 2번)
    roomLabels.forEach((room) => {
      // 한 글자씩 분리
      const chars = Array.from(room.label);

      // 위쪽 라벨
      html += `<div class="room-label-container room-label-top" style="left: ${room.position}%;">`;
      chars.forEach((char) => {
        html += `<div class="room-label-char">${char}</div>`;
      });
      html += `</div>`;

      // 아래쪽 라벨
      html += `<div class="room-label-container room-label-bottom" style="left: ${room.position}%;">`;
      chars.forEach((char) => {
        html += `<div class="room-label-char">${char}</div>`;
      });
      html += `</div>`;
    });

    html += "</div>";
    return html;
  }

  updateRoomBottomLabelsPosition() {
    const roomLabels = document.querySelector(".room-bottom-labels-outside");
    if (!roomLabels) return;

    const slider = this.container.querySelector(".calendar-slider");
    if (!slider) return;

    // 오늘이 현재 주에 있는지 확인
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { start: weekStart } = this.getWeekRange(this.currentDate);
    const todayDayIndex = Math.floor(
      (today - weekStart) / (1000 * 60 * 60 * 24),
    );

    if (todayDayIndex < 0 || todayDayIndex >= 7) {
      roomLabels.style.display = "none";
      return;
    }

    // 단일 방 선택 시 숨김
    if (this.selectedRooms.size === 1) {
      roomLabels.style.display = "none";
      return;
    }

    // 슬라이더의 실제 픽셀 크기 가져오기
    const sliderRect = slider.getBoundingClientRect();

    // 오늘 날짜 컬럼의 위치 계산 (픽셀 단위)
    const dayWidth = sliderRect.width / 7;
    const todayLeft = sliderRect.left + dayWidth * todayDayIndex;

    // 픽셀 단위로 위치 설정
    roomLabels.style.left = `${todayLeft}px`;
    roomLabels.style.width = `${dayWidth}px`;
    roomLabels.style.display = "flex";
  }

  renderRoomLabelsInCell() {
    // 5개 방 이름과 색상 (A B C D E)
    const roomLabels = [
      { position: 10, roomName: "A", roomId: "a" },
      { position: 30, roomName: "B", roomId: "b" },
      { position: 50, roomName: "C", roomId: "c" },
      { position: 70, roomName: "D", roomId: "d" },
      { position: 90, roomName: "E", roomId: "e" },
    ];

    let html = '<div class="room-labels-in-cell">';

    roomLabels.forEach((room) => {
      const roomColor =
        CONFIG.rooms[room.roomId]?.color || "rgba(255, 255, 255, 0.15)";
      html += `<div class="room-label-badge" style="left: ${room.position}%; background-color: ${roomColor};">${room.roomName}</div>`;
    });

    html += "</div>";
    return html;
  }

  renderWeekEvent(event, isDayView = false) {
    const displayStart = event.displayStart || event.start;
    const displayEnd = event.displayEnd || event.end;

    const startHour = displayStart.getHours();
    const startMin = displayStart.getMinutes();
    const endHour = displayEnd.getHours();
    const endMin = displayEnd.getMinutes();

    const startPercent = ((startHour * 60 + startMin) / (24 * 60)) * 100;
    const endPercent = ((endHour * 60 + endMin) / (24 * 60)) * 100;
    const height = endPercent - startPercent;

    if (height <= 0) {
      window._originalConsole.log(
        `⚠️ renderWeekEvent 스킵: height = ${height}% (높이 0 이하)`,
      );
      return "";
    }

    // 단일 방 필터링된 경우 100% width, 아니면 고정 위치
    let position;
    if (this.selectedRooms.size === 1) {
      // 단일 방만 선택된 경우 100% width
      position = { left: 0, width: 100 };
    } else {
      // 모든 방 표시 시 고정 위치: A=0-20%, B=20-40%, C=40-60%, D=60-80%, E=80-100%
      const roomPositions = {
        a: { left: 0, width: 20 },
        b: { left: 20, width: 20 },
        c: { left: 40, width: 20 },
        d: { left: 60, width: 20 },
        e: { left: 80, width: 20 },
      };
      position = roomPositions[event.roomId];
    }

    const roomName =
      CONFIG.rooms[event.roomId]?.name || event.roomId.toUpperCase();
    const timeStr = `${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")} -${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")} `;

    // 일간 보기: 방 이름 + 전체 타이틀 + 시간 표시
    // 단독 방 선택: 타이틀+시간
    // ALL 선택: 첫글자+시간
    let eventContent;
    const title = event.title || "(제목 없음)"; // 💡 null/undefined 처리

    if (isDayView) {
      // 일간 보기: 타이틀에서 방 이름, (, 숫자 제거
      // 예: "A홀 (2 이****님" → "이****님"
      let cleanTitle = title.replace(/^[A-E]홀\s*/, ""); // A홀 제거
      cleanTitle = cleanTitle.replace(/\(/g, ""); // ( 제거
      cleanTitle = cleanTitle.replace(/\d+/g, ""); // 숫자 제거
      cleanTitle = cleanTitle.trim(); // 공백 정리
      eventContent = `<div class="event-room">${roomName}</div>
                             <div class="event-title">${cleanTitle}</div>
                             <div class="event-time">${timeStr}</div>`;
    } else if (this.selectedRooms.size === 1) {
      eventContent = `<div class="event-title">${title}</div>
      <div class="event-time">${timeStr}</div>`;
    } else {
      // 주간 보기: 시작-종료 시간 + 타이틀에서 글자 추출하여 세로로 나열
      // 시작-종료 시간 표시 (예: 10:00-11:00 / 김 / ○ / 님)
      const eventStart = new Date(displayStart);
      const eventEnd = new Date(displayEnd);
      const timeStartHour = eventStart.getHours();
      const timeStartMin = eventStart.getMinutes();
      const timeEndHour = eventEnd.getHours();
      const timeEndMin = eventEnd.getMinutes();
      const timeDisplay = `${timeStartHour}:${timeStartMin.toString().padStart(2, "0")} -${timeEndHour}:${timeEndMin.toString().padStart(2, "0")} `;

      let displayText = "";

      // 패턴 1: X****님 형식에서 세로로 나열 (예: 박 / ○ / 님)
      const nameMatch = title.match(/([^\s()\d])\*+님/);
      if (nameMatch) {
        const firstChar = nameMatch[1];
        displayText = `<div class="event-time-short">${timeDisplay}</div><div class="name-char">${firstChar}</div><div class="name-circle">*</div><div class="name-suffix">님</div>`;
      } else {
        // 패턴 2: 알파벳만 추출 (sc, ka 등) → sc / ○ / 님
        const alphaMatch = title.match(/[a-zA-Z]+/);
        if (alphaMatch) {
          displayText = `<div class="event-time-short">${timeDisplay}</div><div class="name-char">${alphaMatch[0]}</div><div class="name-circle">○</div><div class="name-suffix">님</div>`;
        } else {
          displayText = `<div class="event-time-short">${timeDisplay}</div>`;
        }
      }

      eventContent = `<div class="event-initial-only">${displayText}</div>`;
    }

    const eventDate = new Date(displayStart);
    eventDate.setHours(0, 0, 0, 0);

    const html = `<div class="week-event room-${event.roomId}"
    style="top: ${startPercent}%; height: ${height}%; width: ${position.width}%; left: ${position.left}%;"
    data-event-date="${eventDate.toISOString()}"
    title="${roomName}: ${event.title} (${timeStr})">
      ${eventContent}
                 </div>`;
    // window._originalConsole.log(`📌 렌더 이벤트: ${ event.title.substring(0, 20) } | top:${ startPercent.toFixed(1) }% h:${ height.toFixed(1) }% w:${ position.width }% `);
    return html;
  }

  groupOverlappingEvents(events) {
    if (events.length === 0) return [];

    // Sort events by start time
    const sorted = [...events].sort((a, b) => a.start - b.start);
    const groups = [];
    let currentGroup = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const event = sorted[i];
      const lastInGroup = currentGroup[currentGroup.length - 1];

      // Check if this event overlaps with any in current group
      const overlaps = currentGroup.some(
        (e) => event.start < e.end && e.end > e.start,
      );

      if (overlaps) {
        currentGroup.push(event);
      } else {
        groups.push(currentGroup);
        currentGroup = [event];
      }
    }

    groups.push(currentGroup);
    return groups;
  }

  renderMonthEvent(event, extraStyle = "") {
    // 🔴 [수정] 시간 범위 표기 (HH~HH시 형식)
    const startTime = new Date(event.start);
    const endTime = new Date(event.end);
    const startHour = String(startTime.getHours()).padStart(2, "0");
    const endHour = String(endTime.getHours()).padStart(2, "0");
    const timeStr = `${startHour} ~${endHour} 시`;

    // 🔴 [안전 코드 추가] roomId 존재 여부 확인
    const roomInfo = CONFIG.rooms[event.roomId];
    const roomColor = roomInfo ? roomInfo.color : '#666'; // 기본 회색
    const roomClass = event.roomId || 'unknown';

    if (!roomInfo) {
      window._originalConsole.warn(`[⚠️ renderMonthEvent] 알 수 없는 Room ID: ${event.roomId}`, event);
    }

    // 🔴 [수정] style 속성 추가 (초기 숨김 지원)
    return `<div class="month-event room-${roomClass}"
    style="border-left-color: ${roomColor}; ${extraStyle}"
    title="${timeStr} ${event.title}"
    data-event-id="${event.id}"
    data-start="${event.start}"
    data-end="${event.end}">
                   <span class="month-event-time">${timeStr}</span>
                   <span class="month-event-title">${event.title}</span>
               </div>`;
  }

  async refresh() {
    // 기존 함수는 refreshCurrentView로 대체됨
    await this.refreshCurrentView();
  }
}
