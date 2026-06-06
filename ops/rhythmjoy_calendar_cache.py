#!/usr/bin/env python3
import argparse
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


APP_ROOT = Path('/home/clown313python/myapp')
SERVICE_ACCOUNT_FILE = APP_ROOT / 'static' / 'rhythmjoycalendar-ce0594fe594b.json'
DATA_DIR = APP_ROOT / 'calendar_set' / 'calendar_v10' / 'data'
EVENTS_FILE = DATA_DIR / 'events.json'
STATE_FILE = DATA_DIR / 'calendar_cache_state.json'
TIME_ZONE = 'Asia/Seoul'
FULL_SYNC_PAST_DAYS = 120
SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

ROOMS = {
    'a': {
        'name': 'A홀',
        'calendarId': '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com',
        'color': '#F6BF26',
    },
    'b': {
        'name': 'B홀',
        'calendarId': '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com',
        'color': 'rgb(87, 150, 200)',
    },
    'c': {
        'name': 'C홀',
        'calendarId': 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com',
        'color': 'rgb(129, 180, 186)',
    },
    'd': {
        'name': 'D홀',
        'calendarId': '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com',
        'color': 'rgb(125, 157, 106)',
    },
    'e': {
        'name': 'E홀',
        'calendarId': 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com',
        'color': '#4c4c4c',
    },
}


def utc_now():
    return datetime.now(timezone.utc)


def google_time(value):
    return value.isoformat().replace('+00:00', 'Z')


def read_json(path, default):
    try:
        with path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except Exception:
        logging.exception('Failed to read %s', path)
        return default


def atomic_write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + '.tmp')
    with tmp_path.open('w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(str(tmp_path), str(path))


def build_service():
    credentials = service_account.Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT_FILE),
        scopes=SCOPES,
    )
    return build('calendar', 'v3', credentials=credentials, cache_discovery=False)


def event_start_value(item):
    return item.get('start', {}).get('dateTime') or item.get('start', {}).get('date')


def event_end_value(item):
    return item.get('end', {}).get('dateTime') or item.get('end', {}).get('date') or event_start_value(item)


def to_calendar_event(room_key, item):
    room = ROOMS[room_key]
    start = event_start_value(item)
    end = event_end_value(item)
    event_id = item.get('id')
    if not event_id or not start:
        return None

    description = item.get('description') or ''
    location = item.get('location') or ''
    return {
        'id': f'{room_key}:{event_id}',
        'title': item.get('summary') or '',
        'start': start,
        'end': end,
        'className': room_key,
        'color': room['color'],
        'textColor': '#000',
        'description': description,
        'location': location,
        'extendedProps': {
            'description': description,
            'location': location,
            'roomKey': room_key,
            'roomName': room['name'],
            'googleEventId': event_id,
            'updated': item.get('updated'),
        },
    }


def list_all_pages(service, calendar_id, params):
    items = []
    next_sync_token = None
    page_token = None

    while True:
        request_params = dict(params)
        if page_token:
            request_params['pageToken'] = page_token
        result = service.events().list(calendarId=calendar_id, **request_params).execute()
        items.extend(result.get('items', []))
        page_token = result.get('nextPageToken')
        next_sync_token = result.get('nextSyncToken') or next_sync_token
        if not page_token:
            break

    return items, next_sync_token


def full_sync_room(service, room_key):
    room = ROOMS[room_key]
    time_min = google_time(utc_now() - timedelta(days=FULL_SYNC_PAST_DAYS))
    items, next_sync_token = list_all_pages(service, room['calendarId'], {
        'maxResults': 2500,
        'singleEvents': True,
        'showDeleted': True,
        'timeMin': time_min,
        'timeZone': TIME_ZONE,
    })

    events = {}
    for item in items:
        if item.get('status') == 'cancelled':
            continue
        event = to_calendar_event(room_key, item)
        if event:
            events[item['id']] = event

    return events, next_sync_token, len(items), 'full'


def incremental_sync_room(service, room_key, previous_events, sync_token):
    room = ROOMS[room_key]
    items, next_sync_token = list_all_pages(service, room['calendarId'], {
        'maxResults': 2500,
        'singleEvents': True,
        'showDeleted': True,
        'syncToken': sync_token,
        'timeZone': TIME_ZONE,
    })

    events = dict(previous_events or {})
    for item in items:
        event_id = item.get('id')
        if not event_id:
            continue
        if item.get('status') == 'cancelled':
            events.pop(event_id, None)
            continue
        event = to_calendar_event(room_key, item)
        if event:
            events[event_id] = event

    return events, next_sync_token or sync_token, len(items), 'incremental'


def load_state():
    state = read_json(STATE_FILE, {})
    return {
        'rooms': state.get('rooms', {}),
        'eventsByRoom': state.get('eventsByRoom', {}),
    }


def sync_once():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    service = build_service()
    state = load_state()
    room_states = state['rooms']
    events_by_room = state['eventsByRoom']
    room_meta = {}
    failures = {}

    for room_key, room in ROOMS.items():
        previous_events = events_by_room.get(room_key, {})
        previous_state = room_states.get(room_key, {})
        sync_token = previous_state.get('syncToken')

        try:
            if sync_token:
                events, next_sync_token, touched, mode = incremental_sync_room(
                    service,
                    room_key,
                    previous_events,
                    sync_token,
                )
            else:
                events, next_sync_token, touched, mode = full_sync_room(service, room_key)
        except HttpError as error:
            status = getattr(error.resp, 'status', None)
            if status == 410:
                logging.warning('%s sync token expired; running full sync', room['name'])
                events, next_sync_token, touched, mode = full_sync_room(service, room_key)
            else:
                failures[room_key] = f'HTTP {status or "unknown"}'
                logging.exception('%s sync failed', room['name'])
                events = previous_events
                next_sync_token = sync_token
                touched = 0
                mode = 'failed'
        except Exception as error:
            failures[room_key] = str(error)
            logging.exception('%s sync failed', room['name'])
            events = previous_events
            next_sync_token = sync_token
            touched = 0
            mode = 'failed'

        events_by_room[room_key] = events
        room_states[room_key] = {
            'syncToken': next_sync_token,
            'lastMode': mode,
            'lastTouched': touched,
            'lastSyncAt': google_time(utc_now()),
        }
        room_meta[room_key] = {
            'name': room['name'],
            'color': room['color'],
            'count': len(events),
            'mode': mode,
            'touched': touched,
            'ok': mode != 'failed',
        }

        logging.info('%s %s sync: touched=%s cached=%s', room['name'], mode, touched, len(events))

    all_events = []
    for room_key in ROOMS.keys():
        all_events.extend(events_by_room.get(room_key, {}).values())
    all_events.sort(key=lambda event: (event.get('start') or '', event.get('id') or ''))
    content_hash = hashlib.sha256(
        json.dumps(all_events, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    ).hexdigest()

    generated_at = google_time(utc_now())
    payload = {
        'version': 1,
        'source': 'google-calendar-server-cache',
        'generatedAt': generated_at,
        'generatedAtMs': int(time.time() * 1000),
        'contentHash': content_hash,
        'timeZone': TIME_ZONE,
        'rooms': room_meta,
        'failures': failures,
        'events': all_events,
    }

    atomic_write_json(EVENTS_FILE, payload)
    atomic_write_json(STATE_FILE, {
        'version': 1,
        'generatedAt': generated_at,
        'rooms': room_states,
        'eventsByRoom': events_by_room,
    })

    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--interval', type=int, default=30)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] %(levelname)s %(message)s',
    )

    while True:
        try:
            payload = sync_once()
            logging.info('calendar cache generated: events=%s failures=%s', len(payload['events']), len(payload['failures']))
        except Exception:
            logging.exception('calendar cache pass failed')

        if args.once:
            break
        time.sleep(max(args.interval, 5))


if __name__ == '__main__':
    main()
