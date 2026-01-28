/**
 * IndexedDBManager
 * 
 * 브라우저 내장 DB인 IndexedDB를 사용하여 대용량(1년치) 데이터를 영구 저장하고 관리합니다.
 * 업계 표준 방식(IndexedDB)을 사용하여 네트워크 연결 없이도 데이터를 빠르게 조회할 수 있습니다.
 */
class IndexedDBManager {
    constructor() {
        this.dbName = 'RhythmJoyCalendarDB';
        this.dbVersion = 6; // 🔑 버전 6으로 업그레이드 (데이터 불일치 해결을 위한 강제 초기화)
        this.storeName = 'events';
        this.metaStoreName = 'sync_metadata'; // 🔑 메타데이터 스토어 이름
        this.db = null;
        this.isReady = false;
    }

    /**
     * DB 연결 상태 검증 및 재연결
     * 트랜잭션 생성 전에 호출하여 연결이 유효한지 확인
     */
    async _ensureConnection() {
        // DB 객체가 없거나 닫힌 상태면 재연결
        if (!this.db || !this.isReady) {
            console.warn('⚠️ [IndexedDB] DB 연결이 없습니다. 재연결 시도...');
            this.isReady = false;
            await this.init();
            return;
        }

        // IndexedDB의 readyState는 표준 속성이 아니므로,
        // 대신 objectStoreNames 접근을 시도하여 연결 상태 확인
        try {
            // 연결이 유효하면 objectStoreNames에 접근 가능
            const storeNames = this.db.objectStoreNames;
            if (!storeNames || storeNames.length === 0) {
                throw new Error('Object stores not available');
            }
        } catch (error) {
            console.warn('⚠️ [IndexedDB] DB 연결이 유효하지 않습니다. 재연결 시도...', error);
            this.isReady = false;
            await this.init();
        }
    }

    /**
     * 재시도 로직이 있는 트랜잭션 생성 헬퍼
     * @param {Array|string} storeNames - 스토어 이름(들)
     * @param {string} mode - 'readonly' 또는 'readwrite'
     * @param {number} maxRetries - 최대 재시도 횟수
     */
    async _createTransactionWithRetry(storeNames, mode, maxRetries = 2) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this._ensureConnection();
                return this.db.transaction(storeNames, mode);
            } catch (error) {
                if (i === maxRetries - 1) {
                    console.error('❌ [IndexedDB] 트랜잭션 생성 최종 실패:', error);
                    throw error;
                }
                console.warn(`⚠️ [IndexedDB] 트랜잭션 생성 실패. 재시도 ${i + 1}/${maxRetries}...`);
                // 지수 백오프: 100ms, 200ms, ...
                await new Promise(r => setTimeout(r, 100 * (i + 1)));
            }
        }
    }

    /**
     * 특정 연도의 데이터만 삭제 (동기화용)
     * @param {number} year 
     */
    /**
     * 특정 연도의 데이터만 삭제 (동기화용) - Time Slicing 적용
     * @param {number} year 
     */
    async clearYear(year) {
        if (!this.isReady) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('start');

            const start = new Date(year, 0, 1);
            const end = new Date(year, 11, 31, 23, 59, 59, 999);
            const range = IDBKeyRange.bound(start, end);

            const keyRequest = index.getAllKeys(range);

            keyRequest.onsuccess = (event) => {
                const keys = event.target.result;
                if (!keys || keys.length === 0) {
                    resolve();
                    return;
                }

                // 🚀 [최적화] Time Slicing: 200개씩 끊어서 삭제하여 메인 스레드 차단 방지
                const CHUNK_SIZE = 200;
                let processed = 0;

                const processChunk = () => {
                    const chunk = keys.slice(processed, processed + CHUNK_SIZE);

                    // 트랜잭션이 활성 상태여야 하므로, 여기서는 별도의 트랜잭션을 새로 열지 않고
                    // 기존 트랜잭션 내에서 처리하되, 너무 오래 걸리면 브라우저가 트랜잭션을 닫을 수 있음.
                    // IndexedDB 트랜잭션은 이벤트 루프가 돌면 자동으로 커밋되므로,
                    // Time Slicing을 하려면 사실상 여러 개의 트랜잭션으로 나눠야 함.
                    // 하지만 여기서는 delete() 호출 자체는 빠르므로, 
                    // 키 목록만 메모리에 있다면 한 트랜잭션에서 루프를 도는 것이 나을 수 있음.
                    // 
                    // 🚨 수정: 트랜잭션 유지 문제로 인해, 한 번에 삭제하되
                    // UI 버벅임을 막기 위해 requestIdleCallback 패턴을 흉내내거나
                    // 삭제 자체를 여러 트랜잭션으로 쪼개야 함.
                    // 여기서는 안전하게 "여러 트랜잭션으로 쪼개는 방식"을 선택.

                    // 기존 트랜잭션은 키 조회용으로 종료됨.
                };

                // 키 조회 트랜잭션 완료 후, 삭제 작업을 별도로 진행
            };

            // 키 조회만 먼저 수행
            keyRequest.onerror = (e) => reject(e.target.error);
        }).then(async (keys) => {
            // 키 목록을 받아서 별도 함수에서 청크 단위로 삭제
            if (!keys || keys.length === 0) return;
            await this._deleteKeysInChunks(keys);
        });
    }

    // 🔴 [신규] 내부 헬퍼: 키 목록을 청크 단위로 나누어 삭제 (UI 차단 방지)
    async _deleteKeysInChunks(keys) {
        const CHUNK_SIZE = 300; // 한 번에 지울 개수
        for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
            const chunk = keys.slice(i, i + CHUNK_SIZE);
            await new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const store = tx.objectStore(this.storeName);
                chunk.forEach(key => store.delete(key));
                tx.oncomplete = resolve;
                tx.onerror = (e) => reject(e.target.error);
            });
            // 메인 스레드에 양보 (1프레임 대기)
            await new Promise(r => requestAnimationFrame(r));
        }
    }

    /**
     * DB 초기화 및 연결
     */
    async init() {
        if (this.isReady) return this.db; // 이미 준비되었으면 즉시 반환

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error('❌ [IndexedDB] 데이터베이스 열기 실패:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.isReady = true;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 🧹 [Clean Start] 버전 6 미만에서 업그레이드 시 기존 데이터 강제 삭제
                // 이는 "데이터 공백 버그" 시절의 잘못된 캐시를 확실히 제거하기 위함입니다.
                if (event.oldVersion < 6) {
                    console.warn('🧹 [IndexedDB] 버전 업그레이드 (v' + event.oldVersion + ' -> v6): 데이터 정합성을 위해 기존 데이터를 초기화합니다.');

                    if (db.objectStoreNames.contains(this.storeName)) {
                        db.deleteObjectStore(this.storeName);
                    }
                    if (db.objectStoreNames.contains(this.metaStoreName)) {
                        db.deleteObjectStore(this.metaStoreName);
                    }
                }

                // 1. 이벤트 스토어 (기존)
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('start', 'start', { unique: false });
                    store.createIndex('end', 'end', { unique: false });
                    store.createIndex('roomId', 'roomId', { unique: false });
                    store.createIndex('googleEventId', 'googleEventId', { unique: true });
                    window._originalConsole.log('📦 [IndexedDB] events 스토어 생성됨');
                }

                // 2. 메타데이터 스토어 (신규)
                if (!db.objectStoreNames.contains(this.metaStoreName)) {
                    // Key: "year-month" (e.g., "2025-0"), Value: { lastSyncedAt: ISOString }
                    db.createObjectStore(this.metaStoreName, { keyPath: 'key' });
                    window._originalConsole.log('📦 [IndexedDB] sync_metadata 스토어 생성됨');
                }
            };
        });

        return this.initPromise;
    }

    /**
     * 특정 월의 마지막 동기화 시간 기록 (TTL 관리용)
     */
    async setLastSync(year, month) {
        if (!this.isReady) await this.init();
        const key = `${year}-${month}`;
        const data = { key, lastSyncedAt: new Date().toISOString() };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.metaStoreName], 'readwrite');
            const store = tx.objectStore(this.metaStoreName);
            store.put(data);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * 특정 월의 마지막 동기화 시간 조회
     */
    async getLastSync(year, month) {
        if (!this.isReady) await this.init();
        const key = `${year}-${month}`;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([this.metaStoreName], 'readonly');
            const store = tx.objectStore(this.metaStoreName);
            const request = store.get(key);

            request.onsuccess = () => {
                resolve(request.result ? request.result.lastSyncedAt : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 이벤트 대량 삭제 (ID 목록 기반) - Time Slicing 적용
     * @param {Array} eventIds - 삭제할 이벤트 ID 배열
     */
    async deleteEvents(eventIds) {
        if (!this.isReady) await this.init();
        if (!eventIds || eventIds.length === 0) return;

        const CHUNK_SIZE = 200;
        for (let i = 0; i < eventIds.length; i += CHUNK_SIZE) {
            const chunk = eventIds.slice(i, i + CHUNK_SIZE);
            await new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const store = tx.objectStore(this.storeName);
                chunk.forEach(id => store.delete(id));
                tx.oncomplete = resolve;
                tx.onerror = (e) => reject(e.target.error);
            });

            if (i + CHUNK_SIZE < eventIds.length) {
                await new Promise(r => requestAnimationFrame(r));
            }
        }
    }

    /**
     * 특정 월의 데이터를 덮어쓰기 (Range Replacement Strategy)
     * 해당 월의 기존 데이터를 모두 삭제하고, 새로운 데이터로 교체합니다.
     * @param {number} year 
     * @param {number} month (0-indexed)
     * @param {Array} events 
     */
    async overwriteMonth(year, month, events, lastSyncedAt = null) {
        if (!this.isReady) await this.init();

        // 1. 해당 월의 시작과 끝 계산
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

        return new Promise((resolve, reject) => {
            // events와 sync_metadata를 동시에 업데이트하기 위해 트랜잭션 범위 확대
            const transaction = this.db.transaction([this.storeName, this.metaStoreName], 'readwrite');
            const eventStore = transaction.objectStore(this.storeName);
            const metaStore = transaction.objectStore(this.metaStoreName);

            const index = eventStore.index('start');
            const range = IDBKeyRange.bound(start, end);

            // 2. 해당 월의 기존 데이터 삭제 (Cursor 사용)
            const request = index.openCursor(range);

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    eventStore.delete(cursor.primaryKey); // PK(id)로 삭제
                    cursor.continue();
                } else {
                    // 3. 삭제 완료 후 새로운 데이터 추가
                    if (events && events.length > 0) {
                        events.forEach(event => {
                            if (!event.id) {
                                event.id = event.googleEventId || `gen-${Date.now()}-${Math.random()}`;
                            }
                            eventStore.put(event);
                        });
                    }

                    // 4. 동기화 시간 기록 (TTL 갱신)
                    const key = `${year}-${month}`;
                    // lastSyncedAt이 없으면 현재 시간 사용 (하위 호환성)
                    const syncTime = lastSyncedAt || new Date().toISOString();
                    metaStore.put({ key, lastSyncedAt: syncTime });
                }
            };

            transaction.oncomplete = () => {
                window._originalConsole.log(`🧹 [IndexedDB] ${year}-${month + 1} 데이터 덮어쓰기 및 TTL 갱신 완료 (${events.length}개)`);
                resolve();
            };

            transaction.onerror = (event) => {
                console.error('❌ [IndexedDB] 덮어쓰기 실패:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * 증분 동기화: 변경된 이벤트만 병합 (Merge Strategy)
     * - status === "cancelled" → 삭제 (Soft Delete)
     * - status === "confirmed" → 추가/업데이트
     * - 🛡️ [Conflict Resolution] 기존 데이터보다 최신일 때만 적용 (updated 타임스탬프 비교)
     * - 🚀 [Transaction Safety] Read-Modify-Write 패턴 적용 (트랜잭션 분리)
     */
    async mergeMonth(year, month, events, lastSyncedAt = null) {
        if (!this.isReady) await this.init();
        if (events.length === 0) return;

        // 1. [Read Phase] 기존 데이터 조회
        // 트랜잭션 유지 문제를 피하기 위해 먼저 읽어옴
        const existingEventsMap = new Map();

        // 🔒 [Connection Safety] Read Phase 시작 전 연결 검증
        await this._ensureConnection();

        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);

            let completed = 0;
            if (events.length === 0) resolve();

            events.forEach(event => {
                const lookupId = event.id; // This is Google ID from Webhook

                // 1. Try Primary Key Lookup
                const request = store.get(lookupId);
                request.onsuccess = (e) => {
                    if (e.target.result) {
                        existingEventsMap.set(lookupId, e.target.result);
                        checkCompletion();
                    } else {
                        // 2. Fallback: Try Google Event ID Index Lookup
                        // (DB에 gen-ID로 저장되어 있을 수 있음)
                        try {
                            const index = store.index('googleEventId');
                            const indexRequest = index.get(lookupId);

                            indexRequest.onsuccess = (e2) => {
                                if (e2.target.result) {
                                    console.log(`✅ [DB Lookup] Found via Index: ${lookupId} (Real ID: ${e2.target.result.id})`);
                                    existingEventsMap.set(lookupId, e2.target.result);
                                } else {
                                    // console.log(`⚠️ [DB Lookup] Not Found in Index either: ${lookupId}`);
                                }
                                checkCompletion();
                            };
                            indexRequest.onerror = () => {
                                console.warn(`⚠️ [DB Lookup] Index lookup failed for ${lookupId}`);
                                checkCompletion();
                            };
                        } catch (err) {
                            console.warn(`⚠️ [DB Lookup] Index 'googleEventId' not found`);
                            checkCompletion();
                        }
                    }
                };
                request.onerror = () => {
                    console.error(`❌ [DB Lookup] Error: ${lookupId}`);
                    checkCompletion();
                };
            });

            function checkCompletion() {
                completed++;
                if (completed === events.length) resolve();
            }
        });

        // 2. [Write Phase] 데이터 병합 및 저장
        // 🔒 [Connection Safety] Write Phase 시작 전 연결 재검증
        await this._ensureConnection();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName, this.metaStoreName], 'readwrite');
            const eventStore = transaction.objectStore(this.storeName);
            const metaStore = transaction.objectStore(this.metaStoreName);

            let deletedCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;

            events.forEach(newEvent => {
                // 🔑 Lookup Phase에서 찾은 기존 데이터 가져오기
                // (Google ID로 찾았든, PK로 찾았든 여기 다 있음)
                const existingEvent = existingEventsMap.get(newEvent.id);
                let shouldUpdate = true;

                // 🚨 [Critical Fix] ID 일치 보장
                // 기존 데이터가 있으면, 그 ID를 그대로 사용해야 덮어쓰기가 됨.
                // (기존 ID가 gen-... 이고 새 ID가 GoogleID인 경우, gen-...을 유지해야 함)
                if (existingEvent) {
                    newEvent.id = existingEvent.id;
                }

                // 🛡️ 충돌 방지 로직 (메모리 상에서 수행)
                if (existingEvent && existingEvent.updated && newEvent.updated) {
                    const existingTime = new Date(existingEvent.updated).getTime();
                    const newTime = new Date(newEvent.updated).getTime();

                    if (newTime < existingTime) {
                        console.log(`🛡️ [Conflict] 기존 데이터가 더 최신임. 업데이트 스킵 (ID: ${newEvent.id})`);
                        // console.log(`   - Existing: ${existingEvent.updated} > New: ${newEvent.updated}`);
                        shouldUpdate = false;
                        skippedCount++;
                    }
                }

                if (shouldUpdate) {
                    // 🛡️ [Soft Delete] 삭제 대신 status='cancelled'로 저장
                    if (!newEvent.id) {
                        newEvent.id = newEvent.googleEventId || `gen-${Date.now()}-${Math.random()}`;
                    }

                    eventStore.put(newEvent);

                    if (newEvent.status === 'cancelled') {
                        deletedCount++;
                    } else {
                        updatedCount++;
                    }
                }
            });

            // TTL 갱신
            const key = `${year}-${month}`;
            // lastSyncedAt이 없으면 현재 시간 사용 (하위 호환성)
            const syncTime = lastSyncedAt || new Date().toISOString();
            metaStore.put({ key, lastSyncedAt: syncTime });

            transaction.oncomplete = () => {
                console.log(`🔄 [IndexedDB Merge] ${year}-${month + 1} 병합 완료 (추가/수정: ${updatedCount}, 삭제: ${deletedCount}, 스킵: ${skippedCount})`);
                resolve();
            };

            transaction.onerror = (event) => {
                console.error('❌ [IndexedDB] 병합 실패:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * 대량 이벤트 병합 (월별 그룹화 후 mergeMonth 호출)
     * @param {Array} events 
     */
    async mergeBulkEvents(events) {
        if (!events || events.length === 0) return;

        // 1. 월별로 이벤트 그룹화
        const eventsByMonth = new Map();

        events.forEach(event => {
            const date = new Date(event.start);
            const key = `${date.getFullYear()}-${date.getMonth()}`;

            if (!eventsByMonth.has(key)) {
                eventsByMonth.set(key, []);
            }
            eventsByMonth.get(key).push(event);
        });

        console.log(`📦 [Bulk Merge] ${events.length}개 이벤트를 ${eventsByMonth.size}개 월로 나누어 병합합니다.`);

        // 2. 각 월별로 mergeMonth 호출 (순차 처리)
        for (const [key, monthEvents] of eventsByMonth) {
            const [year, month] = key.split('-').map(Number);
            await this.mergeMonth(year, month, monthEvents);
        }
    }

    /**
     * 특정 월의 이벤트 개수 조회 (동기화 중단 판단용)
     */
    async getEventCount(year, month) {
        if (!this.isReady) await this.init();

        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

        return new Promise((resolve) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('start');
            const range = IDBKeyRange.bound(start, end);

            const countRequest = index.count(range);

            countRequest.onsuccess = () => {
                resolve(countRequest.result);
            };

            countRequest.onerror = () => {
                resolve(0);
            };
        });
    }

    /**
     * 이벤트 대량 저장 (Upsert) - Time Slicing 적용
     * @param {Array} events 
     */
    async saveEvents(events) {
        if (!this.isReady) await this.init();
        if (!events || events.length === 0) return;

        // 🚀 [최적화] 대량 저장을 청크로 나누어 실행
        const CHUNK_SIZE = 200;
        for (let i = 0; i < events.length; i += CHUNK_SIZE) {
            const chunk = events.slice(i, i + CHUNK_SIZE);
            await new Promise((resolve, reject) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const store = tx.objectStore(this.storeName);

                chunk.forEach(event => {
                    if (!event.id) {
                        event.id = event.googleEventId || `gen-${Date.now()}-${Math.random()}`;
                    }
                    store.put(event);
                });

                tx.oncomplete = resolve;
                tx.onerror = (e) => reject(e.target.error);
            });

            // 메인 스레드 양보
            if (i + CHUNK_SIZE < events.length) {
                await new Promise(r => requestAnimationFrame(r));
            }
        }
    }

    /**
     * 특정 기간의 이벤트 조회
     * @param {Date} start - 시작 날짜
     * @param {Date} end - 종료 날짜
     * @returns {Promise<Array>} 이벤트 배열
     */
    async getEvents(start, end) {
        if (!this.isReady) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('start');
            const events = [];

            // 범위 쿼리: 이벤트 시작 시간이 조회 범위 내에 있거나, 
            // 이벤트가 조회 기간을 포함하거나 걸쳐있는 경우를 모두 찾아야 함.
            // IndexedDB 인덱스는 단순 범위 검색만 지원하므로, 
            // 여기서는 넉넉하게 가져와서 메모리에서 필터링하는 전략을 사용하거나,
            // 모든 이벤트를 순회(Cursor)하며 필터링해야 합니다.
            // 성능을 위해 Cursor를 사용하여 필터링합니다.

            // 🚀 [최적화] 범위 쿼리 개선
            // "이벤트 종료일"이 "조회 시작일"보다 뒤에 있는 이벤트만 검색 (end > start)
            // 이렇게 하면 이미 지나간 과거 이벤트는 스캔하지 않음
            // 🔴 [수정] DB에 Date 객체로 저장되므로, 쿼리도 Date 객체로 해야 함 (String X)
            const range = IDBKeyRange.lowerBound(start);
            const endIndex = store.index('end'); // end 인덱스 사용
            const request = endIndex.openCursor(range);

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const eventData = cursor.value;
                    const eventStart = new Date(eventData.start);
                    const eventEnd = new Date(eventData.end);

                    // 교차 검사: (EventStart < RangeEnd) && (EventEnd > RangeStart)
                    // 🛡️ [Soft Delete] 삭제된 이벤트(cancelled)는 제외
                    if (eventStart < end && eventEnd > start && eventData.status !== 'cancelled') {
                        events.push(eventData);
                        // 🔍 [Debug] 로드된 이벤트 ID 확인 (좀비 추적용)
                        // console.log(`📖 [Loaded] ID: ${eventData.id} | GoogleID: ${eventData.googleEventId} | Title: ${eventData.summary}`);
                    }
                    cursor.continue();
                } else {
                    // 🔍 [Debug] 전체 로드된 이벤트 요약
                    if (events.length > 0) {
                        console.log(`📋 [getEvents] indexdb 에서 가져온 데이터 Loaded ${events.length} events. IDs sample:`);
                        //events.slice(0, 105).forEach(e => console.log(`   - ${e.id} (${e})`));
                    }
                    resolve(events);
                }
            };

            request.onerror = (event) => {
                console.error('❌ [IndexedDB] 조회 실패:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * 모든 데이터 삭제 (초기화)
     */
    async clear() {
        if (!this.isReady) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('🧹 [IndexedDB] 모든 데이터 삭제 완료');
                resolve();
            };

            request.onerror = (event) => {
                console.error('❌ [IndexedDB] 초기화 실패:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * 특정 연도의 데이터가 존재하는지 확인 (간이 체크)
     * @param {number} year 
     */
    async hasYearData(year) {
        // 구현 간소화를 위해, 해당 연도의 1월 1일 ~ 12월 31일 사이에 데이터가 1개라도 있는지 확인
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);
        const events = await this.getEvents(start, end);
        return events.length > 0;
    }
}

// 전역 인스턴스 생성 (싱글톤)
window.indexedDBManager = new IndexedDBManager();
