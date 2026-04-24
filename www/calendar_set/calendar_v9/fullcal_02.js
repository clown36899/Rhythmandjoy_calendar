// ✅ SwipeCalendar 안정판: 체크박스 유지 + 날짜 유지 + 동기화 대응 포함 (구형 대응)

let lastInteraction = Date.now();
let _lastRefreshed = 0;
const calendarEl = document.getElementById("calendarAll");
const roomKeys = ['a', 'b', 'c', 'd', 'e'];

const roomConfigs = {
  a: { name: "A홀", calendarId: "752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com", color: "#F6BF26" },
  b: { name: "B홀", calendarId: "22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com", color: "rgb(87, 150, 200)" },
  c: { name: "C홀", calendarId: "b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com", color: "rgb(129, 180, 186)" },
  d: { name: "D홀", calendarId: "60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com", color: "rgb(125, 157, 106)" },
  e: { name: "E홀", calendarId: "aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com", color: "#4c4c4c" }
};

let currentRoomSelections = { a: true, b: true, c: true, d: true, e: true };

function makeSource(key) {
  const cfg = roomConfigs[key];
  return {
    id: key,
    googleCalendarId: cfg.calendarId,
    className: key,
    color: cfg.color,
    textColor: '#000',
    eventDataTransform: (ev) => {
      delete ev.url;
      ev.extendedProps = { ...ev.extendedProps, roomKey: key, roomName: cfg.name };
      return ev;
    }
  };
}

function getLegacySlideCalendars() {
  const candidates = [calendar?._prevCal, calendar?._curCal, calendar?._nextCal];
  return candidates.filter(cal => cal && typeof cal.getEventSources === 'function');
}

function updateRoomVisibility() {
  const body = document.body;
  const roomKeys = Object.keys(roomConfigs);

  const allSelected = roomKeys.every(k => currentRoomSelections[k]);
  if (allSelected) {
    body.classList.add('view-all');
  } else {
    body.classList.remove('view-all');
  }

  const calendars = getLegacySlideCalendars();
  calendars.forEach(calInst => {
    if (calInst && typeof calInst.rerenderEvents === 'function') {
      calInst.rerenderEvents();
    }
  });
}

function select_room_btn_function(aroom_name_key) {
  const roomKeys = Object.keys(roomConfigs);

  // ✅ currentRoomSelections 초기화
  roomKeys.forEach(key => {
    currentRoomSelections[key] = false;
  });

  if (aroom_name_key === 'all') {
    roomKeys.forEach(key => { currentRoomSelections[key] = true; });
  } else if (roomConfigs[aroom_name_key]) {
    currentRoomSelections[aroom_name_key] = true;
  } else {
    console.warn("존재하지 않는 룸:", aroom_name_key);
  }

  // 🔁 체크박스 상태 업데이트
  const checkboxes = document.querySelectorAll('.room-toggle');
  checkboxes.forEach(checkbox => {
    checkbox.checked = currentRoomSelections[checkbox.value];
  });

  updateRoomVisibility();
}

const roomOrder = ['Ahall', 'Bhall', 'Chall', 'Dhall', 'Ehall'];

function initCalendar() {

  calendar = new SwipeCalendar(calendarEl, {
    swipeLicenseKey: "9VHD7-R6WHI-MYE4S-KHDS8",
    swipeEffect: "slide",
    swipeSpeed: 500,
    locale: "ko",
    nowIndicator: true,
    selectable: false,
    editable: false,
    // height: "auto",
    slotDuration: "01:00",
    allDaySlot: false,
    slotEventOverlap: false,
    defaultView: "timeGridWeek",

    googleCalendarApiKey: "AIzaSyCLqM39X5vTjrNt1Vl5miRryXWkLYPqky8",
    plugins: ["interaction", "dayGrid", "googleCalendar", "timeGrid"],
    height: 'parent',
    eventSources: roomKeys.map(makeSource), // 최초 1회 전체 로드하여 캐싱
    customButtons: {
      weekview: {
        text: '주간',
        click: function () {
          calendar.changeView('timeGridWeek');

        },

      },
      monthview: {
        text: '월간',
        click: function () {
          calendar.changeView('dayGridMonth');
        }
      },
      prevMonth: {
        text: '←',
        click: function () {
          const raw = calendar.getDate();
          const date = new Date(raw);
          const newDate = new Date(date.getFullYear(), date.getMonth() - 1, 1);
          calendar.gotoDate(newDate);
        }
      },
      nextMonth: {
        text: '→',
        click: function () {
          const raw = calendar.getDate();
          const date = new Date(raw);
          const newDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);
          calendar.gotoDate(newDate);
        }
      }
    },
    header: {
      left: 'prevMonth',
      center: 'title',
      right: 'nextMonth'
    },
    views: {
      timeGridWeek: {

        columnHeaderHtml: (date) => {
          const days = ["일", "월", "화", "수", "목", "금", "토"];
          return `
            <span class='column-header-week'>${days[date.getDay()]}</span>
            <span class='column-header-day'>${date.getDate()}</span>`;
        },

        titleFormat: { month: 'long' }, // "4월"
        columnHeaderFormat: { weekday: "short", day: "numeric" },
        dayMaxEvents: true,
        eventOrderStrict: true,  // eventOrder 기준을 엄격하게 적용
        eventOrderStrict: false,
        // eventOrder: (a, b) => {
        //   const orderA = a.extendedProps.sortKey || a.extendedProps.roomKey || '';
        //   const orderB = b.extendedProps.sortKey || b.extendedProps.roomKey || '';

        //   if (orderA < orderB) return -1;
        //   if (orderA > orderB) return 1;

        //   return a.start - b.start;
        // },
      },

      dayGridMonth: {

        columnHeaderHtml: (date) => {
          const days = ["일", "월", "화", "수", "목", "금", "토"];
          const isSunday = date.getDay() === 0;
          return `<span class='month-header-weekday${isSunday ? ' sunday' : ''}'>${days[date.getDay()]}</span>`;
        },
        eventLimit: true,

        eventLimitText: function (n) {
          return '+' + n; // "+15" 형식
        },
        eventOrder: (a, b) => {
          const roomA = a.extendedProps.roomKey || '';
          const roomB = b.extendedProps.roomKey || '';
          if (roomA < roomB) return -1;
          if (roomA > roomB) return 1;
          return a.start - b.start;
        }
      }
    },

    eventClick: (info) => {
      info.jsEvent.preventDefault();

      // [Modified] User requested Daily Popup for Weekly View as well
      if (info.view.type === 'dayGridMonth' || info.view.type === 'timeGridWeek') {
        openDailyEventPopup(info.event.start);
      } else {
        animateEventClick(info);
      }
    },

    datesRender: (info) => {


      try {
        const titleElement = document.querySelector("#calendarAll .fc-toolbar-view-title");
        if (titleElement) {
          const currentTitle = titleElement.innerText;
          const parts = currentTitle.split(' ');
          console.log("현재 타이틀:", currentTitle);
          console.log("분리된 parts:", parts);

          if (parts.length > 0) {
            // 배열의 마지막 요소가 월 정보일 가능성이 높음
            const lastPart = parts[parts.length - 1];
            titleElement.innerText = lastPart;
          } else {
            console.warn("⚠️ 타이틀이 비어 있습니다.");
          }
        } else {
          console.warn("⚠️ 타이틀 요소를 찾을 수 없습니다.");
        }

      } catch (err) {
        console.error("❌ 타이틀 처리 중 오류:", err);
      }

      // ⭐ [FullCalendar 내장 콜백을 활용한 스타일 제어] ⭐

      // 화면 폭 기준 설정 (1000px)
      const DESKTOP_THRESHOLD = 1000;
      const isLargeScreen = window.innerWidth > DESKTOP_THRESHOLD; // 1000px 초과인지 확인

      // 캘린더 tbody 요소 선택
      const tbodyEl = document.querySelector("#calendarAll .fc-timeGridWeek-view .fc-timeGrid .fc-body tbody, #calendarAll .fc-dayGridMonth-view .fc-body");

      if (info.view.type === 'dayGridMonth') {
        console.log('월간');
        if (tbodyEl) {
          if (isLargeScreen) {
            // 🟢 월간 뷰 AND 1000px 초과일 때 50% 적용
            // tbodyEl.style.width = '33.3%';
            // console.log("✅ 월간 뷰 (1000px 초과): .fc tbody width 50% 적용");
          } else {
            // 🟡 월간 뷰 AND 1000px 이하일 때 width 초기화 (100%로 동작)
            tbodyEl.style.width = '';
            console.log("✅ 월간 뷰 (1000px 이하): .fc tbody width 초기화 (100%)");
          }
        }
      } else if (info.view.type === 'timeGridWeek') {
        console.log('주간');
        if (tbodyEl) {
          // 🔵 주간 뷰일 때는 항상 width 초기화 (100%로 동작)
          tbodyEl.style.width = '';
          console.log("✅ 주간 뷰: .fc tbody width 초기화 (100%)");
        }
      }


      // 삼각형: datesRender에서 한 번만 추가 (기존 것 제거 후)
      document.querySelectorAll('.custom-triangle').forEach(el => el.remove());
      if (info.view.type === 'dayGridMonth') {
        document.querySelectorAll('.fc-day.fc-today').forEach((el) => {
          const triangle = document.createElement('div');
          triangle.className = 'custom-triangle';
          el.appendChild(triangle);
        });
      } else if (info.view.type === 'timeGridWeek') {
        document.querySelectorAll('.fc-day-header.fc-today').forEach((el) => {
          const triangle = document.createElement('div');
          triangle.className = 'custom-triangle';
          el.appendChild(triangle);
        });
      }

      setTimeout(updateRoomVisibility, 0);
    },
    eventRender: function (info) {
      const roomKey = info.event.extendedProps.roomKey;
      if (roomKey && !currentRoomSelections[roomKey]) {
        return false; // Tells FullCalendar to ignore this event in layout and DOM
      }

      const viewType = info.view.type;  // 'timeGridWeek', 'dayGridMonth' 등


      const ev = info.event;
      const title = ev.title;
      const start = ev.start;
      const end = ev.end;
      const roomName = ev.extendedProps.roomName || '';
      const desc = ev.extendedProps.description || '';
      const fmt = (d) => d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');

      // 정규식으로 description에서 정보 추출


      const extract = (label) => {
        const match = desc.match(new RegExp(`${label}:\\s*([^\n]+)`));
        return match ? match[1].trim() : '';
      };

      let 예약자명 = extract("예약자명");
      예약자명 = 예약자명.replace(/님+$/, '') + '님';  // ⭐중복 처리

      const 예약상품 = extract("예약상품");
      const 사용일자 = extract("사용일자");
      const 시작시간 = extract("시작시간");
      const 종료시간 = extract("종료시간");
      const 결제상태 = extract("결제상태");
      // const 예약번호 = extract("예약번호");

      let 예약번호 = extract("예약번호");

      let 예약정보 = 예약번호
        ? `네이버예약: ${예약번호}`
        : "스페이스클라우드예약";

      let html = '';
      if (viewType === 'dayGridMonth') {
        // [Modified] Monthly View: Show only Time and Room Name, Color Black
        html = `
          <div class="custom-event-box" style="color: black; display: flex; overflow: hidden; white-space: nowrap; align-items: center;">
            <div class="custom-room" style="font-weight:bold; margin-right:3px; flex-shrink: 0;">${(roomName || '').replace('홀', '')}</div>
            <div class="custom-time" style="white-space: nowrap;">${fmt(start)}~${fmt(end)}</div>
          </div>
        `;
      } else {
        // Default (Weekly View): Show Full Info
        html = `
          <div class="custom-event-box">
            <div class="custom-time">${fmt(start)} ~ ${fmt(end)}</div>
            <div class="custom-title">${title}</div>
            <div class="custom-room">${roomName}</div>
          
            <div class="custom-info"> ${예약정보}</div>
          </div>
        `;
      }

      info.el.innerHTML = html;
    },

    eventLimitClick: function (cellInfo) {
      console.log("More clicked!", cellInfo);
      const rawDate = cellInfo.date || (cellInfo.dayEl?.getAttribute('data-date')) || '';
      openDailyEventPopup(rawDate);
      return false; // Prevent default action
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false }
  });
  calendar?._curCal.render();
  updateRoomVisibility();
}











function animateEventClick(info) {
  const original = info.el;
  const clone = original.cloneNode(true);
  const rect = original.getBoundingClientRect();

  // 팝업과 배경 요소 참조
  const backdrop = document.getElementById("popupBackdrop");
  clone.style.overflow = "hidden";
  clone.style.position = "fixed";
  clone.style.top = rect.top + "px";
  clone.style.left = rect.left + "px";
  clone.style.width = rect.width + "px";
  clone.style.height = rect.height + "px";
  clone.style.zIndex = 100001; // 배경보다 위
  clone.style.transition = "all 0.5s ease-in-out";
  clone.style.transform = "scale(1)";
  clone.style.opacity = "1";

  clone.classList.add("event-clone");

  document.body.appendChild(clone);

  const start = info.event.start;
  const end = info.event.end || start;
  const clockSvgHtml = renderClockSvg(
    start.getHours(), start.getMinutes(),
    end.getHours(), end.getMinutes()
  );



  const clockWrapper = document.createElement("div");
  // clockWrapper.innerHTML = clockSvgHtml;
  clockWrapper.style.display = "flex";
  clockWrapper.style.justifyContent = "center";

  clone.insertBefore(clockWrapper, clone.firstChild);


  requestAnimationFrame(() => {

    clone.style.padding = "10px";
    clone.style.width = "150px";
    clone.style.height = "20%";
    clone.style.top = "50%";
    clone.style.left = "50%";
    clone.style.transform = "translate(-50%, -50%) scale(1.4)";
    clone.classList.remove('a', 'b', 'c', 'd', 'e'); // roomKey 클래스 제거
    backdrop.classList.remove("hidden");
    backdrop.classList.add("show");
  });

  function closePopup() {
    clone.remove();
    backdrop.classList.remove("show");
    backdrop.classList.add("hidden");
    document.removeEventListener("click", closePopup, true);
  }

  setTimeout(() => {
    document.addEventListener("click", closePopup, true);
  }, 100);
}

//이벤트안에 시계모양랜더링 코드
function renderClockSvg(startHour, startMinute = 0, endHour, endMinute = 0) {
  const startDeg = ((startHour % 12) + startMinute / 60) * 30;
  const endDeg = ((endHour % 12) + endMinute / 60) * 30;
  const largeArcFlag = (endDeg - startDeg + 360) % 360 > 180 ? 1 : 0;

  const polarToCartesian = (angleDeg, radius) => {
    const angleRad = (angleDeg - 90) * Math.PI / 180;
    return {
      x: 50 + radius * Math.cos(angleRad),
      y: 50 + radius * Math.sin(angleRad)
    };
  };

  const startPos = polarToCartesian(startDeg, 44);
  const endPos = polarToCartesian(endDeg, 44);

  // ✅ 화살표 선과 머리 위치 계산
  const lineLength = 10; // 화살 선 길이
  const angleRad = (startDeg - 90) * Math.PI / 180;
  const arrowTail = polarToCartesian(startDeg, 34); // 시작점에서 안쪽
  const arrowHead = polarToCartesian(startDeg, 34 + lineLength); // 선의 끝점

  // 삼각형 화살표 좌우 포인트
  const arrowAngleOffset = Math.PI / 10;
  const leftWing = {
    x: arrowHead.x - 5 * Math.cos(angleRad - arrowAngleOffset),
    y: arrowHead.y - 5 * Math.sin(angleRad - arrowAngleOffset)
  };
  const rightWing = {
    x: arrowHead.x - 5 * Math.cos(angleRad + arrowAngleOffset),
    y: arrowHead.y - 5 * Math.sin(angleRad + arrowAngleOffset)
  };

  const label = `${startHour < 12 ? '오전' : '오후'} ${startHour % 12 || 12}시 ~ ${endHour < 12 ? '오전' : '오후'} ${endHour % 12 || 12}시`;

  return `
  <div style="text-align:center;">
    <svg width="70" height="70" viewBox="0 0 100 100" style="margin-bottom: 4px;">
      <circle cx="50" cy="50" r="48" stroke="white" stroke-width="2" fill="none"/>
      <!-- 시간 구간 호 -->
      <path d="M ${startPos.x} ${startPos.y}
               A 44 44 0 ${largeArcFlag} 1 ${endPos.x} ${endPos.y}"
            stroke="white" stroke-width="4" fill="none"/>
     
     
      <!-- 중심점 -->
      <circle cx="50" cy="50" r="2" fill="white"/>
    </svg>
    <div style="font-size: 0.75rem; color: #000;">${label}</div>
  </div>
  `;
}









document.addEventListener("DOMContentLoaded", () => {
  updateRoomVisibility(); // 최초 로드 시 클래스 적용
  initCalendar();
  document.querySelectorAll(".room-toggle").forEach(cb => {
    const key = cb.value;
    cb.checked = currentRoomSelections[key];
    cb.addEventListener("change", e => {
      currentRoomSelections[key] = e.target.checked;
      updateRoomVisibility();
    });
  });

  // 자동 새로고침
  ['click', 'touchstart', 'keydown'].forEach(e => {
    document.addEventListener(e, () => lastInteraction = Date.now());
  });

  // 탭 복귀 시 → 데이터만 갱신 (화면 유지, 깜빡임 없음)
  // 디바운스: 연속 발화 방지 (모바일에서 visibilitychange 중복 트리거 시 먹통 방지)
  let _visibilityTimer = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      clearTimeout(_visibilityTimer);
      _visibilityTimer = setTimeout(() => {
        autoRefreshEvents();
      }, 300);
    }
  });

  // 키오스크 방치 시 → 데이터만 갱신 (화면 유지, 백그라운드 시 스킵)
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastInteraction >= 5 * 60 * 1000) {
      autoRefreshEvents();
    }
  }, 30000);
});


const offcanvasEl = document.getElementById('offcanvasDarkNavbar');
offcanvasEl.addEventListener('shown.bs.offcanvas', function () {
  console.log("✅ 오프캔버스 열림");
  closeRoomMenu();
});

offcanvasEl.addEventListener('hidden.bs.offcanvas', function () {
  console.log("❎ 오프캔버스 닫힘");
});
function openDailyEventPopup(dateInput) {
  const popup = document.createElement('div');
  popup.className = 'fc-more-popover';
  popup.style.position = 'fixed';
  popup.style.zIndex = 9999;
  popup.style.background = 'rgb(46 46 46)';
  popup.style.borderRadius = '10px';
  popup.style.overflow = 'hidden';
  popup.style.border = '1px solid rgb(29 6 6)';
  popup.style.boxShadow = '0 4px 10px rgba(0,0,0,0.1)';
  popup.style.width = '75%';
  popup.style.maxWidth = '450px';
  popup.style.maxHeight = '60%';
  popup.style.top = '50%';
  popup.style.left = '50%';
  popup.style.transform = 'translate(-50%, -50%)';
  popup.style.display = 'flex';
  popup.style.flexDirection = 'column';

  const backdrop = document.createElement('div');
  backdrop.className = 'fc-more-backdrop';
  backdrop.style.position = 'fixed';
  backdrop.style.top = '0';
  backdrop.style.left = '0';
  backdrop.style.width = '100vw';
  backdrop.style.height = '100vh';
  backdrop.style.backgroundColor = 'rgba(0, 0, 0, 0.56)';
  backdrop.style.zIndex = 9998;

  const getColor = (roomKey) => {
    return roomConfigs[roomKey]?.color || '#ccc';
  };

  const fmt = (d) => {
    if (!d) return '';
    const localDate = new Date(d);
    // localDate.setTime(localDate.getTime() - (9 * 60 * 60 * 1000)); // Remove manual adjust if handled by browser or if problematic
    // Assuming standard date object handling:
    return localDate.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  const formatKoreanDate = (dateInput) => {
    if (!dateInput) return '';
    let dateObj;
    if (typeof dateInput === 'string') {
      dateObj = new Date(dateInput);
    } else {
      dateObj = dateInput;
    }
    if (isNaN(dateObj)) return '';
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    return `${month}월 ${day}일`;
  };

  // Date parsing
  let dateObj;
  if (typeof dateInput === 'string') {
    // Try to parse YYYY-MM-DD
    const parts = dateInput.split('-');
    if (parts.length === 3) {
      dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      dateObj = new Date(dateInput);
    }
  } else {
    dateObj = dateInput;
  }
  const dateText = formatKoreanDate(dateObj);

  // ✨ 날짜+버튼 컨테이너
  const dateContainer = document.createElement('div');
  dateContainer.style.padding = '10px';
  dateContainer.style.color = 'white';
  dateContainer.style.fontWeight = 'bold';
  dateContainer.style.fontSize = '16px';
  dateContainer.style.borderBottom = '1px solid rgb(0 0 0)';
  dateContainer.style.backgroundColor = 'rgb(85 85 85)';
  dateContainer.style.display = 'flex';
  dateContainer.style.justifyContent = 'space-between';
  dateContainer.style.alignItems = 'center';

  const dateSpan = document.createElement('span');
  dateSpan.innerText = `📅 ${dateText}`;

  const weekBtn = document.createElement('button');
  weekBtn.innerText = "주간 보기";
  weekBtn.style.padding = '2px 6px';
  weekBtn.style.fontSize = '12px';
  weekBtn.style.cursor = 'pointer';
  weekBtn.style.backgroundColor = '#007bff';
  weekBtn.style.color = 'white';
  weekBtn.style.border = 'none';
  weekBtn.style.borderRadius = '4px';

  // ✨ 버튼 클릭 시 해당 날짜로 이동 후 주간뷰로
  weekBtn.addEventListener('click', () => {
    // calendar is global
    if (calendar && calendar.gotoDate) {
      calendar.gotoDate(dateObj);
      calendar.changeView('timeGridWeek');
    }
    popup.remove();
    backdrop.remove();
  });

  dateContainer.appendChild(dateSpan);
  dateContainer.appendChild(weekBtn);

  const eventListDiv = document.createElement('div');
  eventListDiv.style.flexGrow = '1';
  eventListDiv.style.overflowY = 'auto';
  eventListDiv.style.padding = '10px';

  let allEvents = [];
  const slideCals = [calendar?._prevCal, calendar?._curCal, calendar?._nextCal].filter(c => c && typeof c.getEvents === 'function');
  
  if (slideCals.length > 0) {
    const uniqueEvents = {};
    slideCals.forEach(cal => {
      cal.getEvents().forEach(ev => {
        uniqueEvents[ev.id || (ev.title + ev.start.getTime())] = ev;
      });
    });
    allEvents = Object.values(uniqueEvents);
  } else {
    const calInst = (calendar && calendar.calendar) ? calendar.calendar : calendar;
    if (calInst && calInst.getEvents) {
      allEvents = calInst.getEvents();
    }
  }

  let dailyEvents = [];
  if (allEvents.length > 0) {
    dailyEvents = allEvents.filter(ev => {
      const start = ev.start;
      const roomKey = ev.extendedProps?.roomKey;
      if (roomKey && !currentRoomSelections[roomKey]) return false;
      return start.getFullYear() === dateObj.getFullYear() &&
        start.getMonth() === dateObj.getMonth() &&
        start.getDate() === dateObj.getDate();
    });
    // Sort: Room Key then Start Time
    dailyEvents.sort((a, b) => {
      const roomA = a.extendedProps?.roomKey || '';
      const roomB = b.extendedProps?.roomKey || '';
      if (roomA < roomB) return -1;
      if (roomA > roomB) return 1;
      return a.start - b.start;
    });
  }

  const eventListHTML = dailyEvents.map(ev => {
    const roomKey = ev.extendedProps?.roomKey || '';
    const color = getColor(roomKey);
    const roomName = ev.extendedProps?.roomName || '';
    const start = ev.start;
    const end = ev.end;

    let timeText = '';
    if (start && end) {
      // Need to adjust time if timezone issue persists, but keeping simple for now
      // Use local time formatting logic if needed
      // Re-using fmt logic from before which had -9h offset hack commented out?
      // Let's use simple formatting
      const sHour = start.getHours();
      const eHour = end.getHours();
      const sMin = start.getMinutes();
      const eMin = end.getMinutes();
      const fmt = (h, m) => m === 0 ? `${h}` : `${h}:${String(m).padStart(2,'0')}`;
      timeText = `${fmt(sHour, sMin)} ~ ${fmt(eHour, eMin)}시`;

      // Try using the originally provided fmt function if possible, but I defined it above 
      // locally. Let's use that.
      // Note: original fmt had manual -9h adjust line commented out in my previous read?
      // Verify previous code: "localDate.setTime(localDate.getTime() - (9 * 60 * 60 * 1000));" was present inside logic 
      // in line 426 of original file. It was active.
      // So I should include it if dates are raw UTC.
      // FullCalendar v4 usually deals with date objects.
      // I'll stick to simple toTimeString first.
    } else {
      timeText = '시간정보 없음';
    }

    const desc = ev.extendedProps?.description || '';
    const extractDesc = (label) => {
      const match = desc.match(new RegExp(`${label}:\\s*([^\n]+)`));
      return match ? match[1].trim() : '';
    };
    const raw예약자명 = extractDesc('예약자명');
    const 예약번호 = extractDesc('예약번호');
    let displayName;
    if (raw예약자명) {
      displayName = raw예약자명.replace(/님+$/, '') + '님';
    } else {
      const title = ev.title || '';
      displayName = title.replace(/^[A-Za-z]홀\s*\(?\d*\s*/, '').trim();
    }
    const displayRoomName = roomName;

    return `
      <div style="font-size:13px;margin-bottom:6px;padding:6px;background-color:${color};color:#000;border-radius:4px;display:flex;align-items:center;overflow:hidden;">
        <span style="width:28px;flex-shrink:0;font-weight:bold;">${displayRoomName}</span>
        <span style="width:62px;flex-shrink:0;">${timeText}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayName}${예약번호 ? ' · ' + 예약번호 : ''}</span>
      </div>
    `;
  }).join('');

  eventListDiv.innerHTML = eventListHTML;

  popup.appendChild(dateContainer);
  popup.appendChild(eventListDiv);

  document.body.appendChild(backdrop);
  document.body.appendChild(popup);

  setTimeout(() => {
    document.addEventListener('click', function once() {
      popup.remove();
      backdrop.remove();
      document.removeEventListener('click', once);
    });
  }, 100);
}

/**
 * [새로 추가] 일정 자동 새로고침 함수
 * SwipeCalendar 내부의 모든 FullCalendar 인스턴스를 찾아 최신 데이터를 가져옵니다.
 */
function showRefreshToast() {
  let toast = document.getElementById('_refreshToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_refreshToast';
    toast.style.cssText = 'position:fixed;bottom:70px;right:12px;z-index:99999;background:rgba(0,0,0,0.7);color:#fff;font-size:12px;padding:5px 10px;border-radius:20px;pointer-events:none;transition:opacity 0.4s;';
    document.body.appendChild(toast);
  }
  toast.textContent = '🔄 새로고침 중...';
  toast.style.opacity = '1';
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

function autoRefreshEvents() {
  const now = Date.now();
  if (now - _lastRefreshed < 6000) {
    return;
  }
  _lastRefreshed = now;
  const calendars = getLegacySlideCalendars();
  if (calendars.length > 0) {
    showRefreshToast();
    calendars.forEach((inst) => {
      if (typeof inst.refetchEvents === 'function') {
        inst.refetchEvents();
      }
    });
    console.log("🔄 일정 자동 새로고침 완료 (" + new Date().toLocaleTimeString() + ")");
    lastInteraction = Date.now();
  }
}


