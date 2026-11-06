# ADO Thread ID

A browser extension that shows the thread ID of every comment thread on an Azure DevOps pull request.

Azure DevOps needs a thread's ID for the REST API, the `az` CLI and AI agents that reply to or resolve comments, but the web view never shows it. This extension puts a small `#113043` badge in the top-left corner of each thread. Click the badge to copy the ID.

## Features

- A badge on every comment thread on the pull request page.
- Click the badge to copy the ID to the clipboard; it shows "copied" for a second.
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

To update, run `git pull` in the folder and click the reload icon on the extension's card.

## Usage

Open a pull request on `dev.azure.com` or `<org>.visualstudio.com`. Each thread gets a blue badge with its ID. Click a badge to copy the ID.

The ID is the same number as `discussionId` in a thread's link and the `threadId` in the REST API, for example:

```
GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{prId}/threads/{threadId}
```

## How it works

Azure DevOps renders each comment thread as a `.repos-discussion-thread` element. The thread's reply box carries the thread ID as a class name, `threadId-<id>`. [`content.js`](content.js) reads that class from each thread and adds a badge as the thread's first child. A `MutationObserver` rescans the page, at most once per animation frame, so threads that render later get a badge too.

| File                             | Purpose                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`manifest.json`](manifest.json) | Manifest V3. Runs the content script on `https://dev.azure.com/*` and `https://*.visualstudio.com/*`. |
| [`content.js`](content.js)       | Finds threads, reads their IDs and adds the badges.                                                   |
| [`badge.css`](badge.css)         | Styles the badge.                                                                                     |
| [`icons/`](icons)                | The extension icon: `icon.svg` is the source, the PNGs are rendered from it at 16, 32, 48 and 128 px. |

## Privacy

The extension asks for no permissions. It only runs on Azure DevOps pages, reads the page it runs on, sends nothing anywhere and stores nothing. The only time it writes anything is when you click a badge: it copies the ID to your clipboard.

## Limitations

- The extension depends on Azure DevOps markup it doesn't own, namely `.repos-discussion-thread` and the `threadId-<id>` class. If Microsoft renames either, the badges disappear. Update `THREAD` or `ID_CLASS` at the top of [`content.js`](content.js).
- A thread that renders without a reply box gets no badge, because the ID is read from that box.
- Azure DevOps Server (on-premises) installs are not matched. Add your server's URL to `matches` in [`manifest.json`](manifest.json).

## Troubleshooting

**No badges appear.** Reload the pull request tab after installing or updating the extension. Then check on the extensions page that the extension is enabled and shows no errors.

**Badges disappeared after an Azure DevOps update.** Open DevTools on a pull request and look for the thread element and an element whose class starts with `threadId-`. If either has been renamed, update the selectors in [`content.js`](content.js) and open an issue.

## License

[MIT](LICENSE)
