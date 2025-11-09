// ✅ SwipeCalendar 안정판: 체크박스 유지 + 날짜 유지 + 동기화 대응 포함 (구형 대응)

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
    className: key,
    color: cfg.color,
    textColor: '#000',
    events: async function(info, successCallback, failureCallback) {
      try {
        // Supabase DB에서 해당 룸의 이벤트 가져오기 (범위 지정)
        const startStr = info.start.toISOString();
        const endStr = info.end.toISOString();
        
        console.log(`📥 [${key}] DB 조회: ${startStr.split('T')[0]} ~ ${endStr.split('T')[0]}`);
        
        const bookings = await window.SupabaseCalendar.fetchBookings(key, startStr, endStr);
        const events = window.SupabaseCalendar.convertToEvents(bookings);
        
        console.log(`✅ [${key}] ${events.length}개 이벤트 로드`);
        successCallback(events);
      } catch (error) {
        console.error(`❌ [${key}] DB 조회 실패:`, error);
        failureCallback(error);
      }
    }
  };
}

function getLegacySlideCalendars() {
  const candidates = [calendar?._prevCal, calendar?._curCal, calendar?._nextCal];
  return candidates.filter(cal => cal && typeof cal.getEventSources === 'function');
}

// 모든 슬라이드의 Event Sources를 DB에서 다시 로드 (3주치 동기화)
function refreshAllEventSources() {
  const calendars = getLegacySlideCalendars();
  
  if (calendars.length === 0) {
    console.warn('⚠️ FullCalendar 인스턴스가 아직 준비되지 않음');
    return;
  }
  
  let totalRefetched = 0;
  calendars.forEach((cal, idx) => {
    const sources = cal.getEventSources();
    sources.forEach(source => {
      source.refetch(); // DB에서 새로 가져옴
      totalRefetched++;
    });
  });
  
  console.log(`✅ DB 동기화 완료: ${calendars.length}개 슬라이드, ${totalRefetched}개 소스`);
}

function updateSourcesDynamicallyAllSlides() {
  const activeKeys = Object.keys(currentRoomSelections).filter(k => currentRoomSelections[k]);
  console.log("\uD83D\uDD01 [동기화 시작] 체크된 룸:", activeKeys);

  const calendars = getLegacySlideCalendars();
  if (calendars.length === 0) {
    console.warn("\u26A0\uFE0F FullCalendar 인스턴스를 가진 슬라이드가 없습니다.");
    return;
  }

  calendars.forEach((inst, idx) => {
    const sources = inst.getEventSources();
    sources.forEach(src => {
      const id = src._raw?.id || src.source?.id || src.id;
      if (id && !activeKeys.includes(id)) {
        console.log(`➖ [${idx}] 제거: ${id}`);
        src.remove();
      }
    });

    activeKeys.forEach(key => {
      const exists = sources.some(src => {
        const id = src._raw?.id || src.source?.id || src.id;
        return id === key;
      });
      if (!exists) {
        console.log(`➕ [${idx}] 추가: ${key}`);
        inst.addEventSource(makeSource(key));
      }
    });
  });

  console.log("✅ 전체 슬라이드 동기화 완료");
}


function select_room_btn_function(aroom_name_key) {

  console.log(aroom_name, "+(select_room_btn_function)");

  const roomKeys = Object.keys(roomConfigs);
  const cal = calendar?.calendar || calendar; // SwipeCalendar 버전 호환

  // ✅ currentRoomSelections 초기화
  roomKeys.forEach(key => {
    currentRoomSelections[key] = false;
  });



  const allSlides = getLegacySlideCalendars(); // ✅ 모든 슬라이드 인스턴스를 가져옴

roomKeys.forEach(key => {
  allSlides.forEach(calInst => {
    const sources = calInst.getEventSources().filter(src => src._raw?.id === key || src.id === key);
    sources.forEach(src => src.remove());
  });
});

  // 1. 기존 모든 소스 제거
  // roomKeys.forEach(key => {
  //   const existingSources = cal.getEventSources().filter(src => src._raw?.id === key || src.id === key);
  //   existingSources.forEach(src => src.remove());
  // });
// 2. 선택한 룸 다시 로드 (모든 슬라이드에 적용)


if (aroom_name_key === 'all') {
  roomKeys.forEach(key => {
    const newSource = makeSource(key);
    allSlides.forEach(inst => inst.addEventSource(newSource));
    currentRoomSelections[key] = true;
  });
  console.log("✅ 모든 룸 이벤트 로드 완료");
} else if (roomConfigs[aroom_name_key]) {
  const newSource = makeSource(aroom_name_key);
  allSlides.forEach(inst => inst.addEventSource(newSource));
  currentRoomSelections[aroom_name_key] = true;
  console.log("✅", aroom_name_key, "이벤트 로드 완료");
} else {
  console.warn("존재하지 않는 룸:", aroom_name_key);
}


  
  // 🔁 체크박스 상태 업데이트
  const checkboxes = document.querySelectorAll('.room-toggle');
  checkboxes.forEach(checkbox => {
    checkbox.checked = currentRoomSelections[checkbox.value];
  });


  updateLayoutClass(aroom_name_key);
}

function updateLayoutClass(aroom_name_key) {
  const body = document.body;
console.log("css제어")
  // 기존 클래스 제거
  body.classList.remove('view-all');

  // 전체 보기면 view-all 클래스 추가
  if (aroom_name_key === 'all') {
    body.classList.add('view-all');
  }
}

const roomOrder = ['Ahall', 'Bhall', 'Chall', 'Dhall', 'Ehall'];

// 오늘 버튼 상태 업데이트 (오늘이 포함된 주면 눌린 상태)
function updateTodayButtonState(info) {
  const todayBtn = document.getElementById('todaybtn');
  if (!todayBtn) {
    console.log('❌ todaybtn 버튼을 찾을 수 없습니다');
    return;
  }
  
  // 오늘 날짜 (시간 제거, 자정으로 정규화)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // 현재 보이는 주/달의 시작/종료 날짜
  const viewStart = new Date(info.start);
  viewStart.setHours(0, 0, 0, 0);
  
  const viewEnd = new Date(info.end);
  viewEnd.setHours(0, 0, 0, 0);
  
  // 오늘이 현재 보이는 범위에 포함되어 있는지 확인
  const isTodayInRange = today >= viewStart && today < viewEnd;
  
  console.log('🔘 오늘 버튼 상태 체크:', {
    오늘: today.toLocaleDateString(),
    시작: viewStart.toLocaleDateString(),
    종료: viewEnd.toLocaleDateString(),
    '오늘포함?': isTodayInRange,
    '현재클래스': todayBtn.className
  });
  
  if (isTodayInRange) {
    // 오늘이 포함된 주: 눌린 상태
    todayBtn.classList.add('fc-button-active');
    console.log('✅ fc-button-active 추가됨');
  } else {
    // 다른 주: 평범한 상태
    todayBtn.classList.remove('fc-button-active');
    console.log('⚪ fc-button-active 제거됨');
  }
}

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

    plugins: ["interaction", "dayGrid", "timeGrid"],
    contentHeight: 400,
    eventSources: roomKeys.filter(k => currentRoomSelections[k]).map(makeSource),
    
    // 날짜 범위가 바뀔 때마다 DB 동기화 (슬라이드, 달 이동 버튼, 페이지 로드)
    datesSet: function(info) {
      console.log('📅 날짜 범위 변경 감지:', info.startStr.split('T')[0], '~', info.endStr.split('T')[0]);
      refreshAllEventSources();
      updateTodayButtonState(info);
    },
    
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
        text: '<',
        click: function () {
          const raw = calendar.getDate();
          const date = new Date(raw);
          const newDate = new Date(date.getFullYear(), date.getMonth() - 1, 1);
          calendar.gotoDate(newDate);
        }
      },
      nextMonth: {
        text: '>',
        click: function () {
          const raw = calendar.getDate();
          const date = new Date(raw);
          const newDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);
          calendar.gotoDate(newDate);
        }
      },
      todayButton: {
        text: '오늘',
        click: function () {
          calendar.today();
          // datesSet 이벤트가 자동으로 발생하지만, 명시적으로 3주치 리셋
          setTimeout(() => {
            refreshAllEventSources();
          }, 100);
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
        columnHeaderFormat: { weekday: "short", day: "numeric" } ,
        dayMaxEvents: true,
        eventOrderStrict: true,  // eventOrder 기준을 엄격하게 적용
        eventOrderStrict:false,
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
        eventLimit:1,
        
        eventLimitText: function(n) {
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

      animateEventClick(info); // ✨ 여기


  
    },
    
    datesRender: (info) => {
         
      // ⭐ 오늘 버튼 상태 업데이트 추가
      updateTodayButtonState({
        start: info.view.activeStart || info.view.currentStart,
        end: info.view.activeEnd || info.view.currentEnd
      });
      
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
            tbodyEl.style.width = '33.3%'; 
            console.log("✅ 월간 뷰 (1000px 초과): .fc tbody width 50% 적용");
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

      setTimeout(updateSourcesDynamicallyAllSlides, 0);
    },
    eventRender: function(info) {
      const viewType = info.view.type;  // 'timeGridWeek', 'dayGridMonth' 등

  
      if (viewType === 'dayGridMonth') {
        // 월간 뷰에서는 .fc-day.fc-today에 삼각형 표시
        document.querySelectorAll('.fc-day.fc-today').forEach((el) => {
          const triangle = document.createElement('div');
          triangle.className = 'custom-triangle';
          el.appendChild(triangle);
        });
      }
      
      if (viewType === 'timeGridWeek') {
        // 주간 뷰에서는 .fc-day-header.fc-today에만 삼각형 표시
        document.querySelectorAll('.fc-day-header.fc-today').forEach((el) => {
          const triangle = document.createElement('div');
          triangle.className = 'custom-triangle';
          el.appendChild(triangle);
        });
      }


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

      const html = `
        <div class="custom-event-box">
          <div class="custom-time">${fmt(start)} ~ ${fmt(end)}</div>
          <div class="custom-title">${title}</div>
          <div class="custom-room">${roomName}</div>
        
          <div class="custom-info"> ${예약정보}</div>
        </div>
      `;
    
      info.el.innerHTML = html;
    },
   
    eventLimitClick: function(cellInfo) {
      console.log("More clicked!", cellInfo);
    
      const popup = document.createElement('div');
      popup.className = 'fc-more-popover';
      popup.style.position = 'fixed';
      popup.style.zIndex = 9999;
      popup.style.background = 'rgb(46 46 46)';
      popup.style.borderRadius = '10px';
      popup.style.overflow = 'hidden';
      popup.style.border = '1px solid rgb(29 6 6)';
      popup.style.boxShadow = '0 4px 10px rgba(0,0,0,0.1)';
      popup.style.width = '260px';
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
        localDate.setTime(localDate.getTime() - (9 * 60 * 60 * 1000)); // 9시간 빼기
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
    
      const rawDate = cellInfo.date || (cellInfo.dayEl?.getAttribute('data-date')) || '';
      const dateObj = new Date(rawDate);
      const dateText = formatKoreanDate(rawDate);
    
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
        calendar.gotoDate(dateObj); // 해당 날짜로 이동
        calendar.changeView('timeGridWeek'); // 주간 뷰로 변경
        popup.remove();
        backdrop.remove();
      });
      
    
      dateContainer.appendChild(dateSpan);
      dateContainer.appendChild(weekBtn);
    
      const eventListDiv = document.createElement('div');
      eventListDiv.style.flexGrow = '1';
      eventListDiv.style.overflowY = 'auto';
      eventListDiv.style.padding = '10px';
    
      const eventListHTML = (cellInfo.segs || []).map(seg => {
        const roomKey = seg.eventRange.def.extendedProps?.roomKey || '';
        const color = getColor(roomKey);
        const title = seg.eventRange.def.title || '';
        const roomName = seg.eventRange.def.extendedProps?.roomName || '';
        const start = seg.eventRange.instance?.range?.start;
        const end = seg.eventRange.instance?.range?.end;
    
        let timeText = '';
        if (start && end) {
          timeText = `${fmt(new Date(start))} ~ ${fmt(new Date(end))}`;
        } else {
          timeText = '시간정보 없음';
        }
    
        return `
          <div style="font-size:10px;margin-bottom:8px;padding:6px;background-color:${color};color:#000;border-radius:6px;">
            <div style="font-size:14px;font-weight:bold;">🕒 ${timeText} ${roomName}</div>
            <div>${title}</div>
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
    
      return false;
    },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false }
  });
  calendar?._curCal.render();
  updateLayoutClass(aroom_name);
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
  initCalendar();
  
  // 페이지를 다시 열 때 (탭 활성화 시) 3주치 DB 리셋
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      console.log('🔄 페이지 다시 활성화 - 3주치 DB 리셋');
      setTimeout(() => {
        refreshAllEventSources();
      }, 500);
    }
  });
  
  document.querySelectorAll(".room-toggle").forEach(cb => {
    const key = cb.value;
    cb.checked = currentRoomSelections[key];
    cb.addEventListener("change", e => {
      currentRoomSelections[key] = e.target.checked;
      updateSourcesDynamicallyAllSlides();
    });
  });
});


const offcanvasEl = document.getElementById('offcanvasDarkNavbar');
offcanvasEl.addEventListener('shown.bs.offcanvas', function () {
  console.log("✅ 오프캔버스 열림");
  closeRoomMenu();
});

offcanvasEl.addEventListener('hidden.bs.offcanvas', function () {
  console.log("❎ 오프캔버스 닫힘");
});