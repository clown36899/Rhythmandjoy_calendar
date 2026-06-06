from flask import Blueprint, jsonify
import os
import imaplib
from email.header import decode_header
import email
from flask import Blueprint , render_template
import re
from datetime import datetime
from pytz import timezone
from google.oauth2 import service_account
from googleapiclient.discovery import build
from dateutil.parser import parse
import schedule
import time
from threading import Thread


email_blueprint = Blueprint('email_blueprint', __name__, template_folder='templates',static_folder = 'static')












@email_blueprint.route('/test', methods=['GET'])
def layout():

    return render_template('email_inport.html')




#오늘날짜의 네이버 이메일에서 특정 폴더의 정보를 가져오는 코드
@email_blueprint.route('/get-emails', methods=['GET'])
def get_emails():
    # 네이버 이메일 계정과 비밀번호
    username = os.environ["NAVER_MAIL_USERNAME"]
    password = os.environ["NAVER_MAIL_PASSWORD"]


    server = imaplib.IMAP4_SSL("imap.naver.com")
    server.login(username, password)
    server.select("Aroom")


    # 한국 시간대를 설정합니다
    seoul = timezone('Asia/Seoul')

    # 현재 한국 시간을 가져옵니다

    current_date = datetime.now(seoul).strftime('%d-%b-%Y')

    # 날짜 기준으로 이메일 검색

    result, data = server.search(None, 'UNSEEN')
    # result, data = server.search(None, f'(ON "{current_date}")')
    # result, data = server.search(None, "ALL")
    # result, data = server.search(None, '(ON "12-Sep-2023")')

    email_ids = data[0].split()
    # email_ids = email_ids[-10:]  # 최근 10개의 이메일 ID만 선택
    email_list = []

    for email_id in email_ids[::-1]:  # 이메일 ID 리스트를 뒤집어서 최신 이메일부터 처리
        result, msg_data = server.fetch(email_id, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])
        decode_hdr = decode_header(msg["Subject"])
        subject, encoding = decode_hdr[0]



        if isinstance(subject, bytes):
            subject = subject.decode(encoding if encoding else "utf-8")

        # 이메일 본문을 가져오기
        body = ""  # 초기화
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True)
                    if isinstance(body, bytes):
                        body = body.decode("utf-8")
                    break  # 텍스트 본문을 찾았으므로 반복문을 빠져나옵니다
        else:
            body = msg.get_payload(decode=True)
            if isinstance(body, bytes):
                body = body.decode("utf-8")

             # 이메일을 읽음으로 표시
        server.store(email_id, '+FLAGS', '\\Seen')
        # 본문에서 필요한 정보 추출


        pattern = re.compile(r"""
            예약자명\s*([\w*]+)님.*?
            예약번호\s*(\d+).*?
            예약상품\s*([\w]+)\s.*?
            이용일시\s*([\d\.]+)\((\w+)\)\s*([오후|오전]+\d+:\d+)~([오후|오전]+\d+:\d+).*?
            결제상태\s*(\w+)
        """, re.VERBOSE | re.DOTALL)

        match = pattern.search(body)

        if match:
            예약자명 = match.group(1)
            예약번호 = match.group(2)
            예약상품 = match.group(3)
            이용일시 = match.group(4) + " (" + match.group(5) + ") " + match.group(6) + "~" + match.group(7)
            결제상태 = match.group(8)

            email_list.append({
                "Email ID": email_id.decode("utf-8"),
                "예약자명": 예약자명+"님",
                "예약번호": 예약번호,
                "예약상품": 예약상품,
                "이용일시": 이용일시,
                "결제상태": 결제상태
            })
        else:
            print("일치하는 문자열을 찾지 못했습니다.")

        create_calendar_event(email_list)

    server.logout()
    return jsonify(email_list)





def create_calendar_event(event_list):

    # Google API credentials 파일 경로
    CREDENTIALS_FILE = os.environ.get('GOOGLE_SERVICE_ACCOUNT_FILE', '/home/clown313python/myapp/static/rhythmjoycalendar-ce0594fe594b.json')


    SCOPES = ['https://www.googleapis.com/auth/calendar']
    credentials = service_account.Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)

    # Calendar API 서비스 객체 생성
    service = build('calendar', 'v3', credentials=credentials)

    calendar_id = "rtnc67akgklnnh7gnpsbsnou48@group.calendar.google.com"  #타겟캘린더 아이디

    for event_data in event_list:
        # 예약 상세 정보를 생성
        description = f"""
        예약자명: {event_data['예약자명']}
        예약번호: {event_data['예약번호']}
        예약상품: {event_data['예약상품']}
        이용일시: {event_data['이용일시']}
        결제상태: {event_data['결제상태']}
        """



    usage_datetime_str = event_data['이용일시']
    match = re.match(r"(\d{4}\.\d{2}\.\d{2}\.)\s*\(\w+\)\s*(\w{2})(\d{2}:\d{2})~(\w{2})(\d{2}:\d{2})", usage_datetime_str)
    print(match)
    if match:
        date_str, start_day_part, start_time_str, end_day_part, end_time_str = match.groups()



        # 최종 날짜 및 시간 출력
        start_datetime_str = f"{date_str.replace('.', '-')}T{start_time_str}"
        end_datetime_str = f"{date_str.replace('.', '-')}T{end_time_str}"



        print(start_datetime_str)  # 예: 2023-09-13T23:00
        print(end_datetime_str)    # 예: 2023-09-13T23:59
        # 기존 문자열을 datetime 객체로 변환
        start_datetime_obj = datetime.strptime(start_datetime_str, '%Y-%m-%d-T%H:%M')
        end_datetime_obj = datetime.strptime(end_datetime_str, '%Y-%m-%d-T%H:%M')

        # 이벤트 데이터 구조 생성
        event_body = {
            "summary": event_data['예약상품'],
            "description": description,
            "start": {"dateTime": start_datetime_obj.isoformat(), "timeZone": "Asia/Seoul"},
            "end": {"dateTime": end_datetime_obj.isoformat(), "timeZone": "Asia/Seoul"},
        }

        # 이벤트 추가
        event = service.events().insert(calendarId=calendar_id, body=event_body).execute()
        print('Event created: {}'.format(event.get('htmlLink')))













#버튼이 아니라 타이머로 작동하는 코드이다 a홀코드
def fetch_emails():
    print("3초실행")
    # 네이버 이메일 계정과 비밀번호
    username = os.environ["NAVER_MAIL_USERNAME"]
    password = os.environ["NAVER_MAIL_PASSWORD"]


    server = imaplib.IMAP4_SSL("imap.naver.com")
    server.login(username, password)
    server.select("Aroom")


    # 한국 시간대를 설정합니다
    seoul = timezone('Asia/Seoul')

    # 현재 한국 시간을 가져옵니다

    current_date = datetime.now(seoul).strftime('%d-%b-%Y')

    # 날짜 기준으로 이메일 검색

    result, data = server.search(None, 'UNSEEN')
    # result, data = server.search(None, f'(ON "{current_date}")')
    # result, data = server.search(None, "ALL")
    # result, data = server.search(None, '(ON "12-Sep-2023")')

    email_ids = data[0].split()
    # email_ids = email_ids[-10:]  # 최근 10개의 이메일 ID만 선택
    email_list = []

    for email_id in email_ids[::-1]:  # 이메일 ID 리스트를 뒤집어서 최신 이메일부터 처리
        result, msg_data = server.fetch(email_id, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])
        decode_hdr = decode_header(msg["Subject"])
        subject, encoding = decode_hdr[0]



        if isinstance(subject, bytes):
            subject = subject.decode(encoding if encoding else "utf-8")

        # 이메일 본문을 가져오기
        body = ""  # 초기화
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True)
                    if isinstance(body, bytes):
                        body = body.decode("utf-8")
                    break  # 텍스트 본문을 찾았으므로 반복문을 빠져나옵니다
        else:
            body = msg.get_payload(decode=True)
            if isinstance(body, bytes):
                body = body.decode("utf-8")

             # 이메일을 읽음으로 표시
        server.store(email_id, '+FLAGS', '\\Seen')
        # 본문에서 필요한 정보 추출


        pattern = re.compile(r"""
            예약자명\s*([\w*]+)님.*?
            예약번호\s*(\d+).*?
            예약상품\s*([\w]+)\s.*?
            이용일시\s*([\d\.]+)\((\w+)\)\s*([오후|오전]+\d+:\d+)~([오후|오전]+\d+:\d+).*?
            결제상태\s*(\w+)
        """, re.VERBOSE | re.DOTALL)

        match = pattern.search(body)

        if match:
            예약자명 = match.group(1)
            예약번호 = match.group(2)
            예약상품 = match.group(3)
            이용일시 = match.group(4) + " (" + match.group(5) + ") " + match.group(6) + "~" + match.group(7)
            결제상태 = match.group(8)

            email_list.append({
                "Email ID": email_id.decode("utf-8"),
                "예약자명": 예약자명+"님",
                "예약번호": 예약번호,
                "예약상품": 예약상품,
                "이용일시": 이용일시,
                "결제상태": 결제상태
            })
        else:
            print("일치하는 문자열을 찾지 못했습니다.")

        create_calendar_event(email_list)

    server.logout()

    return email_list








#버튼이 아니라 타이머로 작동하는 코드이다 B홀코드
def fetch_emails_B():

    # 네이버 이메일 계정과 비밀번호
    username = os.environ["NAVER_MAIL_USERNAME"]
    password = os.environ["NAVER_MAIL_PASSWORD"]


    server = imaplib.IMAP4_SSL("imap.naver.com")
    server.login(username, password)
    server.select("Broom")


    # 한국 시간대를 설정합니다
    seoul = timezone('Asia/Seoul')

    # 현재 한국 시간을 가져옵니다

    current_date = datetime.now(seoul).strftime('%d-%b-%Y')

    # 날짜 기준으로 이메일 검색

    result, data = server.search(None, 'UNSEEN')
    # result, data = server.search(None, f'(ON "{current_date}")')
    # result, data = server.search(None, "ALL")
    # result, data = server.search(None, '(ON "12-Sep-2023")')

    email_ids = data[0].split()
    # email_ids = email_ids[-10:]  # 최근 10개의 이메일 ID만 선택
    email_list = []

    for email_id in email_ids[::-1]:  # 이메일 ID 리스트를 뒤집어서 최신 이메일부터 처리
        result, msg_data = server.fetch(email_id, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])
        decode_hdr = decode_header(msg["Subject"])
        subject, encoding = decode_hdr[0]



        if isinstance(subject, bytes):
            subject = subject.decode(encoding if encoding else "utf-8")

        # 이메일 본문을 가져오기
        body = ""  # 초기화
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True)
                    if isinstance(body, bytes):
                        body = body.decode("utf-8")
                    break  # 텍스트 본문을 찾았으므로 반복문을 빠져나옵니다
        else:
            body = msg.get_payload(decode=True)
            if isinstance(body, bytes):
                body = body.decode("utf-8")

             # 이메일을 읽음으로 표시
        server.store(email_id, '+FLAGS', '\\Seen')
        # 본문에서 필요한 정보 추출


        pattern = re.compile(r"""
            예약자명\s*([\w*]+)님.*?
            예약번호\s*(\d+).*?
            예약상품\s*([\w]+)\s.*?
            이용일시\s*([\d\.]+)\((\w+)\)\s*([오후|오전]+\d+:\d+)~([오후|오전]+\d+:\d+).*?
            결제상태\s*(\w+)
        """, re.VERBOSE | re.DOTALL)

        match = pattern.search(body)

        if match:
            예약자명 = match.group(1)
            예약번호 = match.group(2)
            예약상품 = match.group(3)
            이용일시 = match.group(4) + " (" + match.group(5) + ") " + match.group(6) + "~" + match.group(7)
            결제상태 = match.group(8)

            email_list.append({
                "Email ID": email_id.decode("utf-8"),
                "예약자명": 예약자명+"님",
                "예약번호": 예약번호,
                "예약상품": 예약상품,
                "이용일시": 이용일시,
                "결제상태": 결제상태
            })
        else:
            print("일치하는 문자열을 찾지 못했습니다.")

        create_calendar_event(email_list)

    server.logout()

    return email_list
