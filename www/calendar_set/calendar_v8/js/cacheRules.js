/**
 * cacheRules.js - 메모리 캐시 키 규칙 관리
 */

class CacheRules {
  /**
   * 🔴 [필터링 키] 주간 데이터 필터링용 캐시 키
   * 형식: YYYY-MM-DDTHH:mm:ss
   * 예: 2025-11-23T15:00:00
   * 
   * 역할: weekDataCache에서 주 범위로 필터링한 데이터 저장
   * getWeekRange 기반 - calendar 인스턴스에서 호출
   */
  static getWeekCacheKey(date, getWeekRange) {
    const { start } = getWeekRange(date);
    const year = start.getFullYear();
    const month = String(start.getMonth() + 1).padStart(2, "0");
    const day = String(start.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}T15:00:00`;
  }

  /**
   * 🟢 [새로 추가] 월간 데이터 캐시 키
   * 형식: M:YYYY-MM
   * 예: M:2025-12
   * 
   * 역할: monthDataCache에서 월 전체 데이터 저장
   */
  static getMonthCacheKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `M:${year}-${month}`;
  }

  /**
   * 🟢 [변환] 연간 데이터를 월/주 단위로 분할하여 메모리 캐시에 저장
   * 
   * @param {Array} monthEvents - 월간 범위의 이벤트 배열
   * @param {Map} monthDataCache - 월간 캐시 (저장용)
   * @param {Map} weekDataCache - 주간 캐시 (저장용)
   * @param {string} monthKey - 월간 캐시 키 (M:2025-12)
   * @param {string} weekKey - 주간 필터링 키 (2025-11-23T15:00:00)
   */
  static convertAndStoreEvents(
    monthEvents,
    monthDataCache,
    weekDataCache,
    monthKey,
    weekKey
  ) {
    // 1. monthDataCache에 월간 데이터 저장 (월 단위 키)
    monthDataCache.set(monthKey, monthEvents);
    window._originalConsole.log(
      `🟣 [필터링] 1️⃣ monthDataCache 저장: ${monthKey} (${monthEvents.length}개)`
    );

    // 2. weekDataCache에 주간 데이터 저장 (주 단위 키)
    weekDataCache.set(weekKey, monthEvents);
    window._originalConsole.log(
      `🟣 [필터링] 2️⃣ weekDataCache 저장: ${weekKey} (${monthEvents.length}개)`
    );
  }

  /**
   * 🟢 [조회] 메모리 캐시에서 월간 데이터 조회
   * @param {Map} monthDataCache - 월간 캐시
   * @param {string} key - 캐시 키
   * @returns {Array} 이벤트 배열
   */
  static getMonthEvents(monthDataCache, key) {
    return monthDataCache.get(key) || [];
  }

  /**
   * 🟢 [조회] 메모리 캐시에서 주간 데이터 조회
   * @param {Map} weekDataCache - 주간 캐시
   * @param {string} key - 캐시 키
   * @returns {Array} 이벤트 배열
   */
  static getWeekEvents(weekDataCache, key) {
    return weekDataCache.get(key) || [];
  }

  /**
   * 🟢 [저장] 메모리 캐시에 월간 데이터 저장
   * @param {Map} monthDataCache - 월간 캐시
   * @param {string} key - 캐시 키
   * @param {Array} events - 이벤트 배열
   */
  static setMonthEvents(monthDataCache, key, events) {
    monthDataCache.set(key, events);
  }

  /**
   * 🟢 [저장] 메모리 캐시에 주간 데이터 저장
   * @param {Map} weekDataCache - 주간 캐시
   * @param {string} key - 캐시 키
   * @param {Array} events - 이벤트 배열
   */
  static setWeekEvents(weekDataCache, key, events) {
    weekDataCache.set(key, events);
  }

  /**
   * 🟢 [확인] 메모리 캐시에 월간 데이터가 있는지 확인
   * @param {Map} monthDataCache - 월간 캐시
   * @param {string} key - 캐시 키
   * @returns {boolean} 데이터 존재 여부
   */
  static hasMonthEvents(monthDataCache, key) {
    // 🔴 [수정] 빈 배열도 캐시 HIT로 처리 (length 체크 제거)
    return monthDataCache.has(key);
  }

  /**
   * 🟢 [확인] 메모리 캐시에 주간 데이터가 있는지 확인
   * @param {Map} weekDataCache - 주간 캐시
   * @param {string} key - 캐시 키
   * @returns {boolean} 데이터 존재 여부
   */
  static hasWeekEvents(weekDataCache, key) {
    // 🔴 [수정] 빈 배열도 캐시 HIT로 처리 (length 체크 제거)
    return weekDataCache.has(key);
  }


  /**
   * 🟢 [삭제] 메모리 캐시에서 주간 데이터 삭제
   * @param {Map} weekDataCache - 주간 캐시
   * @param {string} key - 캐시 키
   */
  static deleteWeekEvents(weekDataCache, key) {
    weekDataCache.delete(key);
  }

  /**
   * 🟢 [삭제] 메모리 캐시에서 월간 데이터 삭제
   * @param {Map} monthDataCache - 월간 캐시
   * @param {string} key - 캐시 키
   */
  static deleteMonthEvents(monthDataCache, key) {
    monthDataCache.delete(key);
  }

  /**
   * 🟢 [연도 추출] 캐시키에서 연도 추출
   * @param {string} cacheKey - 캐시 키 (12month-2025 또는 2025-11-23T15:00:00)
   * @returns {number} 연도 (2025)
   */
  static getYearFromCacheKey(cacheKey) {
    if (!cacheKey) return null;
    // "12month-2025" 형식
    if (cacheKey.includes("12month")) {
      return parseInt(cacheKey.split("-")[1], 10);
    }
    // "2025-11-23T15:00:00" 형식
    return parseInt(cacheKey.split("-")[0], 10);
  }
}
