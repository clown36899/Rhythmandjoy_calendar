import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
      console.log('🔄 캘린더 변경 감지, 동기화 시작...');
      // 동기화 로직은 sync-calendar.js에서 처리
      // 여기서는 webhook 수신만 확인
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook 처리 오류:', error);
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 백엔드 서버 실행 중: http://0.0.0.0:${PORT}`);
});
