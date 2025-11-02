#!/usr/bin/env python3
"""
Google Calendar → Supabase 동기화 스크립트
사용법: python3 sync_calendar.py
"""

import os
import requests
from datetime import datetime, timedelta
import re
import uuid
import json

# 환경변수에서 읽기
GOOGLE_API_KEY = os.environ['GOOGLE_CALENDAR_API_KEY']
SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']

ROOMS = [
    {'id': 'a', 'calendar_id': '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com'},
    {'id': 'b', 'calendar_id': '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com'},
    {'id': 'c', 'calendar_id': 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com'},
    {'id': 'd', 'calendar_id': '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com'},
    {'id': 'e', 'calendar_id': 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com'},
]

# 가격 정책
ROOM_PRICES = {
    'a': {'before16': 10000, 'after16': 13000, 'overnight': 30000},
    'b': {'before16': 9000, 'after16': 11000, 'overnight': 20000},
    'c': {'before16': 4000, 'after16': 6000, 'overnight': 15000},
    'd': {'before16': 3000, 'after16': 5000, 'overnight': 15000},
    'e': {'before16': 8000, 'after16': 10000, 'overnight': 20000},
}

# 2025년 한국 법정 공휴일
KOREAN_HOLIDAYS_2025 = [
    '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30',
    '2025-03-01', '2025-03-03', '2025-05-05', '2025-05-06',
    '2025-06-06', '2025-08-15', '2025-09-06', '2025-09-07',
    '2025-09-08', '2025-09-09', '2025-10-03', '2025-10-09',
    '2025-12-25'
]

def is_naver_booking(description):
    """네이버 예약 체크"""
    if not description:
        return False
    return bool(re.search(r'예약번호:\s*\d+', description))

def is_weekend_or_holiday(dt):
    """주말 또는 공휴일 체크 (KST 기준)"""
    date_str = dt.strftime('%Y-%m-%d')
    weekday = dt.weekday()  # 0=월요일, 6=일요일
    return weekday >= 5 or date_str in KOREAN_HOLIDAYS_2025

def calculate_price(start_time_str, end_time_str, room_id, description=''):
    """가격 계산"""
    # UTC를 KST로 변환 (+9시간)
    start_utc = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
    end_utc = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))
    
    start_kst = start_utc + timedelta(hours=9)
    end_kst = end_utc + timedelta(hours=9)
    
    prices = ROOM_PRICES.get(room_id)
    if not prices:
        return 0
    
    is_naver = is_naver_booking(description)
    commission = 0.9802 if is_naver else 0.9
    
    start_hour = start_kst.hour
    end_hour = end_kst.hour
    duration_hours = (end_kst - start_kst).total_seconds() / 3600
    
    # 새벽 통대관: 0~6시 정확히 6시간
    if start_hour == 0 and end_hour == 6 and duration_hours == 6:
        return round(prices['overnight'] * commission)
    
    # 시간별 계산
    total_price = 0
    current = start_kst
    
    while current < end_kst:
        hour = current.hour
        
        # 새벽 시간 (0~6시)
        if 0 <= hour < 6:
            hourly_price = prices['overnight'] / 6
        # 주말 또는 공휴일
        elif is_weekend_or_holiday(current):
            hourly_price = prices['after16']
        # 평일
        else:
            if hour < 16:
                hourly_price = prices['before16']
            else:
                hourly_price = prices['after16']
        
        total_price += hourly_price
        current += timedelta(hours=1)
    
    return round(total_price * commission)

def fetch_calendar_events(calendar_id):
    """Google Calendar API로 이벤트 가져오기"""
    url = f'https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events'
    params = {
        'key': GOOGLE_API_KEY,
        'timeMin': '2020-01-01T00:00:00Z',
        'timeMax': f'{datetime.now().year + 2}-12-31T23:59:59Z',
        'singleEvents': 'true',
        'orderBy': 'startTime',
        'maxResults': 2500
    }
    
    response = requests.get(url, params=params)
    response.raise_for_status()
    
    return response.json().get('items', [])

def save_to_supabase(room_id, events):
    """Supabase에 저장 (가격 계산 없이 이벤트 데이터만 저장)"""
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    
    # 기존 데이터 삭제
    delete_url = f'{SUPABASE_URL}/rest/v1/booking_events?room_id=eq.{room_id}'
    requests.delete(delete_url, headers=headers)
    
    # 새 데이터 입력
    records = []
    for event in events:
        records.append({
            'google_event_id': event.get('id'),
            'room_id': room_id,
            'title': event.get('summary', '제목 없음'),
            'description': event.get('description', ''),
            'start_time': event.get('start', {}).get('dateTime') or event.get('start', {}).get('date'),
            'end_time': event.get('end', {}).get('dateTime') or event.get('end', {}).get('date'),
            'created_at': event.get('created'),
            'updated_at': event.get('updated'),
        })
    
    if records:
        insert_url = f'{SUPABASE_URL}/rest/v1/booking_events'
        response = requests.post(insert_url, headers=headers, json=records)
        response.raise_for_status()
    
    return len(records)

def reset_watch_channels():
    """Watch 채널 자동 재설정"""
    print('\n🔔 Watch 채널 자동 재설정 시작...')
    
    # Google Service Account JSON 파싱
    service_account_json = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if not service_account_json:
        print('⚠️  GOOGLE_SERVICE_ACCOUNT_JSON 환경 변수 없음, Watch 재설정 건너뛰기')
        return
    
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request
        
        credentials = json.loads(service_account_json)
        
        # OAuth2 토큰 요청
        creds = service_account.Credentials.from_service_account_info(
            credentials,
            scopes=['https://www.googleapis.com/auth/calendar']
        )
        creds.refresh(Request())
        access_token = creds.token
        
        webhook_url = os.environ.get('WEBHOOK_URL', 'https://xn--xy1b23ggrmm5bfb82ees967e.com/.netlify/functions/google-webhook')
        
        for room in ROOMS:
            try:
                print(f"  🔄 {room['id'].upper()}홀 Watch 등록 중...")
                
                # 1. 초기 sync token 가져오기
                list_url = f"https://www.googleapis.com/calendar/v3/calendars/{room['calendar_id']}/events"
                list_response = requests.get(
                    list_url,
                    headers={'Authorization': f'Bearer {access_token}'},
                    params={'maxResults': 1, 'singleEvents': True, 'key': GOOGLE_API_KEY}
                )
                list_data = list_response.json()
                initial_sync_token = list_data.get('nextSyncToken')
                
                # 2. Watch 채널 등록
                channel_id = str(uuid.uuid4())
                channel = {
                    'id': channel_id,
                    'type': 'web_hook',
                    'address': webhook_url,
                    'token': room['id']
                }
                
                watch_url = f"https://www.googleapis.com/calendar/v3/calendars/{room['calendar_id']}/events/watch"
                watch_response = requests.post(
                    watch_url,
                    headers={
                        'Authorization': f'Bearer {access_token}',
                        'Content-Type': 'application/json'
                    },
                    params={'key': GOOGLE_API_KEY},
                    json=channel
                )
                
                if watch_response.status_code != 200:
                    raise Exception(f"HTTP {watch_response.status_code}: {watch_response.text}")
                
                watch_data = watch_response.json()
                resource_id = watch_data['resourceId']
                expiration = int(watch_data['expiration'])
                
                # 3. Supabase에 저장
                headers = {
                    'apikey': SUPABASE_KEY,
                    'Authorization': f'Bearer {SUPABASE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                }
                
                # calendar_channels
                requests.post(
                    f'{SUPABASE_URL}/rest/v1/calendar_channels',
                    headers=headers,
                    json={
                        'room_id': room['id'],
                        'calendar_id': room['calendar_id'],
                        'channel_id': channel_id,
                        'resource_id': resource_id,
                        'expiration': expiration
                    }
                )
                
                # calendar_sync_state
                if initial_sync_token:
                    requests.post(
                        f'{SUPABASE_URL}/rest/v1/calendar_sync_state',
                        headers=headers,
                        json={
                            'room_id': room['id'],
                            'sync_token': initial_sync_token,
                            'last_synced_at': datetime.now().isoformat()
                        }
                    )
                
                print(f"    ✅ {room['id'].upper()}홀 Watch 등록 완료")
                
            except Exception as e:
                print(f"    ❌ {room['id'].upper()}홀 Watch 등록 실패: {str(e)}")
        
        print('✅ Watch 채널 재설정 완료!')
    except Exception as e:
        print(f'⚠️  Watch 재설정 실패: {str(e)}')

def main(selected_rooms=None):
    """동기화 실행 (선택된 연습실만)"""
    # 선택된 연습실만 필터링
    rooms_to_sync = ROOMS if not selected_rooms else [r for r in ROOMS if r['id'] in selected_rooms]
    
    room_names = ', '.join([r['id'].upper() + '홀' for r in rooms_to_sync])
    print(f'🔄 Google Calendar → Supabase 동기화 시작: {room_names}\n')
    
    total = 0
    for room in rooms_to_sync:
        try:
            print(f'  📥 {room["id"].upper()}홀 동기화 중...')
            events = fetch_calendar_events(room['calendar_id'])
            count = save_to_supabase(room['id'], events)
            total += count
            print(f'  ✅ {room["id"].upper()}홀: {count}개 이벤트')
        except Exception as e:
            print(f'  ❌ {room["id"].upper()}홀 실패: {e}')
    
    print(f'\n✅ 동기화 완료! 총 {total}개 이벤트')
    print('\n💡 다음 단계: admin.html에서 "2️⃣ Watch 채널 재설정" 버튼을 눌러주세요.')

if __name__ == '__main__':
    # 명령줄 인자로 선택된 연습실 받기 (예: python sync_calendar.py a b c)
    import sys
    selected = sys.argv[1:] if len(sys.argv) > 1 else None
    main(selected)
