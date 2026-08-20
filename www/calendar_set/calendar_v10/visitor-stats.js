/**
 * First-party unique-browser collection for the Rhythmjoy calendar.
 *
 * Counting happens only after the page has remained visible long enough for a
 * server-signed challenge. The server owns all bot decisions and deduplication;
 * this client exposes only aggregate counts to the debug panel.
 */
(function () {
  'use strict';

  var API_URL = 'visitor-stats.php';
  var EVENT_NAME = 'rhythmjoy:visitor-stats';
  var DEFAULT_VISIBLE_MS = 2500;
  var _snapshot = {
    status: 'loading',
    today: null,
    total: null,
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

  function clientSignals(challenge) {
    var screenWidth = window.screen && window.screen.width ? window.screen.width : window.innerWidth;
    var screenHeight = window.screen && window.screen.height ? window.screen.height : window.innerHeight;
    return {
      action: 'confirm',
      challenge: challenge,
      page_path: window.location.pathname,
      visible_ms: visibleDurationMs(),
      screen_width: Math.round(screenWidth || 0),
      screen_height: Math.round(screenHeight || 0),
      webdriver: !!navigator.webdriver,
      referrer_host: referrerHost()
    };
  }

  function confirmVisit(challenge, minimumVisibleMs) {
    var remaining;
    if (_confirmStarted) return;
    updateVisibleClock();
    remaining = minimumVisibleMs - visibleDurationMs();
    if (remaining > 0 || document.visibilityState === 'hidden') {
      clearTimeout(_visibilityTimer);
      _visibilityTimer = setTimeout(function () {
        confirmVisit(challenge, minimumVisibleMs);
      }, Math.max(150, Math.min(remaining > 0 ? remaining + 60 : 250, 1000)));
      return;
    }

    _confirmStarted = true;
    requestJson('POST', API_URL + '?action=confirm', clientSignals(challenge), function (error, response) {
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
        confirmVisit(response.challenge, minimumVisibleMs);
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

  document.addEventListener('visibilitychange', function () {
    updateVisibleClock();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', beginChallenge);
  } else {
    beginChallenge();
  }
})();
