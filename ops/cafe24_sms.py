#!/usr/bin/env python3
import argparse
import base64
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
DEFAULT_SMS_URL = 'https://sslsms.cafe24.com/sms_sender.php'
DEFAULT_REMAIN_URL = 'https://sslsms.cafe24.com/sms_remain.php'


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


def b64(value, charset='utf-8'):
    if value is None:
        value = ''
    if isinstance(value, bytes):
        raw = value
    else:
        raw = str(value).encode(charset)
    return base64.b64encode(raw).decode('ascii')


def sms_byte_length(message, charset='euc-kr'):
    try:
        return len(str(message or '').encode(charset))
    except UnicodeEncodeError:
        return len(str(message or '').encode('utf-8'))


def infer_sms_type(message, requested='auto'):
    requested = (requested or 'auto').strip().upper()
    if requested in ('SMS', 'L'):
        return requested
    return 'L' if sms_byte_length(message) > 90 else 'SMS'


def load_config():
    load_env_file()
    sender = os.environ.get('CAFE24_SMS_SENDER', '').strip()
    sender_parts = split_phone(sender) if sender else ('', '', '')
    return {
        'user_id': get_required_env('CAFE24_SMS_USER_ID'),
        'secure': get_required_env('CAFE24_SMS_SECURE_KEY'),
        'sender': sender,
        'sender_parts': sender_parts,
        'send_url': os.environ.get('CAFE24_SMS_SEND_URL', DEFAULT_SMS_URL),
        'remain_url': os.environ.get('CAFE24_SMS_REMAIN_URL', DEFAULT_REMAIN_URL),
        'timeout': int(os.environ.get('CAFE24_SMS_TIMEOUT_SECONDS', '12')),
        'charset': os.environ.get('CAFE24_SMS_CHARSET', 'utf-8'),
        'dry_run': env_flag('CAFE24_SMS_DRY_RUN', '0'),
    }


def encode_payload(params, charset='utf-8'):
    encoded = {}
    for key, value in params.items():
        if value is None or value == '':
            continue
        encoded[key] = b64(value, charset=charset)
    encoded['mode'] = b64('1', charset='ascii')
    return encoded


def post_form(url, params, timeout):
    data = urllib.parse.urlencode(params).encode('ascii')
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'RhythmjoyCafe24Sms/1.0',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode('utf-8', errors='replace').strip()
    except urllib.error.HTTPError as error:
        body = error.read().decode('utf-8', errors='replace')
        raise SmsSendError(f'Cafe24 SMS HTTP {error.code}: {body[:300]}') from error


def parse_send_response(raw):
    text = str(raw or '').strip()
    if not text:
        return {'ok': False, 'code': '', 'remaining': None, 'raw': text}
    if ',' in text:
        code, rest = text.split(',', 1)
        remaining = int(rest) if rest.strip().isdigit() else None
    else:
        code, remaining = text, None
    return {
        'ok': code in ('success', 'reserved', 'TEST SUCCESS'),
        'code': code,
        'remaining': remaining,
        'raw': text,
    }


def build_send_payload(config, to, message, *, subject='', sms_type='auto', testflag='', scheduled_date='', scheduled_time=''):
    sender = config['sender']
    if not sender:
        raise SmsConfigError('Missing required environment variable: CAFE24_SMS_SENDER')
    sphone1, sphone2, sphone3 = config['sender_parts']
    msg_type = infer_sms_type(message, sms_type)
    return {
        'user_id': config['user_id'],
        'secure': config['secure'],
        'sphone1': sphone1,
        'sphone2': sphone2,
        'sphone3': sphone3,
        'rphone': hyphen_phone(to),
        'msg': message,
        'smsType': msg_type if msg_type == 'L' else '',
        'subject': subject if msg_type == 'L' else '',
        'testflag': testflag,
        'rdate': scheduled_date,
        'rtime': scheduled_time,
        'nointeractive': '1',
    }


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
    safe_payload = {
        **payload,
        'secure': '***',
        'user_id': payload['user_id'],
    }
    if config['dry_run']:
        return {
            'ok': True,
            'dryRun': True,
            'payload': safe_payload,
            'code': 'dry-run',
            'raw': '',
        }
    encoded = encode_payload(payload, charset=config['charset'])
    raw = post_form(config['send_url'], encoded, config['timeout'])
    parsed = parse_send_response(raw)
    parsed['dryRun'] = False
    parsed['testflag'] = testflag_value or ''
    parsed['to'] = hyphen_phone(to)
    parsed['sender'] = hyphen_phone(config['sender'])
    return parsed


def get_remaining_count(config=None):
    config = config or load_config()
    payload = encode_payload({
        'user_id': config['user_id'],
        'secure': config['secure'],
    }, charset=config['charset'])
    raw = post_form(config['remain_url'], payload, config['timeout'])
    text = raw.strip()
    return {
        'ok': text.isdigit(),
        'remaining': int(text) if text.isdigit() else None,
        'raw': text,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description='Cafe24 SMS sender for Rhythmjoy automation')
    sub = parser.add_subparsers(dest='command', required=True)

    send_parser = sub.add_parser('send', help='Send or test-send an SMS/LMS message')
    send_parser.add_argument('--to', required=True)
    send_parser.add_argument('--message', required=True)
    send_parser.add_argument('--subject', default='')
    send_parser.add_argument('--sms-type', default='auto', choices=['auto', 'SMS', 'L'])
    send_parser.add_argument('--real', action='store_true', help='Actually send. Without this, Cafe24 testflag=Y is used.')
    send_parser.add_argument('--json', action='store_true')

    remain_parser = sub.add_parser('remain', help='Read Cafe24 SMS remaining count')
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
            print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
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
