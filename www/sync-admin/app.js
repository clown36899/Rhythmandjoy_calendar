(function () {
  const rooms = ["A", "B", "C", "D", "E"];
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const revenuePolicy = window.RhythmjoyRevenuePolicy || null;
  const apiUrl = "./api.php";
  const storageKey = "rhythmjoy.syncAdmin.drafts.v1";
  const profileKey = "rhythmjoy.syncAdmin.profile.v1";
  const sessionKey = "rhythmjoy.syncAdmin.sessions.v1";
  const tokenKey = "rhythmjoy.syncAdmin.adminToken.v1";

  const state = {
    activeDate: today(),
    roomFilter: "all",
    drafts: loadJson(storageKey, []),
    tasks: [],
    sessions: loadJson(sessionKey, {}),
    apiMode: "local",
    lastApiMessage: "DB 연결 확인 전",
  };

  const el = {
    activeDate: document.getElementById("activeDate"),
    prevDay: document.getElementById("prevDay"),
    nextDay: document.getElementById("nextDay"),
    todayButton: document.getElementById("todayButton"),
    scheduleWrap: document.getElementById("scheduleWrap"),
    scheduleGrid: document.getElementById("scheduleGrid"),
    priceReference: document.getElementById("priceReference"),
    scheduleTimeNav: document.getElementById("scheduleTimeNav"),
    scheduleNowText: document.getElementById("scheduleNowText"),
    scrollToNow: document.getElementById("scrollToNow"),
    eventDetailModal: document.getElementById("eventDetailModal"),
    eventDetailSummary: document.getElementById("eventDetailSummary"),
    eventDetailList: document.getElementById("eventDetailList"),
    closeEventDetailModal: document.getElementById("closeEventDetailModal"),
    doneEventDetailModal: document.getElementById("doneEventDetailModal"),
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
    taskRows: document.getElementById("taskRows"),
    todayCount: document.getElementById("todayCount"),
    dayRevenue: document.getElementById("dayRevenue"),
    pendingCount: document.getElementById("pendingCount"),
    lastScan: document.getElementById("lastScan"),
    runCheck: document.getElementById("runCheck"),
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
  };

  init();

  function init() {
    syncTokenFromUrl();
    el.activeDate.value = state.activeDate;
    if (el.adminToken) el.adminToken.value = localStorage.getItem(tokenKey) || "";
    el.profilePath.value = localStorage.getItem(profileKey) || el.profilePath.value;
    fillTimeSelects();
    bindEvents();
    renderAll();
    updateActiveNav();
    refreshFromApi({ silent: true });
    window.setInterval(() => refreshFromApi({ silent: true }), 60000);
    window.setInterval(updateCurrentTimeNavigator, 60000);
  }

  function bindEvents() {
    el.prevDay.addEventListener("click", () => moveDay(-1));
    el.nextDay.addEventListener("click", () => moveDay(1));
    el.todayButton.addEventListener("click", goToday);
    el.activeDate.addEventListener("change", () => {
      state.activeDate = el.activeDate.value || today();
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
    el.closeEventDetailModal.addEventListener("click", closeEventDetailModal);
    el.doneEventDetailModal.addEventListener("click", closeEventDetailModal);
    el.eventDetailModal.addEventListener("click", (event) => {
      if (event.target === el.eventDetailModal) closeEventDetailModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!el.eventDetailModal.hidden) {
        closeEventDetailModal();
        return;
      }
      if (!el.reservationModal.hidden) closeReservationModal();
    });
    el.clearDrafts.addEventListener("click", clearDrafts);
    el.runCheck.addEventListener("click", runReadOnlyCheck);
    el.scrollToNow.addEventListener("click", scrollScheduleToNow);
    if (el.saveProfile) el.saveProfile.addEventListener("click", saveProfile);
    window.addEventListener("resize", updateCurrentTimeNavigator);
    window.addEventListener("resize", scheduleActiveNavUpdate);
    window.addEventListener("scroll", scheduleActiveNavUpdate, { passive: true });

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
      return true;
    } catch (error) {
      setApiState("warn", "로컬 초안", error.message || "DB API 연결 실패");
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
    renderSchedule();
    renderPriceReference();
    renderTasks();
    renderStatus();
    renderSessions();
  }

  function renderSchedule() {
    const visibleRooms = state.roomFilter === "all" ? rooms : [state.roomFilter];
    el.scheduleGrid.innerHTML = "";
    el.scheduleGrid.style.gridTemplateColumns = `var(--schedule-room-col) repeat(${hours.length}, minmax(0, 1fr))`;
    el.scheduleGrid.style.gridTemplateRows = `repeat(${visibleRooms.length + 1}, minmax(40px, auto))`;

    const corner = cell("", "header");
    placeGridItem(corner, 1, 1);
    el.scheduleGrid.appendChild(corner);
    hours.forEach((hour) => {
      const headerCell = cell(scheduleHourLabel(hour), "header");
      headerCell.classList.add(timeBandClass(hour), timeBandWeekendClass());
      headerCell.title = formatHour(hour);
      placeGridItem(headerCell, 1, hour + 2);
      el.scheduleGrid.appendChild(headerCell);
    });

    visibleRooms.forEach((room, roomIndex) => {
      const rowIndex = roomIndex + 2;
      const roomCell = cell(`${room}홀`, "room");
      placeGridItem(roomCell, rowIndex, 1);
      el.scheduleGrid.appendChild(roomCell);
      hours.forEach((hour) => {
        const slot = cell("", "slot");
        slot.classList.add(timeBandClass(hour), timeBandWeekendClass());
        slot.dataset.room = room;
        slot.dataset.hour = String(hour);
        placeGridItem(slot, rowIndex, hour + 2);
        const events = eventsForSlot(room, hour);
        if (events.length) {
          slot.classList.add("has-event");
          slot.title = eventTitle(events[0]);
        }
        slot.addEventListener("click", () => {
          if (events.length) {
            openEventDetailModal(events, `${room}홀 ${formatHour(hour)} 기준`);
            return;
          }
          selectSlot(room, hour);
        });
        el.scheduleGrid.appendChild(slot);
      });
      eventsStartingForRoom(room).forEach((event) => {
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
        el.scheduleGrid.appendChild(block);
      });
    });
    updateCurrentTimeNavigator();
  }

  function updateCurrentTimeNavigator() {
    const marker = ensureCurrentTimeMarker();
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    const firstHour = hours[0];
    const lastHour = 24;
    const isToday = state.activeDate === today();
    const inRange = currentHour >= firstHour && currentHour <= lastHour;
    if (!isToday || !inRange) {
      marker.hidden = true;
      el.scheduleTimeNav.hidden = true;
      return;
    }

    const rowHeaderWidth = scheduleRoomColumnWidth();
    const usableWidth = Math.max(1, el.scheduleGrid.clientWidth - rowHeaderWidth);
    const left = rowHeaderWidth + ((currentHour - firstHour) / (lastHour - firstHour)) * usableWidth;
    const label = `현재 ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    marker.hidden = false;
    marker.style.left = `${left}px`;
    marker.querySelector("span").textContent = label;
    el.scheduleTimeNav.hidden = false;
    el.scheduleNowText.textContent = label;
  }

  function ensureCurrentTimeMarker() {
    let marker = el.scheduleGrid.querySelector(".schedule-now-marker");
    if (!marker) {
      marker = document.createElement("div");
      marker.className = "schedule-now-marker";
      marker.hidden = true;
      marker.innerHTML = "<span></span>";
      el.scheduleGrid.appendChild(marker);
    }
    return marker;
  }

  function scrollScheduleToNow() {
    const marker = ensureCurrentTimeMarker();
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

  function renderStatus() {
    const todays = state.drafts.filter((item) => item.date === state.activeDate);
    el.todayCount.textContent = String(todays.length);
    const revenue = todays.reduce((total, item) => total + parsePaymentAmount(item.price), 0);
    const missing = todays.filter((item) => !parsePaymentAmount(item.price)).length;
    el.dayRevenue.textContent = revenue > 0 ? `${revenue.toLocaleString()}원` : "-";
    el.dayRevenue.title = missing ? `금액 미수집 ${missing}건` : "수집된 결제금액 합계";
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

  async function runReadOnlyCheck() {
    if (adminToken()) {
      try {
        const data = await apiRequest("read_check", { date: state.activeDate });
        applyApiData(data);
        setApiState("ready", data.mode === "db-live-queue" ? "DB 큐" : "DB 테스트", "읽기 점검 기록됨");
        renderAll();
        showToast("DB에 읽기 점검 요청을 기록했습니다.");
        return;
      } catch (error) {
        setApiState("warn", "로컬 초안", error.message || "읽기 점검 기록 실패");
        showToast(error.message || "읽기 점검 기록 실패");
      }
    }
    const now = new Date().toISOString();
    el.lastScan.textContent = formatDateTime(now);
    showToast("로컬 읽기 점검 시간이 기록됐습니다.");
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

  function eventsForSlot(room, hour) {
    return state.drafts.filter((item) => (
      item.date === state.activeDate &&
      item.room === room &&
      item.status !== "canceled" &&
      hour >= item.start &&
      hour < item.end
    ));
  }

  function eventsStartingForRoom(room) {
    return state.drafts
      .filter((item) => (
        item.date === state.activeDate &&
        item.room === room &&
        item.status !== "canceled" &&
        Number.isFinite(item.start) &&
        Number.isFinite(item.end) &&
        item.end > item.start
      ))
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function eventTitle(event) {
    const payment = formatPayment(event.price);
    const source = event.sourceLabel || sourceText(event.source);
    return [
      `${event.name || "예약"} ${formatHour(event.start)}-${formatHour(event.end)}`,
      source,
      payment ? `실결제 ${payment}` : "실결제 금액 미수집",
    ].join(" / ");
  }

  function eventBlockHtml(event) {
    const payment = formatPayment(event.price);
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
      ["결제금액", formatPayment(event.price) || ""],
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
              <th>평일 16시 전</th>
              <th>16시 후/휴일</th>
              <th>새벽 통대관</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function pricePairHtml(naverAmount) {
    const naver = Number(naverAmount || 0);
    if (!naver) return "-";
    const spacecloud = Math.round(naver * 1.1);
    return `
      <span class="price-pair">
        <span>네이버 ${formatWon(naver)}</span>
        <span>SC ${formatWon(spacecloud)}</span>
      </span>
    `;
  }

  function timeBandClass(hour) {
    if (hour >= 0 && hour < 6) return "time-dawn";
    if (!isWeekendOrHolidayDate(state.activeDate) && hour < 16) return "time-before";
    return "time-after";
  }

  function timeBandWeekendClass() {
    return isWeekendOrHolidayDate(state.activeDate) ? "holiday-pricing" : "weekday-pricing";
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
    const payment = formatPayment(task.price);
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

  function scheduleRoomColumnWidth() {
    const header = el.scheduleGrid.querySelector(".grid-cell.header");
    return header ? header.getBoundingClientRect().width : 68;
  }

  function ensureEndAfterStart() {
    const start = Number(el.startInput.value);
    const end = Number(el.endInput.value);
    if (end <= start) el.endInput.value = String(Math.min(24, start + 1));
  }

  function moveDay(delta) {
    const date = new Date(`${state.activeDate}T00:00:00`);
    date.setDate(date.getDate() + delta);
    state.activeDate = toDateInputValue(date);
    el.activeDate.value = state.activeDate;
    renderAll();
    refreshFromApi({ silent: true });
  }

  function goToday() {
    const nextDate = today();
    if (state.activeDate === nextDate) return;
    state.activeDate = nextDate;
    el.activeDate.value = state.activeDate;
    renderAll();
    refreshFromApi({ silent: true });
  }

  function updateDateControls() {
    el.todayButton.disabled = state.activeDate === today();
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

  function openEventDetailModal(events, summary) {
    el.eventDetailSummary.textContent = `${state.activeDate} ${summary}`;
    el.eventDetailList.innerHTML = events.map(eventDetailCardHtml).join("");
    el.eventDetailModal.hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => {
      el.doneEventDetailModal.focus();
    }, 0);
  }

  function closeEventDetailModal() {
    el.eventDetailModal.hidden = true;
    updateModalOpenState();
  }

  function updateModalOpenState() {
    document.body.classList.toggle("modal-open", !el.reservationModal.hidden || !el.eventDetailModal.hidden);
  }

  function updateModalSlotSummary() {
    const room = el.roomInput.value || "A";
    const start = Number(el.startInput.value || 19);
    const end = Number(el.endInput.value || Math.min(24, start + 1));
    el.modalSlotSummary.textContent = `${state.activeDate} ${room}홀 ${formatHour(start)}-${formatHour(end)}`;
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
    if (settings.last_read_check_at) {
      el.lastScan.textContent = formatDateTime(settings.last_read_check_at);
    } else if (data.serverTime) {
      el.lastScan.textContent = formatDateTime(data.serverTime);
    }

    state.drafts = (data.reservations || []).map((item) => ({
      id: `db-${item.id}`,
      dbId: item.id,
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
      status: item.status || "pending",
      naver: item.naverStatus || "pending",
      spacecloud: item.spacecloudStatus || "pending",
    }));
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
    if (status === "google_pending") return "구글대기";
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
