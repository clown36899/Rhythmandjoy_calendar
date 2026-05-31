/**
 * 📱 모바일 디버그 로거 (debug-logger.js)
 * - console.log / warn / error / 네트워크 에러 / 미처리 에러를 모두 캡처
 * - 화면 우측 하단에 떠 있는 🐛 버튼을 누르면 로그 패널이 열림
 * - 페이지가 멈춘(freeze) 상태에서도 이미 캡처된 로그를 확인 가능
 * - 에러(빨간색)가 발생하면 버튼에 빨간 점(badge) 표시
 */
(function () {
  'use strict';

  var MAX_LOGS = 300;
  var _logs = [];
  var _errorCount = 0;
  var _panelVisible = false;

  // ── 1. 원본 console 함수 백업 ──
  var _origLog = console.log;
  var _origWarn = console.warn;
  var _origError = console.error;

  function getTimeStr() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    var ms = String(now.getMilliseconds()).padStart(3, '0');
    return h + ':' + m + ':' + s + '.' + ms;
  }

  function argsToString(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var arg = args[i];
      if (arg === null) {
        parts.push('null');
      } else if (arg === undefined) {
        parts.push('undefined');
      } else if (typeof arg === 'object') {
        try {
          parts.push(JSON.stringify(arg, null, 1));
        } catch (e) {
          parts.push(String(arg));
        }
      } else {
        parts.push(String(arg));
      }
    }
    return parts.join(' ');
  }

  function pushLog(level, args) {
    var entry = {
      time: getTimeStr(),
      level: level,
      msg: argsToString(args)
    };
    _logs.push(entry);
    if (_logs.length > MAX_LOGS) {
      _logs.shift();
    }
    if (level === 'error') {
      _errorCount++;
      updateBadge();
    }
  }

  // ── 2. console 함수 오버라이드 ──
  console.log = function () {
    pushLog('log', arguments);
    _origLog.apply(console, arguments);
  };
  console.warn = function () {
    pushLog('warn', arguments);
    _origWarn.apply(console, arguments);
  };
  console.error = function () {
    pushLog('error', arguments);
    _origError.apply(console, arguments);
  };

  // ── 3. 미처리 에러 & Promise Rejection 캡처 ──
  window.addEventListener('error', function (e) {
    pushLog('error', ['[Uncaught] ' + (e.message || '') + ' at ' + (e.filename || '') + ':' + (e.lineno || '')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    pushLog('error', ['[UnhandledRejection] ' + (e.reason || '')]);
  });

  // ── 4. 성능 타이밍 자동 기록 (Long Task 감지) ──
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      var longTaskObserver = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.duration > 100) {
            pushLog('warn', ['⚠️ [LongTask] ' + Math.round(entry.duration) + 'ms 동안 메인 스레드 차단됨']);
          }
        }
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch (e) {
      // PerformanceObserver longtask 미지원 환경 무시
    }
  }

  // ── 5. UI 생성 ──
  function createUI() {
    // 스타일
    var style = document.createElement('style');
    style.textContent = [
      '#_dbgBtn{position:fixed;top:12px;left:12px;z-index:999999;width:40px;height:40px;border-radius:50%;',
      'background:rgba(0,0,0,0.6);color:#fff;border:1px solid #555;font-size:18px;',
      'display:flex;align-items:center;justify-content:center;cursor:pointer;',
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent;}',
      '#_dbgBadge{position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;',
      'background:#ff4444;display:none;border:1px solid #000;}',
      '#_dbgPanel{position:fixed;top:0;left:0;width:100%;height:100%;z-index:999998;',
      'background:rgba(0,0,0,0.92);color:#fff;font-family:monospace;font-size:11px;',
      'display:none;flex-direction:column;}',
      '#_dbgHeader{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;',
      'background:#1a1a1a;border-bottom:1px solid #333;flex-shrink:0;}',
      '#_dbgHeader button{background:#333;color:#fff;border:1px solid #555;border-radius:4px;',
      'padding:4px 10px;font-size:12px;cursor:pointer;margin-left:6px;}',
      '#_dbgBody{flex:1;overflow-y:auto;padding:6px 10px;-webkit-overflow-scrolling:touch;}',
      '.dbg-entry{padding:3px 0;border-bottom:1px solid #222;word-break:break-all;white-space:pre-wrap;}',
      '.dbg-time{color:#888;margin-right:6px;}',
      '.dbg-log{color:#ccc;}',
      '.dbg-warn{color:#ffcc00;}',
      '.dbg-error{color:#ff4444;font-weight:bold;}',
      '#_dbgMemory{color:#88ff88;font-size:11px;}',
      '#_dbgToast{position:fixed;bottom:50%;left:50%;transform:translateX(-50%);z-index:1000000;',
      'background:rgba(50,180,50,0.9);color:#fff;padding:8px 20px;border-radius:20px;',
      'font-size:13px;pointer-events:none;opacity:0;transition:opacity 0.3s;}'
    ].join('\n');
    document.head.appendChild(style);

    // 버튼
    var btn = document.createElement('div');
    btn.id = '_dbgBtn';
    btn.innerHTML = '🖥️<div id="_dbgBadge"></div>';
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);

    // 패널
    var panel = document.createElement('div');
    panel.id = '_dbgPanel';

    var header = document.createElement('div');
    header.id = '_dbgHeader';

    var title = document.createElement('span');
    title.textContent = '📋 디버그 로그';

    var memSpan = document.createElement('span');
    memSpan.id = '_dbgMemory';

    var btnGroup = document.createElement('div');

    var copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 복사';
    copyBtn.addEventListener('click', function () {
      var text = logsToText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          showToast('✅ 로그가 클립보드에 복사되었습니다!');
        }).catch(function () {
          fallbackCopy(text);
        });
      } else {
        fallbackCopy(text);
      }
    });

    var clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 초기화';
    clearBtn.addEventListener('click', function () {
      _logs = [];
      _errorCount = 0;
      updateBadge();
      renderLogs();
    });

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ 닫기';
    closeBtn.addEventListener('click', togglePanel);

    btnGroup.appendChild(memSpan);
    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(clearBtn);
    btnGroup.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(btnGroup);

    var body = document.createElement('div');
    body.id = '_dbgBody';

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
  }

  function togglePanel() {
    _panelVisible = !_panelVisible;
    var panel = document.getElementById('_dbgPanel');
    if (panel) {
      panel.style.display = _panelVisible ? 'flex' : 'none';
      if (_panelVisible) {
        _errorCount = 0;
        updateBadge();
        renderLogs();
        updateMemory();
      }
    }
  }

  function updateBadge() {
    var badge = document.getElementById('_dbgBadge');
    if (badge) {
      badge.style.display = _errorCount > 0 ? 'block' : 'none';
    }
  }

  function updateMemory() {
    var memSpan = document.getElementById('_dbgMemory');
    if (memSpan && performance && performance.memory) {
      var used = Math.round(performance.memory.usedJSHeapSize / 1048576);
      var total = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
      memSpan.textContent = '메모리: ' + used + 'MB / ' + total + 'MB';
    }
  }

  function logsToText() {
    var lines = [];
    for (var i = 0; i < _logs.length; i++) {
      var entry = _logs[i];
      lines.push('[' + entry.time + '] [' + entry.level.toUpperCase() + '] ' + entry.msg);
    }
    return lines.join('\n');
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      showToast('✅ 로그가 클립보드에 복사되었습니다!');
    } catch (e) {
      showToast('❌ 복사 실패 — 직접 선택해서 복사해 주세요');
    }
    document.body.removeChild(ta);
  }

  function showToast(msg) {
    var toast = document.getElementById('_dbgToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '_dbgToast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.style.opacity = '0';
    }, 1500);
  }

  function renderLogs() {
    var body = document.getElementById('_dbgBody');
    if (!body) return;

    var html = [];
    for (var i = _logs.length - 1; i >= 0; i--) {
      var entry = _logs[i];
      var cls = 'dbg-' + entry.level;
      html.push(
        '<div class="dbg-entry"><span class="dbg-time">' +
        entry.time +
        '</span><span class="' + cls + '">[' +
        entry.level.toUpperCase() +
        '] ' +
        entry.msg.replace(/</g, '&lt;').replace(/>/g, '&gt;') +
        '</span></div>'
      );
    }
    body.innerHTML = html.join('');
  }

  // ── 6. DOM 준비 후 UI 삽입 ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI);
  } else {
    createUI();
  }

  // 시작 로그
  pushLog('log', ['🖥️ [디버그 로거] 초기화 완료 — 좌측 상단 🖥️ 버튼을 눌러 로그를 확인하세요']);

})();
