#!/usr/bin/env python3
"""
IMAP IDLE 테스트 서버
네이버 메일 → Google Calendar 실시간 동기화
"""

import os
import sys
import time
from datetime import datetime, timedelta
from imapclient import IMAPClient
import email
from email.header import decode_header
from google.oauth2 import service_account
from googleapiclient.discovery import build
import json
import re

# 환경 변수 로드
NAVER_USERNAME = os.getenv('NAVER_EMAIL_USERNAME')
NAVER_PASSWORD = os.getenv('NAVER_EMAIL_PASSWORD')
GOOGLE_SERVICE_ACCOUNT_JSON = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON')

# Google Calendar ID 매핑
CALENDAR_ID_MAPPING = {
    "Ahall": "752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com",
    "Bhall": "22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com",
    "Chall": "b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com",
    "Dhall": "60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com",
    "Ehall": "aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com"
}

# 네이버 메일함 → 캘린더 매핑
MAILBOX_MAPPING = {
    "Ahall": "Ahall",
    "Bhall": "Bhall",
    "Chall": "Chall",
    "Dhall": "Dhall",
    "Ehall": "Ehall"
}

def log(message):
    """로그 출력 (타임스탬프 포함)"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] {message}", flush=True)

def get_google_calendar_service():
    """Google Calendar API 서비스 객체 생성"""
    try:
        # Service Account JSON 파싱
        credentials_dict = json.loads(GOOGLE_SERVICE_ACCOUNT_JSON)
        credentials = service_account.Credentials.from_service_account_info(
            credentials_dict,
            scopes=['https://www.googleapis.com/auth/calendar']
        )
        service = build('calendar', 'v3', credentials=credentials)
        log("✅ Google Calendar API 연결 성공")
        return service
    except Exception as e:
        log(f"❌ Google Calendar API 연결 실패: {e}")
        return None

def parse_email_body(body, subject):
    """이메일 본문에서 예약 정보 추출 (간단한 예시)"""
    # 실제 파싱 로직은 기존 코드 참고
    # 여기서는 테스트용 간단 버전
    log(f"📧 이메일 제목: {subject}")
    log(f"📧 이메일 본문 (첫 200자): {body[:200]}")
    
    # 간단한 정규표현식으로 날짜/시간 추출 예시
    # 실제로는 기존 코드의 복잡한 파싱 로직 사용
    return None

def create_google_calendar_event(service, calendar_id, event_data):
    """Google Calendar에 이벤트 생성"""
    try:
        event = service.events().insert(
            calendarId=calendar_id,
            body=event_data
        ).execute()
        log(f"✅ 캘린더 이벤트 생성 성공: {event.get('htmlLink')}")
        return event
    except Exception as e:
        log(f"❌ 캘린더 이벤트 생성 실패: {e}")
        return None

def process_email(msg, mailbox_name, google_service):
    """이메일 처리 및 Google Calendar 업로드"""
    try:
        # 제목 디코딩
        decode_hdr = decode_header(msg["Subject"])
        subject, encoding = decode_hdr[0]
        if isinstance(subject, bytes):
            subject = subject.decode(encoding if encoding else "utf-8")
        
        # 본문 추출
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True)
                    if isinstance(body, bytes):
                        body = body.decode("utf-8")
                    break
        else:
            body = msg.get_payload(decode=True)
            if isinstance(body, bytes):
                body = body.decode("utf-8")
        
        log(f"📧 새 메일 처리: {subject}")
        
        # TODO: 실제 파싱 로직 구현
        # event_data = parse_email_body(body, subject)
        # if event_data:
        #     calendar_id = CALENDAR_ID_MAPPING.get(mailbox_name)
        #     create_google_calendar_event(google_service, calendar_id, event_data)
        
        log(f"✅ 메일 처리 완료 (파싱 로직 미구현 - 테스트용)")
        
    except Exception as e:
        log(f"❌ 이메일 처리 중 오류: {e}")

def monitor_mailbox_idle(mailbox_name):
    """IMAP IDLE로 특정 메일함 실시간 모니터링"""
    log(f"🔄 '{mailbox_name}' 메일함 모니터링 시작 (IMAP IDLE)")
    
    # Google Calendar 서비스 초기화
    google_service = get_google_calendar_service()
    if not google_service:
        log("❌ Google Calendar 서비스 초기화 실패")
        return
    
    while True:
        try:
            # IMAP 연결
            log(f"🔌 IMAP 서버 연결 중... (imap.naver.com)")
            with IMAPClient('imap.naver.com', use_uid=True, ssl=True) as client:
                client.login(NAVER_USERNAME, NAVER_PASSWORD)
                log(f"✅ 로그인 성공: {NAVER_USERNAME}")
                
                # 메일함 선택
                client.select_folder(mailbox_name)
                log(f"📬 '{mailbox_name}' 메일함 선택 완료")
                
                # IDLE 모드 시작
                log(f"🛌 IDLE 모드 대기 중... (새 메일 오면 즉시 알림!)")
                client.idle()
                
                # 새 메일 감지 (5분 타임아웃)
                responses = client.idle_check(timeout=300)
                
                if responses:
                    # 새 메일 도착!
                    client.idle_done()
                    log(f"🔔 새 메일 감지! 처리 시작...")
                    
                    # 읽지 않은 메일 가져오기
                    messages = client.search(['UNSEEN'])
                    log(f"📨 읽지 않은 메일: {len(messages)}개")
                    
                    for uid in messages:
                        raw_msg = client.fetch([uid], ['RFC822'])
                        msg_data = raw_msg[uid][b'RFC822']
                        msg = email.message_from_bytes(msg_data)
                        
                        # 이메일 처리
                        process_email(msg, mailbox_name, google_service)
                    
                    log(f"✅ 모든 메일 처리 완료, IDLE 모드로 복귀")
                else:
                    # 타임아웃 (5분 동안 새 메일 없음)
                    client.idle_done()
                    log(f"⏰ 5분 타임아웃, 재연결...")
        
        except Exception as e:
            log(f"❌ 오류 발생: {e}")
            log(f"🔄 10초 후 재연결...")
            time.sleep(10)

def main():
    """메인 함수"""
    log("=" * 60)
    log("🚀 IMAP IDLE 테스트 서버 시작")
    log("=" * 60)
    
    # 환경 변수 확인
    if not NAVER_USERNAME or not NAVER_PASSWORD:
        log("❌ 네이버 메일 계정 정보가 설정되지 않았습니다!")
        log("   환경 변수: NAVER_EMAIL_USERNAME, NAVER_EMAIL_PASSWORD")
        sys.exit(1)
    
    if not GOOGLE_SERVICE_ACCOUNT_JSON:
        log("❌ Google Service Account JSON이 설정되지 않았습니다!")
        log("   환경 변수: GOOGLE_SERVICE_ACCOUNT_JSON")
        sys.exit(1)
    
    log(f"✅ 네이버 계정: {NAVER_USERNAME}")
    log(f"✅ 모니터링 메일함: {list(MAILBOX_MAPPING.keys())}")
    log("")
    
    # 테스트: 첫 번째 메일함만 모니터링
    test_mailbox = "Ahall"
    log(f"🧪 테스트 모드: '{test_mailbox}' 메일함만 모니터링")
    log("")
    
    try:
        monitor_mailbox_idle(test_mailbox)
    except KeyboardInterrupt:
        log("")
        log("⏹️  사용자가 서버를 종료했습니다.")
        log("👋 안녕히 가세요!")

if __name__ == "__main__":
    main()
