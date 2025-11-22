import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { google } from 'googleapis';

dotenv.config();

const app = express();
app.use(express.json());

// 간단한 세션 토큰 저장소 (메모리)
const activeSessions = new Map();

// 토큰 생성 함수
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 인증 미들웨어
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ error: '인증이 필요합니다' });
  }
  
  next();
}

// 정적 파일 서빙 (www 폴더)
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../www')));

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// Google Calendar 주간 이벤트 조회 (get-week-events)
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
    calendar = google.calendar({
      version: 'v3',
      auth: process.env.GOOGLE_CALENDAR_API_KEY
    });
  }
}

app.get('/api/get-week-events', async (req, res) => {
  const { roomIds, startDate, endDate } = req.query;

  if (!roomIds || !startDate || !endDate) {
    return res.status(400).json({ 
      error: 'Missing required parameters: roomIds, startDate, endDate' 
    });
  }

  try {
    initCalendar();

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

    res.json({
      success: true,
      startDate,
      endDate,
      events,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 에러:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 관리자 로그인 API
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  
  if (password === process.env.ADMIN_PASSWORD) {
    const token = generateToken();
    activeSessions.set(token, { createdAt: Date.now() });
    
    console.log('✅ 관리자 로그인 성공');
    res.json({ success: true, token });
  } else {
    console.log('❌ 관리자 로그인 실패');
    res.status(401).json({ error: '비밀번호가 올바르지 않습니다' });
  }
});

// 로그 저장 API (클라이언트에서 전송)
app.post('/api/logs', async (req, res) => {
  try {
    const { level, message, data, userAgent, url } = req.body;
    
    const { error } = await supabase
      .from('logs')
      .insert([{
        level,
        message,
        data,
        user_agent: userAgent,
        url
      }]);
    
    if (error) {
      console.error('❌ 로그 저장 실패:', error);
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 로그 API 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 로그 조회 API (최근 N개)
app.get('/api/logs', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('❌ 로그 조회 실패:', error);
      return res.status(500).json({ error: error.message });
    }
    
    res.json({ success: true, logs: data, count: data.length });
  } catch (error) {
    console.error('❌ 로그 조회 API 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 관리자 로그아웃 API
app.post('/api/admin/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  activeSessions.delete(token);
  
  console.log('✅ 관리자 로그아웃');
  res.json({ success: true });
});

// 헬스체크 엔드포인트
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 특정 룸의 예약 조회 API
app.get('/api/bookings/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { start, end } = req.query;

    let query = supabase
      .from('booking_events')
      .select('*')
      .eq('room_id', roomId)
      .order('start_time', { ascending: true });

    if (start) {
      query = query.gte('start_time', start);
    }
    if (end) {
      query = query.lte('end_time', end);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('❌ 예약 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ✨ NEW: 월별 매출 조회 API (캘린더 조회 + 계산 + 저장)
app.get('/api/admin/revenue', requireAuth, async (req, res) => {
  try {
    initCalendar();

    const now = new Date();
    const year = parseInt(req.query.year || now.getFullYear(), 10);
    const month = parseInt(req.query.month || now.getMonth() + 1, 10);

    console.log(`💰 [매출 조회] ${year}-${String(month).padStart(2, '0')} 요청`);

    // 조회 대상 월의 시작일과 종료일
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    
    // 저번달 이전인지 확인 (현재 월/이후 달 = 캘린더 조회, 그 이전 = DB 조회)
    const isCurrentOrFuture = year > now.getFullYear() || 
                             (year === now.getFullYear() && month >= now.getMonth() + 1);

    let revenue = 0;
    let bookings = 0;
    const byRoom = { a: 0, b: 0, c: 0, d: 0, e: 0 };

    if (isCurrentOrFuture) {
      // 🔥 Google Calendar에서 조회 + 계산
      console.log(`   📡 [Google Calendar 조회] ${year}-${String(month).padStart(2, '0')}`);
      
      const events = {};
      const roomIdList = ['a', 'b', 'c', 'd', 'e'];
      
      // 모든 룸의 이벤트 조회
      for (const roomId of roomIdList) {
        const room = rooms.find(r => r.id === roomId);
        if (!room) continue;

        events[roomId] = [];
        let pageToken = null;

        try {
          do {
            const response = await calendar.events.list({
              calendarId: room.calendarId,
              timeMin: monthStart.toISOString(),
              timeMax: monthEnd.toISOString(),
              singleEvents: true,
              orderBy: 'startTime',
              pageToken: pageToken
            });

            const items = response.data.items || [];
            for (const event of items) {
              if (!event.start || !event.start.dateTime) continue;
              
              events[roomId].push({
                roomId: roomId,
                title: event.summary || '(제목 없음)',
                start: event.start.dateTime,
                end: event.end?.dateTime,
                description: event.description || null
              });
            }

            pageToken = response.data.nextPageToken;
          } while (pageToken);

          console.log(`   ✅ 룸 ${roomId}: ${events[roomId].length}개 이벤트`);
        } catch (error) {
          console.error(`   ❌ 룸 ${roomId} 조회 실패:`, error.message);
          events[roomId] = [];
        }
      }

      // 계산: 간단한 시간 기반 가격 (30분당 10,000원)
      for (const roomId in events) {
        for (const event of events[roomId]) {
          const startTime = new Date(event.start);
          const endTime = new Date(event.end);
          const durationMinutes = (endTime - startTime) / (1000 * 60);
          const price = Math.ceil(durationMinutes / 30) * 10000;
          
          revenue += price;
          byRoom[roomId] += price;
          bookings++;
        }
      }

      // DB에 저장 (statistics 또는 monthly_revenue 테이블)
      if (revenue > 0 || bookings > 0) {
        const { error: saveError } = await supabase
          .from('monthly_revenue')
          .upsert({
            year,
            month,
            total_revenue: revenue,
            total_bookings: bookings,
            by_room: byRoom,
            source: 'calendar', // 캘린더에서 계산
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'year,month'
          });

        if (saveError) {
          console.warn(`   ⚠️ DB 저장 실패 (계속 진행):`, saveError.message);
        } else {
          console.log(`   💾 DB 저장 완료`);
        }
      }
    } else {
      // DB에서 조회 (저번달 이전)
      console.log(`   🗄️ [DB 조회] ${year}-${String(month).padStart(2, '0')} (이전 데이터)`);
      
      const { data, error } = await supabase
        .from('monthly_revenue')
        .select('*')
        .eq('year', year)
        .eq('month', month)
        .single();

      if (error && error.code !== 'PGRST116') { // 404가 아닌 다른 에러
        console.error('   ❌ DB 조회 실패:', error.message);
        throw error;
      }

      if (data) {
        revenue = data.total_revenue || 0;
        bookings = data.total_bookings || 0;
        Object.assign(byRoom, data.by_room || byRoom);
        console.log(`   ✅ DB에서 조회: ${revenue.toLocaleString()}원`);
      } else {
        console.log(`   ℹ️ DB에 데이터 없음 (이전 데이터 미수집)`);
      }
    }

    res.json({
      success: true,
      year,
      month,
      revenue,
      bookings,
      byRoom,
      isCurrentOrFuture
    });
  } catch (error) {
    console.error('❌ 매출 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// 수동 리셋 엔드포인트 (모든 데이터 삭제 + 전체 재동기화) - 관리자 전용
app.post('/api/reset-sync', requireAuth, async (req, res) => {
  try {
    console.log('🔄 [수동 리셋] 전체 데이터 리셋 + 재동기화 시작');
    
    // 1. 모든 예약 이벤트 삭제
    const { error: eventsDeleteError } = await supabase
      .from('booking_events')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000'); // 모든 행 삭제 (UUID 최소값)
    
    if (eventsDeleteError) {
      console.error('❌ 예약 이벤트 삭제 실패:', eventsDeleteError.message);
      return res.status(500).json({ error: eventsDeleteError.message });
    }
    
    console.log('✅ 모든 예약 이벤트 삭제 완료');
    
    // 2. Sync Token 전체 삭제
    const { error: tokenDeleteError } = await supabase
      .from('calendar_sync_state')
      .delete()
      .neq('room_id', 'impossible-value');
    
    if (tokenDeleteError) {
      console.error('❌ Sync Token 삭제 실패:', tokenDeleteError.message);
      return res.status(500).json({ error: tokenDeleteError.message });
    }
    
    console.log('✅ 모든 Sync Token 삭제 완료');
    
    console.log('✅ [수동 리셋] 전체 데이터 삭제 완료!\n');
    res.json({ success: true, message: '전체 데이터 리셋 완료' });
  } catch (error) {
    console.error('❌ [수동 리셋] 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 백엔드 서버 실행 중: http://0.0.0.0:${PORT}`);
  console.log('📡 Webhook: POST /api/calendar-webhook (Google Calendar 실시간 동기화)');
  console.log('🔧 수동 리셋: POST /api/reset-sync');
});
