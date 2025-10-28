document.addEventListener('DOMContentLoaded', function() {
    const calendarEl = document.getElementById('calendarAll');
    const eventPopup = document.getElementById('eventPopup');
    const eventDetails = document.getElementById('eventDetails');
    const closePopupBtn = document.getElementById('closePopup');
    const popupImage = document.getElementById('popupImage'); // 팝업 내 이미지 표시 영역

    const eventsWithImages = [
        { title: '이미지 이벤트 1', start: '2025-05-15', extendedProps: { imageUrl: 'img/img.png', description: '이미지 이벤트 1 상세 내용' } },
        { title: '일반 이벤트 2', start: '2025-05-20', extendedProps: { description: '일반 이벤트 2 상세 내용' } },
        { title: '이미지 & 텍스트 이벤트 3', start: '2025-05-25', extendedProps: { imageUrl: 'img/img.png', description: '이미지 & 텍스트 이벤트 3 상세 내용' } }
    ];

    const calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ko',
        events: eventsWithImages,
        eventContent: function(arg) {
            let content = document.createElement('div');
            content.classList.add('fc-event-inner');

            if (arg.event.extendedProps.imageUrl) {
                let img = document.createElement('img');
                img.src = arg.event.extendedProps.imageUrl;
                img.style.width = '20px';
                img.style.height = '20px';
                img.style.verticalAlign = 'middle';
                img.style.marginRight = '5px';
                img.style.cursor = 'pointer';
                img.addEventListener('click', function(e) {
                    e.stopPropagation();
                    openEventPopup(arg.event);
                });
                content.appendChild(img);
            }

            let title = document.createElement('span');
            title.innerText = arg.event.title;
            content.appendChild(title);

            return { domNodes: [content] };
        },
        eventClick: function(info) {
            openEventPopup(info.event);
        }
    });

    calendar.render();

    function openEventPopup(event) {
        console.log("이벤트 정보:", event);
        console.log("이미지 URL:", event.extendedProps.imageUrl);
        eventDetails.innerHTML = `
            <h3>${event.title}</h3>
            <p>시작: ${event.start.toLocaleString()}</p>
            ${event.end ? `<p>종료: ${event.end.toLocaleString()}</p>` : ''}
            <p>${event.extendedProps.description || ''}</p>
        `;

        if (event.extendedProps.imageUrl) { console.log("??")
            popupImage.innerHTML = `<img src="${event.extendedProps.imageUrl}" style="max-width: 100%; height: auto;">`;
        } else {
            popupImage.innerHTML = ''; // 이미지 없는 경우 영역 비움
        
        }

        eventPopup.classList.remove('hidden');
    }

    closePopupBtn.addEventListener('click', function() {
        eventPopup.classList.add('hidden');
    });
});