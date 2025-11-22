import { google } from 'googleapis';

const rooms = [
  { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
  { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
  { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
  { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
  { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
];

let calendar = null;

function initCalendar() {
  if (!calendar) {
    if (!process.env.GOOGLE_CALENDAR_API_KEY) {
      throw new Error('Google Calendar API Key not configured');
    }
    calendar = google.calendar({
      version: 'v3',
      auth: process.env.GOOGLE_CALENDAR_API_KEY
    });
  }
}

export async function handler(event, context) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    initCalendar();

    // Query parameters 파싱
    const { roomIds, startDate, endDate } = event.queryStringParameters || {};

    if (!roomIds || !startDate || !endDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Missing required parameters: roomIds, startDate, endDate' 
        })
      };
    }

    // roomIds 파싱 (쉼표로 구분)
    const roomIdList = roomIds.split(',').map(id => id.trim());

    const timeMin = new Date(startDate).toISOString();
    const timeMax = new Date(endDate).toISOString();

    console.log(`🔍 주간 이벤트 조회: 룸=${roomIdList.join(',')}, 기간=${startDate}~${endDate}`);

    const events = {};

    // 각 룸별로 이벤트 조회
    for (const roomId of roomIdList) {
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        console.warn(`⚠️ 알 수 없는 룸: ${roomId}`);
        continue;
      }

      try {
        events[roomId] = [];
        let pageToken = null;

        do {
          const response = await calendar.events.list({
            calendarId: room.calendarId,
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            pageToken: pageToken
          });

          const items = response.data.items || [];
          
          // dateTime만 처리 (종일 이벤트 제외)
          for (const event of items) {
            if (!event.start || !event.start.dateTime) continue;
            
            events[roomId].push({
              id: event.id,
              title: event.summary || '(제목 없음)',
              start: event.start.dateTime,
              end: event.end?.dateTime,
              description: event.description || null,
              roomId: roomId
            });
          }

          pageToken = response.data.nextPageToken;
        } while (pageToken);

        console.log(`✅ 룸 ${roomId}: ${events[roomId].length}개 이벤트 조회됨`);
      } catch (error) {
        console.error(`❌ 룸 ${roomId} 조회 실패:`, error.message);
        events[roomId] = [];
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        startDate,
        endDate,
        events,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('❌ 에러:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
}
