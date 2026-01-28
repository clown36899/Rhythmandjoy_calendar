/**
 * SyncManager
 * - Supabase: Realtime 신호만 사용 (데이터 저장 안 함)
 * - 데이터 소스: Google Calendar API (Direct Proxy)
 * - 저장소: IndexedDB
 */
class SyncManager {
    constructor(indexedDBManager, supabaseClient) {
        this.db = window.indexedDBManager;
        this.supabase = supabaseClient; // Realtime 신호용만
        this.isSyncing = new Map(); // 중복 요청 방지
        this.debounceTimer = new Map(); // Webhook Debounce
        this.syncQueue = Promise.resolve(); // Webhook 순차 처리 큐
        this.TTL_MS = 5 * 60 * 1000; // 5분 캐시
        this.webhookDebounceTimer = null; // Webhook 중복 방지용
        this.WEBHOOK_DEBOUNCE_MS = 1000; // 1초 내 중복 신호 무시
        this.pendingSyncRoomIds = new Set(); // 🎯 [Target Sync] 동기화할 룸 ID 목록
    }



    /**
     * 특정 월 동기화
     * @param {number} year 
     * @param {number} month (0-indexed)
     * @param {boolean} force - true면 TTL 무시하고 전체 동기화
     * @param {boolean} skipTTL - true면 TTL만 무시하고 증분 동기화 (Webhook용)
     */
    async syncMonth(year, month, force = false, skipTTL = false) {
        const syncKey = `${year}-${month}`;

        // 중복 요청 방지
        if (this.isSyncing.has(syncKey)) {
            console.log(`⚠️ [SyncManager] ${syncKey} 이미 동기화 중`);
            return;
        }

        try {
            // TTL 체크 (force나 skipTTL이 true면 스킵)
            if (!force && !skipTTL) {
                const lastSyncedAt = await this.db.getLastSync(year, month);
                if (lastSyncedAt) {
                    const elapsed = Date.now() - new Date(lastSyncedAt).getTime();
                    if (elapsed < this.TTL_MS) {
                        console.log(`⏭️ [SyncManager] ${syncKey} TTL 유효 (${Math.round(elapsed / 1000)}초) - 동기화 스킵`);
                        return;
                    }
                }
            }

            this.isSyncing.set(syncKey, true); // Map 사용

            // 1. updatedMin 계산 (증분 동기화용)
            let updatedMin = null;
            if (!force) {
                const lastSync = await this.db.getLastSync(year, month);
                if (lastSync) {
                    // 🛡️ [Safety Buffer] 2분 전부터 조회하여 누락 방지 (Clock Skew 등 대비)
                    // 중복 데이터는 mergeMonth에서 ID 기준으로 처리되므로 안전함.
                    const bufferTime = new Date(new Date(lastSync).getTime() - 2 * 60 * 1000);
                    updatedMin = bufferTime.toISOString();
                }
            }

            console.log(`🔄 [Incremental Sync] ${syncKey} - updatedMin: ${updatedMin || '없음 (Full Sync)'}`);

            // 2. 서버(Proxy)에서 데이터 가져오기
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

            // updatedMin이 있으면 증분, 없으면 전체
            const events = await this.fetchEventsFromProxy(startDate, endDate, updatedMin);

            const deletedCount = events.filter(e => e.status === 'cancelled').length;

            // 💡 [최적화] 변경된 데이터가 없으면 조용히 TTL만 갱신하고 종료
            if (events.length === 0) {
                // window.FORCE_LOG(`💤 [Sync] ${year}-${month + 1}월 변경사항 없음 (TTL 갱신)`);
                await this.db.setLastSync(year, month);
                return;
            }

            // 💡 [중요] 데이터가 있을 때만 로그 출력
            if (window.FORCE_LOG) {
                window.FORCE_LOG(`📊 [Sync] 데이터 수신: 총 ${events.length}개 (삭제: ${deletedCount}개)`);
                if (events.length > 0) {
                    // window.FORCE_LOG('   데이터:', events); // 필요시 주석 해제
                }
            }

            // 3. IndexedDB에 병합 (Merge) 또는 덮어쓰기 (Overwrite)
            // 🚨 [Critical] updatedMin 갱신용 시간은 '동기화 시작 시점' 기준이어야 함 (누락 방지)
            const syncStartTime = new Date().toISOString();

            if (force || !updatedMin) {
                // Full Sync 또는 최초 동기화 -> 덮어쓰기
                await this.db.overwriteMonth(year, month, events, syncStartTime);
                if (window.FORCE_LOG) window.FORCE_LOG(`✅ [Sync] ${year}-${month + 1}월 덮어쓰기 완료`);
            } else {
                // 증분 동기화 -> 병합
                await this.db.mergeMonth(year, month, events, syncStartTime);
                if (window.FORCE_LOG) window.FORCE_LOG(`✅ [Sync] ${year}-${month + 1}월 병합(Merge) 완료`);
            }

            // 4. UI 갱신 알림 (변경된 데이터가 있을 때만)
            const event = new CustomEvent('calendar-data-changed', {
                detail: {
                    year,
                    month,
                    action: updatedMin ? 'merge' : 'overwrite',
                    count: events.length
                }
            });
            window.dispatchEvent(event);

        } catch (error) {
            console.error(`❌ [SyncManager] ${syncKey} 동기화 실패:`, error);
        } finally {
            this.isSyncing.delete(syncKey);
        }
    }



    /**
     * 전역 증분 동기화 (모든 미래 데이터 대상)
     * @param {string} updatedMin - 이 시간 이후 변경된 데이터만 가져옴
     * @param {Array|null} targetRoomIds - 특정 룸만 동기화할 경우 (없으면 전체)
     */
    async syncGlobalChanges(updatedMin, targetRoomIds = null) {
        if (!updatedMin) {
            console.warn('⚠️ [Global Sync] updatedMin이 없습니다. 전체 동기화를 권장합니다.');
            return;
        }

        const syncKey = 'global-incremental';
        if (this.isSyncing.has(syncKey)) {
            console.log('⚠️ [Global Sync] 이미 진행 중입니다.');
            return false;
        }
        this.isSyncing.set(syncKey, true);

        try {
            console.log(`🔄 [Global Sync] 시작 (updatedMin: ${updatedMin})`);

            // 범위: 현재 ~ 1년 6개월 후 (사용자 요청)
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 18, 1);

            // 데이터 가져오기 (PublicCalendarSync가 updatedMin을 처리함)
            const events = await this.fetchEventsFromProxy(start, end, updatedMin, targetRoomIds);

            if (events.length > 0) {
                console.log(`📊 [Global Sync] ${events.length}개 변경사항 수신`);

                // DB 병합 (Bulk Merge)
                await this.db.mergeBulkEvents(events);

                // 💡 [Fix] 변경된 이벤트가 속한 모든 월을 추출하여 UI 갱신 신호 전송
                // (단일 이벤트가 아니라 여러 월에 걸쳐 있을 수 있음)
                const affectedMonths = new Set();
                events.forEach(e => {
                    const d = new Date(e.start);
                    affectedMonths.add(`${d.getFullYear()}-${d.getMonth()}`);
                });

                affectedMonths.forEach(key => {
                    const [y, m] = key.split('-').map(Number);
                    const event = new CustomEvent('calendar-data-changed', {
                        detail: {
                            year: y,
                            month: m,
                            action: 'merge',
                            count: events.length // 정확한 개수는 아니지만 신호용으로 충분
                        }
                    });
                    window.dispatchEvent(event);
                });

                console.log(`✅ [Global Sync] 완료. ${affectedMonths.size}개 월 UI 갱신 신호 전송`);
            } else {
                console.log('💤 [Global Sync] 변경사항 없음');
            }

            return true;

        } catch (error) {
            console.error('❌ [Global Sync] 실패:', error);
        } finally {
            this.isSyncing.delete(syncKey);
        }
    }

    /**
     * Proxy 서버를 통해 Google Calendar 이벤트 가져오기
     * @param {Date} start 
     * @param {Date} end 
     * @param {string|null} updatedMin 
     */
    async fetchEventsFromProxy(start, end, updatedMin = null, targetRoomIds = null) {
        // 💡 [Modified] 서버 프록시 대신 직접 구글 API 호출 (PublicCalendarSync 사용)
        if (window.publicCalendarSync) {
            return await window.publicCalendarSync.fetchEvents(start, end, updatedMin, targetRoomIds);
        }
    }

    /**
     * 특정 기간의 모든 달 동기화 (백그라운드 동기화용)
     * @param {Date} startDate - 시작 날짜
     * @param {Date} endDate - 종료 날짜
     */
    async syncDataRange(startDate, endDate) {
        const months = [];
        const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

        // 모든 달 목록 생성
        while (current <= end) {
            months.push({ year: current.getFullYear(), month: current.getMonth() });
            current.setMonth(current.getMonth() + 1);
        }


        console.log(`📅 [Background Sync] ${months.length}개월 동기화 예정(연속3개월이상 데이터없는 미래한계)`);

        // 🔄 순차 처리 (순서 보장)
        for (const { year, month } of months) {
            await this.syncMonth(year, month, false); // TTL 체크 포함
        }

        console.log(`✅ [Background Sync] ${months.length}개월 동기화 완료`);
    }


    /**
     * 실시간 변경 알림 처리 (Webhook) - 순차 처리 보장
     * @param {Object} payload 
     */
    async handleRealtimeEvent(payload) {
        console.log(`⚡ [Webhook] 변경 신호 수신:`, payload);

        // 🛡️ [Global Debounce] 모든 룸의 신호를 하나로 뭉쳐서 처리 (API 호출 최소화)
        // 룸 A, B, C가 동시에 변경되어도, 1초 동안 기다렸다가 한 번만 전역 동기화를 실행합니다.

        // 🎯 [Target Sync] 변경된 룸 ID 수집
        if (payload.room_id) {
            this.pendingSyncRoomIds.add(payload.room_id);
        }

        if (this.webhookDebounceTimer) {
            clearTimeout(this.webhookDebounceTimer);
            console.log(`⏳ [Webhook] 디바운스 연장 (이전 요청 취소)`);
        }

        this.webhookDebounceTimer = setTimeout(() => {
            this.syncQueue = this.syncQueue.then(async () => {
                try {
                    // 수집된 룸 ID 목록 복사 및 초기화
                    const targetRoomIds = Array.from(this.pendingSyncRoomIds);
                    this.pendingSyncRoomIds.clear();

                    console.log(`🕐 [Webhook] 동기화 작업 시작: ${new Date().toISOString()}`);
                    console.log(`🎯 [Webhook] 대상 룸: ${targetRoomIds.length > 0 ? targetRoomIds.join(', ') : '전체'}`);

                    let updatedMin;
                    if (window.lastSyncTime) {
                        // 마지막 동기화 이후의 변경사항만 요청 (1분 버퍼)
                        updatedMin = new Date(window.lastSyncTime - 60 * 1000).toISOString();
                    } else {
                        updatedMin = new Date(Date.now() - 10 * 60 * 1000).toISOString();
                    }

                    console.log(`🔄 [Webhook → Global Sync] 전역 증분 동기화 실행 (updatedMin: ${updatedMin})`);
                    const syncResult = await this.syncGlobalChanges(updatedMin, targetRoomIds);

                    if (syncResult) {
                        window.lastSyncTime = Date.now();
                        console.log(`✅ [Webhook] 동기화 작업 완료`);
                    } else {
                        console.log(`⏭️ [Webhook] 동기화 스킵됨 (이미 진행 중) - 시간 갱신 안 함`);
                    }
                } catch (err) {
                    console.error(`❌ [Webhook] 동기화 실패:`, err);
                }
            });
        }, 1000); // 1초 대기
    }
}

// 전역 인스턴스 노출
window.SyncManager = SyncManager;
