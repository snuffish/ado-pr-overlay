// Azure DevOps renders each comment thread as .repos-discussion-thread; its reply box
// carries the thread ID as a class name (threadId-<id>). Badge every thread that has one.
(() => {
  const THREAD = ".repos-discussion-thread";
  const ID_CLASS = /\bthreadId-(\d+)\b/;
  const COLLAPSED = "ado-tid-collapsed";
  const RESOLVED = "ado-tid-is-resolved";
  const LINKED = "ado-tid-linked";
  const TABBAR = ".repos-pr-details-page-tabbar";

  // ADO re-renders threads, so collapse state lives here and is reapplied on every scan.
  let allCollapsed = false;
  const overrides = new Map(); // thread ID -> collapsed, set by a card's own toggle
let hideDrafts = false;

function onPRList() {
  return /\/pullrequests$/i.test(location.pathname);
}

function scanPRList() {
  const rows = document.querySelectorAll('[role="row"], .pr-list-item, tr');
  rows.forEach(row => {
    const isDraft = Array.from(row.querySelectorAll('span, div')).some(el => 
      el.textContent.trim() === "Draft" && !el.firstElementChild
    );
    row.style.display = (hideDrafts && isDraft) ? "none" : "";
  });
}

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

  // The same link ADO builds for a thread: ?discussionId=<thread> on the pull request,
  // plus #<comment> naming the thread's first comment when ADO has rendered it.
  function threadUrl(card, id) {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set("discussionId", id);
    const comment = card.querySelector(".repos-comment-viewer[id]")?.id;
    if (comment) url.hash = comment;
    return url.href;
  }

  function controls(card, id) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "ado-tid-badge";
    badge.textContent = `#${id}`;
    badge.title = "Click to copy a link to this thread";
    badge.addEventListener("click", async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(threadUrl(card, id));
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
    const linked = id === linkedId();
    if (linked && revealed !== location.href) reveal(id);
    // The outline fades out in CSS; dropping the class afterwards keeps a card ADO
    // re-renders later from flashing it again.
    card.classList.toggle(LINKED, linked && Date.now() < highlightUntil);
    if (linked && Date.now() < pinUntil)
      requestAnimationFrame(() => card.scrollIntoView({ block: "start" }));
    render(card, id);
  }

  // A thread link (?discussionId=<id>) lands on a card ADO barely highlights and scrolls
  // under the sticky tab bar. Outline that card, and once per URL expand it and scroll it
  // into view; CSS scroll-margin keeps it clear of the tab bar. Threads above it keep
  // loading and push it down, so each scan re-aligns it for a few seconds, until the
  // user scrolls, clicks or types.
  let revealed = null;
  let pinUntil = 0;
  let highlightUntil = 0;
  const linkedId = () =>
    new URLSearchParams(location.search).get("discussionId");

  function reveal(id) {
    revealed = location.href;
    pinUntil = highlightUntil = Date.now() + 4000;
    overrides.set(id, false);
  }

  for (const type of ["wheel", "touchstart", "mousedown", "keydown"])
    addEventListener(type, () => (pinUntil = 0), {
      capture: true,
      passive: true,
    });

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
    return bar;
  }

  let lastContext = null;

  function syncToolbar() {
    const isOverview = onOverview();
    const isList = onPRList();
    const context = isOverview ? "overview" : isList ? "list" : "none";

    if (context === lastContext && bar.children.length > 0) {
      const btns = bar.querySelectorAll("button");
      btns.forEach(b => {
        if (isOverview && b.title?.includes("threads")) {
          b.textContent = allCollapsed ? "▸" : "▾";
          b.title = allCollapsed ? "Expand all threads" : "Collapse all threads";
        }
        if (isList && b.textContent.includes("Drafts")) {
          b.textContent = hideDrafts ? "Show Drafts" : "Hide Drafts";
        }
      });
      return;
    }

    lastContext = context;
    bar.innerHTML = "";
    if (isOverview) {
      const b = document.createElement("button");
      b.type = "button";
      const update = () => {
        b.textContent = allCollapsed ? "▸" : "▾";
        b.title = allCollapsed ? "Expand all threads" : "Collapse all threads";
      };
      update();
      b.addEventListener("click", () => {
        allCollapsed = !allCollapsed;
        overrides.clear();
        update();
        scan();
      });
      bar.append(b);
    }
    if (isList) {
      const db = document.createElement("button");
      db.type = "button";
      const update = () => {
        db.textContent = hideDrafts ? "Show Drafts" : "Hide Drafts";
      };
      update();
      db.addEventListener("click", () => {
        hideDrafts = !hideDrafts;
        update();
        scan();
      });
      bar.append(db);
    }
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
        c.classList.remove("ado-tid-host", COLLAPSED, RESOLVED, LINKED),
      );
  }

  const bar = toolbar();
  let queued = false;
  function scan() {
    queued = false;
    const isOverview = onOverview();
    const isList = onPRList();
    if (!isOverview && !isList) return clear();

    syncToolbar();

    if (isOverview) {
      const threads = document.querySelectorAll(THREAD);
      threads.forEach(badge);
      const host = document.querySelector(TABBAR) ?? document.body;
      if (!threads.length) bar.remove();
      else if (bar.parentElement !== host) host.append(bar);
    }

    if (isList) {
      scanPRList();
      const host = document.body;
      if (bar.parentElement !== host) host.append(bar);
    }
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
