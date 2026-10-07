#!/usr/bin/env python3
"""Build an isolated, static site-structure preview from the existing v10 guide."""
from pathlib import Path
import html
import re

HERE = Path(__file__).resolve().parent
V10 = HERE.parent
PREVIEW_PATH = '/calendar_set/calendar_v10/site-preview/'
ASSETS = '/calendar_set/calendar_v10/home_infopage/images'
NAVER_BOOKING = 'https://booking.naver.com/booking/10/bizes/1257912'
SPACECLOUD_BOOKING = 'https://www.spacecloud.kr/space/66056'
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

rooms = {
    'A': ('넉넉한 동선, 함께 맞추는 호흡.', '넓은 공간이 필요한 안무와 단체 연습을 준비해 보세요. 10×6m의 연습 공간에 55인치 TV가 마련되어 있습니다.', '2', ['2','3','4'], '55인치 TV'),
    'B': ('음악을 틀고, 움직임에 집중.', '거울을 보며 동작을 맞추고, 65인치 TV로 연습 영상을 확인할 수 있는 공간입니다.', '4', ['4','2','3'], '65인치 TV'),
    'C': ('작은 동작도, 온전히 나답게.', '4.5×3.5m의 아담한 공간입니다. 혼자 또는 소규모로 집중할 연습실을 찾는 분께 소개합니다.', '2', ['2','1'], '쿠션바닥'),
    'D': ('가볍게 시작하는 나의 연습.', '4.5×2.8m의 소형 연습룸입니다. 짧은 개인 연습부터 차근차근 쌓아가는 루틴까지, 필요한 시간만 이용하세요.', '2', ['2','1','3'], '쿠션바닥'),
    'E': ('리듬이 이어지는 여유로운 공간.', '6.5×6m 공간에서 움직임과 동선을 확인해 보세요. 전 룸에 적용된 댄서 전용 쿠션바닥을 이용할 수 있습니다.', '3', ['3','2','4'], '쿠션바닥'),
}

def img(room, number=None, cls='', eager=False):
    number = number or rooms[room][2]
    return f'<img class="{cls}" src="{ASSETS}/room{room}/image{number}.webp" alt="리듬앤조이 {room}홀 연습 공간과 전면 거울" draggable="false" loading="{"eager" if eager else "lazy"}" decoding="async">'

def button(label, url, primary=False):
    return f'<a class="button {"primary" if primary else "secondary"}" href="{url}" draggable="false">{label}<span aria-hidden="true">↗</span></a>'

def booking_links():
    return f'''<div class="booking-links" aria-label="예약 채널">
    <a class="booking-link naver-book" href="{NAVER_BOOKING}" target="_blank" rel="noopener" draggable="false"><span class="booking-symbol" aria-hidden="true">N</span><span>네이버 예약</span><span aria-hidden="true">↗</span></a>
    <a class="booking-link spacecloud-book" href="{SPACECLOUD_BOOKING}" target="_blank" rel="noopener" draggable="false"><img src="/calendar_set/calendar_v10/img/spacecloud-icon.png" alt="" draggable="false"><span>스페이스클라우드 예약</span><span aria-hidden="true">↗</span></a></div>'''

def card(room):
    return f'''<a class="room-card" href="/spaces/{room.lower()}/" draggable="false">
      <div class="room-photo">{img(room)}<span class="room-letter">{room}</span><span class="photo-link" aria-hidden="true">↗</span></div>
      <div class="room-meta"><h3>{room}홀 <small>{prices[room]['area']} · {dimensions[room]}</small></h3><p>평일 낮 <strong>{prices[room]['rates'][0]}원</strong><span> / 시간</span></p></div></a>'''

def shell(title, desc, body, active='home', crumb=None):
    links=[('home','소개','/'),('spaces','공간 안내','/spaces/'),('pricing','이용요금','/pricing/'),('location','오시는 길','/location/'),('guide','이용 안내','/guide/')]
    nav=''.join(f'<a href="{url}" {"aria-current=page" if key==active else ""} draggable="false">{label}</a>' for key,label,url in links)
    breadcrumb = f'<nav class="breadcrumbs" aria-label="현재 위치"><a href="/">홈</a><span>/</span>{crumb}</nav>' if crumb else ''
    return f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><meta name="description" content="{html.escape(desc)}"><meta name="robots" content="noindex,nofollow">
<link rel="stylesheet" href="/preview-assets/style.css"><script src="/preview-assets/site.js" defer></script>
</head><body><a class="skip" href="#main">본문 바로가기</a>
<header class="header"><a class="brand" href="/" aria-label="리듬앤조이 홈" draggable="false"><span class="brand-mark">r<span>j</span><i>•</i></span><span>리듬앤조이<small>RHYTHM & JOY</small></span></a>
<nav class="nav" aria-label="주 메뉴">{nav}</nav><a href="/schedule/" class="header-book" {"aria-current=page" if active=="schedule" else ""} draggable="false">예약하기 <span>↗</span></a></header>
<main id="main">{breadcrumb}{body}</main>
<footer><div class="footer-top"><a href="/" class="footer-brand">리듬앤조이<span>RHYTHM & JOY STUDIO</span></a><p>서울 동작구 남부순환로 2077 지하 2층<br>사당역 7번 출구 도보 1분 · <a href="tel:01048017180">010-4801-7180</a></p></div><div class="footer-bottom"><span>© RHYTHM & JOY</span><span>홈페이지 미리보기 · 실제 예약현황 연결</span></div></footer>
</body></html>'''

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

write('', '사당연습실 리듬앤조이 | 공간·요금·예약 안내', '사당역 7번 출구 도보 1분. 사당 연습실 리듬앤조이의 A–E홀 사진, 이용요금, 위치와 예약현황을 확인하세요.', f'''
<section class="hero"><div class="hero-copy"><span class="eyebrow coral">SADANG · RHYTHM & JOY</span><p class="hero-location"><span class="tiny-dot"></span>사당역 7번 출구, 걸어서 1분</p><h1><span>사당연습실</span><br>리듬앤조이<span class="title-dot">.</span></h1><p class="hero-lead">오늘의 연습이<br>내일의 무대가 되는 곳.</p><p class="hero-desc">혼자 몰입하는 순간부터 함께 맞추는 안무까지.<br>4평부터 20평까지, 나에게 맞는 공간에서 연습하세요.</p><div class="actions">{button('공간 둘러보기','/spaces/',True)}</div><div class="hero-stats"><span><strong>5</strong>개의 연습룸</span><span><strong>24</strong>시간 운영</span><span><strong>1</strong>분 역세권</span></div></div>
<div class="hero-visual">{img('A','2',eager=True)}<div class="image-caption"><span><b>A HALL</b>20평 · 10 × 6m</span><a href="/spaces/a/" aria-label="A홀 상세 보기">↗</a></div><div class="photo-tag">공간은 비워두고,<br>가능성은 채워두고.</div></div></section>
<section class="intro-line"><span class="eyebrow">SPACE FOR YOUR RHYTHM</span><p><strong>연습에 필요한 것만, 가까운 곳에.</strong><br>리듬앤조이는 서울 동작구 사당역 인근의 사당 연습실입니다.<br>전 룸 쿠션바닥과 거울을 갖춘 A–E홀에서 나만의 리듬을 찾아보세요.</p></section>
<section class="section"><div class="section-heading"><div><span class="eyebrow coral">OUR SPACES</span><h2>어떤 공간을 찾고 있나요?</h2></div><a class="text-link" href="/spaces/">5개 공간 모두 보기 <span>↗</span></a></div><div class="room-grid">{''.join(card(x) for x in ['A','B','E'])}</div><div class="small-space-note"><span>작은 공간에서 집중하고 싶다면?</span><a href="/spaces/c/">C홀 · 5평 ↗</a><a href="/spaces/d/">D홀 · 4평 ↗</a></div></section>
''')

write('spaces','공간 안내 | 사당연습실 리듬앤조이','리듬앤조이 A–E홀의 실제 사진, 크기와 시간대별 요금을 비교하세요.',f'''
<section class="page-heading"><span class="eyebrow coral">OUR SPACES</span><h1>다섯 개의 공간,<br>각자의 리듬.</h1><p>4평부터 20평까지. 사진과 크기를 비교해 연습에 맞는 룸을 골라보세요.</p></section>
<section class="section rooms-section"><div class="room-grid all-rooms">{''.join(card(x) for x in ['A','B','E','C','D'])}</div></section>
<section class="facilities"><span class="eyebrow">IN EVERY ROOM</span><h2>연습에 집중할 수 있도록.</h2><div><article><b>쿠션바닥</b><p>전 룸 댄서 전용 쿠션바닥</p></article><article><b>전면 거울</b><p>동작과 동선을 바로 확인</p></article><article><b>A·B홀 TV</b><p>HDMI·C타입·8핀 커넥터 제공</p></article></div></section>''','spaces','공간 안내')

for room,(tagline,description,cover,gallery,feature) in rooms.items():
    rates=prices[room]['rates']
    rate_labels=['평일 낮<small>06:00~16:00</small>',
                 '평일 저녁 · 주말/공휴일<small>평일 16:00~24:00<br>주말·공휴일 06:00~24:00</small>',
                 '새벽<small>매일 00:00~06:00</small>',
                 '새벽 통대관<small>00:00~06:00 · 6시간 전체</small>']
    write(f'spaces/{room.lower()}',f'{room}홀 {prices[room]["area"]} | 사당연습실 리듬앤조이',f'사당 리듬앤조이 {room}홀 {dimensions[room]} 공간의 사진과 이용요금을 확인하세요.',f'''
<section class="room-detail-hero"><div><span class="eyebrow coral">RHYTHM & JOY / {room} HALL</span><h1>{room}홀<span>{prices[room]['area']}</span></h1><h2>{tagline}</h2><p>{description}</p><div class="specs"><span>{dimensions[room]}</span><span>24시간 운영</span><span>{feature}</span></div></div>{img(room,cover,'detail-cover',True)}</section>
<section class="section"><div class="section-heading"><div><span class="eyebrow coral">TAKE A CLOSER LOOK</span><h2>{room}홀 둘러보기</h2></div><span class="subtle">리듬앤조이 실제 시설 사진</span></div><div class="gallery">{''.join(img(room,n) for n in gallery)}</div></section>
<section class="room-rate-section"><div><span class="eyebrow coral">HOURLY RATE</span><h2>{room}홀 이용요금</h2><p>시간당 요금 · 통대관은 6시간 기준</p></div><dl class="rate-list">{''.join(f'<div><dt>{label}</dt><dd>{price}<small>원</small></dd></div>' for label,price in zip(rate_labels,rates))}</dl></section>
''','spaces',f'<a href="/spaces/">공간 안내</a><span>/</span>{room}홀')

rows=''.join(f'<tr><th scope="row"><a href="/spaces/{r.lower()}/" draggable="false">{r}홀 <span>{prices[r]["area"]}</span></a></th>'+''.join(f'<td>{p}</td>' for p in prices[r]['rates'])+'</tr>' for r in 'ABCDE')
write('pricing','이용요금 | 사당연습실 리듬앤조이','A–E홀 평일 낮, 저녁·주말, 새벽 요금과 새벽 통대관 요금을 확인하세요.',f'''
<section class="page-heading compact"><span class="eyebrow coral">SIMPLE & CLEAR</span><h1>이용요금</h1><p>룸별 요금을 한눈에 비교하세요.<br>시간당 요금이며, 새벽 통대관은 00:00~06:00 전체 요금입니다.</p></section>
<section class="section price-section"><div class="section-heading"><h2>룸별 이용요금</h2><span class="subtle">단위: 원</span></div>
<table class="price-table" aria-label="룸별 이용요금표">
<colgroup><col class="room-column"><col span="4"></colgroup>
<thead><tr><th scope="col">공간</th><th scope="col">평일 낮<small>06~16시</small></th><th scope="col">평일 저녁<br>주말·공휴일</th><th scope="col">새벽<small>00~06시</small></th><th scope="col">새벽<br>통대관<small>00~06시</small></th></tr></thead>
<tbody>{rows}</tbody></table>
<div class="price-periods"><p><strong>평일 낮</strong> 06:00~16:00</p><p><strong>평일 저녁</strong> 16:00~24:00 · <strong>주말·공휴일</strong> 06:00~24:00</p><p><strong>새벽</strong> 매일 00:00~06:00 · <strong>통대관</strong> 같은 시간대 6시간 전체</p></div>
<div class="price-footnotes"><p>네이버와 스페이스클라우드는 동일한 기준 가격으로 운영됩니다.</p><p>기준 인원 초과에 따른 인원 추가 비용은 없습니다.</p></div></section>
''','pricing','이용요금')

write('location','오시는 길 | 사당역 7번 출구 리듬앤조이','서울 동작구 남부순환로 2077 지하 2층. 사당역 7번 출구에서 리듬앤조이까지 찾아오는 길과 주차 안내.',f'''
<section class="page-heading"><span class="eyebrow coral">CLOSER THAN YOU THINK</span><h1>사당역에서<br>걸어서 1분.</h1><p>7번 출구 인근, 드림디포 문구점 건물 지하 2층으로 오세요.</p></section>
<section class="location-layout"><div class="address-panel"><span class="eyebrow coral">FIND US</span><h2>리듬앤조이 연습실</h2><address>서울 동작구 남부순환로 2077<br><strong>지하 2층</strong></address><p>사당역 7번 출구 도보 약 1분<br>드림디포 문구점 건물</p><div class="actions">{button('네이버 지도 열기','https://naver.me/59vo9MDk',True)}<button class="button secondary" type="button" data-copy-address>주소 복사 <span aria-hidden="true">↗</span></button></div><p class="copy-result" role="status"></p></div><div class="wayfinding"><span class="eyebrow">HOW TO GET HERE</span><ol><li><span>01</span><div><h3>사당역 7번 출구</h3><p>지하철에서 나와 도보로 이동해 주세요.</p></div></li><li><span>02</span><div><h3>드림디포 문구점 건물</h3><p>주소: 남부순환로 2077</p></div></li><li><span>03</span><div><h3>지하 2층, 리듬앤조이</h3><p>예약한 홀과 이용시간을 확인하고 입장하세요.</p></div></li></ol></div></section>
<section class="parking"><span class="eyebrow coral">PARKING</span><h2>주차는 공영주차장을 권장합니다.</h2><p>건물 주차는 기본적으로 불가합니다. 문구점 폐점 후 문구점 앞 공간만 제한적으로 이용할 수 있습니다.<br>카리프트 앞, 지정주차라인, 지하주차 리프트는 사용할 수 없습니다.</p></section>''','location','오시는 길')

write('guide','이용 안내 | 리듬앤조이 연습실','리듬앤조이 이용 수칙과 변경·환불 안내.',f'''
<section class="page-heading"><span class="eyebrow coral">BEFORE YOUR PRACTICE</span><h1>처음 방문해도,<br>편안하게.</h1><p>방문 전 이용 수칙과 변경·환불 기준을 확인해주세요.</p></section>

<section class="guide-columns"><article><span class="eyebrow coral">HOUSE RULES</span><h2>함께 지키는 이용 수칙</h2><ul><li>외부 신발은 사용할 수 없습니다.</li><li>연습을 위한 이용은 10분이라도 대관이 필요합니다.</li><li>징·장구·타악기는 사용할 수 없으며, 탭댄스는 탭판 위에서만 가능합니다.</li><li>국물 음식과 냄새가 심한 음식은 반입하지 마세요.</li><li>물품 파손 시 관리자에게 알려주세요.</li></ul></article><article><span class="eyebrow coral">CANCELLATION</span><h2>변경·환불 안내</h2><p>예약 변경은 취소 후 재예약으로 진행됩니다.</p><dl class="refund"><div><dt>예약 후 2시간 안 변심 취소</dt><dd>무료</dd></div><div><dt>방문 3일 전</dt><dd>70%</dd></div><div><dt>방문 2일 전</dt><dd>50%</dd></div><div><dt>방문 1일 전 · 당일</dt><dd>0%</dd></div></dl><p class="subtle">실제 예약에 표시된 환불 규정을 확인해주세요.</p></article></section>''','guide','이용 안내')

write('schedule','예약하기 | 리듬앤조이','리듬앤조이 A–E홀의 예약현황을 확인하고 네이버 또는 스페이스클라우드에서 예약하세요.',f'''
<section class="page-heading compact"><span class="eyebrow coral">PLAN YOUR PRACTICE</span><h1>예약하기</h1><p>일정 확인부터 예약, 새벽 대관 문의까지 한곳에서.</p></section>
<section class="booking-panel" aria-label="예약 바로가기"><div><span class="eyebrow coral">BOOK YOUR SPACE</span><h2>연습할 시간을 골랐나요?</h2><p>아래 일정표를 확인한 뒤 예약을 진행해주세요.</p></div>{booking_links()}</section>
<div class="sample-notice"><span class="tiny-dot"></span><strong>실제 예약현황</strong><span>운영 중인 예약 일정이 그대로 반영됩니다.</span></div>
<section class="calendar-shell"><iframe title="리듬앤조이 예약현황" src="{PREVIEW_PATH}calendar-v11/index.html" class="calendar-frame"></iframe></section>
<section class="section"><div class="section-heading"><h2>예약은 이렇게 진행해요.</h2></div><div class="steps">
<article><span>01</span><h3>공간과 일정 확인</h3><p>위 일정표에서 원하는 홀과 시간을 확인하세요.</p></article>
<article><span>02</span><h3>예약 채널 선택</h3><p>네이버 또는 스페이스클라우드에서 날짜와 시간을 선택해 예약하세요.</p></article>
<article><span>03</span><h3>예약문자 도착 확인</h3><p>예약 안내 문자가 도착했는지 확인해주세요. 문자에 안내된 홀과 날짜·시간, 이용정보를 확인하면 끝입니다.</p></article></div></section>
<section class="night-banner"><div><span class="eyebrow">AFTER HOURS</span><h2>새벽 통대관 예약</h2>
<p>매일 00:00~06:00, 6시간 전체 대관입니다.<br>문자 문의 또는 스페이스클라우드에서 예약할 수 있습니다.</p>
<p>문자 예약: 가능 여부 확인 → 승인 → 입금 → 예약문자 확인</p></div>
<div class="actions">{button('010-4801-7180 문자 문의','sms:01048017180')}{button('스페이스클라우드 예약',SPACECLOUD_BOOKING)}</div></section>''','schedule','예약하기')

write('structure','사이트 구조 미리보기 | 리듬앤조이','독립 주소로 연결된 연습실 소개, 공간, 요금, 위치, 예약현황 구조를 확인하세요.',f'''
<section class="page-heading"><span class="eyebrow coral">SITE PREVIEW / 01</span><h1>내용마다 주소 하나.<br>예약은 익숙한 그대로.</h1><p>각 항목을 누르면 실제 샘플 페이지로 이동합니다.<br>검색으로 처음 들어온 사람도 공간을 이해하고, 예약현황 확인과 예약으로 이어지도록 구성했습니다.</p></section>
<section class="site-tree"><a class="tree-root" href="/"><span>HOME /</span><h2>사당연습실 리듬앤조이</h2><p>위치·공간 소개 + 주요 안내의 출발점</p><b>소개 페이지 열기 ↗</b></a><div class="tree-branches"><article><a href="/spaces/"><span>/spaces/</span><h3>공간 안내 ↗</h3></a><div class="tree-rooms">{''.join(f'<a href="/spaces/{r.lower()}/">{r}홀 <small>{prices[r]["area"]}</small> ↗</a>' for r in 'ABCDE')}</div></article><a href="/pricing/"><span>/pricing/</span><h3>이용요금 ↗</h3><p>룸별·시간대별 요금<br>새벽 통대관 안내</p></a><a href="/location/"><span>/location/</span><h3>오시는 길 ↗</h3><p>주소·지하철·주차<br>네이버 지도 연결</p></a><a href="/guide/"><span>/guide/</span><h3>이용 안내 ↗</h3><p>이용 수칙<br>변경·환불 안내</p></a><a href="/schedule/"><span>/schedule/</span><h3>예약하기 ↗</h3><p>일정표·예약 채널<br>예약 방법·새벽 대관 문의</p></a></div></section>
<section class="structure-notes"><h2>이 샘플에서 달라진 점</h2><div><article><b>검색 후 바로 읽는 소개</b><p>제목뿐 아니라 첫 HTML 본문에 위치, 시설, 이용 목적을 담았습니다.</p></article><article><b>보내고 다시 찾을 수 있는 주소</b><p>A홀 사진이나 이용요금 페이지를 각각 직접 열고 공유할 수 있습니다.</p></article><article><b>일정 확인에서 예약까지</b><p>일정표는 예약현황을 보여주고, 네이버·스페이스클라우드 버튼이 예약으로 연결합니다.</p></article></div><p class="subtle">로컬 검토용 샘플입니다. 검색 노출은 비활성화되어 있으며 운영 사이트에는 반영되지 않았습니다.</p></section>''','structure','전체 페이지 구조')
# calendar-v11 is an independent snapshot; rebuilding pages never overwrites it.
print('Built 12 website pages; independent calendar-v11 is preserved.')
