# Script-for-CCO

Money tracking userscript for **Case Clicker Online** that records per account:
- spending and losses,
- case-click earnings,
- case-buy spending,
- case ROI when opening cases,
- item-sell earnings,
- skin-trade events,
- tokens earned/lost,
- per-event IDs/session IDs for cleaner audit trails,
- pause/resume tracking controls,
- account rename/delete utilities,
- and exports all alt-account data into one spreadsheet or GitHub-friendly table/JSON.

## File
- `cco-money-tracker.user.js`

## Alt-account workflow (single spreadsheet)
1. Install a userscript extension (Tampermonkey/Violentmonkey).
2. Create a new script and paste in `cco-money-tracker.user.js`.
3. Open each account and play normally.
4. If auto-detection gets the wrong account name, run:
   - `CCOMoneyTracker.setAccount("my_alt_name")`
5. Export all events from all accounts:
   - `CCOMoneyTracker.downloadCsv()`
6. Export a **24-hour per-account summary** (best for quick profit check):
   - `CCOMoneyTracker.download24hSummaryCsv()`

## Console helpers
- `CCOMoneyTracker.getAccount()` – active account id.
- `CCOMoneyTracker.setAccount("name")` – manually set active account.
- `CCOMoneyTracker.getEvents()` – events for current account.
- `CCOMoneyTracker.getAllEventsByAccount()` – all stored accounts/events.
- `CCOMoneyTracker.getAllAccountsSummary(24)` – per-account totals for last N hours.
- `CCOMoneyTracker.getAccountSummary(24, "alt_name")` – one account summary with ROI.
- `CCOMoneyTracker.summary(24)` – prints per-account 24h table in console (includes case ROI).
- `CCOMoneyTracker.exportCsv()` / `downloadCsv()` – all events for all accounts.
- `CCOMoneyTracker.export24hSummaryCsv()` / `download24hSummaryCsv()` – one-row-per-account summary.
- `CCOMoneyTracker.clear()` – clear stored data.
- `CCOMoneyTracker.getStorageInfo()` – localStorage key + accounts + size.
- `CCOMoneyTracker.copyCsvToClipboard()` – copy full CSV to clipboard.
- `CCOMoneyTracker.copy24hSummaryToClipboard()` – copy 24h summary CSV.
- `CCOMoneyTracker.copyMarkdownSummaryToClipboard()` – copy 24h Markdown table.
- `CCOMoneyTracker.exportJson()` / `copyJsonToClipboard()` – raw DB JSON for external repos.
- `CCOMoneyTracker.downloadJson()` – download JSON backup file.
- `CCOMoneyTracker.importJson(jsonText, { merge: true })` – restore/import backup JSON.
- `CCOMoneyTracker.getEventsFiltered({ accountId, hours, type, action })` – flexible event filter.
- `CCOMoneyTracker.exportAccountCsv("alt_name", 24)` / `downloadAccountCsv("alt_name", 24)` – account-level CSV.
- `CCOMoneyTracker.renameAccount("old", "new")` – merge/rename account bucket.
- `CCOMoneyTracker.deleteAccount("name")` – remove one account bucket.
- `CCOMoneyTracker.pause()` / `resume()` / `isPaused()` – control live tracking.
- `CCOMoneyTracker.getHealthReport()` – diagnostics for unknown action/type events.

## Notes
- Event classification is heuristic-based (recent click context + money/token deltas).
- CSV/summary now include `token_delta`, `tokens_earned`, `tokens_lost`, `trade_skin_events`, `case_open_roi_percent`, `case_open_net`, and `cases_bought`.
- If your UI uses different token element ids/classes, update `tokenSelector` in script settings.
- Keep all alts in the same browser profile so localStorage data is shared.
- Events include `id`, `source`, and `session_id` for traceability.
- Number parsing supports shorthand like `1.2k`, `3m`, `4b` for money/tokens.


## Where data is stored
- Data is stored **locally in your browser `localStorage`** under key: `cco_money_tracker_db_v2`.
- Nothing is uploaded automatically.
- To inspect where/how much is stored, run:
  - `CCOMoneyTracker.getStorageInfo()`
  - includes `total_events` and `last_updated_at`.

## Put data into spreadsheet or GitHub page
- Spreadsheet (all events):
  - `CCOMoneyTracker.downloadCsv()`
  - or `CCOMoneyTracker.copyCsvToClipboard()` then paste into Sheets/Excel.
- Spreadsheet (24h per-account totals):
  - `CCOMoneyTracker.download24hSummaryCsv()`
  - or `CCOMoneyTracker.copy24hSummaryToClipboard()`.
- GitHub page / README table:
  - `CCOMoneyTracker.copyMarkdownSummaryToClipboard()` and paste into Markdown.
- Raw JSON data (for committing to a data repo/file):
  - `CCOMoneyTracker.exportJson()`
  - or `CCOMoneyTracker.copyJsonToClipboard()`.


## Backup and restore (essential)
- Create backup file: `CCOMoneyTracker.downloadJson()`
- Import backup data: `CCOMoneyTracker.importJson(jsonText, { merge: true })`
- Replace existing data instead of merge: `CCOMoneyTracker.importJson(jsonText, { merge: false })`
