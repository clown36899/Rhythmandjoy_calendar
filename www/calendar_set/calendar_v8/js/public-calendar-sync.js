/**
 * PublicCalendarSync.js
 * 
 * 구글 캘린더 API (Public)를 직접 호출하여 이벤트를 가져오는 모듈입니다.
 * Netlify Function을 거치지 않고 브라우저에서 직접 요청합니다.
 */
class PublicCalendarSync {
    constructor() {
        this.apiKey = null;
        this.baseUrl = 'https://www.googleapis.com/calendar/v3/calendars';
        this.queue = Promise.resolve(); // 🚦 전역 요청 큐 (모든 요청 직렬화)
    }

    /**
     * 초기화: API 키 설정
     */
    init() {
        if (window.CONFIG && window.CONFIG.googleCalendarApiKey) {
            this.apiKey = window.CONFIG.googleCalendarApiKey;
            console.log('✅ [PublicCalendarSync] API Key 로드 완료');
        } else {
            console.error('❌ [PublicCalendarSync] API Key가 설정되지 않았습니다.');
        }
    }

    /**
     * 실제 API 호출을 수행하는 내부 메서드
     */
    async _performFetch(room, start, end, updatedMin) {
        try {
            const calendarId = encodeURIComponent(room.calendarId);
            const url = new URL(`${this.baseUrl}/${calendarId}/events`);

            // 기본 파라미터
            url.searchParams.set('key', this.apiKey);
            url.searchParams.set('timeMin', start.toISOString());
            url.searchParams.set('timeMax', end.toISOString());
            url.searchParams.set('singleEvents', 'true');
            url.searchParams.set('orderBy', 'startTime');
            url.searchParams.set('maxResults', '2500');

            // 🔑 증분 동기화: updatedMin이 있으면 변경된 것만 가져오기
            if (updatedMin) {
                url.searchParams.set('updatedMin', updatedMin);
                url.searchParams.set('showDeleted', 'true'); // 삭제된 이벤트도 가져오기
            }

            const response = await fetch(url.toString());

            if (!response.ok) {
                const errorBody = await response.text();
                // 403 Rate Limit 등 에러 로그
                console.error(`❌ [PublicCalendarSync] ${room.name} HTTP ${response.status}: ${errorBody}`);
                return [];
            }

            const data = await response.json();
            const items = data.items || [];

            // 앱 내부 포맷으로 변환
            return items.map(item => ({
                ...item, // 구글 원본 데이터 전체 포함
                id: item.id,
                title: item.summary || '제목 없음',
                description: item.description,
                start: item.start.dateTime || item.start.date,
                end: item.end.dateTime || item.end.date,
                roomId: room.id,
                updated: item.updated,
                status: item.status, // cancelled 확인용
                googleEventId: item.id
            }));

        } catch (err) {
            console.error(`❌ [PublicCalendarSync] ${room.name} 동기화 실패:`, err);
            return [];
        }
    }

    /**
     * 큐에 요청을 추가하고 실행하는 메서드 (Rate Limit 방지용 지연 포함)
     */
    async _scheduleRequest(task) {
        // 큐 체이닝: 이전 작업이 끝나면 실행
        const resultPromise = this.queue.then(async () => {
            const result = await task();
            // ⏳ 요청 후 강제 지연 (500ms) - 초당 2회 이하로 제한
            await new Promise(resolve => setTimeout(resolve, 500));
            return result;
        });

        // 큐 포인터 업데이트 (에러가 나도 큐가 멈추지 않도록 catch 처리)
        this.queue = resultPromise.catch(err => {
            console.error('⚠️ [PublicCalendarSync] Queue Error:', err);
        });

        return resultPromise;
    }

    /**
     * 특정 기간의 이벤트를 가져옵니다.
     * @param {Date} start 시작일
     * @param {Date} end 종료일
     * @param {string|null} updatedMin 증분 동기화용 타임스탬프
     * @param {Array|null} targetRoomIds 특정 룸만 동기화할 경우 룸 ID 배열 (없으면 전체)
     * @returns {Promise<Array>} 이벤트 목록
     */
    async fetchEvents(start, end, updatedMin = null, targetRoomIds = null) {
        if (!this.apiKey) this.init();
        if (!this.apiKey) {
            throw new Error('Google API Key missing');
        }

        const allEvents = [];
        let rooms = Object.values(window.CONFIG.rooms);

        // 🎯 [Target Sync] 특정 룸만 동기화 요청이 있으면 필터링
        if (targetRoomIds && targetRoomIds.length > 0) {
            // 대소문자 구분 없이 비교
            const targets = targetRoomIds.map(id => id.toUpperCase());
            rooms = rooms.filter(room => targets.includes(room.id.toUpperCase()));
            // console.log(`🎯 [PublicCalendarSync] 특정 룸만 동기화: ${targets.join(', ')}`);
        }

        // 필터링된 룸에 대해 순차적으로 구글 캘린더 API 호출 (큐 사용)
        for (const room of rooms) {
            // _scheduleRequest를 통해 전역 큐에 등록
            const roomEvents = await this._scheduleRequest(() =>
                this._performFetch(room, start, end, updatedMin)
            );
            allEvents.push(...roomEvents);
        }

        console.log(`✅ [PublicCalendarSync] 총 ${allEvents.length}개 이벤트 수신 (Direct API)`);
        return allEvents;
    }
}

// 전역 인스턴스 생성
window.publicCalendarSync = new PublicCalendarSync();
