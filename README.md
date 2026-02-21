# Script-for-CCO

Tampermonkey userscript for **Case Clicker Online** with two separate live dashboards:
- **Money Live Stats**
- **Token Live Stats**

Each popup is independent and supports **Main/Alt profile switching**.

## Install
1. Install the Tampermonkey browser extension.
2. Create a new script.
3. Paste in `tampermonkey-case-clicker-chart.user.js`.
4. Save, then open/reload Case Clicker Online.

## Beneficial live-stat features included
- Two independent popups (money + tokens), each with their own history/baseline.
- Main/Alt account switch button (**Acct: MAIN/ALT**).
- Graph modes: **Line**, **Area**, **Bars**.
- Smoothing modes: **Raw** and **MA(5)**.
- Time filters: **All**, **1m**, **5m**, **15m**, **1h**.
- Per-popup controls: **Alerts**, **Reminders**, **Trend**, **Export CSV**, **Pause/Resume**, **Reset**, **Hide/Show**.
- Crypto-style risk controls:
  - Set Take-Profit and Stop-Loss P/L levels.
  - Optional browser notifications when TP/SL is hit.
- Reminder system for won/lost tracking:
  - Configurable periodic reminder cadence (minutes).
  - Notification body shows your current live P/L.
- Trend-warning system (for losing streaks):
  - Alert when consecutive losing ticks exceed your threshold.
  - Alert when loss-rate in a rolling window exceeds your threshold.
  - Cooldown timer prevents notification spam.
  - Notification suggests pausing/switching strategy.
- Heartbeat sampling for flat periods (keeps timeline alive even when value doesn't change).
- Advanced analytics:
  - Current P/L, ROI, P/L per hour
  - Up/Down ticks
  - **Avg Spend / Loss Tick** (your average money/tokens spent each losing step)
  - **Avg Win / Win Tick**
  - **Profit Factor** (gross wins ÷ gross losses)
  - **Turnover** (total absolute movement through the session)
  - Volatility (std dev of tick changes)
  - Max drawdown
  - Last change age
  - Runtime, sample count, and last update
- Position and UI state persistence.

## Notes
- If your DOM uses different element names, edit `MONEY_SELECTORS` and `TOKEN_SELECTORS`.
- The script targets `caseclicker.online` domains.
