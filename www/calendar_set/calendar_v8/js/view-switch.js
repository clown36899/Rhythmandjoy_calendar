function setupViewSwitchButtons() {
    const viewWeekBtn = document.getElementById("viewWeekBtn");
    const viewMonthBtn = document.getElementById("viewMonthBtn");

    const navPeriodWeekBtn = document.getElementById("navPeriodWeekBtn");
    const navPeriodMonthBtn = document.getElementById("navPeriodMonthBtn");

    if (viewWeekBtn) {
        viewWeekBtn.addEventListener("click", () => {
            if (window.calendar && window.calendar.monthPanelOpen) {
                window.calendar.toggleMonthPanel(); // 월간 패널 닫기 (주간 뷰로 전환)
            }
        });
    }

    if (viewMonthBtn) {
        viewMonthBtn.addEventListener("click", () => {
            if (window.calendar && !window.calendar.monthPanelOpen) {
                window.calendar.toggleMonthPanel(); // 월간 패널 열기
            }
        });
    }

    // 🔴 [신규] 상단 네비게이션 버튼 리스너
    if (navPeriodWeekBtn) {
        navPeriodWeekBtn.addEventListener("click", () => {
            if (window.calendar && window.calendar.monthPanelOpen) {
                window.calendar.toggleMonthPanel(); // 월간 패널 닫기
            }
        });
    }

    if (navPeriodMonthBtn) {
        navPeriodMonthBtn.addEventListener("click", () => {
            if (window.calendar && !window.calendar.monthPanelOpen) {
                window.calendar.toggleMonthPanel(); // 월간 패널 열기
            }
        });
    }
}
