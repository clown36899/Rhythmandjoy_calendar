// Supabase 기반 이벤트 소스 어댑터
// fullcal_02.js와 함께 사용됩니다

// 🚀 Supabase 기반 이벤트 소스 생성 (보이는 범위만 로드)
function makeSupabaseSource(key) {
  const cfg = roomConfigs[key];
  
  return {
    id: key,
    className: key,
    color: cfg.color,
    textColor: '#000',
    events: async function(info, successCallback, failureCallback) {
      try {
        // Supabase 모듈이 로드될 때까지 대기
        if (typeof window.SupabaseCalendar === 'undefined') {
          console.warn('⚠️ Supabase 모듈이 아직 로드되지 않았습니다.');
          
          setTimeout(() => {
            if (typeof window.SupabaseCalendar !== 'undefined') {
              makeSupabaseSource(key).events(info, successCallback, failureCallback);
            } else {
              failureCallback('Supabase module not loaded');
            }
          }, 500);
          return;
        }

        // 💡 보이는 범위만 요청 (효율적!)
        const bookings = await window.SupabaseCalendar.fetchBookings(
          key, 
          info.startStr, 
          info.endStr
        );
        
        const events = window.SupabaseCalendar.convertToEvents(bookings);
        console.log(`✅ ${cfg.name} ${events.length}개 이벤트 로드 (${info.startStr.split('T')[0]} ~ ${info.endStr.split('T')[0]})`);
        successCallback(events);
      } catch (error) {
        console.error(`❌ ${cfg.name} 이벤트 로드 실패:`, error);
        failureCallback(error);
      }
    }
  };
}

// makeSource 함수 오버라이드 (fullcal_02.js 로드 대기)
function overrideMakeSource() {
  if (typeof makeSource !== 'undefined') {
    console.log('🔄 makeSource를 Supabase 범위별 로드 버전으로 교체합니다');
    const originalMakeSource = makeSource;
    
    window.makeSourceOriginal = originalMakeSource;
    window.makeSource = function(key) {
      return makeSupabaseSource(key);
    };
    
    makeSource = window.makeSource;
    
    console.log('✅ makeSource 오버라이드 완료 (범위별 로드 모드)');
  } else {
    console.warn('⏳ makeSource가 아직 정의되지 않음, 100ms 후 재시도...');
    setTimeout(overrideMakeSource, 100);
  }
}

// DOM 로드 후 오버라이드 시도
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', overrideMakeSource);
} else {
  overrideMakeSource();
}

console.log('✅ Supabase 어댑터 로드 완료 (범위별 로드)');
