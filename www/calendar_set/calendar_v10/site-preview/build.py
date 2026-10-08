#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build an isolated, static site-structure preview from the existing v10 guide."""
from pathlib import Path
import html
import re
import json
import shutil
import hashlib
from functools import lru_cache
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
V10 = HERE.parent
PREVIEW_PATH = '/calendar_set/calendar_v10/site-preview/'
SITE_PATH = '/calendar_set/calendar_v10/site/'
SITE = V10 / 'site'
# Significant public-content revision, not the build date or live booking update time.
CONTENT_UPDATED = '2026-10-08'
# Public IndexNow ownership proof, not a login/API secret. Keep stable between builds.
INDEXNOW_KEY = 'e88c4a3764564b24a5afccb136387b70'
public_routes = []
legacy_home = (V10 / 'calendar_10.html').read_text()
verification = re.search(r'<meta name="naver-site-verification"[^>]+>', legacy_home).group(0)
tracking = legacy_home.split('<!-- Google tag (gtag.js) -->', 1)[1].split('<!-- End Google Tag Manager -->', 1)[0]
business = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', legacy_home, re.S).group(1))
# Reuse the existing FAQ owner; visible answers and structured data must stay identical.
faq = next(item for item in (json.loads(raw) for raw in re.findall(
    r'<script type="application/ld\+json">(.*?)</script>', legacy_home, re.S))
    if item.get('@type') == 'FAQPage')
# The business owns the official origin; a calendar's canonical owns that document.
ORIGIN = business['url'].rstrip('/')
ASSETS = '/calendar_set/calendar_v10/home_infopage/images'
NAVER_BOOKING = 'https://booking.naver.com/booking/10/bizes/1257912'
SPACECLOUD_BOOKING = 'https://www.spacecloud.kr/space/66056'
NAVER_MAP = 'https://naver.me/59vo9MDk'
guide = (V10 / 'home_infopage/homepage-section_mobile.html').read_text()
price_section = guide.split('id="pricelist"', 1)[1].split('<!-- 환불규정 -->', 1)[0]
prices = {}
for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', price_section, re.S):
    cells = [' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', cell)).split())
             for cell in re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S)]
    if len(cells) == 5 and cells[0][0] in 'ABCDE':
        prices[cells[0][0]] = {'area': cells[0][1:].strip(), 'rates': cells[1:]}
assert set(prices) == set('ABCDE'), 'Existing guide price table changed; review before rebuilding.'
facility = (V10 / 'home_infopage/popup_info.html').read_text()
dimensions = dict(re.findall(r'([ABCDE])홀\s+([\d.]+×[\d.]+m)', facility))
assert set(dimensions) == set('ABCDE')
# Reuse the detailed usage guide's existing tap-board restriction and quantity.
usage_guide = (V10.parents[1] / 'info/index.html').read_text()
tap_rule = html.unescape(re.search(r'<p>(쇠징이 달린 탭신발은.*?)</p>', usage_guide).group(1))
tap_count = re.search(r'구비된 탭판 (\d+)개', tap_rule).group(1)

rooms = {
    'A': ('단체 안무와 넓은 동선 연습.', f'{dimensions["A"]}의 연습 공간입니다. 댄스 전용 쿠션 마루이며, 장선 구조 위에 틈이 없는 강화마루로 마감되어 있습니다. 여러 사람이 대형을 바꾸는 안무나 이동 동선이 있는 댄스 연습에 활용해 보세요. 전면 거울로 동작을 확인하고, 55인치 TV로 참고 영상을 보며 연습할 수 있습니다.', '2', ['5','2','3'], '55인치 TV'),
    'B': ('영상을 보며 맞추는 안무 연습.', f'{dimensions["B"]} 공간에 전면 거울과 65인치 TV가 마련되어 있습니다. 바닥은 나무 마루 아래에 장선을 둔 댄스 전용 쿠션 마루입니다. 동작을 반복해서 익히거나 함께 안무를 맞출 때 참고 영상을 띄워보세요. HDMI·C타입·8핀 커넥터를 제공합니다.', '4', ['6','4','2'], '65인치 TV'),
    'C': ('개인·소규모 동작 연습.', f'{dimensions["C"]}의 소형 연습룸입니다. 바닥은 나무 마루 아래에 장선을 둔 댄스 전용 쿠션 마루입니다. 거울을 보며 자세와 동작을 점검하거나 개인 안무를 반복해서 연습할 때 이용해 보세요. 이동이 큰 안무는 사진과 공간 크기를 함께 확인해 주세요.', '2', ['2','1'], '댄스 전용 쿠션 마루'),
    'D': ('혼자 집중하는 개인 연습.', f'{dimensions["D"]}로, 다섯 개 룸 중 가장 작은 공간입니다. 바닥은 나무 마루 아래에 장선을 둔 댄스 전용 쿠션 마루입니다. 개인 동작과 기본기를 반복하는 연습에 활용해 보세요. 폭이 좁은 편이므로 동선을 넓게 쓰는 연습은 다른 룸의 크기와 비교해 주세요.', '2', ['2','1','3'], '댄스 전용 쿠션 마루'),
    'E': ('거울 앞에서 함께 맞추는 동선.', f'{dimensions["E"]} 공간에서 안무와 이동 동선을 확인할 수 있습니다. 댄스 전용 쿠션 마루이며, 장선 구조 위에 틈이 없는 강화마루로 마감되어 있습니다. 거울을 보며 서로의 위치와 동작을 맞추는 댄스 연습에 활용해 보세요. A·B홀과 함께 사진과 크기를 비교해 공간을 선택하세요.', '3', ['3','2','4'], '댄스 전용 쿠션 마루'),
}

# Descriptions verified against the existing facility photos; shared by alt and captions.
photo_descriptions = {
    'A': {'5': '55인치 TV와 전면 거울이 함께 보이는 A홀',
          '2': '왼쪽 전면 거울과 밝은 바닥이 보이는 A홀 전경',
          '3': '거울 쪽에서 바라본 A홀 반대편 벽과 출입구',
          '4': '출입구 반대쪽에서 바라본 A홀의 넓은 연습 바닥'},
    'B': {'6': '65인치 TV와 영상 연습 공간이 보이는 B홀',
          '4': '전면 거울과 TV가 함께 보이는 B홀 전경',
          '2': 'B홀의 긴 거울 벽과 나무 무늬 바닥',
          '3': '측면에서 바라본 B홀 연습 공간과 TV'},
    'C': {'2': 'C 표시가 있는 출입구에서 바라본 C홀 내부',
          '1': 'C홀의 전면 거울과 나무 무늬 바닥'},
    'D': {'2': 'D홀 출입문과 벽걸이 냉방기가 보이는 내부',
          '1': '거울 쪽에서 바라본 D홀의 길쭉한 연습 공간',
          '3': 'D홀의 거울 벽과 출입문 방향 전경'},
    'E': {'3': '짙은 벽과 밝은 바닥으로 구성된 E홀 전경',
          '2': '출입구에서 바라본 E홀 거울과 연습 공간',
          '4': '거울 쪽에서 바라본 E홀 바닥과 반대편 벽'},
}

@lru_cache(maxsize=None)
def responsive_image(relative_path):
    """Derive display sizes without replacing original facility photos or calendar assets."""
    source = V10 / 'home_infopage/images' / relative_path
    target_dir = V10 / 'home_infopage/images/site-responsive'
    target_dir.mkdir(exist_ok=True)
    with Image.open(source) as original:
        original = ImageOps.exif_transpose(original).convert('RGB')
        width, height = original.size
        name = relative_path.replace('/', '-').rsplit('.', 1)[0]
        revision = hashlib.sha256(source.read_bytes()).hexdigest()[:10]
        variants = []
        for size in sorted({min(width, size) for size in (640, 960, 1600, 2560)}):
            target = target_dir / f'{name}-{size}-{revision}-v1.webp'
            if not target.exists():
                resized = original.resize((size, round(height * size / width)), Image.Resampling.LANCZOS)
                resized.save(target, 'WEBP', quality=84, method=6)
            variants.append((size, f'{ASSETS}/site-responsive/{target.name}'))
    return width, height, variants

def img(room, number=None, cls='', eager=False, layout='card'):
    number = number or rooms[room][2]
    width, height, variants = responsive_image(f'room{room}/image{number}.webp')
    # Match existing card/detail/gallery breakpoints; the browser also accounts for device density.
    sizes = {
        'card': '(max-width:560px) calc(100vw - 42px), (max-width:900px) calc((100vw - 89px) / 2), (max-width:1360px) calc((100vw - 178px) / 3), 394px',
        'detail': '(max-width:900px) calc(100vw - 42px), (max-width:1360px) calc((100vw - 183px) * .55), 643px',
        'hero': '(max-width:900px) calc(100vw - 42px), (max-width:1360px) calc((100vw - 184px) * .51), 600px',
        'wide': '(max-width:560px) calc(100vw - 42px), (max-width:900px) calc(100vw - 64px), (max-width:1360px) calc(100vw - 128px), 1232px',
        'gallery': '(max-width:560px) calc((100vw - 53px) / 2), (max-width:900px) calc((100vw - 80px) / 2), (max-width:1360px) calc((100vw - 144px) / 2), 608px',
    }[layout]
    src = next(url for size, url in variants if size >= min(width, 960))
    srcset = ', '.join(f'{url} {size}w' for size, url in variants)
    return f'<img class="{cls}" src="{src}" srcset="{srcset}" sizes="{sizes}" width="{width}" height="{height}" alt="리듬앤조이 {html.escape(photo_descriptions[room][number])}" draggable="false" loading="{"eager" if eager else "lazy"}" decoding="async">'


# Keep one equipment fragment for both pages; reuse existing image derivation and FAQ text.
practice_equipment = ''
for title, question, filename, alt, caption in [
    ('파란색 구르기 매트 · 공용 1개', '구르기 매트는 각 홀에 있나요?',
     'blue-rolling-mat-reference-v1.jpg', '파란색 구르기 매트의 형태를 보여주는 동일 규격 제품 참고 사진',
     '동일 규격 참고 사진 · <a href="https://sunsports.kr/product/체조매트-0010/465/" target="_blank" rel="noopener" draggable="false">출처: 태양스포츠</a>'),
    ('홀마다 삼각대 1개', '촬영용 삼각대가 있나요?',
     'tripod-illustration-v1.png', '세 다리를 펼친 검은색 촬영용 삼각대 안내 이미지',
     '삼각대 형태 안내를 위한 연출 이미지')]:
    width, height, variants = responsive_image('equipment/' + filename)
    srcset = ', '.join(f'{url} {size}w' for size, url in variants)
    image = f'<figure class="equipment-photo"><img src="{variants[0][1]}" srcset="{srcset}" sizes="(max-width:560px) calc(100vw - 82px), (max-width:900px) calc((100vw - 180px) / 2), (max-width:1360px) calc((100vw - 244px) / 2), 558px" width="{width}" height="{height}" alt="{alt}" draggable="false" loading="lazy" decoding="async"><figcaption>{caption}</figcaption></figure>'
    answer = next(item['acceptedAnswer']['text'] for item in faq['mainEntity'] if item['name'] == question)
    equipment_id = 'rolling-mat' if filename.startswith('blue-') else 'camera-tripod'
    practice_equipment += f'<article id="{equipment_id}">{image}<b>{title}</b><p>{html.escape(answer)}</p></article>'
# User-supplied actual board photo, approved after the earlier text-only request.
tap_width, tap_height, tap_variants = responsive_image('equipment/tap-board-actual-v1.png')
tap_srcset = ', '.join(f'{url} {size}w' for size, url in tap_variants)
tap_board_photo = f'<figure class="equipment-photo tap-board-photo"><img src="{tap_variants[0][1]}" srcset="{tap_srcset}" sizes="(max-width:560px) calc(100vw - 82px), 260px" width="{tap_width}" height="{tap_height}" alt="벽에 세워 보관 중인 실제 비치 나무 탭판" draggable="false" loading="lazy" decoding="async"><figcaption>실제 비치 탭판 · 보관 중인 모습</figcaption></figure>'
practice_equipment += f'<article class="equipment-tapboard" id="tap-boards">{tap_board_photo}<div><b>탭판 {tap_count}개 · 선착순 사용 가능</b><p>{html.escape(tap_rule)}</p></div></article>'

# The existing answers remain the source of both visible steps/paragraphs and JSON-LD.
shoe_width, shoe_height, shoe_variants = responsive_image('equipment/tap-shoe-rule-v1.png')
shoe_srcset = ', '.join(f'{url} {size}w' for size, url in shoe_variants)
# Each question has an explicit next step; detail links keep a normal URL fallback.
faq_details = {
    '리듬앤조이 연습실 예약은 어디서 하나요?': None,
    '리듬앤조이 연습실 위치는 어디인가요?': ('오시는 길 자세히', '/location/#directions', '#directions'),
    '주차가 가능한가요?': ('주차 안내 자세히', '/location/#parking', '#parking'),
    '새벽 통대관은 어떻게 예약하나요?': ('새벽 통대관 방법 보기', '/schedule/#night-booking', '#night-booking'),
    '어떤 연습을 할 수 있나요?': ('홀 사진·크기 비교', '/spaces/#rooms', '#rooms'),
    '바닥은 어떤 마루인가요?': ('마루 구조·마감 보기', '/spaces/#floor-structure', '#floor-structure, #floor-materials'),
    'TV와 연결 케이블이 있나요?': ('TV 연결 안내 보기', '/guide/#tv-guide', '#tv-guide'),
    '음향·냉난방과 편의시설은 무엇이 있나요?': ('시설 안내 자세히', '/spaces/#facility-basics', '#facility-basics, #facility-extra'),
    '구르기 매트는 각 홀에 있나요?': ('매트 사진·사용 안내', '/guide/#rolling-mat', '#rolling-mat'),
    '촬영용 삼각대가 있나요?': ('삼각대 사진·사용 안내', '/guide/#camera-tripod', '#camera-tripod'),
    '인원이 늘어나면 추가요금이 있나요?': ('룸별 이용요금 보기', '/pricing/#rates', '#rates'),
    '연습화는 따로 준비해야 하나요?': ('탭판·이용 수칙 보기', '/guide/#tap-boards', '#tap-boards, #house-rules'),
    '예약 변경·환불은 어떻게 하나요?': ('변경·환불 기준 보기', '/guide/#refund-policy', '#refund-policy'),
}
assert set(faq_details) == {item['name'] for item in faq['mainEntity']}, 'Every Q&A needs a reviewed action.'
faq_html = ''
for i, item in enumerate(faq['mainEntity']):
    name = item['name']
    paragraphs = item['acceptedAnswer']['text'].split('\n')
    if name == '리듬앤조이 연습실 예약은 어디서 하나요?':
        answer = '<ol class="faq-steps">' + ''.join(f'<li>{html.escape(part)}</li>' for part in paragraphs) + '</ol>'
    else:
        answer = ''.join(f'<p>{html.escape(part)}</p>' for part in paragraphs)
    answer = f'<div class="faq-answer">{answer}</div>'
    if name == '연습화는 따로 준비해야 하나요?':
        illustration = f'''<figure class="shoe-rule-image"><img src="{shoe_variants[0][1]}" srcset="{shoe_srcset}" sizes="(max-width:560px) calc(100vw - 82px), 260px" width="{shoe_width}" height="{shoe_height}" alt="탭신발 밑창의 앞부분과 뒤꿈치에 달린 금속 징을 보여주는 안내 이미지" draggable="false" loading="lazy" decoding="async"><figcaption>금속 징이 달린 탭신발 예시 · 연출 이미지</figcaption><strong class="shoe-floor-warning"><span aria-hidden="true">×</span> 마루에서 직접 사용 불가</strong><span class="shoe-board-rule">탭판·개인 탭보드 위에서 사용<br>탭판 {tap_count}개 비치 · 선착순 사용 가능</span></figure>'''
        answer = f'<div class="faq-shoe-rule"><div class="shoe-rule-visuals">{illustration}{tap_board_photo}</div>{answer}</div>'
    actions = ''
    if name in ('리듬앤조이 연습실 예약은 어디서 하나요?', '새벽 통대관은 어떻게 예약하나요?'):
        actions += '<a class="faq-menu-guide" href="#booking-menu" data-guide-menu="booking-menu" draggable="false">상단 예약하기 위치 보기 <span aria-hidden="true">↑</span></a>'
    if faq_details[name]:
        label, destination, selector = faq_details[name]
        actions += f'<a class="faq-action" href="{destination}" data-faq-detail="{selector}" data-faq-title="{i+1:02d} · {label}" aria-haspopup="dialog" aria-controls="faq-detail-dialog" draggable="false">{label} <span aria-hidden="true">＋</span></a>'
    if name in ('리듬앤조이 연습실 위치는 어디인가요?', '주차가 가능한가요?'):
        actions += f'<a class="faq-action faq-map-link" href="{NAVER_MAP}" target="_blank" rel="noopener" data-dialog-extra draggable="false">네이버 지도 바로가기 <span aria-hidden="true">↗</span></a>'
    faq_html += f'<details class="faq-item" {"open" if i == 0 else ""}><summary draggable="false"><span class="faq-number" aria-hidden="true">{i+1:02d}</span><span class="faq-question">{html.escape(name)}</span></summary>{answer}<div class="faq-actions">{actions}</div></details>'

FAQ_DIALOG = '<dialog id="faq-detail-dialog" class="faq-detail-dialog" aria-labelledby="faq-detail-title"><header class="faq-detail-heading"><h2 id="faq-detail-title">자세한 안내</h2><button type="button" data-faq-close aria-label="상세 안내 닫기" draggable="false" autofocus>×</button></header><div class="faq-detail-body" aria-live="polite"></div><footer class="faq-detail-footer"><a class="faq-action" data-faq-source draggable="false">페이지에서 보기 <span aria-hidden="true">↗</span></a><div data-faq-extra></div></footer></dialog>'

def button(label, url, primary=False):
    return f'<a class="button {"primary" if primary else "secondary"}" href="{url}" draggable="false">{label}<span aria-hidden="true">↗</span></a>'

def booking_links():
    return f'''<div class="booking-links" aria-label="예약 채널">
    <a class="booking-link naver-book" href="{NAVER_BOOKING}" target="_blank" rel="noopener" draggable="false" aria-label="네이버 예약하러 가기 (새 창)"><span class="booking-symbol" aria-hidden="true">N</span><span class="booking-link-copy"><strong>네이버</strong><span>예약하러 가기</span></span><span class="booking-arrow" aria-hidden="true">↗</span></a>
    <a class="booking-link spacecloud-book" href="{SPACECLOUD_BOOKING}" target="_blank" rel="noopener" draggable="false" aria-label="스페이스클라우드 예약하러 가기 (새 창)"><span class="booking-symbol" aria-hidden="true"><img src="/calendar_set/calendar_v10/img/spacecloud-icon.png" alt="" draggable="false" loading="eager"></span><span class="booking-link-copy"><strong>스페이스클라우드</strong><span>예약하러 가기</span></span><span class="booking-arrow" aria-hidden="true">↗</span></a></div>'''

def card(room):
    return f'''<a class="room-card" href="/spaces/{room.lower()}/" draggable="false">
      <div class="room-photo">{img(room)}<span class="room-letter">{room}</span><span class="photo-link" aria-hidden="true">↗</span></div>
      <div class="room-meta"><h3>{room}홀 <small>{prices[room]['area']} · {dimensions[room]}</small></h3><p class="room-purpose">{rooms[room][0]}</p><p class="room-feature">{rooms[room][4]}</p><p>평일 낮 <strong>{prices[room]['rates'][0]}원</strong><span> / 시간</span></p></div></a>'''

def shell(title, desc, body, active='home', crumb=None):
    links=[('home','소개','/'),('spaces','공간 안내','/spaces/'),('pricing','이용요금','/pricing/'),('location','오시는 길','/location/'),('guide','이용 안내','/guide/')]
    nav=''.join(f'<a href="{url}" {"aria-current=page" if key==active else ""} draggable="false">{label}</a>' for key,label,url in links)
    breadcrumb = f'<nav class="breadcrumbs" aria-label="현재 위치"><a href="/">홈</a><span>/</span>{crumb}</nav>' if crumb else ''
    return f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><meta name="description" content="{html.escape(desc)}"><meta name="robots" content="noindex,nofollow">
<link rel="stylesheet" href="/preview-assets/style.css"><script src="/preview-assets/site.js" defer></script>
</head><body><a class="skip" href="#main">본문 바로가기</a>
<div class="site-header"><header class="header">
<a class="header-brand" href="/" aria-label="사당연습실 리듬앤조이 홈" draggable="false">사당연습실 <strong>리듬앤조이</strong></a>
<nav class="nav" aria-label="주 메뉴">{nav}</nav><a href="/schedule/" id="booking-menu" class="header-book" {"aria-current=page" if active=="schedule" else ""} draggable="false">예약하기 <span>↗</span><span class="booking-location-hint" aria-hidden="true">이 버튼에서 시작하세요</span></a></header></div>
<div class="page-viewport"><div class="page-surface">
<main id="main" tabindex="-1">{breadcrumb}{body}</main>
<footer><div class="footer-top"><a href="/" class="footer-brand">리듬앤조이<span>RHYTHM & JOY STUDIO</span></a><p>서울 동작구 남부순환로 2077 지하 2층<br>사당역 7번 출구, 대로변 도보 3분 거리 · <a href="tel:01048017180">010-4801-7180</a></p></div><div class="footer-bottom"><span>© RHYTHM & JOY</span><span>홈페이지 미리보기 · 실제 예약현황 연결</span></div></footer>
</div></div>
</body></html>'''

VISITOR_PANEL = '''
<div class="visitor-summary"><button type="button" id="visitor-open" class="visitor-open" aria-haspopup="dialog" aria-controls="visitor-dialog" draggable="false">
<span>총 조회 <strong data-visitor-views>—</strong></span><span class="visitor-divider" aria-hidden="true">·</span><span>오늘 방문 <strong data-visitor-today>—</strong></span><span class="visitor-open-label">방문 통계 <span aria-hidden="true">↗</span></span></button></div>
<dialog id="visitor-dialog" class="visitor-dialog" aria-labelledby="visitor-title">
<div class="visitor-dialog-heading"><div><span class="visitor-eyebrow">RHYTHM &amp; JOY</span><h2 id="visitor-title">방문 통계</h2></div><button type="button" class="visitor-close" aria-label="방문 통계 닫기">×</button></div>
<div class="visitor-dialog-body"><p class="visitor-caption">한국시간 기준 · 누적 조회와 오늘 방문 현황</p>
<div class="visitor-totals"><div><span>누적 조회수</span><strong data-visitor-views>—</strong></div><div><span>오늘 방문자</span><strong data-visitor-today>—</strong></div></div>
<p id="visitor-baseline" class="visitor-caption"></p>
<div class="visitor-toolbar"><div class="visitor-periods" role="group" aria-label="조회 기간"><button type="button" data-visitor-days="7" aria-pressed="false">7일</button><button type="button" data-visitor-days="30" aria-pressed="true">30일</button><button type="button" data-visitor-days="90" aria-pressed="false">90일</button></div><button type="button" id="visitor-refresh">새로고침</button></div>
<p id="visitor-status" class="visitor-status" role="status" aria-live="polite"></p>
<div id="visitor-report" hidden><p id="visitor-range" class="visitor-range"></p><div id="visitor-chart" class="visitor-chart" aria-hidden="true"></div><div class="visitor-chart-labels" aria-hidden="true"><span id="visitor-chart-start"></span><span id="visitor-chart-end"></span></div>
<p id="visitor-period-summary" class="visitor-period-summary"></p>
<details class="visitor-daily"><summary>날짜별 상세 보기</summary><table><caption class="visitor-sr-only">날짜별 방문자 수와 조회 수</caption><thead><tr><th scope="col">날짜</th><th scope="col">방문자</th><th scope="col">조회 수</th></tr></thead><tbody id="visitor-daily-rows"></tbody></table></details></div>
<p id="visitor-as-of" class="visitor-caption"></p><p id="visitor-collection" class="visitor-caption"></p>
<p class="visitor-note">누적 조회는 기존 Google Analytics 기록에 현재 사이트 조회를 이어 더한 횟수이며, 사람 수가 아닙니다. 과거 기록은 공식 도메인의 테스트·정산 페이지를 제외했습니다.<br>현재 조회는 화면을 2.5초 이상 본 페이지 열기를 집계합니다. 메뉴 이동·일정 자동 갱신·통계 열기로는 늘어나지 않습니다. 오늘 방문자는 같은 브라우저를 중복 제외하며, 쿠키 삭제·다른 기기는 별도로 집계될 수 있습니다.</p></div></dialog>
'''

def write(path, title, desc, body, active='home', crumb=None):
    folder=HERE/path
    folder.mkdir(parents=True,exist_ok=True)
    source = shell(title,desc,body,active,crumb)
    source = source.replace('/preview-assets/', PREVIEW_PATH)
    # One route owner for local and deployed previews; existing facility assets stay shared.
    source = re.sub(r'href="(/(?:spaces|pricing|location|guide|schedule|structure)/[^" ]*|/)"',
                    lambda m: 'href="' + PREVIEW_PATH + m[1].lstrip('/') + '"', source)
    source = source.replace('로컬 검토용 샘플입니다. 검색 노출은 비활성화되어 있으며 운영 사이트에는 반영되지 않았습니다.',
                            '별도 주소로 공개한 검토용 샘플입니다. 검색 노출은 비활성화되어 있습니다.')
    (folder/'index.html').write_text(source)

    if path != 'structure':
        # The same source produces public pages; the preview remains independently unindexed.
        public = shell(title, desc, body, active, crumb)
        public = public.replace('/preview-assets/', SITE_PATH)
        public = public.replace('noindex,nofollow', 'index,follow')
        public = public.replace('홈페이지 미리보기 · 실제 예약현황 연결', '사당역 연습실 · 24시간 운영')
        canonical = ORIGIN + '/' + (path + '/' if path else '')
        image_room = path.split('/')[-1].upper() if path.startswith('spaces/') else 'A'
        share_image = f'{ORIGIN}{ASSETS}/room{image_room}/image{rooms[image_room][2]}.webp'
        meta = (f'<link rel="canonical" href="{canonical}">\n'
                f'<meta property="og:type" content="website">\n'
                f'<meta property="og:site_name" content="리듬앤조이 연습실">\n'
                f'<meta property="og:title" content="{html.escape(title)}">\n'
                f'<meta property="og:description" content="{html.escape(desc)}">\n'
                f'<meta property="og:url" content="{canonical}">\n'
                f'<meta property="og:image" content="{share_image}">\n'
                f'<meta property="og:image:alt" content="리듬앤조이 {html.escape(photo_descriptions[image_room][rooms[image_room][2]])}">\n'
                f'{verification}\n{tracking}\n'
                '<script src="/calendar_set/calendar_v10/visitor-stats.js?v=text-brand-20261008" defer></script>\n')
        structured = []
        if not path:
            business['image'] = ORIGIN + ASSETS + '/roomA/image2.webp'
            business['description'] = desc  # Match the current public summary, not legacy calendar copy.
            structured.extend([business, {
                '@context': 'https://schema.org', '@type': 'WebSite',
                'name': '리듬앤조이 연습실', 'alternateName': '사당연습실 리듬앤조이',
                'url': ORIGIN + '/', 'inLanguage': 'ko-KR',
            }])
        elif crumb:
            # Use the visible breadcrumb, not a separate SEO-only navigation hierarchy.
            names = [' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', part)).split())
                     for part in crumb.split('<span>/</span>')]
            trail = [{'@type': 'ListItem', 'position': 1, 'name': '홈', 'item': ORIGIN + '/'}]
            for position, name in enumerate(names, 2):
                item = canonical if position == len(names) + 1 else ORIGIN + '/' + path.split('/')[0] + '/'
                trail.append({'@type': 'ListItem', 'position': position, 'name': name, 'item': item})
            structured.append({'@context': 'https://schema.org', '@type': 'BreadcrumbList',
                               'itemListElement': trail})
        if path == 'guide':
            structured.append(faq)
        meta += '<script id="site-structured-data" type="application/ld+json">' + json.dumps(structured, ensure_ascii=False) + '</script>\n'
        public = public.replace('</head>', meta + '</head>')
        # Persistent outside the sliding page surface: one dialog and counter per tab.
        public = public.replace('</body>', VISITOR_PANEL + '</body>')
        public = public.replace(SITE_PATH + 'style.css', SITE_PATH + 'style.css?v=faq-tv-size-20261008')
        public = public.replace(SITE_PATH + 'site.js', SITE_PATH + 'site.js?v=faq-details-20261008')
        target = SITE / path
        target.mkdir(parents=True, exist_ok=True)
        (target / 'index.html').write_text(public)
        public_routes.append(canonical)

write('', '사당연습실 리듬앤조이 | 24시간 댄스 연습실', '사당연습실 리듬앤조이. 사당역 7번 출구 대로변 도보 3분, 24시간 A–E홀. 전 홀 댄스 전용 쿠션 마루·인원 추가금 없음.', f'''
<section class="hero"><div class="hero-copy"><span class="eyebrow coral">SADANG · RHYTHM & JOY</span><p class="hero-location"><span class="tiny-dot"></span>사당역 7번 출구, 대로변 도보 3분</p><h1><span>사당연습실</span><br>리듬앤조이<span class="title-dot">.</span></h1><p class="hero-lead">오늘의 연습이<br> 내일의 무대가 되는 곳.</p><p class="hero-desc">혼자 몰입하는 순간부터 함께 맞추는 안무까지.<br> 4평형부터 25평형까지, 나에게 맞는 공간에서 연습하세요.</p><div class="actions">{button('공간 둘러보기','/spaces/',True)}</div><div class="hero-stats"><span><strong>5</strong>개의 연습룸</span><span><strong>24</strong>시간 운영</span><span><strong>3</strong>분 도보 거리</span></div></div>
<div class="hero-visual">{img('A','2',eager=True,layout='hero')}<div class="image-caption"><span><b>A HALL</b>{prices['A']['area']} · {dimensions['A']}</span><a href="/spaces/a/" aria-label="A홀 상세 보기">↗</a></div><div class="photo-tag">공간은 비워두고,<br>가능성은 채워두고.</div></div></section>
<section class="intro-line"><span class="eyebrow">SPACE FOR YOUR RHYTHM</span><p><strong>사당역 7번 출구, 24시간 연습실.</strong><br> 리듬앤조이는 서울 동작구 사당역 인근의 사당 연습실입니다.<br> 전 홀 댄스 전용 쿠션 마루와 거울을 갖춘 A–E홀에서 개인 연습과 단체 안무를 준비하세요.</p></section>
<section class="section"><div class="section-heading"><div><span class="eyebrow coral">OUR SPACES</span><h2>사당연습실 리듬앤조이 A–E홀 둘러보기</h2></div><a class="text-link" href="/spaces/">5개 공간 모두 보기 <span>↗</span></a></div><div class="room-grid">{''.join(card(x) for x in ['A','B','E'])}</div><div class="small-space-note"><span>작은 공간에서 집중하고 싶다면?</span><a href="/spaces/c/">C홀 · {prices['C']['area']} ↗</a><a href="/spaces/d/">D홀 · {prices['D']['area']} ↗</a></div></section>
''')

floor_width, floor_height, floor_variants = responsive_image('dance-floor-structure-v1.png')
floor_srcset = ', '.join(f'{url} {width}w' for width, url in floor_variants)
plan_width, plan_height, plan_variants = responsive_image('roomALL/floorplan-3d-final-v5.png')
plan_srcset = ', '.join(f'{url} {width}w' for width, url in plan_variants)
write('spaces','사당연습실 리듬앤조이 | 공간 안내·룸 사진','사당연습실 리듬앤조이 A–E홀 사진과 크기 비교. 전 홀 댄스 전용 쿠션 마루, A·B홀 TV와 개인·단체 연습 공간을 안내합니다.',f'''
<section class="page-heading"><span class="eyebrow coral">OUR SPACES</span><h1>공간 안내</h1><p>리듬앤조이의 개인 연습룸부터 단체 안무 공간까지.<br>4평형부터 25평형까지. 사진과 크기를 비교해 연습에 맞는 룸을 골라보세요.</p><p>평형은 공간 안내용 표기이며, 실제 크기는 각 홀의 m 치수를 기준으로 확인해주세요.</p></section>
<section class="section rooms-section" id="rooms"><div class="room-grid all-rooms">{''.join(card(x) for x in ['A','B','E','C','D'])}</div></section>
<section class="section floorplan-section" aria-labelledby="floorplan-title"><div class="section-heading"><div><span class="eyebrow coral">STUDIO LAYOUT</span><h2 id="floorplan-title">우리 공간을 한눈에.</h2></div><a class="text-link" href="{plan_variants[-1][1]}" target="_blank" rel="noopener" draggable="false">도면 크게 보기 <span aria-hidden="true">↗</span></a></div>
<figure class="floorplan-figure"><a href="{plan_variants[-1][1]}" target="_blank" rel="noopener" draggable="false" aria-label="연습실 입체 도면 크게 보기 (새 창)"><img src="{plan_variants[-1][1]}" srcset="{plan_srcset}" sizes="(max-width:560px) calc(100vw - 42px), (max-width:900px) calc(100vw - 64px), min(840px, max(480px, calc(150vh - 420px)))" width="{plan_width}" height="{plan_height}" alt="기존 평면도와 실제 홀 사진을 참고한 입체 배치도. 왼쪽 A홀, 중앙 B홀, 오른쪽 아래 C·D홀, 오른쪽 위 E홀. 복도 왼쪽 끝과 D홀 옆에는 계단이 있고, 출구 표기 위쪽은 엘리베이터입니다. 거울은 A·C홀 오른쪽 벽, B·D·E홀 왼쪽 벽에 수직으로 밀착되어 있으며 E홀 오른쪽 아래 끝에는 에어컨이 있습니다." loading="lazy" decoding="async" draggable="false"></a><figcaption>기존 평면도와 실제 홀 사진을 참고한 공간 안내용 입체 이미지입니다. 마감·높이·비품 위치는 실제와 차이가 있을 수 있으며, 크기는 각 홀의 m 치수를 확인해주세요.</figcaption></figure>
<div class="plan-notes"><p><strong>5개의 독립 연습룸</strong><span>A·B·E홀부터 개인 연습에 맞는 C·D홀까지.</span></p><p><strong>함께 쓰는 편의시설</strong><span>탈의실 2곳 · 내부 공용 화장실 · 엘리베이터</span></p></div></section>
<section class="facilities"><span class="eyebrow">STUDIO FACILITIES</span><h2>연습에 집중할 수 있도록.</h2><div id="facility-basics"><article><b>댄스 전용 쿠션 마루</b><p>전 홀에 적용 · A·E홀은 틈이 없는 강화마루</p></article><article><b>전면 거울</b><p>동작과 동선을 바로 확인</p></article><article><b>A·B홀 TV</b><p>A홀 55인치 · B홀 65인치<br>HDMI·C타입·8핀 커넥터 제공</p></article></div>
<div class="facility-extra" id="facility-extra"><article><b>음악과 영상 준비</b><p>블루투스 스피커와 Wi-Fi를 이용할 수 있습니다. TV가 필요한 연습은 A·B홀을 선택해주세요.</p></article><article><b>사계절 연습 공간</b><p>냉난방 시설을 갖추고 있습니다. 전 홀 24시간 운영하며, 인원 추가금 없이 룸 단위로 대관합니다.</p></article><article><b>공용 편의시설</b><p>탈의실 2곳, 내부 공용 화장실과 정수기를 이용할 수 있습니다. 시설 안전을 위해 CCTV를 운영합니다.</p></article></div>
<div class="practice-equipment">{practice_equipment}</div>
<figure class="floor-figure" id="floor-structure"><img src="{floor_variants[-1][1]}" srcset="{floor_srcset}" sizes="(max-width:560px) calc(100vw - 42px), (max-width:900px) calc(100vw - 64px), min(720px, max(480px, calc(150vh - 420px)))" width="{floor_width}" height="{floor_height}" alt="외줄장선식 쿠션 마루 구조: 마루 아래 합판, 장선목, 방진고무, 쐐기가 있는 구조 설명" loading="lazy" decoding="async" draggable="false"><figcaption>외줄장선식 쿠션 마루의 구조를 설명한 이미지입니다. 홀별 표면 마감은 아래 안내를 확인해주세요.</figcaption></figure>
<div id="floor-materials"><article><b>마루 아래의 쿠션 구조</b><p>장선은 마루 아래를 받치는 목재입니다. 마루와 합판 아래에 장선목과 방진고무 등을 배치하는 구조로, 일반 댄스홀처럼 쿠션감이 있는 마루에서 연습할 수 있습니다.</p></article><article><b>A·E홀: 틈 없는 강화마루</b><p>장선 구조 위에 틈이 없는 강화마루로 표면을 마감했습니다. 사진에서 바닥의 마감과 연습 공간을 함께 확인해보세요.</p></article><article><b>B·C·D홀: 장선마루</b><p>나무 마루 표면 아래에 장선 구조가 있는 댄스 전용 쿠션 마루입니다. 모든 홀에서 개인 실내 연습화를 사용해주세요.</p></article></div></section>''','spaces','공간 안내')

for room,(tagline,description,cover,gallery,feature) in rooms.items():
    rates=prices[room]['rates']
    rate_labels=['평일 낮<small>06:00~16:00</small>',
                 '평일 저녁 · 주말/공휴일<small>평일 16:00~24:00<br>주말·공휴일 06:00~24:00</small>',
                 '새벽<small>매일 00:00~06:00</small>',
                 '새벽 통대관<small>00:00~06:00 · 6시간 전체</small>']
    write(f'spaces/{room.lower()}',f'{room}홀 {prices[room]["area"]} | 사당연습실 리듬앤조이',f'사당연습실 리듬앤조이 {room}홀 {prices[room]["area"]}, {dimensions[room]}. {tagline} {feature}, 사진과 시간대별 요금을 확인하세요.',f'''
<section class="room-detail-hero"><div><span class="eyebrow coral">RHYTHM & JOY / {room} HALL</span><h1>{room}홀<span>{prices[room]['area']}</span></h1><h2>{tagline}</h2><p>사당연습실 리듬앤조이 {room}홀입니다. {description}</p><div class="specs"><span>{dimensions[room]}</span><span>24시간 운영</span><span>{feature}</span></div></div>{img(room,cover,'detail-cover',True,layout='detail')}</section>
<section class="section"><div class="section-heading"><div><span class="eyebrow coral">TAKE A CLOSER LOOK</span><h2>{room}홀 둘러보기</h2></div><span class="subtle">리듬앤조이 실제 시설 사진</span></div><div class="gallery">{''.join(f'<figure>{img(room,n,layout="wide" if i == 0 else "gallery")}<figcaption>{photo_descriptions[room][n]}</figcaption></figure>' for i,n in enumerate(gallery))}</div></section>
<p class="subtle area-note">평형은 공간 안내용 표기입니다. 실제 크기는 위의 m 치수를 기준으로 확인해주세요.</p>
<section class="room-rate-section"><div><span class="eyebrow coral">HOURLY RATE</span><h2>{room}홀 이용요금</h2><p>시간당 요금 · 통대관은 6시간 기준<br><strong>인원 추가금 없음</strong></p></div><dl class="rate-list">{''.join(f'<div><dt>{label}</dt><dd>{price}<small>원</small></dd></div>' for label,price in zip(rate_labels,rates))}</dl></section>
''','spaces',f'<a href="/spaces/">공간 안내</a><span>/</span>{room}홀')

rows=''.join(f'<tr><th scope="row"><a href="/spaces/{r.lower()}/" draggable="false">{r}홀 <span>{prices[r]["area"]}</span></a><span class="room-size">{dimensions[r]}</span></th>'+''.join(f'<td>{p}</td>' for p in prices[r]['rates'])+'</tr>' for r in 'ABCDE')
write('pricing','사당연습실 리듬앤조이 | 이용요금·새벽 통대관','사당연습실 리듬앤조이 A–E홀의 평일·주말·새벽 시간당 요금과 00:00~06:00 통대관 요금. 인원 추가금 없이 이용할 수 있습니다.',f'''
<section class="page-heading compact"><span class="eyebrow coral">SIMPLE & CLEAR</span><h1>이용요금</h1><p>리듬앤조이 A–E홀의 시간대별 요금을 한눈에 비교하세요.<br>시간당 요금이며, 새벽 통대관은 00:00~06:00 전체 요금입니다.<br><strong>인원 추가금 없음</strong></p></section>
<section class="section price-section" id="rates"><div class="section-heading"><h2>룸별 이용요금</h2><span class="subtle">단위: 원</span></div>
<table class="price-table" aria-label="룸별 이용요금표">
<colgroup><col class="room-column"><col span="4"></colgroup>
<thead><tr><th scope="col">공간</th><th scope="col">평일 낮<small>06~16시</small></th><th scope="col">평일 저녁<br>주말·공휴일</th><th scope="col">새벽<small>00~06시</small></th><th scope="col">새벽<br>통대관<small>00~06시</small></th></tr></thead>
<tbody>{rows}</tbody></table>
<div class="price-periods"><p><strong>평일 낮</strong> 06:00~16:00</p><p><strong>평일 저녁</strong> 16:00~24:00 · <strong>주말·공휴일</strong> 06:00~24:00</p><p><strong>새벽</strong> 매일 00:00~06:00 · <strong>통대관</strong> 같은 시간대 6시간 전체</p></div>
<div class="price-footnotes"><p>네이버와 스페이스클라우드는 동일한 기준 가격으로 운영됩니다.</p><p>평형은 공간 안내용 표기이며, 실제 크기는 각 홀의 m 치수를 기준으로 확인해주세요.</p></div></section>
''','pricing','이용요금')

write('location','사당연습실 리듬앤조이 | 사당역 7번 출구 오시는 길','사당연습실 리듬앤조이 오시는 길. 사당역 7번 출구 대로변 도보 3분, 서울 동작구 남부순환로 2077 지하 2층. 주차 안내 확인.',f'''
<section class="page-heading"><span class="eyebrow coral">CLOSER THAN YOU THINK</span><h1>오시는 길</h1><p>사당연습실 리듬앤조이는 7번 출구에서 대로변을 따라 도보 3분 거리입니다.<br>드림디포 문구점 건물 지하 2층으로 오세요.</p></section>
<section class="location-layout"><div class="address-panel"><span class="eyebrow coral">FIND US</span><h2>리듬앤조이 연습실</h2><address>서울 동작구 남부순환로 2077<br><strong>지하 2층</strong></address><p>사당역 7번 출구, 대로변 도보 3분 거리<br>드림디포 문구점 건물</p><div class="actions">{button('네이버 지도 열기',NAVER_MAP,True)}<button class="button secondary" type="button" data-copy-address>주소 복사 <span aria-hidden="true">↗</span></button></div><p class="copy-result" role="status"></p></div><div class="wayfinding" id="directions"><span class="eyebrow">HOW TO GET HERE</span><ol><li><span>01</span><div><h3>사당역 7번 출구</h3><p>7번 출구로 나와 대로변을 따라 약 3분 이동해 주세요.</p></div></li><li><span>02</span><div><h3>드림디포 문구점 건물</h3><p>주소: 남부순환로 2077</p></div></li><li><span>03</span><div><h3>지하 2층, 리듬앤조이</h3><p>예약한 홀과 이용시간을 확인하고 입장하세요.</p></div></li></ol></div></section>
<section class="parking" id="parking"><span class="eyebrow coral">PARKING</span><h2>주차는 공영주차장을 권장합니다.</h2><p>건물 주차는 기본적으로 불가합니다. 문구점 폐점 후 문구점 앞 공간만 제한적으로 이용할 수 있습니다.<br>카리프트 앞, 지정주차라인, 지하주차 리프트는 사용할 수 없습니다.</p></section>''','location','오시는 길')

write('guide','사당연습실 리듬앤조이 | 이용 안내·자주 묻는 질문','사당연습실 리듬앤조이 예약, 새벽 통대관, TV·마루·편의시설, 주차에 관한 Q&A와 이용 수칙·환불 기준을 확인하세요.',f'''
<section class="page-heading"><span class="eyebrow coral">BEFORE YOUR PRACTICE</span><h1>이용 안내</h1><p>사당연습실 리듬앤조이 방문 전 이용 수칙과 변경·환불 기준을 확인해주세요.</p></section>

<section class="faq-section" aria-labelledby="faq-title"><div class="section-heading"><div><span class="eyebrow coral">Q &amp; A</span><h2 id="faq-title">자주 묻는 질문</h2></div></div><div class="faq-list">{faq_html}</div></section>{FAQ_DIALOG}
<section class="equipment-section" aria-labelledby="equipment-title"><span class="eyebrow coral">PRACTICE EQUIPMENT</span><h2 id="equipment-title">준비된 연습 도구</h2><div class="practice-equipment">{practice_equipment}</div></section>
<section class="guide-columns"><article id="tv-guide"><span class="eyebrow coral">SCREEN PRACTICE</span><h2>TV로 영상을 보며 연습하기</h2><p>A홀에는 55인치, B홀에는 65인치 TV가 있으며 대관 중 무료로 이용할 수 있습니다. HDMI·C타입·8핀 커넥터를 제공합니다.</p><p>기기에 따라 연결되지 않을 수 있습니다.</p></article><article><span class="eyebrow coral">BEFORE YOU ARRIVE</span><h2>방문 전에 준비해주세요.</h2><ul><li>예약문자에 안내된 홀, 날짜와 이용시간을 확인해주세요.</li><li>바닥은 전 홀 댄스 전용 쿠션 마루입니다. 외부에서 신던 신발 대신 개인 실내 연습화를 준비해주세요.</li><li>TV 영상을 보며 연습한다면 A·B홀인지 확인해주세요.</li><li>연습 준비를 포함해 공간을 사용하는 시간은 대관이 필요합니다.</li></ul></article></section>
<section class="guide-columns"><article id="house-rules"><span class="eyebrow coral">HOUSE RULES</span><h2>함께 지키는 이용 수칙</h2><ul><li>외부 신발 착용 불가 (개인 실내 연습화 사용)</li><li>연습을 위한 이용은 10분이라도 대관이 필요합니다.</li><li>징·장구·타악기는 사용할 수 없으며, 탭댄스는 탭판 위에서만 가능합니다.</li><li>국물 음식과 냄새가 심한 음식은 반입하지 마세요.</li><li>물품 파손 시 관리자에게 알려주세요.</li></ul></article><article id="refund-policy"><span class="eyebrow coral">CANCELLATION</span><h2>변경·환불 안내</h2><p>예약 변경은 취소 후 재예약으로 진행됩니다.</p><dl class="refund"><div><dt>예약 후 2시간 안 변심 취소</dt><dd>무료</dd></div><div><dt>방문 3일 전</dt><dd>70%</dd></div><div><dt>방문 2일 전</dt><dd>50%</dd></div><div><dt>방문 1일 전 · 당일</dt><dd>0%</dd></div></dl><p class="subtle">실제 예약에 표시된 환불 규정을 확인해주세요.</p></article></section>''','guide','이용 안내')

write('schedule','사당연습실 리듬앤조이 | 예약·새벽 통대관','사당연습실 리듬앤조이 예약현황과 네이버·스페이스클라우드 예약 안내. 00~06시 새벽 통대관은 문자와 스페이스클라우드로 가능합니다.',f'''
<section class="page-heading compact"><span class="eyebrow coral">PLAN YOUR PRACTICE</span><h1>예약하기</h1><p>리듬앤조이 A–E홀 일정 확인부터 예약, 새벽 대관 문의까지 한곳에서.</p></section>
<section class="booking-panel" aria-label="예약 바로가기"><div class="booking-panel-copy"><span class="eyebrow coral">예약 바로가기</span><h2>원하는 곳에서 <br>바로 예약하세요.</h2><p>아래 일정표에서 빈 시간을 확인한 뒤 <br>예약 채널을 선택해주세요.</p></div>{booking_links()}</section>
<div class="sample-notice"><span class="tiny-dot"></span><strong>실제 예약현황</strong><span>룸을 선택하거나 예약 색상을 누르면 상세 시간을 확인할 수 있습니다.</span></div>
<section class="calendar-shell"><iframe title="리듬앤조이 예약현황" src="{PREVIEW_PATH}calendar-v11/index.html" class="calendar-frame"></iframe></section>
<section class="section"><div class="section-heading"><h2>예약은 이렇게 진행해요.</h2></div><div class="steps">
<article><span>01</span><h3>공간과 일정 확인</h3><p>위 일정표에서 원하는 홀과 시간을 확인하세요.</p></article>
<article><span>02</span><h3>예약 채널 선택</h3><p>네이버 또는 스페이스클라우드에서 날짜와 시간을 선택해 예약하세요.</p></article>
<article><span>03</span><h3>예약문자 도착 확인</h3><p>예약 안내 문자가 도착했는지 확인해주세요. 문자에 안내된 홀과 날짜·시간, 이용정보를 확인하면 끝입니다.</p></article></div></section>
<section class="night-banner" id="night-booking"><div><span class="eyebrow">AFTER HOURS</span><h2>새벽 통대관 예약</h2>
<p>매일 00:00~06:00, 6시간 전체 대관입니다.<br>문자 문의 또는 스페이스클라우드에서 예약할 수 있습니다.</p>
<p>문자 예약: 가능 여부 확인 → 승인 → 입금 → 예약문자 확인</p>
<div class="sms-example"><strong>문자 보내실 때</strong><p>“12~13일로 넘어가는 새벽 A홀 통대관 가능한가요?”</p></div></div>
<div class="actions">{button('010-4801-7180 문자 문의','sms:01048017180')}{button('스페이스클라우드 예약',SPACECLOUD_BOOKING)}</div></section>''','schedule','예약하기')

write('structure','사이트 구조 미리보기 | 리듬앤조이','독립 주소로 연결된 연습실 소개, 공간, 요금, 위치, 예약현황 구조를 확인하세요.',f'''
<section class="page-heading"><span class="eyebrow coral">SITE PREVIEW / 01</span><h1>내용마다 주소 하나.<br>예약은 익숙한 그대로.</h1><p>각 항목을 누르면 실제 샘플 페이지로 이동합니다.<br>검색으로 처음 들어온 사람도 공간을 이해하고, 예약현황 확인과 예약으로 이어지도록 구성했습니다.</p></section>
<section class="site-tree"><a class="tree-root" href="/"><span>HOME /</span><h2>사당연습실 리듬앤조이</h2><p>위치·공간 소개 + 주요 안내의 출발점</p><b>소개 페이지 열기 ↗</b></a><div class="tree-branches"><article><a href="/spaces/"><span>/spaces/</span><h3>공간 안내 ↗</h3></a><div class="tree-rooms">{''.join(f'<a href="/spaces/{r.lower()}/">{r}홀 <small>{prices[r]["area"]}</small> ↗</a>' for r in 'ABCDE')}</div></article><a href="/pricing/"><span>/pricing/</span><h3>이용요금 ↗</h3><p>룸별·시간대별 요금<br>새벽 통대관 안내</p></a><a href="/location/"><span>/location/</span><h3>오시는 길 ↗</h3><p>주소·지하철·주차<br>네이버 지도 연결</p></a><a href="/guide/"><span>/guide/</span><h3>이용 안내 ↗</h3><p>이용 수칙<br>변경·환불 안내</p></a><a href="/schedule/"><span>/schedule/</span><h3>예약하기 ↗</h3><p>일정표·예약 채널<br>예약 방법·새벽 대관 문의</p></a></div></section>
<section class="structure-notes"><h2>이 샘플에서 달라진 점</h2><div><article><b>검색 후 바로 읽는 소개</b><p>제목뿐 아니라 첫 HTML 본문에 위치, 시설, 이용 목적을 담았습니다.</p></article><article><b>보내고 다시 찾을 수 있는 주소</b><p>A홀 사진이나 이용요금 페이지를 각각 직접 열고 공유할 수 있습니다.</p></article><article><b>일정 확인에서 예약까지</b><p>일정표는 예약현황을 보여주고, 네이버·스페이스클라우드 버튼이 예약으로 연결합니다.</p></article></div><p class="subtle">로컬 검토용 샘플입니다. 검색 노출은 비활성화되어 있으며 운영 사이트에는 반영되지 않았습니다.</p></section>''','structure','전체 페이지 구조')
# calendar-v11 is an independent snapshot; rebuilding pages never overwrites it.
SITE.mkdir(parents=True, exist_ok=True)
for asset in ('style.css', 'site.js'):
    shutil.copyfile(HERE / asset, SITE / asset)
(SITE / 'sitemap.xml').write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    ''.join(f'  <url><loc>{url}</loc><lastmod>{CONTENT_UPDATED}</lastmod></url>\n' for url in public_routes) + '</urlset>\n')
(SITE / 'robots.txt').write_text(f'User-agent: *\nAllow: /\n\nSitemap: {ORIGIN}/sitemap.xml\n')
(SITE / f'{INDEXNOW_KEY}.txt').write_text(INDEXNOW_KEY + '\n')
print(f'Built 12 preview and {len(public_routes)} public pages; independent calendar-v11 is preserved.')
