(function () {
  const trackedDestinations = [
    {
      test: (href) => href.includes("booking.naver.com/booking/10/bizes/1257912"),
      event: "naver_booking_click",
      label: "네이버 예약"
    },
    {
      test: (href) => href.includes("spacecloud.kr/space/66056"),
      event: "spacecloud_booking_click",
      label: "스페이스클라우드 예약"
    },
    {
      test: (href) => href.includes("m.place.naver.com/my"),
      event: "naver_my_click",
      label: "네이버 MY 예약 확인"
    },
    {
      test: (href) => href.includes("naver.me/59vo9MDk"),
      event: "naver_map_click",
      label: "네이버 지도"
    },
    {
      test: (href) => href.startsWith("tel:"),
      event: "phone_click",
      label: "전화"
    },
    {
      test: (href) => href.startsWith("sms:"),
      event: "sms_click",
      label: "문자"
    },
    {
      test: (href) => href.includes("blog.naver.com/clown313"),
      event: "naver_blog_click",
      label: "네이버 블로그"
    }
  ];

  function cleanLabel(value) {
    return (value || "").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function track(eventName, params) {
    const payload = Object.assign(
      {
        event_category: "rhythmjoy_site",
        page_path: window.location.pathname
      },
      params || {}
    );

    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, payload);
    }

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(
      Object.assign(
        {
          event: "rhythmjoy_" + eventName
        },
        payload
      )
    );

    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: "rhythmjoyTrack",
          eventName: eventName,
          payload: payload
        },
        "*"
      );
    }
  }

  window.rhythmjoyTrack = track;
  document.documentElement.dataset.rhythmjoyTracking = "ready";

  if (!window.__rhythmjoyTrackingMessageBridge && (!window.parent || window.parent === window)) {
    window.__rhythmjoyTrackingMessageBridge = true;
    window.addEventListener("message", function (event) {
      if (!event.data || event.data.type !== "rhythmjoyTrack" || !event.data.eventName) {
        return;
      }
      track(event.data.eventName, event.data.payload || {});
    });
  }

  function trackPageReady() {
    const params = new URLSearchParams(window.location.search);
    track("site_visit_ready", {
      event_label: document.title || "리듬앤조이",
      page_title: document.title || "",
      referrer: document.referrer || "direct",
      landing_url: window.location.href,
      viewport_width: String(window.innerWidth || ""),
      viewport_height: String(window.innerHeight || ""),
      open_info: params.get("openInfo") === "true" ? "true" : "false",
      section_id: params.get("section") || ""
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackPageReady, { once: true });
  } else {
    trackPageReady();
  }

  document.addEventListener(
    "click",
    function (event) {
      if (!(event.target instanceof Element)) {
        return;
      }

      const target = event.target.closest("a, button, input, label");
      if (!target) {
        return;
      }

      const href = target.href || target.getAttribute("href") || "";
      const label = cleanLabel(target.textContent || target.getAttribute("aria-label"));

      for (const destination of trackedDestinations) {
        if (destination.test(href)) {
          track(destination.event, {
            event_label: label || destination.label,
            link_url: href
          });
          return;
        }
      }

      if (target.id === "infoBtn") {
        track("booking_info_open", { event_label: "예약 정보 열기" });
        return;
      }

      const calendarControlEvents = {
        monthview: ["calendar_view_click", "월간 보기"],
        weekview: ["calendar_view_click", "주간 보기"],
        prev: ["calendar_nav_click", "이전"],
        todaybtn: ["calendar_nav_click", "오늘"],
        nextbtn: ["calendar_nav_click", "다음"]
      };

      if (target.id && calendarControlEvents[target.id]) {
        const control = calendarControlEvents[target.id];
        track(control[0], {
          event_label: control[1],
          control_id: target.id
        });
        return;
      }

      if (target.classList.contains("room-btn")) {
        track("room_focus_click", {
          event_label: label || "룸 선택",
          room_label: label
        });
        return;
      }

      if (target.classList.contains("room-toggle")) {
        track("room_toggle_click", {
          event_label: (target.value || "").toUpperCase(),
          room_label: (target.value || "").toUpperCase(),
          checked: target.checked ? "true" : "false"
        });
        return;
      }

      if (target.classList.contains("toggle-switch-vertical")) {
        const roomToggle = target.querySelector(".room-toggle");
        if (roomToggle) {
          track("room_toggle_click", {
            event_label: (roomToggle.value || "").toUpperCase(),
            room_label: (roomToggle.value || "").toUpperCase(),
            checked: roomToggle.checked ? "true" : "false"
          });
          return;
        }
      }

      if (target.classList.contains("copyTxt2")) {
        track("phone_copy_click", { event_label: "전화번호 복사" });
        return;
      }

      if (target.classList.contains("share-btn")) {
        track("guide_share_click", { event_label: label || "안내 공유" });
        return;
      }

      if (target.classList.contains("nav-item") && target.dataset.section) {
        track("guide_section_click", {
          event_label: label || target.dataset.section,
          section_id: target.dataset.section
        });
        return;
      }

      if (target.classList.contains("desktop-guide-item")) {
        track("guide_menu_click", { event_label: label || "안내 메뉴" });
        return;
      }

      if (target.getAttribute("onclick") && target.getAttribute("onclick").includes("openGallery")) {
        track("gallery_open", { event_label: label || "시설 사진" });
      }
    },
    true
  );
})();
