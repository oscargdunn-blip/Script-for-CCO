# Script-for-CCO
Case Clicker Online offline helper script.

## Tampermonkey script
This repository now includes a ready-to-paste userscript:

- `cco-autoclicker.user.js`

### Features
- Auto-click loop with configurable clicks per second.
- Live panel that shows:
  - elapsed time
  - total clicks
  - total earned
  - earnings per second/minute/hour
- Hotkey (`F8`) to quickly start/stop.
- Rescan button to re-detect game elements if the page reloads UI.

### Setup
1. Install Tampermonkey in your browser.
2. Create a new script and paste contents of `cco-autoclicker.user.js`.
3. Save and open your offline game page.
4. If the script cannot detect your click button or money value automatically, edit these fields inside the script:
   - `CONFIG.clickTargetSelector`
   - `CONFIG.moneySelector`

### Notes
- The script is intended for offline usage.
- `@match` is currently broad (`*://*/*`) so you can test quickly; lock this to your exact game URL once confirmed.
