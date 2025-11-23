class Calendar {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentDate = new Date();
    this.currentView = "week";
    this.selectedRooms = new Set(Object.keys(CONFIG.rooms));
    this.events = [];
    this.hammer = null;

    // 💡 [개선] 상태 머신: 'IDLE', 'PANNING', 'ANIMATING'
    this.swipeState = 'IDLE'; 

    this.hasPendingGestureNavigation = false; // 제스처 네비게이션 중복 방지
    this.isInitialLoading = true; // 🆕 초기 3주 로드 중 스와이프 차단
    this.currentSlideIndex = 3; // 0-6 중 중앙 (7개 슬라이드)
    this.weekDataCache = new Map(); // 주간 데이터 캐시
    this.weekDataPromises = new Map(); // 💡 진행 중인 주간 데이터 요청을 추적
    this.baseTranslate = -14.2857; // 현재 slider의 기본 위치 (% = 100/7)
    this.timeUpdateInterval = null; // 현재 시간 업데이트 타이머
    this.renderPromise = null; // render 동시 실행 방지 배리어
    this.lastSwipeTime = 0; // 마지막 스와이프 시간 (클릭 vs 스와이프 구분)
    this.pendingNavigationDirection = null; // 🆕 대기 중인 스와이프 방향
  }

  async init() {
    if (window.logger) logger.info("Calendar init starting");
    devLog("🚀 [CALENDAR_INIT] 시작");

    try {
      const dmStart = Date.now();
      await window.dataManager.init();
      const dmTime = Date.now() - dmStart;
      if (window.logger)
        logger.info("DataManager initialized", { time: dmTime });
      devLog(`✅ [DataManager] 초기화 완료 (${dmTime}ms)`);
    } catch (error) {
      if (window.logger)
        logger.error("DataManager init failed", { message: error.message });
      devLog(`❌ [DataManager] 초기화 실패: ${error.message}`);
    }

    if (window.logger)
      logger.info("Setting up calendar listeners and observers");
    devLog("🔧 [SETUP] 이벤트 리스너 및 옵저버 설정 중");

    this.setupEventListeners();
    this.setupResizeObserver();

    if (window.logger) logger.info("Rendering calendar");
    devLog("🎨 [RENDER] 달력 렌더링 시작");
    const renderStart = Date.now();
    await this.render();
    const renderTime = Date.now() - renderStart;
    if (window.logger)
      logger.info("Calendar rendered", {
        time: renderTime,
        cacheSize: this.weekDataCache.size,
      });
    devLog(
      `✅ [RENDER] 달력 렌더링 완료 (${renderTime}ms, 캐시: ${this.weekDataCache.size}개)`,
    );

    // 💡 [개선] 앱 초기화 시 단 한 번만 스와이프 제스처를 설정합니다.
    if (window.logger) logger.info("Setting up persistent swipe gestures");
    this.setupPersistentSwipeGestures();
    if (window.logger) logger.info("Persistent swipe gestures ready");

    if (window.logger) logger.info("Starting current time updater");
    this.startCurrentTimeUpdater();
    if (window.logger) logger.info("Calendar initialized successfully");
    devLog("✅ [CALENDAR_INIT] 완료");
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
    // 헤더 월간 네비게이션
    document.getElementById("prevMonthBtn").addEventListener("click", () => {
      // 💡 [개선] 애니메이션 중에는 재렌더링 버튼 동작 방지
      if (this.swipeState !== 'IDLE') return;
      this.goToPrevMonth();
    });
    document.getElementById("nextMonthBtn").addEventListener("click", () => {
      // 💡 [개선] 애니메이션 중에는 재렌더링 버튼 동작 방지
      if (this.swipeState !== 'IDLE') return;
      this.goToNextMonth();
    });

    // 푸터 네비게이션
    document.getElementById("prevWeekBtn").addEventListener("click", () => {
      // 💡 [수정] 상태 머신에 맞춰 수정: IDLE 상태일 때만 애니메이션 시작
      if (this.swipeState !== 'IDLE' || this.isInitialLoading) return;
      this.swipeState = 'ANIMATING';
      this.navigate(-1);
    });
    document.getElementById("nextWeekBtn").addEventListener("click", () => {
      // 💡 [수정] 상태 머신에 맞춰 수정: IDLE 상태일 때만 애니메이션 시작
      if (this.swipeState !== 'IDLE' || this.isInitialLoading) return;
      this.swipeState = 'ANIMATING';
      this.navigate(1);
    });
    document.getElementById("todayBtn").addEventListener("click", () => {
      // 💡 [개선] 애니메이션 중에는 재렌더링 버튼 동작 방지
      if (this.swipeState !== 'IDLE') return;
      this.goToToday();
    });

    // 방 선택
    document.querySelectorAll(".room-btn[data-room]").forEach((btn) => {
      btn.addEventListener("click", () => this.toggleRoom(btn.dataset.room));
    });

    document
      .getElementById("allRoomsBtn")
      .addEventListener("click", () => this.toggleAllRooms());
  }

  /**
   * 💡 [개선] 영구적인 스와이프 제스처 설정
   * 앱 초기화 시 단 한 번만 호출되어 안정성을 높입니다.
   */
  setupPersistentSwipeGestures() {
    devLog("🔍 Hammer.js 확인:", typeof Hammer);
    if (typeof Hammer === "undefined") {
      console.error("❌ Hammer.js가 로드되지 않았습니다!");
      return;
    }

    // 이벤트 위임(Event Delegation)을 위해 상위 컨테이너에 Hammer를 연결합니다.
    this.hammer = new Hammer(this.container, {
      touchAction: "auto",
      inputClass: Hammer.TouchMouseInput,
    });

    this.hammer.get("pan").set({
      direction: Hammer.DIRECTION_HORIZONTAL,
      threshold: 10, // 10px 이상 움직여야 pan 시작
      enable: true,
    });

    console.log(
      `%c✅ [SWIPE] 영구적인 Hammer 리스너 설정 완료 (컨테이너 기준)`,
      "background: #00ff00; color: black; padding: 2px 5px;",
    );

    let swipeStartTime = 0;
    let slideStarts = [-300, -200, -100, 0, 100, 200, 300];

    this.hammer.on("panstart", (e) => {
      // 1. 상태 확인: IDLE 상태가 아니면 아무것도 하지 않음
      if (this.swipeState !== 'IDLE') {
        devLog(`🚫 [panstart] 무시 (현재 상태: ${this.swipeState})`);
        return;
      }

      // 2. 초기 로딩 중 스와이프 차단
      if (this.isInitialLoading) {
        devLog(`🚫 초기 로드 중: 스와이프 차단됨`);
        return;
      }

      // 3. 스와이프 시작점 확인: calendar-slider 안에서 시작했는지 확인
      if (!e.target.closest('.calendar-slider')) {
        devLog(`🚫 [panstart] 무시 (스와이프 시작점이 슬라이더 외부)`);
        return;
      }

      // 4. 스와이프 시작 처리
      this.swipeState = 'PANNING';
      devLog(`👉 [panstart] 스와이프 시작. 상태: ${this.swipeState}`);

      const slides = this.container.querySelectorAll(".calendar-slide");
      if (slides.length === 7) {
        // 드래그하는 동안 부드럽게 움직이도록 transition 제거
        slides.forEach((slide, i) => {
          slide.style.transition = "none";
        });
        slideStarts = [-300, -200, -100, 0, 100, 200, 300];
        swipeStartTime = Date.now();
      }
    });

    this.hammer.on("panmove", (e) => {
      // 1. 상태 확인: PANNING 상태가 아니면 무시
      if (this.swipeState !== 'PANNING') {
        return;
      }

      // 2. 슬라이드 이동
      const slides = this.container.querySelectorAll(".calendar-slide");
      if (slides.length === 7) {
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
      if (this.swipeState !== 'PANNING') {
        devLog(`🚫 [panend] 무시 (현재 상태: ${this.swipeState})`);
        return;
      }

      // 2. 상태 변경: 애니메이션 시작
      this.swipeState = 'ANIMATING';
      devLog(`🔚 [panend] 스와이프 종료. 상태: ${this.swipeState}`);

      const slides = this.container.querySelectorAll(".calendar-slide");
      // 💡 [개선] 예외 상황 방어: 슬라이드가 7개가 아니면 강제로 복귀시켜 멈춤 현상 방지
      if (slides.length !== 7) {
        devLog(`❌ [panend] 슬라이드 개수 오류 (${slides.length}/7). 강제 복귀.`);
        this.snapBack();
        return;
      }

      if (slides.length === 7) {
        const swipeEndTime = Date.now();
        const duration = swipeEndTime - swipeStartTime;
        const distance = Math.abs(e.deltaX);
        const velocity = e.velocityX;

        // 3. 애니메이션 활성화
        slides.forEach((slide) => {
          slide.style.transition = `transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)`;
        });

        // 4. 이동 결정 로직
        const sliderWidth = this.container.querySelector('.calendar-slider').offsetWidth;
         // 💡 [개선] 민감도 재조정: 빠른 플링(fling)에 더 민감하게 반응하도록 속도 기준을 낮추고, 의도치 않은 이동을 줄이기 위해 거리 기준을 약간 높입니다.
         const distanceThreshold = sliderWidth * 0.15; 
         const velocityThreshold = 0.1;
 
        const shouldNavigate = distance > distanceThreshold || Math.abs(velocity) > velocityThreshold;

        devLog(`[panend] 분석: 이동거리=${distance.toFixed(0)}px (기준:${distanceThreshold.toFixed(0)}px), 속도=${velocity.toFixed(2)} (기준:${velocityThreshold}) -> ${shouldNavigate ? '이동' : '복귀'}`);

        if (shouldNavigate) {
          const direction = e.deltaX < 0 ? 1 : -1;
          this.navigate(direction);
        } else {
             // 💡 [개선] 스와이프가 무시된 이유를 명확히 로깅
             devLog(`[panend] 복귀: 이동거리(${distance.toFixed(0)}px)와 속도(${Math.abs(velocity).toFixed(2)})가 기준치에 미달`);
     
          this.snapBack();
        }
      }
    });

    this.hammer.on("pancancel", (e) => {
      if (this.swipeState === 'PANNING') {
        devLog(`[pancancel] 스와이프 취소됨. 상태: ${this.swipeState} -> ANIMATING`);
        this.swipeState = 'ANIMATING';
        this.snapBack();
      }
    });

    this.hammer.on("tap", (e) => {
      if (this.currentView !== "week") return;

      const eventEl = e.target.closest(".week-event");
      if (eventEl) {
        const eventDate = eventEl.dataset.eventDate;
        if (eventDate) {
          console.log(
            `%c📅 [tap] 이벤트 탭 → 일간 보기 전환`,
            "background: #0088ff; color: white; font-weight: bold; padding: 2px 5px;",
            { eventDate },
          );
          this.switchToDayView(new Date(eventDate));
        }
      }
    });    
  }

  /**
   * 💡 [개선] 제자리로 돌아가는 애니메이션
   */
  snapBack() {
    devLog(`↩️ [snapBack] 원위치로 복귀`);
    const slides = this.container.querySelectorAll(".calendar-slide");
    if (slides.length !== 7) {
      this.swipeState = 'IDLE';
      return;
    }

    slides.forEach((slide, i) => {
      slide.style.transition = "transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)";
      slide.style.transform = `translateX(${[-300, -200, -100, 0, 100, 200, 300][i]}%)`;
    });

    let finalized = false;
    const onFinish = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timeoutId);

      if (this.swipeState === "ANIMATING") {
        this.swipeState = 'IDLE';
        devLog(`✅ [snapBack] 복귀 완료. 상태: ${this.swipeState}`);
      }
    };

    const transitionEndHandler = (e) => {
      if (e.propertyName !== "transform") return;
      onFinish();
    };

    slides[3].addEventListener("transitionend", transitionEndHandler, { once: true });

    const timeoutId = setTimeout(() => {
      devLog(`⏱️ [snapBack] 타임아웃 강제 완료`);
      onFinish();
    }, 400);
  }

  async navigate(direction) {
    // 💡 [개선] 상태 머신으로 중복 실행 방지
    if (this.swipeState !== 'ANIMATING') {
      devLog(`🚫 [navigate] 잘못된 호출 (현재 상태: ${this.swipeState})`);
      return;
    }

    console.log(
      `%c🚀 [NAVIGATE] 시작`,
      "background: #00ffff; color: black; font-weight: bold; padding: 3px 8px;",
      {
        direction: direction === 1 ? "다음 주 →" : "이전 주 ←",
        swipeState: this.swipeState,
      },
    );

    // render 진행 중이면 대기
    if (this.renderPromise) {
      devLog("⏸️ [렌더 대기] navigate 시작 전 render 완료 대기...");
      await this.renderPromise;
    }

    console.log(
      `%c📍 [NAVIGATE] Step 1: 슬라이드 확인`,
      "color: #666; font-size: 11px;",
    );

    const slides = this.container.querySelectorAll(".calendar-slide");
    if (slides.length !== 7) {
      console.log(
        `%c⚠️ [NAVIGATE] 슬라이드 부족 ${slides.length}/7`,
        "color: orange;",
      );
      // 슬라이드가 부족하면 상태를 리셋하고 다시 렌더링
      this.swipeState = 'IDLE';
      await this.render();
      return;
    }

    console.log(
      `%c📍 [NAVIGATE] Step 2: 애니메이션 시작 (transform 적용)`,
      "color: #666; font-size: 11px;",
    );

    // 🆕 애니메이션 시작 직후 날짜 미리 계산 + 제목 즉시 업데이트
    this.currentDate.setDate(this.currentDate.getDate() + direction * 7);
    this.updateCalendarTitle();
    console.log(
      `%c📅 [NAVIGATE] 날짜 즉시 업데이트: ${this.currentDate.toLocaleDateString("ko-KR")}`,
      "background: #00ffff; color: black; padding: 2px 5px;",
    );

    // 각 슬라이드를 100% 이동 (7개)
    const currentPositions = [-300, -200, -100, 0, 100, 200, 300];
    const targets = currentPositions.map(
      (pos) => pos + (direction === 1 ? -100 : 100),
    );
    slides.forEach((slide, i) => {
      slide.style.transform = `translateX(${targets[i]}%)`;
    });

    console.log(
      `%c📍 [NAVIGATE] Step 3: transitionend 리스너 등록`,
      "color: #666; font-size: 11px;",
    );

    // 💡 [수정] transitionend와 setTimeout의 경합(Race Condition)을 방지하는 '게이트키퍼' 로직
    let finalized = false;
    const onFinish = async () => {
      if (finalized) return; // 중복 실행 방지
      finalized = true;

      // 타이머가 실행되지 않도록 정리
      clearTimeout(timeoutId);

      await this.finalizeNavigation(direction, slides);
    };

    // transitionend 대기 (중앙 슬라이드 = 인덱스 3)
    const handleTransitionEnd = (e) => {
      // transform 애니메이션이 끝났을 때만 반응
      if (e.propertyName !== "transform") return;
      console.log(
        `%c🎬 [NAVIGATE] transitionend 발생!`,
        "background: #00ff00; color: black; padding: 2px 5px;",
      );
      onFinish();
    };

    // { once: true } 옵션으로 리스너가 단 한 번만 실행되도록 보장
    slides[3].addEventListener("transitionend", handleTransitionEnd, { once: true });

    // 안전장치: 500ms 후 강제 완료
    const timeoutId = setTimeout(() => {
      console.log(`%c⏱️ [NAVIGATE] 타임아웃 강제 완료`, "color: orange;");
      onFinish();
    }, 500);
  }

  async finalizeNavigation(direction, slidesArray) {
    console.log(
      `%c🔄 [FINALIZE] 시작`,
      "background: #ffff00; color: black; font-weight: bold; padding: 3px 8px;",
      { direction: direction === 1 ? "다음 주" : "이전 주" },
    );

    const slides = Array.from(slidesArray); // NodeList를 Array로 변환
    if (slides.length !== 7) {
      this.swipeState = 'IDLE'; // 비정상 상태에서 복구
      return;
    }

    const slider = this.container.querySelector(".calendar-slider");
    const labelsSlider = document.querySelector(".room-labels-slider");

    // 트랜지션 비활성화
    slides.forEach((slide) => {
      slide.style.transition = "none";
    });

    // 💡 [개선] DOM 재배열: 슬라이드를 실제로 옮겨 무한 스크롤 구현
    if (direction === 1) {
      // 다음 주: 첫 슬라이드를 끝으로
      slider.appendChild(slides[0]);
    } else {
      // 이전 주: 끝 슬라이드를 처음으로
      slider.insertBefore(slides[6], slides[0]);

    }

    console.log(
      `%c🔄 [FINALIZE] DOM 재배열 완료, 데이터 준비 중...`,
      "color: #0088ff;",
    );

    // 💡 [개선] 데이터 로딩을 기다리지 않고 즉시 다음 스와이프가 가능하도록 변경
    // UI의 반응성을 높이기 위해 데이터 로딩(네트워크 요청)을 백그라운드에서 처리하고,
    // 애니메이션과 상태 업데이트는 즉시 완료시킵니다.
    this.prepareAdjacentSlides(direction);

    console.log(`%c🔄 [FINALIZE] 슬라이드 원위치 복원`, "color: #0088ff;");

    // 각 슬라이드를 원위치로 리셋 (transition 없이)
    const newSlides = this.container.querySelectorAll(".calendar-slide");
    newSlides.forEach((slide, i) => {
      slide.style.transform = `translateX(${[-300, -200, -100, 0, 100, 200, 300][i]}%)`;
    });

    // 레이아웃 조정
    this.adjustWeekViewLayout(true);

    // 현재 시간 표시
    requestAnimationFrame(() => {
      this.updateCurrentTimeIndicator();
    });

    // 다음 프레임에서 트랜지션 재활성화
    requestAnimationFrame(() => {
      newSlides.forEach((slide) => {
        slide.style.transition = "";
      });
    });

    console.log(
      `%c✅ [FINALIZE] 완료!`,
      "background: #00ff00; color: black; font-weight: bold; padding: 3px 8px;",
    );

    // ✅ 중요: 모든 작업이 끝난 후 상태를 IDLE로 되돌려 다음 입력을 받을 준비를 합니다.
    this.swipeState = 'IDLE';
    devLog(`✅ [FINALIZE] 완료. 상태: ${this.swipeState}`);
  }

  updateCalendarTitle() {
    const titleElement = document.getElementById("calendarTitle");
    if (!titleElement) return;

    titleElement.textContent = `${this.currentDate.getMonth() + 1}월`;
  }

  async prepareAdjacentSlides(direction) {
    const slides = Array.from(
      this.container.querySelectorAll(".calendar-slide"),
    );
    if (slides.length !== 7) return;

    const dates = [];
    for (let i = -3; i <= 3; i++) {
      const date = new Date(this.currentDate);
      date.setDate(date.getDate() + i * 7);
      dates.push(date);
    }

    // 💡 [개선] 스와이프 후 새로 보이게 될 슬라이드의 데이터만 로드
    let dateToLoad;

    if (direction === 1) {
      // 오른쪽으로 스와이프: 가장 오른쪽에 새로 나타날 주 (+3주)
      dateToLoad = dates[6];
      devLog(
        `   ⚡ 오른쪽(→) 스와이프: +3주차(${dateToLoad.toLocaleDateString("ko-KR")}) 데이터 로드`,
      );
    } else {
      // 왼쪽으로 스와이프: 가장 왼쪽에 새로 나타날 주 (-3주)
      dateToLoad = dates[0];
      devLog(
        `   ⚡ 왼쪽(←) 스와이프: -3주차(${dateToLoad.toLocaleDateString("ko-KR")}) 데이터 로드`,
      );
    }

    await this.loadWeekDataToCache(dateToLoad);

    // 새로 로드된 슬라이드의 내용만 업데이트
    const slideToUpdate = direction === 1 ? slides[6] : slides[0];
    slideToUpdate.innerHTML = this.renderWeekViewContent(dateToLoad);
  }

  async goToToday() {
    devLog("🏠 [오늘로 이동] 전체 캐시 리셋");
    this.weekDataCache.clear(); // 캐시 비우기
    this.currentDate = new Date();
    await this.render(); // 다시 그리기
  }

  async goToPrevMonth() {
    devLog("◀️ [이전 월] 전체 캐시 리셋");
    this.weekDataCache.clear();
    const prevMonth = new Date(this.currentDate);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    prevMonth.setDate(1);
    this.currentDate = prevMonth;
    await this.render();
  }

  async goToNextMonth() {
    devLog("▶️ [다음 월] 전체 캐시 리셋");
    this.weekDataCache.clear();
    const nextMonth = new Date(this.currentDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    this.currentDate = nextMonth;
    await this.render();
  }

  async refreshCurrentView() {
    // 💡 [개선] 진단 로그가 추가된 잠금(Lock) 메커니즘
    // 여러 번의 시도에도 불구하고 경쟁 상태가 지속되어, 문제의 원인을 정확히 파악하기 위해 잠금의 모든 단계를 상세히 기록합니다.
    if (this.renderPromise) {
      devLog(`[LOCK] ⏸️ 'refreshCurrentView' 대기 시작. 현재 잠금 보유자: ${this.renderPromise.owner}`);
      await this.renderPromise;
      devLog(`[LOCK] ✅ 'refreshCurrentView' 대기 완료. 추가 작업 건너뜁니다.`);
      return;
    }

    let releaseLock;
    const myPromise = new Promise(resolve => {
      releaseLock = resolve;
    });
    myPromise.owner = 'refreshCurrentView'; // 디버깅을 위한 잠금 소유자 정보
    this.renderPromise = myPromise;
    devLog(`[LOCK] 🔒 'refreshCurrentView'가 잠금을 획득했습니다.`);

    try {
      // 실제 갱신 작업 수행
      await this._doRefreshCurrentView();
    } finally {
      devLog(`[LOCK] 🔑 'refreshCurrentView'가 잠금 해제를 시작합니다.`);
      releaseLock();
      this.renderPromise = null;
      devLog(`[LOCK] 🔓 'refreshCurrentView'가 잠금을 완전히 해제했습니다.`);
    }
  }

  async _doRefreshCurrentView() {
    devLog("🔄 [갱신] 현재 상태 유지하며 데이터 업데이트");

    if (this.currentView === "week") {
      const slides = Array.from(
        this.container.querySelectorAll(".calendar-slide"),
      );
      if (slides.length === 7) {
        // 7개 슬라이드가 있으면 내용만 갱신 (위치 유지)
        const dates = [];
        for (let i = -3; i <= 3; i++) {
          const date = new Date(this.currentDate);
          date.setDate(date.getDate() + i * 7);
          dates.push(date);
        }

        // 💡 [개선] 7주 데이터를 병렬로 로드하여 속도 향상
        devLog(`   🚀 [갱신] 7주 데이터 동시 로드 시작...`);
        const t1 = Date.now();
        const loadPromises = dates.map((date) => this.loadWeekDataToCache(date));
        await Promise.all(loadPromises);
        devLog(`   ✅ 7주 데이터 로드 완료 (${Date.now() - t1}ms)`);

        this.events = this.getMergedEventsFromCache(dates);
        devLog(`   ✅ 병합된 이벤트: ${this.events.length}개`);

        // 7개 슬라이드 내용만 업데이트 (transform 유지)
        slides.forEach((slide, i) => {
          slide.innerHTML = this.renderWeekViewContent(dates[i]);
        });

        devLog(`🔄 슬라이드 준비 완료: -3주 ~ +3주`);

        requestAnimationFrame(() => {
          this.adjustWeekViewLayout(true);
          this.updateCurrentTimeIndicator();
        });
      } else {
        await this.render();
      }
    } else {
      await this.render();
    }
  }

  /**
   * 💡 [신규] Webhook을 위한 정교한 새로고침 함수
   * 특정 주(week)의 캐시만 무효화하고, 화면의 해당 슬라이드만 "수술적으로" 업데이트합니다.
   * 전체 7주를 리로드하는 비효율적인 refreshCurrentView()를 대체합니다.
   * @param {string[]} weekStartDates - ISO 문자열 형식의 주 시작 날짜 배열
   */
  async invalidateAndRefreshWeeks(weekStartDates) {
    devLog(`🎯 [정교한 갱신] Webhook 신호 수신: ${weekStartDates.length}개 주 업데이트 시작`);

    // 1. 해당 주의 캐시만 무효화
    weekStartDates.forEach((weekStart) => {
      const weekKey = this.getWeekCacheKey(new Date(weekStart));
      this.weekDataCache.delete(weekKey);
      devLog(`   🗑️ [캐시삭제] ${weekKey}`);
    });

    // 2. 변경된 주의 데이터만 병렬로 다시 로드
    const datesToRefresh = weekStartDates.map(ws => new Date(ws));
    const loadPromises = datesToRefresh.map(date => this.loadWeekDataToCache(date));
    await Promise.all(loadPromises);
    devLog(`   ✅ 데이터 재로드 완료`);

    // 3. 현재 화면에 보이는 슬라이드 중, 변경된 슬라이드만 찾아 내용 업데이트
    const allSlides = Array.from(this.container.querySelectorAll(".calendar-slide"));
    if (allSlides.length !== 7) return;

    const currentSlideDates = [];
    for (let i = -3; i <= 3; i++) {
      const date = new Date(this.currentDate);
      date.setDate(date.getDate() + i * 7);
      currentSlideDates.push(date);
    }

    datesToRefresh.forEach(refreshDate => {
      const refreshWeekKey = this.getWeekCacheKey(refreshDate).split('_')[0]; // 날짜 부분만 비교
      
      const slideIndex = currentSlideDates.findIndex(slideDate => {
        const slideWeekKey = this.getWeekCacheKey(slideDate).split('_')[0];
        return slideWeekKey === refreshWeekKey;
      });

      if (slideIndex !== -1) {
        const slideToUpdate = allSlides[slideIndex];
        slideToUpdate.innerHTML = this.renderWeekViewContent(refreshDate);
        devLog(`   🔄 슬라이드 업데이트 완료: ${refreshDate.toLocaleDateString("ko-KR")}`);
      }
    });

    // 4. 레이아웃 재조정
    this.adjustWeekViewLayout(true);
  }
  changeView(view) {
    this.currentView = view;
    this.render();
  }

  async switchToDayView(date) {
    this.currentDate = new Date(date);
    this.currentDate.setHours(0, 0, 0, 0);
    this.currentView = "day";

    // 일간 보기에서 Hammer 제스처 비활성화
    if (this.hammer) {
      this.hammer.set({ enable: false });
      devLog("🔒 [일간 보기] Hammer 제스처 비활성화");
    }

    // 💡 [버그 수정] 중복된 render() 호출을 하나로 통합합니다.
    // 이전 코드에서는 첫 번째 render()가 await되지 않아 의도치 않은 동작을 유발할 수 있었습니다.
    await this.render();
  }

  async switchToWeekView() {
    this.currentView = "week";

    // 주간 보기로 복귀 시 Hammer 제스처 재활성화
    if (this.hammer) {
      this.hammer.set({ enable: true });
      devLog("🔓 [주간 보기] Hammer 제스처 활성화");
    }

    await this.render();
  }

  isToday(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate.getTime() === today.getTime();
  }

  async toggleRoom(roomId) {
    // 방 선택 변경 시 캐시 무효화
    devLog(`🗑️ [캐시클리어] 방 선택 변경: ${roomId}`);
    this.weekDataCache.clear();

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
    devLog(`📍 [toggleRoom] body에 single-room-view 클래스 추가`);

    await this.render();
  }

  async toggleAllRooms() {
    // 방 선택 변경 시 캐시 무효화
    devLog(`🗑️ [캐시클리어] 전체 방 선택`);
    this.weekDataCache.clear();

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
    devLog(`📍 [toggleAllRooms] body에서 single-room-view 클래스 제거`);

    await this.render();
  }

  async loadEvents() {
    const { start, end } = this.getDateRange();
    const roomIds = Array.from(this.selectedRooms);

    if (roomIds.length === 0) {
      this.events = [];
      return;
    }

    const bookings = await window.dataManager.fetchBookings(
      roomIds,
      start.toISOString(),
      end.toISOString(),
    );

    this.events = window.dataManager.convertToEvents(bookings);
  }

  getDateRange() {
    if (this.currentView === "week") {
      return this.getWeekRange(this.currentDate);
    } else if (this.currentView === "day") {
      return this.getDayRange(this.currentDate);
    } else {
      return this.getMonthRange(this.currentDate);
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
    const diff = current.getDate() - day;

    const start = new Date(current);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  getMonthRange(date) {
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

  async render() {
    // 💡 [개선] 진단 로그가 추가된 잠금(Lock) 메커니즘
    if (this.renderPromise) {
      devLog(`[LOCK] ⏸️ 'render' 대기 시작. 현재 잠금 보유자: ${this.renderPromise.owner}`);
      await this.renderPromise;
      devLog(`[LOCK] ✅ 'render' 대기 완료. 추가 작업 건너뜁니다.`);
      return;
    }

    let releaseLock;
    const myPromise = new Promise(resolve => {
      releaseLock = resolve;
    });
    myPromise.owner = 'render'; // 디버깅을 위한 잠금 소유자 정보
    this.renderPromise = myPromise;
    devLog(`[LOCK] 🔒 'render'가 잠금을 획득했습니다.`);

    try {
      // 실제 렌더링 작업 수행
      await this._doRender();
    } finally {
      devLog(`[LOCK] 🔑 'render'가 잠금 해제를 시작합니다.`);
      releaseLock();
      this.renderPromise = null;
      devLog(`[LOCK] 🔓 'render'가 잠금을 완전히 해제했습니다.`);
    }
  }

  async _doRender() {
    // ✅ HTML의 로딩 UI 유지 (중복 방지)
    // this.container.innerHTML = '<div class="loading">로딩 중...</div>';

    document.getElementById("calendarTitle").textContent =
      `${this.currentDate.getMonth() + 1}월`;

    if (this.currentView === "week") {
      await this.renderWeekViewWithSlider();
      // 💡 [개선] setupSwipeGestures()는 더 이상 여기서 호출하지 않습니다.
    } else if (this.currentView === "day") {
      await this.loadEvents();
      this.renderDayView();
    } else {
      await this.loadEvents();
      this.renderMonthView();
    }
  }

  async renderWeekViewWithSlider() {
    this.isInitialLoading = true;
    devLog(`\n🎨 [렌더] 7슬라이드 렌더링 시작 (로딩 표시 중)`);
    devLog(`   현재 캐시 크기: ${this.weekDataCache.size}개`);

    // 1. 렌더링에 필요한 7개 주의 날짜를 모두 계산합니다.
    const dates = [];
    for (let i = -3; i <= 3; i++) {
      const date = new Date(this.currentDate);
      date.setDate(date.getDate() + i * 7);
      dates.push(date);
    }
    
    // 2. 7개 주에 필요한 모든 데이터를 Promise.all을 사용해 병렬로 한 번에 불러옵니다.
    devLog(`   🚀 [STEP 1] 7주 데이터 동시 로드 시작...`);
    const t1 = Date.now();
    const loadPromises = dates.map(date => this.loadWeekDataToCache(date));
    await Promise.all(loadPromises);
    devLog(`   ✅ 7주 데이터 로드 완료 (${Date.now() - t1}ms)`);

    // 3. 모든 데이터가 준비되면, 캐시에서 이벤트를 병합합니다.
    this.events = this.getMergedEventsFromCache(dates);
    devLog(`   ✅ [STEP 2] 이벤트 병합: ${this.events.length}개`);

    // 4. 모든 데이터가 채워진 상태로 7개의 슬라이드 HTML을 생성합니다.
    let html = this.renderTimeColumn();
    html += '<div class="calendar-slider">';
    const translateValues = [-300, -200, -100, 0, 100, 200, 300];
    dates.forEach((date, i) => {
      html += `<div class="calendar-slide" style="transform: translateX(${translateValues[i]}%)">`;
      html += this.renderWeekViewContent(date);
      html += "</div>";
    });
    html += "</div>";

    // 5. 생성된 HTML을 DOM에 한 번에 렌더링합니다.
    this.container.innerHTML = html;
    this.adjustWeekViewLayout();
    requestAnimationFrame(() => {
      this.updateCurrentTimeIndicator();
    });

    // 6. 모든 렌더링이 완료된 후, 스와이프를 허용합니다.
    this.isInitialLoading = false;
    devLog(`   ✅ [STEP 3] 로딩 UI 제거 - 스와이프 활성화됨`);
  }

  getWeekCacheKey(date) {
    const { start } = this.getWeekRange(date);
    return `${start.toISOString()}_${Array.from(this.selectedRooms).sort().join(",")}`;
  }

  async loadWeekDataToCache(date) {
    const cacheKey = this.getWeekCacheKey(date);

    // 1. 이미 캐시에 데이터가 있으면 즉시 반환
    if (this.weekDataCache.has(cacheKey)) {
      const cachedEvents = this.weekDataCache.get(cacheKey);
      devLog(
        `   ✅ [캐시HIT] ${date.toLocaleDateString("ko-KR")} - ${cachedEvents.length}개 이벤트`,
      );
      return;
    }

    // 2. 💡 진행 중인 요청이 있으면, 새로운 요청을 보내지 않고 기존 요청이 끝나기를 기다림
    if (this.weekDataPromises.has(cacheKey)) {
      devLog(`   ⏳ [요청대기] ${date.toLocaleDateString("ko-KR")} - 이미 진행 중인 요청을 기다립니다.`);
      return this.weekDataPromises.get(cacheKey);
    }

    // 3. 💡 새로운 요청을 시작하고, 다른 곳에서 이 요청을 기다릴 수 있도록 Promise를 등록
    const loadPromise = this._fetchAndCacheWeekData(date, cacheKey);
    this.weekDataPromises.set(cacheKey, loadPromise);

    return loadPromise;
  }

  /**
   * 💡 [신규] 실제 네트워크 요청 및 캐시 저장을 담당하는 내부 함수
   * loadWeekDataToCache의 경쟁 상태를 해결하기 위해 분리되었습니다.
   */
  async _fetchAndCacheWeekData(date, cacheKey) {
    try {
      devLog(
        `   🔍 [캐시MISS] ${date.toLocaleDateString("ko-KR")} - Google Calendar 조회 시작`,
      );

      const { start, end } = this.getWeekRange(date);
      const roomIds = Array.from(this.selectedRooms);

      if (roomIds.length > 0) {
          // ✅ Google Calendar API 직접 호출
          const params = new URLSearchParams({
            roomIds: roomIds.join(","),
            startDate: start.toISOString(),
            endDate: end.toISOString(),
          });

          const isLocal = window.location.hostname === 'localhost';
          const productionUrl = 'https://xn--xy1b23ggrmm5bfb82ees967e.com/.netlify/functions/get-week-events';
          
          const apiUrl = isLocal
            ? `${productionUrl}?${params}`
            : `/.netlify/functions/get-week-events?${params}`;

          const response = await fetch(apiUrl);

          if (!response.ok) {
            throw new Error(`API 응답 오류: ${response.status}`);
          }

          const data = await response.json();
          const events = [];
          if (data.events) {
            for (const [roomId, roomEvents] of Object.entries(data.events)) {
              for (const event of roomEvents) {
                events.push({
                  id: `${roomId}_${event.id}`,
                  title: event.title,
                  start: new Date(event.start),
                  end: new Date(event.end),
                  roomId: roomId,
                  description: event.description,
                  googleEventId: event.id,
                });
              }
            }
          }
          this.weekDataCache.set(cacheKey, events);
          devLog(`   💾 [캐시저장] ${date.toLocaleDateString("ko-KR")} - ${events.length}개 이벤트 저장 (Google Calendar)`);
      } else {
        this.weekDataCache.set(cacheKey, []);
      }
    } catch (error) {
      devLog(`   ❌ Google Calendar 조회 실패: ${error.message}`);
      this.weekDataCache.set(cacheKey, []);
    } finally {
      // 요청이 성공하든 실패하든, 추적하던 Promise를 반드시 제거
      this.weekDataPromises.delete(cacheKey);
    }
  }

  getMergedEventsFromCache(dates) {
    const allEvents = [];
    const seenIds = new Set();

    dates.forEach((date) => {
      const cacheKey = this.getWeekCacheKey(date);
      const weekEvents = this.weekDataCache.get(cacheKey) || [];

      weekEvents.forEach((event) => {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      });
    });

    return allEvents;
  }

  renderWeekView() {
    return this.renderWeekViewContent(this.currentDate);
  }

  renderWeekViewContent(date, daysOverride = null) {
    // 일간 보기에서는 daysOverride로 날짜 1개만 전달 가능
    const days =
      daysOverride ||
      (() => {
        const { start } = this.getWeekRange(date);
        const weekDays = [];
        for (let i = 0; i < 7; i++) {
          const day = new Date(start);
          day.setDate(start.getDate() + i);
          day.setHours(0, 0, 0, 0);
          weekDays.push(day);
        }
        return weekDays;
      })();

    const { start, end } = daysOverride
      ? { start: new Date(days[0]), end: new Date(days[days.length - 1]) }
      : this.getWeekRange(date);

    if (!daysOverride) {
      // 주간 보기는 기존대로
    } else {
      // 일간 보기는 해당 날짜의 시작/끝
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    }

    // 캐시에서 이벤트 가져오기
    const cacheKey = this.getWeekCacheKey(date);
    const cachedEvents = this.weekDataCache.get(cacheKey) || [];

    // 해당 주의 이벤트 필터링
    const weekEvents = cachedEvents.filter((event) => {
      return event.start < end && event.end > start;
    });

    // 일간 보기일 때 클래스 추가
    const dayViewClass =
      daysOverride && days.length === 1 ? " day-view-mode" : "";
    // 단일 방 선택 시 클래스 추가 (일간 보기가 아닐 때만)
    const singleRoomClass =
      this.selectedRooms.size === 1 && !dayViewClass ? " single-room-mode" : "";
    let html = `<div class="week-view${dayViewClass}${singleRoomClass}">`;

    // Header (시간 열 제외, 7개 요일만)
    html += '<div class="week-header">';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    devLog("📅 [헤더생성] 오늘:", today.toLocaleDateString("ko-KR"));

    days.forEach((day) => {
      const isToday = day.getTime() === today.getTime();
      const isSunday = day.getDay() === 0;
      devLog(
        `  ${day.toLocaleDateString("ko-KR")}: ${isToday ? "✅ 오늘" : "일반"} (${day.getTime()} vs ${today.getTime()})`,
      );
      html += `<div class="day-header ${isSunday ? "sunday" : ""} ${isToday ? "today" : ""}">
        <span class="day-name">${CONFIG.dayNames[day.getDay()]}</span>
        <span class="day-date">${day.getDate()}</span>
      </div>`;
    });
    html += "</div>";

    // Time grid (시간 열 제외, 7개 요일만)
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

    // ✅ 라벨 행 추가 (24시 아래)
    html += '<div class="time-row room-label-row">';
    days.forEach((day) => {
      const isToday = day.getTime() === today.getTime();
      // 오늘 날짜이고 모든 방 표시(ALL)일 때만 A B C D E 라벨 표시
      if (isToday && this.selectedRooms.size !== 1) {
        html += `<div class="time-cell weekday-evening room-labels-cell">${this.renderRoomLabelsInCell()}</div>`;
      } else {
        // 나머지는 회색 바
        html += `<div class="time-cell weekday-evening"></div>`;
      }
    });
    html += "</div>";

    // Event layer - one container per day
    days.forEach((day, dayIndex) => {
      const dayEvents = this.getEventsForDay(day, cachedEvents);


      // 주간 보기일 때만 날짜 사이 간격 조정 (일간 보기는 daysOverride 존재)
      let dayWidth, dayLeft;
      const isWeekView = !daysOverride && days.length === 7;

      if (isWeekView) {
        // 주간 보기: 날짜 사이 1px 간격
        // width: 각 날짜에서 1px 빼기
        // left: 일요일=1px, 월요일=14.28%+2px, 화요일=28.57%+3px, ...
        dayWidth = `calc((100% / 7) - 1px)`;
        dayLeft = `calc((100% / 7 * ${dayIndex}) + ${dayIndex + 1}px)`;
      } else {
        // 일간 보기: 기존대로
        dayWidth = `100%`;
        dayLeft = `0%`;
      }

      const isToday = day.getTime() === today.getTime();

      html += `<div class="day-events-container" style="left: ${dayLeft}; width: ${dayWidth};">`;

      // 오늘 날짜이고 주간 보기일 때만 방 구분선 표시
      if (isToday && isWeekView) {
        html += this.renderRoomDividers();
      }

      // Render events with fixed room positions
      const isDayView = daysOverride && days.length === 1;
      dayEvents.forEach((event) => {
        html += this.renderWeekEvent(event, isDayView);
      });

      html += "</div>";
    });

    html += "</div>";

    return html;
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

    // 첫 번째 week-view에서 높이 계산
    const firstWeekView = this.container.querySelector(".week-view");
    if (!firstWeekView) return;

    const headerElement = firstWeekView.querySelector(".day-header");
    if (!headerElement) return;

    const headerHeight = headerElement.getBoundingClientRect().height;
    const weekViewHeight = firstWeekView.clientHeight;
    const availableHeight = weekViewHeight - headerHeight;

    // 시간 위치 계산 (0시 = 0%, 24시 = 100%)
    const hourProgress = currentHour + currentMinute / 60;
    const topPosition = headerHeight + availableHeight * (hourProgress / 24);

    // 1. 시간 컬럼 위 삼각형만
    const triangle = document.createElement("div");
    triangle.className = "current-time-triangle";
    triangle.style.top = `${topPosition}px`;
    this.container.appendChild(triangle);

    // 2. 오늘 날짜 열 찾기 - 중간 슬라이드(현재 주)에서 찾기
    const allSlides = this.container.querySelectorAll(".calendar-slide");
    const currentSlide = allSlides[3]; // 중간 슬라이드 = 현재 주 (7개 중 인덱스 3)

    if (!currentSlide) {
      devLog("❌ [오늘라인] 중간 슬라이드 없음");
      return;
    }

    const currentWeekView = currentSlide.querySelector(".week-view");
    if (!currentWeekView) {
      devLog("❌ [오늘라인] week-view 없음");
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
        devLog(
          `📅 [날짜 변경 감지] ${this.lastRenderedDayKey} → ${currentDayKey}, 자동 렌더링`,
        );
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

  renderDayView() {
    const date = new Date(this.currentDate);
    date.setHours(0, 0, 0, 0);

    // 헤더에 주간 보기 돌아가기 버튼 추가
    this.addBackToWeekButton();

    // 주간 보기와 완전히 동일한 구조
    // 1. 왼쪽 고정 시간열
    let html = this.renderTimeColumn();

    // 2. 슬라이더 (주간과 동일하지만 슬라이드 1개만)
    html += '<div class="calendar-slider">';
    html += '<div class="calendar-slide" style="transform: translateX(0%)">';

    // 3. renderWeekViewContent를 날짜 1개a�� 호출
    html += this.renderWeekViewContent(date, [date]);

    html += "</div>";
    html += "</div>";

    this.container.innerHTML = html;

    // 레이아웃 조정
    requestAnimationFrame(() => {
      this.adjustWeekViewLayout(true);
      this.updateCurrentTimeIndicator();
      // 일간 보기 이벤트 클릭 핸들러 설정
      this.setupDayViewEventHandlers();
    });
  }

  addBackToWeekButton() {
    const footer = document.querySelector(".bottom-controls");
    if (!footer) return;

    // 기존 돌아가기 버튼 제거
    const existingBtn = footer.querySelector(".back-to-week-btn");
    if (existingBtn) existingBtn.remove();

    // 돌아가기 버튼 생성
    const backBtn = document.createElement("button");
    backBtn.className = "back-to-week-btn";
    backBtn.innerHTML = "← 주간보기";
    backBtn.title = "주간 보기로 돌아가기";

    // 터치 시작 시 Hammer로 전파 차단 (클릭 보호)
    backBtn.addEventListener(
      "touchstart",
      (e) => {
        e.stopPropagation();
        devLog("🛡️ [버튼 보호] 터치 이벤트 전파 차단");
      },
      { passive: false },
    );

    backBtn.addEventListener("click", async () => { // 💡 async 추가
      // 💡 [버그 수정] 정의되지 않은 함수(resetSwipeState) 호출을 수정하고, 비동기 렌더링을 기다립니다.
      this.swipeState = 'IDLE';
      devLog(`🔄 [상태리셋] 주간 보기로 복귀하며 스와이프 상태를 IDLE로 강제 설정합니다.`);
      this.currentView = "week";
      await this.render(); // 💡 await 추가
      // 돌아가기 버튼 제거
      backBtn.remove();
    });

    // 예약 정보 버튼 앞에 삽입
    const infoBtn = footer.querySelector(".info-btn");
    if (infoBtn) {
      footer.insertBefore(backBtn, infoBtn);
    } else {
      footer.appendChild(backBtn);
    }
  }

  setupDayViewEventHandlers() {
    const weekView = this.container.querySelector(".week-view");
    if (!weekView || !weekView.classList.contains("day-view-mode")) {
      return; // 일간 보기가 아니면 종료
    }

    const events = weekView.querySelectorAll(".week-event");

    // 이벤트 클릭 핸들러
    events.forEach((event) => {
      event.addEventListener("click", (e) => {
        e.stopPropagation();

        // 이미 확대된 이벤트를 다시 클릭하면 축소
        if (event.classList.contains("expanded")) {
          event.classList.remove("expanded");
        } else {
          // 다른 모든 이벤트 축소
          events.forEach((e) => e.classList.remove("expanded"));
          // 현재 이벤트 확대
          event.classList.add("expanded");
        }
      });
    });

    // 다른 곳 클릭 시 모든 이벤트 축소
    weekView.addEventListener("click", (e) => {
      if (!e.target.closest(".week-event")) {
        events.forEach((event) => event.classList.remove("expanded"));
      }
    });
  }

  renderMonthView() {
    const { start, end } = this.getDateRange();
    const days = [];
    const current = new Date(start);

    while (current <= end) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    let html = '<div class="month-view">';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = this.currentDate.getMonth();

    days.forEach((day) => {
      const isToday = day.getTime() === today.getTime();
      const isSunday = day.getDay() === 0;
      const isOtherMonth = day.getMonth() !== thisMonth;

      const dayEvents = this.getEventsForDay(day);

      html += `<div class="month-day ${isSunday ? "sunday" : ""} ${isToday ? "today" : ""} ${isOtherMonth ? "other-month" : ""}">`;
      html += `<div class="month-day-number">${day.getDate()}</div>`;

      dayEvents.slice(0, 3).forEach((event) => {
        html += this.renderMonthEvent(event);
      });

      if (dayEvents.length > 3) {
        html += `<div class="month-event-more">+${dayEvents.length - 3}</div>`;
      }

      html += "</div>";
    });

    html += "</div>";
    this.container.innerHTML = html;
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

    // 여러 날에 걸친 이벤트를 하루 단위로 분할
    const dayEvents = [];

    eventsSource.forEach((event) => {
      // 이벤트가 이 날짜와 겹치는지 확인
      if (event.start < dayEnd && event.end > dayStart) {
        // 이 날짜에 해당하는 부분만 추출
        const segmentStart = event.start < dayStart ? dayStart : event.start;
        const segmentEnd = event.end > dayEnd ? dayEnd : event.end;

        // 자정넘어가는 이벤트 로그
        if (event.start < dayStart || event.end > dayEnd) {
          devLog(
            `   📅 [자정분할] ${event.roomId.toUpperCase()}: ${event.start.toLocaleString("ko-KR")} ~ ${event.end.toLocaleString("ko-KR")} → ${segmentStart.toLocaleString("ko-KR")} ~ ${segmentEnd.toLocaleString("ko-KR")}`,
          );
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

    devLog(
      `📍 [라벨 위치 업데이트] left: ${todayLeft}px, width: ${dayWidth}px, 요일: ${todayDayIndex}`,
    );
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
    // displayStart/displayEnd가 있으면 사용 (하루 단위로 분할된 경우)
    const displayStart = event.displayStart || event.start;
    const displayEnd = event.displayEnd || event.end;

    const startHour = displayStart.getHours();
    const startMin = displayStart.getMinutes();
    const endHour = displayEnd.getHours();
    const endMin = displayEnd.getMinutes();

    // Calculate position as percentage of 24-hour day
    const startPercent = ((startHour * 60 + startMin) / (24 * 60)) * 100;
    const endPercent = ((endHour * 60 + endMin) / (24 * 60)) * 100;
    const height = endPercent - startPercent;

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
    const timeStr = `${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")}-${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;

    // 일간 보기: 방 이름 + 전체 타이틀 + 시간 표시
    // 단독 방 선택: 타이틀+시간
    // ALL 선택: 첫글자+시간
    let eventContent;
    if (isDayView) {
      // 일간 보기: 타이틀에서 방 이름, (, 숫자 제거
      // 예: "A홀 (2 이****님" → "이****님"
      let cleanTitle = event.title.replace(/^[A-E]홀\s*/, ""); // A홀 제거
      cleanTitle = cleanTitle.replace(/\(/g, ""); // ( 제거
      cleanTitle = cleanTitle.replace(/\d+/g, ""); // 숫자 제거
      cleanTitle = cleanTitle.trim(); // 공백 정리
      eventContent = `<div class="event-room">${roomName}</div>
                      <div class="event-title">${cleanTitle}</div>
                      <div class="event-time">${timeStr}</div>`;
    } else if (this.selectedRooms.size === 1) {
      eventContent = `<div class="event-title">${event.title}</div>
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
      const timeDisplay = `${timeStartHour}:${timeStartMin.toString().padStart(2, "0")}-${timeEndHour}:${timeEndMin.toString().padStart(2, "0")}`;

      let displayText = "";

      // 패턴 1: X****님 형식에서 세로로 나열 (예: 박 / ○ / 님)
      const nameMatch = event.title.match(/([^\s()\d])\*+님/);
      if (nameMatch) {
        const firstChar = nameMatch[1];
        displayText = `<div class="event-time-short">${timeDisplay}</div><div class="name-char">${firstChar}</div><div class="name-circle">*</div><div class="name-suffix">님</div>`;
      } else {
        // 패턴 2: 알파벳만 추출 (sc, ka 등) → sc / ○ / 님
        const alphaMatch = event.title.match(/[a-zA-Z]+/);
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

    return `<div class="week-event room-${event.roomId}" 
                 style="top: ${startPercent}%; height: ${height}%; width: ${position.width}%; left: ${position.left}%;"
                 data-event-date="${eventDate.toISOString()}"
                 title="${roomName}: ${event.title} (${timeStr})">
              ${eventContent}
            </div>`;
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
        (e) => event.start < e.end && event.end > e.start,
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

  renderMonthEvent(event) {
    return `<div class="month-event room-${event.roomId}" 
                 style="border-left-color: ${CONFIG.rooms[event.roomId].color}"
                 title="${event.title}">
              ${event.title}
            </div>`;
  }

  async refresh() {
    // 기존 함수는 refreshCurrentView로 대체됨
    devLog("🔄 [deprecated] refresh() 호출 → refreshCurrentView() 사용");
    await this.refreshCurrentView();
  }
}
