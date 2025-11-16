class Calendar {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentDate = new Date();
    this.currentView = 'week';
    this.selectedRooms = new Set(['a', 'b', 'c', 'd', 'e']);
    this.events = [];
    this.hammer = null;
  }

  async init() {
    await window.dataManager.init();
    this.setupEventListeners();
    this.setupSwipeGestures();
    await this.render();
  }

  setupEventListeners() {
    document.getElementById('prevBtn').addEventListener('click', () => this.navigate(-1));
    document.getElementById('nextBtn').addEventListener('click', () => this.navigate(1));
    document.getElementById('todayBtn').addEventListener('click', () => this.goToToday());
    document.getElementById('weekBtn').addEventListener('click', () => this.changeView('week'));
    document.getElementById('monthBtn').addEventListener('click', () => this.changeView('month'));

    document.querySelectorAll('.room-btn[data-room]').forEach(btn => {
      btn.addEventListener('click', () => this.toggleRoom(btn.dataset.room));
    });

    document.getElementById('allRoomsBtn').addEventListener('click', () => this.toggleAllRooms());
  }

  setupSwipeGestures() {
    if (typeof Hammer !== 'undefined') {
      this.hammer = new Hammer(this.container);
      this.hammer.on('swipeleft', () => this.navigate(1));
      this.hammer.on('swiperight', () => this.navigate(-1));
      console.log('✅ 스와이프 제스처 설정 완료');
    }
  }

  navigate(direction) {
    if (this.currentView === 'week') {
      this.currentDate.setDate(this.currentDate.getDate() + (direction * 7));
    } else {
      this.currentDate.setMonth(this.currentDate.getMonth() + direction);
    }
    this.render();
  }

  goToToday() {
    this.currentDate = new Date();
    this.render();
  }

  changeView(view) {
    this.currentView = view;
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(view === 'week' ? 'weekBtn' : 'monthBtn').classList.add('active');
    this.render();
  }

  toggleRoom(roomId) {
    if (this.selectedRooms.has(roomId)) {
      this.selectedRooms.delete(roomId);
    } else {
      this.selectedRooms.add(roomId);
    }
    
    const btn = document.querySelector(`.room-btn[data-room="${roomId}"]`);
    btn.classList.toggle('active');
    
    this.render();
  }

  toggleAllRooms() {
    const allBtn = document.getElementById('allRoomsBtn');
    const allRoomIds = Object.keys(CONFIG.rooms);
    
    if (this.selectedRooms.size === allRoomIds.length) {
      this.selectedRooms.clear();
      allBtn.classList.remove('active');
      document.querySelectorAll('.room-btn[data-room]').forEach(btn => {
        btn.classList.remove('active');
      });
    } else {
      this.selectedRooms = new Set(allRoomIds);
      allBtn.classList.add('active');
      document.querySelectorAll('.room-btn[data-room]').forEach(btn => {
        btn.classList.add('active');
      });
    }
    
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
    
    await this.loadEvents();
    
    document.getElementById('calendarTitle').textContent = 
      `${this.currentDate.getMonth() + 1}월`;
    
    if (this.currentView === 'week') {
      this.renderWeekView();
    } else {
      this.renderMonthView();
    }
  }

  renderWeekView() {
    const { start } = this.getDateRange();
    const days = [];
    
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      days.push(day);
    }

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
    CONFIG.hoursDisplay.forEach(hour => {
      html += '<div class="time-row">';
      html += `<div class="time-label">${hour}시</div>`;
      
      days.forEach(day => {
        const timeClass = this.getTimeSlotClass(hour);
        html += `<div class="time-cell ${timeClass}" data-date="${day.toISOString()}" data-hour="${hour}"></div>`;
      });
      
      html += '</div>';
    });

    // Event layer - one container per day
    days.forEach((day, dayIndex) => {
      const dayEvents = this.getEventsForDay(day);
      
      // Create event container for this day
      const gridColumn = dayIndex + 2;
      html += `<div class="day-events-container" style="grid-column: ${gridColumn};">`;
      
      // Render events with fixed room positions
      dayEvents.forEach(event => {
        html += this.renderWeekEvent(event);
      });
      
      html += '</div>';
    });

    html += '</div>';
    this.container.innerHTML = html;
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

  getTimeSlotClass(hour) {
    if (hour >= CONFIG.timeSlots.dawn.start && hour < CONFIG.timeSlots.dawn.end) {
      return 'dawn';
    }
    if (hour >= CONFIG.timeSlots.day.start && hour < CONFIG.timeSlots.day.end) {
      return 'day';
    }
    if (hour >= CONFIG.timeSlots.evening.start && hour < CONFIG.timeSlots.evening.end) {
      return 'evening';
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

    return this.events.filter(event => {
      return event.start < dayEnd && event.end > dayStart;
    });
  }

  renderWeekEvent(event) {
    const startHour = event.start.getHours();
    const startMin = event.start.getMinutes();
    const endHour = event.end.getHours();
    const endMin = event.end.getMinutes();
    
    // Calculate position as percentage of 24-hour day
    const startPercent = ((startHour * 60 + startMin) / (24 * 60)) * 100;
    const endPercent = ((endHour * 60 + endMin) / (24 * 60)) * 100;
    const height = endPercent - startPercent;
    
    // Fixed room positions: A=0-20%, B=20-40%, C=40-60%, D=60-80%, E=80-100%
    const roomPositions = {
      'a': { left: 0, width: 20 },
      'b': { left: 20, width: 20 },
      'c': { left: 40, width: 20 },
      'd': { left: 60, width: 20 },
      'e': { left: 80, width: 20 }
    };
    
    const position = roomPositions[event.roomId];
    
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
