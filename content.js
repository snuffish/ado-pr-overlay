// Azure DevOps renders each comment thread as .repos-discussion-thread; its reply box
// carries the thread ID as a class name (threadId-<id>). Badge every thread that has one.
(async () => {
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
  const { hideDrafts: savedHideDrafts } =
    await chrome.storage.local.get("hideDrafts");
  if (savedHideDrafts !== undefined) hideDrafts = savedHideDrafts;
  let hideAiThreads = false;
  const { hideAiThreads: savedHideAiThreads } =
    await chrome.storage.local.get("hideAiThreads");
  if (savedHideAiThreads !== undefined) hideAiThreads = savedHideAiThreads;
  const AI = "ado-tid-ai";
  const AI_HIDDEN = "ado-tid-ai-hidden";
  // AI-posted threads open with a marker line: "🤖 AI review (…), read and approved by …".
  const AI_MARKER = /^\W*AI review\b/;

  function onPRList() {
    return /\/pullrequests$/i.test(location.pathname);
  }

  // Hides draft rows when the filter is on; returns how many drafts the list shows.
  function scanPRList() {
    const rows = document.querySelectorAll('[role="row"], .pr-list-item, tr');
    let drafts = 0;
    rows.forEach((row) => {
      const isDraft = Array.from(row.querySelectorAll("span, div")).some(
        (el) => el.textContent.trim() === "Draft" && !el.firstElementChild,
      );
      if (isDraft) drafts++;
      row.style.display = hideDrafts && isDraft ? "none" : "";
    });
    return drafts;
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
    // Only the thread's first comment decides, so a human thread with an AI reply stays.
    const first = card
      .querySelector(".repos-discussion-thread .repos-comment-viewer p")
      ?.textContent.trim();
    const ai = AI_MARKER.test(first ?? "");
    card.classList.toggle(AI, ai);
    card.classList.toggle(AI_HIDDEN, hideAiThreads && ai);
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

  function button(onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  // One button flips every thread; its arrow matches the per-thread toggle. It hangs
  // under the PR's sticky tab bar.
  const bar = document.createElement("div");
  bar.className = "ado-tid-toolbar";
  const collapseBtn = button(() => {
    allCollapsed = !allCollapsed;
    overrides.clear();
    scan();
  });
  bar.append(collapseBtn);

  // The filters sit in the bottom-right corner: AI threads on Overview, drafts on the list.
  const filters = document.createElement("div");
  filters.className = "ado-tid-toolbar";
  const aiBtn = button(async () => {
    hideAiThreads = !hideAiThreads;
    await chrome.storage.local.set({ hideAiThreads });
    scan();
  });
  const draftBtn = button(async () => {
    hideDrafts = !hideDrafts;
    await chrome.storage.local.set({ hideDrafts });
    scan();
  });

  // Write a label only when it changes, so the MutationObserver doesn't rescan for nothing.
  function label(b, text, title = "") {
    if (b.textContent !== text) b.textContent = text;
    if (b.title !== title) b.title = title;
  }

  function place(el, host) {
    if (el.parentElement !== host) host.append(el);
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
    filters.remove();
    document.querySelectorAll(".ado-tid-controls").forEach((c) => c.remove());
    document
      .querySelectorAll(".ado-tid-host")
      .forEach((c) =>
        c.classList.remove(
          "ado-tid-host",
          COLLAPSED,
          RESOLVED,
          LINKED,
          AI,
          AI_HIDDEN,
        ),
      );
  }

  let queued = false;
  function scan() {
    queued = false;
    const isOverview = onOverview();
    const isList = onPRList();
    if (!isOverview && !isList) return clear();

    if (isOverview) {
      draftBtn.remove();
      const threads = document.querySelectorAll(THREAD);
      threads.forEach(badge);
      if (!threads.length) {
        bar.remove();
        filters.remove();
        return;
      }
      label(
        collapseBtn,
        allCollapsed ? "▸" : "▾",
        allCollapsed ? "Expand all threads" : "Collapse all threads",
      );
      const ai = document.querySelectorAll(`.${AI}`).length;
      label(aiBtn, `${hideAiThreads ? "Show" : "Hide"} AI Threads (${ai})`);
      place(bar, document.querySelector(TABBAR) ?? document.body);
      place(aiBtn, filters);
      place(filters, document.body);
    }

    if (isList) {
      bar.remove();
      aiBtn.remove();
      const drafts = scanPRList();
      label(draftBtn, `${hideDrafts ? "Show" : "Hide"} Drafts (${drafts})`);
      place(draftBtn, filters);
      place(filters, document.body);
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
