// Calendar interactions remain available; native image/link dragging does not.
document.addEventListener('dragstart', event => event.preventDefault());

// The same-origin website iframe has one height owner here. Month content uses
// natural layout (no vh sizes), so resizing the frame cannot grow it in a loop.
const calendarFrame = window.frameElement;
if (calendarFrame?.matches('.calendar-frame')) {
  let pendingLayout = 0;
  const syncFrameHeight = () => {
    pendingLayout = 0;
    const month = document.querySelector('#calendarAll .swiper-slide-active .fc-dayGridMonth-view');
    if (!month) {
      calendarFrame.style.removeProperty('height'); // Restore the site's weekly breakpoint sizing.
      return;
    }
    const title = document.querySelector('#calendarAll > .swc-toolbar');
    const controls = document.querySelector('.bottomtop');
    if (!title || !controls || !month.offsetHeight) return;
    const height = Math.ceil(title.getBoundingClientRect().height +
      month.getBoundingClientRect().height + controls.getBoundingClientRect().height + 2);
    const value = `${height}px`;
    if (calendarFrame.style.height !== value) calendarFrame.style.height = value;
  };
  const scheduleLayout = () => {
    if (!pendingLayout) pendingLayout = requestAnimationFrame(syncFrameHeight);
  };
  // SwipeCalendar replaces/recycles slides during navigation; watch its stable
  // root, including the active-slide class, rather than a disposable month node.
  const calendarRoot = document.getElementById('calendarAll');
  const observer = new MutationObserver(scheduleLayout);
  observer.observe(calendarRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', scheduleLayout);
  document.fonts?.ready.then(scheduleLayout);
  scheduleLayout();
}
