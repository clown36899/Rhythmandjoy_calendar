
  // 팝업 열기
  function openPopup(url) {
    fetch(url)
      .then(response => response.text())
      .then(html => {
        document.getElementById('popupContent').innerHTML = html;
    
        document.getElementById('popupOverlay').style.display = 'block';
        document.getElementById('popupBox').style.display = 'block';
      })
      .catch(err => {
        alert("팝업 로딩 실패: " + err);
      });
  }

  // 팝업 닫기
  function closePopup() {
    console.log("close");
    document.getElementById('popupOverlay').style.display = 'none';
    document.getElementById('popupBox').style.display = 'none';
    document.getElementById('popupContent').innerHTML = ''; // 내용 초기화
  }

  // 배경 클릭 시 팝업 닫기
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('popupOverlay').addEventListener('click', closePopup);
    
  });
  // function close_x() {
  //   console.log("close");
  // }

////////////////////////////////////////////////////////////////////////////////////////////////////////



function openInnerPopup(url) {
    console.log("요청 URL:", url);
  
    fetch(url)
      .then(response => response.text())
      .then(html => {
        // 팝업 내용 삽입
        document.getElementById('innerPopupContent').innerHTML = html;
        document.getElementById('innerPopupOverlay').style.display = 'block';
        document.getElementById('innerPopupBox').style.display = 'block';
  
        // folder=roomA 형식에서 folder값 추출
        const folderMatch = url.match(/folder=([^&]+)/);
        const folder = folderMatch ? folderMatch[1] : '';
        if (!folder) return;
  
        // 이미지 갤러리 생성
       // 기존 openInnerPopup 함수 내에서 아래처럼 대체
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
let firstLoaded = false;

for (let i = 1; i <= totalImages; i++) {
  const imgPath = `home_infopage/images/${folder}/image${i}.jpeg`;
        

  const img = new Image();
  img.src = imgPath;

  img.onload = () => {
    const thumb = document.createElement("img");
    thumb.src = imgPath;
    thumb.classList.add("thumbnail");

    if (!firstLoaded) {
      mainImage.src = imgPath;
      mainImage.onload = () => {
        mainImage.style.visibility = "visible";
        loader.remove();
      };
      thumb.classList.add("active");
      firstLoaded = true;
    }

    thumb.addEventListener("click", () => {
      mainImage.src = imgPath;
      document.querySelectorAll(".thumbnail").forEach(t => t.classList.remove("active"));
      thumb.classList.add("active");
    });

    thumbnailContainer.appendChild(thumb);
  };

  img.onerror = () => {
    console.warn(`이미지 로딩 실패: ${imgPath}`);
    if (i === totalImages && !firstLoaded) loader.remove();
  };

        }
      })
      .catch(err => {
        alert("내부 팝업 로딩 실패: " + err);
      });
  }


  // 두 번째 팝업 닫기
  function closeInnerPopup() {
    console.log("?내부 팝업 닫기 실행");
    document.getElementById('innerPopupOverlay').style.display = 'none';
    document.getElementById('innerPopupBox').style.display = 'none';
    document.getElementById('innerPopupContent').innerHTML = ''; // 내용 초기화
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

