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
    this.currentSlideIndex = 1; // 0: prev, 1: current, 2: next
    this.weekDataCache = new Map(); // 주간 데이터 캐시
    this.baseTranslate = -33.333; // 현재 slider의 기본 위치 (%)
    this.timeUpdateInterval = null; // 현재 시간 업데이트 타이머
  }

  async init() {
    try {
      await window.dataManager.init();
      console.log("✅ Supabase initialized");
    } catch (error) {
      console.error(
        "⚠️ Supabase 초기화 실패, 캐시 데이터로 진행:",
        error.message,
      );
    }

    this.setupEventListeners();
    this.setupResizeObserver();
    await this.render();
    this.setupSwipeGestures();
    this.startCurrentTimeUpdater();

    console.log("✅ Realtime subscription active");
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

    // 이벤트 클릭 핸들러 (이벤트 위임)
    this.container.addEventListener("click", (e) => {
      const eventEl = e.target.closest(".week-event");
      if (eventEl && this.currentView === "week") {
        const eventDate = eventEl.dataset.eventDate;
        if (eventDate) {
          this.switchToDayView(new Date(eventDate));
        }
      }
    });
  }

  resetSwipeState() {
    this.isPanning = false;
    const slides = this.container.querySelectorAll(".calendar-slide");
    if (slides.length === 3) {
      slides.forEach((slide, i) => {
        slide.style.transition =
          "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)";
        slide.style.transform = `translateX(${[-100, 0, 100][i]}%)`;
      });
    }
  }

  setupSwipeGestures() {
    console.log("🔍 Hammer.js 확인:", typeof Hammer);

    if (typeof Hammer === "undefined") {
      console.error("❌ Hammer.js가 로드되지 않았습니다!");
      return;
    }

    // 기존 Hammer 인스턴스 제거
    if (this.hammer) {
      console.log("🔄 기존 Hammer 제거");
      this.hammer.destroy();
      this.hammer = null;
    }

    const slider = this.container.querySelector(".calendar-slider");
    if (!slider) {
      console.error("❌ .calendar-slider 요소를 찾을 수 없습니다!");
      return;
    }

    // Hammer.js 설정: touch-action 비활성화하여 가로 스와이프 허용
    this.hammer = new Hammer(slider, {
      touchAction: "auto",
      inputClass: Hammer.TouchMouseInput,
    });
    this.hammer.get("pan").set({
      direction: Hammer.DIRECTION_HORIZONTAL,
      threshold: 10,
      enable: true,
    });

    console.log("✅ Hammer 새로 생성 (touchAction: auto):", slider);

    let swipeStartTime = 0;
    let slideStarts = [-100, 0, 100]; // 각 슬라이드의 초기 위치

    this.hammer.on("panstart", (e) => {
      if (this.isAnimating) return;

      // 제스처 플래그 초기화
      this.hasPendingGestureNavigation = false;

      // 가로 스와이프인지 확인
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
        console.log("⬆️ [세로 스크롤] deltaX:", e.deltaX, "deltaY:", e.deltaY);
        return;
      }

      const slides = this.container.querySelectorAll(".calendar-slide");
      if (slides.length === 3) {
        slides.forEach((slide, i) => {
          slide.style.transition = "none";
        });
        slideStarts = [-100, 0, 100];
        swipeStartTime = Date.now();
        this.isPanning = true;
        console.log(
          "🚀 [스와이프 시작] deltaX:",
          e.deltaX,
          "deltaY:",
          e.deltaY,
        );
      }
    });

    this.hammer.on("panmove", (e) => {
      if (this.isAnimating || !this.isPanning) return;

      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

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
      if (this.isAnimating || !this.isPanning) return;
      
      // 중복 panend 방지: 이미 처리된 제스처면 무시
      if (this.hasPendingGestureNavigation) return;
      
      this.isPanning = false;
      
      const slides = this.container.querySelectorAll(".calendar-slide");
      if (slides.length === 3) {
        const swipeEndTime = Date.now();
        const duration = swipeEndTime - swipeStartTime;
        const distance = Math.abs(e.deltaX);
        const velocity = Math.abs(e.velocityX);
        const avgSpeed = duration > 0 ? (distance / duration).toFixed(2) : 0;

        console.log("📊 [스와이프 속도]", {
          "이동거리(px)": distance.toFixed(0),
          "소요시간(ms)": duration,
          "Hammer속도(px/ms)": velocity.toFixed(3),
          "평균속도(px/ms)": avgSpeed,
          방향: e.deltaX < 0 ? "왼쪽←" : "오른쪽→",
        });

        const isHorizontalSwipe = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        if (!isHorizontalSwipe) {
          slides.forEach((slide, i) => {
            slide.style.transition =
              "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)";
            slide.style.transform = `translateX(${[-100, 0, 100][i]}%)`;
          });
          return;
        }

        const animationDuration = velocity > 1.5 ? 0.25 : 0.3;
        slides.forEach((slide) => {
          slide.style.transition = `transform ${animationDuration}s cubic-bezier(0.22, 1, 0.36, 1)`;
        });

        const sliderElement = this.container.querySelector(".calendar-slider");
        const sliderWidth = sliderElement
          ? sliderElement.offsetWidth
          : this.container.offsetWidth;
        const distanceThreshold = Math.min(sliderWidth * 0.15, 120);
        const velocityThreshold = 0.35;

        const shouldNavigate =
          distance >= distanceThreshold || velocity >= velocityThreshold;

        if (shouldNavigate) {
          // 제스처 잠금: navigate 호출 전에 플래그 설정
          this.hasPendingGestureNavigation = true;
          if (e.deltaX < 0) {
            this.navigate(1);
          } else {
            this.navigate(-1);
          }
        } else {
          // 네비게이션 안 함: 원위치
          slides.forEach((slide, i) => {
            slide.style.transform = `translateX(${[-100, 0, 100][i]}%)`;
          });
        }
      }
    });

    // 터치 중단 시 리셋
    this.hammer.on("pancancel", (e) => {
      if (this.isPanning) {
        console.log("❌ [스와이프 취소]", {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          velocityX: e.velocityX,
          velocityY: e.velocityY,
        });
        this.resetSwipeState();
      }
    });

    console.log("✅ 스와이프 제스처 설정 완료 (거리: 15%, 속도: 0.35)");
  }

  async navigate(direction) {
    if (this.isAnimating) {
      console.log("⏸️ 네비게이션 중복 방지");
      return;
    }
    this.isAnimating = true;
    this.isPanning = false; // 네비게이션 시작 시 스와이프 상태 리셋

    console.log(`🧭 네비게이션 시작: ${direction > 0 ? "다음 주" : "이전 주"}`);

    const slides = this.container.querySelectorAll(".calendar-slide");
    if (slides.length !== 3) {
      this.currentDate.setDate(this.currentDate.getDate() + direction * 7);
      await this.render();
      this.isAnimating = false;
      return;
    }

    // 각 슬라이드를 100% 이동
    const targets = direction === 1 ? [-200, -100, 0] : [0, 100, 200];
    slides.forEach((slide, i) => {
      slide.style.transform = `translateX(${targets[i]}%)`;
    });

    // transitionend 대기
    const handleTransitionEnd = async (e) => {
      if (e.propertyName !== "transform") return;
      slides[1].removeEventListener("transitionend", handleTransitionEnd);

      await this.finalizeNavigation(direction, slides);
      this.isAnimating = false;
      this.hasPendingGestureNavigation = false;
      console.log(`✅ 네비게이션 완료`);
    };

    slides[1].addEventListener("transitionend", handleTransitionEnd, {
      once: true,
    });

    // 안전장치: 500ms 후 강제 완료
    setTimeout(async () => {
      if (this.isAnimating) {
        console.log("⏱️ 타임아웃으로 강제 완료");
        slides[1].removeEventListener("transitionend", handleTransitionEnd);
        await this.finalizeNavigation(direction, slides);
        this.isAnimating = false;
        this.hasPendingGestureNavigation = false;
        console.log(`✅ 네비게이션 완료 (타임아웃)`);
      }
    }, 500);
  }

  async finalizeNavigation(direction, slidesArray) {
    const slides = Array.from(slidesArray);
    if (slides.length !== 3) return;

    // 날짜 업데이트
    this.currentDate.setDate(this.currentDate.getDate() + direction * 7);
    console.log(
      `📅 날짜 변경: ${this.currentDate.toLocaleDateString("ko-KR")}`,
    );

    // 제목 업데이트
    this.updateCalendarTitle();

    const slider = this.container.querySelector(".calendar-slider");

    // 트랜지션 비활성화
    slides.forEach((slide) => {
      slide.style.transition = "none";
    });

    // DOM 재배열
    if (direction === 1) {
      slider.appendChild(slides[0]);
    } else {
      slider.insertBefore(slides[2], slides[0]);
    }

    // 새 데이터 준비
    await this.prepareAdjacentSlides(direction);

    // 각 슬라이드를 원위치로 리셋 (transition 없이)
    const newSlides = this.container.querySelectorAll(".calendar-slide");
    newSlides.forEach((slide, i) => {
      slide.style.transform = `translateX(${[-100, 0, 100][i]}%)`;
    });

    // 레이아웃 조정
    this.adjustWeekViewLayout(true);

    // 현재 시간 표시 업데이트
    requestAnimationFrame(() => {
      this.updateCurrentTimeIndicator();
    });

    // 다음 프레임에서 트랜지션 재활성화
    requestAnimationFrame(() => {
      newSlides.forEach((slide) => {
        slide.style.transition = "";
      });
    });
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
    if (slides.length !== 3) return;

    // 이제 slides = [이전주, 현재주, 다음주]
    const prevDate = new Date(this.currentDate);
    prevDate.setDate(prevDate.getDate() - 7);

    const nextDate = new Date(this.currentDate);
    nextDate.setDate(nextDate.getDate() + 7);

    // 3주치 캐시 로드
    await this.loadWeekDataToCache(prevDate);
    await this.loadWeekDataToCache(this.currentDate);
    await this.loadWeekDataToCache(nextDate);

    // 캐시된 데이터를 합쳐서 this.events에 설정 (getEventsForDay가 이걸 참조함)
    this.events = this.getMergedEventsFromCache([
      prevDate,
      this.currentDate,
      nextDate,
    ]);
    console.log(`   ✅ 병합된 이벤트: ${this.events.length}개`);

    // 슬라이드 내용 업데이트 (이제 this.events에 3주치 데이터가 있음)
    slides[0].innerHTML = this.renderWeekViewContent(prevDate);
    slides[1].innerHTML = this.renderWeekViewContent(this.currentDate);
    slides[2].innerHTML = this.renderWeekViewContent(nextDate);

    console.log(
      `🔄 슬라이드 준비: ${prevDate.toLocaleDateString("ko-KR")} | ${this.currentDate.toLocaleDateString("ko-KR")} | ${nextDate.toLocaleDateString("ko-KR")}`,
    );
  }

  goToToday() {
    this.currentDate = new Date();
    this.render();
  }

  goToPrevMonth() {
    this.resetSwipeState();
    this.currentDate.setMonth(this.currentDate.getMonth() - 1);
    this.render();
  }

  goToNextMonth() {
    this.resetSwipeState();
    this.currentDate.setMonth(this.currentDate.getMonth() + 1);
    this.render();
  }

  async refreshCurrentView() {
    // 현재 view와 날짜를 유지하면서 데이터만 갱신
    console.log('🔄 [갱신] 현재 상태 유지하며 데이터 업데이트');
    
    if (this.currentView === "week") {
      const slides = Array.from(this.container.querySelectorAll(".calendar-slide"));
      if (slides.length === 3) {
        // 3개 슬라이드가 있으면 내용만 갱신 (위치 유지)
        const prevDate = new Date(this.currentDate);
        prevDate.setDate(prevDate.getDate() - 7);
        const nextDate = new Date(this.currentDate);
        nextDate.setDate(nextDate.getDate() + 7);

        await this.loadWeekDataToCache(prevDate);
        await this.loadWeekDataToCache(this.currentDate);
        await this.loadWeekDataToCache(nextDate);

        this.events = this.getMergedEventsFromCache([prevDate, this.currentDate, nextDate]);
        console.log(`   ✅ 병합된 이벤트: ${this.events.length}개`);

        // 슬라이드 내용만 업데이트 (transform 유지)
        slides[0].innerHTML = this.renderWeekViewContent(prevDate);
        slides[1].innerHTML = this.renderWeekViewContent(this.currentDate);
        slides[2].innerHTML = this.renderWeekViewContent(nextDate);

        console.log(`🔄 슬라이드 준비: ${prevDate.toLocaleDateString("ko-KR")} | ${this.currentDate.toLocaleDateString("ko-KR")} | ${nextDate.toLocaleDateString("ko-KR")}`);
        
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
    weekStartDates.forEach(weekStart => {
      const weekKey = this.getWeekCacheKey(new Date(weekStart));
      this.weekDataCache.delete(weekKey);
      console.log(`   🗑️ [캐시삭제] ${weekKey}`);
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
    this.render();
  }

  switchToWeekView() {
    this.currentView = "week";
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
    console.log(`🗑️ [캐시클리어] 방 선택 변경: ${roomId}`);
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

    this.render();
  }

  toggleAllRooms() {
    // 방 선택 변경 시 캐시 무효화
    console.log(`🗑️ [캐시클리어] 전체 방 선택`);
    this.weekDataCache.clear();

    const allBtn = document.getElementById("allRoomsBtn");
    const allRoomIds = Object.keys(CONFIG.rooms);

    // 모든 방 선택
    this.selectedRooms = new Set(allRoomIds);

    document.querySelectorAll(".room-btn[data-room]").forEach((btn) => {
      btn.classList.add("active");
    });
    allBtn.classList.remove("active");

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
    console.log(`\n🎨 [렌더] 3슬라이드 렌더링 시작`);
    console.log(`   현재 캐시 크기: ${this.weekDataCache.size}개`);

    // 이전주, 현재주, 다음주 날짜 계산
    const prevDate = new Date(this.currentDate);
    prevDate.setDate(prevDate.getDate() - 7);

    const nextDate = new Date(this.currentDate);
    nextDate.setDate(nextDate.getDate() + 7);

    console.log(`   이전주: ${prevDate.toLocaleDateString("ko-KR")}`);
    console.log(`   현재주: ${this.currentDate.toLocaleDateString("ko-KR")}`);
    console.log(`   다음주: ${nextDate.toLocaleDateString("ko-KR")}`);

    // 3주치 이벤트를 캐시에서 로드 또는 새로 가져오기
    await this.loadWeekDataToCache(prevDate);
    await this.loadWeekDataToCache(this.currentDate);
    await this.loadWeekDataToCache(nextDate);

    // 캐시된 데이터를 합쳐서 this.events에 설정
    this.events = this.getMergedEventsFromCache([
      prevDate,
      this.currentDate,
      nextDate,
    ]);
    console.log(`   ✅ 병합된 이벤트: ${this.events.length}개`);

    // 고정 시간 열 + 슬라이더 생성
    let html = this.renderTimeColumn();

    html += '<div class="calendar-slider">';

    html += '<div class="calendar-slide" style="transform: translateX(-100%)">';
    html += this.renderWeekViewContent(prevDate);
    html += "</div>";

    html += '<div class="calendar-slide" style="transform: translateX(0%)">';
    html += this.renderWeekViewContent(this.currentDate);
    html += "</div>";

    html += '<div class="calendar-slide" style="transform: translateX(100%)">';
    html += this.renderWeekViewContent(nextDate);
    html += "</div>";

    html += "</div>";

    this.container.innerHTML = html;

    // DOM 업데이트 후 레이아웃 조정
    this.adjustWeekViewLayout();

    // 현재 시간 표시 업데이트
    requestAnimationFrame(() => {
      this.updateCurrentTimeIndicator();
    });
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
      console.log(
        `   ✅ [캐시HIT] ${date.toLocaleDateString("ko-KR")} - ${cachedEvents.length}개 이벤트`,
      );
      return;
    }

    console.log(
      `   🔍 [캐시MISS] ${date.toLocaleDateString("ko-KR")} - DB 조회 시작`,
    );

    // 캐시에 없으면 DB에서 로드
    const { start, end } = this.getWeekRange(date);
    const roomIds = Array.from(this.selectedRooms);

    if (roomIds.length > 0) {
      const bookings = await window.dataManager.fetchBookings(
        roomIds,
        start.toISOString(),
        end.toISOString(),
      );
      const events = window.dataManager.convertToEvents(bookings);
      this.weekDataCache.set(cacheKey, events);
      console.log(
        `   💾 [캐시저장] ${date.toLocaleDateString("ko-KR")} - ${events.length}개 이벤트 저장`,
      );
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
    const days = daysOverride || (() => {
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
    const dayViewClass = daysOverride && days.length === 1 ? ' day-view-mode' : '';
    let html = `<div class="week-view${dayViewClass}">`;

    // Header (시간 열 제외, 7개 요일만)
    html += '<div class="week-header">';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log("📅 [헤더생성] 오늘:", today.toLocaleDateString("ko-KR"));

    days.forEach((day) => {
      const isToday = day.getTime() === today.getTime();
      const isSunday = day.getDay() === 0;
      console.log(
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
        html += `<div class="time-cell ${timeClass}" data-date="${day.toISOString()}" data-hour="${hourIndex}"></div>`;
      });

      html += "</div>";
    });

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

      html += `<div class="day-events-container" style="left: ${dayLeft}; width: ${dayWidth};">`;

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
    const currentSlide = allSlides[1]; // 중간 슬라이드 = 현재 주

    if (!currentSlide) {
      console.log("❌ [오늘라인] 중간 슬라이드 없음");
      return;
    }

    const currentWeekView = currentSlide.querySelector(".week-view");
    if (!currentWeekView) {
      console.log("❌ [오늘라인] week-view 없음");
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
    // 10초마다 현재 시간 표시 업데이트 (더 부드러운 실시간 표시)
    this.updateCurrentTimeIndicator();

    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
    }

    this.timeUpdateInterval = setInterval(() => {
      this.updateCurrentTimeIndicator();
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
      const availableHeight = weekViewHeight - headerHeight;
      const rowHeight = availableHeight / 24;

      // 모든 슬라이드의 week-view 조정
      const allWeekViews = this.container.querySelectorAll(".week-view");

      allWeekViews.forEach((weekView) => {
        // Grid 행 높이를 동적으로 설정하여 24시간이 항상 fit되도록
        weekView.style.gridTemplateRows = `${headerHeight}px repeat(24, ${rowHeight}px)`;

        // 이 weekView 안의 이벤트 컨테이너들 조정 (7개 요일만)
        const eventContainers = weekView.querySelectorAll(
          ".day-events-container",
        );
        
        // 주간 보기인지 일간 보기인지 확인
        const isDayView = weekView.classList.contains('day-view-mode');
        
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
            dayLeft = (dayWidth * index) + gap;
            dayWidthAdjusted = dayWidth - (gap * 3);
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
        label.style.height = `${rowHeight}px`;
        label.style.minHeight = `${rowHeight}px`;
        label.style.maxHeight = `${rowHeight}px`;
      });

      // 레이아웃 변경 후 시간 인디케이터 재계산 (화면 크기 변경 대응)
      this.updateCurrentTimeIndicator();
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
    const footer = document.querySelector('.bottom-controls');
    if (!footer) return;

    // 기존 돌아가기 버튼 제거
    const existingBtn = footer.querySelector('.back-to-week-btn');
    if (existingBtn) existingBtn.remove();

    // 돌아가기 버튼 생성
    const backBtn = document.createElement('button');
    backBtn.className = 'back-to-week-btn';
    backBtn.innerHTML = '← 주간보기';
    backBtn.title = '주간 보기로 돌아가기';
    
    backBtn.addEventListener('click', () => {
      this.currentView = 'week';
      this.render();
      // 돌아가기 버튼 제거
      backBtn.remove();
    });

    // 예약 정보 버튼 앞에 삽입
    const infoBtn = footer.querySelector('.info-btn');
    if (infoBtn) {
      footer.insertBefore(backBtn, infoBtn);
    } else {
      footer.appendChild(backBtn);
    }
  }

  setupDayViewEventHandlers() {
    const weekView = this.container.querySelector('.week-view');
    if (!weekView || !weekView.classList.contains('day-view-mode')) {
      return; // 일간 보기가 아니면 종료
    }

    const events = weekView.querySelectorAll('.week-event');
    
    // 이벤트 클릭 핸들러
    events.forEach(event => {
      event.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // 이미 확대된 이벤트를 다시 클릭하면 축소
        if (event.classList.contains('expanded')) {
          event.classList.remove('expanded');
        } else {
          // 다른 모든 이벤트 축소
          events.forEach(e => e.classList.remove('expanded'));
          // 현재 이벤트 확대
          event.classList.add('expanded');
        }
      });
    });

    // 다른 곳 클릭 시 모든 이벤트 축소
    weekView.addEventListener('click', (e) => {
      if (!e.target.closest('.week-event')) {
        events.forEach(event => event.classList.remove('expanded'));
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
          console.log(
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
      let cleanTitle = event.title.replace(/^[A-E]홀\s*/, ''); // A홀 제거
      cleanTitle = cleanTitle.replace(/\(/g, ''); // ( 제거
      cleanTitle = cleanTitle.replace(/\d+/g, ''); // 숫자 제거
      cleanTitle = cleanTitle.trim(); // 공백 정리
      eventContent = `<div class="event-room">🎵 ${roomName}</div>
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
      const timeDisplay = `${timeStartHour}:${timeStartMin.toString().padStart(2, '0')}-${timeEndHour}:${timeEndMin.toString().padStart(2, '0')}`;
      
      let displayText = "";
      
      // 패턴 1: X****님 형식에서 세로로 나열 (예: 박 / ○ / 님)
      const nameMatch = event.title.match(/([^\s()\d])\*+님/);
      if (nameMatch) {
        const firstChar = nameMatch[1];
        displayText = `<div class="event-time-short">${timeDisplay}</div><div class="name-char">${firstChar}</div><div class="name-circle">○</div><div class="name-suffix">님</div>`;
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
    console.log("🔄 [deprecated] refresh() 호출 → refreshCurrentView() 사용");
    await this.refreshCurrentView();
  }
}
