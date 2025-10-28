import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { 
  syncAllCalendarsInitial,
  syncAllCalendarsIncremental
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

    // 변경 감지 시 증분 동기화 (변경된 이벤트만!)
    if (resourceState === 'exists') {
      const now = Date.now();
      
      // 쿨다운 체크 (5초 이내 중복 요청 무시)
      if (now - lastSyncTime < SYNC_COOLDOWN) {
        console.log('⏭️ 쿨다운 중, 동기화 생략');
        return res.status(200).send('OK');
      }
      
      lastSyncTime = now;
      console.log('🚀 캘린더 변경 감지, 증분 동기화 실행...');
      
      // 비동기로 증분 동기화 (변경분만 가져오기!)
      syncAllCalendarsIncremental().catch(error => {
        console.error('❌ Webhook 증분 동기화 실패:', error);
      });
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

// 매일 아침 8시에 데이터 검증 (효율적!)
cron.schedule('0 8 * * *', async () => {
  console.log('\n⏰ [정기 검증] 아침 8시 - 데이터 일관성 체크 시작');
  
  try {
    let needsFullSync = false;
    
    // 각 룸별로 이벤트 개수 비교 (빠른 체크!)
    for (const room of [
      { id: 'a', calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com' },
      { id: 'b', calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com' },
      { id: 'c', calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com' },
      { id: 'd', calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com' },
      { id: 'e', calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com' }
    ]) {
      // Supabase 이벤트 개수
      const { count: dbCount, error: dbError } = await supabase
        .from('booking_events')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', room.id);
      
      if (dbError) {
        console.error(`❌ ${room.id}홀 DB 개수 조회 실패:`, dbError.message);
        needsFullSync = true;
        break;
      }
      
      console.log(`  📊 ${room.id}홀: DB ${dbCount}개`);
    }
    
    if (needsFullSync) {
      console.log('⚠️  불일치 감지 → Sync Token 리셋 + 전체 동기화 실행');
      
      // Sync Token 삭제
      await supabase
        .from('calendar_sync_state')
        .delete()
        .neq('room_id', 'impossible-value');
      
      // 전체 재동기화
      await syncAllCalendarsIncremental();
      
      console.log('✅ [정기 검증] 전체 동기화 완료!\n');
    } else {
      console.log('✅ [정기 검증] 데이터 일관성 정상 - 동기화 생략\n');
    }
  } catch (error) {
    console.error('❌ [정기 검증] 오류:', error.message);
  }
}, {
  timezone: "Asia/Seoul"
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 백엔드 서버 실행 중: http://0.0.0.0:${PORT}`);
  console.log('⏰ 정기 검증: 매일 새벽 4시 (한국 시간) - Sync Token 리셋 + 전체 동기화');
});
