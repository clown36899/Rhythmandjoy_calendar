// 📅 구글 API 초기 설정
const API_KEY = "AIzaSyCLqM39X5vTjrNt1Vl5miRryXWkLYPqky8"; // <= 수정할 예정
const CALENDAR_IDS = {
  Ahall: "752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com",
  Bhall: "22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com",
  Chall: "b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com",
  Dhall: "60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com",
  Ehall: "aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com",
};

// 🏷️ 가격표
const PRICE_TABLE = {
  Ahall: { before16: 10000, after16: 12000, earlyMorning: 6000, earlyMorningAllDay: 30000 },
  Bhall: { before16: 8000, after16: 10000, earlyMorning: 4000, earlyMorningAllDay: 20000 },
  Chall: { before16: 4000, after16: 6000, earlyMorning: 4000, earlyMorningAllDay: 15000 },
  Dhall: { before16: 3000, after16: 5000, earlyMorning: 3000, earlyMorningAllDay: 15000 },
  Ehall: { before16: 8000, after16: 10000, earlyMorning: 4000, earlyMorningAllDay: 20000 },
};

document.getElementById('fetchButton').addEventListener('click', fetchCalendarEvents);

function fetchCalendarEvents() {
  gapi.load('client', async () => {
    await gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"],
    });

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    let allEvents = [];

    for (const [roomKey, calendarId] of Object.entries(CALENDAR_IDS)) {
      try {
        const response = await gapi.client.calendar.events.list({
          calendarId: calendarId,
          timeMin: firstDay.toISOString(),
          timeMax: lastDay.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
        });

        const events = response.result.items.map(event => ({
          room: roomKey,
          start: new Date(event.start.dateTime),
          end: new Date(event.end.dateTime),
          title: event.summary || '제목 없음'
        }));

        allEvents = allEvents.concat(events);

      } catch (error) {
        console.error(`${roomKey} 캘린더 가져오기 실패:`, error);
      }
    }

    console.log("✅ 전체 이벤트 가져오기 완료:", allEvents);
    calculateAndDisplay(allEvents);
  });
}

function calculateAndDisplay(events) {
  const monthlyData = {};

  events.forEach(event => {
    const { room, start, end } = event;
    const roomPrices = PRICE_TABLE[room];

    if (!roomPrices) return;

    const dayKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;

    if (!monthlyData[dayKey]) {
      monthlyData[dayKey] = {};
    }

    if (!monthlyData[dayKey][room]) {
      monthlyData[dayKey][room] = 0;
    }

    let totalPrice = 0;
    let current = new Date(start);

    while (current < end) {
      const hour = current.getHours();
      if (hour >= 0 && hour < 6) {
        totalPrice += roomPrices.earlyMorning;
      } else if (hour >= 6 && hour < 16) {
        totalPrice += roomPrices.before16;
      } else if (hour >= 16 && hour < 24) {
        totalPrice += roomPrices.after16;
      }
      current.setHours(current.getHours() + 1);
    }

    // 새벽통 대관 처리
    if (start.getHours() === 0 && (end - start) >= 6 * 60 * 60 * 1000) {
      totalPrice = roomPrices.earlyMorningAllDay;
    }

    monthlyData[dayKey][room] += totalPrice;
  });

  renderTable(monthlyData);
}

function renderTable(data) {
  const output = document.getElementById('output');
  output.innerHTML = '';

  let html = `<table id="resultTable"><thead><tr><th>월</th><th>방</th><th>금액</th></tr></thead><tbody>`;

  for (const month in data) {
    for (const room in data[month]) {
      html += `<tr><td>${month}</td><td>${room}</td><td>${data[month][room].toLocaleString()}원</td></tr>`;
    }
  }

  html += `</tbody></table>`;
  output.innerHTML = html;
}