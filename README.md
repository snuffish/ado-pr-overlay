# ADO Thread ID

Shows each Azure DevOps pull request comment thread's ID as a badge in the thread's top-left corner. Click the badge to copy the ID.

## Install (Brave or Chrome)

1. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Reload any open pull request tab.

## How it works

Azure DevOps puts the thread ID on each thread's reply box as a class name (`threadId-<id>`). `content.js` reads it from every `.repos-discussion-thread` and rescans when the page changes. If Microsoft renames that class, the badges disappear; update `ID_CLASS` in `content.js`.
