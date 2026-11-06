// Azure DevOps renders each comment thread as .repos-discussion-thread; its reply box
// carries the thread ID as a class name (threadId-<id>). Badge every thread that has one.
(() => {
  const THREAD = ".repos-discussion-thread";
  const ID_CLASS = /\bthreadId-(\d+)\b/;
  const COLLAPSED = "ado-tid-collapsed";

  // ADO re-renders threads, so collapse state lives here and is reapplied on every scan.
  let allCollapsed = false;
  const overrides = new Map(); // thread ID -> collapsed, set by a card's own toggle

  const isCollapsed = (id) => overrides.get(id) ?? allCollapsed;

  function threadIdOf(thread) {
    const holder = thread.querySelector('[class*="threadId-"]');
    return holder?.className.match(ID_CLASS)?.[1] ?? null;
  }

  // A file comment's card also holds the file header and diff above the thread, so the
  // badge and the collapse go on the whole card.
  function cardOf(thread) {
    return thread.closest(".bolt-card") ?? thread;
  }

  function render(card, id) {
    const collapsed = isCollapsed(id);
    card.classList.toggle(COLLAPSED, collapsed);
    const toggle = card.querySelector(
      ":scope > .ado-tid-controls > .ado-tid-toggle",
    );
    if (toggle) {
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.title = collapsed ? "Expand thread" : "Collapse thread";
    }
  }

  function setOne(card, id, collapsed) {
    overrides.set(id, collapsed);
    render(card, id);
  }

  function controls(card, id) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "ado-tid-badge";
    badge.textContent = `#${id}`;
    badge.title = "Thread ID: click to copy";
    badge.addEventListener("click", async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(id);
      badge.textContent = "copied";
      setTimeout(() => (badge.textContent = `#${id}`), 1000);
    });

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ado-tid-toggle";
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      setOne(card, id, !isCollapsed(id));
    });

    const box = document.createElement("div");
    box.className = "ado-tid-controls";
    box.dataset.id = id;
    box.append(badge, toggle);
    return box;
  }

  function badge(thread) {
    const id = threadIdOf(thread);
    if (!id) return;
    const card = cardOf(thread);
    const existing = card.querySelector(":scope > .ado-tid-controls");
    if (existing?.dataset.id !== id) {
      existing?.remove();
      card.classList.add("ado-tid-host");
      card.prepend(controls(card, id));
    }
    render(card, id);
  }

  // A click on a collapsed card expands just that card instead of reaching ADO's controls.
  document.addEventListener(
    "click",
    (e) => {
      const card = e.target.closest?.(`.${COLLAPSED}`);
      if (!card || e.target.closest(".ado-tid-controls")) return;
      e.preventDefault();
      e.stopPropagation();
      const id = threadIdOf(card);
      if (id) setOne(card, id, false);
    },
    true,
  );

  function setAll(collapsed) {
    allCollapsed = collapsed;
    overrides.clear();
    scan();
  }

  function toolbar() {
    const bar = document.createElement("div");
    bar.className = "ado-tid-toolbar";
    for (const [label, collapsed] of [
      ["Collapse all", true],
      ["Expand all", false],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", () => setAll(collapsed));
      bar.append(b);
    }
    return bar;
  }

  const bar = toolbar();
  let queued = false;
  function scan() {
    queued = false;
    const threads = document.querySelectorAll(THREAD);
    threads.forEach(badge);
    // Only show the toolbar on pages that have threads.
    if (threads.length && !bar.isConnected) document.body.append(bar);
    else if (!threads.length && bar.isConnected) bar.remove();
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
