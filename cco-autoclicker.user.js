// ==UserScript==
// @name         CCO Offline Auto Clicker + Earnings Stats
// @namespace    https://local/cco
// @version      1.0.0
// @description  Auto-click helper for offline Case Clicker Online with live earnings stats.
// @author       You
// @match        *://*/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /**
   * Update these selectors for your game page.
   * If the defaults do not work, open DevTools and set the selector values below.
   */
  const CONFIG = {
    clickTargetSelector: '', // Example: '#open-case-btn'
    moneySelector: '', // Example: '.hud .money'
    clicksPerSecond: 12,
    currencyPrefix: '$',
    panelTopPx: 16,
    panelRightPx: 16,
    startKey: 'F8'
  };

  const state = {
    running: false,
    clickTimer: null,
    startedAt: null,
    totalClicks: 0,
    baselineMoney: null,
    latestMoney: null,
    clickTarget: null,
    moneyNode: null
  };

  const ui = createPanel();
  bindControls(ui);
  discoverTargets();
  updateStatus('Ready');
  renderStats();

  const observer = new MutationObserver(() => {
    if (!state.clickTarget || !document.contains(state.clickTarget)) {
      state.clickTarget = findClickTarget();
    }
    if (!state.moneyNode || !document.contains(state.moneyNode)) {
      state.moneyNode = findMoneyNode();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === CONFIG.startKey) {
      toggle();
    }
  });

  function bindControls(panel) {
    panel.toggleButton.addEventListener('click', toggle);
    panel.rescanButton.addEventListener('click', () => {
      discoverTargets(true);
    });
  }

  function createPanel() {
    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.top = `${CONFIG.panelTopPx}px`;
    root.style.right = `${CONFIG.panelRightPx}px`;
    root.style.width = '290px';
    root.style.zIndex = '999999';
    root.style.background = 'rgba(10, 12, 16, 0.9)';
    root.style.color = '#fff';
    root.style.padding = '12px';
    root.style.borderRadius = '10px';
    root.style.border = '1px solid rgba(255,255,255,0.15)';
    root.style.fontFamily = 'system-ui, sans-serif';
    root.style.backdropFilter = 'blur(4px)';

    const title = document.createElement('div');
    title.textContent = 'CCO Auto Clicker (Offline)';
    title.style.fontWeight = '700';
    title.style.marginBottom = '10px';

    const status = document.createElement('div');
    status.style.marginBottom = '8px';

    const stats = document.createElement('pre');
    stats.style.margin = '8px 0';
    stats.style.padding = '8px';
    stats.style.background = 'rgba(255,255,255,0.08)';
    stats.style.borderRadius = '8px';
    stats.style.fontSize = '12px';
    stats.style.lineHeight = '1.45';
    stats.style.whiteSpace = 'pre-wrap';

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '8px';

    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Start';
    stylizeButton(toggleButton, '#1d7f3d');

    const rescanButton = document.createElement('button');
    rescanButton.textContent = 'Rescan';
    stylizeButton(rescanButton, '#2a5ea8');

    const hint = document.createElement('div');
    hint.textContent = `Hotkey: ${CONFIG.startKey}`;
    hint.style.opacity = '0.8';
    hint.style.marginTop = '8px';
    hint.style.fontSize = '12px';

    buttonRow.append(toggleButton, rescanButton);
    root.append(title, status, stats, buttonRow, hint);
    document.body.append(root);

    return { root, status, stats, toggleButton, rescanButton };
  }

  function stylizeButton(button, color) {
    button.style.flex = '1';
    button.style.background = color;
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.padding = '8px 10px';
    button.style.borderRadius = '7px';
    button.style.cursor = 'pointer';
    button.style.fontWeight = '700';
  }

  function discoverTargets(showToast = false) {
    state.clickTarget = findClickTarget();
    state.moneyNode = findMoneyNode();
    if (showToast) {
      updateStatus(`Rescan complete (${state.clickTarget ? 'click ✅' : 'click ❌'}, ${state.moneyNode ? 'money ✅' : 'money ❌'})`);
    }
  }

  function findClickTarget() {
    if (CONFIG.clickTargetSelector) {
      const selected = document.querySelector(CONFIG.clickTargetSelector);
      if (selected) return selected;
    }

    const textMatch = /(open|case|click|roll|spin|loot)/i;
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], .btn, .button'));
    return candidates.find((el) => {
      const text = (el.textContent || '').trim();
      const style = window.getComputedStyle(el);
      return textMatch.test(text) && style.display !== 'none' && style.visibility !== 'hidden';
    }) || null;
  }

  function findMoneyNode() {
    if (CONFIG.moneySelector) {
      const selected = document.querySelector(CONFIG.moneySelector);
      if (selected) return selected;
    }

    const selectors = ['.money', '.cash', '#money', '#cash', '[data-money]', '[class*="coin"]', '[class*="balance"]'];
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function toggle() {
    if (state.running) {
      stop();
    } else {
      start();
    }
  }

  function start() {
    discoverTargets();

    if (!state.clickTarget) {
      updateStatus('No click target found. Set CONFIG.clickTargetSelector.');
      return;
    }

    if (!state.moneyNode) {
      updateStatus('No money element found. Stats may be limited.');
    }

    state.running = true;
    state.startedAt = Date.now();
    state.totalClicks = 0;
    state.baselineMoney = readMoneyValue();
    state.latestMoney = state.baselineMoney;

    const intervalMs = Math.max(8, Math.floor(1000 / CONFIG.clicksPerSecond));
    state.clickTimer = window.setInterval(() => {
      if (!state.clickTarget || !document.contains(state.clickTarget)) {
        state.clickTarget = findClickTarget();
      }
      if (!state.clickTarget) return;

      state.clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      state.totalClicks += 1;
      state.latestMoney = readMoneyValue();
      renderStats();
    }, intervalMs);

    ui.toggleButton.textContent = 'Stop';
    ui.toggleButton.style.background = '#8c2f2f';
    updateStatus(`Running at ${CONFIG.clicksPerSecond} clicks/sec`);
  }

  function stop() {
    state.running = false;
    if (state.clickTimer) {
      clearInterval(state.clickTimer);
      state.clickTimer = null;
    }
    ui.toggleButton.textContent = 'Start';
    ui.toggleButton.style.background = '#1d7f3d';
    updateStatus('Stopped');
    renderStats();
  }

  function readMoneyValue() {
    if (!state.moneyNode) return null;
    const raw = state.moneyNode.textContent || '';
    const cleaned = raw.replace(/,/g, '');
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function renderStats() {
    const now = Date.now();
    const elapsedSec = state.startedAt ? Math.max(0, (now - state.startedAt) / 1000) : 0;
    const currentMoney = state.latestMoney ?? readMoneyValue();
    const earned = currentMoney != null && state.baselineMoney != null ? currentMoney - state.baselineMoney : null;
    const perSecond = earned != null && elapsedSec > 0 ? earned / elapsedSec : null;
    const perMinute = perSecond != null ? perSecond * 60 : null;
    const perHour = perSecond != null ? perSecond * 3600 : null;

    const lines = [
      `State: ${state.running ? 'RUNNING' : 'IDLE'}`,
      `Time: ${formatDuration(elapsedSec)}`,
      `Clicks: ${state.totalClicks}`,
      `Total earned: ${formatMoney(earned)}`,
      `Per second: ${formatMoney(perSecond)}`,
      `Per minute: ${formatMoney(perMinute)}`,
      `Per hour: ${formatMoney(perHour)}`
    ];

    ui.stats.textContent = lines.join('\n');
  }

  function updateStatus(message) {
    ui.status.textContent = `Status: ${message}`;
  }

  function formatDuration(seconds) {
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatMoney(value) {
    if (value == null || Number.isNaN(value)) return 'n/a';
    const rounded = Math.abs(value) >= 1000 ? value.toFixed(2) : value.toFixed(3);
    return `${CONFIG.currencyPrefix}${Number(rounded).toLocaleString()}`;
  }
})();
