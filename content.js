// Azure DevOps renders each comment thread as .repos-discussion-thread; its reply box
// carries the thread ID as a class name (threadId-<id>). Badge every thread that has one.
(() => {
  const THREAD = ".repos-discussion-thread";
  const ID_CLASS = /\bthreadId-(\d+)\b/;
  const COLLAPSED = "ado-tid-collapsed";
  const RESOLVED = "ado-tid-is-resolved";
  const TABBAR = ".repos-pr-details-page-tabbar";

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
    // A file comment's header names the file; repeat it beside the toggle so a collapsed
    // card still says which file it is about. CSS shows it only while collapsed.
    const file = card.querySelector(
      ":scope > .ado-tid-controls > .ado-tid-file",
    );
    const link = card.querySelector(".comment-file-header-link");
    if (file && link) {
      file.textContent = link.textContent.trim();
      file.title = link.nextElementSibling?.textContent.trim() ?? "";
    }
    // The thread's status dropdown reads Active or Pending until someone resolves it; any
    // other status (Resolved, Won't fix, Closed, By design) counts as resolved, as in ADO's
    // own "comments resolved" tally. CSS shows the check only while collapsed.
    const status = card
      .querySelector(
        ".repos-discussion-thread .bolt-dropdown-expandable-button-label",
      )
      ?.textContent.trim();
    const resolved = !!status && !/^(active|pending)$/i.test(status);
    card.classList.toggle(RESOLVED, resolved);
    const check = card.querySelector(
      ":scope > .ado-tid-controls > .ado-tid-resolved",
    );
    if (check) check.title = resolved ? status : "";
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
    const file = document.createElement("span");
    file.className = "ado-tid-file";
    const check = document.createElement("span");
    check.className = "ado-tid-resolved";
    check.textContent = "✓";
    box.append(badge, toggle, file, check);
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
      if (!card || e.target.closest(".ado-tid-controls button")) return;
      e.preventDefault();
      e.stopPropagation();
      const id = threadIdOf(card);
      if (id) setOne(card, id, false);
    },
    true,
  );

  // One button flips every thread; its arrow matches the per-thread toggle.
  function toolbar() {
    const bar = document.createElement("div");
    bar.className = "ado-tid-toolbar";
    const b = document.createElement("button");
    b.type = "button";
    const label = () => {
      b.textContent = allCollapsed ? "▸" : "▾";
      b.title = allCollapsed ? "Expand all threads" : "Collapse all threads";
    };
    label();
    b.addEventListener("click", () => {
      allCollapsed = !allCollapsed;
      overrides.clear();
      label();
      scan();
    });
    bar.append(b);
    return bar;
  }

  // The overlay belongs on the PR's Overview tab only. ADO marks the tab with ?_a=<tab>
  // and leaves it out on Overview, the default.
  function onOverview() {
    if (!/\/pullrequest\/\d+/i.test(location.pathname)) return false;
    const tab = new URLSearchParams(location.search).get("_a") ?? "overview";
    return tab.toLowerCase() === "overview";
  }

  // ADO keeps cards alive across tab switches, so strip what earlier scans added.
  function clear() {
    bar.remove();
    document.querySelectorAll(".ado-tid-controls").forEach((c) => c.remove());
    document
      .querySelectorAll(".ado-tid-host")
      .forEach((c) =>
        c.classList.remove("ado-tid-host", COLLAPSED, RESOLVED),
      );
  }

  const bar = toolbar();
  let queued = false;
  function scan() {
    queued = false;
    if (!onOverview()) return clear();
    const threads = document.querySelectorAll(THREAD);
    threads.forEach(badge);
    // Only show the toolbar on pages that have threads. It hangs under the PR's sticky
    // tab bar so it stays put while the page scrolls; without one it pins to the viewport.
    const host = document.querySelector(TABBAR) ?? document.body;
    if (!threads.length) bar.remove();
    else if (bar.parentElement !== host) host.append(bar);
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
