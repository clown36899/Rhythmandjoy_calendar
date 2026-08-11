(function () {
  const rooms = ["A", "B", "C", "D", "E"];
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const revenuePolicy = window.RhythmjoyRevenuePolicy || null;
  const apiUrl = "./api.php";
  const storageKey = "rhythmjoy.syncAdmin.drafts.v1";
  const profileKey = "rhythmjoy.syncAdmin.profile.v1";
  const sessionKey = "rhythmjoy.syncAdmin.sessions.v1";
  const tokenKey = "rhythmjoy.syncAdmin.adminToken.v1";
  const baseTitle = document.title;

  const state = {
    activeDate: today(),
    scheduleView: "day",
    roomFilter: "all",
    drafts: loadJson(storageKey, []),
    tasks: [],
    adminSeries: [],
    recurringPreview: null,
    recurringRequestId: "",
    selectedOccurrenceKey: "",
    selectedSeries: null,
    seriesOccurrences: [],
    eventDetailEvents: [],
    reflectionAudits: [],
    reflectionAuditSummary: null,
    adminAlerts: [],
    adminAlertSummary: null,
    adminAlertsLoading: false,
    sessions: loadJson(sessionKey, {}),
    revenueStats: null,
    revenueComparison: null,
    industryComparison: null,
    monthSummary: null,
    monthSummaryLoading: false,
    dayModalDate: "",
    dayModalEvents: [],
    apiMode: "local",
    lastApiMessage: "DB 연결 확인 전",
  };

  const el = {
    activeDate: document.getElementById("activeDate"),
    prevDay: document.getElementById("prevDay"),
    nextDay: document.getElementById("nextDay"),
    weekdayLabel: document.getElementById("weekdayLabel"),
    todayButton: document.getElementById("todayButton"),
    scheduleWrap: document.getElementById("scheduleWrap"),
    scheduleGrid: document.getElementById("scheduleGrid"),
    monthWrap: document.getElementById("monthWrap"),
    monthCalendar: document.getElementById("monthCalendar"),
    yearWrap: document.getElementById("yearWrap"),
    yearSummary: document.getElementById("yearSummary"),
    dayViewButton: document.getElementById("dayViewButton"),
    monthViewButton: document.getElementById("monthViewButton"),
    yearViewButton: document.getElementById("yearViewButton"),
    priceReference: document.getElementById("priceReference"),
    scheduleTimeNav: document.getElementById("scheduleTimeNav"),
    scheduleNowText: document.getElementById("scheduleNowText"),
    scrollToNow: document.getElementById("scrollToNow"),
    dayScheduleModal: document.getElementById("dayScheduleModal"),
    dayScheduleTitle: document.getElementById("dayScheduleTitle"),
    dayScheduleSummary: document.getElementById("dayScheduleSummary"),
    dayScheduleGrid: document.getElementById("dayScheduleGrid"),
    closeDayScheduleModal: document.getElementById("closeDayScheduleModal"),
    doneDayScheduleModal: document.getElementById("doneDayScheduleModal"),
    eventDetailModal: document.getElementById("eventDetailModal"),
    eventDetailSummary: document.getElementById("eventDetailSummary"),
    eventDetailList: document.getElementById("eventDetailList"),
    closeEventDetailModal: document.getElementById("closeEventDetailModal"),
    doneEventDetailModal: document.getElementById("doneEventDetailModal"),
    cancelAdminReservation: document.getElementById("cancelAdminReservation"),
    reservationModal: document.getElementById("reservationModal"),
    modalSlotSummary: document.getElementById("modalSlotSummary"),
    closeReservationModal: document.getElementById("closeReservationModal"),
    cancelReservationModal: document.getElementById("cancelReservationModal"),
    form: document.getElementById("new-reservation"),
    roomInput: document.getElementById("roomInput"),
    nameInput: document.getElementById("nameInput"),
    phoneInput: document.getElementById("phoneInput"),
    memoInput: document.getElementById("memoInput"),
    startInput: document.getElementById("startInput"),
    endInput: document.getElementById("endInput"),
    reflectionAudit: document.getElementById("reflectionAudit"),
    adminAlertButton: document.getElementById("adminAlertButton"),
    adminAlertBadge: document.getElementById("adminAlertBadge"),
    adminAlertBanner: document.getElementById("adminAlertBanner"),
    adminAlertBannerTitle: document.getElementById("adminAlertBannerTitle"),
    adminAlertBannerText: document.getElementById("adminAlertBannerText"),
    adminAlertDrawer: document.getElementById("adminAlertDrawer"),
    adminAlertDrawerSubtitle: document.getElementById("adminAlertDrawerSubtitle"),
    adminAlertDrawerSummary: document.getElementById("adminAlertDrawerSummary"),
    adminAlertList: document.getElementById("adminAlertList"),
    closeAdminAlertDrawer: document.getElementById("closeAdminAlertDrawer"),
    acknowledgeAllAlerts: document.getElementById("acknowledgeAllAlerts"),
    refreshAdminAlerts: document.getElementById("refreshAdminAlerts"),
    taskRows: document.getElementById("taskRows"),
    todayCount: document.getElementById("todayCount"),
    dayRevenue: document.getElementById("dayRevenue"),
    dayRevenueNet: document.getElementById("dayRevenueNet"),
    monthRevenue: document.getElementById("monthRevenue"),
    monthRevenueNet: document.getElementById("monthRevenueNet"),
    yearRevenue: document.getElementById("yearRevenue"),
    yearRevenueNet: document.getElementById("yearRevenueNet"),
    monthRevenueButton: document.getElementById("monthRevenueButton"),
    revenueModal: document.getElementById("revenueModal"),
    revenueModalSummary: document.getElementById("revenueModalSummary"),
    revenueMonthList: document.getElementById("revenueMonthList"),
    closeRevenueModal: document.getElementById("closeRevenueModal"),
    doneRevenueModal: document.getElementById("doneRevenueModal"),
    industryOverview: document.getElementById("industryOverview"),
    industryComparison: document.getElementById("industryComparison"),
    pendingCount: document.getElementById("pendingCount"),
    lastScan: document.getElementById("lastScan"),
    adminToken: document.getElementById("adminToken"),
    profilePath: document.getElementById("profilePath"),
    saveProfile: document.getElementById("saveProfile"),
    clearDrafts: document.getElementById("clearDrafts"),
    toast: document.getElementById("toast"),
    apiState: document.getElementById("apiState"),
    apiStatus: document.getElementById("apiStatus"),
    adminTokenStatus: document.getElementById("adminTokenStatus"),
    naverStatus: document.getElementById("naverStatus"),
    spacecloudStatus: document.getElementById("spacecloudStatus"),
    seriesList: document.getElementById("seriesList"),
    recurringModal: document.getElementById("recurringModal"),
    recurringForm: document.getElementById("recurringForm"),
    closeRecurringModal: document.getElementById("closeRecurringModal"),
    recurringTitle: document.getElementById("recurringTitle"),
    recurringName: document.getElementById("recurringName"),
    recurringStartDate: document.getElementById("recurringStartDate"),
    recurringEndDate: document.getElementById("recurringEndDate"),
    recurringFifthPolicy: document.getElementById("recurringFifthPolicy"),
    recurringPhone: document.getElementById("recurringPhone"),
    recurringMemo: document.getElementById("recurringMemo"),
    recurringRules: document.getElementById("recurringRules"),
    addRecurringRule: document.getElementById("addRecurringRule"),
    previewRecurring: document.getElementById("previewRecurring"),
    resetRecurringPreview: document.getElementById("resetRecurringPreview"),
    recurringPreview: document.getElementById("recurringPreview"),
    recurringPreviewSummary: document.getElementById("recurringPreviewSummary"),
    recurringYear: document.getElementById("recurringYear"),
    recurringIssueList: document.getElementById("recurringIssueList"),
    occurrenceEditor: document.getElementById("occurrenceEditor"),
    closeRecurringPreview: document.getElementById("closeRecurringPreview"),
    createRecurring: document.getElementById("createRecurring"),
    seriesModal: document.getElementById("seriesModal"),
    seriesModalTitle: document.getElementById("seriesModalTitle"),
    seriesModalSummary: document.getElementById("seriesModalSummary"),
    closeSeriesModal: document.getElementById("closeSeriesModal"),
    selectAllSeriesOccurrences: document.getElementById("selectAllSeriesOccurrences"),
    selectedSeriesOccurrenceCount: document.getElementById("selectedSeriesOccurrenceCount"),
    seriesOccurrenceList: document.getElementById("seriesOccurrenceList"),
    cancelSeriesFuture: document.getElementById("cancelSeriesFuture"),
    cancelSeriesSelected: document.getElementById("cancelSeriesSelected"),
  };

  init();

  function init() {
    syncTokenFromUrl();
    el.activeDate.value = state.activeDate;
    if (el.adminToken) el.adminToken.value = localStorage.getItem(tokenKey) || "";
    el.profilePath.value = localStorage.getItem(profileKey) || el.profilePath.value;
    fillTimeSelects();
    initializeRecurringForm();
    bindEvents();
    renderAll();
    updateActiveNav();
    refreshFromApi({ silent: true });
    window.setInterval(() => refreshAdminAlerts({ silent: true }), 30000);
    window.setInterval(() => refreshFromApi({ silent: true }), 60000);
    window.setInterval(updateCurrentTimeNavigator, 60000);
  }

  function bindEvents() {
    el.prevDay.addEventListener("click", () => moveDay(-1));
    el.nextDay.addEventListener("click", () => moveDay(1));
    el.todayButton.addEventListener("click", goToday);
    el.adminAlertButton.addEventListener("click", openAdminAlertDrawer);
    el.adminAlertBanner.addEventListener("click", openAdminAlertDrawer);
    el.closeAdminAlertDrawer.addEventListener("click", closeAdminAlertDrawer);
    el.adminAlertDrawer.addEventListener("click", (event) => {
      if (event.target === el.adminAlertDrawer) closeAdminAlertDrawer();
    });
    el.acknowledgeAllAlerts.addEventListener("click", () => acknowledgeAdminAlerts([], true));
    el.refreshAdminAlerts.addEventListener("click", () => refreshAdminAlerts());
    el.adminAlertList.addEventListener("click", async (event) => {
      const acknowledgeButton = event.target.closest("[data-ack-alert]");
      if (acknowledgeButton) {
        await acknowledgeAdminAlerts([acknowledgeButton.dataset.ackAlert]);
        return;
      }
      const targetButton = event.target.closest("[data-alert-target]");
      if (!targetButton) return;
      const alert = state.adminAlerts.find((item) => item.key === targetButton.dataset.alertKey);
      if (alert?.unread) await acknowledgeAdminAlerts([alert.key], false, { silent: true });
      navigateToAdminAlertTarget(targetButton.dataset.alertTarget);
    });
    el.activeDate.addEventListener("change", () => {
      state.activeDate = el.activeDate.value || today();
      if (state.scheduleView === "month") {
        state.monthSummary = null;
      }
      renderAll();
      refreshFromApi({ silent: true });
    });

    document.querySelectorAll("[data-room-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.roomFilter = button.dataset.roomFilter;
        document.querySelectorAll("[data-room-filter]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        renderSchedule();
      });
    });
    document.querySelectorAll("[data-schedule-view]").forEach((button) => {
      button.addEventListener("click", () => setScheduleView(button.dataset.scheduleView));
    });

    el.roomInput.addEventListener("change", updateModalSlotSummary);
    el.startInput.addEventListener("change", () => {
      ensureEndAfterStart();
      updateModalSlotSummary();
    });
    el.endInput.addEventListener("change", updateModalSlotSummary);
    el.form.addEventListener("submit", createDraftTask);
    el.closeReservationModal.addEventListener("click", closeReservationModal);
    el.cancelReservationModal.addEventListener("click", closeReservationModal);
    el.reservationModal.addEventListener("click", (event) => {
      if (event.target === el.reservationModal) closeReservationModal();
    });
    el.closeDayScheduleModal.addEventListener("click", closeDayScheduleModal);
    el.doneDayScheduleModal.addEventListener("click", closeDayScheduleModal);
    el.dayScheduleModal.addEventListener("click", (event) => {
      if (event.target === el.dayScheduleModal) closeDayScheduleModal();
    });
    el.closeEventDetailModal.addEventListener("click", closeEventDetailModal);
    el.doneEventDetailModal.addEventListener("click", closeEventDetailModal);
    el.eventDetailModal.addEventListener("click", (event) => {
      if (event.target === el.eventDetailModal) closeEventDetailModal();
    });
    el.cancelAdminReservation.addEventListener("click", cancelDetailedAdminReservation);
    document.querySelectorAll("[data-open-recurring-modal]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        openRecurringModal();
      });
    });
    el.closeRecurringModal.addEventListener("click", closeRecurringModal);
    el.closeRecurringPreview.addEventListener("click", closeRecurringModal);
    el.recurringModal.addEventListener("click", (event) => {
      if (event.target === el.recurringModal) closeRecurringModal();
    });
    el.addRecurringRule.addEventListener("click", () => addRecurringRule());
    el.previewRecurring.addEventListener("click", () => previewRecurringSchedule());
    el.resetRecurringPreview.addEventListener("click", resetRecurringPreview);
    el.recurringForm.addEventListener("submit", createRecurringSchedule);
    document.querySelectorAll("[data-recurring-months]").forEach((button) => {
      button.addEventListener("click", () => setRecurringPeriodMonths(Number(button.dataset.recurringMonths)));
    });
    [el.recurringStartDate, el.recurringEndDate, el.recurringFifthPolicy].forEach((input) => {
      input.addEventListener("change", resetRecurringPreview);
    });
    el.closeSeriesModal.addEventListener("click", closeSeriesModal);
    el.seriesModal.addEventListener("click", (event) => {
      if (event.target === el.seriesModal) closeSeriesModal();
    });
    el.selectAllSeriesOccurrences.addEventListener("change", toggleAllSeriesOccurrences);
    el.cancelSeriesSelected.addEventListener("click", () => cancelSeriesOccurrences("selected"));
    el.cancelSeriesFuture.addEventListener("click", () => cancelSeriesOccurrences("future"));
    el.monthRevenueButton.addEventListener("click", openRevenueModal);
    el.closeRevenueModal.addEventListener("click", closeRevenueModal);
    el.doneRevenueModal.addEventListener("click", closeRevenueModal);
    el.revenueModal.addEventListener("click", (event) => {
      if (event.target === el.revenueModal) closeRevenueModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!el.adminAlertDrawer.hidden) {
        closeAdminAlertDrawer();
        return;
      }
      if (!el.seriesModal.hidden) {
        closeSeriesModal();
        return;
      }
      if (!el.recurringModal.hidden) {
        closeRecurringModal();
        return;
      }
      if (!el.revenueModal.hidden) {
        closeRevenueModal();
        return;
      }
      if (!el.eventDetailModal.hidden) {
        closeEventDetailModal();
        return;
      }
      if (!el.dayScheduleModal.hidden) {
        closeDayScheduleModal();
        return;
      }
      if (!el.reservationModal.hidden) closeReservationModal();
    });
    el.clearDrafts.addEventListener("click", clearDrafts);
    el.scrollToNow.addEventListener("click", scrollScheduleToNow);
    if (el.saveProfile) el.saveProfile.addEventListener("click", saveProfile);
    window.addEventListener("resize", updateCurrentTimeNavigator);
    window.addEventListener("resize", scheduleActiveNavUpdate);
    window.addEventListener("scroll", scheduleActiveNavUpdate, { passive: true });
    window.addEventListener("focus", () => refreshAdminAlerts({ silent: true }));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshAdminAlerts({ silent: true });
    });

    document.querySelectorAll(".nav-link[href^='#']").forEach((link) => {
      link.addEventListener("click", () => {
        const targetId = link.getAttribute("href").slice(1);
        setActiveNav(targetId);
        window.setTimeout(updateActiveNav, 220);
      });
    });

    document.querySelectorAll("[data-open-login]").forEach((button) => {
      button.addEventListener("click", () => openLoginWindow(button.dataset.openLogin));
    });

    document.querySelectorAll("[data-open-reservation-modal]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openReservationModal();
      });
    });

    el.scheduleWrap.addEventListener("scroll", updateCurrentTimeNavigator, { passive: true });
  }

  function scheduleActiveNavUpdate() {
    if (scheduleActiveNavUpdate.queued) return;
    scheduleActiveNavUpdate.queued = true;
    window.requestAnimationFrame(() => {
      scheduleActiveNavUpdate.queued = false;
      updateActiveNav();
    });
  }

  function setScheduleView(view) {
    const nextView = ["day", "month", "year"].includes(view) ? view : "day";
    if (state.scheduleView === nextView) return;
    state.scheduleView = nextView;
    renderSchedule();
    if (nextView === "month") {
      refreshMonthSummary({ silent: true });
    }
  }

  async function refreshMonthSummary(options = {}) {
    if (!adminToken()) {
      state.monthSummary = null;
      renderMonthCalendar();
      return false;
    }
    state.monthSummaryLoading = true;
    renderMonthCalendar();
    try {
      const data = await apiRequest("month_summary", { date: state.activeDate });
      state.monthSummary = data.monthSummary || null;
      if (data.serverTime) {
        el.lastScan.textContent = formatDateTime(data.serverTime);
      }
      state.monthSummaryLoading = false;
      renderMonthCalendar();
      return true;
    } catch (error) {
      state.monthSummaryLoading = false;
      if (!options.silent) showToast(error.message || "월간 요약 조회 실패");
      renderMonthCalendar();
      return false;
    }
  }

  function updateActiveNav() {
    const links = Array.from(document.querySelectorAll(".nav-link[href^='#']"));
    const sections = links
      .map((link) => document.querySelector(link.getAttribute("href")))
      .filter(Boolean);
    if (!sections.length) return;

    const activeLine = Math.min(window.innerHeight * 0.42, 360);
    let activeId = sections[0].id;
    let bestScore = Number.POSITIVE_INFINITY;
    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      const visibleTop = Math.max(0, rect.top);
      const visibleBottom = Math.min(window.innerHeight, rect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      if (!visibleHeight) return;
      const sectionLine = rect.top <= activeLine && rect.bottom >= activeLine;
      const distance = Math.abs(rect.top - activeLine);
      const score = sectionLine ? 0 : distance + Math.max(0, 220 - visibleHeight);
      if (score < bestScore) {
        bestScore = score;
        activeId = section.id;
      }
    });
    setActiveNav(activeId);
  }

  function setActiveNav(targetId) {
    document.querySelectorAll(".nav-link[href^='#']").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === `#${targetId}`);
    });
  }

  function fillTimeSelects() {
    for (const hour of Array.from({ length: 24 }, (_, index) => index)) {
      el.startInput.appendChild(option(hour, formatHour(hour)));
    }
    for (const hour of Array.from({ length: 24 }, (_, index) => index + 1)) {
      el.endInput.appendChild(option(hour, formatHour(hour)));
    }
    el.startInput.value = "19";
    el.endInput.value = "21";
  }

  async function refreshFromApi(options = {}) {
    if (!adminToken()) {
      setApiState("warn", "DB 연결 필요", "운영 설정 확인이 필요합니다.");
      return false;
    }

    try {
      const data = await apiRequest("bootstrap", { date: state.activeDate });
      applyApiData(data);
      setApiState("ready", data.mode === "db-live-queue" ? "DB 큐" : "DB 테스트", "DB API 연결됨");
      renderAll();
      if (state.scheduleView === "month") {
        refreshMonthSummary({ silent: true });
      }
      return true;
    } catch (error) {
      setApiState("warn", "로컬 초안", error.message || "DB API 연결 실패");
      setLocalAdminApiAlert(error);
      if (!options.silent) showToast(error.message || "DB API 연결 실패");
      renderAll();
      return false;
    }
  }

  async function createDraftTask(event) {
    event.preventDefault();
    const start = Number(el.startInput.value);
    const end = Number(el.endInput.value);
    const room = el.roomInput.value;
    if (!validateRange(room, start, end)) return;

    const payload = {
      date: state.activeDate,
      room,
      start,
      end,
      name: el.nameInput.value.trim(),
      phone: el.phoneInput.value.trim(),
      memo: el.memoInput.value.trim(),
    };

    if (adminToken()) {
      try {
        const data = await apiRequest("create_reservation", payload);
        applyApiData(data);
        resetForm(room, start, end);
        closeReservationModal();
        setApiState("ready", data.mode === "db-live-queue" ? "DB 큐" : "DB 테스트", "DB 작업 생성됨");
        renderAll();
        showToast("DB에 동기화 작업을 생성했습니다.");
        return;
      } catch (error) {
        showToast(error.message || "DB 작업 생성 실패. 로컬 초안으로 저장합니다.");
        setApiState("warn", "로컬 초안", error.message || "DB 작업 생성 실패");
      }
    }

    const task = {
      id: `draft-${Date.now()}`,
      createdAt: new Date().toISOString(),
      date: state.activeDate,
      room,
      start,
      end,
      name: payload.name,
      phone: payload.phone,
      memo: payload.memo,
      status: "pending",
      naver: "대기",
      spacecloud: "대기",
    };

    state.drafts.unshift(task);
    persistDrafts();
    resetForm(room, start, end);
    closeReservationModal();
    renderAll();
    showToast("로컬 동기화 작업 초안이 생성됐습니다.");
  }

  function validateRange(room, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      showToast("종료 시간이 시작 시간보다 늦어야 합니다.");
      return false;
    }
    const overlap = state.drafts.find((item) => (
      item.date === state.activeDate &&
      item.room === room &&
      item.status !== "canceled" &&
      start < item.end &&
      end > item.start
    ));
    if (overlap) {
      showToast(`${room}홀 ${formatHour(overlap.start)}-${formatHour(overlap.end)} 예약과 겹칩니다.`);
      return false;
    }
    return true;
  }

  function renderAll() {
    updateDateControls();
    renderAdminAlerts();
    renderSchedule();
    renderPriceReference();
    renderReflectionAudits();
    renderTasks();
    renderStatus();
    renderSessions();
    renderIndustryComparison();
    renderSeriesList();
    if (!el.revenueModal.hidden) renderRevenueModal();
  }

  function renderSchedule() {
    updateScheduleViewControls();
    if (state.scheduleView === "year") {
      el.scheduleWrap.hidden = true;
      el.monthWrap.hidden = true;
      el.yearWrap.hidden = false;
      el.priceReference.hidden = true;
      el.scheduleTimeNav.hidden = true;
      renderYearSummary();
      return;
    }
    if (state.scheduleView === "month") {
      el.scheduleWrap.hidden = true;
      el.monthWrap.hidden = false;
      el.yearWrap.hidden = true;
      el.priceReference.hidden = true;
      el.scheduleTimeNav.hidden = true;
      renderMonthCalendar();
      return;
    }
    el.scheduleWrap.hidden = false;
    el.monthWrap.hidden = true;
    el.yearWrap.hidden = true;
    el.priceReference.hidden = false;
    renderDaySchedule();
  }

  function renderDaySchedule() {
    const visibleRooms = state.roomFilter === "all" ? rooms : [state.roomFilter];
    renderScheduleGrid(el.scheduleGrid, state.activeDate, state.drafts, visibleRooms, {
      slotMode: "create",
      showNow: true,
    });
    updateCurrentTimeNavigator();
  }

  function renderScheduleGrid(grid, date, events, visibleRooms, options = {}) {
    const roomList = visibleRooms && visibleRooms.length ? visibleRooms : rooms;
    const scheduleEvents = Array.isArray(events) ? events : [];
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = `var(--schedule-room-col) repeat(${hours.length}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${roomList.length + 1}, minmax(40px, auto))`;

    const corner = cell("", "header");
    placeGridItem(corner, 1, 1);
    grid.appendChild(corner);
    hours.forEach((hour) => {
      const headerCell = cell(scheduleHourLabel(hour), "header");
      headerCell.classList.add(timeBandClassForDate(date, hour), timeBandWeekendClassForDate(date));
      headerCell.title = formatHour(hour);
      placeGridItem(headerCell, 1, hour + 2);
      grid.appendChild(headerCell);
    });

    roomList.forEach((room, roomIndex) => {
      const rowIndex = roomIndex + 2;
      const roomCell = cell(`${room}홀`, "room");
      placeGridItem(roomCell, rowIndex, 1);
      grid.appendChild(roomCell);
      hours.forEach((hour) => {
        const slot = cell("", "slot");
        slot.classList.add(timeBandClassForDate(date, hour), timeBandWeekendClassForDate(date));
        if (options.slotMode !== "create") {
          slot.classList.add("readonly-slot");
        }
        slot.dataset.room = room;
        slot.dataset.hour = String(hour);
        placeGridItem(slot, rowIndex, hour + 2);
        const slotEvents = eventsForSlotInList(scheduleEvents, date, room, hour);
        if (slotEvents.length) {
          slot.classList.add("has-event");
          slot.title = eventTitle(slotEvents[0]);
        }
        slot.addEventListener("click", () => {
          if (slotEvents.length) {
            openEventDetailModal(slotEvents, `${room}홀 ${formatHour(hour)} 기준`);
            return;
          }
          if (options.slotMode === "create") {
            selectSlot(room, hour);
          }
        });
        grid.appendChild(slot);
      });
      eventsStartingForRoomInList(scheduleEvents, date, room).forEach((event) => {
        const block = document.createElement("div");
        block.className = `event-block ${sourceClass(event.source)}`;
        block.innerHTML = eventBlockHtml(event);
        block.title = eventTitle(event);
        block.draggable = false;
        block.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          openEventDetailModal([event], `${event.room}홀 ${formatHour(event.start)}-${formatHour(event.end)}`);
        });
        block.style.gridColumn = `${event.start + 2} / ${event.end + 2}`;
        block.style.gridRow = String(rowIndex);
        grid.appendChild(block);
      });
    });

    if (options.showNow) {
      updateScheduleGridCurrentTime(grid, date);
    }
  }

  function renderMonthCalendar() {
    if (!el.monthCalendar) return;
    if (state.scheduleView !== "month") return;

    const monthKey = selectedMonthKey();
    if (state.monthSummary?.month !== monthKey) {
      if (state.monthSummaryLoading) {
        el.monthCalendar.innerHTML = '<p class="empty-note month-note">월간 요약을 불러오는 중입니다.</p>';
      } else {
        el.monthCalendar.innerHTML = '<p class="empty-note month-note">월간 요약 조회가 필요합니다.</p>';
      }
      return;
    }

    const summary = state.monthSummary;
    const dayMap = new Map((summary.days || []).map((day) => [day.date, day]));
    const firstDate = new Date(`${monthKey}-01T00:00:00+09:00`);
    const daysInMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0).getDate();
    const leading = firstDate.getDay();
    const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
    const fragment = document.createDocumentFragment();

    ["일", "월", "화", "수", "목", "금", "토"].forEach((label, index) => {
      const head = document.createElement("div");
      head.className = `month-weekday ${index === 0 ? "sunday" : ""} ${index === 6 ? "saturday" : ""}`;
      head.textContent = label;
      fragment.appendChild(head);
    });

    for (let index = 0; index < totalCells; index += 1) {
      const dayNumber = index - leading + 1;
      if (dayNumber < 1 || dayNumber > daysInMonth) {
        const empty = document.createElement("div");
        empty.className = "month-day empty";
        fragment.appendChild(empty);
        continue;
      }
      const date = `${monthKey}-${pad2(dayNumber)}`;
      const day = dayMap.get(date) || emptyMonthDay(date);
      fragment.appendChild(monthDayButton(date, day));
    }

    el.monthCalendar.innerHTML = "";
    el.monthCalendar.appendChild(fragment);
  }

  function renderYearSummary() {
    if (!el.yearSummary || state.scheduleView !== "year") return;
    const stats = state.revenueStats;
    const selectedYear = Number(String(state.activeDate || today()).slice(0, 4));
    if (!stats || Number(stats.year) !== selectedYear) {
      el.yearSummary.innerHTML = '<p class="empty-note year-note">연간 매출을 불러오는 중입니다.</p>';
      return;
    }

    const months = Array.isArray(stats.months) ? stats.months : [];
    const maxTotal = Math.max(1, ...months.map((month) => Number(month.total || 0)));
    el.yearSummary.innerHTML = `
      <header class="year-summary-head">
        <div>
          <span>${escapeHtml(String(selectedYear))}년 총매출</span>
          <strong>${escapeHtml(formatRevenueStat(stats.yearTotal))}</strong>
        </div>
        <p>확정 ${Number(stats.yearConfirmedCount || 0).toLocaleString()}건${Number(stats.yearMissingCount || 0) ? ` · 금액 미수집 ${Number(stats.yearMissingCount).toLocaleString()}건` : ""}</p>
      </header>
      <div class="year-month-list">
        ${months.map((month) => yearMonthButtonHtml(month, maxTotal)).join("")}
      </div>
    `;
    el.yearSummary.querySelectorAll("[data-year-month]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeDate = `${button.dataset.yearMonth}-01`;
        el.activeDate.value = state.activeDate;
        state.monthSummary = null;
        state.scheduleView = "month";
        renderAll();
        refreshFromApi({ silent: true });
      });
    });
  }

  function yearMonthButtonHtml(month, maxTotal) {
    const monthKey = String(month.month || "");
    const monthNumber = Number(monthKey.slice(-2));
    const total = Number(month.total || 0);
    const count = Number(month.confirmedCount || 0);
    const missing = Number(month.missingCount || 0);
    const width = Math.max(total > 0 ? 4 : 0, Math.round((total / maxTotal) * 100));
    const current = monthKey === selectedMonthKey();
    return `
      <button type="button" class="year-month${current ? " selected" : ""}" data-year-month="${escapeHtml(monthKey)}" draggable="false">
        <span class="year-month-label">${monthNumber}월</span>
        <span class="year-month-value">${escapeHtml(formatRevenueStat(total))}</span>
        <span class="year-month-meta">${count.toLocaleString()}건${missing ? ` · 미수집 ${missing.toLocaleString()}` : ""}</span>
        <i class="year-month-bar" aria-hidden="true"><b style="width:${width}%"></b></i>
      </button>
    `;
  }

  function monthDayButton(date, day) {
    const button = document.createElement("button");
    const weekday = new Date(`${date}T00:00:00+09:00`).getDay();
    const roomCount = monthDayRoomCount(day);
    const filteredOut = state.roomFilter !== "all" && roomCount === 0;
    button.type = "button";
    button.className = [
      "month-day",
      date === state.activeDate ? "selected" : "",
      date === today() ? "today" : "",
      weekday === 0 ? "sunday" : "",
      weekday === 6 ? "saturday" : "",
      filteredOut ? "filtered-out" : "",
    ].filter(Boolean).join(" ");
    button.draggable = false;
    button.dataset.date = date;
    button.innerHTML = `
      <span class="month-day-head">
        <strong>${Number(day.day || date.slice(-2))}</strong>
        <small>${escapeHtml(weekdayShortText(date))}</small>
      </span>
      <span class="month-day-revenue">${escapeHtml(formatRevenueStat(monthDayRevenue(day)))}</span>
      <span class="month-day-meta">${monthDayCount(day)}건${monthDayMissing(day) ? ` · 미수집 ${monthDayMissing(day)}` : ""}</span>
      ${monthRoomSummaryHtml(day)}
    `;
    button.title = `${date} ${monthDayCount(day)}건 / ${formatRevenueStat(monthDayRevenue(day))}`;
    button.addEventListener("click", () => openDayScheduleModal(date));
    return button;
  }

  function emptyMonthDay(date) {
    return {
      date,
      day: Number(date.slice(-2)),
      count: 0,
      revenue: 0,
      missingCount: 0,
      rooms: {},
    };
  }

  function monthDayCount(day) {
    return Number(day.count || 0);
  }

  function monthDayRevenue(day) {
    if (state.roomFilter === "all") return Number(day.revenue || 0);
    return Number(day.revenue || 0);
  }

  function monthDayMissing(day) {
    return Number(day.missingCount || 0);
  }

  function monthDayRoomCount(day) {
    if (state.roomFilter === "all") return Number(day.count || 0);
    return Number(day.rooms?.[state.roomFilter] || 0);
  }

  function monthRoomSummaryHtml(day) {
    const entries = state.roomFilter === "all"
      ? rooms
        .map((room) => [room, Number(day.rooms?.[room] || 0)])
        .filter(([, count]) => count > 0)
      : [[state.roomFilter, Number(day.rooms?.[state.roomFilter] || 0)]].filter(([, count]) => count > 0);
    if (!entries.length) return '<span class="month-room-list empty">예약 없음</span>';
    return `
      <span class="month-room-list">
        ${entries.map(([room, count]) => `<i class="room-dot room-${escapeHtml(room.toLowerCase())}">${escapeHtml(room)} ${count}</i>`).join("")}
      </span>
    `;
  }

  function updateCurrentTimeNavigator() {
    const marker = ensureCurrentTimeMarker(el.scheduleGrid);
    const now = new Date();
    const visible = updateScheduleGridCurrentTime(el.scheduleGrid, state.activeDate, now);
    if (!visible) {
      el.scheduleTimeNav.hidden = true;
      return;
    }

    const label = `현재 ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    el.scheduleTimeNav.hidden = false;
    el.scheduleNowText.textContent = label;
    marker.querySelector("span").textContent = label;
  }

  function updateScheduleGridCurrentTime(grid, date, now = new Date()) {
    const marker = ensureCurrentTimeMarker(grid);
    const currentHour = now.getHours() + now.getMinutes() / 60;
    const firstHour = hours[0];
    const lastHour = 24;
    const isToday = date === today();
    const inRange = currentHour >= firstHour && currentHour <= lastHour;
    if (!isToday || !inRange || !grid.clientWidth) {
      marker.hidden = true;
      return false;
    }

    const rowHeaderWidth = scheduleRoomColumnWidth(grid);
    const usableWidth = Math.max(1, grid.clientWidth - rowHeaderWidth);
    const left = rowHeaderWidth + ((currentHour - firstHour) / (lastHour - firstHour)) * usableWidth;
    marker.hidden = false;
    marker.style.left = `${left}px`;
    marker.querySelector("span").textContent = `현재 ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    return true;
  }

  function ensureCurrentTimeMarker(grid = el.scheduleGrid) {
    let marker = grid.querySelector(".schedule-now-marker");
    if (!marker) {
      marker = document.createElement("div");
      marker.className = "schedule-now-marker";
      marker.hidden = true;
      marker.innerHTML = "<span></span>";
      grid.appendChild(marker);
    }
    return marker;
  }

  function scrollScheduleToNow() {
    const marker = ensureCurrentTimeMarker(el.scheduleGrid);
    updateCurrentTimeNavigator();
    if (marker.hidden) return;
    marker.classList.remove("pulse");
    void marker.offsetWidth;
    marker.classList.add("pulse");
    el.scheduleWrap.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function renderTasks() {
    const rows = (state.tasks.length ? state.tasks : state.drafts).slice(0, 30);
    el.taskRows.innerHTML = "";
    if (!rows.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="5">아직 표시할 작업이 없습니다.</td>';
      el.taskRows.appendChild(row);
      return;
    }
    rows.forEach((task) => {
      const row = document.createElement("tr");
      const badgeClass = taskBadgeClass(task);
      row.innerHTML = `
        <td><span class="status-badge ${badgeClass}">${escapeHtml(taskStatusText(task))}</span></td>
        <td>${taskBookingCellHtml(task)}</td>
        <td>${escapeHtml(taskPlatformText(task, "naver"))}</td>
        <td>${escapeHtml(taskPlatformText(task, "spacecloud"))}</td>
        <td>${formatDateTime(task.displayUpdatedAt || task.updatedAt || task.createdAt)}</td>
      `;
      el.taskRows.appendChild(row);
    });
  }

  function renderReflectionAudits() {
    if (!el.reflectionAudit) return;
    const summary = state.reflectionAuditSummary || {};
    const rows = state.reflectionAudits || [];
    const issueCount = Number(summary.issueCount || 0);
    const waitingCount = Number(summary.waitingCount || 0);
    const okCount = Number(summary.okCount || 0);
    const visibleRows = rows.filter((row) => row.auditStatus !== "ok").slice(0, 8);
    const stateClass = issueCount > 0 ? "failed" : (waitingCount > 0 ? "pending" : "done");
    const summaryText = issueCount > 0
      ? `문제 ${issueCount}건`
      : (waitingCount > 0 ? `대기 ${waitingCount}건` : "정상");
    const checkedText = summary.lastCheckedAt ? formatDateTime(summary.lastCheckedAt) : "아직 없음";

    if (!visibleRows.length) {
      el.reflectionAudit.innerHTML = `
        <div class="reflection-audit-head">
          <div>
            <strong>반영 정규검사</strong>
            <span>이메일 원장 기준 · 마지막 ${escapeHtml(checkedText)}</span>
          </div>
          <span class="status-badge ${stateClass}">${escapeHtml(summaryText)}</span>
        </div>
        <p class="reflection-audit-empty">최근 검사 기준으로 반대 플랫폼 반영 누락은 없습니다. 정상 ${okCount.toLocaleString()}건이 확인됐습니다.</p>
      `;
      return;
    }

    el.reflectionAudit.innerHTML = `
      <div class="reflection-audit-head">
        <div>
          <strong>반영 정규검사</strong>
          <span>이메일 원장 기준 · 마지막 ${escapeHtml(checkedText)}</span>
        </div>
        <span class="status-badge ${stateClass}">${escapeHtml(summaryText)}</span>
      </div>
      <div class="reflection-audit-list">
        ${visibleRows.map(reflectionAuditItemHtml).join("")}
      </div>
    `;
  }

  function reflectionAuditItemHtml(item) {
    const badge = item.auditStatus === "issue" ? "failed" : (item.auditStatus === "waiting" ? "pending" : "done");
    const taskLabel = reflectionTaskLabel(item.taskType, item.sourceLabel, item.targetLabel);
    const task = item.taskId ? `작업 #${item.taskId}` : "작업 없음";
    return `
      <article class="reflection-audit-item ${escapeHtml(item.severity || "")}">
        <span class="status-badge ${badge}">${escapeHtml(auditStatusText(item.auditStatus))}</span>
        <div>
          <strong>${escapeHtml(auditBookingLine(item))}</strong>
          <p>${escapeHtml(taskLabel)} · ${escapeHtml(item.reason || "-")}</p>
          <small>${escapeHtml(item.sourceLabel || "-")} → ${escapeHtml(item.targetLabel || "-")} · ${escapeHtml(task)} · 점검 ${escapeHtml(formatDateTime(item.checkedAt) || "-")}</small>
        </div>
      </article>
    `;
  }

  function auditBookingLine(item) {
    return `${item.date || "-"} ${item.room || "-"}홀 ${item.start || "-"}-${item.end || "-"} · ${item.name || "이름 없음"}${item.reservationNo ? ` · ${item.reservationNo}` : ""}`;
  }

  function auditStatusText(status) {
    return {
      issue: "확인필요",
      waiting: "대기",
      ok: "정상",
    }[status] || "확인필요";
  }

  function reflectionTaskLabel(taskType, sourceLabel, targetLabel) {
    return {
      upload: `${sourceLabel || "네이버"} 예약을 ${targetLabel || "스페이스클라우드"}에 등록`,
      naver_block: `${sourceLabel || "스페이스클라우드"} 예약으로 네이버 예약불가 반영`,
      delete: `${sourceLabel || "네이버"} 취소로 스페이스클라우드 삭제`,
      naver_restore: `${sourceLabel || "스페이스클라우드"} 취소로 네이버 예약가능 복구`,
      dedupe: "원장 확정 예약 중복",
    }[taskType] || "반대 플랫폼 반영";
  }

  function applyAdminAlertData(data) {
    if (Array.isArray(data.adminAlerts)) state.adminAlerts = data.adminAlerts;
    if (data.adminAlertSummary) state.adminAlertSummary = data.adminAlertSummary;
  }

  function setLocalAdminApiAlert(error) {
    const key = "system:admin-api";
    const now = new Date().toISOString();
    const message = String(error?.message || "DB API 연결 실패").replace(/\s+/g, " ").trim();
    const previous = (state.adminAlerts || []).filter((item) => item.key !== key);
    state.adminAlerts = [{
      key,
      source: "system",
      sourceLabel: "관리자 API",
      severity: "critical",
      title: "관리자 패널 DB 연결 오류",
      message: message || "운영 DB 상태를 불러오지 못했습니다.",
      occurredAt: now,
      updatedAt: now,
      targetSection: "sessions",
      contextLabel: "관리자 패널",
      status: "active",
      unread: true,
    }, ...previous];
    state.adminAlertSummary = {
      activeCount: state.adminAlerts.length,
      criticalCount: state.adminAlerts.filter((item) => item.severity === "critical").length,
      unreadCount: state.adminAlerts.filter((item) => item.unread).length,
      checkedAt: now,
    };
  }

  function renderAdminAlerts() {
    const alerts = state.adminAlerts || [];
    const summary = state.adminAlertSummary || {};
    const activeCount = Number(summary.activeCount ?? alerts.length);
    const unreadCount = Number(summary.unreadCount ?? alerts.filter((item) => item.unread).length);
    const criticalCount = Number(summary.criticalCount ?? alerts.filter((item) => item.severity === "critical").length);
    const checkedAt = summary.checkedAt ? formatDateTime(summary.checkedAt) : "아직 없음";

    el.adminAlertButton.classList.toggle("has-alerts", activeCount > 0);
    el.adminAlertButton.classList.toggle("has-unread", unreadCount > 0);
    el.adminAlertButton.setAttribute("aria-label", activeCount > 0
      ? `관리자 알림 열기, 현재 오류·주의 ${activeCount}건, 미확인 ${unreadCount}건`
      : "관리자 알림 열기, 현재 오류 없음");
    el.adminAlertBadge.hidden = activeCount < 1;
    el.adminAlertBadge.textContent = activeCount > 99 ? "99+" : String(activeCount);
    document.title = activeCount > 0 ? `(${activeCount}) ${baseTitle}` : baseTitle;

    el.adminAlertBanner.hidden = activeCount < 1;
    if (activeCount > 0) {
      el.adminAlertBannerTitle.textContent = criticalCount > 0
        ? `중요 오류 ${criticalCount}건을 포함해 확인할 알림이 있습니다.`
        : `확인할 자동화 주의 알림이 ${activeCount}건 있습니다.`;
      el.adminAlertBannerText.textContent = unreadCount > 0
        ? `미확인 ${unreadCount}건 · 텔레그램과 별도로 관리자 패널에 유지됩니다.`
        : "모두 읽었지만 해결 전까지 이 경고는 계속 표시됩니다.";
    }

    el.adminAlertDrawerSubtitle.textContent = `마지막 확인 ${checkedAt}`;
    el.adminAlertDrawerSummary.innerHTML = `
      <div class="alert-summary-item critical"><span>중요 오류</span><strong>${criticalCount.toLocaleString()}</strong></div>
      <div class="alert-summary-item"><span>활성 알림</span><strong>${activeCount.toLocaleString()}</strong></div>
      <div class="alert-summary-item"><span>미확인</span><strong>${unreadCount.toLocaleString()}</strong></div>
    `;
    el.acknowledgeAllAlerts.disabled = unreadCount < 1 || state.adminAlertsLoading;
    el.refreshAdminAlerts.disabled = state.adminAlertsLoading;
    el.refreshAdminAlerts.textContent = state.adminAlertsLoading ? "갱신 중" : "지금 새로고침";

    if (!alerts.length) {
      el.adminAlertList.innerHTML = `
        <div class="admin-alert-empty">
          <div>
            <span class="admin-alert-empty-icon" aria-hidden="true">✓</span>
            <strong>현재 확인할 오류가 없습니다.</strong>
            <span>작업 오류, 정규검사, 로그인 세션, 문자 발송 상태를 함께 감시합니다.</span>
          </div>
        </div>
      `;
      return;
    }
    el.adminAlertList.innerHTML = alerts.map(adminAlertItemHtml).join("");
  }

  function adminAlertItemHtml(alert) {
    const unread = alert.unread === true;
    const severity = alert.severity === "critical" ? "critical" : "warning";
    const time = formatDateTime(alert.updatedAt || alert.occurredAt) || "시각 확인 필요";
    const target = alert.targetSection === "sessions" ? "sessions" : "tasks";
    return `
      <article class="admin-alert-item ${severity} ${unread ? "unread" : "read"}">
        <span class="admin-alert-severity" aria-hidden="true">${severity === "critical" ? "!" : "i"}</span>
        <div>
          <div class="admin-alert-item-head">
            <strong>${escapeHtml(alert.title || "자동화 확인 필요")}</strong>
            ${unread ? '<span class="admin-alert-unread" title="미확인" aria-label="미확인"></span>' : ""}
          </div>
          <p>${escapeHtml(alert.message || "상세 상태를 확인해주세요.")}</p>
          <div class="admin-alert-meta">
            <span>${escapeHtml(alert.sourceLabel || "관리자 알림")}</span>
            ${alert.contextLabel ? `<span>${escapeHtml(alert.contextLabel)}</span>` : ""}
            ${alert.taskId ? `<span>작업 #${escapeHtml(alert.taskId)}</span>` : ""}
            <span>${escapeHtml(time)}</span>
          </div>
          <div class="admin-alert-item-actions">
            <button type="button" class="secondary-button compact-button" data-alert-target="${escapeHtml(target)}" data-alert-key="${escapeHtml(alert.key)}">관련 화면</button>
            ${unread
              ? `<button type="button" class="secondary-button compact-button" data-ack-alert="${escapeHtml(alert.key)}">읽음 처리</button>`
              : '<span class="alert-read-label">읽음</span>'}
          </div>
        </div>
      </article>
    `;
  }

  async function refreshAdminAlerts(options = {}) {
    if (!adminToken() || state.adminAlertsLoading) return false;
    state.adminAlertsLoading = true;
    renderAdminAlerts();
    try {
      const data = await apiRequest("alerts", {});
      applyAdminAlertData(data);
      return true;
    } catch (error) {
      setLocalAdminApiAlert(error);
      if (!options.silent) showToast(error.message || "관리자 알림 조회 실패");
      return false;
    } finally {
      state.adminAlertsLoading = false;
      renderAdminAlerts();
    }
  }

  async function acknowledgeAdminAlerts(alertKeys, all = false, options = {}) {
    if (!adminToken()) {
      if (!options.silent) showToast("관리자 DB 연결이 필요합니다.");
      return false;
    }
    try {
      const data = await apiRequest("acknowledge_alerts", { alertKeys, all });
      applyAdminAlertData(data);
      renderAdminAlerts();
      if (!options.silent) showToast(all ? "현재 알림을 모두 읽음 처리했습니다." : "알림을 읽음 처리했습니다.");
      return true;
    } catch (error) {
      if (!options.silent) showToast(error.message || "알림 읽음 처리 실패");
      return false;
    }
  }

  function openAdminAlertDrawer() {
    openAdminAlertDrawer.lastFocus = document.activeElement;
    el.adminAlertDrawer.hidden = false;
    document.body.classList.add("alert-drawer-open");
    el.adminAlertButton.setAttribute("aria-expanded", "true");
    el.adminAlertDrawer.querySelector(".alert-drawer").focus();
    refreshAdminAlerts({ silent: true });
  }

  function closeAdminAlertDrawer() {
    el.adminAlertDrawer.hidden = true;
    document.body.classList.remove("alert-drawer-open");
    el.adminAlertButton.setAttribute("aria-expanded", "false");
    if (openAdminAlertDrawer.lastFocus?.focus) openAdminAlertDrawer.lastFocus.focus();
  }

  function navigateToAdminAlertTarget(targetSection) {
    const target = document.getElementById(targetSection === "sessions" ? "sessions" : "tasks");
    closeAdminAlertDrawer();
    if (!target) return;
    setActiveNav(target.id);
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function renderStatus() {
    const todays = state.drafts.filter((item) => item.date === state.activeDate);
    el.todayCount.textContent = String(todays.length);
    const revenue = todays.reduce((total, item) => total + eventGrossAmount(item), 0);
    const netRevenue = todays.reduce((total, item) => total + eventNetAmount(item), 0);
    const feeRevenue = todays.reduce((total, item) => total + eventFeeAmount(item), 0);
    const missing = todays.filter((item) => !eventGrossAmount(item)).length;
    el.dayRevenue.textContent = revenue > 0 ? `${revenue.toLocaleString()}원` : "-";
    if (el.dayRevenueNet) {
      el.dayRevenueNet.textContent = amountBreakdownLine(netRevenue, feeRevenue, missing);
    }
    el.dayRevenue.title = amountSummaryTitle("예약매출", revenue, netRevenue, feeRevenue, missing);
    const selectedMonth = revenueSelectedMonth();
    el.monthRevenue.textContent = formatRevenueStat(selectedMonth?.total);
    if (el.monthRevenueNet) {
      el.monthRevenueNet.textContent = amountBreakdownLine(selectedMonth?.netTotal, selectedMonth?.feeTotal, selectedMonth?.missingCount);
    }
    el.monthRevenue.title = selectedMonth
      ? amountSummaryTitle(
        `${selectedMonth.confirmedCount || 0}건`,
        selectedMonth.total,
        selectedMonth.netTotal,
        selectedMonth.feeTotal,
        selectedMonth.missingCount,
      )
      : "선택월 원장 수익 합계";
    el.yearRevenue.textContent = formatRevenueStat(state.revenueStats?.yearTotal);
    if (el.yearRevenueNet) {
      el.yearRevenueNet.textContent = amountBreakdownLine(
        state.revenueStats?.yearNetTotal,
        state.revenueStats?.yearFeeTotal,
        state.revenueStats?.yearMissingCount,
      );
    }
    el.yearRevenue.title = state.revenueStats
      ? amountSummaryTitle(
        `${state.revenueStats.yearConfirmedCount || 0}건`,
        state.revenueStats.yearTotal,
        state.revenueStats.yearNetTotal,
        state.revenueStats.yearFeeTotal,
        state.revenueStats.yearMissingCount,
      )
      : "선택연도 원장 수익 합계";
    el.pendingCount.textContent = String(state.drafts.filter((item) => item.status === "pending").length);
  }

  function renderSessions() {
    updateSession("naver", el.naverStatus);
    updateSession("spacecloud", el.spacecloudStatus);
  }

  function updateSession(platform, label) {
    const row = document.querySelector(`.session-row[data-platform="${platform}"]`);
    const session = state.sessions[platform] || {};
    const status = normalizeSessionStatus(session.status, session.readyAt || session.ready_at);
    const checkedAt = session.lastCheckedAt || session.last_checked_at || session.updatedAt || session.updated_at || session.readyAt || session.ready_at;
    const note = session.note || "";
    const loginButton = row.querySelector("[data-open-login]");
    const isReady = status === "ready";

    row.classList.remove("ready", "warn", "failed", "checking", "needs-check");
    row.classList.add(sessionStatusClass(status));
    label.textContent = checkedAt
      ? `${sessionStatusLabel(status)} ${formatDateTime(checkedAt)}`
      : sessionStatusLabel(status);
    row.title = note ? `${sessionStatusLabel(status)}: ${note}` : sessionStatusLabel(status);
    if (loginButton) {
      loginButton.disabled = isReady;
      loginButton.title = isReady ? "정상 상태라 재로그인이 필요 없습니다." : "로그인 세션을 다시 연결합니다.";
    }
  }

  function normalizeSessionStatus(status, readyAt) {
    const value = String(status || "").trim().toLowerCase();
    if (["ready", "ok", "logged_in"].includes(value)) return "ready";
    if (["login_required", "needs_login", "auth_required", "expired"].includes(value)) return "login_required";
    if (["check_failed", "failed", "error"].includes(value)) return "check_failed";
    if (["checking", "running"].includes(value)) return "checking";
    return readyAt ? "ready" : "needs_check";
  }

  function sessionStatusLabel(status) {
    return {
      ready: "정상",
      login_required: "로그인 필요",
      check_failed: "점검 실패",
      checking: "점검 중",
      needs_check: "상태 대기",
    }[status] || "상태 대기";
  }

  function sessionStatusClass(status) {
    return {
      ready: "ready",
      login_required: "warn",
      check_failed: "failed",
      checking: "checking",
      needs_check: "needs-check",
    }[status] || "needs-check";
  }

  async function saveProfile() {
    const profilePath = el.profilePath.value.trim();
    localStorage.setItem(profileKey, profilePath);
    if (adminToken()) {
      try {
        const data = await apiRequest("save_profile", { date: state.activeDate, profilePath });
        applyApiData(data);
        renderAll();
        showToast("프로필 경로를 DB에 저장했습니다.");
        return;
      } catch (error) {
        setApiState("warn", "로컬 초안", error.message || "프로필 DB 저장 실패");
      }
    }
    showToast("프로필 경로가 로컬에 저장됐습니다.");
  }

  function openLoginWindow(platform) {
    const urls = {
      naver: "https://partner.booking.naver.com/",
      spacecloud: "https://partner.spacecloud.kr/",
    };
    window.open(urls[platform], "_blank", "noopener,noreferrer");
    showToast(`${platform === "naver" ? "네이버" : "스페이스클라우드"} 로그인 창을 열었습니다. 상태는 미니PC 다음 점검 후 갱신됩니다.`);
  }

  async function clearDrafts() {
    if (adminToken()) {
      try {
        const data = await apiRequest("clear_drafts", { date: state.activeDate });
        applyApiData(data);
        renderAll();
        showToast("DB 대기 작업을 취소 처리했습니다.");
        return;
      } catch (error) {
        setApiState("warn", "로컬 초안", error.message || "DB 초안 정리 실패");
        showToast(error.message || "DB 초안 정리 실패");
      }
    }
    state.drafts = [];
    persistDrafts();
    renderAll();
    showToast("로컬 작업 초안을 비웠습니다.");
  }

  function selectSlot(room, hour) {
    el.roomInput.value = room;
    el.startInput.value = String(hour);
    el.endInput.value = String(Math.min(24, hour + 1));
    ensureEndAfterStart();
    openReservationModal();
  }

  function eventsForSlotInList(events, date, room, hour) {
    return events.filter((item) => (
      item.date === date &&
      item.room === room &&
      item.status !== "canceled" &&
      hour >= item.start &&
      hour < item.end
    ));
  }

  function eventsStartingForRoomInList(events, date, room) {
    return events
      .filter((item) => (
        item.date === date &&
        item.room === room &&
        item.status !== "canceled" &&
        Number.isFinite(item.start) &&
        Number.isFinite(item.end) &&
        item.end > item.start
      ))
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function eventsForSlot(room, hour) {
    return eventsForSlotInList(state.drafts, state.activeDate, room, hour);
  }

  function eventsStartingForRoom(room) {
    return eventsStartingForRoomInList(state.drafts, state.activeDate, room);
  }

  function eventTitle(event) {
    const payment = formatPayment(eventGrossAmount(event));
    const source = event.sourceLabel || sourceText(event.source);
    return [
      `${event.name || "예약"} ${formatHour(event.start)}-${formatHour(event.end)}`,
      source,
      payment ? `실결제 ${payment}` : "실결제 금액 미수집",
    ].join(" / ");
  }

  function eventBlockHtml(event) {
    const payment = formatPayment(eventGrossAmount(event));
    return `
      <span class="event-main">${escapeHtml(event.name || "예약")} · ${formatHour(event.start)}-${formatHour(event.end)}</span>
      <span class="event-meta">
        <span>${escapeHtml(sourceShortText(event.source))}</span>
        ${payment ? `<span class="payment-amount">${escapeHtml(payment)}</span>` : ""}
      </span>
    `;
  }

  function eventDetailCardHtml(event) {
    const rows = [
      ["예약자", event.name || "이름 없음"],
      ["일시", `${event.date} ${event.room}홀 ${formatHour(event.start)}-${formatHour(event.end)}`],
      ["원천", event.sourceLabel || sourceText(event.source)],
      ["예약번호", event.reservationNo || ""],
      ["상품", event.product || ""],
      ["예약매출", formatPayment(eventGrossAmount(event)) || ""],
      ["정산입금", formatPayment(eventNetAmount(event)) || ""],
      ["수수료", formatPayment(eventFeeAmount(event)) || ""],
      ["결제수단", event.paymentMethod || ""],
      ["금액출처", amountSourceText(event.amountSource) || ""],
      ["결제상태", event.paymentStatus || ""],
      ["네이버", platformText(event.naver)],
      ["스페이스클라우드", platformText(event.spacecloud)],
      ["연락처", event.phone || ""],
      ["메모", event.memo || ""],
      ["등록시각", formatDateTime(event.createdAt) || ""],
    ].filter(([, value]) => String(value || "").trim());

    return `
      <article class="detail-card ${escapeHtml(sourceClass(event.source))}">
        <div class="detail-card-head">
          <strong>${escapeHtml(event.name || "예약")}</strong>
          <span>${escapeHtml(sourceShortText(event.source))}</span>
        </div>
        <dl class="detail-grid">
          ${rows.map(([label, value]) => `
            <div>
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `).join("")}
        </dl>
      </article>
    `;
  }

  function renderPriceReference() {
    if (!el.priceReference) return;
    const pricing = revenuePolicy?.ROOM_PRICING || null;
    if (!pricing) {
      el.priceReference.innerHTML = "";
      return;
    }
    const visibleRooms = state.roomFilter === "all" ? rooms : [state.roomFilter];
    const rows = visibleRooms
      .map((room) => {
        const config = pricing[room.toLowerCase()];
        if (!config) return "";
        return `
          <tr>
            <th>${escapeHtml(room)}홀</th>
            <td>${pricePairHtml(config.dawnHourly)}</td>
            <td>${pricePairHtml(config.before16)}</td>
            <td>${pricePairHtml(config.after16)}</td>
            <td>${pricePairHtml(config.overnight)}</td>
          </tr>
        `;
      })
      .filter(Boolean)
      .join("");
    el.priceReference.innerHTML = `
      <div class="price-legend">
        <span><i class="band-swatch band-dawn"></i>00-06 새벽</span>
        <span><i class="band-swatch band-before"></i>06-16 평일 낮</span>
        <span><i class="band-swatch band-after"></i>16-24 / 주말·공휴일</span>
      </div>
      <div class="price-reference-note">가격은 사이트 안내표 기준 참고값입니다. 예약 카드의 금액은 DB에 수집된 실제 결제금액이 있을 때만 표시합니다.</div>
      <div class="price-table-wrap">
        <table class="price-table">
          <thead>
            <tr>
              <th>방</th>
              <th>새벽 시간당</th>
              <th>평일 낮</th>
              <th>16시 후/주말/공휴일</th>
              <th>새벽 통대관</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderIndustryComparison() {
    if (!el.industryComparison) return;
    const data = state.industryComparison;
    if (!data) {
      if (el.industryOverview) {
        el.industryOverview.innerHTML = '<p class="empty-note">업계비교 DB 데이터를 불러오지 못했습니다.</p>';
      }
      el.industryComparison.innerHTML = "";
      return;
    }

    if (el.industryOverview) {
      const review = data.review || [];
      el.industryOverview.innerHTML = `
        <div class="industry-summary-strip">
          <article>
            <span>분석 기준</span>
            <strong>방 1개당 월평균</strong>
            <p>${escapeHtml(data.snapshot?.basis || "방 크기와 방 개수를 보정한 비교입니다.")}</p>
          </article>
          <article>
            <span>금액 기준</span>
            <strong>실결제 + 추정가</strong>
            <p>${escapeHtml(data.amountBasis || "리듬앤조이는 DB 원장, 경쟁사는 공개 가격 추정입니다.")}</p>
          </article>
          <article>
            <span>현재 판단</span>
            <strong>B/E 우선 점검</strong>
            <p>B/E는 대관시간이 낮고 단가가 높아 상시 인하보다 방/시간대 쿠폰 테스트가 우선입니다.</p>
          </article>
        </div>
        <div class="industry-review-list">
          ${review.slice(0, 5).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
        </div>
      `;
    }

    const groups = data.groups || [];
    const deltas = data.deltas || [];
    el.industryComparison.innerHTML = `
      <div class="industry-group-grid">
        ${groups.map(industryGroupHtml).join("")}
      </div>
      <section class="industry-section">
        <div class="revenue-section-heading">
          <h3>2025 상반기 대비 2026 상반기</h3>
          <p>시간감소 추정은 2025년 시간당 매출에 줄어든 대관시간을 곱한 값입니다. 경쟁사는 공지 가격 기준 추정치입니다.</p>
        </div>
        ${industryDeltaHtml(deltas)}
      </section>
      <section class="industry-section">
        <div class="revenue-section-heading">
          <h3>자료 범위</h3>
          <p>수집 출처와 제외 조건입니다. 경쟁사 금액은 정산액이 아니라 공지 가격 추정치입니다.</p>
        </div>
        ${industrySourceHtml(data.sources || [], data.exclusions || [])}
      </section>
    `;
  }

  function industryGroupHtml(group) {
    const rows = group.rows || [];
    return `
      <article class="industry-group-card industry-${escapeHtml(group.key || "")}">
        <header>
          <div>
            <h3>${escapeHtml(group.label || "")}</h3>
            <p>2026 상반기 · 방 1개당 월평균 기준</p>
          </div>
        </header>
        <div class="industry-studio-list">
          ${rows.map(industryStudioRowHtml).join("")}
        </div>
      </article>
    `;
  }

  function industryStudioRowHtml(row) {
    const own = row.studioKey === "rhythmjoy";
    return `
      <article class="industry-studio-row ${own ? "own" : ""}">
        <div class="industry-studio-head">
          <div>
            <strong>${escapeHtml(row.studioLabel || "")}</strong>
            <span>${escapeHtml(row.roomLabels || row.groupLabel || "")}</span>
          </div>
          <b>${own ? "우리" : "경쟁"}</b>
        </div>
        <dl class="industry-metrics">
          <div>
            <dt>대관시간/방/월</dt>
            <dd>${escapeHtml(formatHours(row.hoursPerRoomMonth))}</dd>
          </div>
          <div>
            <dt>매출/방/월</dt>
            <dd>${escapeHtml(formatRevenueStat(row.grossPerRoomMonth))}</dd>
          </div>
          <div>
            <dt>시간당</dt>
            <dd>${escapeHtml(formatRevenueStat(row.avgPerHour))}</dd>
          </div>
          <div>
            <dt>기간 총 예약</dt>
            <dd>${Number(row.events || 0).toLocaleString()}건</dd>
          </div>
        </dl>
        <p class="industry-row-note">${escapeHtml(row.note || row.amountBasis || "")}</p>
      </article>
    `;
  }

  function industryDeltaHtml(rows) {
    if (!rows.length) return '<p class="empty-note">전년대비 비교 데이터가 없습니다.</p>';
    return `
      <div class="industry-delta-table-wrap">
        <table class="industry-delta-table">
          <thead>
            <tr>
              <th>구분</th>
              <th>업체/방</th>
              <th>대관시간</th>
              <th>방당 월매출</th>
              <th>시간당</th>
              <th>시간감소 추정</th>
              <th>단가보정</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const assessment = industryDeltaAssessment(row);
              return `
                <tr class="${row.studioKey === "rhythmjoy" ? "own" : ""}">
                  <th>${escapeHtml(row.groupLabel || "")}</th>
                  <td>
                    <strong>${escapeHtml(row.studioLabel || "")}</strong>
                    <small>${escapeHtml(row.roomLabels || "")}</small>
                  </td>
                  <td class="${signedClass(row.hoursPerRoomMonthDiff)}">
                    ${escapeHtml(formatSignedHours(row.hoursPerRoomMonthDiff))}
                    <small>${escapeHtml(formatSignedPercent(row.hoursRate))}</small>
                  </td>
                  <td class="${signedClass(row.grossPerRoomMonthDiff)}">
                    ${escapeHtml(formatSignedWon(row.grossPerRoomMonthDiff))}
                    <small>${escapeHtml(formatSignedPercent(row.grossRate))}</small>
                  </td>
                  <td class="${signedClass(row.avgPerHourDiff)}">
                    ${escapeHtml(formatSignedWon(row.avgPerHourDiff))}
                    <small>${escapeHtml(formatSignedPercent(row.avgPerHourRate))}</small>
                  </td>
                  <td class="${Number(row.lostRevenueEstimate || 0) > 0 ? "negative" : signedClass(row.volumeRevenueEffect)}">
                    ${Number(row.lostRevenueEstimate || 0) > 0
                      ? `-${escapeHtml(formatRevenueStat(row.lostRevenueEstimate))}`
                      : escapeHtml(formatSignedWon(row.volumeRevenueEffect))}
                    <small>${Number(row.lostRevenuePerRoomMonthEstimate || 0) > 0
                      ? `방/월 -${escapeHtml(formatRevenueStat(row.lostRevenuePerRoomMonthEstimate))}`
                      : "감소 없음"}</small>
                  </td>
                  <td class="${signedClass(row.rateRevenueEffect)}">
                    ${escapeHtml(formatSignedWon(row.rateRevenueEffect))}
                    <small>시간당 ${escapeHtml(formatRevenueStat(row.baseAvgPerHour))} → ${escapeHtml(formatRevenueStat(row.nextAvgPerHour))}</small>
                  </td>
                  <td><span class="impact-badge ${escapeHtml(assessment.key)}">${escapeHtml(assessment.label)}</span></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function industryDeltaAssessment(row) {
    const hours = Number(row.hoursPerRoomMonthDiff || 0);
    const gross = Number(row.grossPerRoomMonthDiff || 0);
    if (hours < -10 && gross >= 0) return { key: "price", label: "단가로 방어" };
    if (hours < -10 && gross < 0) return { key: "volume_drop", label: "대관량 감소" };
    if (hours > 5 && gross >= 0) return { key: "volume", label: "대관량 우위" };
    if (gross < 0) return { key: "decline", label: "매출 하락" };
    return { key: "flat", label: "보합" };
  }

  function industrySourceHtml(sources, exclusions) {
    return `
      <div class="industry-source-grid">
        <div>
          <h4>출처</h4>
          <ul>
            ${sources.map((source) => `
              <li>
                ${String(source.url || "").startsWith("http")
                  ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label || source.url)}</a>`
                  : `<span>${escapeHtml(source.label || source.url || "")}</span>`}
              </li>
            `).join("")}
          </ul>
        </div>
        <div>
          <h4>제외/주의</h4>
          <ul>
            ${exclusions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
      </div>
    `;
  }

  function pricePairHtml(naverAmount) {
    const naver = Number(naverAmount || 0);
    if (!naver) return "-";
    return `
      <span class="price-pair">
        <span>네이버 ${formatWon(naver)}</span>
        <span>SC ${formatWon(naver)}</span>
      </span>
    `;
  }

  function timeBandClass(hour) {
    return timeBandClassForDate(state.activeDate, hour);
  }

  function timeBandClassForDate(date, hour) {
    if (hour >= 0 && hour < 6) return "time-dawn";
    if (!isWeekendOrHolidayDate(date) && hour < 16) return "time-before";
    return "time-after";
  }

  function timeBandWeekendClass() {
    return timeBandWeekendClassForDate(state.activeDate);
  }

  function timeBandWeekendClassForDate(date) {
    return isWeekendOrHolidayDate(date) ? "holiday-pricing" : "weekday-pricing";
  }

  function isWeekendOrHolidayDate(dateText) {
    const date = new Date(`${dateText}T00:00:00+09:00`);
    const day = date.getDay();
    if (day === 0 || day === 6) return true;
    const holidays = revenuePolicy?.HOLIDAYS_BY_YEAR?.[date.getFullYear()] || [];
    return holidays.includes(dateText);
  }

  function sourceClass(source) {
    if (source === "naver") return "source-naver";
    if (source === "spacecloud") return "source-spacecloud";
    if (source === "admin") return "source-admin";
    return "source-ledger";
  }

  function sourceShortText(source) {
    if (source === "naver") return "네이버";
    if (source === "spacecloud") return "SC";
    if (source === "admin") return "관리자";
    return "원장";
  }

  function paymentSuffix(task) {
    const payment = formatPayment(eventGrossAmount(task));
    if (!payment) return ' · <span class="payment-missing">금액 미수집</span>';
    return ` · <span class="payment-amount">${escapeHtml(payment)}</span>`;
  }

  function parsePaymentAmount(value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }

  function formatPayment(value) {
    const amount = parsePaymentAmount(value);
    if (amount > 0) return `${amount.toLocaleString()}원`;
    const text = String(value || "").trim();
    if (!text || text === "N/A") return "";
    return text;
  }

  function eventGrossAmount(event) {
    const amount = Number(event?.grossAmount || 0);
    return amount > 0 ? amount : parsePaymentAmount(event?.price);
  }

  function eventNetAmount(event) {
    return Number(event?.netAmount || 0);
  }

  function eventFeeAmount(event) {
    return Number(event?.feeAmount || 0);
  }

  function amountSummaryTitle(label, gross, net, fee, missing) {
    const parts = [`${label} ${formatRevenueStat(gross)}`];
    if (Number(net || 0) > 0) parts.push(`정산입금 ${formatRevenueStat(net)}`);
    if (Number(fee || 0) > 0) parts.push(`수수료 ${formatRevenueStat(fee)}`);
    if (Number(missing || 0) > 0) parts.push(`금액 미수집 ${Number(missing).toLocaleString()}건`);
    return parts.join(" / ");
  }

  function amountSourceText(value) {
    return {
      naver_email: "네이버 이메일",
      naver_export: "네이버 내보내기",
      "naver-platform-export": "네이버 내보내기",
      spacecloud_email: "스페이스클라우드 이메일",
      spacecloud_settlement: "스페이스클라우드 정산",
      "spacecloud-settlement-api": "스페이스클라우드 정산",
      "google-calendar-backfill": "과거 일정 백필",
      "visible-site-price": "사이트 화면 수집",
      admin_anchor: "관리자 입력",
    }[String(value || "")] || value || "";
  }

  function formatWon(amount) {
    return `${Number(amount || 0).toLocaleString()}원`;
  }

  function scheduleHourLabel(hour) {
    return String(hour).padStart(2, "0");
  }

  function placeGridItem(node, row, column) {
    node.style.gridRow = String(row);
    node.style.gridColumn = String(column);
  }

  function scheduleRoomColumnWidth(grid = el.scheduleGrid) {
    const header = grid.querySelector(".grid-cell.header");
    return header ? header.getBoundingClientRect().width : 68;
  }

  function ensureEndAfterStart() {
    const start = Number(el.startInput.value);
    const end = Number(el.endInput.value);
    if (end <= start) el.endInput.value = String(Math.min(24, start + 1));
  }

  function moveDay(delta) {
    const date = new Date(`${state.activeDate}T00:00:00`);
    if (state.scheduleView === "year") {
      date.setFullYear(date.getFullYear() + delta);
      date.setMonth(0, 1);
    } else if (state.scheduleView === "month") {
      date.setMonth(date.getMonth() + delta);
      date.setDate(1);
    } else {
      date.setDate(date.getDate() + delta);
    }
    state.activeDate = toDateInputValue(date);
    el.activeDate.value = state.activeDate;
    if (state.scheduleView === "month") {
      state.monthSummary = null;
    }
    renderAll();
    refreshFromApi({ silent: true });
  }

  function goToday() {
    const nextDate = today();
    if (state.activeDate === nextDate) return;
    state.activeDate = nextDate;
    el.activeDate.value = state.activeDate;
    if (state.scheduleView === "month") {
      state.monthSummary = null;
    }
    renderAll();
    refreshFromApi({ silent: true });
  }

  function updateDateControls() {
    el.todayButton.disabled = state.activeDate === today();
    if (el.weekdayLabel) {
      el.weekdayLabel.textContent = weekdayText(state.activeDate);
      el.weekdayLabel.classList.toggle("is-today", state.activeDate === today());
      el.weekdayLabel.title = state.activeDate;
    }
  }

  function updateScheduleViewControls() {
    if (el.dayViewButton) {
      el.dayViewButton.classList.toggle("active", state.scheduleView === "day");
      el.dayViewButton.setAttribute("aria-selected", state.scheduleView === "day" ? "true" : "false");
    }
    if (el.monthViewButton) {
      el.monthViewButton.classList.toggle("active", state.scheduleView === "month");
      el.monthViewButton.setAttribute("aria-selected", state.scheduleView === "month" ? "true" : "false");
    }
    if (el.yearViewButton) {
      el.yearViewButton.classList.toggle("active", state.scheduleView === "year");
      el.yearViewButton.setAttribute("aria-selected", state.scheduleView === "year" ? "true" : "false");
    }
  }

  function weekdayText(dateText) {
    const date = new Date(`${dateText}T00:00:00+09:00`);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(date);
  }

  function weekdayShortText(dateText) {
    const date = new Date(`${dateText}T00:00:00+09:00`);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date).replace("요일", "");
  }

  function selectedMonthKey() {
    return String(state.activeDate || "").slice(0, 7);
  }

  function revenueSelectedMonth() {
    const monthKey = selectedMonthKey();
    return (state.revenueStats?.months || []).find((item) => item.month === monthKey) || null;
  }

  function formatRevenueStat(value) {
    const amount = Number(value || 0);
    return amount > 0 ? `${amount.toLocaleString()}원` : "-";
  }

  function kstTodayParts() {
    const parts = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(byType.year || 0),
      month: Number(byType.month || 0),
      day: Number(byType.day || 0),
    };
  }

  function comparisonMonthCaution(month, year = 2026) {
    const today = kstTodayParts();
    const targetMonth = Number(month || 0);
    if (!targetMonth || year < today.year) return "";
    if (year > today.year || targetMonth > today.month) {
      return '<small class="data-caution">미래 예약 일부</small>';
    }
    if (year === today.year && targetMonth === today.month) {
      return '<small class="data-caution">진행 중인 월</small>';
    }
    return "";
  }

  function renderRevenueModal() {
    const stats = state.revenueStats;
    const comparison = state.revenueComparison;
    const selectedMonthKey = String(state.activeDate || "").slice(0, 7);
    const year = String(state.activeDate || "").slice(0, 4);
    const months = stats?.months || [];
    el.revenueModalSummary.textContent = `DB 원장 매출 기준 · ${comparison?.baseYear || 2025}년 / ${comparison?.compareYear || 2026}년 같은 기간 비교`;
    if (!months.length && !comparison) {
      el.revenueMonthList.innerHTML = '<p class="empty-note">표시할 수익 통계가 없습니다.</p>';
      return;
    }
    const monthlyHtml = comparison?.monthlyComparison?.length
      ? monthlyComparisonHtml(comparison.monthlyComparison, selectedMonthKey)
      : selectedYearMonthlyHtml(months, selectedMonthKey);
    el.revenueMonthList.innerHTML = `
      ${comparison ? revenueComparisonHtml(comparison) : ""}
      <section class="revenue-section">
        <div class="revenue-section-heading">
          <h3>월별 수익 비교</h3>
          <p>DB 원장 기준입니다. 2026년 현재월은 진행 중, 이후 월은 이미 들어온 미래 예약만 포함합니다. 선택 연도 ${escapeHtml(year)}년 연총합 ${escapeHtml(formatRevenueStat(stats?.yearTotal))}</p>
        </div>
        ${monthlyHtml || '<p class="empty-note">표시할 월별 수익 통계가 없습니다.</p>'}
      </section>
    `;
  }

  function revenueMetricHtml(label, value) {
    return `
      <div>
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(formatRevenueStat(value))}</dd>
      </div>
    `;
  }

  function selectedYearMonthlyHtml(months, selectedMonthKey) {
    if (!months.length) return "";
    return `
      <div class="monthly-compare-wrap">
        <table class="monthly-compare-table">
          <thead>
            <tr>
              <th>월</th>
              <th>매출</th>
              <th>예약</th>
              <th>일평균</th>
              <th>주말평균</th>
              <th>건당평균</th>
            </tr>
          </thead>
          <tbody>
            ${months.map((item) => `
              <tr class="${item.month === selectedMonthKey ? "active" : ""}">
                <th>${escapeHtml(formatMonthLabel(item.month))}</th>
                <td>
                  <strong>${escapeHtml(formatRevenueStat(item.total))}</strong>
                  ${amountBreakdownSmall(item)}
                </td>
                <td>${Number(item.confirmedCount || 0).toLocaleString()}건</td>
                <td>${escapeHtml(formatRevenueStat(item.dayAverage))}</td>
                <td>${escapeHtml(formatRevenueStat(item.weekendAverage))}</td>
                <td>${escapeHtml(formatRevenueStat(item.bookingAverage))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function monthlyComparisonHtml(rows, selectedMonthKey) {
    const selectedMonth = Number(String(selectedMonthKey || "").slice(5, 7));
    return `
      <div class="monthly-compare-wrap">
        <table class="monthly-compare-table">
          <thead>
            <tr>
              <th>월</th>
              <th>2025</th>
              <th>2026</th>
              <th>매출 증감</th>
              <th>예약수</th>
              <th>건당평균</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="${Number(row.month || 0) === selectedMonth ? "active" : ""}">
                <th>${escapeHtml(row.label || "")}</th>
                <td>
                  <strong>${escapeHtml(formatRevenueStat(row.year2025?.total))}</strong>
                  <small>${Number(row.year2025?.confirmedCount || 0).toLocaleString()}건 · 건당 ${escapeHtml(formatRevenueStat(row.year2025?.bookingAverage))}</small>
                  ${amountBreakdownSmall(row.year2025)}
                </td>
                <td>
                  <strong>${escapeHtml(formatRevenueStat(row.year2026?.total))}</strong>
                  <small>${Number(row.year2026?.confirmedCount || 0).toLocaleString()}건 · 건당 ${escapeHtml(formatRevenueStat(row.year2026?.bookingAverage))}</small>
                  ${comparisonMonthCaution(row.month, 2026)}
                  ${amountBreakdownSmall(row.year2026)}
                </td>
                <td class="${signedClass(row.revenueDiff)}">
                  ${escapeHtml(formatSignedWon(row.revenueDiff))}
                  <small>${escapeHtml(formatSignedPercent(row.revenueRate))}</small>
                </td>
                <td class="${signedClass(row.countDiff)}">
                  ${escapeHtml(formatSignedCount(row.countDiff))}
                  <small>${escapeHtml(formatSignedPercent(row.countRate))}</small>
                </td>
                <td class="${signedClass(row.bookingAverageDiff)}">${escapeHtml(formatSignedWon(row.bookingAverageDiff))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function revenueComparisonHtml(comparison) {
    const yearRows = comparison.yearSummary || [];
    const periodRows = comparison.periodAnalysis || [];
    const priceRows = comparison.pricePolicy?.rows || [];
    const priceHistory = comparison.pricePolicy?.history || [];
    const beExperiment = comparison.experiments?.beWeekdayDay || null;
    return `
      <section class="revenue-section">
        <div class="revenue-section-heading">
          <h3>시간단가/대관량 영향 비교</h3>
          <p>실제 DB 원장 매출을 시간단가 변화와 대관시간 변화로 나눠 본 참고값입니다. 순수 가격표 효과만 분리한 값은 아닙니다.</p>
        </div>
        <div class="impact-grid">
          ${periodRows.map(periodImpactCardHtml).join("")}
        </div>
      </section>
      <section class="revenue-section">
        <div class="revenue-section-heading">
          <h3>연도 총합</h3>
          <p>DB 원장 매출 기준 · 취소건 제외 · 현금/수기 복구분 포함 · 기간 보정 전 전체 합계</p>
        </div>
        <div class="year-summary-strip">
          ${yearRows.map((item) => `
            <article class="year-mini-card">
              <span>${escapeHtml(String(item.year))}년</span>
              <strong>${escapeHtml(formatRevenueStat(item.total))}</strong>
              <small>${Number(item.confirmedCount || 0).toLocaleString()}건 · ${formatHours(item.hours)} · 시간당 ${escapeHtml(formatRevenueStat(item.hourAverage))}</small>
              ${amountBreakdownSmall(item)}
            </article>
          `).join("")}
        </div>
      </section>
      ${beExperiment ? beExperimentHtml(beExperiment) : ""}
      <section class="revenue-section">
        <div class="revenue-section-heading">
          <h3>가격 변동</h3>
          <p>${escapeHtml(comparison.pricePolicy?.basis || "네이버 기본가 기준")}</p>
        </div>
        <div class="comparison-table-wrap">
          <table class="comparison-table price-table">
            <thead>
              <tr>
                <th>방</th>
                <th>평일 낮</th>
                <th>16시 이후/주말/공휴일</th>
                <th>새벽 통대관</th>
              </tr>
            </thead>
            <tbody>
              ${priceRows.map((row) => `
                <tr>
                  <th>${escapeHtml(row.roomLabel)}</th>
                  ${["before16", "after16", "overnight"].map((key) => priceChangeCellHtml(row.prices?.[key])).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        ${priceHistory.length ? priceHistoryHtml(priceHistory) : ""}
      </section>
    `;
  }

  function beExperimentHtml(item) {
    const before = item.before || {};
    const after = item.after || {};
    const lastYear = item.lastYearSame || {};
    const breakEven = item.breakEven || {};
    return `
      <section class="revenue-section">
        <div class="revenue-section-heading">
          <h3>B/E 평일 낮 8,000원 추적</h3>
          <p>${escapeHtml(item.basis || "B/E 평일 낮 가격 테스트입니다.")}</p>
        </div>
        <div class="experiment-grid">
          ${experimentMetricCard("변경 전 기준", before)}
          ${experimentMetricCard("변경 후 현재", after)}
          ${experimentMetricCard("작년 같은 기간", lastYear)}
          <article class="experiment-card ${Number(breakEven.grossDiffVsBeforePace || 0) >= 0 ? "positive-card" : "watch-card"}">
            <span>손익분기</span>
            <strong>${escapeHtml(formatPercent(breakEven.progressRate))}</strong>
            <small>필요 ${escapeHtml(formatHours(breakEven.requiredHours))} / 현재 ${escapeHtml(formatHours(breakEven.actualHours))}</small>
            <small class="${signedClass(breakEven.grossDiffVsBeforePace)}">전 기준 환산 ${escapeHtml(formatSignedWon(breakEven.grossDiffVsBeforePace))}</small>
            <b>${escapeHtml(breakEven.verdict || "추적 중")}</b>
          </article>
        </div>
      </section>
    `;
  }

  function experimentMetricCard(label, row) {
    return `
      <article class="experiment-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(formatRevenueStat(row.gross))}</strong>
        <small>${escapeHtml(compactDateRange(`${row.startDate || ""}~${row.endDate || ""}`))}</small>
        <small>${Number(row.count || 0).toLocaleString()}건 · ${escapeHtml(formatHours(row.hours))} · 시간당 ${escapeHtml(formatRevenueStat(row.hourAverage))}</small>
        ${Number(row.net || 0) || Number(row.fee || 0) ? `<small>정산 ${escapeHtml(formatRevenueStat(row.net))} · 수수료 ${escapeHtml(formatRevenueStat(row.fee))}</small>` : ""}
      </article>
    `;
  }

  function priceHistoryHtml(rows) {
    const byDate = rows.reduce((map, row) => {
      const key = row.effectiveDate || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
      return map;
    }, new Map());
    return `
      <div class="price-history-wrap">
        <h4>가격 변경 이력</h4>
        <div class="price-history-list">
          ${Array.from(byDate.entries()).map(([date, items]) => `
            <article class="price-history-card">
              <header>
                <strong>${escapeHtml(date)}</strong>
                <span>${escapeHtml(priceHistoryNotes(items))}</span>
              </header>
              <div class="price-history-rooms">
                ${items.map(priceHistoryRoomHtml).join("")}
              </div>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  function priceHistoryNotes(items) {
    return [...new Set((items || []).map((item) => item.note).filter(Boolean))].join(" / ");
  }

  function priceHistoryRoomHtml(row) {
    const changed = Boolean(row.hasChangedPrice);
    return `
      <div class="price-history-room ${changed ? "changed" : "baseline"}">
        <b>${escapeHtml(row.roomLabel || "")}</b>
        <div class="price-history-bands">
          ${priceHistoryBandHtml(row, "dawnHourly", "새벽")}
          ${priceHistoryBandHtml(row, "weekdayDay", "낮")}
          ${priceHistoryBandHtml(row, "afterHourly", "저녁")}
          ${priceHistoryBandHtml(row, "overnight", "통")}
        </div>
      </div>
    `;
  }

  function priceHistoryBandHtml(row, key, label) {
    const change = row.changes?.[key] || {};
    const before = Number(change.before || 0);
    const after = Number(change.after ?? row[key] ?? 0);
    const changed = Boolean(change.changed);
    const value = changed
      ? `${formatRevenueStat(before)}→${formatRevenueStat(after)}`
      : formatRevenueStat(after);
    return `
      <span class="price-history-band ${changed ? "changed" : ""}">
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
      </span>
    `;
  }

  function periodImpactCardHtml(period) {
    const rows = period.rows || [];
    const total = rows.find((row) => row.key === "all") || rows[0] || {};
    return `
      <article class="impact-card">
        <header class="impact-card-header">
          <div>
            <h4>${escapeHtml(period.label || "")}</h4>
            <p>${escapeHtml(compactDateRange(period.baseRange))} → ${escapeHtml(compactDateRange(period.compareRange))}</p>
          </div>
          <div class="impact-total ${signedClass(total.revenueDiff)}">
            <span>전체 매출</span>
            <strong>${escapeHtml(formatSignedWon(total.revenueDiff))}</strong>
            <small>${escapeHtml(formatSignedPercent(total.revenueRate))}</small>
          </div>
        </header>
        <div class="impact-table-wrap">
          <table class="impact-table">
            <thead>
              <tr>
                <th>방</th>
                <th>예약수</th>
                <th>대관시간</th>
                <th>매출</th>
                <th>시간단가</th>
                <th>시간단가효과</th>
                <th>대관량효과</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(impactRowHtml).join("")}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function amountBreakdownSmall(item) {
    if (!item) return "";
    const net = Number(item.netTotal || 0);
    const fee = Number(item.feeTotal || 0);
    if (!net && !fee) return "";
    return `<small>정산 ${escapeHtml(formatRevenueStat(net))}${fee ? ` · 수수료 ${escapeHtml(formatRevenueStat(fee))}` : ""}</small>`;
  }

  function amountBreakdownLine(net, fee, missing = 0) {
    const parts = [];
    if (Number(net || 0) > 0) parts.push(`정산 ${formatRevenueStat(net)}`);
    if (Number(fee || 0) > 0) parts.push(`수수료 ${formatRevenueStat(fee)}`);
    if (Number(missing || 0) > 0) parts.push(`미수집 ${Number(missing).toLocaleString()}건`);
    return parts.join(" · ");
  }

  function impactRowHtml(row) {
    const isTotal = row.key === "all";
    return `
      <tr class="${isTotal ? "impact-total-row" : ""}">
        <th>${escapeHtml(row.label || "")}</th>
        <td class="${signedClass(row.countDiff)}">${escapeHtml(formatSignedCount(row.countDiff))}<small>${escapeHtml(formatSignedPercent(row.countRate))}</small></td>
        <td class="${signedClass(row.hoursDiff)}">${escapeHtml(formatSignedHours(row.hoursDiff))}<small>${escapeHtml(formatSignedPercent(row.hoursRate))}</small></td>
        <td class="${signedClass(row.revenueDiff)}">${escapeHtml(formatSignedWon(row.revenueDiff))}<small>${escapeHtml(formatSignedPercent(row.revenueRate))}</small></td>
        <td class="${signedClass(row.hourAverageDiff)}">${escapeHtml(formatSignedWon(row.hourAverageDiff))}<small>${escapeHtml(formatSignedPercent(row.hourAverageRate))}</small></td>
        <td class="${signedClass(row.priceEffect)}">${escapeHtml(formatSignedWon(row.priceEffect))}</td>
        <td class="${signedClass(row.volumeEffect)}">${escapeHtml(formatSignedWon(row.volumeEffect))}</td>
        <td><span class="impact-badge ${escapeHtml(row.assessmentKey || "flat")}">${escapeHtml(row.assessmentLabel || "")}</span></td>
      </tr>
    `;
  }

  function compactDateRange(rangeText) {
    return String(rangeText || "").replace(/2025-|2026-/g, "").replace(/\s*~\s*/g, "~");
  }

  function priceChangeCellHtml(item) {
    const diff = Number(item?.diff || 0);
    return `
      <td>
        <strong>${escapeHtml(formatRevenueStat(item?.before))} → ${escapeHtml(formatRevenueStat(item?.after))}</strong>
        <small class="${signedClass(diff)}">${escapeHtml(formatSignedWon(diff))} · ${escapeHtml(formatSignedPercent(item?.rate))}</small>
      </td>
    `;
  }

  function formatHours(value) {
    const amount = Number(value || 0);
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })}시간`;
  }

  function formatSignedWon(value) {
    const amount = Number(value || 0);
    const prefix = amount > 0 ? "+" : "";
    return `${prefix}${amount.toLocaleString()}원`;
  }

  function formatSignedCount(value) {
    const amount = Number(value || 0);
    const prefix = amount > 0 ? "+" : "";
    return `${prefix}${amount.toLocaleString()}건`;
  }

  function formatSignedHours(value) {
    const amount = Number(value || 0);
    const prefix = amount > 0 ? "+" : "";
    return `${prefix}${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })}시간`;
  }

  function formatPercent(value) {
    return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }

  function formatSignedPercent(value) {
    const amount = Number(value || 0);
    const prefix = amount > 0 ? "+" : "";
    return `${prefix}${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  }

  function signedClass(value) {
    const amount = Number(value || 0);
    if (amount > 0) return "positive";
    if (amount < 0) return "negative";
    return "neutral";
  }

  function formatMonthLabel(monthKey) {
    const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return monthKey || "";
    return `${Number(match[2])}월`;
  }

  function resetForm(room, start, end) {
    el.form.reset();
    el.roomInput.value = room;
    el.startInput.value = String(start);
    el.endInput.value = String(end);
    updateModalSlotSummary();
  }

  function openReservationModal() {
    updateModalSlotSummary();
    el.reservationModal.hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => {
      el.form.querySelector("input, select, button")?.focus();
      el.nameInput.focus();
    }, 0);
  }

  function closeReservationModal() {
    el.reservationModal.hidden = true;
    updateModalOpenState();
  }

  async function openDayScheduleModal(date) {
    state.dayModalDate = date;
    const visibleRooms = state.roomFilter === "all" ? rooms : [state.roomFilter];
    let events = date === state.activeDate ? state.drafts : [];
    if (date !== state.activeDate && adminToken()) {
      try {
        const data = await apiRequest("day_reservations", { date });
        events = (data.reservations || []).map(reservationItemFromApi);
      } catch (error) {
        showToast(error.message || "일간 일정 조회 실패");
      }
    }
    state.dayModalEvents = events;
    const revenue = events.reduce((total, item) => total + eventGrossAmount(item), 0);
    const missing = events.filter((item) => !eventGrossAmount(item)).length;
    el.dayScheduleTitle.textContent = `${date} ${weekdayText(date)} 일간 일정`;
    el.dayScheduleSummary.textContent = `${events.length}건 · ${revenue > 0 ? formatWon(revenue) : "금액 없음"}${missing ? ` · 금액 미수집 ${missing}건` : ""}`;
    renderScheduleGrid(el.dayScheduleGrid, date, events, visibleRooms, { slotMode: "view" });
    el.dayScheduleModal.hidden = false;
    document.body.classList.add("modal-open");
    window.requestAnimationFrame(() => {
      updateScheduleGridCurrentTime(el.dayScheduleGrid, date);
    });
    window.setTimeout(() => {
      el.doneDayScheduleModal.focus();
    }, 0);
  }

  function closeDayScheduleModal() {
    el.dayScheduleModal.hidden = true;
    updateModalOpenState();
  }

  function openEventDetailModal(events, summary) {
    const detailDate = events?.[0]?.date || state.dayModalDate || state.activeDate;
    state.eventDetailEvents = Array.isArray(events) ? events : [];
    el.eventDetailSummary.textContent = `${detailDate} ${summary}`;
    el.eventDetailList.innerHTML = events.map(eventDetailCardHtml).join("");
    const cancelable = state.eventDetailEvents.length === 1
      && state.eventDetailEvents[0].source === "admin"
      && state.eventDetailEvents[0].date >= today()
      && !["canceled", "canceling"].includes(state.eventDetailEvents[0].status);
    el.cancelAdminReservation.hidden = !cancelable;
    el.eventDetailModal.hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => {
      el.doneEventDetailModal.focus();
    }, 0);
  }

  function closeEventDetailModal() {
    el.eventDetailModal.hidden = true;
    state.eventDetailEvents = [];
    el.cancelAdminReservation.hidden = true;
    updateModalOpenState();
  }

  function openRevenueModal() {
    renderRevenueModal();
    el.revenueModal.hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => {
      const body = el.revenueModal.querySelector(".modal-body");
      const panel = el.revenueModal.querySelector(".modal-panel");
      if (body) body.scrollTop = 0;
      if (panel) panel.focus();
    }, 0);
  }

  function closeRevenueModal() {
    el.revenueModal.hidden = true;
    updateModalOpenState();
  }

  function updateModalOpenState() {
    document.body.classList.toggle(
      "modal-open",
      !el.reservationModal.hidden || !el.dayScheduleModal.hidden || !el.eventDetailModal.hidden || !el.revenueModal.hidden
        || !el.recurringModal.hidden || !el.seriesModal.hidden,
    );
  }

  function updateModalSlotSummary() {
    const room = el.roomInput.value || "A";
    const start = Number(el.startInput.value || 19);
    const end = Number(el.endInput.value || Math.min(24, start + 1));
    el.modalSlotSummary.textContent = `${state.activeDate} ${room}홀 ${formatHour(start)}-${formatHour(end)}`;
  }

  function reservationItemFromApi(item) {
    return {
      id: `db-${item.id}`,
      dbId: item.id,
      seriesId: item.seriesId || null,
      createdAt: item.createdAt,
      date: item.date,
      room: item.room,
      start: Number(item.startHour),
      end: Number(item.endHour),
      name: item.name,
      phone: item.phoneMasked || "",
      memo: item.memo || "",
      source: item.source || "",
      sourceLabel: item.sourceLabel || "",
      reservationNo: item.reservationNo || "",
      product: item.product || "",
      paymentStatus: item.paymentStatus || "",
      price: item.price || "",
      grossAmount: Number(item.grossAmount || 0),
      netAmount: Number(item.netAmount || 0),
      feeAmount: Number(item.feeAmount || 0),
      amountSource: item.amountSource || "",
      paymentMethod: item.paymentMethod || "",
      status: item.status || "pending",
      naver: item.naverStatus || "pending",
      spacecloud: item.spacecloudStatus || "pending",
    };
  }

  function initializeRecurringForm() {
    el.recurringStartDate.value = today();
    setRecurringPeriodMonths(1);
    el.recurringRules.innerHTML = "";
    addRecurringRule({ weekday: 1, room: "A", start: 13, end: 15 });
  }

  function inclusivePeriodEnd(startText, months) {
    const parts = String(startText || today()).split("-").map(Number);
    const targetYear = parts[0];
    const targetMonth = parts[1] - 1 + months;
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    const clippedAtMonthEnd = parts[2] > lastDay;
    const target = new Date(targetYear, targetMonth, Math.min(parts[2], lastDay));
    if (!clippedAtMonthEnd) target.setDate(target.getDate() - 1);
    return toDateInputValue(target);
  }

  function setRecurringPeriodMonths(months) {
    const start = el.recurringStartDate.value || today();
    el.recurringStartDate.value = start;
    el.recurringEndDate.value = inclusivePeriodEnd(start, Math.max(1, Math.min(12, months || 1)));
    resetRecurringPreview();
  }

  function recurringHourOptions(selected, endMode = false) {
    const first = endMode ? 1 : 0;
    const last = endMode ? 24 : 23;
    return Array.from({ length: last - first + 1 }, (_, index) => index + first)
      .map((hour) => `<option value="${hour}"${Number(selected) === hour ? " selected" : ""}>${escapeHtml(formatHour(hour))}</option>`)
      .join("");
  }

  function addRecurringRule(initial = {}) {
    const row = document.createElement("div");
    const ruleCount = el.recurringRules.querySelectorAll(".recurring-rule").length;
    const weekday = Number(initial.weekday || Math.min(7, ruleCount + 1));
    const room = initial.room || "A";
    const start = Number(initial.start ?? 13);
    const end = Number(initial.end ?? Math.min(24, start + 2));
    row.className = "recurring-rule";
    row.draggable = false;
    row.innerHTML = `
      <label><span>요일</span><select data-rule-weekday>
        ${[[1, "월"], [2, "화"], [3, "수"], [4, "목"], [5, "금"], [6, "토"], [7, "일"]]
          .map(([value, label]) => `<option value="${value}"${weekday === value ? " selected" : ""}>${label}요일</option>`).join("")}
      </select></label>
      <label><span>홀</span><select data-rule-room>
        ${rooms.map((value) => `<option value="${value}"${room === value ? " selected" : ""}>${value}홀</option>`).join("")}
      </select></label>
      <label><span>시작</span><select data-rule-start>${recurringHourOptions(start)}</select></label>
      <label><span>종료</span><select data-rule-end>${recurringHourOptions(end, true)}</select></label>
      <button type="button" class="danger-button" data-remove-rule>삭제</button>
    `;
    row.querySelector("[data-remove-rule]").addEventListener("click", () => {
      if (el.recurringRules.querySelectorAll(".recurring-rule").length <= 1) {
        showToast("요일 규칙은 하나 이상 필요합니다.");
        return;
      }
      row.remove();
      resetRecurringPreview();
    });
    row.querySelectorAll("select").forEach((select) => select.addEventListener("change", resetRecurringPreview));
    el.recurringRules.appendChild(row);
    resetRecurringPreview();
  }

  function recurringRulesPayload() {
    return Array.from(el.recurringRules.querySelectorAll(".recurring-rule")).map((row) => ({
      weekday: Number(row.querySelector("[data-rule-weekday]").value),
      room: row.querySelector("[data-rule-room]").value,
      start: Number(row.querySelector("[data-rule-start]").value),
      end: Number(row.querySelector("[data-rule-end]").value),
    }));
  }

  function recurringBasePayload() {
    return {
      title: el.recurringTitle.value.trim(),
      name: el.recurringName.value.trim(),
      phone: el.recurringPhone.value.trim(),
      memo: el.recurringMemo.value.trim(),
      startDate: el.recurringStartDate.value,
      endDate: el.recurringEndDate.value,
      fifthWeekPolicy: el.recurringFifthPolicy.value,
      rules: recurringRulesPayload(),
    };
  }

  function openRecurringModal() {
    if (!el.recurringStartDate.value) initializeRecurringForm();
    el.recurringModal.hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => el.recurringTitle.focus(), 0);
  }

  function closeRecurringModal() {
    el.recurringModal.hidden = true;
    updateModalOpenState();
  }

  function resetRecurringPreview() {
    state.recurringPreview = null;
    state.selectedOccurrenceKey = "";
    state.recurringRequestId = "";
    el.recurringPreview.hidden = true;
    el.occurrenceEditor.hidden = true;
    el.createRecurring.disabled = true;
  }

  async function previewRecurringSchedule(options = {}) {
    if (!adminToken()) {
      showToast("DB 관리자 연결이 필요합니다.");
      return;
    }
    const payload = recurringBasePayload();
    if (!payload.startDate || !payload.endDate || !payload.rules.length) {
      showToast("기간과 요일 규칙을 입력해주세요.");
      return;
    }
    if (options.useCurrent && state.recurringPreview?.occurrences) {
      payload.occurrences = state.recurringPreview.occurrences.map((row) => ({
        key: row.key,
        originalDate: row.originalDate,
        date: row.date,
        ruleIndex: row.ruleIndex,
        room: row.room,
        start: row.start,
        end: row.end,
        included: row.included,
        excludedReason: row.excludedReason,
        modified: row.modified,
      }));
    }
    el.previewRecurring.disabled = true;
    el.previewRecurring.textContent = "충돌 검사 중…";
    try {
      const previous = new Map((state.recurringPreview?.occurrences || []).map((row) => [row.key, row]));
      const data = await apiRequest("preview_recurring", payload);
      data.occurrences = (data.occurrences || []).map((row) => {
        const old = previous.get(row.key);
        return {
          ...row,
          baseDate: old?.baseDate || row.originalDate || row.date,
          baseRoom: old?.baseRoom || row.room,
          baseStart: old?.baseStart ?? row.start,
          baseEnd: old?.baseEnd ?? row.end,
          baseIncluded: old?.baseIncluded ?? row.included,
        };
      });
      state.recurringPreview = data;
      state.selectedOccurrenceKey = options.selectKey || state.selectedOccurrenceKey || "";
      if (!state.recurringRequestId) {
        state.recurringRequestId = window.crypto?.randomUUID?.() || `series-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      renderRecurringPreview();
      el.recurringPreview.hidden = false;
      el.recurringPreview.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      showToast(error.message || "정기대관 미리보기 실패");
    } finally {
      el.previewRecurring.disabled = false;
      el.previewRecurring.textContent = "12개월 미리보기·충돌 검사";
    }
  }

  function renderRecurringPreview() {
    const preview = state.recurringPreview;
    if (!preview) return;
    const summary = preview.summary || {};
    el.recurringPreviewSummary.innerHTML = [
      ["전체", summary.total],
      ["등록 예정", summary.included],
      ["충돌", summary.conflicts],
      ["제외", summary.excluded],
      ["부분 변경", summary.modified],
    ].map(([label, value]) => `<div class="recurring-summary-item"><span>${label}</span><strong>${Number(value || 0).toLocaleString()}건</strong></div>`).join("");
    renderRecurringYear();
    renderRecurringIssues();
    renderOccurrenceEditor();
    el.createRecurring.disabled = Number(summary.included || 0) < 1 || Number(summary.conflicts || 0) > 0;
    el.createRecurring.textContent = Number(summary.conflicts || 0) > 0
      ? `충돌 ${Number(summary.conflicts)}건 해결 필요`
      : `${Number(summary.included || 0)}건 등록`;
  }

  function occurrenceVisualStatus(rows) {
    if (rows.some((row) => row.status === "conflict")) return "conflict";
    if (rows.every((row) => !row.included)) return "excluded";
    if (rows.some((row) => row.modified)) return "modified";
    return "ready";
  }

  function recurringMonths() {
    const preview = state.recurringPreview;
    if (!preview) return [];
    const start = new Date(`${preview.startDate.slice(0, 7)}-01T00:00:00`);
    const end = new Date(`${preview.endDate.slice(0, 7)}-01T00:00:00`);
    const months = [];
    const cursor = new Date(start);
    while (cursor <= end && months.length < 13) {
      months.push(`${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }

  function renderRecurringYear() {
    const occurrenceMap = new Map();
    (state.recurringPreview?.occurrences || []).forEach((row) => {
      const list = occurrenceMap.get(row.date) || [];
      list.push(row);
      occurrenceMap.set(row.date, list);
    });
    el.recurringYear.innerHTML = "";
    recurringMonths().forEach((monthKey) => {
      const first = new Date(`${monthKey}-01T00:00:00`);
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const card = document.createElement("section");
      card.className = "recurring-mini-month";
      const weekdays = ["일", "월", "화", "수", "목", "금", "토"]
        .map((label) => `<span class="recurring-mini-weekday">${label}</span>`).join("");
      card.innerHTML = `<h4>${first.getFullYear()}년 ${first.getMonth() + 1}월</h4><div class="recurring-mini-grid">${weekdays}</div>`;
      const grid = card.querySelector(".recurring-mini-grid");
      for (let empty = 0; empty < first.getDay(); empty += 1) {
        grid.insertAdjacentHTML("beforeend", '<span class="recurring-mini-day"></span>');
      }
      for (let day = 1; day <= days; day += 1) {
        const date = `${monthKey}-${pad2(day)}`;
        const rows = occurrenceMap.get(date) || [];
        const button = document.createElement(rows.length ? "button" : "span");
        button.className = "recurring-mini-day";
        button.textContent = String(day);
        if (rows.length) {
          const status = occurrenceVisualStatus(rows);
          button.type = "button";
          button.draggable = false;
          button.classList.add("has-occurrence", status);
          if (rows.some((row) => row.key === state.selectedOccurrenceKey)) button.classList.add("selected");
          button.title = rows.map((row) => `${row.room}홀 ${formatHour(row.start)}-${formatHour(row.end)} ${occurrenceStatusText(row)}`).join("\n");
          button.addEventListener("click", () => selectRecurringOccurrence(rows[0].key));
        }
        grid.appendChild(button);
      }
      el.recurringYear.appendChild(card);
    });
  }

  function occurrenceStatusText(row) {
    if (!row.included) return row.excludedReason === "fifth_week" ? "5주차 제외" : "수동 제외";
    if (row.status === "conflict") return `충돌 ${row.conflicts?.length || 1}건`;
    if (row.modified) return "부분 변경";
    return "등록 예정";
  }

  function renderRecurringIssues() {
    const rows = (state.recurringPreview?.occurrences || []).filter((row) => (
      row.status === "conflict" || !row.included || row.modified
    ));
    if (!rows.length) {
      el.recurringIssueList.innerHTML = '<p class="empty-note">처리할 충돌·예외가 없습니다.</p>';
      return;
    }
    el.recurringIssueList.innerHTML = "";
    rows.forEach((row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.draggable = false;
      button.className = `recurring-issue-button ${row.status}`;
      const conflict = row.conflicts?.[0];
      button.innerHTML = `
        <strong>${escapeHtml(row.date)} · ${escapeHtml(row.room)}홀 ${escapeHtml(formatHour(row.start))}-${escapeHtml(formatHour(row.end))}</strong>
        <span>${escapeHtml(conflict ? `${conflict.sourceLabel} ${conflict.start}:00-${conflict.end}:00와 충돌` : occurrenceStatusText(row))}</span>
      `;
      button.addEventListener("click", () => selectRecurringOccurrence(row.key));
      el.recurringIssueList.appendChild(button);
    });
  }

  function selectRecurringOccurrence(key) {
    state.selectedOccurrenceKey = key;
    renderRecurringPreview();
    el.occurrenceEditor.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderOccurrenceEditor() {
    const row = (state.recurringPreview?.occurrences || []).find((item) => item.key === state.selectedOccurrenceKey);
    if (!row) {
      el.occurrenceEditor.hidden = true;
      return;
    }
    el.occurrenceEditor.hidden = false;
    el.occurrenceEditor.innerHTML = `
      <div class="occurrence-editor-grid">
        <label><span>날짜</span><input type="date" data-occurrence-date value="${escapeHtml(row.date)}"></label>
        <label><span>홀</span><select data-occurrence-room>${rooms.map((room) => `<option value="${room}"${row.room === room ? " selected" : ""}>${room}홀</option>`).join("")}</select></label>
        <label><span>시작</span><select data-occurrence-start>${recurringHourOptions(row.start)}</select></label>
        <label><span>종료</span><select data-occurrence-end>${recurringHourOptions(row.end, true)}</select></label>
        <button type="button" class="primary-button" data-save-occurrence>변경 후 재검사</button>
      </div>
      <label class="occurrence-include"><input type="checkbox" data-occurrence-included${row.included ? " checked" : ""}> 이 날짜를 정기대관에 포함</label>
      ${row.conflicts?.length ? `<p class="occurrence-conflict-note">${row.conflicts.map((item) => `${escapeHtml(item.sourceLabel)} ${escapeHtml(item.room)}홀 ${escapeHtml(formatHour(item.start))}-${escapeHtml(formatHour(item.end))} ${escapeHtml(item.name || "")}`).join("<br>")}</p>` : ""}
    `;
    el.occurrenceEditor.querySelector("[data-save-occurrence]").addEventListener("click", saveOccurrenceOverride);
  }

  async function saveOccurrenceOverride() {
    const row = (state.recurringPreview?.occurrences || []).find((item) => item.key === state.selectedOccurrenceKey);
    if (!row) return;
    row.date = el.occurrenceEditor.querySelector("[data-occurrence-date]").value;
    row.room = el.occurrenceEditor.querySelector("[data-occurrence-room]").value;
    row.start = Number(el.occurrenceEditor.querySelector("[data-occurrence-start]").value);
    row.end = Number(el.occurrenceEditor.querySelector("[data-occurrence-end]").value);
    row.included = el.occurrenceEditor.querySelector("[data-occurrence-included]").checked;
    row.excludedReason = row.included ? "" : "manual";
    row.modified = row.date !== row.baseDate || row.room !== row.baseRoom || row.start !== row.baseStart
      || row.end !== row.baseEnd || row.included !== row.baseIncluded;
    await previewRecurringSchedule({ useCurrent: true, selectKey: row.key });
  }

  async function createRecurringSchedule(event) {
    event.preventDefault();
    const preview = state.recurringPreview;
    if (!preview || Number(preview.summary?.conflicts || 0) > 0) {
      showToast("충돌을 모두 해결한 뒤 등록해주세요.");
      return;
    }
    const count = Number(preview.summary?.included || 0);
    if (!window.confirm(`${count}건을 DB 원장에 등록하고 두 플랫폼 반영 작업을 만들까요?`)) return;
    el.createRecurring.disabled = true;
    try {
      const data = await apiRequest("create_recurring", {
        ...recurringBasePayload(),
        requestId: state.recurringRequestId,
        occurrences: preview.occurrences,
        previewHash: preview.previewHash,
      });
      applyApiData(data);
      renderAll();
      closeRecurringModal();
      const created = Number(data.recurringResult?.createdCount || 0);
      showToast(created ? `정기대관 ${created}건을 등록했습니다.` : "이미 처리된 정기대관 요청입니다.");
      el.recurringForm.reset();
      initializeRecurringForm();
    } catch (error) {
      showToast(error.message || "정기대관 등록 실패");
      el.createRecurring.disabled = false;
    }
  }

  function renderSeriesList() {
    if (!el.seriesList) return;
    if (!state.adminSeries.length) {
      el.seriesList.innerHTML = '<p class="empty-note">등록된 정기대관이 없습니다.</p>';
      return;
    }
    el.seriesList.innerHTML = "";
    state.adminSeries.forEach((series) => {
      const card = document.createElement("article");
      card.className = "series-card";
      card.innerHTML = `
        <div class="series-card-head"><h3>${escapeHtml(series.title || series.name || "정기대관")}</h3><span class="series-card-status ${escapeHtml(series.status)}">${escapeHtml(seriesStatusText(series.status))}</span></div>
        <p>${escapeHtml(series.startDate)} ~ ${escapeHtml(series.endDate)} · 5주차 ${series.fifthWeekPolicy === "exclude" ? "제외" : "포함"}</p>
        <div class="series-card-meta"><span>현재 ${Number(series.visibleCount || 0)}건</span><span>취소 ${Number(series.canceledCount || 0)}건</span></div>
        <div class="series-card-actions"><span>${escapeHtml(series.name || "")}</span><button type="button" class="secondary-button compact-button">일정 관리</button></div>
      `;
      const button = card.querySelector("button");
      button.draggable = false;
      button.addEventListener("click", () => openSeriesModal(series.id));
      el.seriesList.appendChild(card);
    });
  }

  function seriesStatusText(status) {
    if (status === "canceling") return "취소 처리 중";
    if (status === "canceled") return "취소 완료";
    return "운영 중";
  }

  async function openSeriesModal(seriesId) {
    const series = state.adminSeries.find((item) => Number(item.id) === Number(seriesId));
    if (!series) return;
    try {
      const data = await apiRequest("series_occurrences", { seriesId });
      state.selectedSeries = series;
      state.seriesOccurrences = data.occurrences || [];
      el.seriesModalTitle.textContent = series.title || "정기대관 관리";
      el.seriesModalSummary.textContent = `${series.startDate} ~ ${series.endDate} · 총 ${series.occurrenceCount}건 · 지난 일정은 이력 보존`;
      el.selectAllSeriesOccurrences.checked = false;
      renderSeriesOccurrences();
      el.seriesModal.hidden = false;
      document.body.classList.add("modal-open");
    } catch (error) {
      showToast(error.message || "정기대관 일정 조회 실패");
    }
  }

  function closeSeriesModal() {
    el.seriesModal.hidden = true;
    state.selectedSeries = null;
    state.seriesOccurrences = [];
    updateModalOpenState();
  }

  function renderSeriesOccurrences() {
    el.seriesOccurrenceList.innerHTML = "";
    state.seriesOccurrences.forEach((row) => {
      const label = document.createElement("label");
      const isPast = row.date < today();
      label.className = `series-occurrence-row ${row.status || ""}${isPast ? " past" : ""}`;
      const disabled = isPast || ["canceled", "canceling"].includes(row.status);
      label.innerHTML = `
        <input type="checkbox" data-series-occurrence-id="${Number(row.id)}"${disabled ? " disabled" : ""}>
        <strong>${escapeHtml(row.date)} ${escapeHtml(weekdayShortText(row.date))}</strong>
        <span>${escapeHtml(row.room)}홀</span>
        <span>${escapeHtml(formatHour(row.start))}-${escapeHtml(formatHour(row.end))}</span>
        <span>${escapeHtml(isPast ? "지난 일정 · 이력 보존" : adminReservationStatusText(row.status))}</span>
      `;
      label.querySelector("input").addEventListener("change", updateSelectedSeriesOccurrenceCount);
      el.seriesOccurrenceList.appendChild(label);
    });
    updateSelectedSeriesOccurrenceCount();
  }

  function adminReservationStatusText(status) {
    if (status === "confirmed") return "반영 완료";
    if (status === "canceling") return "취소 중";
    if (status === "canceled") return "취소 완료";
    return "반영 중";
  }

  function toggleAllSeriesOccurrences() {
    el.seriesOccurrenceList.querySelectorAll("input[type='checkbox']:not(:disabled)").forEach((input) => {
      input.checked = el.selectAllSeriesOccurrences.checked;
    });
    updateSelectedSeriesOccurrenceCount();
  }

  function selectedSeriesOccurrenceIds() {
    return Array.from(el.seriesOccurrenceList.querySelectorAll("input[data-series-occurrence-id]:checked"))
      .map((input) => Number(input.dataset.seriesOccurrenceId));
  }

  function updateSelectedSeriesOccurrenceCount() {
    const count = selectedSeriesOccurrenceIds().length;
    el.selectedSeriesOccurrenceCount.textContent = `${count}건 선택`;
    el.cancelSeriesSelected.disabled = count < 1;
  }

  async function cancelSeriesOccurrences(scope) {
    if (!state.selectedSeries) return;
    const ids = scope === "selected" ? selectedSeriesOccurrenceIds() : [];
    const label = scope === "selected" ? `선택한 미래 일정 ${ids.length}건` : "오늘을 포함한 남은 일정 전부";
    if (scope === "selected" && !ids.length) return;
    if (!window.confirm(`${label}를 취소할까요? 플랫폼 복구 확인 전까지 공개 일정에는 유지됩니다.`)) return;
    try {
      const data = await apiRequest("cancel_admin_reservations", {
        reservationIds: ids,
        seriesId: state.selectedSeries.id,
        scope,
        fromDate: today(),
        date: state.activeDate,
      });
      applyApiData(data);
      renderAll();
      const requested = Number(data.cancelResult?.requestedCount || 0);
      showToast(`${requested}건의 취소·복구 작업을 만들었습니다.`);
      await openSeriesModal(state.selectedSeries.id);
    } catch (error) {
      showToast(error.message || "정기대관 취소 실패");
    }
  }

  async function cancelDetailedAdminReservation() {
    const event = state.eventDetailEvents[0];
    if (!event?.dbId || event.source !== "admin") return;
    if (!window.confirm(`${event.date} ${event.room}홀 ${formatHour(event.start)}-${formatHour(event.end)} 일정을 취소할까요?`)) return;
    try {
      const data = await apiRequest("cancel_admin_reservations", {
        reservationIds: [event.dbId],
        scope: "selected",
        date: state.activeDate,
      });
      applyApiData(data);
      closeEventDetailModal();
      renderAll();
      showToast("취소·복구 작업을 만들었습니다.");
    } catch (error) {
      showToast(error.message || "일정 취소 실패");
    }
  }

  function persistDrafts() {
    localStorage.setItem(storageKey, JSON.stringify(state.drafts));
  }

  function setApiState(level, label, message) {
    state.apiMode = level;
    state.lastApiMessage = message;
    el.apiState.classList.toggle("ready", level === "ready");
    el.apiState.classList.toggle("warn", level === "warn");
    el.apiStatus.textContent = label;
    el.apiState.title = message;
    if (el.adminTokenStatus) {
      el.adminTokenStatus.textContent = level === "ready" ? "DB 연결됨" : (message || label);
    }
  }

  function applyApiData(data) {
    const settings = data.settings || {};
    const sessions = data.sessions || {};
    state.sessions = Object.keys(sessions).reduce((acc, platform) => {
      acc[platform] = {
        readyAt: sessions[platform].ready_at || "",
        status: sessions[platform].status || "",
        note: sessions[platform].note || "",
        lastCheckedAt: sessions[platform].last_checked_at || "",
        updatedAt: sessions[platform].updated_at || "",
      };
      return acc;
    }, {});
    localStorage.setItem(sessionKey, JSON.stringify(state.sessions));

    if (settings.automation_profile) {
      el.profilePath.value = settings.automation_profile;
      localStorage.setItem(profileKey, settings.automation_profile);
    }
    if (data.serverTime) {
      el.lastScan.textContent = formatDateTime(data.serverTime);
    }

    state.revenueStats = data.revenueStats || null;
    state.revenueComparison = data.revenueComparison || null;
    state.industryComparison = data.industryComparison || null;
    if (state.monthSummary && state.monthSummary.month !== selectedMonthKey()) {
      state.monthSummary = null;
    }

    state.drafts = (data.reservations || []).map(reservationItemFromApi);
    state.adminSeries = data.adminSeries || [];
    state.reflectionAudits = data.reflectionAudits || [];
    state.reflectionAuditSummary = data.reflectionAuditSummary || null;
    applyAdminAlertData(data);
    state.tasks = annotateTaskRelations((data.tasks || []).map((item) => ({
      id: item.id,
      liveTaskId: item.liveTaskId || "",
      sourceTaskId: item.sourceTaskId || "",
      taskType: item.taskType || "",
      actionLabel: item.actionLabel || "",
      status: item.status || "pending",
      resultStatus: item.resultStatus || "",
      smsStatus: item.smsStatus || "",
      error: item.error || "",
      conflict: item.conflict || null,
      date: item.date || "",
      room: item.room || "",
      start: Number(item.startHour),
      end: Number(item.endHour),
      name: item.name || "",
      reservationNo: item.reservationNo || "",
      product: item.product || "",
      naver: item.naverStatus || "pending",
      spacecloud: item.spacecloudStatus || "pending",
      createdAt: item.createdAt || "",
      updatedAt: item.updatedAt || "",
    })));
  }

  async function apiRequest(action, payload) {
    const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Rhythmjoy-Admin-Token": adminToken(),
      },
      credentials: "same-origin",
      body: JSON.stringify(Object.assign({ action }, payload || {})),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || `API 오류 ${response.status}`);
    }
    return data;
  }

  function adminToken() {
    return (localStorage.getItem(tokenKey) || el.adminToken?.value || "").trim();
  }

  function syncTokenFromUrl() {
    const hash = window.location.hash || "";
    const params = new URLSearchParams(window.location.search || "");
    const tokenFromHash = hash.startsWith("#token=") ? decodeURIComponent(hash.slice(7)) : "";
    const tokenFromQuery = params.get("token") || "";
    const token = (tokenFromHash || tokenFromQuery).trim();
    if (!token) return;
    localStorage.setItem(tokenKey, token);
    window.history.replaceState(null, document.title, window.location.pathname);
  }

  function cell(text, className) {
    const node = document.createElement("div");
    node.className = `grid-cell ${className}`;
    node.textContent = text;
    node.draggable = false;
    return node;
  }

  function option(value, label) {
    const node = document.createElement("option");
    node.value = String(value);
    node.textContent = label;
    return node;
  }

  function today() {
    return toDateInputValue(new Date());
  }

  function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatHour(hour) {
    return `${String(hour).padStart(2, "0")}:00`;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function annotateTaskRelations(tasks) {
    const duplicateCancelBySourceTask = new Map();
    const restoreBySourceTask = new Map();
    const conflictsByWinnerNo = new Map();
    const conflictsBySlot = new Map();
    const taskByLiveTask = new Map();

    tasks.forEach((task) => {
      const liveKey = taskLiveKey(task);
      if (liveKey) {
        taskByLiveTask.set(liveKey, task);
      }
      if (isDuplicateCancelTask(task) && task.sourceTaskId) {
        duplicateCancelBySourceTask.set(String(task.sourceTaskId), task);
      }
      if (task.taskType === "naver_restore" && task.sourceTaskId) {
        restoreBySourceTask.set(String(task.sourceTaskId), task);
      }
      if (!hasConflictTask(task)) return;
      const winnerNo = task.conflict?.winner?.reservationNo || "";
      if (winnerNo) {
        const list = conflictsByWinnerNo.get(winnerNo) || [];
        list.push(task);
        conflictsByWinnerNo.set(winnerNo, list);
      }
      const key = taskConflictSlotKey(task);
      if (key) {
        const list = conflictsBySlot.get(key) || [];
        list.push(task);
        conflictsBySlot.set(key, list);
      }
    });

    const hiddenTasks = new Set();
    const annotated = tasks.map((task) => {
      const relatedConflict = relatedConflictForTask(task, conflictsByWinnerNo, conflictsBySlot, duplicateCancelBySourceTask);
      const relatedCancel = relatedConflict
        ? duplicateCancelBySourceTask.get(String(relatedConflict.liveTaskId || relatedConflict.id))
        : duplicateCancelBySourceTask.get(String(task.liveTaskId || task.id));
      const relatedRestore = relatedConflict
        ? restoreBySourceTask.get(String(relatedConflict.liveTaskId || relatedConflict.id))
        : restoreBySourceTask.get(String(task.liveTaskId || task.id));
      const resolution = buildTaskResolution(task, relatedConflict, relatedCancel, relatedRestore);
      const displayUpdatedAt = latestTimestamp(task.updatedAt, relatedCancel?.updatedAt, relatedRestore?.updatedAt, relatedConflict?.updatedAt);
      return resolution ? { ...task, resolution, displayUpdatedAt } : { ...task, displayUpdatedAt };
    });

    annotated.forEach((task) => {
      if (!isDuplicateCancelTask(task) || !task.sourceTaskId) return;
      const source = taskByLiveTask.get(String(task.sourceTaskId));
      if (source && hasConflictTask(source)) {
        hiddenTasks.add(taskRowKey(task));
      }
    });
    annotated.forEach((task) => {
      if (task.taskType === "naver_restore" && task.sourceTaskId) {
        const source = taskByLiveTask.get(String(task.sourceTaskId));
        if (source && hasConflictTask(source)) {
          hiddenTasks.add(taskRowKey(task));
        }
      }
      if (task.resolution?.sourceConflictTaskId && taskByLiveTask.has(String(task.resolution.sourceConflictTaskId))) {
        hiddenTasks.add(taskRowKey(task));
      }
    });

    return annotated
      .filter((task) => !hiddenTasks.has(taskRowKey(task)))
      .sort((a, b) => String(b.displayUpdatedAt || b.updatedAt || b.createdAt).localeCompare(String(a.displayUpdatedAt || a.updatedAt || a.createdAt)));
  }

  function taskLiveKey(task) {
    return task?.liveTaskId ? String(task.liveTaskId) : "";
  }

  function taskRowKey(task) {
    return `${task?.liveTaskId ? "live" : "row"}:${task?.liveTaskId || task?.id || ""}`;
  }

  function latestTimestamp(...values) {
    return values.filter(Boolean).sort().pop() || "";
  }

  function hasConflictTask(task) {
    return !!(task?.conflict?.winner || task?.conflict?.loser);
  }

  function taskConflictSlotKey(task) {
    const side = task.conflict?.winner || task.conflict?.loser || null;
    if (!side) return "";
    const date = side.date || task.date;
    const room = side.room || task.room;
    const start = Number.isFinite(side.startHour) ? side.startHour : task.start;
    const end = Number.isFinite(side.endHour) ? side.endHour : task.end;
    return `${date}|${room}|${start}|${end}`;
  }

  function taskSlotKey(task) {
    return `${task.date}|${task.room}|${task.start}|${task.end}`;
  }

  function relatedConflictForTask(task, conflictsByWinnerNo, conflictsBySlot, duplicateCancelBySourceTask) {
    if (hasConflictTask(task)) return task;
    if (task.taskType !== "upload" || task.status !== "failed") return null;
    const byReservation = task.reservationNo ? (conflictsByWinnerNo.get(task.reservationNo) || []) : [];
    const candidates = byReservation.length ? byReservation : (conflictsBySlot.get(taskSlotKey(task)) || []);
    if (!candidates.length) return null;
    return candidates.find((candidate) => {
      const relatedCancel = duplicateCancelBySourceTask.get(String(candidate.liveTaskId || candidate.id));
      return relatedCancel && isTaskDone(relatedCancel);
    }) || candidates[0];
  }

  function buildTaskResolution(task, relatedConflict, relatedCancel, relatedRestore) {
    if (isDuplicateCancelTask(task)) {
      return duplicateCancelResolution(task);
    }
    if (hasConflictTask(task)) {
      return conflictDetectionResolution(task, relatedCancel, relatedRestore);
    }
    if (relatedConflict && task.taskType === "upload" && task.status === "failed") {
      return linkedUploadFailureResolution(task, relatedConflict, relatedCancel);
    }
    return null;
  }

  function duplicateCancelResolution(task) {
    if (task.resultStatus === "conflict-cleared-source-requeued") {
      return {
        state: "pending",
        statusLabel: "취소 생략 · 재판정",
        summary: "선예약 상태가 바뀌어 취소하지 않고 원본 반영을 다시 판정합니다.",
        smsStatus: task.smsStatus,
        conflict: task.conflict,
      };
    }
    if (isTaskDone(task)) {
      return {
        state: "resolved",
        statusLabel: task.resultStatus === "already-canceled" ? "이미 취소됨" : "중복취소 완료",
        summary: task.resultStatus === "already-canceled" ? "후예약은 이미 취소된 상태입니다." : "후예약 취소 완료",
        note: task.smsStatus ? `취소문자 ${smsStatusText(task.smsStatus)}` : "",
        smsStatus: task.smsStatus,
        conflict: task.conflict,
      };
    }
    if (task.status === "running") {
      return {
        state: "running",
        statusLabel: "중복취소 진행",
        summary: "후예약 취소 작업 진행 중",
        smsStatus: task.smsStatus,
        conflict: task.conflict,
      };
    }
    if (task.status === "pending") {
      return {
        state: "pending",
        statusLabel: "중복취소 대기",
        summary: "후예약 취소 대기",
        smsStatus: task.smsStatus,
        conflict: task.conflict,
      };
    }
    return {
      state: "attention",
      statusLabel: task.status === "failed" ? "취소 실패" : "취소 확인 필요",
      summary: task.error ? `취소 확인 필요: ${humanTaskError(task.error)}` : "후예약 취소 확인 필요",
      smsStatus: task.smsStatus,
      conflict: task.conflict,
    };
  }

  function linkedUploadFailureResolution(task, relatedConflict, relatedCancel) {
    const cancelState = relatedCancel ? duplicateCancelResolution(relatedCancel) : null;
    const resolved = cancelState?.state === "resolved";
    return {
      state: resolved ? "linked-resolved" : "linked-attention",
      statusLabel: resolved ? "중복처리 연결" : "중복처리 확인",
      summary: resolved
        ? "등록 실패 후 중복처리로 연결됨"
        : "등록 실패 후 후예약 충돌로 연결됨",
      note: resolved
        ? "재시도 성공이 아니라 선예약 유지 후 후예약 취소로 정리됨"
        : "후예약 취소 상태를 확인해야 합니다.",
      relatedTaskId: relatedCancel?.liveTaskId || relatedCancel?.id || relatedConflict?.liveTaskId || relatedConflict?.id || "",
      relatedTaskLabel: cancelState?.statusLabel || taskStatusText(relatedConflict),
      originalError: humanTaskError(task.error),
      smsStatus: cancelState?.smsStatus || "",
      sourceConflictTaskId: relatedConflict.liveTaskId || relatedConflict.id || "",
      conflict: relatedConflict.conflict,
    };
  }

  function conflictDetectionResolution(task, relatedCancel, relatedRestore) {
    if (relatedCancel) {
      const cancelState = duplicateCancelResolution(relatedCancel);
      return {
        state: cancelState.state === "resolved" ? "resolved" : cancelState.state,
        statusLabel: cancelState.state === "resolved" ? "중복처리 완료" : cancelState.statusLabel,
        summary: cancelState.state === "resolved"
          ? "선예약 유지 · 후예약 취소 완료"
          : `후예약 충돌 감지 후 ${cancelState.summary}`,
        note: joinNotes(cancelState.note, restoreTaskNote(relatedRestore)),
        relatedTaskId: relatedCancel.liveTaskId || relatedCancel.id || "",
        relatedTaskLabel: cancelState.statusLabel,
        smsStatus: cancelState.smsStatus,
        conflict: task.conflict,
      };
    }
    if (task.resultStatus === "later-reservation-conflict" || task.status === "needs_review") {
      return {
        state: "attention",
        statusLabel: "취소 확인 필요",
        summary: "후예약 충돌 감지됨",
        note: "연결된 후예약 취소 작업을 찾지 못했습니다.",
        conflict: task.conflict,
      };
    }
    return null;
  }

  function restoreTaskNote(task) {
    if (!task) return "";
    if (task.resultStatus === "restore-skipped-not-owned") return "네이버 선예약 보호";
    if (isTaskDone(task)) return "네이버 복구 완료";
    if (task.status === "running") return "네이버 복구 진행";
    if (task.status === "failed" || task.status === "needs_review") return "네이버 복구 확인 필요";
    return "";
  }

  function joinNotes(...notes) {
    return notes.filter(Boolean).join(" / ");
  }

  function isTaskDone(task) {
    if (task?.resultStatus === "conflict-cleared-source-requeued") return false;
    return task?.status === "done"
      || task?.status === "synced"
      || task?.resultStatus === "canceled"
      || task?.resultStatus === "already-canceled";
  }

  function humanTaskError(error) {
    const text = String(error || "").trim();
    if (!text) return "";
    if (/modal still visible after submit/i.test(text)) return "등록 후 확인창이 닫히지 않음";
    if (/later-reservation-conflict|후예약 충돌/i.test(text)) return "선예약 중복 충돌";
    return text;
  }

  function statusText(status) {
    if (status === "done" || status === "synced") return "완료";
    if (status === "confirmed") return "확정";
    if (status === "running") return "진행";
    if (status === "failed") return "실패";
    if (status === "needs_review") return "확인필요";
    if (status === "canceled") return "취소";
    return "대기";
  }

  function isDuplicateCancelTask(task) {
    return task.taskType === "spacecloud_cancel" || task.taskType === "naver_cancel";
  }

  function taskStatusText(task) {
    if (task.taskType === "naver_restore" && task.resultStatus === "restore-skipped-not-owned") return "복구생략";
    if (task.resolution?.statusLabel) return task.resolution.statusLabel;
    if (isDuplicateCancelTask(task)) {
      if (task.resultStatus === "conflict-cleared-source-requeued") return "취소 생략 · 재판정";
      if (task.status === "done" || task.resultStatus === "canceled") return "중복취소 완료";
      if (task.resultStatus === "already-canceled") return "이미 취소됨";
      if (task.status === "running") return "중복취소 진행";
      if (task.status === "pending") return "중복취소 대기";
      if (task.status === "needs_review") return "취소 확인 필요";
      if (task.status === "failed") return "취소 실패";
      return "중복취소";
    }
    return statusText(task.status);
  }

  function taskBadgeClass(task) {
    if (task.resolution?.state === "resolved" || task.resolution?.state === "linked-resolved") return "done";
    if (task.resolution?.state === "running") return "running";
    if (task.resolution?.state === "pending") return "pending";
    if (task.resolution?.state === "linked-attention" || task.resolution?.state === "attention") return "failed";
    if (task.resultStatus === "conflict-cleared-source-requeued") return "pending";
    if (task.status === "done" || task.status === "synced" || task.resultStatus === "canceled" || task.resultStatus === "already-canceled") return "done";
    if (task.status === "failed" || task.status === "needs_review") return "failed";
    if (task.status === "running") return "running";
    return "pending";
  }

  function taskPlatformText(task, platform) {
    const conflict = task.resolution?.conflict || null;
    if (conflict) {
      if (conflict.winner?.platform === platform) return "확정유지";
      if (conflict.loser?.platform === platform) {
        if (task.resolution?.state === "resolved" || task.resolution?.state === "linked-resolved") return "취소완료";
        if (task.resolution?.state === "running") return "취소중";
        return "취소필요";
      }
    }
    return platformText(task[platform]);
  }

  function taskDetailText(task) {
    const label = task.actionLabel || task.sourceLabel || sourceText(task.source);
    const parts = [label];
    if (isDuplicateCancelTask(task)) {
      parts.push("선대관 중복으로 후예약 취소");
    }
    if (task.resolution?.summary) {
      parts.push(task.resolution.summary);
    }
    if (task.resolution?.relatedTaskId) {
      parts.push(`연결작업 #${task.resolution.relatedTaskId} ${task.resolution.relatedTaskLabel || ""}`.trim());
    }
    if (task.resolution?.note) {
      parts.push(task.resolution.note);
    }
    if (task.resolution?.originalError) {
      parts.push(`원실패 ${task.resolution.originalError}`);
    }
    if (task.smsStatus) {
      parts.push(`문자 ${smsStatusText(task.smsStatus)}`);
    }
    if (task.error && !task.resolution) {
      parts.push(`오류 ${humanTaskError(task.error)}`);
    }
    return parts.filter(Boolean).join(" / ");
  }

  function taskBookingCellHtml(task) {
    if (isDuplicateCancelTask(task) && task.conflict) {
      return duplicateCancelCellHtml(task);
    }
    if (task.resolution?.conflict && task.taskType === "upload" && task.status === "failed") {
      return linkedFailureCellHtml(task);
    }
    if (hasConflictTask(task)) {
      return duplicateCancelCellHtml(task);
    }
    if (isSyncFlowTask(task)) {
      return syncFlowCellHtml(task);
    }
    const suffix = task.taskType ? "" : paymentSuffix(task);
    return `${escapeHtml(task.date)} ${escapeHtml(task.room)}홀 ${formatHour(task.start)}-${formatHour(task.end)}<br>${escapeHtml(task.name || "이름 없음")}${reservationNumberLine(task)}<br><span class="row-source">${escapeHtml(taskDetailText(task))}${suffix}</span>`;
  }

  function isSyncFlowTask(task) {
    return ["upload", "delete", "naver_block", "naver_restore"].includes(task.taskType);
  }

  function syncFlowCellHtml(task) {
    const flow = syncFlowInfo(task);
    return `
      <div class="task-main">${escapeHtml(task.date)} ${escapeHtml(task.room)}홀 ${formatHour(task.start)}-${formatHour(task.end)} · ${escapeHtml(task.name || "이름 없음")}${reservationNumberLine(task)}</div>
      <div class="sync-flow">
        ${syncFlowSideHtml(flow.source, "source")}
        <span class="conflict-arrow">→</span>
        ${syncFlowSideHtml(flow.target, syncTargetStateClass(task))}
      </div>
    `;
  }

  function syncFlowInfo(task) {
    const targetStatus = taskStatusText(task);
    if (task.taskType === "naver_block") {
      return {
        source: { platform: "스페이스클라우드", state: "예약확정", meta: syncReservationMeta(task), note: syncSmsNote(task, "확정문자") },
        target: { platform: "네이버", state: `예약불가 ${targetStatus}`, meta: "", note: syncTargetNote(task) },
      };
    }
    if (task.taskType === "naver_restore") {
      return {
        source: { platform: "스페이스클라우드", state: "예약취소", meta: syncReservationMeta(task), note: "" },
        target: { platform: "네이버", state: `예약가능 복구 ${targetStatus}`, meta: "", note: syncTargetNote(task) },
      };
    }
    if (task.taskType === "delete") {
      return {
        source: { platform: "네이버", state: "예약취소", meta: syncReservationMeta(task), note: "" },
        target: { platform: "스페이스클라우드", state: `예약삭제 ${targetStatus}`, meta: "", note: syncTargetNote(task) },
      };
    }
    return {
      source: { platform: "네이버", state: "예약확정", meta: syncReservationMeta(task), note: syncSmsNote(task, "확정문자") },
      target: { platform: "스페이스클라우드", state: `예약등록 ${targetStatus}`, meta: "", note: syncTargetNote(task) },
    };
  }

  function syncFlowSideHtml(side, roleClass) {
    return `
      <div class="sync-side ${escapeHtml(roleClass)}">
        <div class="conflict-platform">${escapeHtml(side.platform)} <span class="conflict-state">${escapeHtml(side.state)}</span></div>
        ${side.meta ? `<div class="conflict-meta">${escapeHtml(side.meta)}</div>` : ""}
        ${side.note ? `<div class="conflict-sms">${escapeHtml(side.note)}</div>` : ""}
      </div>
    `;
  }

  function syncTargetStateClass(task) {
    if (task.status === "failed" || task.status === "needs_review") return "attention";
    if (task.status === "running") return "running";
    if (task.status === "pending") return "pending";
    return "target";
  }

  function syncReservationMeta(task) {
    return task.reservationNo ? `예약번호 ${task.reservationNo}` : "";
  }

  function syncSmsNote(task, label) {
    return task.smsStatus ? `${label} ${smsStatusText(task.smsStatus)}` : "";
  }

  function syncTargetNote(task) {
    if (task.taskType === "naver_restore" && task.resultStatus === "restore-skipped-not-owned") {
      return "복구 생략: 자동화가 만든 예약불가가 아니거나 선예약 보호 대상";
    }
    if (task.error) return `오류 ${humanTaskError(task.error)}`;
    return "";
  }

  function duplicateCancelCellHtml(task) {
    return `
      <div class="task-main">${escapeHtml(task.date)} ${escapeHtml(task.room)}홀 ${formatHour(task.start)}-${formatHour(task.end)} · ${escapeHtml(task.name || "이름 없음")}${reservationNumberLine(task)}</div>
      ${taskResolutionLineHtml(task)}
      ${conflictFlowHtml(task.conflict, task)}
    `;
  }

  function linkedFailureCellHtml(task) {
    return `
      <div class="task-main">${escapeHtml(task.date)} ${escapeHtml(task.room)}홀 ${formatHour(task.start)}-${formatHour(task.end)} · ${escapeHtml(task.name || "이름 없음")}${reservationNumberLine(task)}</div>
      ${taskResolutionLineHtml(task)}
      ${conflictFlowHtml(task.resolution.conflict, task)}
    `;
  }

  function taskResolutionLineHtml(task) {
    if (!task.resolution) return `<span class="row-source">${escapeHtml(taskDetailText(task))}</span>`;
    return `
      <div class="task-resolution ${escapeHtml(task.resolution.state || "")}">
        <strong>${escapeHtml(task.resolution.summary || taskStatusText(task))}</strong>
        ${task.resolution.note ? `<span>${escapeHtml(task.resolution.note)}</span>` : ""}
        ${task.resolution.originalError ? `<span>원실패: ${escapeHtml(task.resolution.originalError)}</span>` : ""}
      </div>
    `;
  }

  function conflictFlowHtml(conflict, task) {
    const winner = conflict?.winner || null;
    const loser = conflict?.loser || null;
    const cancelPlatform = loser?.platformLabel || canceledPlatformLabel(task);
    const winnerPlatform = winner?.platformLabel || confirmedPlatformLabel(task);
    return `
      <div class="story-flow">
        ${storyStepHtml({
          platform: cancelPlatform,
          state: "예약완료",
          meta: storyReceivedText(loser),
          extra: storyReservationNoText(loser),
        }, "source")}
        <span class="conflict-arrow">→</span>
        ${storyStepHtml({
          platform: `${winnerPlatform} 중복확인`,
          state: "선예약 있음",
          meta: storyReceivedText(winner, "선예약 접수"),
          extra: storyReservationNoText(winner),
        }, "check")}
        <span class="conflict-arrow">→</span>
        ${storyStepHtml({
          platform: cancelPlatform,
          state: duplicateCancelStateText(task),
          meta: storyProcessedText(task),
          extra: duplicateCancelSmsText(task),
        }, duplicateCancelStepClass(task))}
      </div>
    `;
  }

  function storyStepHtml(step, className) {
    return `
      <div class="story-step ${escapeHtml(className)}">
        <div class="conflict-platform">${escapeHtml(step.platform)} <span class="conflict-state">${escapeHtml(step.state)}</span></div>
        ${step.meta ? `<div class="conflict-meta">${escapeHtml(step.meta)}</div>` : ""}
        ${step.extra ? `<div class="conflict-sms">${escapeHtml(step.extra)}</div>` : ""}
      </div>
    `;
  }

  function storyReceivedText(side, label = "접수") {
    return side?.receivedAt ? `${label} ${formatDateTime(side.receivedAt) || side.receivedAt}` : "";
  }

  function storyReservationNoText(side) {
    return side?.reservationNo ? `예약번호 ${side.reservationNo}` : "";
  }

  function storyProcessedText(task) {
    return task.displayUpdatedAt || task.updatedAt ? `처리 ${formatDateTime(task.displayUpdatedAt || task.updatedAt)}` : "";
  }

  function duplicateCancelStateText(task) {
    if (task.resolution?.state === "resolved" || task.resolution?.state === "linked-resolved") return "예약취소 완료";
    if (task.resolution?.state === "running") return "예약취소 진행";
    if (task.resolution?.state === "pending") return "예약취소 대기";
    return "예약취소 확인필요";
  }

  function duplicateCancelStepClass(task) {
    if (task.resolution?.state === "resolved" || task.resolution?.state === "linked-resolved") return "cancel-done";
    if (task.resolution?.state === "running") return "running";
    if (task.resolution?.state === "pending") return "pending";
    return "attention";
  }

  function duplicateCancelSmsText(task) {
    const status = task.resolution?.smsStatus || task.smsStatus || "";
    return status ? `취소문자 ${smsStatusText(status)}` : "";
  }

  function conflictSideHtml(side, role, task) {
    const isCanceled = role === "loser";
    const platform = side?.platformLabel || (isCanceled ? canceledPlatformLabel(task) : confirmedPlatformLabel(task));
    const stateText = isCanceled ? "예약취소" : "예약확정";
    const stateClass = isCanceled ? "cancel" : "keep";
    const smsText = isCanceled ? `취소문자 ${smsStatusText(task.resolution?.smsStatus || task.smsStatus || "대기")}` : "확정 유지";
    const received = side?.receivedAt ? `접수 ${formatDateTime(side.receivedAt) || side.receivedAt}` : "";
    const reservationNo = side?.reservationNo ? `예약번호 ${side.reservationNo}` : "";
    return `
      <div class="conflict-side ${stateClass}">
        <div class="conflict-platform">${escapeHtml(platform)} <span class="conflict-state">${escapeHtml(stateText)}</span></div>
        <div class="conflict-meta">${escapeHtml(received || reservationNo || "-")}</div>
        ${reservationNo && received ? `<div class="conflict-meta">${escapeHtml(reservationNo)}</div>` : ""}
        <div class="conflict-sms">${isCanceled ? '<span class="conflict-x">X</span> ' : ""}${escapeHtml(smsText)}</div>
      </div>
    `;
  }

  function confirmedPlatformLabel(task) {
    if (task.taskType === "spacecloud_cancel") return "네이버";
    if (task.taskType === "naver_cancel") return "스페이스클라우드";
    return "선예약";
  }

  function canceledPlatformLabel(task) {
    if (task.taskType === "spacecloud_cancel") return "스페이스클라우드";
    if (task.taskType === "naver_cancel") return "네이버";
    return "후예약";
  }

  function smsStatusText(status) {
    if (status === "sent") return "발송";
    if (status === "already_sent") return "발송완료";
    if (status === "skipped") return "생략";
    if (status === "failed") return "실패";
    return status;
  }

  function reservationNumberLine(task) {
    return task.reservationNo ? `<br><span class="row-source">예약번호 ${escapeHtml(task.reservationNo)}</span>` : "";
  }

  function platformText(status) {
    if (status === "done" || status === "synced") return "완료";
    if (status === "source") return "원본";
    if (status === "running") return "진행";
    if (status === "failed") return "실패";
    if (status === "needs_review") return "확인필요";
    if (status === "already-canceled") return "이미취소";
    if (status === "google_pending") return "이전연동대기";
    if (status === "canceled") return "취소";
    if (status === "pending") return "대기";
    return status || "대기";
  }

  function sourceText(source) {
    if (source === "naver") return "네이버 원장";
    if (source === "spacecloud") return "스페이스클라우드 원장";
    if (source === "admin") return "관리자 입력";
    return source || "예약 원장";
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => el.toast.classList.remove("show"), 2200);
  }

  function loadJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));
  }
}());
