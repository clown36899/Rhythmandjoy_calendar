(function () {
  const rooms = ["A", "B", "C", "D", "E"];
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const apiUrl = "./api.php";
  const storageKey = "rhythmjoy.syncAdmin.drafts.v1";
  const profileKey = "rhythmjoy.syncAdmin.profile.v1";
  const sessionKey = "rhythmjoy.syncAdmin.sessions.v1";
  const tokenKey = "rhythmjoy.syncAdmin.adminToken.v1";

  const state = {
    activeDate: today(),
    roomFilter: "all",
    drafts: loadJson(storageKey, []),
    sessions: loadJson(sessionKey, {}),
    apiMode: "local",
    lastApiMessage: "관리 토큰 입력 전",
  };

  const el = {
    activeDate: document.getElementById("activeDate"),
    prevDay: document.getElementById("prevDay"),
    nextDay: document.getElementById("nextDay"),
    scheduleWrap: document.getElementById("scheduleWrap"),
    scheduleGrid: document.getElementById("scheduleGrid"),
    scheduleTimeNav: document.getElementById("scheduleTimeNav"),
    scheduleNowText: document.getElementById("scheduleNowText"),
    scrollToNow: document.getElementById("scrollToNow"),
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
    saveAdminToken: document.getElementById("saveAdminToken"),
    profilePath: document.getElementById("profilePath"),
    saveProfile: document.getElementById("saveProfile"),
    clearDrafts: document.getElementById("clearDrafts"),
    toast: document.getElementById("toast"),
    apiState: document.getElementById("apiState"),
    apiStatus: document.getElementById("apiStatus"),
    naverStatus: document.getElementById("naverStatus"),
    spacecloudStatus: document.getElementById("spacecloudStatus"),
  };

  init();

  function init() {
    syncTokenFromUrl();
    el.activeDate.value = state.activeDate;
    el.adminToken.value = localStorage.getItem(tokenKey) || "";
    el.profilePath.value = localStorage.getItem(profileKey) || el.profilePath.value;
    fillTimeSelects();
    bindEvents();
    renderAll();
    refreshFromApi({ silent: true });
    window.setInterval(updateCurrentTimeNavigator, 60000);
  }

  function bindEvents() {
    el.prevDay.addEventListener("click", () => moveDay(-1));
    el.nextDay.addEventListener("click", () => moveDay(1));
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
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !el.reservationModal.hidden) closeReservationModal();
    });
    el.clearDrafts.addEventListener("click", clearDrafts);
    el.runCheck.addEventListener("click", runReadOnlyCheck);
    el.scrollToNow.addEventListener("click", scrollScheduleToNow);
    el.saveAdminToken.addEventListener("click", saveAdminToken);
    el.saveProfile.addEventListener("click", saveProfile);
    window.addEventListener("resize", updateCurrentTimeNavigator);

    document.querySelectorAll("[data-open-login]").forEach((button) => {
      button.addEventListener("click", () => markSessionReady(button.dataset.openLogin));
    });

    document.querySelectorAll("[data-open-reservation-modal]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        openReservationModal();
      });
    });

    el.scheduleWrap.addEventListener("scroll", updateCurrentTimeNavigator, { passive: true });
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
      setApiState("warn", "로컬 초안", "관리 토큰을 입력하면 DB에 연결됩니다.");
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
    renderSchedule();
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
        slot.dataset.room = room;
        slot.dataset.hour = String(hour);
        placeGridItem(slot, rowIndex, hour + 2);
        const events = eventsForSlot(room, hour);
        if (events.length) {
          slot.classList.add("has-event");
          slot.title = eventTitle(events[0]);
        }
        slot.addEventListener("click", () => selectSlot(room, hour));
        el.scheduleGrid.appendChild(slot);
      });
      eventsStartingForRoom(room).forEach((event) => {
        const block = document.createElement("div");
        block.className = `event-block ${sourceClass(event.source)}`;
        block.innerHTML = eventBlockHtml(event);
        block.title = eventTitle(event);
        block.draggable = false;
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
    const rows = state.drafts.slice(0, 30);
    el.taskRows.innerHTML = "";
    if (!rows.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="5">아직 생성된 작업 초안이 없습니다.</td>';
      el.taskRows.appendChild(row);
      return;
    }
    rows.forEach((task) => {
      const row = document.createElement("tr");
      const doneClass = task.status === "done" || task.status === "synced" ? " done" : "";
      row.innerHTML = `
        <td><span class="status-badge${doneClass}">${escapeHtml(statusText(task.status))}</span></td>
        <td>${escapeHtml(task.date)} ${escapeHtml(task.room)}홀 ${formatHour(task.start)}-${formatHour(task.end)}<br>${escapeHtml(task.name || "이름 없음")}<br><span class="row-source">${escapeHtml(task.sourceLabel || sourceText(task.source))}${paymentSuffix(task)}</span></td>
        <td>${escapeHtml(platformText(task.naver))}</td>
        <td>${escapeHtml(platformText(task.spacecloud))}</td>
        <td>${formatDateTime(task.createdAt)}</td>
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
    const session = state.sessions[platform];
    if (session?.readyAt || session?.ready_at) {
      row.classList.add("ready");
      label.textContent = `준비됨 ${formatDateTime(session.readyAt || session.ready_at)}`;
    } else {
      row.classList.remove("ready");
      label.textContent = "세션 확인 필요";
    }
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

  function saveAdminToken() {
    const token = el.adminToken.value.trim();
    if (token) {
      localStorage.setItem(tokenKey, token);
      showToast("관리 토큰을 저장했습니다. DB 연결을 확인합니다.");
    } else {
      localStorage.removeItem(tokenKey);
      showToast("관리 토큰을 비웠습니다. 로컬 초안 모드입니다.");
    }
    refreshFromApi({ silent: false });
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

  async function markSessionReady(platform) {
    const urls = {
      naver: "https://partner.booking.naver.com/",
      spacecloud: "https://partner.spacecloud.kr/",
    };
    window.open(urls[platform], "_blank", "noopener,noreferrer");
    const readyAt = new Date().toISOString();
    state.sessions[platform] = { readyAt };
    localStorage.setItem(sessionKey, JSON.stringify(state.sessions));
    renderSessions();

    if (adminToken()) {
      try {
        const data = await apiRequest("session_ready", { date: state.activeDate, platform });
        applyApiData(data);
        renderAll();
      } catch (error) {
        setApiState("warn", "로컬 초안", error.message || "세션 DB 기록 실패");
      }
    }

    showToast(`${platform === "naver" ? "네이버" : "스페이스클라우드"} 로그인 창을 열었습니다.`);
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
      payment ? `결제 ${payment}` : "결제금액 미수집",
    ].join(" / ");
  }

  function eventBlockHtml(event) {
    const payment = formatPayment(event.price);
    return `
      <span class="event-main">${escapeHtml(event.name || "예약")} · ${formatHour(event.start)}-${formatHour(event.end)}</span>
      <span class="event-meta">
        <span>${escapeHtml(sourceShortText(event.source))}</span>
        <span class="${payment ? "payment-amount" : "payment-missing"}">${escapeHtml(payment || "금액 미수집")}</span>
      </span>
    `;
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
    document.body.classList.remove("modal-open");
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
  }

  function applyApiData(data) {
    const settings = data.settings || {};
    const sessions = data.sessions || {};
    state.sessions = Object.keys(sessions).reduce((acc, platform) => {
      acc[platform] = {
        readyAt: sessions[platform].ready_at || "",
        status: sessions[platform].status || "",
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
    return (localStorage.getItem(tokenKey) || el.adminToken.value || "").trim();
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

  function statusText(status) {
    if (status === "done" || status === "synced") return "완료";
    if (status === "confirmed") return "확정";
    if (status === "running") return "진행";
    if (status === "failed") return "실패";
    if (status === "canceled") return "취소";
    return "대기";
  }

  function platformText(status) {
    if (status === "done" || status === "synced") return "완료";
    if (status === "source") return "원본";
    if (status === "running") return "진행";
    if (status === "failed") return "실패";
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
