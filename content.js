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
  let hideAiThreads = false;
  const { hideAiThreads: savedHideAiThreads } =
    await chrome.storage.local.get("hideAiThreads");
  if (savedHideAiThreads !== undefined) hideAiThreads = savedHideAiThreads;
  // The PR list's one filter: the mode last picked from the ▾ menu, and whether it's on.
  const MODES = {
    act: "To act on",
    drafts: "Hide drafts",
    waiting: "Hide waiting for author",
  };
  let prFilter = { mode: "act", on: false };
  const { prFilter: savedPrFilter } = await chrome.storage.local.get("prFilter");
  if (MODES[savedPrFilter?.mode]) prFilter = savedPrFilter;
  const AI = "ado-tid-ai";
  const AI_HIDDEN = "ado-tid-ai-hidden";
  // AI-posted threads open with a marker line: "🤖 AI review (…), read and approved by …".
  const AI_MARKER = /^\W*AI review\b/;

  function onPRList() {
    return /\/pullrequests$/i.test(location.pathname);
  }

  // The list shows neither votes nor threads, so each active PR's state comes from the
  // REST API: PR ID -> { act, waiting }. null until the first fetch lands.
  const PR_INFO_TTL = 60_000;
  let prInfo = null;
  let prInfoFetchedAt = 0;
  let prInfoFetching = false;

  // dev.azure.com/<org>/<project>/… or <org>.visualstudio.com/<project>/…
  function apiPaths() {
    const parts = location.pathname.split("/").filter(Boolean);
    const org = location.hostname === "dev.azure.com" ? `/${parts.shift()}` : "";
    return { org, project: `${org}/${parts[0]}` };
  }

  const getJson = (url) =>
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  // System threads (votes, pushes, policy runs) carry a CodeReviewThreadType; comments don't.
  const threadType = (t) => t.properties?.CodeReviewThreadType?.$value;
  const texts = (t) =>
    t.comments.filter((c) => c.commentType === "text" && !c.isDeleted);

  // As a reviewer who voted Waiting for author: has the author commented or anyone pushed
  // since my last comment or vote?
  function authorMovedOn(threads, me, author) {
    let mine = 0;
    let theirs = 0;
    for (const t of threads) {
      const type = threadType(t);
      if (type === "VoteUpdate" && t.comments[0]?.author.id === me)
        mine = Math.max(mine, Date.parse(t.comments[0].publishedDate));
      if (type === "RefUpdate")
        theirs = Math.max(theirs, Date.parse(t.lastUpdatedDate));
      if (type) continue;
      for (const c of texts(t)) {
        const at = Date.parse(c.publishedDate);
        if (c.author.id === me) mine = Math.max(mine, at);
        else if (c.author.id === author) theirs = Math.max(theirs, at);
      }
    }
    return theirs > mine;
  }

  // On my own PR: an open comment thread whose newest comment isn't mine.
  const hasReplies = (threads, me) =>
    threads.some(
      (t) =>
        !threadType(t) &&
        (t.status === "active" || t.status === "pending") &&
        texts(t).length &&
        texts(t).at(-1).author.id !== me,
    );

  // "To act on": a review I haven't started, an author who answered my Waiting for author,
  // or my own PR that a reviewer blocked or replied on.
  async function fetchPrInfo() {
    if (prInfoFetching || Date.now() - prInfoFetchedAt < PR_INFO_TTL) return;
    prInfoFetching = true;
    try {
      const { org, project } = apiPaths();
      const me = (await getJson(`${org}/_apis/connectionData`)).authenticatedUser.id;
      const prs = (
        await getJson(
          `${project}/_apis/git/pullrequests?searchCriteria.status=active&$top=1000&api-version=7.1`,
        )
      ).value;
      const threadsOf = async (pr) =>
        (
          await getJson(
            `${project}/_apis/git/repositories/${pr.repository.id}/pullRequests/${pr.pullRequestId}/threads?api-version=7.1`,
          )
        ).value;
      const info = new Map();
      await Promise.all(
        prs.map(async (pr) => {
          const vote = pr.reviewers.find((r) => r.id === me)?.vote;
          const waiting = vote < 0;
          let act = false;
          if (pr.createdBy.id === me)
            act =
              pr.reviewers.some((r) => r.vote < 0) ||
              hasReplies(await threadsOf(pr), me);
          else if (vote === 0) act = !pr.isDraft;
          else if (waiting)
            act = authorMovedOn(await threadsOf(pr), me, pr.createdBy.id);
          info.set(pr.pullRequestId, { act, waiting });
        }),
      );
      prInfo = info;
      scan();
    } catch (e) {
      console.warn("ADO PR Overlay: could not load pull request state", e);
    } finally {
      prInfoFetchedAt = Date.now();
      prInfoFetching = false;
    }
  }

  // ADO renders each list row as the PR's own <a href=".../pullrequest/<id>">.
  function prIdOf(row) {
    const link = row.closest('a[href*="/pullrequest/"]') ??
      row.querySelector('a[href*="/pullrequest/"]');
    const href = link?.getAttribute("href");
    const m = href?.match(/\/pullrequest\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // Applies the filter to the list rows; returns how many rows match each mode, plus all.
  // Until the API answers, the act and waiting modes hide nothing.
  function scanPRList() {
    fetchPrInfo();
    const rows = document.querySelectorAll('[role="row"], .pr-list-item, tr');
    const counts = { act: 0, drafts: 0, waiting: 0, all: 0 };
    rows.forEach((row) => {
      const id = prIdOf(row);
      const info = prInfo?.get(id);
      const match = {
        act: !!info?.act,
        drafts: Array.from(row.querySelectorAll("span, div")).some(
          (el) => el.textContent.trim() === "Draft" && !el.firstElementChild,
        ),
        waiting: !!info?.waiting,
      };
      if (id) counts.all++;
      for (const m in MODES) if (match[m]) counts[m]++;
      const { mode, on } = prFilter;
      const hide =
        on &&
        (mode === "act" ? prInfo && id && !match.act : match[mode]);
      const display = hide ? "none" : "";
      if (row.style.display !== display) row.style.display = display;
    });
    return counts;
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

  // The PR list's split button: the main half turns the current mode on or off, ▾ opens a
  // menu above it to pick another mode or show everything.
  async function setFilter(next) {
    prFilter = { ...prFilter, ...next };
    menu.hidden = true;
    await chrome.storage.local.set({ prFilter });
    scan();
  }
  const listFilter = document.createElement("div");
  listFilter.className = "ado-tid-split";
  const filterBtn = button(() => setFilter({ on: !prFilter.on }));
  const menuBtn = button(() => (menu.hidden = !menu.hidden));
  menuBtn.className = "ado-tid-menu-toggle";
  menuBtn.textContent = "▾";
  menuBtn.title = "Choose filter";
  const menu = document.createElement("div");
  menu.className = "ado-tid-filter-menu";
  menu.hidden = true;
  const menuItems = {};
  for (const m of [...Object.keys(MODES), "all"]) {
    const item = button(() =>
      setFilter(m === "all" ? { on: false } : { mode: m, on: true }),
    );
    item.append(document.createElement("span"), document.createElement("span"));
    menuItems[m] = item;
    if (m === "all") menu.append(document.createElement("hr"));
    menu.append(item);
  }
  listFilter.append(menu, filterBtn, menuBtn);
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !listFilter.contains(e.target)) menu.hidden = true;
  });

  function labelMenu(counts) {
    for (const [m, item] of Object.entries(menuItems)) {
      const current = m === "all" ? !prFilter.on : prFilter.on && prFilter.mode === m;
      const [name, count] = item.children;
      const text = `${current ? "✓ " : ""}${m === "all" ? "Show all" : MODES[m]}`;
      if (name.textContent !== text) name.textContent = text;
      if (count.textContent !== String(counts[m])) count.textContent = counts[m];
      item.classList.toggle("ado-tid-current", current);
    }
  }

  // Write a label only when it changes, so the MutationObserver doesn't rescan for nothing.
  function label(b, text, title = "") {
    if (b.textContent !== text) b.textContent = text;
    if (b.title !== title) b.title = title;
  }

  function place(el, host) {
    if (el.parentElement !== host) host.append(el);
  }

  // ADO marks the PR tab with ?_a=<tab> and leaves it out on Overview, the default.
  function onTab(name) {
    if (!/\/pullrequest\/\d+/i.test(location.pathname)) return false;
    const tab = new URLSearchParams(location.search).get("_a") ?? "overview";
    return tab.toLowerCase() === name;
  }

  // The Files tab's tree is a bolt tree: each folder (and each file with comments) is a
  // row with aria-expanded, toggled by its own chevron button.
  const TREE = '[role="tree"], [role="treegrid"], .bolt-tree';
  const treeBar = document.createElement("div");
  treeBar.className = "ado-tid-tree-toolbar";
  let treeBusy = false;
  const treeBtn = button(() => {
    const tree = document.querySelector(TREE);
    if (tree && !treeBusy) setTree(tree, !!tree.querySelector('[aria-expanded="true"]'));
  });
  treeBar.append(treeBtn);

  // Pin the button to the top-right corner of the tree's scrolling panel, so it stays put
  // however far the tree is scrolled.
  function scroller(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
    return el;
  }

  function pinTreeBar(tree) {
    const box = scroller(tree).getBoundingClientRect();
    const top = `${Math.max(box.top, 0) + 4}px`;
    const left = `${box.right - treeBar.offsetWidth - 20}px`;
    if (treeBar.style.top !== top) treeBar.style.top = top;
    if (treeBar.style.left !== left) treeBar.style.left = left;
  }

  for (const type of ["resize", "scroll"])
    addEventListener(
      type,
      () => {
        const tree = treeBar.isConnected && document.querySelector(TREE);
        if (tree) pinTreeBar(tree);
      },
      { capture: true, passive: true },
    );

  // Rows render as their parents open and are virtualized, so flip what is on screen,
  // deepest first, then look again on the next frame until nothing is left to flip.
  function setTree(tree, collapse) {
    treeBusy = true;
    const want = collapse ? "true" : "false";
    let rounds = 0;
    const step = () => {
      const rows = Array.from(
        tree.querySelectorAll(`[aria-expanded="${want}"]`),
      ).sort(
        (a, b) =>
          (Number(b.getAttribute("aria-level")) || 0) -
          (Number(a.getAttribute("aria-level")) || 0),
      );
      if (!rows.length || ++rounds > 50) {
        treeBusy = false;
        return;
      }
      // Only the chevron: a click on the row itself opens that file or folder in the diff.
      const chevrons = rows
        .map((row) => row.querySelector(".bolt-tree-expand-button"))
        .filter(Boolean);
      if (!chevrons.length) {
        treeBusy = false;
        return;
      }
      for (const chevron of chevrons) chevron.click();
      setTimeout(step, 50);
    };
    step();
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
    const isOverview = onTab("overview");
    const isFiles = onTab("files");
    const isList = onPRList();
    if (!isOverview && !isFiles && !isList) {
      treeBar.remove();
      return clear();
    }

    if (isFiles) {
      clear();
      const tree = document.querySelector(TREE);
      if (!tree) return treeBar.remove();
      const expanded = !!tree.querySelector('[aria-expanded="true"]');
      label(
        treeBtn,
        expanded ? "▾" : "▸",
        expanded ? "Collapse all folders" : "Expand all folders",
      );
      place(treeBar, document.body);
      pinTreeBar(tree);
      return;
    }
    treeBar.remove();

    if (isOverview) {
      listFilter.remove();
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
      const counts = scanPRList();
      const { mode, on } = prFilter;
      label(
        filterBtn,
        `${MODES[mode]} (${counts[mode]})`,
        on ? "Filter on: click to show all" : "Filter off: click to turn it on",
      );
      filterBtn.classList.toggle("ado-tid-off", !on);
      labelMenu(counts);
      place(listFilter, filters);
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
