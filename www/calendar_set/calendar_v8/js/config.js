const CONFIG = {
  rooms: {
    a: {
      id: 'a',
      name: 'A홀',
      calendarId: '752f7ab834fd5978e9fc356c0b436e01bd530868ab5e46534c82820086c5a3d3@group.calendar.google.com',
      color: '#F6BF26'
    },
    b: {
      id: 'b',
      name: 'B홀',
      calendarId: '22dd1532ca7404714f0c24348825f131f3c559acf6361031fe71e80977e4a817@group.calendar.google.com',
      color: 'rgb(87, 150, 200)'
    },
    c: {
      id: 'c',
      name: 'C홀',
      calendarId: 'b0cfe52771ffe5f8b8bb55b8f7855b6ea640fcb09060fd6708e9b8830428e0c8@group.calendar.google.com',
      color: 'rgb(129, 180, 186)'
    },
    d: {
      id: 'd',
      name: 'D홀',
      calendarId: '60da4147f8d838daa72ecea4f59c69106faedd48e8d4aea61a9d299d96b3f90e@group.calendar.google.com',
      color: 'rgb(125, 157, 106)'
    },
    e: {
      id: 'e',
      name: 'E홀',
      calendarId: 'aaf61e2a8c25b5dc6cdebfee3a4b2ba3def3dd1b964a9e5dc71dc91afc2e14d6@group.calendar.google.com',
      color: '#4c4c4c'
    }
  },
  
  timeSlots: {
    dawn: { start: 0, end: 6, class: 'dawn' },
    day: { start: 6, end: 16, class: 'day' },
    evening: { start: 16, end: 24, class: 'evening' }
  },
  
  hoursDisplay: [
    '0-1시', '1-2시', '2-3시', '3-4시', '4-5시', '5-6시',
    '6-7시', '7-8시', '8-9시', '9-10시', '10-11시', '11-12시',
    '12-13시', '13-14시', '14-15시', '15-16시', '16-17시', '17-18시',
    '18-19시', '19-20시', '20-21시', '21-22시', '22-23시', '23-24시'
  ],
  
  dayNames: ['일', '월', '화', '수', '목', '금', '토']
};

// 원본 console이 logger.js에서 이미 저장되었으므로 여기서는 단순히 오버라이드만
const originalConsole = window._originalConsole || {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info
};

console.log = function() {};
console.info = function() {};
console.warn = function() {};

console.error = function(...args) {
  if (window.logger) {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    window.logger.error(message);
  }
  originalConsole.error.apply(console, args);
};

function devLog() {}
