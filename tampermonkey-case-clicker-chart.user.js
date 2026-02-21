// ==UserScript==
// @name         Case Clicker Online - Money + Token Live Stats
// @namespace    https://case-clicker.com/
// @version      1.7.0
// @description  Separate live dashboards for money and tokens with Main/Alt profiles, alerts, stop-loss reminders, trend alerts, and deeper session analytics.
// @author       You
// @match        *://https://case-clicker.com/*
// @match        *://https://case-clicker.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PROFILES = ['main', 'alt'];
  const ACTIVE_PROFILE_KEY = 'cco_active_profile_v1';

  const MAX_POINTS = 5000;
  const SAMPLE_MS = 1200;
  const HEARTBEAT_MS = 30_000;

  const MONEY_SELECTORS = [
    '[data-testid*="balance" i]',
    '[class*="balance" i]',
    '[id*="balance" i]',
    '[class*="wallet" i]',
    '[id*="wallet" i]'
  ];

  const TOKEN_SELECTORS = [
    '[data-testid*="token" i]',
    '[class*="token" i]',
    '[id*="token" i]',
    '[data-testid*="coin" i]',
    '[class*="coin" i]',
    '[id*="coin" i]'
  ];

  const TIME_WINDOWS = { all: 0, '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 };

  let activeProfile = localStorage.getItem(ACTIVE_PROFILE_KEY) || 'main';
  if (!PROFILES.includes(activeProfile)) activeProfile = 'main';

  const style = document.createElement('style');
  style.textContent = `
    .cco-pl-chart { position: fixed; width: min(530px, calc(100vw - 24px)); background: rgba(14,19,28,.95); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; z-index: 999999; color: #fff; font-family: Inter, system-ui, -apple-system, Segoe UI, sans-serif; box-shadow: 0 16px 40px rgba(0,0,0,.45); backdrop-filter: blur(6px); user-select: none; }
    .cco-pl-chart * { box-sizing: border-box; }
    .cco-pl-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); cursor: move; }
    .cco-pl-title { font-size: 13px; font-weight: 700; opacity: .92; }
    .cco-pl-meta { font-size: 12px; font-weight: 700; }
    .cco-pl-meta.pos { color: #22c55e; } .cco-pl-meta.neg { color: #ef4444; }
    .cco-pl-actions { display:flex; gap:6px; flex-wrap: wrap; justify-content: flex-end; }
    .cco-pl-btn { border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06); color: #fff; font-size: 11px; border-radius: 7px; padding: 3px 7px; cursor: pointer; }
    .cco-pl-btn.warn { border-color: rgba(245,158,11,.7); color: #fcd34d; }
    .cco-pl-btn.profile { border-color: rgba(59,130,246,.6); color: #bfdbfe; }
    .cco-pl-btn.alert { border-color: rgba(236,72,153,.6); color: #f9a8d4; }
    .cco-pl-body { padding: 10px 12px 12px; }
    .cco-pl-body.hidden { display:none; }
    .cco-pl-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .cco-pl-group { display: flex; gap: 6px; flex-wrap: wrap; }
    .cco-pill { border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.03); color: rgba(255,255,255,.92); font-size: 11px; border-radius: 999px; padding: 2px 8px; cursor: pointer; }
    .cco-pill.active { border-color: rgba(34,197,94,.8); background: rgba(34,197,94,.18); color: #d8ffe4; }
    .cco-pl-svg { width: 100%; height: 184px; display: block; background: linear-gradient(180deg, rgba(255,255,255,.03), transparent 65%); border: 1px solid rgba(255,255,255,.08); border-radius: 8px; }
    .cco-pl-info { margin-top: 8px; font-size: 11px; color: rgba(255,255,255,.78); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .cco-pl-stats { margin-top: 8px; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; }
    .cco-stat { border: 1px solid rgba(255,255,255,.09); border-radius: 7px; padding: 6px 8px; background: rgba(255,255,255,.03); min-height: 44px; }
    .cco-stat-k { font-size: 10px; opacity: .65; text-transform: uppercase; letter-spacing: .05em; }
    .cco-stat-v { font-size: 12px; font-weight: 700; margin-top: 2px; }
    .cco-stat-v.pos { color: #22c55e; } .cco-stat-v.neg { color: #ef4444; }
  `;
  document.head.appendChild(style);

  const parseNumber = (text) => {
    if (!text) return null;
    const cleaned = String(text).replace(/[^\d,.-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
  };

  const formatDuration = (ms) => {
    if (!Number.isFinite(ms) || ms < 0) return '--';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
  };

  const stdDev = (arr) => {
    if (!arr.length) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  };

  const movingAverage = (arr, period = 5) => arr.map((_, i) => {
    const start = Math.max(0, i - period + 1);
    const chunk = arr.slice(start, i + 1);
    return chunk.reduce((a, b) => a + b, 0) / chunk.length;
  });

  const requestNotification = async () => {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch {
      return false;
    }
  };

  const readValueBySelectors = (selectors, keywords) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const value = parseNumber(el?.textContent || '');
      if (value !== null) return value;
    }

    const candidates = Array.from(document.querySelectorAll('body *')).filter((el) => el.children.length === 0).slice(0, 2600);
    let best = null;
    for (const el of candidates) {
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 32 || !/[$€£]|\d/.test(txt)) continue;
      const parentText = (el.parentElement?.textContent || '').toLowerCase();
      const classText = (el.className || '').toString().toLowerCase();
      const idText = (el.id || '').toLowerCase();
      const score = keywords.reduce((acc, word) => acc + (parentText.includes(word) ? 2 : 0) + (classText.includes(word) ? 1 : 0) + (idText.includes(word) ? 1 : 0), 0);
      const value = parseNumber(txt);
      if (value === null || value < 0) continue;
      if (!best || score > best.score || (score === best.score && value > best.value)) best = { value, score };
    }
    return best ? best.value : null;
  };

  const trackers = [];

  const createTracker = (cfg) => {
    const panelKey = `cco_${cfg.id}_panel_state_v2`;
    const uiKey = `cco_${cfg.id}_ui_v2`;
    const alertKey = () => `cco_${cfg.id}_alerts_${activeProfile}`;

    const numberFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pctFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const signedUnit = (v) => `${v >= 0 ? '+' : '-'}${cfg.prefix}${numberFmt.format(Math.abs(v))}`;
    const plainUnit = (v) => `${cfg.prefix}${numberFmt.format(v)}`;

    const panel = document.createElement('div');
    panel.className = 'cco-pl-chart';
    panel.style.right = cfg.defaultPos.right;
    panel.style.bottom = cfg.defaultPos.bottom;

    panel.innerHTML = `
      <div class="cco-pl-head" id="${cfg.id}DragHandle">
        <div>
          <div class="cco-pl-title">${cfg.title}</div>
          <div class="cco-pl-meta" id="${cfg.id}Meta">Waiting for ${cfg.unitName}...</div>
        </div>
        <div class="cco-pl-actions">
          <button class="cco-pl-btn profile" id="${cfg.id}Profile">Acct: ${activeProfile.toUpperCase()}</button>
          <button class="cco-pl-btn alert" id="${cfg.id}Alerts">Alerts</button>
          <button class="cco-pl-btn" id="${cfg.id}Reminders">Reminders</button>
          <button class="cco-pl-btn" id="${cfg.id}Trend">Trend</button>
          <button class="cco-pl-btn" id="${cfg.id}Export">Export</button>
          <button class="cco-pl-btn warn" id="${cfg.id}Pause">Pause</button>
          <button class="cco-pl-btn" id="${cfg.id}Reset">Reset</button>
          <button class="cco-pl-btn" id="${cfg.id}Toggle">Hide</button>
        </div>
      </div>
      <div class="cco-pl-body" id="${cfg.id}Body">
        <div class="cco-pl-toolbar">
          <div class="cco-pl-group" id="${cfg.id}GraphTypeGroup">
            <button class="cco-pill active" data-graph="line">Line</button>
            <button class="cco-pill" data-graph="area">Area</button>
            <button class="cco-pill" data-graph="bars">Bars</button>
          </div>
          <div class="cco-pl-group" id="${cfg.id}SmoothGroup">
            <button class="cco-pill active" data-smooth="raw">Raw</button>
            <button class="cco-pill" data-smooth="ma5">MA(5)</button>
          </div>
          <div class="cco-pl-group" id="${cfg.id}TimeRangeGroup">
            <button class="cco-pill active" data-range="all">All</button>
            <button class="cco-pill" data-range="1m">1m</button>
            <button class="cco-pill" data-range="5m">5m</button>
            <button class="cco-pill" data-range="15m">15m</button>
            <button class="cco-pill" data-range="1h">1h</button>
          </div>
        </div>
        <svg class="cco-pl-svg" viewBox="0 0 1000 360" preserveAspectRatio="none">
          <line x1="0" y1="180" x2="1000" y2="180" stroke="rgba(255,255,255,.15)" stroke-width="1" />
          <path id="${cfg.id}Fill" d="" fill="rgba(34,197,94,.14)"></path>
          <path id="${cfg.id}Line" d="" fill="none" stroke="#22c55e" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"></path>
          <path id="${cfg.id}MaLine" d="" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="8 6" stroke-linejoin="round" stroke-linecap="round"></path>
          <g id="${cfg.id}Bars"></g>
        </svg>
        <div class="cco-pl-info">
          <span id="${cfg.id}Range">Range: --</span>
          <span id="${cfg.id}Current">Current: --</span>
          <span id="${cfg.id}Runtime">Runtime: --</span>
        </div>
        <div class="cco-pl-stats" id="${cfg.id}Stats"></div>
      </div>
    `;

    document.body.appendChild(panel);

    const nodes = {
      meta: panel.querySelector(`#${cfg.id}Meta`),
      body: panel.querySelector(`#${cfg.id}Body`),
      line: panel.querySelector(`#${cfg.id}Line`),
      maLine: panel.querySelector(`#${cfg.id}MaLine`),
      fill: panel.querySelector(`#${cfg.id}Fill`),
      bars: panel.querySelector(`#${cfg.id}Bars`),
      range: panel.querySelector(`#${cfg.id}Range`),
      current: panel.querySelector(`#${cfg.id}Current`),
      runtime: panel.querySelector(`#${cfg.id}Runtime`),
      stats: panel.querySelector(`#${cfg.id}Stats`),
      profile: panel.querySelector(`#${cfg.id}Profile`),
      pause: panel.querySelector(`#${cfg.id}Pause`)
    };

    let graphType = 'line';
    let smoothType = 'raw';
    let rangeType = 'all';
    let paused = false;
    let history = [];
    let startValue = null;
    let panelState = { left: null, top: null };
    let lastHeartbeatAt = 0;
    let alertConfig = { tp: null, sl: null, tpHit: false, slHit: false, reminderEnabled: false, reminderMinutes: 10, lastReminderAt: 0, trendEnabled: true, trendLossStreak: 6, trendWindowSize: 12, trendWindowLossRate: 0.75, trendCooldownMinutes: 15, lastTrendAlertAt: 0 };

    const getHistoryKey = () => `cco_${cfg.id}_history_${activeProfile}`;
    const getStartKey = () => `cco_${cfg.id}_start_${activeProfile}`;

    const setActivePills = (container, key, value) => {
      container.querySelectorAll('button').forEach((btn) => btn.classList.toggle('active', btn.dataset[key] === value));
    };

    const loadState = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(getHistoryKey()) || '[]');
        history = Array.isArray(saved) ? saved.filter((p) => typeof p?.t === 'number' && typeof p?.v === 'number') : [];
        const st = Number.parseFloat(localStorage.getItem(getStartKey()) || '');
        startValue = Number.isFinite(st) ? st : null;
        const p = JSON.parse(localStorage.getItem(panelKey) || '{}');
        if (Number.isFinite(p?.left) && Number.isFinite(p?.top)) panelState = p;

        const ui = JSON.parse(localStorage.getItem(uiKey) || '{}');
        if (['line', 'area', 'bars'].includes(ui?.graphType)) graphType = ui.graphType;
        if (['raw', 'ma5'].includes(ui?.smoothType)) smoothType = ui.smoothType;
        if (Object.keys(TIME_WINDOWS).includes(ui?.rangeType)) rangeType = ui.rangeType;

        const alerts = JSON.parse(localStorage.getItem(alertKey()) || '{}');
        alertConfig = {
          tp: Number.isFinite(alerts?.tp) ? alerts.tp : null,
          sl: Number.isFinite(alerts?.sl) ? alerts.sl : null,
          tpHit: Boolean(alerts?.tpHit),
          slHit: Boolean(alerts?.slHit),
          reminderEnabled: Boolean(alerts?.reminderEnabled),
          reminderMinutes: Number.isFinite(alerts?.reminderMinutes) && alerts.reminderMinutes > 0 ? alerts.reminderMinutes : 10,
          lastReminderAt: Number.isFinite(alerts?.lastReminderAt) ? alerts.lastReminderAt : 0,
          trendEnabled: alerts?.trendEnabled !== false,
          trendLossStreak: Number.isFinite(alerts?.trendLossStreak) && alerts.trendLossStreak > 1 ? Math.floor(alerts.trendLossStreak) : 6,
          trendWindowSize: Number.isFinite(alerts?.trendWindowSize) && alerts.trendWindowSize > 2 ? Math.floor(alerts.trendWindowSize) : 12,
          trendWindowLossRate: Number.isFinite(alerts?.trendWindowLossRate) && alerts.trendWindowLossRate > 0 && alerts.trendWindowLossRate <= 1 ? alerts.trendWindowLossRate : 0.75,
          trendCooldownMinutes: Number.isFinite(alerts?.trendCooldownMinutes) && alerts.trendCooldownMinutes > 0 ? alerts.trendCooldownMinutes : 15,
          lastTrendAlertAt: Number.isFinite(alerts?.lastTrendAlertAt) ? alerts.lastTrendAlertAt : 0
        };
      } catch {
        history = [];
        startValue = null;
      }

      if (panelState.left !== null && panelState.top !== null) {
        panel.style.left = `${panelState.left}px`;
        panel.style.top = `${panelState.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }

      setActivePills(panel.querySelector(`#${cfg.id}GraphTypeGroup`), 'graph', graphType);
      setActivePills(panel.querySelector(`#${cfg.id}SmoothGroup`), 'smooth', smoothType);
      setActivePills(panel.querySelector(`#${cfg.id}TimeRangeGroup`), 'range', rangeType);

      nodes.profile.textContent = `Acct: ${activeProfile.toUpperCase()}`;
      drawChart();
    };

    const saveState = () => {
      localStorage.setItem(getHistoryKey(), JSON.stringify(history.slice(-MAX_POINTS)));
      if (startValue !== null) localStorage.setItem(getStartKey(), String(startValue));
      if (Number.isFinite(panelState.left) && Number.isFinite(panelState.top)) localStorage.setItem(panelKey, JSON.stringify(panelState));
      localStorage.setItem(uiKey, JSON.stringify({ graphType, smoothType, rangeType }));
      localStorage.setItem(alertKey(), JSON.stringify(alertConfig));
    };

    const getVisibleHistory = () => {
      if (!history.length) return [];
      const windowMs = TIME_WINDOWS[rangeType] ?? 0;
      if (!windowMs) return history;
      const cutoff = Date.now() - windowMs;
      const filtered = history.filter((p) => p.t >= cutoff);
      return filtered.length >= 2 ? filtered : history.slice(-2);
    };

    const maybeTriggerAlerts = async (pl) => {
      if (alertConfig.tp !== null && !alertConfig.tpHit && pl >= alertConfig.tp) {
        alertConfig.tpHit = true;
        saveState();
        if (await requestNotification()) new Notification(`${cfg.unitName} TP hit (${activeProfile.toUpperCase()})`, { body: `P/L reached ${signedUnit(pl)}` });
      }
      if (alertConfig.sl !== null && !alertConfig.slHit && pl <= -Math.abs(alertConfig.sl)) {
        alertConfig.slHit = true;
        saveState();
        if (await requestNotification()) new Notification(`${cfg.unitName} SL hit (${activeProfile.toUpperCase()})`, { body: `P/L reached ${signedUnit(pl)}` });
      }
    };

    const maybeTriggerReminder = async (pl) => {
      if (!alertConfig.reminderEnabled) return;
      const now = Date.now();
      const waitMs = Math.max(1, alertConfig.reminderMinutes) * 60_000;
      if (now - alertConfig.lastReminderAt < waitMs) return;
      alertConfig.lastReminderAt = now;
      saveState();
      if (await requestNotification()) {
        new Notification(`${cfg.unitName} reminder (${activeProfile.toUpperCase()})`, {
          body: `Current P/L: ${signedUnit(pl)}`
        });
      }
    };

    const maybeTriggerTrendAlert = async (points, pl) => {
      if (!alertConfig.trendEnabled) return;
      if (points.length < 4) return;

      const now = Date.now();
      const cooldownMs = Math.max(1, alertConfig.trendCooldownMinutes) * 60_000;
      if (now - alertConfig.lastTrendAlertAt < cooldownMs) return;

      let currentLossStreak = 0;
      for (let i = points.length - 1; i > 0; i -= 1) {
        const d = points[i].v - points[i - 1].v;
        if (d < 0) currentLossStreak += 1;
        else break;
      }

      const windowSize = Math.min(alertConfig.trendWindowSize, points.length - 1);
      let windowLosses = 0;
      for (let i = points.length - windowSize; i < points.length; i += 1) {
        const d = points[i].v - points[i - 1].v;
        if (d < 0) windowLosses += 1;
      }
      const lossRate = windowSize > 0 ? windowLosses / windowSize : 0;

      const triggerByStreak = currentLossStreak >= alertConfig.trendLossStreak;
      const triggerByWindow = windowSize >= 4 && lossRate >= alertConfig.trendWindowLossRate;

      if (!triggerByStreak && !triggerByWindow) return;

      alertConfig.lastTrendAlertAt = now;
      saveState();

      const reason = triggerByStreak
        ? `${currentLossStreak} consecutive losing ticks`
        : `${Math.round(lossRate * 100)}% losses over last ${windowSize} ticks`;

      if (await requestNotification()) {
        new Notification(`${cfg.unitName} trend warning (${activeProfile.toUpperCase()})`, {
          body: `${reason}. Current P/L ${signedUnit(pl)}. Consider pausing/switching.`
        });
      }
    };

    const drawChart = () => {
      const points = getVisibleHistory();
      if (points.length < 2 || startValue === null) {
        nodes.line.setAttribute('d', '');
        nodes.maLine.setAttribute('d', '');
        nodes.fill.setAttribute('d', '');
        nodes.bars.innerHTML = '';
        nodes.range.textContent = 'Range: --';
        nodes.current.textContent = 'Current: --';
        nodes.runtime.textContent = 'Runtime: --';
        nodes.stats.innerHTML = '';
        return;
      }

      const rawValues = points.map((p) => p.v - startValue);
      const values = smoothType === 'ma5' ? movingAverage(rawValues, 5) : rawValues;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const current = values.at(-1);
      const pad = Math.max((max - min) * 0.15, 1);
      const floor = min - pad;
      const ceil = max + pad;

      const width = 1000;
      const height = 360;
      const toX = (i) => (i / (values.length - 1 || 1)) * width;
      const toY = (v) => height - ((v - floor) / (ceil - floor || 1)) * height;
      const zeroY = toY(0);

      const rawPath = rawValues.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(2)} ${toY(v).toFixed(2)}`).join(' ');
      const pointsPath = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(2)} ${toY(v).toFixed(2)}`).join(' ');
      const fillPath = `${pointsPath} L ${width} ${zeroY.toFixed(2)} L 0 ${zeroY.toFixed(2)} Z`;

      const positive = current >= 0;
      const color = positive ? '#22c55e' : '#ef4444';
      nodes.line.setAttribute('stroke', color);
      nodes.fill.setAttribute('fill', positive ? 'rgba(34,197,94,.14)' : 'rgba(239,68,68,.14)');
      nodes.line.setAttribute('d', graphType === 'bars' ? '' : pointsPath);
      nodes.fill.setAttribute('d', graphType === 'area' ? fillPath : '');
      nodes.maLine.setAttribute('d', smoothType === 'raw' ? movingAverage(rawValues, 5).map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(2)} ${toY(v).toFixed(2)}`).join(' ') : rawPath);
      nodes.maLine.style.display = graphType === 'bars' ? 'none' : '';

      if (graphType === 'bars') {
        const barWidth = Math.max(1, Math.floor(width / values.length) - 1);
        nodes.bars.innerHTML = values.map((v, i) => {
          const x = toX(i) - barWidth / 2;
          const y = toY(v);
          const top = Math.min(y, zeroY);
          const h = Math.max(1, Math.abs(zeroY - y));
          const c = v >= 0 ? 'rgba(34,197,94,.65)' : 'rgba(239,68,68,.65)';
          return `<rect x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth}" height="${h.toFixed(2)}" fill="${c}"/>`;
        }).join('');
      } else {
        nodes.bars.innerHTML = '';
      }

      const elapsedMs = points.at(-1).t - points[0].t;
      const deltas = [];
      let wins = 0;
      let losses = 0;
      let totalWinAmount = 0;
      let totalLossAmountAbs = 0;
      let turnover = 0;
      let peak = values[0];
      let maxDrawdown = 0;
      for (let i = 1; i < points.length; i += 1) {
        const d = points[i].v - points[i - 1].v;
        deltas.push(d);
        turnover += Math.abs(d);
        if (d > 0) {
          wins += 1;
          totalWinAmount += d;
        }
        if (d < 0) {
          losses += 1;
          totalLossAmountAbs += Math.abs(d);
        }
        peak = Math.max(peak, values[i]);
        maxDrawdown = Math.max(maxDrawdown, peak - values[i]);
      }

      const roi = startValue > 0 ? (current / startValue) * 100 : 0;
      const plPerHour = elapsedMs > 0 ? (current / elapsedMs) * 3_600_000 : 0;
      const vol = stdDev(deltas);
      const flatForMs = Date.now() - points.at(-1).t;
      const avgSpend = losses > 0 ? totalLossAmountAbs / losses : 0;
      const avgWin = wins > 0 ? totalWinAmount / wins : 0;
      const profitFactor = totalLossAmountAbs > 0 ? totalWinAmount / totalLossAmountAbs : null;

      const alertBadge = `TP: ${alertConfig.tp === null ? '--' : signedUnit(alertConfig.tp)} | SL: ${alertConfig.sl === null ? '--' : '-' + cfg.prefix + numberFmt.format(Math.abs(alertConfig.sl))}`;
      const reminderBadge = alertConfig.reminderEnabled ? `Every ${alertConfig.reminderMinutes}m` : 'Off';
      const trendBadge = alertConfig.trendEnabled ? `Streak ${alertConfig.trendLossStreak} / ${Math.round(alertConfig.trendWindowLossRate * 100)}% of ${alertConfig.trendWindowSize}` : 'Off';
      const statusPrefix = paused ? 'Paused • ' : '';
      nodes.meta.className = `cco-pl-meta ${positive ? 'pos' : 'neg'}`;
      nodes.meta.textContent = `${statusPrefix}P/L ${signedUnit(current)}`;
      nodes.range.textContent = `Range: ${signedUnit(min)} → ${signedUnit(max)}`;
      nodes.current.textContent = `Current ${cfg.unitName}: ${plainUnit(points.at(-1).v)}`;
      nodes.runtime.textContent = `Runtime: ${formatDuration(elapsedMs)}`;

      nodes.stats.innerHTML = [
        ['Profile', activeProfile.toUpperCase(), ''],
        ['Start', plainUnit(startValue), ''],
        ['Current P/L', signedUnit(current), positive ? 'pos' : 'neg'],
        ['ROI', `${roi >= 0 ? '+' : ''}${pctFmt.format(roi)}%`, roi >= 0 ? 'pos' : 'neg'],
        ['P/L Per Hour', signedUnit(plPerHour), plPerHour >= 0 ? 'pos' : 'neg'],
        ['Up/Down Ticks', `${wins}/${losses}`, ''],
        ['Avg Spend / Loss Tick', plainUnit(avgSpend), ''],
        ['Avg Win / Win Tick', plainUnit(avgWin), ''],
        ['Profit Factor', profitFactor === null ? '∞' : numberFmt.format(profitFactor), profitFactor === null || profitFactor >= 1 ? 'pos' : 'neg'],
        ['Turnover', plainUnit(turnover), ''],
        ['Volatility', `${cfg.prefix}${numberFmt.format(vol)}`, ''],
        ['Max Drawdown', signedUnit(-maxDrawdown), maxDrawdown > 0 ? 'neg' : ''],
        ['Samples', String(points.length), ''],
        ['Last Change Age', formatDuration(flatForMs), ''],
        ['Alerts', alertBadge, ''],
        ['Reminder', reminderBadge, ''],
        ['Trend Alert', trendBadge, ''],
        ['Updated', new Date(points.at(-1).t).toLocaleTimeString(), '']
      ].map(([k, v, cls]) => `<div class="cco-stat"><div class="cco-stat-k">${k}</div><div class="cco-stat-v ${cls}">${v}</div></div>`).join('');

      maybeTriggerAlerts(current);
      maybeTriggerReminder(current);
      maybeTriggerTrendAlert(points, current);
    };

    const sample = () => {
      if (paused) return;
      const value = readValueBySelectors(cfg.selectors, cfg.scanKeywords);
      if (value === null) return;
      if (startValue === null) startValue = value;
      const now = Date.now();
      const last = history.at(-1);
      const changed = !last || Math.abs(last.v - value) > 0.0001;
      const heartbeatDue = !last || now - lastHeartbeatAt >= HEARTBEAT_MS;
      if (changed || heartbeatDue) {
        history.push({ t: now, v: value });
        if (history.length > MAX_POINTS) history = history.slice(-MAX_POINTS);
        if (heartbeatDue) lastHeartbeatAt = now;
        saveState();
        drawChart();
      }
    };

    panel.querySelector(`#${cfg.id}GraphTypeGroup`).addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-graph]');
      if (!btn) return;
      graphType = btn.dataset.graph;
      setActivePills(panel.querySelector(`#${cfg.id}GraphTypeGroup`), 'graph', graphType);
      saveState();
      drawChart();
    });

    panel.querySelector(`#${cfg.id}SmoothGroup`).addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-smooth]');
      if (!btn) return;
      smoothType = btn.dataset.smooth;
      setActivePills(panel.querySelector(`#${cfg.id}SmoothGroup`), 'smooth', smoothType);
      saveState();
      drawChart();
    });

    panel.querySelector(`#${cfg.id}TimeRangeGroup`).addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-range]');
      if (!btn) return;
      rangeType = btn.dataset.range;
      setActivePills(panel.querySelector(`#${cfg.id}TimeRangeGroup`), 'range', rangeType);
      saveState();
      drawChart();
    });

    panel.querySelector(`#${cfg.id}Alerts`).addEventListener('click', () => {
      const tpIn = window.prompt(`Set TAKE-PROFIT P/L for ${cfg.unitName} (${activeProfile.toUpperCase()}).\nUse number only, blank to disable.`, alertConfig.tp ?? '');
      const slIn = window.prompt(`Set STOP-LOSS P/L for ${cfg.unitName} (${activeProfile.toUpperCase()}).\nUse positive number only, blank to disable.`, alertConfig.sl ?? '');
      const tp = tpIn === null || tpIn.trim() === '' ? null : Number.parseFloat(tpIn);
      const sl = slIn === null || slIn.trim() === '' ? null : Math.abs(Number.parseFloat(slIn));
      alertConfig.tp = Number.isFinite(tp) ? tp : null;
      alertConfig.sl = Number.isFinite(sl) ? sl : null;
      alertConfig.tpHit = false;
      alertConfig.slHit = false;
      saveState();
      drawChart();
    });



    panel.querySelector(`#${cfg.id}Reminders`).addEventListener('click', () => {
      const enabledInput = window.prompt(`Enable reminder notifications for ${cfg.unitName} (${activeProfile.toUpperCase()})? Type yes/no.`, alertConfig.reminderEnabled ? 'yes' : 'no');
      if (enabledInput === null) return;
      const minInput = window.prompt(`Reminder cadence in minutes for ${cfg.unitName}.`, String(alertConfig.reminderMinutes ?? 10));
      if (minInput === null) return;
      const enabled = enabledInput.trim().toLowerCase();
      const minutes = Number.parseFloat(minInput);
      alertConfig.reminderEnabled = enabled === 'yes' || enabled === 'y' || enabled === 'true' || enabled === 'on';
      alertConfig.reminderMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
      alertConfig.lastReminderAt = 0;
      saveState();
      drawChart();
    });

    

    panel.querySelector(`#${cfg.id}Trend`).addEventListener('click', () => {
      const enabledInput = window.prompt(`Enable losing-trend warning for ${cfg.unitName} (${activeProfile.toUpperCase()})? Type yes/no.`, alertConfig.trendEnabled ? 'yes' : 'no');
      if (enabledInput === null) return;
      const streakInput = window.prompt('Consecutive losing ticks to trigger warning:', String(alertConfig.trendLossStreak));
      if (streakInput === null) return;
      const windowSizeInput = window.prompt('Window size (ticks) for loss-rate warning:', String(alertConfig.trendWindowSize));
      if (windowSizeInput === null) return;
      const windowLossPctInput = window.prompt('Loss-rate threshold in % for window warning (e.g., 75):', String(Math.round(alertConfig.trendWindowLossRate * 100)));
      if (windowLossPctInput === null) return;
      const cooldownInput = window.prompt('Cooldown between trend warnings (minutes):', String(alertConfig.trendCooldownMinutes));
      if (cooldownInput === null) return;

      const enabled = enabledInput.trim().toLowerCase();
      const streak = Number.parseInt(streakInput, 10);
      const winSize = Number.parseInt(windowSizeInput, 10);
      const lossPct = Number.parseFloat(windowLossPctInput);
      const cooldown = Number.parseFloat(cooldownInput);

      alertConfig.trendEnabled = enabled === 'yes' || enabled === 'y' || enabled === 'true' || enabled === 'on';
      alertConfig.trendLossStreak = Number.isFinite(streak) && streak > 1 ? streak : 6;
      alertConfig.trendWindowSize = Number.isFinite(winSize) && winSize > 2 ? winSize : 12;
      alertConfig.trendWindowLossRate = Number.isFinite(lossPct) && lossPct > 0 && lossPct <= 100 ? lossPct / 100 : 0.75;
      alertConfig.trendCooldownMinutes = Number.isFinite(cooldown) && cooldown > 0 ? cooldown : 15;
      alertConfig.lastTrendAlertAt = 0;
      saveState();
      drawChart();
    });

    panel.querySelector(`#${cfg.id}Toggle`).addEventListener('click', () => {
      const hidden = nodes.body.classList.toggle('hidden');
      panel.querySelector(`#${cfg.id}Toggle`).textContent = hidden ? 'Show' : 'Hide';
    });

    nodes.pause.addEventListener('click', () => {
      paused = !paused;
      nodes.pause.textContent = paused ? 'Resume' : 'Pause';
      nodes.pause.classList.toggle('warn', !paused);
      drawChart();
    });

    panel.querySelector(`#${cfg.id}Reset`).addEventListener('click', () => {
      if (!window.confirm(`Reset ${cfg.unitName} history for ${activeProfile.toUpperCase()}?`)) return;
      history = [];
      startValue = null;
      alertConfig.tpHit = false;
      alertConfig.slHit = false;
      localStorage.removeItem(getHistoryKey());
      localStorage.removeItem(getStartKey());
      saveState();
      drawChart();
      nodes.meta.textContent = `Waiting for ${cfg.unitName}...`;
      nodes.meta.className = 'cco-pl-meta';
    });

    panel.querySelector(`#${cfg.id}Export`).addEventListener('click', () => {
      if (!history.length) return;
      const rows = [`timestamp,${cfg.unitName.toLowerCase()},pl_from_start,profile`];
      for (const point of history) {
        const pl = startValue === null ? '' : (point.v - startValue).toFixed(2);
        rows.push(`${new Date(point.t).toISOString()},${point.v.toFixed(2)},${pl},${activeProfile}`);
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `case-clicker-${cfg.id}-${activeProfile}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    nodes.profile.addEventListener('click', () => {
      const idx = PROFILES.indexOf(activeProfile);
      activeProfile = PROFILES[(idx + 1) % PROFILES.length];
      localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfile);
      trackers.forEach((t) => t.reloadForProfile());
    });

    const dragHandle = panel.querySelector(`#${cfg.id}DragHandle`);
    let drag = null;
    dragHandle.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, event.clientX - drag.offsetX));
      const top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, event.clientY - drag.offsetY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panelState = { left, top };
    });

    window.addEventListener('mouseup', () => {
      drag = null;
      saveState();
    });

    loadState();

    return {
      sample,
      reloadForProfile: loadState,
      teardown: () => saveState()
    };
  };

  trackers.push(createTracker({
    id: 'ccoMoney', title: 'Case Clicker • Money Live Stats', unitName: 'Money', prefix: '$',
    selectors: MONEY_SELECTORS, scanKeywords: ['balance', 'wallet', 'money', 'cash'], defaultPos: { right: '16px', bottom: '16px' }
  }));

  trackers.push(createTracker({
    id: 'ccoToken', title: 'Case Clicker • Token Live Stats', unitName: 'Tokens', prefix: '🪙 ',
    selectors: TOKEN_SELECTORS, scanKeywords: ['token', 'tokens', 'coin', 'coins'], defaultPos: { right: '16px', bottom: '430px' }
  }));

  const interval = window.setInterval(() => trackers.forEach((t) => t.sample()), SAMPLE_MS);
  const observer = new MutationObserver(() => trackers.forEach((t) => t.sample()));
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  window.addEventListener('beforeunload', () => {
    window.clearInterval(interval);
    observer.disconnect();
    trackers.forEach((t) => t.teardown());
  });
})();
