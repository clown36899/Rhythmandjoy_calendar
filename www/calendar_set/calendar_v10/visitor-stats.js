/**
 * First-party unique-browser collection for the Rhythmjoy calendar.
 *
 * Counting happens only after the page has remained visible long enough for a
 * server-signed challenge. The server owns all bot decisions and deduplication;
 * this client exposes only aggregate counts to the debug panel.
 */
(function () {
  'use strict';

  // Resolve from this shared script, including when the website lives at / or /spaces/.
  var API_URL = new URL('visitor-stats.php', document.currentScript.src).href;
  var EVENT_NAME = 'rhythmjoy:visitor-stats';
  var DEFAULT_VISIBLE_MS = 2500;
  var _snapshot = {
    status: 'loading',
    today: null,
    total: null,
    pageViews: null,
    collectionStartedOn: null,
    asOf: null
  };
  var _challengeStarted = false;
  var _confirmStarted = false;
  var _visibleSince = null;
  var _visibleAccumulated = 0;
  var _visibilityTimer = null;
  var _lastStatsRefreshAt = 0;

  function nowMs() {
    if (window.performance && typeof window.performance.now === 'function') {
      return window.performance.now();
    }
    return Date.now();
  }

  function copySnapshot() {
    return {
      status: _snapshot.status,
      today: _snapshot.today,
      total: _snapshot.total,
      pageViews: _snapshot.pageViews ? Object.assign({}, _snapshot.pageViews) : null,
      collectionStartedOn: _snapshot.collectionStartedOn,
      asOf: _snapshot.asOf
    };
  }

  function dispatchSnapshot() {
    var event;
    var detail = copySnapshot();
    try {
      event = new CustomEvent(EVENT_NAME, { detail: detail });
    } catch (error) {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent(EVENT_NAME, false, false, detail);
    }
    window.dispatchEvent(event);
  }

  function publishStats(stats) {
    if (!stats || typeof stats.today !== 'number' || typeof stats.total !== 'number') {
      publishUnavailable();
      return;
    }
    _snapshot = {
      status: 'ready',
      today: Math.max(0, Math.floor(stats.today)),
      total: Math.max(0, Math.floor(stats.total)),
      pageViews: validPageViews(stats.pageViews) ? stats.pageViews : null,
      collectionStartedOn: stats.collectionStartedOn || null,
      asOf: stats.asOf || null
    };
    dispatchSnapshot();
  }

  function publishUnavailable() {
    if (_snapshot.status === 'ready') {
      return;
    }
    _snapshot.status = 'unavailable';
    dispatchSnapshot();
  }

  function requestJson(method, url, body, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Rhythmjoy-Visit', '1');
    if (method === 'POST') {
      xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    }
    xhr.onreadystatechange = function () {
      var payload;
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 300) {
        callback(new Error('visitor statistics request failed'));
        return;
      }
      try {
        payload = JSON.parse(xhr.responseText);
      } catch (error) {
        callback(error);
        return;
      }
      if (!payload || payload.ok !== true) {
        callback(new Error('visitor statistics response was invalid'));
        return;
      }
      callback(null, payload);
    };
    xhr.onerror = function () {
      callback(new Error('visitor statistics network error'));
    };
    xhr.timeout = 8000;
    xhr.ontimeout = function () {
      callback(new Error('visitor statistics request timed out'));
    };
    xhr.send(body === null ? null : JSON.stringify(body));
  }

  function referrerHost() {
    var anchor;
    if (!document.referrer) return '';
    try {
      anchor = document.createElement('a');
      anchor.href = document.referrer;
      return (anchor.hostname || '').toLowerCase().slice(0, 190);
    } catch (error) {
      return '';
    }
  }

  function resetVisibleClock() {
    _visibleAccumulated = 0;
    _visibleSince = document.visibilityState === 'hidden' ? null : nowMs();
  }

  function updateVisibleClock() {
    var current = nowMs();
    if (document.visibilityState === 'hidden') {
      if (_visibleSince !== null) {
        _visibleAccumulated += Math.max(0, current - _visibleSince);
        _visibleSince = null;
      }
    } else if (_visibleSince === null) {
      _visibleSince = current;
    }
  }

  function visibleDurationMs() {
    var total = _visibleAccumulated;
    if (_visibleSince !== null && document.visibilityState !== 'hidden') {
      total += Math.max(0, nowMs() - _visibleSince);
    }
    return Math.floor(total);
  }

  function clientSignals(challenge, pagePath) {
    var screenWidth = window.screen && window.screen.width ? window.screen.width : window.innerWidth;
    var screenHeight = window.screen && window.screen.height ? window.screen.height : window.innerHeight;
    return {
      action: 'confirm',
      challenge: challenge,
      page_path: pagePath,
      visible_ms: visibleDurationMs(),
      screen_width: Math.round(screenWidth || 0),
      screen_height: Math.round(screenHeight || 0),
      webdriver: !!navigator.webdriver,
      referrer_host: referrerHost()
    };
  }

  function confirmVisit(challenge, minimumVisibleMs, pagePath) {
    var remaining;
    if (_confirmStarted) return;
    updateVisibleClock();
    remaining = minimumVisibleMs - visibleDurationMs();
    if (remaining > 0 || document.visibilityState === 'hidden') {
      clearTimeout(_visibilityTimer);
      _visibilityTimer = setTimeout(function () {
        confirmVisit(challenge, minimumVisibleMs, pagePath);
      }, Math.max(150, Math.min(remaining > 0 ? remaining + 60 : 250, 1000)));
      return;
    }

    _confirmStarted = true;
    requestJson('POST', API_URL + '?action=confirm', clientSignals(challenge, pagePath), function (error, response) {
      if (error) {
        publishUnavailable();
        return;
      }
      publishStats(response.stats);
    });
  }

  function beginChallenge() {
    var pagePath = window.location.pathname;
    if (_challengeStarted || window.top !== window.self) return;
    _challengeStarted = true;
    requestJson(
      'GET',
      API_URL + '?action=challenge&page_path=' + encodeURIComponent(pagePath),
      null,
      function (error, response) {
        var minimumVisibleMs;
        if (error) {
          publishUnavailable();
          return;
        }
        publishStats(response.stats);
        if (!response.eligible || !response.challenge || navigator.webdriver) {
          return;
        }
        minimumVisibleMs = parseInt(response.minimumVisibleMs, 10);
        if (!isFinite(minimumVisibleMs) || minimumVisibleMs < DEFAULT_VISIBLE_MS) {
          minimumVisibleMs = DEFAULT_VISIBLE_MS;
        }
        resetVisibleClock();
        confirmVisit(response.challenge, minimumVisibleMs, pagePath);
      }
    );
  }

  function refreshStats(force) {
    var current = Date.now();
    if (!force && current - _lastStatsRefreshAt < 5000) {
      dispatchSnapshot();
      return;
    }
    _lastStatsRefreshAt = current;
    requestJson('GET', API_URL + '?action=stats', null, function (error, response) {
      if (error) {
        publishUnavailable();
        return;
      }
      publishStats(response.stats);
    });
  }

  window.RhythmjoyVisitorStats = {
    getSnapshot: copySnapshot,
    refreshStats: refreshStats
  };

  function validPageViews(views) {
    function count(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n; }
    return views && count(views.total) && count(views.today) && count(views.baseline) && count(views.sinceCutover) &&
      views.total === views.baseline + views.sinceCutover &&
      /^\d{4}-\d{2}-\d{2}$/.test(views.baselineThrough) && /^\d{4}-\d{2}-\d{2}$/.test(views.cutover);
  }

  function initStatsUI() {
    var dialog = document.getElementById('visitor-dialog');
    var opener = document.getElementById('visitor-open');
    if (!dialog || !opener) return; // Legacy calendar keeps its existing display.
    var selectedDays = 30;
    var requestId = 0;
    var previousFocus = null;
    var status = document.getElementById('visitor-status');
    var report = document.getElementById('visitor-report');
    var number = function (value) { return value.toLocaleString('ko-KR'); };
    var countText = function (value) { return value === null ? '집계 전' : number(value); };

    function updateCounters() {
      ['total', 'today'].forEach(function (key) {
        Array.prototype.forEach.call(document.querySelectorAll('[data-visitor-' + key + ']'), function (node) {
          node.textContent = _snapshot.status === 'ready' ? number(_snapshot[key]) : '—';
        });
      });
      var views = _snapshot.pageViews;
      Array.prototype.forEach.call(document.querySelectorAll('[data-visitor-views]'), function (node) {
        node.textContent = views ? number(views.total) : '—';
      });
      var baselineLabel = document.getElementById('visitor-baseline');
      if (baselineLabel) baselineLabel.textContent = views ?
        views.baselineThrough + '까지 과거 조회 ' + number(views.baseline) + '회 + ' +
        views.cutover + '부터 조회 ' + number(views.sinceCutover) + '회 · 오늘 조회 ' + number(views.today) + '회' : '';
      opener.title = _snapshot.status === 'unavailable' ? '연결을 확인하려면 방문 통계를 열어주세요.' : '날짜별 방문 통계 보기';
    }

    function renderHistory(history) {
      publishStats(history.stats);
      var max = Math.max.apply(null, history.daily.map(function (row) { return row.visitors || 0; }).concat([1]));
      document.getElementById('visitor-chart').innerHTML = history.daily.map(function (row) {
        var height = row.visitors ? Math.max(2, row.visitors / max * 100) : 0;
        return '<div class="visitor-chart-column' + (row.date === history.endDate ? ' is-today' : '') + '" title="' +
          row.date + ' · ' + countText(row.visitors) + '"><span style="height:' + height + '%"></span></div>';
      }).join('');
      document.getElementById('visitor-chart-start').textContent = history.startDate;
      document.getElementById('visitor-chart-end').textContent = history.endDate + ' 오늘';
      document.getElementById('visitor-range').textContent = '최근 ' + history.days + '일 · 일별 방문자';
      document.getElementById('visitor-period-summary').textContent = '기간 내 방문자 ' + number(history.visitors) +
        ' · 조회 수 ' + number(history.pageViews) + ' (오늘 포함)';
      document.getElementById('visitor-daily-rows').innerHTML = history.daily.slice().reverse().map(function (row) {
        return '<tr' + (row.date === history.endDate ? ' class="is-today"' : '') + '><th scope="row">' +
          row.date + (row.date === history.endDate ? ' · 오늘' : '') + '</th><td>' +
          countText(row.visitors) + '</td><td>' + countText(row.pageViews) + '</td></tr>';
      }).join('');
      document.getElementById('visitor-as-of').textContent = '업데이트 ' + history.stats.asOf.slice(0, 19).replace('T', ' ') + ' (한국시간)';
      document.getElementById('visitor-collection').textContent = history.stats.collectionStartedOn ?
        '일별 방문자 기록은 ' + history.stats.collectionStartedOn + '부터입니다. 과거 조회수는 위 누적 합계에 포함됩니다.' : '아직 집계된 방문 기록이 없습니다.';
      status.textContent = history.visitors ? '' : '선택한 기간에 집계된 방문 기록이 없습니다.';
      report.hidden = false;
    }

    function validHistory(history) {
      function validCount(value) { return typeof value === 'number' && isFinite(value) && value >= 0 && Math.floor(value) === value; }
      function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }
      return history && history.days === selectedDays && validDate(history.startDate) && validDate(history.endDate) &&
        validCount(history.visitors) && validCount(history.pageViews) && history.stats &&
        validCount(history.stats.total) && validCount(history.stats.today) && validPageViews(history.stats.pageViews) && typeof history.stats.asOf === 'string' &&
        (history.stats.collectionStartedOn === null || validDate(history.stats.collectionStartedOn)) &&
        Array.isArray(history.daily) && history.daily.length === selectedDays && history.daily.every(function (row) {
          return validDate(row.date) && (row.visitors === null || validCount(row.visitors)) &&
            (row.pageViews === null || validCount(row.pageViews));
        });
    }

    function loadHistory() {
      var thisRequest = ++requestId;
      status.textContent = '방문 통계를 불러오는 중입니다…';
      report.hidden = true;
      report.setAttribute('aria-busy', 'true');
      document.getElementById('visitor-as-of').textContent = '';
      requestJson('GET', API_URL + '?action=history&days=' + selectedDays, null, function (error, response) {
        if (thisRequest !== requestId || !dialog.open) return;
        report.setAttribute('aria-busy', 'false');
        if (error || !validHistory(response.history)) {
          status.textContent = '통계를 불러오지 못했습니다. 잠시 후 새로고침을 눌러주세요.';
          return;
        }
        renderHistory(response.history);
      });
    }

    opener.addEventListener('click', function () {
      previousFocus = document.activeElement;
      dialog.showModal();
      document.body.classList.add('visitor-dialog-open');
      loadHistory();
    });
    dialog.querySelector('.visitor-close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('close', function () {
      requestId += 1;
      document.body.classList.remove('visitor-dialog-open');
      if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    });
    Array.prototype.forEach.call(dialog.querySelectorAll('[data-visitor-days]'), function (button) {
      button.addEventListener('click', function () {
        selectedDays = Number(button.getAttribute('data-visitor-days'));
        Array.prototype.forEach.call(dialog.querySelectorAll('[data-visitor-days]'), function (item) {
          item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
        });
        loadHistory();
      });
    });
    document.getElementById('visitor-refresh').addEventListener('click', loadHistory);
    window.addEventListener(EVENT_NAME, updateCounters);
    updateCounters();
  }

  document.addEventListener('visibilitychange', function () {
    updateVisibleClock();
  });

  function start() { initStatsUI(); beginChallenge(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
