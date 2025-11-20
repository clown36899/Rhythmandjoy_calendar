class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
    this.logKey = 'rhythmjoy_logs';
    this.loadLogs();
  }

  loadLogs() {
    try {
      const stored = localStorage.getItem(this.logKey);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (e) {
      console.error('로그 로드 실패:', e);
    }
  }

  saveLogs() {
    try {
      if (this.logs.length > this.maxLogs) {
        this.logs = this.logs.slice(-this.maxLogs);
      }
      localStorage.setItem(this.logKey, JSON.stringify(this.logs));
    } catch (e) {
      console.error('로그 저장 실패:', e);
    }
  }

  log(level, message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };
    
    this.logs.push(entry);
    this.saveLogs();

    if (level === 'ERROR') {
      console.error(`[${level}] ${message}`, data || '');
    }
  }

  error(message, data = null) {
    this.log('ERROR', message, data);
  }

  warn(message, data = null) {
    this.log('WARN', message, data);
  }

  info(message, data = null) {
    this.log('INFO', message, data);
  }

  getLogs(level = null, limit = 100) {
    let filtered = level 
      ? this.logs.filter(log => log.level === level)
      : this.logs;
    
    return filtered.slice(-limit);
  }

  clear() {
    this.logs = [];
    localStorage.removeItem(this.logKey);
  }

  download() {
    const content = this.logs.map(log => 
      `[${log.timestamp}] ${log.level}: ${log.message}${log.data ? '\n  ' + JSON.stringify(log.data) : ''}`
    ).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rhythmjoy-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// 즉시 실행하여 원본 console 저장
(function() {
  const logger = new Logger();
  window.logger = logger;

  const originalConsoleTable = console.table ? console.table.bind(console) : console.log.bind(console);
  const originalConsoleLog = console.log.bind(console);

  window.downloadLogs = function() {
    logger.download();
  };
  
  window.viewLogs = function(level) {
    const logs = logger.getLogs(level, 50);
    if (logs.length === 0) {
      originalConsoleLog('로그가 없습니다.');
    } else {
      if (console.table) {
        originalConsoleTable(logs);
      } else {
        logs.forEach(log => originalConsoleLog(log));
      }
    }
  };
  
  window.clearLogs = function() {
    logger.clear();
    originalConsoleLog('로그가 삭제되었습니다.');
  };
})();
