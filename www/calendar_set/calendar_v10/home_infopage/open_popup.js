
// HTML 캐시
const htmlCache = new Map();
const V10_HOME_PATH = "/calendar_set/calendar_v10/home_infopage/";
const V10_IMAGE_PATH = `${V10_HOME_PATH}images/`;

function resolveV10HomePath(url) {
  return url.startsWith("home_infopage/") ? `/calendar_set/calendar_v10/${url}` : url;
}

function isMobileViewport() {
  return window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
}

function isPriceSheetUrl(url) {
  return /popup_(night|price)\.html/.test(url);
}

function configurePopupMode(popupUrl) {
  const popupBox = document.getElementById('popupBox');
  const popupOverlay = document.getElementById('popupOverlay');
  const useBottomSheet = isMobileViewport() && isPriceSheetUrl(popupUrl);

  popupBox.classList.toggle('mobile-bottom-sheet', useBottomSheet);
  popupBox.classList.toggle('price-sheet-popup', isPriceSheetUrl(popupUrl));
  popupOverlay.classList.toggle('mobile-sheet-overlay', useBottomSheet);

  if (useBottomSheet) {
    popupBox.classList.remove('wide-popup');
    popupBox.style.removeProperty('max-width');
    popupBox.style.removeProperty('width');
  } else {
    popupBox.classList.add('wide-popup');
    popupBox.style.removeProperty('max-width');
    popupBox.style.width = '90%';
  }

  bindPopupSwipeDismiss(useBottomSheet);
}

let popupSwipeCleanup = null;

function bindPopupSwipeDismiss(enabled) {
  if (popupSwipeCleanup) {
    popupSwipeCleanup();
    popupSwipeCleanup = null;
  }
  if (!enabled) return;

  const popupBox = document.getElementById('popupBox');
  let startY = 0;
  let lastY = 0;
  let dragging = false;

  const onTouchStart = (event) => {
    if (!popupBox.classList.contains('active')) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    startY = touch.clientY;
    lastY = startY;
    dragging = true;
    popupBox.classList.add('dragging');
  };

  const onTouchMove = (event) => {
    if (!dragging) return;
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    lastY = touch.clientY;
    const deltaY = Math.max(0, lastY - startY);
    if (deltaY <= 0) return;
    event.preventDefault();
    popupBox.style.transform = `translateY(${deltaY}px)`;
  };

  const onTouchEnd = () => {
    if (!dragging) return;
    dragging = false;
    popupBox.classList.remove('dragging');
    const deltaY = Math.max(0, lastY - startY);
    if (deltaY > 80) {
      popupBox.style.removeProperty('transform');
      closePopup();
      return;
    }
    popupBox.style.removeProperty('transform');
  };

  popupBox.addEventListener('touchstart', onTouchStart, { passive: true });
  popupBox.addEventListener('touchmove', onTouchMove, { passive: false });
  popupBox.addEventListener('touchend', onTouchEnd, { passive: true });
  popupBox.addEventListener('touchcancel', onTouchEnd, { passive: true });

  popupSwipeCleanup = () => {
    popupBox.removeEventListener('touchstart', onTouchStart);
    popupBox.removeEventListener('touchmove', onTouchMove);
    popupBox.removeEventListener('touchend', onTouchEnd);
    popupBox.removeEventListener('touchcancel', onTouchEnd);
    popupBox.classList.remove('dragging');
    popupBox.style.removeProperty('transform');
  };
}

function showPopup() {
  const popupBox = document.getElementById('popupBox');
  const popupOverlay = document.getElementById('popupOverlay');

  requestAnimationFrame(() => {
    popupOverlay.classList.add('active');
    popupBox.classList.add('active');
  });
}

// 팝업 열기
function openPopup(url) {
  const popupUrl = resolveV10HomePath(url);
  configurePopupMode(popupUrl);

  // 캐시에 있으면 즉시 표시
  if (htmlCache.has(popupUrl)) {
    document.getElementById('popupContent').innerHTML = htmlCache.get(popupUrl);
    showPopup();
    return;
  }

  // 캐시에 없으면 fetch
  fetch(popupUrl)
    .then(response => response.text())
    .then(html => {
      htmlCache.set(popupUrl, html); // 캐시에 저장
      document.getElementById('popupContent').innerHTML = html;
      showPopup();
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
  popupBox.style.removeProperty('transform');

  // 애니메이션 끝난 후 내용 초기화
  setTimeout(() => {
    document.getElementById('popupContent').innerHTML = '';
    popupBox.classList.remove('mobile-bottom-sheet', 'price-sheet-popup');
    popupOverlay.classList.remove('mobile-sheet-overlay');
    if (popupSwipeCleanup) {
      popupSwipeCleanup();
      popupSwipeCleanup = null;
    }
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
  const popupUrl = resolveV10HomePath(url);

  // HTML 캐시 확인
  const loadHTML = htmlCache.has(popupUrl)
    ? Promise.resolve(htmlCache.get(popupUrl))
    : fetch(popupUrl).then(response => response.text()).then(html => {
      htmlCache.set(popupUrl, html);
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
    const folderMatch = popupUrl.match(/folder=([^&]+)/);
    const folder = folderMatch ? folderMatch[1] : '';
    console.log('[갤러리] folder 추출:', folder);
    if (!folder) return;

    // 이미지 갤러리 생성
    const thumbnailContainer = document.getElementById("thumbnailContainer");
    const mainImage = document.getElementById("mainImage");

    if (!thumbnailContainer || !mainImage) {
      console.warn("갤러리 대상 요소가 없습니다.");
      return;
    }

    console.log('[갤러리] 초기화 시작');
    thumbnailContainer.innerHTML = "";
    mainImage.src = "";
    mainImage.style.visibility = "hidden";

    const loader = document.createElement("div");
    loader.className = "gallery-loader";
    loader.innerText = "🔄 이미지 로딩 중...";
    thumbnailContainer.before(loader);

    const totalImages = 10;

    // 첫 번째 이미지만 즉시 로드
    const firstImagePath = `${V10_IMAGE_PATH}${folder}/image1.webp`;
    console.log('[갤러리] 첫 이미지 로드:', firstImagePath);

    // 캐시 확인
    if (imageCache.has(firstImagePath)) {
      console.log('[갤러리] 캐시에서 로드됨:', firstImagePath);
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
      console.log('[갤러리] 새로 로드 시작:', firstImagePath);
      const firstImg = new Image();
      firstImg.src = firstImagePath;
      firstImg.onload = () => {
        console.log('[갤러리] ✅ 첫 이미지 로드 성공:', firstImagePath);
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
        console.error('[갤러리] ❌ 첫 이미지 로딩 실패:', firstImagePath);
        loader.remove();
      };
    }

    // 나머지 이미지는 순차적으로 로드 (팝업이 이미 열린 후)
    setTimeout(() => {
      console.log('[갤러리] 나머지 이미지 로드 시작 (2~10)');
      for (let i = 2; i <= totalImages; i++) {
        const imgPath = `${V10_IMAGE_PATH}${folder}/image${i}.webp`;

        // 캐시에 있으면 즉시 표시
        if (imageCache.has(imgPath)) {
          console.log(`[갤러리] 캐시에서 로드 #${i}:`, imgPath);
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
          console.log(`[갤러리] ✅ 이미지 로드 성공 #${i}:`, imgPath);
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
          console.error(`[갤러리] ❌ 이미지 로딩 실패 #${i}:`, imgPath);
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
