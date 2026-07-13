#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


APP_ROOT = Path(os.environ.get('RHYTHMJOY_APP_ROOT', '/home/clown313python/myapp'))
ENV_FILE = Path(os.environ.get('RHYTHMJOY_ENV_FILE', APP_ROOT / '.env'))
DEFAULT_ALIGO_SEND_URL = 'https://apis.aligo.in/send/'
DEFAULT_ALIGO_REMAIN_URL = 'https://apis.aligo.in/remain/'


class SmsConfigError(RuntimeError):
    pass


class SmsSendError(RuntimeError):
    pass


def load_env_file(path=ENV_FILE):
    try:
        lines = Path(path).read_text(encoding='utf-8').splitlines()
    except FileNotFoundError:
        return

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def env_flag(name, default='0'):
    return os.environ.get(name, default).strip().lower() in ('1', 'true', 'yes', 'on')


def get_required_env(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise SmsConfigError(f'Missing required environment variable: {name}')
    return value


def normalize_phone(value):
    digits = re.sub(r'\D+', '', str(value or ''))
    if not (9 <= len(digits) <= 11):
        raise SmsConfigError(f'Invalid phone number: {value}')
    return digits


def split_phone(value):
    digits = normalize_phone(value)
    if len(digits) >= 10:
        return digits[:3], digits[3:-4], digits[-4:]
    return digits[:2], digits[2:-4], digits[-4:]


def hyphen_phone(value):
    return '-'.join(split_phone(value))


def sms_byte_length(message, charset='euc-kr'):
    try:
        return len(str(message or '').encode(charset))
    except UnicodeEncodeError:
        return len(str(message or '').encode('utf-8'))


def infer_sms_type(message, requested='auto'):
    requested = (requested or 'auto').strip().upper()
    if requested in ('SMS', 'LMS', 'MMS'):
        return 'LMS' if requested == 'L' else requested
    return 'LMS' if sms_byte_length(message) > 90 else 'SMS'


def load_config():
    load_env_file()
    return {
        'user_id': get_required_env('ALIGO_SMS_USER_ID'),
        'api_key': get_required_env('ALIGO_SMS_API_KEY'),
        'sender': get_required_env('ALIGO_SMS_SENDER'),
        'send_url': os.environ.get('ALIGO_SMS_SEND_URL', DEFAULT_ALIGO_SEND_URL),
        'remain_url': os.environ.get('ALIGO_SMS_REMAIN_URL', DEFAULT_ALIGO_REMAIN_URL),
        'timeout': int(os.environ.get('ALIGO_SMS_TIMEOUT_SECONDS', '12')),
        'dry_run': env_flag('ALIGO_SMS_DRY_RUN', '0'),
    }


def post_form(url, params, timeout):
    data = urllib.parse.urlencode(params).encode('utf-8')
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'User-Agent': 'RhythmjoyAligoSms/1.0',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode('utf-8', errors='replace').strip()
    except urllib.error.HTTPError as error:
        body = error.read().decode('utf-8', errors='replace')
        raise SmsSendError(f'Aligo SMS HTTP {error.code}: {body[:300]}') from error


def parse_json_response(raw):
    try:
        return json.loads(str(raw or '').strip() or '{}')
    except json.JSONDecodeError as error:
        raise SmsSendError(f'Aligo SMS returned non-JSON response: {str(raw or "")[:300]}') from error


def result_ok(data):
    return str(data.get('result_code') or '').strip() == '1'


def remaining_sms_count(data):
    for key in ('SMS_CNT', 'sms_cnt', 'remain_cnt', 'remaining'):
        value = data.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text.isdigit():
            return int(text)
    return None


def build_send_payload(config, to, message, *, subject='', sms_type='auto', testflag='', scheduled_date='', scheduled_time=''):
    msg_type = infer_sms_type(message, sms_type)
    payload = {
        'key': config['api_key'],
        'user_id': config['user_id'],
        'sender': normalize_phone(config['sender']),
        'receiver': normalize_phone(to),
        'msg': message,
        'msg_type': msg_type,
        'testmode_yn': testflag,
    }
    if msg_type != 'SMS' and subject:
        payload['title'] = subject
    if scheduled_date:
        payload['rdate'] = scheduled_date
    if scheduled_time:
        payload['rtime'] = scheduled_time
    return payload


def send_sms(to, message, *, subject='', sms_type='auto', real=False, testflag='', config=None):
    config = config or load_config()
    testflag_value = '' if real else (testflag or 'Y')
    payload = build_send_payload(
        config,
        to,
        message,
        subject=subject,
        sms_type=sms_type,
        testflag=testflag_value,
    )
    safe_payload = {**payload, 'key': '***'}
    if config['dry_run']:
        return {
            'ok': True,
            'provider': 'aligo',
            'dryRun': True,
            'payload': safe_payload,
            'code': 'dry-run',
            'raw': '',
        }

    raw = post_form(config['send_url'], payload, config['timeout'])
    data = parse_json_response(raw)
    return {
        'ok': result_ok(data),
        'provider': 'aligo',
        'dryRun': False,
        'testflag': testflag_value or '',
        'to': hyphen_phone(to),
        'sender': hyphen_phone(config['sender']),
        'code': str(data.get('result_code') or ''),
        'message': data.get('message') or '',
        'msgId': data.get('msg_id') or data.get('mid') or '',
        'successCount': data.get('success_cnt'),
        'errorCount': data.get('error_cnt'),
        'msgType': data.get('msg_type') or payload.get('msg_type'),
        'remaining': remaining_sms_count(data),
        'raw': raw,
    }


def get_remaining_count(config=None):
    config = config or load_config()
    raw = post_form(config['remain_url'], {
        'key': config['api_key'],
        'user_id': config['user_id'],
    }, config['timeout'])
    data = parse_json_response(raw)
    remaining = remaining_sms_count(data)
    return {
        'ok': result_ok(data) or remaining is not None,
        'provider': 'aligo',
        'remaining': remaining,
        'raw': raw,
        'code': str(data.get('result_code') or ''),
        'message': data.get('message') or '',
        'sms': data.get('SMS_CNT'),
        'lms': data.get('LMS_CNT'),
        'mms': data.get('MMS_CNT'),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description='Aligo SMS sender for Rhythmjoy automation')
    sub = parser.add_subparsers(dest='command', required=True)

    send_parser = sub.add_parser('send', help='Send or test-send an SMS/LMS message')
    send_parser.add_argument('--to', required=True)
    send_parser.add_argument('--message', required=True)
    send_parser.add_argument('--subject', default='')
    send_parser.add_argument('--sms-type', default='auto', choices=['auto', 'SMS', 'LMS', 'MMS'])
    send_parser.add_argument('--real', action='store_true', help='Actually send. Without this, Aligo testmode_yn=Y is used.')
    send_parser.add_argument('--json', action='store_true')

    remain_parser = sub.add_parser('remain', help='Read Aligo SMS remaining count')
    remain_parser.add_argument('--json', action='store_true')

    args = parser.parse_args(argv)
    try:
        if args.command == 'send':
            result = send_sms(
                args.to,
                args.message,
                subject=args.subject,
                sms_type=args.sms_type,
                real=args.real,
            )
        else:
            result = get_remaining_count()
    except Exception as error:
        if getattr(args, 'json', False):
            print(json.dumps({'ok': False, 'provider': 'aligo', 'error': str(error)}, ensure_ascii=False))
        else:
            print(f'ERROR: {error}', file=sys.stderr)
        return 1

    if getattr(args, 'json', False):
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(result)
    return 0 if result.get('ok') else 2


if __name__ == '__main__':
    raise SystemExit(main())
