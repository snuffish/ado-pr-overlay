// Azure DevOps renders each comment thread as .repos-discussion-thread; its reply box
// carries the thread ID as a class name (threadId-<id>). Badge every thread that has one.
(() => {
  const THREAD = ".repos-discussion-thread";
  const ID_CLASS = /\bthreadId-(\d+)\b/;

  function threadIdOf(thread) {
    const holder = thread.querySelector('[class*="threadId-"]');
    return holder?.className.match(ID_CLASS)?.[1] ?? null;
  }

  function badge(thread) {
    const id = threadIdOf(thread);
    const existing = thread.querySelector(":scope > .ado-tid-badge");
    if (!id || existing?.dataset.id === id) return;
    existing?.remove();

    const el = document.createElement("button");
    el.type = "button";
    el.className = "ado-tid-badge";
    el.dataset.id = id;
    el.textContent = `#${id}`;
    el.title = "Thread ID: click to copy";
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(id);
      el.textContent = "copied";
      setTimeout(() => (el.textContent = `#${id}`), 1000);
    });
    thread.classList.add("ado-tid-host");
    thread.prepend(el);
  }

  let queued = false;
  function scan() {
    queued = false;
    document.querySelectorAll(THREAD).forEach(badge);
  }

  // Threads appear lazily and ADO switches pages without reloading, so rescan on DOM changes.
  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
