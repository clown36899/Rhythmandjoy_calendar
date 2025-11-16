class Calendar {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentDate = new Date();
    this.currentView = 'week';
    this.selectedRooms = new Set(['a', 'b', 'c', 'd', 'e']);
    this.events = [];
    this.hammer = null;
    this.isAnimating = false;
    this.currentSlideIndex = 1; // 0: prev, 1: current, 2: next
    this.weekDataCache = new Map(); // 주간 데이터 캐시
    this.baseTranslate = -33.333; // 현재 slider의 기본 위치 (%)
  }

  async init() {
    await window.dataManager.init();
    this.setupEventListeners();
    this.setupSwipeGestures();
    this.setupResizeObserver();
    await this.render();
  }
  
  setupResizeObserver() {
    // viewport 크기 변경 시 레이아웃 재조정
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.currentView === 'week') {
          this.adjustWeekViewLayout();
        }
      });
      this.resizeObserver.observe(this.container);
    }
  }

  setupEventListeners() {
    // 헤더 네비게이션
    document.getElementById('prevBtn').addEventListener('click', () => this.navigate(-1));
    document.getElementById('nextBtn').addEventListener('click', () => this.navigate(1));
    
    // 푸터 네비게이션
    document.getElementById('prevWeekBtn').addEventListener('click', () => this.navigate(-1));
    document.getElementById('nextWeekBtn').addEventListener('click', () => this.navigate(1));
    document.getElementById('todayBtn').addEventListener('click', () => this.goToToday());

    // 방 선택
    document.querySelectorAll('.room-btn[data-room]').forEach(btn => {
      btn.addEventListener('click', () => this.toggleRoom(btn.dataset.room));
    });

    document.getElementById('allRoomsBtn').addEventListener('click', () => this.toggleAllRooms());
  }

  setupSwipeGestures() {
    if (typeof Hammer !== 'undefined') {
      this.hammer = new Hammer(this.container, {
        touchAction: 'pan-y'
      });
      
      // Pan과 Swipe 제스처 모두 활성화
      this.hammer.get('pan').set({ 
        direction: Hammer.DIRECTION_HORIZONTAL,
        threshold: 0 // 즉시 반응
      });
      this.hammer.get('swipe').set({ 
        direction: Hammer.DIRECTION_HORIZONTAL 
      });
      
      let startTransform = 0;
      
      this.hammer.on('panstart', (e) => {
        if (this.isAnimating) return;
        const slider = this.container.querySelector('.calendar-slider');
        if (slider) {
          slider.classList.add('no-transition');
          startTransform = this.baseTranslate; // 현재 위치에서 시작
        }
      });
      
      this.hammer.on('panmove', (e) => {
        if (this.isAnimating) return;
        
        const slider = this.container.querySelector('.calendar-slider');
        if (slider) {
          const percentMove = (e.deltaX / this.container.offsetWidth) * 100;
          const newTransform = startTransform + percentMove;
          slider.style.transform = `translateX(${newTransform}%)`;
        }
      });
      
      this.hammer.on('panend', (e) => {
        if (this.isAnimating) return;
        
        const slider = this.container.querySelector('.calendar-slider');
        if (slider) {
          slider.classList.remove('no-transition');
          
          // 업계 표준 스와이프 임계값
          const containerWidth = this.container.offsetWidth;
          const distanceThreshold = Math.min(containerWidth * 0.15, 120); // 15% 또는 최대 120px
          const velocityThreshold = 0.35; // px/ms
          
          const distance = Math.abs(e.deltaX);
          const velocity = Math.abs(e.velocityX);
          
          // 거리 조건 OR 속도 조건 (빠른 플링)
          const shouldNavigate = distance >= distanceThreshold || velocity >= velocityThreshold;
          
          if (shouldNavigate) {
            if (e.deltaX < 0) {
              // 왼쪽으로 스와이프 -> 다음 주
              this.navigate(1);
            } else {
              // 오른쪽으로 스와이프 -> 이전 주
              this.navigate(-1);
            }
          } else {
            // 원위치 (중앙으로 복귀)
            slider.style.transform = 'translateX(-33.333%)';
          }
        }
      });
      
      console.log('✅ 스와이프 제스처 설정 완료 (거리: 15%, 속도: 0.35)');
    }
  }

  async navigate(direction) {
    // Phase 1: Guard
    if (this.isAnimating) return;
    this.isAnimating = true;
    
    console.log(`🧭 네비게이션 시작: ${direction > 0 ? '다음 주' : '이전 주'}`);
    
    const slider = this.container.querySelector('.calendar-slider');
    if (!slider) {
      this.currentDate.setDate(this.currentDate.getDate() + (direction * 7));
      await this.render();
      this.isAnimating = false;
      return;
    }
    
    // Phase 2: Animate
    const targetTransform = direction === 1 ? '-66.666%' : '0%';
    slider.style.transform = `translateX(${targetTransform})`;
    
    // transitionend 대기 (단일 핸들러)
    const handleTransitionEnd = async (e) => {
      if (e.propertyName !== 'transform') return;
      slider.removeEventListener('transitionend', handleTransitionEnd);
      
      // Phase 3: Finalize
      await this.finalizeNavigation(direction, slider);
      this.isAnimating = false;
      console.log(`✅ 네비게이션 완료`);
    };
    
    slider.addEventListener('transitionend', handleTransitionEnd, { once: true });
  }
  
  async finalizeNavigation(direction, slider) {
    const slides = Array.from(slider.querySelectorAll('.calendar-slide'));
    if (slides.length !== 3) return;
    
    // 날짜 업데이트
    this.currentDate.setDate(this.currentDate.getDate() + (direction * 7));
    console.log(`📅 날짜 변경: ${this.currentDate.toLocaleDateString('ko-KR')}`);
    
    // 제목 업데이트
    this.updateCalendarTitle();
    
    // 트랜지션 비활성화
    slider.classList.add('no-transition');
    
    // DOM 재배열
    if (direction === 1) {
      const firstSlide = slides[0];
      slider.appendChild(firstSlide);
    } else {
      const lastSlide = slides[2];
      slider.insertBefore(lastSlide, slides[0]);
    }
    
    // 즉시 중앙(-33.333%)으로 재설정 (트랜지션 없이)
    slider.style.transform = 'translateX(-33.333%)';
    this.baseTranslate = -33.333;
    
    // 화면이 안정된 후 안 보이는 슬라이드 업데이트
    requestAnimationFrame(async () => {
      await this.prepareAdjacentSlides(direction);
      
      // 트랜지션 재활성화
      requestAnimationFrame(() => {
        slider.classList.remove('no-transition');
        this.adjustWeekViewLayout();
      });
    });
  }
  
  updateCalendarTitle() {
    const titleElement = document.getElementById('calendarTitle');
    if (!titleElement) return;
    
    const month = this.currentDate.getMonth() + 1;
    titleElement.textContent = `${month}월`;
  }
  
  async prepareAdjacentSlides(direction) {
    const slides = Array.from(this.container.querySelectorAll('.calendar-slide'));
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
    this.events = this.getMergedEventsFromCache([prevDate, this.currentDate, nextDate]);
    console.log(`   ✅ 병합된 이벤트: ${this.events.length}개`);
    
    // 슬라이드 내용 업데이트 (이제 this.events에 3주치 데이터가 있음)
    slides[0].innerHTML = this.renderWeekViewContent(prevDate);
    slides[1].innerHTML = this.renderWeekViewContent(this.currentDate);
    slides[2].innerHTML = this.renderWeekViewContent(nextDate);
    
    console.log(`🔄 슬라이드 준비: ${prevDate.toLocaleDateString('ko-KR')} | ${this.currentDate.toLocaleDateString('ko-KR')} | ${nextDate.toLocaleDateString('ko-KR')}`);
  }

  goToToday() {
    this.currentDate = new Date();
    this.render();
  }

  changeView(view) {
    this.currentView = view;
    this.render();
  }

  toggleRoom(roomId) {
    // 방 선택 변경 시 캐시 무효화
    console.log(`🗑️ [캐시클리어] 방 선택 변경: ${roomId}`);
    this.weekDataCache.clear();
    
    // 단일 방만 선택
    this.selectedRooms.clear();
    this.selectedRooms.add(roomId);
    
    // 모든 버튼 비활성화 후 선택한 버튼만 활성화
    document.querySelectorAll('.room-btn[data-room]').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById('allRoomsBtn').classList.remove('active');
    
    const btn = document.querySelector(`.room-btn[data-room="${roomId}"]`);
    btn.classList.add('active');
    
    this.render();
  }

  toggleAllRooms() {
    // 방 선택 변경 시 캐시 무효화
    console.log(`🗑️ [캐시클리어] 전체 방 선택`);
    this.weekDataCache.clear();
    
    const allBtn = document.getElementById('allRoomsBtn');
    const allRoomIds = Object.keys(CONFIG.rooms);
    
    // 모든 방 선택
    this.selectedRooms = new Set(allRoomIds);
    
    document.querySelectorAll('.room-btn[data-room]').forEach(btn => {
      btn.classList.add('active');
    });
    allBtn.classList.remove('active');
    
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
      end.toISOString()
    );
    
    this.events = window.dataManager.convertToEvents(bookings);
  }

  getDateRange() {
    if (this.currentView === 'week') {
      return this.getWeekRange(this.currentDate);
    } else {
      return this.getMonthRange(this.currentDate);
    }
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
    
    document.getElementById('calendarTitle').textContent = 
      `${this.currentDate.getMonth() + 1}월`;
    
    if (this.currentView === 'week') {
      await this.renderWeekViewWithSlider();
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
    
    console.log(`   이전주: ${prevDate.toLocaleDateString('ko-KR')}`);
    console.log(`   현재주: ${this.currentDate.toLocaleDateString('ko-KR')}`);
    console.log(`   다음주: ${nextDate.toLocaleDateString('ko-KR')}`);
    
    // 3주치 이벤트를 캐시에서 로드 또는 새로 가져오기
    await this.loadWeekDataToCache(prevDate);
    await this.loadWeekDataToCache(this.currentDate);
    await this.loadWeekDataToCache(nextDate);
    
    // 캐시된 데이터를 합쳐서 this.events에 설정
    this.events = this.getMergedEventsFromCache([prevDate, this.currentDate, nextDate]);
    console.log(`   ✅ 병합된 이벤트: ${this.events.length}개`);
    
    // 3개 슬라이드 생성: 이전주 | 현재주 | 다음주
    // transform: translateX(-33.333%)로 중앙(현재주)을 보여줌
    let html = '<div class="calendar-slider" style="transform: translateX(-33.333%)">';
    
    html += '<div class="calendar-slide">';
    html += this.renderWeekViewContent(prevDate);
    html += '</div>';
    
    html += '<div class="calendar-slide">';
    html += this.renderWeekViewContent(this.currentDate);
    html += '</div>';
    
    html += '<div class="calendar-slide">';
    html += this.renderWeekViewContent(nextDate);
    html += '</div>';
    
    html += '</div>';
    
    this.container.innerHTML = html;
    
    // DOM 업데이트 후 레이아웃 조정
    this.adjustWeekViewLayout();
  }
  
  getWeekCacheKey(date) {
    const { start } = this.getWeekRange(date);
    return `${start.toISOString()}_${Array.from(this.selectedRooms).sort().join(',')}`;
  }
  
  async loadWeekDataToCache(date) {
    const cacheKey = this.getWeekCacheKey(date);
    
    // 이미 캐시에 있으면 스킵
    if (this.weekDataCache.has(cacheKey)) {
      const cachedEvents = this.weekDataCache.get(cacheKey);
      console.log(`   ✅ [캐시HIT] ${date.toLocaleDateString('ko-KR')} - ${cachedEvents.length}개 이벤트`);
      return;
    }
    
    console.log(`   🔍 [캐시MISS] ${date.toLocaleDateString('ko-KR')} - DB 조회 시작`);
    
    // 캐시에 없으면 DB에서 로드
    const { start, end } = this.getWeekRange(date);
    const roomIds = Array.from(this.selectedRooms);
    
    if (roomIds.length > 0) {
      const bookings = await window.dataManager.fetchBookings(
        roomIds,
        start.toISOString(),
        end.toISOString()
      );
      const events = window.dataManager.convertToEvents(bookings);
      this.weekDataCache.set(cacheKey, events);
      console.log(`   💾 [캐시저장] ${date.toLocaleDateString('ko-KR')} - ${events.length}개 이벤트 저장`);
    } else {
      this.weekDataCache.set(cacheKey, []);
    }
  }
  
  getMergedEventsFromCache(dates) {
    const allEvents = [];
    const seenIds = new Set();
    
    dates.forEach(date => {
      const cacheKey = this.getWeekCacheKey(date);
      const weekEvents = this.weekDataCache.get(cacheKey) || [];
      
      weekEvents.forEach(event => {
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
  
  renderWeekViewContent(date) {
    const { start, end } = this.getWeekRange(date);
    const days = [];
    
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      days.push(day);
    }
    
    // 캐시에서 이벤트 가져오기
    const cacheKey = this.getWeekCacheKey(date);
    const cachedEvents = this.weekDataCache.get(cacheKey) || [];
    
    // 해당 주의 이벤트 필터링
    const weekEvents = cachedEvents.filter(event => {
      return event.start < end && event.end > start;
    });

    let html = '<div class="week-view">';
    
    // Header
    html += '<div class="week-header">';
    html += '<div class="time-label"></div>';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    days.forEach(day => {
      const isToday = day.getTime() === today.getTime();
      const isSunday = day.getDay() === 0;
      html += `<div class="day-header ${isSunday ? 'sunday' : ''} ${isToday ? 'today' : ''}">
        <span class="day-name">${CONFIG.dayNames[day.getDay()]}</span>
        <span class="day-date">${day.getDate()}</span>
      </div>`;
    });
    html += '</div>';

    // Time grid
    CONFIG.hoursDisplay.forEach((hourLabel, hourIndex) => {
      html += '<div class="time-row">';
      
      // 시간 라벨에도 시간대 클래스 적용
      let timeLabelClass = '';
      if (hourIndex >= 0 && hourIndex < 6) {
        timeLabelClass = 'dawn-time';
      } else if (hourIndex >= 6 && hourIndex < 16) {
        timeLabelClass = 'day-time';
      } else if (hourIndex >= 16 && hourIndex < 24) {
        timeLabelClass = 'evening-time';
      }
      
      html += `<div class="time-label ${timeLabelClass}">${hourLabel}</div>`;
      
      days.forEach(day => {
        const timeClass = this.getTimeSlotClass(hourIndex, day);
        html += `<div class="time-cell ${timeClass}" data-date="${day.toISOString()}" data-hour="${hourIndex}"></div>`;
      });
      
      html += '</div>';
    });

    // Event layer - one container per day
    days.forEach((day, dayIndex) => {
      const dayEvents = this.getEventsForDay(day);
      
      // Calculate position for this day column (7 equal columns after 3.75rem time column)
      const dayWidth = `calc((100% - 3.75rem) / 7)`;
      const dayLeft = `calc(3.75rem + (100% - 3.75rem) / 7 * ${dayIndex})`;
      
      html += `<div class="day-events-container" style="left: ${dayLeft}; width: ${dayWidth};">`;
      
      // Render events with fixed room positions
      dayEvents.forEach(event => {
        html += this.renderWeekEvent(event);
      });
      
      html += '</div>';
    });

    html += '</div>';
    
    return html;
  }
  
  adjustWeekViewLayout() {
    requestAnimationFrame(() => {
      // 모든 슬라이드의 week-view 조정
      const allWeekViews = this.container.querySelectorAll('.week-view');
      
      allWeekViews.forEach(weekView => {
        const headerElement = weekView.querySelector('.day-header');
        const timeLabel = weekView.querySelector('.time-label');
        
        if (!headerElement || !timeLabel) return;
        
        const headerHeight = headerElement.getBoundingClientRect().height;
        const weekViewHeight = weekView.clientHeight;
        const availableHeight = weekViewHeight - headerHeight;
        const rowHeight = availableHeight / 24;
        
        // Grid 행 높이를 동적으로 설정하여 24시간이 항상 fit되도록
        weekView.style.gridTemplateRows = `${headerHeight}px repeat(24, ${rowHeight}px)`;
        
        // 시간 컬럼의 실제 너비 측정
        const timeLabelWidth = timeLabel.getBoundingClientRect().width;
        
        // 이 weekView 안의 이벤트 컨테이너들 조정
        const eventContainers = weekView.querySelectorAll('.day-events-container');
        eventContainers.forEach((container, index) => {
          const weekViewWidth = weekView.clientWidth;
          const dayWidth = (weekViewWidth - timeLabelWidth) / 7;
          const dayLeft = timeLabelWidth + (dayWidth * index);
          
          container.style.left = `${dayLeft}px`;
          container.style.width = `${dayWidth}px`;
          container.style.top = `${headerHeight}px`;
          container.style.bottom = '0';
          container.style.paddingTop = '0';
          container.style.height = `${availableHeight}px`;
        });
      });
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
    
    days.forEach(day => {
      const isToday = day.getTime() === today.getTime();
      const isSunday = day.getDay() === 0;
      const isOtherMonth = day.getMonth() !== thisMonth;
      
      const dayEvents = this.getEventsForDay(day);
      
      html += `<div class="month-day ${isSunday ? 'sunday' : ''} ${isToday ? 'today' : ''} ${isOtherMonth ? 'other-month' : ''}">`;
      html += `<div class="month-day-number">${day.getDate()}</div>`;
      
      dayEvents.slice(0, 3).forEach(event => {
        html += this.renderMonthEvent(event);
      });
      
      if (dayEvents.length > 3) {
        html += `<div class="month-event-more">+${dayEvents.length - 3}</div>`;
      }
      
      html += '</div>';
    });

    html += '</div>';
    this.container.innerHTML = html;
  }

  getTimeSlotClass(hourIndex, date) {
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    if (isWeekend) {
      if (hourIndex >= 0 && hourIndex < 6) {
        return 'weekend-dawn';
      }
      if (hourIndex >= 6 && hourIndex < 24) {
        return 'weekend-day';
      }
    } else {
      if (hourIndex >= 0 && hourIndex < 6) {
        return 'weekday-dawn';
      }
      if (hourIndex >= 6 && hourIndex < 16) {
        return 'weekday-day';
      }
      if (hourIndex >= 16 && hourIndex < 24) {
        return 'weekday-evening';
      }
    }
    return '';
  }

  getEventsForCell(date, hour) {
    const cellStart = new Date(date);
    cellStart.setHours(hour, 0, 0, 0);
    const cellEnd = new Date(cellStart);
    cellEnd.setHours(hour + 1, 0, 0, 0);

    return this.events.filter(event => {
      return event.start < cellEnd && event.end > cellStart;
    }).sort((a, b) => {
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
    
    this.events.forEach(event => {
      // 이벤트가 이 날짜와 겹치는지 확인
      if (event.start < dayEnd && event.end > dayStart) {
        // 이 날짜에 해당하는 부분만 추출
        const segmentStart = event.start < dayStart ? dayStart : event.start;
        const segmentEnd = event.end > dayEnd ? dayEnd : event.end;
        
        // 자정넘어가는 이벤트 로그
        if (event.start < dayStart || event.end > dayEnd) {
          console.log(`   📅 [자정분할] ${event.roomId.toUpperCase()}: ${event.start.toLocaleString('ko-KR')} ~ ${event.end.toLocaleString('ko-KR')} → ${segmentStart.toLocaleString('ko-KR')} ~ ${segmentEnd.toLocaleString('ko-KR')}`);
        }
        
        dayEvents.push({
          ...event,
          displayStart: segmentStart,
          displayEnd: segmentEnd
        });
      }
    });
    
    return dayEvents;
  }

  renderWeekEvent(event) {
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
        'a': { left: 0, width: 20 },
        'b': { left: 20, width: 20 },
        'c': { left: 40, width: 20 },
        'd': { left: 60, width: 20 },
        'e': { left: 80, width: 20 }
      };
      position = roomPositions[event.roomId];
    }
    
    const roomName = CONFIG.rooms[event.roomId]?.name || event.roomId.toUpperCase();
    const displayTitle = event.title.length > 10 ? event.title.substring(0, 10) + '...' : event.title;
    
    return `<div class="week-event room-${event.roomId}" 
                 style="top: ${startPercent}%; height: ${height}%; width: ${position.width}%; left: ${position.left}%;"
                 title="${roomName}: ${event.title}">
              <div class="event-room">${roomName}</div>
              <div class="event-title">${displayTitle}</div>
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
      const overlaps = currentGroup.some(e => 
        event.start < e.end && event.end > e.start
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
    console.log('🔄 달력 새로고침');
    await this.render();
  }
}
