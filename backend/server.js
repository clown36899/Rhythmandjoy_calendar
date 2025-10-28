import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { 
  syncAllCalendarsIncremental, 
  syncAllCalendarsInitial,
  incrementalSync,
  rooms,
  rangeSync 
} from './sync-calendar.js';
import { setupAllWatches } from './setup-watches.js';

dotenv.config();

const app = express();
app.use(express.json());

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

// 마지막 동기화 시간 추적 (과도한 동기화 방지)
let lastSyncTime = 0;
const SYNC_COOLDOWN = 5000; // 5초

// Google Calendar Webhook 수신 엔드포인트
app.post('/api/calendar-webhook', async (req, res) => {
  try {
    const channelId = req.headers['x-goog-channel-id'];
    const resourceState = req.headers['x-goog-resource-state'];
    
    console.log('📅 Google Calendar Webhook 수신:', { channelId, resourceState });

    // 초기 동기화 확인 메시지는 무시
    if (resourceState === 'sync') {
      return res.status(200).send('OK');
    }

    // 변경 감지 시 해당 룸만 동기화
    if (resourceState === 'exists') {
      const now = Date.now();
      
      // 쿨다운 체크 (5초 이내 중복 요청 무시)
      if (now - lastSyncTime < SYNC_COOLDOWN) {
        console.log('⏭️ 쿨다운 중, 동기화 생략');
        return res.status(200).send('OK');
      }
      
      lastSyncTime = now;
      console.log('🔄 캘린더 변경 감지, 해당 룸만 동기화...');
      
      // 비동기로 특정 룸만 동기화 (응답은 즉시)
      (async () => {
        try {
          // channelId로 room 찾기
          const { data: channel } = await supabase
            .from('calendar_channels')
            .select('room_id')
            .eq('channel_id', channelId)
            .single();
          
          if (channel && channel.room_id) {
            const room = rooms.find(r => r.id === channel.room_id);
            if (room) {
              console.log(`  → ${room.id}홀 변경 감지, 최근 3주만 동기화`);
              
              // 최근 3주 범위 설정
              const now = new Date();
              const timeMin = new Date(now);
              timeMin.setDate(timeMin.getDate() - 7);  // 1주 전
              const timeMax = new Date(now);
              timeMax.setDate(timeMax.getDate() + 14); // 2주 후
              
              await rangeSync(room, timeMin, timeMax);
              console.log(`✅ ${room.id}홀 동기화 완료`);
            }
          } else {
            console.log('  ⚠️ 룸 식별 실패, 전체 동기화');
            await syncAllCalendarsIncremental();
          }
        } catch (error) {
          console.error('❌ Webhook 동기화 실패:', error);
        }
      })();
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook 처리 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// 수동 초기 동기화 엔드포인트 (최근 3주)
app.post('/api/sync', async (req, res) => {
  try {
    console.log('🔄 수동 초기 동기화 요청 받음 (최근 3주)');
    await syncAllCalendarsInitial();
    res.json({ success: true, message: '초기 동기화 완료 (최근 3주)' });
  } catch (error) {
    console.error('❌ 수동 동기화 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 수동 증분 동기화 엔드포인트 (테스트용)
app.post('/api/sync-incremental', async (req, res) => {
  try {
    console.log('🔄 수동 증분 동기화 요청 받음');
    await syncAllCalendarsIncremental();
    res.json({ success: true, message: '증분 동기화 완료' });
  } catch (error) {
    console.error('❌ 증분 동기화 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// Watch 채널 등록 엔드포인트 (테스트용)
app.post('/api/setup-watches', async (req, res) => {
  try {
    console.log('🔔 Watch 채널 등록 요청 받음');
    const results = await setupAllWatches();
    res.json({ success: true, message: 'Watch 채널 등록 완료', results });
  } catch (error) {
    console.error('❌ Watch 등록 실패:', error);
    res.status(500).json({ error: error.message });
  }
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 백엔드 서버 실행 중: http://0.0.0.0:${PORT}`);
});
