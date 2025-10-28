import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function initializeDatabase() {
  console.log('🗄️  데이터베이스 초기화 시작...\n');

  try {
    // SQL 스키마 파일 읽기
    const schema = fs.readFileSync('../supabase/schema.sql', 'utf8');
    
    // SQL을 개별 명령으로 분리 실행
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.includes('CREATE TABLE') || 
          statement.includes('CREATE INDEX') || 
          statement.includes('ALTER TABLE') ||
          statement.includes('CREATE POLICY') ||
          statement.includes('INSERT INTO')) {
        
        console.log('📝 실행 중:', statement.substring(0, 60) + '...');
        
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        
        if (error) {
          console.warn('⚠️  경고:', error.message);
        } else {
          console.log('   ✅ 성공\n');
        }
      }
    }

    console.log('✅ 데이터베이스 초기화 완료!\n');
    console.log('다음 단계: npm run sync 명령으로 Google Calendar 데이터 동기화');
    
  } catch (error) {
    console.error('❌ 초기화 실패:', error.message);
    process.exit(1);
  }
}

initializeDatabase();
