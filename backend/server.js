import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { syncAllCalendars, syncRoomCalendar } from './sync-calendar.js';
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

    // 변경 감지 시 동기화 트리거
    if (resourceState === 'exists') {
      const now = Date.now();
      
      // 쿨다운 체크 (5초 이내 중복 요청 무시)
      if (now - lastSyncTime < SYNC_COOLDOWN) {
        console.log('⏭️ 쿨다운 중, 동기화 생략');
        return res.status(200).send('OK');
      }
      
      lastSyncTime = now;
      console.log('🔄 캘린더 변경 감지, 동기화 시작...');
      
      // 비동기로 동기화 실행 (응답은 즉시)
      syncAllCalendars().catch(error => {
        console.error('❌ 자동 동기화 실패:', error);
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook 처리 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// 수동 동기화 트리거 엔드포인트 (테스트용)
app.post('/api/sync', async (req, res) => {
  try {
    console.log('🔄 수동 동기화 요청 받음');
    await syncAllCalendars();
    res.json({ success: true, message: '동기화 완료' });
  } catch (error) {
    console.error('❌ 수동 동기화 실패:', error);
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
