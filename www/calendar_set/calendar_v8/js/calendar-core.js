class Calendar {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentDate = new Date();
    this.currentView = "week";
    this.selectedRooms = new Set(["a", "b", "c", "d", "e"]);
    this.events = [];
    this.hammer = null;
    this.isAnimating = false;
    this.isPanning = false; // 스와이프 상태 플래그
    this.hasPendingGestureNavigation = false; // 제스처 네비게이션 중복 방지
    this.isInitialLoading = true; // 🆕 초기 3주 로드 중 스와이프 차단
    this.currentSlideIndex = 3; // 0-6 중 중앙 (7개 슬라이드)
    this.weekDataCache = new Map(); // 주간 데이터 캐시
    this.baseTranslate = -14.2857; // 현재 slider의 기본 위치 (% = 100/7)
    this.timeUpdateInterval = null; // 현재 시간 업데이트 타이머
    this.renderPromise = null; // render 동시 실행 방지 배리어
    this.lastSwipeTime = 0; // 마지막 스와이프 시간 (클릭 vs 스와이프 구분)

    // 네이티브 터치 이벤트 리스너 참조 저장 (제거용)
    this.currentSlider = null;
    this.touchStartHandler = null;
    this.touchMoveHandler = null;
    this.touchEndHandler = null;
    this.touchCancelHandler = null;
    this.setupSwipeGesturesCallCount = 0; // 호출 횟수 추적
  }

  async init() {
    if (window.logger) logger.info('Calendar init starting');
    devLog('🚀 [CALENDAR_INIT] 시작');
    
    try {
      const dmStart = Date.now();
      await window.dataManager.init();
      const dmTime = Date.now() - dmStart;
      if (window.logger) logger.info('DataManager initialized', { time: dmTime });
      devLog(`✅ [DataManager] 초기화 완료 (${dmTime}ms)`);
    } catch (error) {
      if (window.logger) logger.error('DataManager init failed', { message: error.message });
      devLog(`❌ [DataManager] 초기화 실패: ${error.message}`);
    }

    if (window.logger) logger.info('Setting up calendar listeners and observers');
    devLog('🔧 [SETUP] 이벤트 리스너 및 옵저버 설정 중');
    
    this.setupEventListeners();
    this.setupResizeObserver();
    
    if (window.logger) logger.info('Rendering calendar');
    devLog('🎨 [RENDER] 달력 렌더링 시작');
    const renderStart = Date.now();
    await this.render();
    const renderTime = Date.now() - renderStart;
    if (window.logger) logger.info('Calendar rendered', { time: renderTime, cacheSize: this.weekDataCache.size });
    devLog(`✅ [RENDER] 달력 렌더링 완료 (${renderTime}ms, 캐시: ${this.weekDataCache.size}개)`);
    
    if (window.logger) logger.info('Setting up swipe gestures');
    devLog('👆 [SWIPE] 스와이프 제스처 설정 중');
    this.setupSwipeGestures();
    if (window.logger) logger.info('Swipe gestures ready');
    
    if (window.logger) logger.info('Starting current time updater');
    this.startCurrentTimeUpdater();
    if (window.logger) logger.info('Calendar initialized successfully');
    devLog('✅ [CALENDAR_INIT] 완료');
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
      this.goToPrevMonth();
    });
    document.getElementById("nextMonthBtn").addEventListener("click", () => {
      this.goToNextMonth();
    });

    // 푸터 네비게이션
    document.getElementById("prevWeekBtn").addEventListener("click", () => {
      this.resetSwipeState();
      this.navigate(-1);
    });
    document.getElementById("nextWeekBtn").addEventListener("click", () => {
      this.resetSwipeState();
      this.navigate(1);
    });
    document.getElementById("todayBtn").addEventListener("click", () => {
      this.resetSwipeState();
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

  resetSwipeState() {
    this.isPanning = false;
    this.isAnimating = false;
    this.hasPendingGestureNavigation = false;

    const slides = this.container.querySelectorAll(".calendar-slide");
    if (slides.length === 7) {
      slides.forEach((slide, i) => {
        slide.style.transition =
          "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)";
        slide.style.transform = `translateX(${[-300, -200, -100, 0, 100, 200, 300][i]}%)`;
      });
    }

    // room-bottom-labels-outside도 원위치
    const roomLabels = document.querySelector(".room-bottom-labels-outside");
    if (roomLabels) {
      roomLabels.style.transition =
        "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)";
      roomLabels.style.transform = "translateX(0px)";
    }
  }

  setupSwipeGestures() {
    this.setupSwipeGesturesCallCount++;

    console.log(
      `%c🔧 [SETUP] setupSwipeGestures 호출 #${this.setupSwipeGesturesCallCount}`,
      "background: #ff00ff; color: white; font-weight: bold; padding: 3px 8px; font-size: 13px;",
      {
        시각: new Date().toLocaleTimeString("ko-KR", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          fractionalSecondDigits: 3,
        }),
        "이전 slider 존재": !!this.currentSlider,
        "이전 Hammer 존재": !!this.hammer,
      },
    );

    devLog("🔍 Hammer.js 확인:", typeof Hammer);

    if (typeof Hammer === "undefined") {
      console.error("❌ Hammer.js가 로드되지 않았습니다!");
      return;
    }

    // ========================================
    // 기존 네이티브 터치 리스너 제거
    // ========================================
    if (this.currentSlider && this.touchStartHandler) {
      console.log(
        `%c🧹 [CLEANUP] 기존 네이티브 터치 리스너 제거`,
        "color: #ff9900; font-weight: bold;",
        { slider: this.currentSlider },
      );

      this.currentSlider.removeEventListener(
        "touchstart",
        this.touchStartHandler,
      );
      this.currentSlider.removeEventListener(
        "touchmove",
        this.touchMoveHandler,
      );
      this.currentSlider.removeEventListener("touchend", this.touchEndHandler);
      this.currentSlider.removeEventListener(
        "touchcancel",
        this.touchCancelHandler,
      );

      this.touchStartHandler = null;
      this.touchMoveHandler = null;
      this.touchEndHandler = null;
      this.touchCancelHandler = null;
    }

    // 기존 Hammer 인스턴스 제거
    if (this.hammer) {
      console.log(
        `%c🧹 [CLEANUP] 기존 Hammer 인스턴스 제거`,
        "color: #ff9900; font-weight: bold;",
      );
      this.hammer.destroy();
      this.hammer = null;
    }

    const slider = this.container.querySelector(".calendar-slider");
    if (!slider) {
      console.error("❌ .calendar-slider 요소를 찾을 수 없습니다!");
      return;
    }

    // 현재 slider 참조 저장
    this.currentSlider = slider;

    console.log(
      `%c✅ [SETUP] 새 slider 요소 발견`,
      "background: #00ff00; color: black; padding: 2px 5px;",
      { slider: slider },
    );

    // ========================================
    // 네이티브 터치 이벤트 리스너 추가 (디버깅용)
    // ========================================
    let nativeTouchStartTime = 0;
    let nativeTouchCount = 0;
    let lastTouchId = 0;
    let orphanedTouchTimer = null;

    // 리스너 함수 정의 및 저장
    this.touchStartHandler = (e) => {
      nativeTouchStartTime = Date.now();
      nativeTouchCount++;
      lastTouchId = nativeTouchCount;
      const touch = e.touches[0];

      console.log(
        `%c🟢 [NATIVE TOUCH] touchstart #${nativeTouchCount} (setup호출 #${this.setupSwipeGesturesCallCount})`,
        "color: #00ff00; font-weight: bold; font-size: 12px;",
        {
          시각: new Date().toLocaleTimeString("ko-KR", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
          }),
          터치개수: e.touches.length,
          X좌표: touch ? Math.round(touch.clientX) : "N/A",
          Y좌표: touch ? Math.round(touch.clientY) : "N/A",
          타겟: e.target.className,
          sliderID: slider === this.currentSlider ? "현재" : "이전",
          "🚨isAnimating": this.isAnimating,
          "🚨isPanning": this.isPanning,
        },
      );

      // 유령 터치 감지: 200ms 내에 touchmove나 touchend가 안 오면 경고
      if (orphanedTouchTimer) clearTimeout(orphanedTouchTimer);
      const currentTouchId = lastTouchId;
      orphanedTouchTimer = setTimeout(() => {
        console.log(
          `%c👻 [유령 터치] touchstart #${currentTouchId} 후 200ms 동안 아무 이벤트 없음!`,
          "background: #ff0000; color: white; font-weight: bold; padding: 3px 8px; font-size: 13px;",
          {
            경과시간: "200ms+",
            예상원인:
              "터치했지만 움직이지 않았거나, 브라우저가 이벤트를 무시함",
            "🚨isAnimating": this.isAnimating,
            "🚨isPanning": this.isPanning,
          },
        );
      }, 200);
    };

    this.touchMoveHandler = (e) => {
      // 유령 터치 타이머 취소 (정상 터치)
      if (orphanedTouchTimer) {
        clearTimeout(orphanedTouchTimer);
        orphanedTouchTimer = null;
      }

      const touch = e.touches[0];
      const elapsed = Date.now() - nativeTouchStartTime;
      console.log(
        `%c🔵 [NATIVE TOUCH] touchmove`,
        "color: #0088ff; font-size: 11px;",
        {
          경과시간: `${elapsed}ms`,
          터치개수: e.touches.length,
          X좌표: touch ? Math.round(touch.clientX) : "N/A",
          Y좌표: touch ? Math.round(touch.clientY) : "N/A",
        },
      );
    };

    this.touchEndHandler = (e) => {
      // 유령 터치 타이머 취소 (정상 터치)
      if (orphanedTouchTimer) {
        clearTimeout(orphanedTouchTimer);
        orphanedTouchTimer = null;
      }

      const duration = Date.now() - nativeTouchStartTime;
      const wasShortTouch = duration < 100;
      console.log(
        wasShortTouch
          ? `%c🔴 [NATIVE TOUCH] touchend (짧은터치 ${duration}ms)`
          : `%c🔴 [NATIVE TOUCH] touchend`,
        wasShortTouch
          ? "color: #ff0000; font-weight: bold; font-size: 12px; background: yellow;"
          : "color: #ff0000; font-weight: bold; font-size: 12px;",
        {
          총소요시간: `${duration}ms`,
          남은터치: e.touches.length,
          "🚨isAnimating": this.isAnimating,
          "🚨isPanning": this.isPanning,
        },
      );
    };

    this.touchCancelHandler = (e) => {
      // 유령 터치 타이머 취소
      if (orphanedTouchTimer) {
        clearTimeout(orphanedTouchTimer);
        orphanedTouchTimer = null;
      }

      console.log(
        `%c⚠️ [NATIVE TOUCH] touchcancel`,
        "color: #ff9900; font-weight: bold; font-size: 12px;",
        {
          이유: "시스템이 터치를 취소함",
          남은터치: e.touches.length,
        },
      );
    };

    // 리스너 등록
    slider.addEventListener("touchstart", this.touchStartHandler, {
      passive: true,
    });
    slider.addEventListener("touchmove", this.touchMoveHandler, {
      passive: true,
    });
    slider.addEventListener("touchend", this.touchEndHandler, {
      passive: true,
    });
    slider.addEventListener("touchcancel", this.touchCancelHandler, {
      passive: true,
    });

    console.log(
      `%c✅ [SETUP] 네이티브 터치 리스너 등록 완료`,
      "background: #00ff00; color: black; padding: 2px 5px;",
    );

    // ========================================
    // Hammer.js 설정
    // ========================================
    this.hammer = new Hammer(slider, {
      touchAction: "auto",
      inputClass: Hammer.TouchMouseInput,
    });
    this.hammer.get("pan").set({
      direction: Hammer.DIRECTION_HORIZONTAL,
      threshold: 5, // 모든 터치에 반응
      enable: true,
    });

    console.log(
      `%c✅ [SETUP] Hammer 생성 완료 (threshold: 5px - 초민감)`,
      "background: #00ff00; color: black; padding: 2px 5px;",
    );
    devLog("✅ Hammer 새로 생성 (touchAction: auto):", slider);

    let swipeStartTime = 0;
    let slideStarts = [-300, -200, -100, 0, 100, 200, 300];
    let hammerEventCount = 0;

    // ========================================
    // Hammer 이벤트: panstart
    // ========================================
    this.hammer.on("panstart", (e) => {
      hammerEventCount++;
      console.log(
        `%c🟩 [HAMMER] panstart #${hammerEventCount}`,
        "background: #00ff00; color: black; font-weight: bold; padding: 2px 5px;",
        {
          시각: new Date().toLocaleTimeString("ko-KR", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
          }),
          deltaX: e.deltaX.toFixed(1),
          deltaY: e.deltaY.toFixed(1),
          center: `(${Math.round(e.center.x)}, ${Math.round(e.center.y)})`,
          isAnimating: this.isAnimating,
          isPanning: this.isPanning,
          이벤트타입: e.type,
          포인터타입: e.pointerType,
        },
      );

      if (this.isAnimating) {
        console.log(
          `%c⏸️ [HAMMER] panstart 무시 (애니메이션 중)`,
          "color: #ff9900; font-weight: bold;",
        );
        return;
      }

      // 🆕 초기 로딩 중 스와이프 차단
      if (this.isInitialLoading) {
        console.log(
          `%c🚫 [HAMMER] panstart 무시 (초기 3주 로드 중)`,
          "background: #ff0000; color: white; font-weight: bold;",
        );
        devLog(`🚫 초기 로드 중: 스와이프 차단됨`);
        return;
      }

      this.hasPendingGestureNavigation = false;

      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
        console.log(
          `%c⬆️ [HAMMER] 세로 스크롤 감지 - panstart 무시`,
          "color: #0088ff;",
          {
            deltaX: e.deltaX.toFixed(1),
            deltaY: e.deltaY.toFixed(1),
          },
        );
        return;
      }

      const slides = this.container.querySelectorAll(".calendar-slide");
      if (slides.length === 7) {
        slides.forEach((slide, i) => {
          slide.style.transition = "none";
        });
        slideStarts = [-300, -200, -100, 0, 100, 200, 300];
        swipeStartTime = Date.now();
        this.isPanning = true;

        console.log(
          `%c✅ [HAMMER] 스와이프 시작 승인`,
          "background: #00ff00; color: black; font-weight: bold; padding: 2px 5px;",
          {
            isPanning: this.isPanning,
            slideCount: slides.length,
          },
        );
      }
    });

    // ========================================
    // Hammer 이벤트: panmove
    // ========================================
    let panmoveCount = 0;
    this.hammer.on("panmove", (e) => {
      panmoveCount++;

      if (panmoveCount % 5 === 1) {
        console.log(
          `%c🔷 [HAMMER] panmove #${panmoveCount}`,
          "color: #0088ff; font-size: 10px;",
          {
            deltaX: e.deltaX.toFixed(1),
            deltaY: e.deltaY.toFixed(1),
            velocityX: e.velocityX.toFixed(3),
            velocityY: e.velocityY.toFixed(3),
            isAnimating: this.isAnimating,
            isPanning: this.isPanning,
          },
        );
      }

      if (this.isAnimating || !this.isPanning) {
        if (panmoveCount % 10 === 1) {
          console.log(`%c⏸️ [HAMMER] panmove 무시`, "color: #888;", {
            isAnimating: this.isAnimating,
            isPanning: this.isPanning,
          });
        }
        return;
      }

      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

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
        // 라벨은 슬라이드의 자식 요소이므로 자동으로 따라갑니다
      }
    });

    // ========================================
    // Hammer 이벤트: panend
    // ========================================
    this.hammer.on("panend", (e) => {
      console.log(
        `%c🟥 [HAMMER] panend`,
        "background: #ff0000; color: white; font-weight: bold; padding: 2px 5px;",
        {
          시각: new Date().toLocaleTimeString("ko-KR", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
          }),
          deltaX: e.deltaX.toFixed(1),
          deltaY: e.deltaY.toFixed(1),
          velocityX: e.velocityX.toFixed(3),
          velocityY: e.velocityY.toFixed(3),
          distance: Math.abs(e.deltaX).toFixed(1),
          isAnimating: this.isAnimating,
          isPanning: this.isPanning,
          hasPendingNav: this.hasPendingGestureNavigation,
          panmove호출수: panmoveCount,
        },
      );

      panmoveCount = 0;

      if (this.isAnimating || !this.isPanning) {
        console.log(
          `%c⏸️ [HAMMER] panend 무시 (상태 플래그)`,
          "color: #ff9900;",
          { isAnimating: this.isAnimating, isPanning: this.isPanning },
        );
        return;
      }

      if (this.hasPendingGestureNavigation) {
        console.log(`%c⏸️ [HAMMER] panend 무시 (중복 방지)`, "color: #ff9900;");
        return;
      }

      this.isPanning = false;

      const slides = this.container.querySelectorAll(".calendar-slide");
      if (slides.length === 7) {
        const swipeEndTime = Date.now();
        const duration = swipeEndTime - swipeStartTime;
        const distance = Math.abs(e.deltaX);
        const velocity = Math.abs(e.velocityX);
        const avgSpeed = duration > 0 ? (distance / duration).toFixed(2) : 0;

        console.log(
          `%c📊 [HAMMER] 스와이프 분석`,
          "background: #ffff00; color: black; font-weight: bold; padding: 3px 8px;",
          {
            "이동거리(px)": distance.toFixed(0),
            "소요시간(ms)": duration,
            "Hammer속도(px/ms)": velocity.toFixed(3),
            "평균속도(px/ms)": avgSpeed,
            방향: e.deltaX < 0 ? "왼쪽←" : "오른쪽→",
            가로여부: Math.abs(e.deltaX) > Math.abs(e.deltaY),
          },
        );

        const isHorizontalSwipe = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        if (!isHorizontalSwipe) {
          console.log(
            `%c❌ [HAMMER] 세로 스와이프로 판단 - 원위치`,
            "color: #ff0000; font-weight: bold;",
          );
          slides.forEach((slide, i) => {
            slide.style.transition =
              "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)";
            slide.style.transform = `translateX(${[-300, -200, -100, 0, 100, 200, 300][i]}%)`;
          });
          // 라벨은 슬라이드의 자식 요소이므로 자동으로 따라갑니다
          return;
        }

        const animationDuration = velocity > 1.5 ? 0.05 : 0.1;
        slides.forEach((slide) => {
          slide.style.transition = `transform ${animationDuration}s cubic-bezier(0.22, 1, 0.36, 1)`;
        });
        // 라벨은 슬라이드의 자식 요소이므로 자동으로 따라갑니다

        const sliderElement = this.container.querySelector(".calendar-slider");
        const sliderWidth = sliderElement
          ? sliderElement.offsetWidth
          : this.container.offsetWidth;
        const distanceThreshold = sliderWidth * 0.25; // 느린 드래그: 50% 이상
        const velocityThreshold = 0.5;

        // 플링 vs 드래그 구분
        const fastSwipeTimeLimit = 200; // 200ms 미만이면 빠른 스와이프(플링)
        const isFastSwipe = duration < fastSwipeTimeLimit;

        let shouldNavigate;
        if (isFastSwipe) {
          // 빠른 스와이프(플링): 아주 조금만 움직여도 넘어감
          const minFlickDistance = 3; // 최소 5px
          shouldNavigate = distance >= minFlickDistance;

          console.log(
            `%c⚡ [빠른 플링] ${duration}ms < ${fastSwipeTimeLimit}ms`,
            "background: #ffff00; color: black; font-weight: bold; padding: 3px 8px;",
            {
              판정: shouldNavigate ? "✅ 넘어감" : "❌ 안넘어감",
              이동거리: `${distance.toFixed(0)}px`,
              최소거리: `${minFlickDistance}px (초민감)`,
              조건: `${distance.toFixed(0)} >= ${minFlickDistance} = ${shouldNavigate}`,
            },
          );
        } else {
          // 느린 드래그: 거리나 속도 조건 적용
          shouldNavigate =
            distance >= distanceThreshold || velocity >= velocityThreshold;

          console.log(
            `%c🐌 [느린 드래그] ${duration}ms >= ${fastSwipeTimeLimit}ms`,
            "background: #ff9900; color: black; font-weight: bold; padding: 3px 8px;",
            {
              판정: shouldNavigate ? "✅ 넘어감" : "❌ 안넘어감",
              거리조건: `${distance.toFixed(0)} >= ${distanceThreshold.toFixed(0)} = ${distance >= distanceThreshold}`,
              속도조건: `${velocity.toFixed(3)} >= ${velocityThreshold} = ${velocity >= velocityThreshold}`,
            },
          );
        }

        console.log(
          `%c🎯 [최종 판정]`,
          "background: #ff00ff; color: white; font-weight: bold; padding: 3px 8px;",
          {
            타입: isFastSwipe ? "⚡ 빠른 플링" : "🐌 느린 드래그",
            shouldNavigate,
            소요시간: `${duration}ms`,
            이동거리: `${distance.toFixed(0)}px`,
            속도: `${velocity.toFixed(3)}`,
          },
        );

        if (shouldNavigate) {
          this.lastSwipeTime = Date.now();
          this.hasPendingGestureNavigation = true;

          const direction = e.deltaX < 0 ? 1 : -1;
          console.log(
            `%c✅ [HAMMER] 네비게이션 실행`,
            "background: #00ff00; color: black; font-weight: bold; padding: 3px 8px;",
            {
              방향: direction === 1 ? "다음 주 →" : "이전 주 ←",
            },
          );

          if (e.deltaX < 0) {
            this.navigate(1);
          } else {
            this.navigate(-1);
          }
        } else {
          console.log(
            `%c↩️ [HAMMER] 네비게이션 취소 - 원위치`,
            "color: #ff9900; font-weight: bold;",
          );
          slides.forEach((slide, i) => {
            slide.style.transform = `translateX(${[-300, -200, -100, 0, 100, 200, 300][i]}%)`;
          });
          // 라벨은 슬라이드의 자식 요소이므로 자동으로 따라갑니다
        }
      }
    });

    // ========================================
    // Hammer 이벤트: pancancel
    // ========================================
    this.hammer.on("pancancel", (e) => {
      console.log(
        `%c⚠️ [HAMMER] pancancel`,
        "background: #ff9900; color: black; font-weight: bold; padding: 2px 5px;",
        {
          시각: new Date().toLocaleTimeString("ko-KR", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
          }),
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          velocityX: e.velocityX,
          velocityY: e.velocityY,
          isPanning: this.isPanning,
        },
      );

      if (this.isPanning) {
        console.log(
          `%c🔄 [HAMMER] 스와이프 상태 리셋`,
          "color: #ff9900; font-weight: bold;",
        );
        this.resetSwipeState();
      }
    });

    // ========================================
    // Hammer 이벤트: tap
    // ========================================
    this.hammer.on("tap", (e) => {
      console.log(
        `%c👆 [HAMMER] tap`,
        "background: #00ffff; color: black; padding: 2px 5px;",
        {
          시각: new Date().toLocaleTimeString("ko-KR", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
          }),
          타겟: e.target.className,
          center: `(${Math.round(e.center.x)}, ${Math.round(e.center.y)})`,
        },
      );

      if (this.currentView !== "week") return;

      const eventEl = e.target.closest(".week-event");
      if (eventEl) {
        const eventDate = eventEl.dataset.eventDate;
        if (eventDate) {
          console.log(
            `%c📅 [HAMMER] 이벤트 탭 → 일간 보기 전환`,
            "background: #0088ff; color: white; font-weight: bold; padding: 2px 5px;",
            { eventDate },
          );
          this.switchToDayView(new Date(eventDate));
        }
      }
    });

    console.log(
      `%c✅ 터치 이벤트 로깅 설정 완료`,
      "background: #00ff00; color: black; font-weight: bold; padding: 5px 10px; font-size: 14px;",
      {
        "Hammer threshold": "5px (초민감)",
        "빠른 플링": "200ms 미만, 5px 이상 → 넘어감",
        "느린 드래그": "200ms 이상, 50% 이상 → 넘어감",
        "네이티브 이벤트": "활성화",
        "Hammer 이벤트": "활성화",
      },
    );
  }

  async navigate(direction) {
    if (this.isAnimating) {
      console.log(
        `%c⏸️ [NAVIGATE] 중복 방지 - 애니메이션 진행 중`,
        "background: #ff9900; color: black; font-weight: bold; padding: 3px 8px;",
        { isAnimating: this.isAnimating },
      );
      return;
    }

    // ✅ 즉시 플래그 설정 (async await 전에!)
    this.isAnimating = true;
    this.isPanning = false;

    console.log(
      `%c🚀 [NAVIGATE] 시작`,
      "background: #00ffff; color: black; font-weight: bold; padding: 3px 8px;",
      {
        direction: direction === 1 ? "다음 주 →" : "이전 주 ←",
        isAnimating: this.isAnimating,
      },
    );

    // render 진행 중이면 대기
    if (this.renderPromise) {
      devLog("⏸️ [렌더 대기] navigate 시작 전 render 완료 대기...");
      await this.renderPromise;
    }

    try {
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
        await this.render();
        return;
      }

      console.log(
        `%c📍 [NAVIGATE] Step 2: 애니메이션 시작 (transform 적용)`,
        "color: #666; font-size: 11px;",
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

      // transitionend 대기 (중앙 슬라이드 = 인덱스 3)
      const handleTransitionEnd = async (e) => {
        if (e.propertyName !== "transform") return;
        console.log(
          `%c🎬 [NAVIGATE] transitionend 발생!`,
          "background: #00ff00; color: black; padding: 2px 5px;",
        );
        slides[3].removeEventListener("transitionend", handleTransitionEnd);

        await this.finalizeNavigation(direction, slides);
        console.log(
          `%c✅ [NAVIGATE] Step 4: finalizeNavigation 완료`,
          "background: #00ff00; color: black; font-weight: bold; padding: 3px 8px;",
        );
      };

      slides[3].addEventListener("transitionend", handleTransitionEnd, {
        once: true,
      });

      console.log(
        `%c📍 [NAVIGATE] Step 5: finally 블록 실행됨 (곧 isAnimating=false 됨!)`,
        "color: red; font-weight: bold; font-size: 11px;",
      );

      // 안전장치: 500ms 후 강제 완료
      setTimeout(async () => {
        if (this.isAnimating) {
          console.log(`%c⏱️ [NAVIGATE] 타임아웃 강제 완료`, "color: orange;");
          slides[3].removeEventListener("transitionend", handleTransitionEnd);
          await this.finalizeNavigation(direction, slides);
        }
      }, 500);
    } finally {
      console.log(
        `%c🔚 [NAVIGATE] finally 블록 - isAnimating=false 설정!`,
        "background: red; color: white; font-weight: bold; padding: 3px 8px;",
      );
      // 모든 종료 경로에서 플래그 리셋
      this.isAnimating = false;
      this.hasPendingGestureNavigation = false;
    }
  }

  async finalizeNavigation(direction, slidesArray) {
    console.log(
      `%c🔄 [FINALIZE] 시작`,
      "background: #ffff00; color: black; font-weight: bold; padding: 3px 8px;",
      { direction: direction === 1 ? "다음 주" : "이전 주" },
    );

    const slides = Array.from(slidesArray);
    if (slides.length !== 7) return;

    // 날짜 업데이트
    this.currentDate.setDate(this.currentDate.getDate() + direction * 7);
    console.log(
      `%c📅 [FINALIZE] 날짜 변경: ${this.currentDate.toLocaleDateString("ko-KR")}`,
      "color: #0088ff;",
    );

    // 제목 업데이트
    this.updateCalendarTitle();

    const slider = this.container.querySelector(".calendar-slider");
    const labelsSlider = document.querySelector(".room-labels-slider");

    // 트랜지션 비활성화
    slides.forEach((slide) => {
      slide.style.transition = "none";
    });

    // DOM 재배열 (7개 슬라이드)
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

    // 새 데이터 준비
    await this.prepareAdjacentSlides(direction);

    console.log(`%c🔄 [FINALIZE] 슬라이드 원위치 복원`, "color: #0088ff;");

    // 각 슬라이드를 원위치로 리셋 (transition 없이)
    const newSlides = this.container.querySelectorAll(".calendar-slide");
    newSlides.forEach((slide, i) => {
      slide.style.transform = `translateX(${[-300, -200, -100, 0, 100, 200, 300][i]}%)`;
      // 라벨은 슬라이드의 자식 요소이므로 자동으로 따라갑니다
    });

    // 레이아웃 조정
    this.adjustWeekViewLayout(true);

    // 현재 시간 표시
    requestAnimationFrame(() => {
      this.updateCurrentTimeIndicator();
      // ✅ 새로운 구조에서는 라벨 위치가 자동으로 계산되므로 updateRoomBottomLabelsPosition() 불필요
    });

    // 다음 프레임에서 트랜지션 재활성화
    requestAnimationFrame(() => {
      newSlides.forEach((slide) => {
        slide.style.transition = "";
        // 라벨은 슬라이드의 자식 요소이므로 자동으로 따라갑니다
      });
    });

    console.log(
      `%c✅ [FINALIZE] 완료!`,
      "background: #00ff00; color: black; font-weight: bold; padding: 3px 8px;",
    );
  }

  updateCalendarTitle() {
    const titleElement = document.getElementById("calendarTitle");
    if (!titleElement) return;

    const month = this.currentDate.getMonth() + 1;
    titleElement.textContent = `${month}월`;
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

    // 🚀 무한 스크롤 최적화: 스와이프 방향에 따라 우선 로드 영역 결정
    // 오른쪽 → (dates[3]=새 현재, dates[4]=+1주, dates[5]=+2주) 중 ±1주 우선
    // 왼쪽 ← (dates[1]=-2주, dates[2]=-1주, dates[3]=새 현재) 중 ±1주 우선
    let priorityDates, otherDates;
    
    if (direction === 1) {
      priorityDates = [dates[3], dates[4], dates[5]];
      otherDates = [dates[0], dates[1], dates[2], dates[6]];
      devLog(`   ⚡ 오른쪽(→) 스와이프: 우선 로드 ${priorityDates.map(d => d.toLocaleDateString("ko-KR")).join(" → ")}`);
    } else {
      priorityDates = [dates[1], dates[2], dates[3]];
      otherDates = [dates[0], dates[4], dates[5], dates[6]];
      devLog(`   ⚡ 왼쪽(←) 스와이프: 우선 로드 ${priorityDates.map(d => d.toLocaleDateString("ko-KR")).join(" ← ")}`);
    }

    // Step 1: 우선 로드 (3주 블로킹)
    devLog(`   ⏱️ [Step 1] 우선 로드 시작 - ${priorityDates.length}주 즉시`);
    const priorityStart = Date.now();
    for (const date of priorityDates) {
      await this.loadWeekDataToCache(date);
    }
    const priorityTime = Date.now() - priorityStart;
    devLog(`   ✅ 우선 로드 완료: ${priorityTime}ms`);

    // Step 2: 이벤트 병합 + 슬라이드 업데이트
    this.events = this.getMergedEventsFromCache(dates);
    slides.forEach((slide, i) => {
      slide.innerHTML = this.renderWeekViewContent(dates[i]);
    });
    devLog(`   ✅ [Step 2] 슬라이드 업데이트 완료: ${this.events.length}개 이벤트`);

    // Step 3: 나머지 주는 백그라운드 순차 로드 (비블로킹)
    devLog(`   🔄 [Step 3] 백그라운드 로드 시작 - ${otherDates.length}주 비동기`);
    
    // 🆕 현재 height 정보 저장 (높이 튀지 않게 하기)
    const slideHeights = new Map();
    slides.forEach((slide, idx) => {
      const weekView = slide.querySelector('.week-view');
      if (weekView) {
        slideHeights.set(idx, {
          height: weekView.clientHeight,
          gridTemplateRows: weekView.style.gridTemplateRows
        });
      }
    });
    
    otherDates.forEach(date => {
      this.loadWeekDataToCache(date).then(() => {
        const slideIdx = dates.findIndex(d => d.toDateString() === date.toDateString());
        if (slideIdx !== -1 && slides[slideIdx]) {
          // 🆕 콘텐츠 업데이트
          slides[slideIdx].innerHTML = this.renderWeekViewContent(dates[slideIdx]);
          
          // 🆕 높이 정보 복원 (높이 일관성 유지)
          const savedHeight = slideHeights.get(slideIdx);
          if (savedHeight) {
            const weekView = slides[slideIdx].querySelector('.week-view');
            if (weekView) {
              weekView.style.gridTemplateRows = savedHeight.gridTemplateRows;
              devLog(`   📦 [높이유지] ${date.toLocaleDateString("ko-KR")} - 그리드 복원`);
            }
          } else {
            devLog(`   📦 백그라운드 완료: ${date.toLocaleDateString("ko-KR")}`);
          }
        }
      });
    });

    devLog(`✅ [무한스크롤] 7주 유지: 우선 3주(${priorityTime}ms) → 나머지 4주 백그라운드 중...`);
  }

  goToToday() {
    devLog("🏠 [오늘로 이동] 전체 캐시 리셋");
    this.weekDataCache.clear();
    this.currentDate = new Date();
    this.render();
  }

  goToPrevMonth() {
    devLog("◀️ [이전 월] 전체 캐시 리셋");
    this.weekDataCache.clear();
    this.resetSwipeState();
    const prevMonth = new Date(this.currentDate);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    prevMonth.setDate(1);
    this.currentDate = prevMonth;
    this.render();
  }

  goToNextMonth() {
    devLog("▶️ [다음 월] 전체 캐시 리셋");
    this.weekDataCache.clear();
    this.resetSwipeState();
    const nextMonth = new Date(this.currentDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    this.currentDate = nextMonth;
    this.render();
  }

  async refreshCurrentView() {
    // 현재 view와 날짜를 유지하면서 데이터만 갱신
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

        for (const date of dates) {
          await this.loadWeekDataToCache(date);
        }

        this.events = this.getMergedEventsFromCache(dates);
        devLog(`   ✅ 병합된 이벤트: ${this.events.length}개`);

        // 7개 슬라이드 내용만 업데이트 (transform 유지)
        slides.forEach((slide, i) => {
          slide.innerHTML = this.renderWeekViewContent(dates[i]);
        });

        devLog(`🔄 슬라이드 준비 완료: -3주 ~ +3주`);

        // ✅ 날짜 높이 깨짐 방지: innerHTML 업데이트 후 레이아웃 재조정
        requestAnimationFrame(() => {
          this.adjustWeekViewLayout(true);
          this.updateCurrentTimeIndicator();
        });
      } else {
        // 슬라이드가 없으면 전체 렌더링
        await this.render();
      }
    } else {
      await this.render();
    }
  }

  // 캐시 무효화 헬퍼 (Realtime용)
  invalidateWeeks(weekStartDates) {
    weekStartDates.forEach((weekStart) => {
      const weekKey = this.getWeekCacheKey(new Date(weekStart));
      this.weekDataCache.delete(weekKey);
      devLog(`   🗑️ [캐시삭제] ${weekKey}`);
    });
  }

  changeView(view) {
    this.currentView = view;
    this.render();
  }

  switchToDayView(date) {
    this.currentDate = new Date(date);
    this.currentDate.setHours(0, 0, 0, 0);
    this.currentView = "day";

    // 일간 보기에서 Hammer 제스처 비활성화
    if (this.hammer) {
      this.hammer.set({ enable: false });
      devLog("🔒 [일간 보기] Hammer 제스처 비활성화");
    }

    this.render();
  }

  switchToWeekView() {
    this.currentView = "week";

    // 주간 보기로 복귀 시 Hammer 제스처 재활성화
    if (this.hammer) {
      this.hammer.set({ enable: true });
      devLog("🔓 [주간 보기] Hammer 제스처 활성화");
    }

    this.render();
  }

  isToday(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate.getTime() === today.getTime();
  }

  toggleRoom(roomId) {
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

    this.render();
  }

  toggleAllRooms() {
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

    this.render();
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
    // 이미 render 진행 중이면 대기
    if (this.renderPromise) {
      devLog("⏸️ [렌더 배리어] 진행 중인 render 대기...");
      await this.renderPromise;
    }

    // 새로운 render 시작
    this.renderPromise = this._doRender();
    await this.renderPromise;
    this.renderPromise = null;
  }

  async _doRender() {
    this.container.innerHTML = '<div class="loading">로딩 중...</div>';

    document.getElementById("calendarTitle").textContent =
      `${this.currentDate.getMonth() + 1}월`;

    if (this.currentView === "week") {
      await this.renderWeekViewWithSlider();
      // DOM 재생성 후 Hammer.js 재설정
      this.setupSwipeGestures();
    } else if (this.currentView === "day") {
      await this.loadEvents();
      this.renderDayView();
    } else {
      await this.loadEvents();
      this.renderMonthView();
    }
  }

  async renderWeekViewWithSlider() {
    // 🆕 초기 로드 시작
    this.isInitialLoading = true;
    devLog(`\n🎨 [렌더] 7슬라이드 렌더링 시작 (스와이프 DISABLED)`);
    devLog(`   현재 캐시 크기: ${this.weekDataCache.size}개`);

    const dates = [];
    for (let i = -3; i <= 3; i++) {
      const date = new Date(this.currentDate);
      date.setDate(date.getDate() + i * 7);
      dates.push(date);
      devLog(
        `   ${i === 0 ? "현재주" : i > 0 ? `+${i}주` : `${i}주`}: ${date.toLocaleDateString("ko-KR")}`,
      );
    }

    // ⚡ 3주 우선 로드 (블로킹) - 이 동안 스와이프 불가
    const currentWeekDate = dates[3];
    const adjWeekDates = [dates[2], dates[4]];
    
    devLog(`   🚀 [현주 로드] ${currentWeekDate.toLocaleDateString("ko-KR")}`);
    const t1 = Date.now();
    await this.loadWeekDataToCache(currentWeekDate);
    devLog(`   ✅ 현주 로드: ${Date.now() - t1}ms`);
    
    devLog(`   🚀 [±1주 병렬] ${adjWeekDates.map(d => d.toLocaleDateString("ko-KR")).join(", ")}`);
    const t2 = Date.now();
    await Promise.all(adjWeekDates.map(date => this.loadWeekDataToCache(date)));
    devLog(`   ✅ ±1주 로드: ${Date.now() - t2}ms`);

    // 캐시된 데이터를 합쳐서 this.events에 설정
    this.events = this.getMergedEventsFromCache(dates);
    devLog(`   ✅ 초기 이벤트 설정: ${this.events.length}개`);

    // 고정 시간 열 + 슬라이더 생성
    let html = this.renderTimeColumn();

    html += '<div class="calendar-slider">';

    const translateValues = [-300, -200, -100, 0, 100, 200, 300];
    dates.forEach((date, i) => {
      html += `<div class="calendar-slide" style="transform: translateX(${translateValues[i]}%)">`;
      html += this.renderWeekViewContent(date);
      html += "</div>";
    });

    html += "</div>";

    this.container.innerHTML = html;

    this.adjustWeekViewLayout();

    requestAnimationFrame(() => {
      this.updateCurrentTimeIndicator();
    });

    // 🆕 초기 3주 로드 완료 → 스와이프 활성화
    this.isInitialLoading = false;
    devLog(`   ✅ 초기 3주 로드 완료 - 스와이프 ENABLED`);

    // 🔄 나머지 4주 백그라운드 로드 (비블로킹)
    const otherDates = [dates[0], dates[1], dates[5], dates[6]];
    devLog(`   📊 백그라운드 로드 시작: ${otherDates.map(d => d.toLocaleDateString("ko-KR")).join(", ")}`);
    
    (async () => {
      for (const date of otherDates) {
        const t1 = Date.now();
        await this.loadWeekDataToCache(date);
        const t2 = Date.now() - t1;
        devLog(`   📊 [BG+${t2}ms] ${date.toLocaleDateString("ko-KR")}`);
      }
    })();
  }

  getWeekCacheKey(date) {
    const { start } = this.getWeekRange(date);
    return `${start.toISOString()}_${Array.from(this.selectedRooms).sort().join(",")}`;
  }

  async loadWeekDataToCache(date) {
    const cacheKey = this.getWeekCacheKey(date);

    // 이미 캐시에 있으면 스킵
    if (this.weekDataCache.has(cacheKey)) {
      const cachedEvents = this.weekDataCache.get(cacheKey);
      devLog(
        `   ✅ [캐시HIT] ${date.toLocaleDateString("ko-KR")} - ${cachedEvents.length}개 이벤트`,
      );
      return;
    }

    devLog(
      `   🔍 [캐시MISS] ${date.toLocaleDateString("ko-KR")} - Google Calendar 조회 시작`,
    );

    const { start, end } = this.getWeekRange(date);
    const roomIds = Array.from(this.selectedRooms);

    if (roomIds.length > 0) {
      try {
        // ✅ Google Calendar API 직접 호출
        const params = new URLSearchParams({
          roomIds: roomIds.join(','),
          startDate: start.toISOString(),
          endDate: end.toISOString()
        });

        // 환경에 따라 다른 경로 사용 (개발: /api/get-week-events, 배포: /.netlify/functions/get-week-events)
        const isDevelopment = window.location.hostname.includes('replit') || window.location.hostname === 'localhost';
        const apiUrl = isDevelopment 
          ? `/api/get-week-events?${params}`
          : `/.netlify/functions/get-week-events?${params}`;
        
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
          throw new Error(`API 응답 오류: ${response.status}`);
        }

        const data = await response.json();
        
        // Google Calendar 이벤트를 Calendar 포맷으로 변환
        const events = [];
        if (data.events) {
          for (const [roomId, roomEvents] of Object.entries(data.events)) {
            for (const event of roomEvents) {
              events.push({
                id: `${roomId}_${event.id}`, // 고유 ID 생성
                title: event.title,
                start: new Date(event.start),
                end: new Date(event.end),
                roomId: roomId,
                description: event.description,
                googleEventId: event.id
              });
            }
          }
        }

        this.weekDataCache.set(cacheKey, events);
        devLog(
          `   💾 [캐시저장] ${date.toLocaleDateString("ko-KR")} - ${events.length}개 이벤트 저장 (Google Calendar)`,
        );
      } catch (error) {
        devLog(`   ❌ Google Calendar 조회 실패: ${error.message}`);
        this.weekDataCache.set(cacheKey, []);
      }
    } else {
      this.weekDataCache.set(cacheKey, []);
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
      const dayEvents = this.getEventsForDay(day);

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

    // 3. renderWeekViewContent를 날짜 1개로 호출
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

    backBtn.addEventListener("click", () => {
      this.resetSwipeState();
      this.currentView = "week";
      this.render();
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

  getEventsForDay(date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // 여러 날에 걸친 이벤트를 하루 단위로 분할
    const dayEvents = [];

    this.events.forEach((event) => {
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
