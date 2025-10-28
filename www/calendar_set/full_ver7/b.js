
    document.addEventListener('DOMContentLoaded', function () {
  var calendarEl = document.getElementById('calendar');//변수선언
   calendarB = new SwipeCalendar(calendarEl, {   
contentHeight: 'auto',
locale: 'ko',
nowIndicator: true,
selectOverlap: false,
selectable: false,
selectMirror: false,
slotDuration: '01:00',         
editable: false, 
longPressDelay:10,       
businessHours: false,
eventLimit: false, //현제시간표시
plugins: [  'interaction', 'dayGrid', 'list', 'googleCalendar', 'timeGrid'],
header: {
    left: 'dayGridMonth,timeGridWeek',
    center:'title',
    right: 'prev,today,next'
},  
views: {
     timeGridWeek: { // name of view
     columnHeaderFormat: {weekday: 'short', day: 'numeric', omitCommas: true }
     },            
 },
displayEventEnd:true,
/* events:[ // 일정 데이터 추가 , DB의 event를 가져오려면 JSON 형식으로 변환해 events에 넣어주면된다.
            {
                title:'일정',
                start:'2021-05-26 00:00:00',
                end:'2021-05-27 24:00:00' 
                // color 값을 추가해 색상도 변경 가능 자세한 내용은 하단의 사이트 참조
            }
        ],*/ 
eventTimeFormat:{
        hour: '2-digit',
        minute: '2-digit',
        meridiem: false,
        hour12 : false 
             },        
navLinks: true ,
slotEventOverlap: false,
allDaySlot: false,// true, fals
defaultView: 'timeGridWeek',
fixedWeekCount: false, 

    googleCalendarApiKey: "AIzaSyCLqM39X5vTjrNt1Vl5miRryXWkLYPqky8", 
    eventSources: [              
           {
        id : "dataList",
        googleCalendarId: "amp3i5i4vcv4hbrqu937lufuss@group.calendar.google.com"               
        , color: "#616161"
        , textColor: "#000000"
            }
        ],
        }
      );   
  calendar.render(); 
});           


