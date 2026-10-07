(function () {
  if (!window.MutationObserver || window.__rhythmjoyObserverGuard) {
    return;
  }

  window.__rhythmjoyObserverGuard = true;
  document.documentElement.dataset.rhythmjoyObserverGuard = "ready";

  const originalObserve = window.MutationObserver.prototype.observe;
  window.MutationObserver.prototype.observe = function (target, options) {
    if (!target || (typeof Node !== "undefined" && !(target instanceof Node))) {
      return;
    }

    try {
      return originalObserve.call(this, target, options);
    } catch (error) {
      if (error && String(error.message || "").includes("parameter 1 is not of type 'Node'")) {
        return;
      }
      throw error;
    }
  };
})();
