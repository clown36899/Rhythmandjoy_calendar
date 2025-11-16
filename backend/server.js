import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import crypto from 'crypto';
import { 
  syncAllCalendarsInitial,
  syncAllCalendarsIncremental
} from './sync-calendar.js';
import { setupAllWatches } from './setup-watches.js';

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
    
    // 3. 전체 재동기화
    await syncAllCalendarsIncremental();
    
    console.log('✅ [수동 리셋] 전체 동기화 완료!\n');
    res.json({ success: true, message: '전체 데이터 리셋 및 재동기화 완료' });
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
