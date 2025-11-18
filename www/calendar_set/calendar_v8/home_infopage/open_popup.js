
  // HTML 캐시
  const htmlCache = new Map();

  // 팝업 열기
  function openPopup(url) {
    console.log('[open_popup.js] openPopup 호출됨, url:', url);
    const popupBox = document.getElementById('popupBox');
    const popupOverlay = document.getElementById('popupOverlay');
    console.log('[open_popup.js] popupBox:', popupBox, 'popupOverlay:', popupOverlay);
    
    // 캐시에 있으면 즉시 표시
    if (htmlCache.has(url)) {
      console.log('[open_popup.js] 캐시에서 로드');
      document.getElementById('popupContent').innerHTML = htmlCache.get(url);
      
      // 다음 프레임에 애니메이션 시작
      requestAnimationFrame(() => {
        popupOverlay.classList.add('active');
        popupBox.classList.add('active');
        console.log('[open_popup.js] active 클래스 추가됨');
      });
      return;
    }

    // 캐시에 없으면 fetch
    fetch(url)
      .then(response => response.text())
      .then(html => {
        htmlCache.set(url, html); // 캐시에 저장
        document.getElementById('popupContent').innerHTML = html;
        
        // 다음 프레임에 애니메이션 시작
        requestAnimationFrame(() => {
          popupOverlay.classList.add('active');
          popupBox.classList.add('active');
        });
      })
      .catch(err => {
        alert("팝업 로딩 실패: " + err);
      });
  }

  // 팝업 닫기
  function closePopup() {
    console.log("close");
    const popupBox = document.getElementById('popupBox');
    const popupOverlay = document.getElementById('popupOverlay');
    
    // 닫는 애니메이션
    popupBox.classList.remove('active');
    popupOverlay.classList.remove('active');
    
    // 애니메이션 끝난 후 내용 초기화
    setTimeout(() => {
      document.getElementById('popupContent').innerHTML = '';
    }, 400);
  }

  // 배경 클릭 시 팝업 닫기
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('popupOverlay').addEventListener('click', closePopup);
    
  });
  // function close_x() {
  //   console.log("close");
  // }

////////////////////////////////////////////////////////////////////////////////////////////////////////



// 이미지 캐시
const imageCache = new Map();

function openInnerPopup(url) {
    console.log("요청 URL:", url);
  
    // HTML 캐시 확인
    const loadHTML = htmlCache.has(url) 
      ? Promise.resolve(htmlCache.get(url))
      : fetch(url).then(response => response.text()).then(html => {
          htmlCache.set(url, html);
          return html;
        });

    loadHTML.then(html => {
        // 팝업 내용 삽입
        document.getElementById('innerPopupContent').innerHTML = html;
        const innerPopupOverlay = document.getElementById('innerPopupOverlay');
        const innerPopupBox = document.getElementById('innerPopupBox');
        
        // 다음 프레임에 애니메이션 시작
        requestAnimationFrame(() => {
          innerPopupOverlay.classList.add('active');
          innerPopupBox.classList.add('active');
        });
  
        // folder=roomA 형식에서 folder값 추출
        const folderMatch = url.match(/folder=([^&]+)/);
        const folder = folderMatch ? folderMatch[1] : '';
        if (!folder) return;
  
        // 이미지 갤러리 생성
const thumbnailContainer = document.getElementById("thumbnailContainer");
const mainImage = document.getElementById("mainImage");

if (!thumbnailContainer || !mainImage) {
  console.warn("갤러리 대상 요소가 없습니다.");
  return;
}

thumbnailContainer.innerHTML = "";
mainImage.src = "";
mainImage.style.visibility = "hidden";

const loader = document.createElement("div");
loader.className = "gallery-loader";
loader.innerText = "🔄 이미지 로딩 중...";
thumbnailContainer.before(loader);

const totalImages = 10;

// 첫 번째 이미지만 즉시 로드
const firstImagePath = `home_infopage/images/${folder}/image1.jpeg`;

// 캐시 확인
if (imageCache.has(firstImagePath)) {
  mainImage.src = firstImagePath;
  mainImage.style.visibility = "visible";
  loader.remove();
  
  const thumb = document.createElement("img");
  thumb.src = firstImagePath;
  thumb.classList.add("thumbnail", "active");
  thumb.addEventListener("click", () => {
    mainImage.src = firstImagePath;
    document.querySelectorAll(".thumbnail").forEach(t => t.classList.remove("active"));
    thumb.classList.add("active");
  });
  thumbnailContainer.appendChild(thumb);
} else {
  const firstImg = new Image();
  firstImg.src = firstImagePath;
  firstImg.onload = () => {
    imageCache.set(firstImagePath, true);
    mainImage.src = firstImagePath;
    mainImage.style.visibility = "visible";
    loader.remove();
    
    const thumb = document.createElement("img");
    thumb.src = firstImagePath;
    thumb.classList.add("thumbnail", "active");
    thumb.addEventListener("click", () => {
      mainImage.src = firstImagePath;
      document.querySelectorAll(".thumbnail").forEach(t => t.classList.remove("active"));
      thumb.classList.add("active");
    });
    thumbnailContainer.appendChild(thumb);
  };
  firstImg.onerror = () => {
    console.warn(`첫 이미지 로딩 실패: ${firstImagePath}`);
    loader.remove();
  };
}

// 나머지 이미지는 순차적으로 로드 (팝업이 이미 열린 후)
setTimeout(() => {
  for (let i = 2; i <= totalImages; i++) {
    const imgPath = `home_infopage/images/${folder}/image${i}.jpeg`;
    
    // 캐시에 있으면 즉시 표시
    if (imageCache.has(imgPath)) {
      const thumb = document.createElement("img");
      thumb.src = imgPath;
      thumb.classList.add("thumbnail");
      thumb.addEventListener("click", () => {
        mainImage.src = imgPath;
        document.querySelectorAll(".thumbnail").forEach(t => t.classList.remove("active"));
        thumb.classList.add("active");
      });
      thumbnailContainer.appendChild(thumb);
      continue;
    }

    const img = new Image();
    img.src = imgPath;

    img.onload = () => {
      imageCache.set(imgPath, true);
      const thumb = document.createElement("img");
      thumb.src = imgPath;
      thumb.classList.add("thumbnail");

      thumb.addEventListener("click", () => {
        mainImage.src = imgPath;
        document.querySelectorAll(".thumbnail").forEach(t => t.classList.remove("active"));
        thumb.classList.add("active");
      });

      thumbnailContainer.appendChild(thumb);
    };

    img.onerror = () => {
      console.warn(`이미지 로딩 실패: ${imgPath}`);
    };
  }
}, 100); // 100ms 후 나머지 이미지 로드 시작

      })
      .catch(err => {
        alert("내부 팝업 로딩 실패: " + err);
      });
  }


  // 두 번째 팝업 닫기
  function closeInnerPopup() {
    console.log("?내부 팝업 닫기 실행");
    const innerPopupBox = document.getElementById('innerPopupBox');
    const innerPopupOverlay = document.getElementById('innerPopupOverlay');
    
    // 닫는 애니메이션
    innerPopupBox.classList.remove('active');
    innerPopupOverlay.classList.remove('active');
    
    // 애니메이션 끝난 후 내용 초기화
    setTimeout(() => {
      document.getElementById('innerPopupContent').innerHTML = '';
    }, 400);
  }
  // 배경 클릭 시 내부 팝업 닫기
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('innerPopupOverlay').addEventListener('click', closeInnerPopup);

   
  });


////////////////////////////////////////////////////////////////////////////////////////////////////////




  function copyLink() {
    const linkEl = document.getElementById("reservationLink");
    const text = linkEl.innerText.trim();
  
    // 임시 input 생성
    const tempInput = document.createElement("input");
    document.body.appendChild(tempInput);
    tempInput.value = text;
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
  
    alert("링크가 복사되었습니다!");
  }

  function copyLink2(button) {
    // 복사하고 싶은 텍스트를 명확히 지정
    const copyText = "서울시 동작구 남부순환로 2077";
  
    const tempInput = document.createElement("input");
    document.body.appendChild(tempInput);
    tempInput.value = copyText;
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
  
    alert("주소가 복사되었습니다!");
  }



////////////////////////////////////////////////////////////////////////////////////////////////////////

// 전역으로 노출 (iframe에서 접근 가능하도록)
window.openPopup = openPopup;
window.closePopup = closePopup;
window.openInnerPopup = openInnerPopup;
window.closeInnerPopup = closeInnerPopup;

