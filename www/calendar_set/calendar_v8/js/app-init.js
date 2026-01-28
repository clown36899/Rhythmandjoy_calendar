// 캘린더 UI 초기화 + 이벤트 리스너

// ======================== 2. UI 초기화 ========================
document.addEventListener("DOMContentLoaded", async () => {
  // window._originalConsole?.log("[DOMContentLoaded] 📦 이벤트 시작");

  try {
    // 💡 [수정] config-loader.js를 사용하지 않으므로 configPromise 대기 로직 제거

    // 1. Supabase 클라이언트 생성 (가장 먼저)
    if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      throw new Error('Supabase 라이브러리 또는 환경 변수가 로드되지 않았습니다.');
    }

    const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);


    // ------------------------------------------------------------------------------------------------------------------------------------------------------------
    // [병렬 실행 1] 싱크매니저 준비 및 리얼타임 구독 (비동기 - 기다리지 않음)
    // ------------------------------------------------------------------------------------------------------------------------------------------------------------
    // [병렬 실행 1] 싱크매니저 준비 및 리얼타임 구독 (비동기 - 기다리지 않음)
    window.syncManager = new SyncManager(window.indexedDBManager, supabaseClient);

    // 💡 [최적화] Realtime 연결 관리 (Visibility 기반)
    let realtimeChannel = null;
    let disconnectTimer = null;
    const DISCONNECT_DELAY = 5 * 60 * 1000; // 5분 후 연결 해제

    function connectRealtime() {
      if (realtimeChannel) return; // 이미 연결됨

      console.log('🔌 [Realtime] 연결 시도...');
      realtimeChannel = supabaseClient.channel('rhythmjoy-calendar')
        .on('broadcast', { event: 'calendar_changed' }, (payload) => {
          console.log("🚀 [Realtime] 이벤트 수신", payload.payload);
          window.syncManager.handleRealtimeEvent(payload.payload);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('📡 [Realtime] 구독 연결됨 (Online)');
          } else if (status === 'CLOSED') {
            console.log('zzz [Realtime] 연결 종료 (Offline)');
            realtimeChannel = null;
          }
        });
    }

    function disconnectRealtime() {
      if (realtimeChannel) {
        console.log('🔌 [Realtime] 연결 해제 (절전 모드)');
        supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
    }

    // 초기 연결
    connectRealtime();

    // 페이지 종료 시 정리
    window.addEventListener('beforeunload', () => {
      disconnectRealtime();
    });






    // [병렬 실행 2] 화면 그리기 (await로 완료 대기)
    window.calendar = new Calendar("calendarContainer");
    console.log("🚀 [init] Calendar 인스턴스 생성");
    await window.calendar.init(null);
    // ------------------------------------------------------------------------------------------------------------------------------------------------------------
    // 로딩스피너시작-----------------------------------------------------------------------------
    // 💡 [수정] 데이터 렌더링 후 브라우저가 화면을 그릴 때까지 확실히 기다립니다. (Double RAF 패턴)
    const loadingOverlay = document.querySelector('.loading');
    if (loadingOverlay) {
      // 첫 번째 RAF: 레이아웃 계산 및 페인트 예약
      requestAnimationFrame(() => {
        // 두 번째 RAF: 실제 페인트 완료 후 실행
        requestAnimationFrame(() => {
          // 💡 [수정] 전환 효과 없이 즉시 제거 (사용자 요청)
          loadingOverlay.style.display = 'none';
        });
      });
    }
    // 로딩스피너종료-----------------------------------------------------------------------------
    //여기까지가 화면 초기 셋팅이다.  
    //리얼타임구독을 구독
    //인덱스에 있는 데이터 가져와서 캘린더코어호출해서 인덱스기반 슬라이드를 찾아서 화면을 그린다. 없으면 안그린다. 이건 api요청하는코드가아니다.
    //그리고 싱크매니저를 준비시킨다.


    // 6. 기타 UI 이벤트 리스너 및 부가 기능 설정 (데이터 로딩 전에 미리 연결)
    setupAdminButton();
    setupInfoButton();
    setupBottomLayoutObserver();
    loadIframesAfterCalendar();
    setupMonthToggle();
    setupMonthDayModal();
    setupMonthEventListeners();
    checkAndOpenInfoPage();

    // 7. [신규] 스마트 동기화 함수 정의 (전역 호출 가능)
    // 마지막 동기화 시간 기록
    window.lastSyncTime = Date.now();

    window.startSmartSync = async (force = false, skipTTL = false) => {
      console.log(`🚀 [startSmartSync] 스마트 동기화 시작 (Force: ${force}, SkipTTL: ${skipTTL})`);
      const now = new Date();

      // 1. 초기 필수 범위 (±3개월) - 즉시 실행
      const immediateStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const immediateEnd = new Date(now.getFullYear(), now.getMonth() + 3, 1);

      console.log(`📥 [startSmartSync] 필수 범위 동기화 (${immediateStart.toLocaleDateString()} ~ ${immediateEnd.toLocaleDateString()})`);

      // 💡 [수정] syncDataRange는 내부적으로 syncMonth를 호출하므로, 여기서 직접 제어하기 위해 반복문으로 변경
      // await window.syncManager.syncDataRange(immediateStart, immediateEnd);

      let current = new Date(immediateStart);
      while (current <= immediateEnd) { // 🔴 [수정] < 를 <= 로 변경하여 마지막 달(4월) 포함
        await window.syncManager.syncMonth(current.getFullYear(), current.getMonth(), force, skipTTL);
        current.setMonth(current.getMonth() + 1);
      }

      // 동기화 완료 시간 갱신
      window.lastSyncTime = Date.now();

      // 2. 백그라운드 동기화 (스마트 탐색)
      // force가 true이면 sessionStorage 체크 무시하고 실행
      if (force || !sessionStorage.getItem('backgroundSyncStarted')) {
        sessionStorage.setItem('backgroundSyncStarted', 'true');

        // UI 렌더링을 방해하지 않기 위해 지연 실행
        setTimeout(async () => {
          console.log('🚀 [Background Sync] 시작 (스마트 탐색)');

          const MAX_EMPTY_MONTHS = 3;
          let emptyMonthCount = 0;
          // 🔴 [수정] 필수 동기화 바로 다음 달부터 시작 (간극 제거)
          let currentSyncDate = new Date(immediateEnd);
          currentSyncDate.setMonth(currentSyncDate.getMonth() + 1);
          const SAFETY_LIMIT_YEAR = now.getFullYear() + 10;

          while (currentSyncDate.getFullYear() < SAFETY_LIMIT_YEAR) {
            const year = currentSyncDate.getFullYear();
            const month = currentSyncDate.getMonth();

            await window.syncManager.syncMonth(year, month, false);

            const count = await window.indexedDBManager.getEventCount(year, month);
            console.log(`🔍 [Background Sync] ${year}-${month + 1}: ${count}개 이벤트`);

            if (count === 0) {
              emptyMonthCount++;
            } else {
              emptyMonthCount = 0;
            }

            if (emptyMonthCount >= MAX_EMPTY_MONTHS) {
              console.log(`🛑 [Background Sync] 연속 ${MAX_EMPTY_MONTHS}개월 데이터 없음. 동기화 종료.`);
              break;
            }

            currentSyncDate.setMonth(currentSyncDate.getMonth() + 1);
          }

          console.log('✅ [Background Sync] 미래 데이터 탐색 완료');

          // 과거 데이터 동기화 로직 제거됨 (사용자 요청)
          console.log('✅ [Background Sync] 모든 백그라운드 동기화 완료');
        }, 3000);
      } else {
        console.log('⏭️ [Background Sync] 스킵 (이미 실행됨)');
      }
    };

    // 8. [신규] 전역 증분 동기화 (Visibility용)
    window.startGlobalIncrementalSync = async () => {
      console.log('🚀 [startGlobalIncrementalSync] 전역 증분 동기화 시작');

      // 마지막 동기화 시간 확인
      if (!window.lastSyncTime) {
        console.log('⚠️ [Global Sync] 마지막 동기화 기록 없음 -> 스마트 동기화로 대체');
        await window.startSmartSync(true);
        return;
      }

      // 1분 버퍼를 둔 updatedMin 계산
      const bufferTime = new Date(window.lastSyncTime - 60 * 1000);
      const updatedMin = bufferTime.toISOString();

      console.log(`🔄 [Global Sync] updatedMin: ${updatedMin}`);
      await window.syncManager.syncGlobalChanges(updatedMin);

      // 동기화 완료 시간 갱신
      window.lastSyncTime = Date.now();
    };

    // 9. [신규] 과거 데이터 동기화 함수 (별도 분리)
    window.startPastSync = async () => {
      console.log('🚀 [startPastSync] 과거 데이터 동기화 시작 (추가 3개월)');
      const now = new Date();
      // 범위: [현재 - 6개월] ~ [현재 - 4개월] (Phase 1에서 -3개월까지는 이미 했으므로)
      const pastStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      const pastEnd = new Date(now.getFullYear(), now.getMonth() - 3, 0);

      await window.syncManager.syncDataRange(pastStart, pastEnd);
      console.log('✅ [startPastSync] 과거 데이터 동기화 완료');
    };

    // 9. [신규] 화면 복귀 시 자동 갱신 (Visibility API) + Realtime 연결 관리
    function setupVisibilityRefresher() {
      const REFRESH_THRESHOLD = 5 * 1000; // 5초

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          // 1. Realtime 연결 복구
          if (disconnectTimer) {
            clearTimeout(disconnectTimer);
            disconnectTimer = null;
            console.log('⚡ [Realtime] 연결 해제 타이머 취소');
          }
          connectRealtime();

          // 2. 데이터 동기화
          const now = Date.now();
          const timeSinceLastSync = now - window.lastSyncTime; // lastSyncTime은 전역 변수

          console.log(`👀 [Visibility] 화면 복귀. 경과: ${Math.round(timeSinceLastSync / 1000)}초`);

          if (timeSinceLastSync > REFRESH_THRESHOLD) {
            console.log('🔄 [Visibility] 전역 증분 동기화 시작');
            window.startGlobalIncrementalSync();
          }

        } else {
          // 3. 화면 숨김 -> Realtime 연결 해제 예약
          console.log(`zzz [Realtime] 화면 숨김. ${DISCONNECT_DELAY / 60000}분 후 연결 해제 예약`);
          disconnectTimer = setTimeout(() => {
            disconnectRealtime();
          }, DISCONNECT_DELAY);
        }
      });
    }
    setupVisibilityRefresher();

    // 10. 앱 시작 시 실행 순서
    // 스마트 동기화(미래) 먼저 실행 후, 과거 데이터는 천천히 실행
    // 💡 [수정] 페이지 로드 시에는 TTL을 무시하고 증분 동기화(skipTTL=true)를 수행하여 최신 상태 보장
    await window.startSmartSync(false, true);

    // 과거 데이터는 중요도가 낮으므로 비동기로 실행 (await 없이)
    setTimeout(() => {
      window.startPastSync();
    }, 5000); // 5초 뒤 실행

    // 🚀 [신규] 데이터 변경 감지 시 UI 갱신 (Decoupled UI)
    // Calendar 내부에서 리스너를 등록했으므로 중복 제거됨
    // window.addEventListener('calendar-data-changed', ...);

    // 🚀 [성능 최적화] 데이터 프리로딩 제거됨 (Local-First 강화)
    // index.html의 인라인 스크립트 제거로 인해 더 이상 사용하지 않음
    let preloadPromise = null;




    // window._originalConsole?.log("[DOMContentLoaded] ✅ 모든 UI 초기화 성공!");

  } catch (error) {
    console.error("[CRITICAL ERROR] ❌ UI 초기화 실패:", error);
    const container = document.getElementById('calendarContainer');
    if (container) {
      container.innerHTML = '<p>캘린더를 초기화하는 중 오류가 발생했습니다.</p>';
    }
  }
});

// ======================== 3. UI 이벤트 리스너 ========================

function loadIframesAfterCalendar() {
  const iframes = document.querySelectorAll('iframe[data-src]');
  iframes.forEach(iframe => {
    const dataSrc = iframe.getAttribute('data-src');
    if (dataSrc && !iframe.getAttribute('src')) {
      iframe.setAttribute('src', dataSrc);
    }
  });
}

function setupAdminButton() {
  const adminBtn = document.getElementById("adminBtn");
  if (adminBtn) {
    adminBtn.addEventListener("click", () => {
      window.location.href = "admin.html";
    });
  }
}

function setupInfoButton() {
  const infoBtn = document.getElementById("infoBtn");
  if (infoBtn) {
    infoBtn.addEventListener("click", () => {
      openInfoPage();
    });
  }
}

function openInfoPage() {
  const overlay = document.getElementById("infoPageOverlay");
  requestAnimationFrame(() => {
    overlay.classList.add("active");
  });
}

function closeInfoPage() {
  const overlay = document.getElementById("infoPageOverlay");
  overlay.classList.remove("active");
}

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "closeInfo") {
    closeInfoPage();
  }
});

window.openInfoPage = openInfoPage;
window.closeInfoPage = closeInfoPage;

function checkAndOpenInfoPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const shouldOpen = urlParams.get('openInfo');
  const section = urlParams.get('section');

  if (shouldOpen === 'true') {
    const iframe = document.getElementById('infoPageFrame');

    iframe.addEventListener('load', function onLoad() {
      openInfoPage();
      if (section && iframe.contentWindow) {
        setTimeout(() => {
          iframe.contentWindow.postMessage({ type: 'showSection', section: section }, '*');
        }, 500);
      }
      iframe.removeEventListener('load', onLoad);
    });

    if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
      openInfoPage();
      if (section && iframe.contentWindow) {
        setTimeout(() => {
          iframe.contentWindow.postMessage({ type: 'showSection', section: section }, '*');
        }, 500);
      }
    }
  }
}//수정

function setupBottomLayoutObserver() {
  const updateBottomHeights = () => {
    const bottomControls = document.querySelector(".bottom-controls");
    const roomSelector = document.querySelector(".room-selector");
    // 🔴 [수정] .header 제거 (존재하지 않음)
    const calendarHeader = document.querySelector(".calendar-header");

    if (bottomControls && roomSelector && calendarHeader) {
      const bottomControlsHeight = bottomControls.offsetHeight;
      const roomSelectorHeight = roomSelector.offsetHeight;
      // 🔴 [수정] headerHeight 제거
      const calendarHeaderHeight = calendarHeader.offsetHeight;

      // 🔴 [수정] --header-height 제거 (사용 안 함)
      document.documentElement.style.setProperty("--calendar-header-height", `${calendarHeaderHeight}px`);

      // 🔴 [신규] 월간 패널 위치 계산 (Direct Window Calculation)
      // 전체 화면 높이에서 헤더와 하단 영역을 뺀 나머지를 월간 패널 높이로 설정
      const appContainer = document.querySelector(".app-container");
      if (appContainer) {
        // 1. 전체 화면 높이 (모바일 주소창 제외한 실제 보이는 높이)
        const totalHeight = window.innerHeight;

        // 2. 헤더 높이 (소수점 정밀도)
        const headerHeight = calendarHeader.getBoundingClientRect().height;

        // 3. 하단 영역 높이 (하단 컨트롤 + 룸 선택기)
        // 소수점 정밀도 사용
        const bottomHeight = bottomControls.getBoundingClientRect().height + roomSelector.getBoundingClientRect().height;

        // 4. 월간 패널 높이 계산
        const panelHeight = totalHeight - headerHeight - bottomHeight;

        // 5. 적용
        document.documentElement.style.setProperty("--month-panel-top", `${headerHeight}px`);
        document.documentElement.style.setProperty("--month-panel-height", `${panelHeight}px`);
      }
    }
  };

  updateBottomHeights();

  const resizeObserver = new ResizeObserver(() => {
    updateBottomHeights();
  });

  const bottomControls = document.querySelector(".bottom-controls");
  const roomSelector = document.querySelector(".room-selector");
  const header = document.querySelector(".header");
  const calendarHeader = document.querySelector(".calendar-header");

  if (bottomControls) resizeObserver.observe(bottomControls);
  if (roomSelector) resizeObserver.observe(roomSelector);
  if (header) resizeObserver.observe(header);
  if (calendarHeader) resizeObserver.observe(calendarHeader);

  window.addEventListener("resize", updateBottomHeights);
  window.addEventListener("orientationchange", updateBottomHeights);
}

function setupMonthToggle() {
  const calendarTitle = document.getElementById("calendarTitle");

  // window._originalConsole.log("🔧 [setupMonthToggle] 초기화", {
  //   calendarTitle: !!calendarTitle,
  //   calendar: !!window.calendar
  // });

  // 🔴 [수정] 월간 패널 토글 기능 제거 (사용자 요청)
  // calendarTitle 클릭 리스너 제거됨

  // 🔴 [신규] 뷰 전환 버튼 설정
  setupViewSwitchButtons();

  const monthPanel = document.getElementById("monthPanel");
  const calendarMain = document.getElementById("calendarContainer");
  const infoPageOverlay = document.getElementById("infoPageOverlay");

  const closeMonthPanelOnClick = (e) => {
    if (monthPanel && monthPanel.classList.contains("open")) {
      if (!monthPanel.contains(e.target)) {
        if (window.calendar) {
          window.calendar.monthPanelOpen = false;
          monthPanel.classList.remove("open");
        }
      }
    }
  };

  if (calendarMain) calendarMain.addEventListener("click", closeMonthPanelOnClick);
  if (infoPageOverlay) infoPageOverlay.addEventListener("click", closeMonthPanelOnClick);

  // 🔴 [제거] monthPanel에 대한 click 이벤트의 stopPropagation()을 제거합니다.
  // 이 코드는 월간 패널 내부의 날짜 클릭 이벤트가 document까지 도달하는 것을 막아, 일간 모달이 뜨지 않는 문제를 유발했습니다.
  const prevBtn = document.getElementById("prevMonthBtn");
  const nextBtn = document.getElementById("nextMonthBtn");

  if (prevBtn) {
    prevBtn.addEventListener("click", async () => {
      if (window.calendar) {
        await window.calendar.goToPrevMonth();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", async () => {
      if (window.calendar) {
        await window.calendar.goToNextMonth();
      }
    });
  }

  // 🔴 [제거] 유저가 HTML에서 month-panel-header를 삭제했으므로 관련 리스너 제거

  const monthPanelBackdrop = document.getElementById("monthPanelBackdrop");
  if (monthPanelBackdrop) {
    monthPanelBackdrop.addEventListener("click", () => {
      if (window.calendar) {
        // 🔑 toggleMonthPanel() 호출 → 주간 뷰로 전환
        window.calendar.toggleMonthPanel();
      }
    });
  }
}

function setupMonthDayModal() {
  const modal = document.getElementById("monthDayModal");
  const closeBtn = document.getElementById("monthDayModalClose");

  if (!modal || !closeBtn) return;

  closeBtn.addEventListener("click", () => {
    modal.classList.remove("open");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("open");
    }
  });
}

let isMonthEventListenersSetup = false;
function setupMonthEventListeners() {
  // 🔴 [수정] 이벤트 리스너가 중복으로 등록되는 것을 방지합니다.
  // 이 함수는 월간 패널이 열릴 때마다 호출될 수 있으므로, 한 번만 리스너를 등록하도록 수정합니다.
  if (isMonthEventListenersSetup) {
    return;
  }
  isMonthEventListenersSetup = true;

  document.addEventListener('click', (e) => {
    const monthDay = e.target.closest('.month-day');

    // 월간 보기의 날짜 셀이 아니면 무시
    if (!monthDay) return;

    if (window.calendar && window.calendar.monthIsDragging) {
      window._originalConsole.log('🖱️ [Month Day Click] Dragging in progress, click ignored.');
      return;
    }

    // 🔴 [수정] data-date 속성에서 날짜를 가져와 이벤트 데이터를 직접 조회합니다.
    const dateString = monthDay.dataset.date;
    if (!dateString) return;

    const clickedDate = new Date(dateString);

    // 캐시에서 해당 월의 모든 이벤트를 가져옵니다.
    const monthCacheKey = CacheRules.getMonthCacheKey(clickedDate);
    const allMonthEvents = window.calendar?.monthDataCache?.get(monthCacheKey) || [];

    // 클릭된 날짜에 해당하는 이벤트만 필터링합니다.
    const dayStart = new Date(clickedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(clickedDate);
    dayEnd.setHours(23, 59, 59, 999);

    const dayEvents = allMonthEvents.filter(event => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return eventStart < dayEnd && eventEnd > dayStart;
    });

    // 🔴 [수정] 날짜 객체와 필터링된 이벤트 데이터로 모달을 엽니다.
    showMonthDayModal(clickedDate, dayEvents);
  });
}
function showMonthDayModal(date, events) {
  const modal = document.getElementById("monthDayModal");
  const title = document.getElementById("monthDayModalTitle");
  const eventsContainer = document.getElementById("monthDayModalEvents");

  if (!modal || !title || !eventsContainer) return;

  // 전달받은 date 객체에서 월/일 정보를 가져옵니다.
  const month = date.getMonth() + 1;
  const dayNumber = date.getDate();
  title.textContent = `${month}월 ${dayNumber}일`;

  eventsContainer.innerHTML = "";

  const roomBgMap = {
    'A': '#F6BF26',
    'B': '#5796C8',
    'C': '#81B4BA',
    'D': '#A6D854',
    'E': '#F08080'
  };

  // 이벤트가 없을 경우 메시지를 표시합니다.
  if (!events || events.length === 0) {
    eventsContainer.innerHTML = '<p class="no-events-message" style="text-align: center; color: #999; padding: 2rem 0;">이 날짜에는 예약이 없습니다.</p>';
    modal.classList.add("open");
    return;
  }

  const roomEvents = {};
  // 이벤트 데이터 객체를 직접 사용합니다.
  events.forEach((eventData) => {
    const room = eventData.roomId?.toUpperCase() || "미정";
    if (!roomEvents[room]) roomEvents[room] = [];
    roomEvents[room].push(eventData);
  });

  // 방 순서(A,B,C,D,E)와 시간 순서로 정렬합니다.
  const sortedRooms = Object.keys(roomEvents).sort();

  sortedRooms.forEach(room => {
    const roomEventList = roomEvents[room];
    roomEventList.sort((a, b) => new Date(a.start) - new Date(b.start));

    const roomGroupDiv = document.createElement("div");
    roomGroupDiv.className = "month-day-modal-room-group";

    roomEventList.forEach((eventData) => {
      const startTime = new Date(eventData.start);
      const endTime = new Date(eventData.end);
      const startHour = String(startTime.getHours()).padStart(2, '0');
      const endHour = String(endTime.getHours()).padStart(2, '0');
      const time = `${startHour}~${endHour}시`;
      const eventTitle = eventData.title || "제목 없음";

      const eventDiv = document.createElement("div");
      eventDiv.className = "month-day-modal-event";
      eventDiv.style.backgroundColor = roomBgMap[room] || '#888';
      eventDiv.innerHTML = `<span>${time}</span><span>${eventTitle}</span><span>Room ${room}</span>`;

      roomGroupDiv.appendChild(eventDiv);
    });

    eventsContainer.appendChild(roomGroupDiv);
  });

  modal.classList.add("open");
}
function setupViewSwitchButtons() {
  const viewWeekBtn = document.getElementById("viewWeekBtn");
  const viewMonthBtn = document.getElementById("viewMonthBtn");

  if (viewWeekBtn) {
    viewWeekBtn.addEventListener("click", () => {
      if (window.calendar && window.calendar.monthPanelOpen) {
        window.calendar.toggleMonthPanel(); // 월간 패널 닫기 (주간 뷰로 전환)
      }
    });
  }

  if (viewMonthBtn) {
    viewMonthBtn.addEventListener("click", () => {
      if (window.calendar && !window.calendar.monthPanelOpen) {
        window.calendar.toggleMonthPanel(); // 월간 패널 열기
      }
    });
  }
}
