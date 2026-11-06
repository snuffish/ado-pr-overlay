# ADO Thread ID

A browser extension that shows the thread ID of every comment thread on an Azure DevOps pull request.

Azure DevOps needs a thread's ID for the REST API, the `az` CLI and AI agents that reply to or resolve comments, but the web view never shows it. This extension puts a small `#113043` badge in the top-left corner of each thread. Click the badge to copy the ID.

On a long pull request it also lets you collapse threads, so you can skim the IDs or keep only the threads you're working on open.

## Features

- A badge on every comment thread on the pull request page, in the top-left corner of the thread's card.
- Click the badge to copy the ID to the clipboard; it shows "copied" for a second.
- A ▾/▸ button right of each badge collapses or expands that one thread.
- **Collapse all** / **Expand all** buttons in the bottom-right corner.
- A collapsed thread is an empty, fixed-height card showing only its badge and toggle. Click anywhere on it to expand it.
- Keeps working as you scroll, open threads or switch tabs. Azure DevOps changes pages without reloading, and the extension rescans when the page changes.
- No permissions, no network requests, no settings, no build step.

## Install

The extension is not in the Chrome Web Store. Load it unpacked:

1. Clone the repository:
   ```sh
   git clone https://github.com/snuffish/ado-thread-id-extension.git
   ```
2. Open the extensions page: `brave://extensions` in Brave, `chrome://extensions` in Chrome, `edge://extensions` in Edge.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the cloned folder.
5. Reload any open pull request tab.

To update, run `git pull` in the folder, click the reload icon on the extension's card, then reload any open pull request tab. A reloaded extension doesn't reach tabs that were already open.

## Usage

Open a pull request on `dev.azure.com` or `<org>.visualstudio.com`. Each thread gets a blue badge with its ID. Click a badge to copy the ID.

To collapse threads:

- Click ▾ beside a badge to collapse that thread, and ▸ to expand it again.
- Click **Collapse all** or **Expand all** in the bottom-right corner to change every thread at once. This resets the threads you toggled one by one.
- Collapse state lasts until you reload the page.

The ID is the same number as `discussionId` in a thread's link and the `threadId` in the REST API, for example:

```
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{prId}/threads/{threadId}
```

## How it works

Azure DevOps renders each comment thread as a `.repos-discussion-thread` element. The thread's reply box carries the thread ID as a class name, `threadId-<id>`. [`content.js`](content.js) reads that class from each thread and adds the badge and toggle to the top-left corner of the `.bolt-card` that holds the thread. For a file comment, that card also holds the file header and diff, so the extension adds space above the header to keep the badge clear of the file name. A `MutationObserver` rescans the page, at most once per animation frame, so threads that render later get a badge too.

Collapsing adds a class to the card that fixes its height and hides everything in it except the badge and toggle. Azure DevOps re-renders threads as you use the page, so the collapse state is kept in the script, keyed by thread ID, and applied again on every rescan.

| File                             | Purpose                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`manifest.json`](manifest.json) | Manifest V3. Runs the content script on `https://dev.azure.com/*` and `https://*.visualstudio.com/*`. |
| [`content.js`](content.js)       | Finds threads, reads their IDs, adds the badges and toggles and the collapse toolbar.                 |
| [`badge.css`](badge.css)         | Styles the badge, the toggle, the toolbar and collapsed cards.                                        |
| [`icons/`](icons)                | The extension icon: `icon.svg` is the source, the PNGs are rendered from it at 16, 32, 48 and 128 px. |

## Privacy

The extension asks for no permissions. It only runs on Azure DevOps pages, reads the page it runs on, sends nothing anywhere and stores nothing; collapse state lives in the page and is gone when you reload. The only time it writes anything is when you click a badge: it copies the ID to your clipboard.

## Limitations

- The extension depends on Azure DevOps markup it doesn't own, namely `.repos-discussion-thread` and the `threadId-<id>` class. If Microsoft renames either, the badges disappear. Update `THREAD` or `ID_CLASS` at the top of [`content.js`](content.js). Badge placement and collapsing also rely on the thread sitting inside a `.bolt-card`, and on file comments using `.comment-file-header`. If either changes, the badge falls back to the thread's own corner or overlaps the file name.
- A thread that renders without a reply box gets no badge, because the ID is read from that box.
- Azure DevOps Server (on-premises) installs are not matched. Add your server's URL to `matches` in [`manifest.json`](manifest.json).

## Troubleshooting

**No badges appear.** Reload the pull request tab after installing or updating the extension. Then check on the extensions page that the extension is enabled and shows no errors.

**A change to the extension doesn't show up.** Click the reload icon on the extension's card, then reload the pull request tab. Both steps are needed: the open tab keeps running the old script and stylesheet until you reload it.

**Badges disappeared after an Azure DevOps update.** Open DevTools on a pull request and look for the thread element and an element whose class starts with `threadId-`. If either has been renamed, update the selectors in [`content.js`](content.js) and open an issue.

## License

[MIT](LICENSE)
