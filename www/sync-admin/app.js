(function () {
  const rooms = ["A", "B", "C", "D", "E"];
  const hours = Array.from({ length: 17 }, (_, index) => index + 8);
  const storageKey = "rhythmjoy.syncAdmin.drafts.v1";
  const profileKey = "rhythmjoy.syncAdmin.profile.v1";
  const sessionKey = "rhythmjoy.syncAdmin.sessions.v1";

  const state = {
    activeDate: today(),
    roomFilter: "all",
    drafts: loadJson(storageKey, []),
    sessions: loadJson(sessionKey, {}),
  };

  const el = {
    activeDate: document.getElementById("activeDate"),
    prevDay: document.getElementById("prevDay"),
    nextDay: document.getElementById("nextDay"),
    scheduleGrid: document.getElementById("scheduleGrid"),
    form: document.getElementById("new-reservation"),
    roomInput: document.getElementById("roomInput"),
    nameInput: document.getElementById("nameInput"),
    phoneInput: document.getElementById("phoneInput"),
    memoInput: document.getElementById("memoInput"),
    startInput: document.getElementById("startInput"),
    endInput: document.getElementById("endInput"),
    taskRows: document.getElementById("taskRows"),
    todayCount: document.getElementById("todayCount"),
    pendingCount: document.getElementById("pendingCount"),
    lastScan: document.getElementById("lastScan"),
    runCheck: document.getElementById("runCheck"),
    profilePath: document.getElementById("profilePath"),
    saveProfile: document.getElementById("saveProfile"),
    clearDrafts: document.getElementById("clearDrafts"),
    toast: document.getElementById("toast"),
    naverStatus: document.getElementById("naverStatus"),
    spacecloudStatus: document.getElementById("spacecloudStatus"),
  };

  init();

  function init() {
    el.activeDate.value = state.activeDate;
    el.profilePath.value = localStorage.getItem(profileKey) || el.profilePath.value;
    fillTimeSelects();
    bindEvents();
    renderAll();
  }

  function bindEvents() {
    el.prevDay.addEventListener("click", () => moveDay(-1));
    el.nextDay.addEventListener("click", () => moveDay(1));
    el.activeDate.addEventListener("change", () => {
      state.activeDate = el.activeDate.value || today();
      renderAll();
    });

    document.querySelectorAll("[data-room-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.roomFilter = button.dataset.roomFilter;
        document.querySelectorAll("[data-room-filter]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        renderSchedule();
      });
    });

    el.startInput.addEventListener("change", ensureEndAfterStart);
    el.form.addEventListener("submit", createDraftTask);
    el.clearDrafts.addEventListener("click", clearDrafts);
    el.runCheck.addEventListener("click", runReadOnlyCheck);
    el.saveProfile.addEventListener("click", saveProfile);

    document.querySelectorAll("[data-open-login]").forEach((button) => {
      button.addEventListener("click", () => markSessionReady(button.dataset.openLogin));
    });
  }

  function fillTimeSelects() {
    for (const hour of Array.from({ length: 17 }, (_, index) => index + 8)) {
      el.startInput.appendChild(option(hour, formatHour(hour)));
    }
    for (const hour of Array.from({ length: 17 }, (_, index) => index + 9)) {
      el.endInput.appendChild(option(hour, formatHour(hour)));
    }
    el.startInput.value = "19";
    el.endInput.value = "21";
  }

  function createDraftTask(event) {
    event.preventDefault();
    const start = Number(el.startInput.value);
    const end = Number(el.endInput.value);
    const room = el.roomInput.value;
    if (!validateRange(room, start, end)) return;

    const task = {
      id: `draft-${Date.now()}`,
      createdAt: new Date().toISOString(),
      date: state.activeDate,
      room,
      start,
      end,
      name: el.nameInput.value.trim(),
      phone: el.phoneInput.value.trim(),
      memo: el.memoInput.value.trim(),
      status: "pending",
      naver: "대기",
      spacecloud: "대기",
    };

    state.drafts.unshift(task);
    persistDrafts();
    el.form.reset();
    el.roomInput.value = room;
    el.startInput.value = String(start);
    el.endInput.value = String(end);
    renderAll();
    showToast("동기화 작업 초안이 생성됐습니다.");
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
    el.scheduleGrid.style.gridTemplateColumns = `92px repeat(${hours.length}, minmax(64px, 1fr))`;

    el.scheduleGrid.appendChild(cell("", "header"));
    hours.forEach((hour) => el.scheduleGrid.appendChild(cell(formatHour(hour), "header")));

    visibleRooms.forEach((room) => {
      el.scheduleGrid.appendChild(cell(`${room}홀`, "room"));
      hours.forEach((hour) => {
        const slot = cell("", "slot");
        slot.dataset.room = room;
        slot.dataset.hour = String(hour);
        const events = eventsForSlot(room, hour);
        if (events.length) {
          slot.classList.add("has-event");
          const eventLabel = document.createElement("span");
          eventLabel.className = "event-pill";
          eventLabel.textContent = `${events[0].name || "예약"} ${formatHour(events[0].start)}-${formatHour(events[0].end)}`;
          slot.appendChild(eventLabel);
        }
        slot.addEventListener("click", () => selectSlot(room, hour));
        el.scheduleGrid.appendChild(slot);
      });
    });
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
      row.innerHTML = `
        <td><span class="status-badge">${escapeHtml(statusText(task.status))}</span></td>
        <td>${escapeHtml(task.date)} ${escapeHtml(task.room)}홀 ${formatHour(task.start)}-${formatHour(task.end)}<br>${escapeHtml(task.name || "이름 없음")}</td>
        <td>${escapeHtml(task.naver)}</td>
        <td>${escapeHtml(task.spacecloud)}</td>
        <td>${formatDateTime(task.createdAt)}</td>
      `;
      el.taskRows.appendChild(row);
    });
  }

  function renderStatus() {
    const todays = state.drafts.filter((item) => item.date === state.activeDate);
    el.todayCount.textContent = String(todays.length);
    el.pendingCount.textContent = String(state.drafts.filter((item) => item.status === "pending").length);
  }

  function renderSessions() {
    updateSession("naver", el.naverStatus);
    updateSession("spacecloud", el.spacecloudStatus);
  }

  function updateSession(platform, label) {
    const row = document.querySelector(`.session-row[data-platform="${platform}"]`);
    const session = state.sessions[platform];
    if (session?.readyAt) {
      row.classList.add("ready");
      label.textContent = `준비됨 ${formatDateTime(session.readyAt)}`;
    } else {
      row.classList.remove("ready");
      label.textContent = "세션 확인 필요";
    }
  }

  function runReadOnlyCheck() {
    const now = new Date().toISOString();
    el.lastScan.textContent = formatDateTime(now);
    showToast("읽기 점검 요청이 기록됐습니다. DB/API 연결은 다음 단계입니다.");
  }

  function saveProfile() {
    localStorage.setItem(profileKey, el.profilePath.value.trim());
    showToast("프로필 경로가 저장됐습니다.");
  }

  function markSessionReady(platform) {
    const urls = {
      naver: "https://partner.booking.naver.com/",
      spacecloud: "https://partner.spacecloud.kr/",
    };
    window.open(urls[platform], "_blank", "noopener,noreferrer");
    state.sessions[platform] = { readyAt: new Date().toISOString() };
    localStorage.setItem(sessionKey, JSON.stringify(state.sessions));
    renderSessions();
    showToast(`${platform === "naver" ? "네이버" : "스페이스클라우드"} 로그인 창을 열었습니다.`);
  }

  function clearDrafts() {
    state.drafts = [];
    persistDrafts();
    renderAll();
    showToast("작업 초안을 비웠습니다.");
  }

  function selectSlot(room, hour) {
    el.roomInput.value = room;
    el.startInput.value = String(hour);
    el.endInput.value = String(Math.min(24, hour + 1));
    ensureEndAfterStart();
    document.getElementById("new-reservation").scrollIntoView({ behavior: "smooth", block: "start" });
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
  }

  function persistDrafts() {
    localStorage.setItem(storageKey, JSON.stringify(state.drafts));
  }

  function cell(text, className) {
    const node = document.createElement("div");
    node.className = `grid-cell ${className}`;
    node.textContent = text;
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
    return status === "done" ? "완료" : "대기";
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
