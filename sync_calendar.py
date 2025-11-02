#!/usr/bin/env python3
"""
Google Calendar → Supabase 동기화 스크립트
사용법: python3 sync_calendar.py
"""

import os
import requests
from datetime import datetime

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

def extract_price(description):
    """설명에서 가격 추출"""
    if not description:
        return 0
    
    import re
    patterns = [
        r'(\d{1,3}(?:,?\d{3})*)\s*원',
        r'(\d{1,3}(?:,?\d{3})*)\s*\/',
        r'가격[:\s]*(\d{1,3}(?:,?\d{3})*)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, description)
        if match:
            return int(match.group(1).replace(',', ''))
    
    return 0

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
    """Supabase에 저장"""
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
            'price': extract_price(event.get('description')),
            'created_at': event.get('created'),
            'updated_at': event.get('updated'),
        })
    
    if records:
        insert_url = f'{SUPABASE_URL}/rest/v1/booking_events'
        response = requests.post(insert_url, headers=headers, json=records)
        response.raise_for_status()
    
    return len(records)

def main():
    """전체 동기화 실행"""
    print('🔄 Google Calendar → Supabase 동기화 시작...\n')
    
    total = 0
    for room in ROOMS:
        try:
            print(f'  📥 {room["id"].upper()}홀 동기화 중...')
            events = fetch_calendar_events(room['calendar_id'])
            count = save_to_supabase(room['id'], events)
            total += count
            print(f'  ✅ {room["id"].upper()}홀: {count}개 이벤트')
        except Exception as e:
            print(f'  ❌ {room["id"].upper()}홀 실패: {e}')
    
    print(f'\n✅ 동기화 완료! 총 {total}개 이벤트')

if __name__ == '__main__':
    main()
