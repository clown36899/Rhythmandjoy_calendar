import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTables() {
  console.log('🚀 Supabase 테이블 생성 시작...\n');

  // calendar_sync_state 테이블 생성
  console.log('📝 calendar_sync_state 테이블 생성 중...');
  const { error: syncStateError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS calendar_sync_state (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id),
        sync_token TEXT,
        last_synced_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  });

  if (syncStateError) {
    console.error('❌ calendar_sync_state 생성 실패:', syncStateError.message);
  } else {
    console.log('✅ calendar_sync_state 테이블 생성 완료');
  }

  // calendar_channels 테이블 생성
  console.log('📝 calendar_channels 테이블 생성 중...');
  const { error: channelsError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS calendar_channels (
        room_id TEXT PRIMARY KEY REFERENCES rooms(id),
        calendar_id TEXT NOT NULL,
        channel_id TEXT NOT NULL UNIQUE,
        resource_id TEXT NOT NULL,
        expiration BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  });

  if (channelsError) {
    console.error('❌ calendar_channels 생성 실패:', channelsError.message);
  } else {
    console.log('✅ calendar_channels 테이블 생성 완료');
  }

  console.log('\n✅ 모든 테이블 생성 완료!');
}

createTables()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ 오류:', error);
    process.exit(1);
  });
