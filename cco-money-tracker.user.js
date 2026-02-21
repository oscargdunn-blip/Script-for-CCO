// ==UserScript==
// @name         Case Clicker Online Money Tracker
// @namespace    https://caseclicker.online/
// @version      1.7.0
// @description  Tracks spending/earnings, ROI, skin trades, token changes, and robust multi-account exports for Case Clicker Online.
// @match        *://caseclicker.online/*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const SETTINGS = {
    moneySelector: "#money, .money, [data-testid='money']",
    tokenSelector: "#tokens, .tokens, [data-testid='tokens']",
    accountSelector: "[data-testid='username'], .username, .profile-name, .user-name",
    pollMs: 250,
    recentClickWindowMs: 10000,
    maxEventsPerAccount: 5000,
    minDeltaToRecord: 0.01,
    storageKey: "cco_money_tracker_db_v2",
    caseKeywords: ["case", "open", "crate", "box"],
    buyKeywords: ["buy", "purchase"],
    sellKeywords: ["sell", "sold"],
    itemKeywords: ["item", "skin", "inventory"],
    tradeKeywords: ["trade", "traded", "swap", "exchange"],
    defaultSummaryHours: 24,
    debug: false,
  };

  const state = {
    previousMoney: null,
    previousTokens: null,
    accountId: "unknown_account",
    db: loadDb(),
    latestClickContext: null,
    observerStarted: false,
    pollIntervalId: null,
    paused: false,
  };

  function debugLog(...args) {
    if (SETTINGS.debug) console.log("[CCO Tracker]", ...args);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function parseMoney(raw) {
    if (!raw) return null;
    const text = String(raw).trim().toLowerCase();
    const match = text.match(/(-?[0-9,.]+)\s*([kmbt])?/i);
    if (!match) return null;

    const base = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) return null;

    const multiplierMap = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
    const suffix = (match[2] || "").toLowerCase();
    const multiplier = multiplierMap[suffix] || 1;
    const value = base * multiplier;
    return Number.isFinite(value) ? value : null;
  }

  function readMoneyFromDom() {
    const node = document.querySelector(SETTINGS.moneySelector);
    if (!node) return null;
    return parseMoney(node.textContent);
  }

  function readTokensFromDom() {
    const node = document.querySelector(SETTINGS.tokenSelector);
    if (!node) return null;
    return parseMoney(node.textContent);
  }

  function sanitizeAccountId(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_.-]/g, "")
      .slice(0, 64);
  }

  function detectAccountId() {
    const fromDom = document.querySelector(SETTINGS.accountSelector)?.textContent;
    const normalized = sanitizeAccountId(fromDom);
    if (normalized) return normalized;
    return state.db.activeAccountId || "unknown_account";
  }

  function loadDb() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS.storageKey) || "{}");
      const hasAccounts = parsed && typeof parsed === "object" && parsed.accounts && typeof parsed.accounts === "object";
      if (hasAccounts) {
        return {
          activeAccountId: parsed.activeAccountId || "unknown_account",
          accounts: parsed.accounts,
          meta: parsed.meta || {},
        };
      }

      const legacyEvents = Array.isArray(parsed) ? parsed : [];
      return {
        activeAccountId: "unknown_account",
        accounts: {
          unknown_account: legacyEvents,
        },
        meta: {},
      };
    } catch {
      return { activeAccountId: "unknown_account", accounts: { unknown_account: [] }, meta: {} };
    }
  }

  function saveDb() {
    localStorage.setItem(SETTINGS.storageKey, JSON.stringify(state.db));
  }

  function refreshActiveAccountTimestamp() {
    if (!state.db.meta) state.db.meta = {};
    state.db.meta.lastUpdatedAt = nowIso();
    state.db.meta.lastActiveAccountId = state.accountId;
  }

  function totalEventsCount() {
    return Object.values(state.db.accounts).reduce((sum, events) => sum + events.length, 0);
  }
  function nextEventId() {
    if (!state.db.meta) state.db.meta = {};
    state.db.meta.nextEventId = (Number(state.db.meta.nextEventId) || 1) + 1;
    return state.db.meta.nextEventId;
  }

  function sanitizeEvent(event) {
    if (!event || typeof event !== "object") return null;
    return {
      id: Number(event.id) || nextEventId(),
      at: event.at || nowIso(),
      accountId: sanitizeAccountId(event.accountId || state.accountId) || state.accountId,
      type: event.type || "unknown",
      action: event.action || "other",
      reason: event.reason || "unknown_reason",
      previous_money: Number(event.previous_money ?? event.previous ?? 0),
      current_money: Number(event.current_money ?? event.current ?? 0),
      money_delta: Number(event.money_delta ?? event.delta ?? 0),
      previous_tokens: Number(event.previous_tokens ?? 0),
      current_tokens: Number(event.current_tokens ?? 0),
      token_delta: Number(event.token_delta ?? 0),
      source: event.source || "poll",
      session_id: event.session_id || state.db.meta?.sessionId || "session_unknown",
    };
  }

  function ensureAccountBucket(accountId) {
    if (!state.db.accounts[accountId]) {
      state.db.accounts[accountId] = [];
    }
  }

  function currentEvents() {
    ensureAccountBucket(state.accountId);
    return state.db.accounts[state.accountId];
  }

  function pruneEvents(accountId) {
    const events = state.db.accounts[accountId] || [];
    if (events.length > SETTINGS.maxEventsPerAccount) {
      state.db.accounts[accountId] = events.slice(-SETTINGS.maxEventsPerAccount);
    }
  }

  function normalizeLabel(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function includesAny(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
  }

  function readClickContext(target) {
    if (!(target instanceof Element)) return null;

    const interesting = target.closest("button, [role='button'], a, .case, .item, .shop-item, .upgrade");
    if (!interesting) return null;

    const label = normalizeLabel(
      interesting.getAttribute("aria-label") ||
        interesting.getAttribute("title") ||
        interesting.textContent
    );

    if (!label) return null;

    return {
      at: Date.now(),
      label,
    };
  }

  function classifyAction(lowerReason, moneyDelta, tokenDelta) {
    const hasCase = includesAny(lowerReason, SETTINGS.caseKeywords);
    const hasBuy = includesAny(lowerReason, SETTINGS.buyKeywords);
    const hasSell = includesAny(lowerReason, SETTINGS.sellKeywords);
    const hasItem = includesAny(lowerReason, SETTINGS.itemKeywords);
    const hasTrade = includesAny(lowerReason, SETTINGS.tradeKeywords);

    if (hasTrade && hasItem) return "trade_skin";
    if (moneyDelta < 0 && hasBuy && hasCase) return "buy_case";
    if (moneyDelta > 0 && hasSell && hasItem) return "sell_item";
    if (hasCase) return "case_click";
    return "other";
  }

  function classifyChange(moneyDelta, tokenDelta, clickContext) {
    const hasMoneyChange = Math.abs(moneyDelta) >= SETTINGS.minDeltaToRecord;
    const hasTokenChange = Math.abs(tokenDelta) >= SETTINGS.minDeltaToRecord;
    const primaryDelta = hasMoneyChange ? moneyDelta : tokenDelta;
    const reason = clickContext?.label || (primaryDelta < 0 ? "unknown_action" : "income_or_reward");
    const action = classifyAction(reason.toLowerCase(), moneyDelta, tokenDelta);

    if (action === "trade_skin") {
      return {
        type: "trade_skin",
        action,
        reason,
      };
    }

    if (primaryDelta < 0) {
      return {
        type: action === "buy_case" ? "buy_case_spend" : "spend",
        action,
        reason,
      };
    }

    return {
      type: action === "sell_item" ? "sell_item_earn" : action === "case_click" ? "case_click_earn" : "gain",
      action,
      reason,
    };
  }

  function addEvent(event) {
    const normalized = sanitizeEvent(event);
    if (!normalized) return;
    const events = currentEvents();
    events.push(normalized);
    pruneEvents(state.accountId);
    refreshActiveAccountTimestamp();
    saveDb();
    debugLog("event", event);
  }

  function pollBalances() {
    if (state.paused) return;

    const currentMoney = readMoneyFromDom();
    const currentTokens = readTokensFromDom();
    if (currentMoney === null && currentTokens === null) return;

    if (state.previousMoney === null && currentMoney !== null) state.previousMoney = currentMoney;
    if (state.previousTokens === null && currentTokens !== null) state.previousTokens = currentTokens;
    if (state.previousMoney === null && state.previousTokens === null) return;

    const moneyDelta =
      currentMoney === null || state.previousMoney === null ? 0 : +(currentMoney - state.previousMoney).toFixed(2);
    const tokenDelta =
      currentTokens === null || state.previousTokens === null ? 0 : +(currentTokens - state.previousTokens).toFixed(2);

    const hasMoneyChange = Math.abs(moneyDelta) >= SETTINGS.minDeltaToRecord;
    const hasTokenChange = Math.abs(tokenDelta) >= SETTINGS.minDeltaToRecord;
    if (!hasMoneyChange && !hasTokenChange) {
      if (currentMoney !== null) state.previousMoney = currentMoney;
      if (currentTokens !== null) state.previousTokens = currentTokens;
      return;
    }

    const clickContext =
      state.latestClickContext &&
      Date.now() - state.latestClickContext.at <= SETTINGS.recentClickWindowMs
        ? state.latestClickContext
        : null;

    const classified = classifyChange(moneyDelta, tokenDelta, clickContext);

    addEvent({
      id: nextEventId(),
      at: nowIso(),
      accountId: state.accountId,
      previous_money: state.previousMoney,
      current_money: currentMoney,
      money_delta: moneyDelta,
      previous_tokens: state.previousTokens,
      current_tokens: currentTokens,
      token_delta: tokenDelta,
      source: clickContext ? "click_context" : "poll",
      session_id: state.db.meta?.sessionId || "session_unknown",
      ...classified,
    });

    if (currentMoney !== null) state.previousMoney = currentMoney;
    if (currentTokens !== null) state.previousTokens = currentTokens;
  }

  function aggregateEvents(events) {
    return events.reduce(
      (acc, e) => {
        const moneyDelta = Number(e.money_delta ?? e.delta ?? 0);
        const tokenDelta = Number(e.token_delta ?? 0);
        acc.net += moneyDelta;
        if (moneyDelta < 0) acc.spent += Math.abs(moneyDelta);
        if (moneyDelta > 0) acc.earned += moneyDelta;
        if (e.type === "case_click_earn") acc.caseClickEarned += moneyDelta;
        if (e.type === "buy_case_spend") {
          acc.buyCaseSpent += Math.abs(moneyDelta);
          acc.casesBought += 1;
        }
        if (e.type === "sell_item_earn") acc.sellItemEarned += moneyDelta;
        if (e.type === "trade_skin") acc.tradeSkinEvents += 1;
        if (tokenDelta < 0) acc.tokensLost += Math.abs(tokenDelta);
        if (tokenDelta > 0) acc.tokensEarned += tokenDelta;
        return acc;
      },
      { net: 0, spent: 0, earned: 0, caseClickEarned: 0, buyCaseSpent: 0, sellItemEarned: 0, tradeSkinEvents: 0, tokensEarned: 0, tokensLost: 0, casesBought: 0 }
    );
  }

  function addRoiMetrics(summaryRow) {
    const cost = Number(summaryRow.buyCaseSpent || 0);
    const returns = Number(summaryRow.caseClickEarned || 0);
    const net = returns - cost;
    const roi = cost > 0 ? (net / cost) * 100 : 0;
    return {
      ...summaryRow,
      caseOpenReturn: returns,
      caseOpenNet: net,
      caseOpenRoiPercent: roi,
    };
  }

  function withinHours(events, hours = SETTINGS.defaultSummaryHours) {
    const since = Date.now() - hours * 60 * 60 * 1000;
    return events.filter((e) => new Date(e.at).getTime() >= since);
  }

  function getAllAccountsSummary(hours = SETTINGS.defaultSummaryHours) {
    const rows = Object.entries(state.db.accounts).map(([accountId, events]) => {
      const filtered = withinHours(events, hours);
      return addRoiMetrics({ accountId, events: filtered.length, ...aggregateEvents(filtered) });
    });

    const totals = addRoiMetrics(aggregateEvents(rows.flatMap((row) => withinHours(state.db.accounts[row.accountId], hours))));
    return { hours, rows, totals };
  }

  function exportCsv() {
    const header = [
      "at",
      "account_id",
      "type",
      "action",
      "reason",
      "previous_money",
      "current_money",
      "money_delta",
      "previous_tokens",
      "current_tokens",
      "token_delta",
      "spent",
      "earned",
      "tokens_earned",
      "tokens_lost",
      "case_click_earned",
      "buy_case_spent",
      "sell_item_earned",
      "trade_skin_events",
    ];

    const rows = Object.entries(state.db.accounts).flatMap(([accountId, events]) =>
      events.map((event) => {
        const moneyDelta = Number(event.money_delta ?? event.delta ?? 0);
        const tokenDelta = Number(event.token_delta ?? 0);
        const spent = moneyDelta < 0 ? Math.abs(moneyDelta) : 0;
        const earned = moneyDelta > 0 ? moneyDelta : 0;
        const tokensEarned = tokenDelta > 0 ? tokenDelta : 0;
        const tokensLost = tokenDelta < 0 ? Math.abs(tokenDelta) : 0;
        const caseClickEarned = event.type === "case_click_earn" ? moneyDelta : 0;
        const buyCaseSpent = event.type === "buy_case_spend" ? Math.abs(moneyDelta) : 0;
        const sellItemEarned = event.type === "sell_item_earn" ? moneyDelta : 0;
        const tradeSkinEvents = event.type === "trade_skin" ? 1 : 0;

        return [
          event.at,
          accountId,
          event.type,
          event.action,
          event.reason,
          event.previous_money ?? event.previous ?? "",
          event.current_money ?? event.current ?? "",
          moneyDelta,
          event.previous_tokens ?? "",
          event.current_tokens ?? "",
          tokenDelta,
          spent,
          earned,
          tokensEarned,
          tokensLost,
          caseClickEarned,
          buyCaseSpent,
          sellItemEarned,
          tradeSkinEvents,
        ]
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(",");
      })
    );

    return [header.join(","), ...rows].join("\n");
  }

  function export24hSummaryCsv(hours = SETTINGS.defaultSummaryHours) {
    const summary = getAllAccountsSummary(hours);
    const header = ["account_id", "events", "net", "spent", "earned", "tokens_earned", "tokens_lost", "case_click_earned", "buy_case_spent", "case_open_return", "case_open_net", "case_open_roi_percent", "cases_bought", "sell_item_earned", "trade_skin_events"];
    const rows = summary.rows.map((row) =>
      [
        row.accountId,
        row.events,
        row.net.toFixed(2),
        row.spent.toFixed(2),
        row.earned.toFixed(2),
        row.tokensEarned.toFixed(2),
        row.tokensLost.toFixed(2),
        row.caseClickEarned.toFixed(2),
        row.buyCaseSpent.toFixed(2),
        row.caseOpenReturn.toFixed(2),
        row.caseOpenNet.toFixed(2),
        row.caseOpenRoiPercent.toFixed(2),
        row.casesBought,
        row.sellItemEarned.toFixed(2),
        row.tradeSkinEvents,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",")
    );

    return [header.join(","), ...rows].join("\n");
  }

  function exportJson() {
    return JSON.stringify(state.db, null, 2);
  }

  function importJson(jsonText, { merge = true } = {}) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error("Invalid JSON supplied to importJson().");
    }

    if (!parsed || typeof parsed !== "object" || !parsed.accounts || typeof parsed.accounts !== "object") {
      throw new Error("JSON must include an accounts object.");
    }

    if (!merge) {
      state.db = {
        activeAccountId: sanitizeAccountId(parsed.activeAccountId) || state.accountId,
        accounts: {},
        meta: parsed.meta || {},
      };
    }

    if (!state.db.accounts) state.db.accounts = {};

    Object.entries(parsed.accounts).forEach(([accountId, events]) => {
      const safeId = sanitizeAccountId(accountId) || "unknown_account";
      const safeEvents = Array.isArray(events) ? events : [];
      if (!state.db.accounts[safeId]) state.db.accounts[safeId] = [];
      state.db.accounts[safeId].push(...safeEvents);
      pruneEvents(safeId);
    });

    state.db.activeAccountId = sanitizeAccountId(parsed.activeAccountId) || state.accountId;
    refreshActiveAccountTimestamp();
    saveDb();
    console.log(`[CCO Tracker] Imported data for ${Object.keys(parsed.accounts).length} account(s).`);
  }

  function getAccountSummary(hours = SETTINGS.defaultSummaryHours, accountId = state.accountId) {
    const safeId = sanitizeAccountId(accountId);
    const events = withinHours(state.db.accounts[safeId] || [], hours);
    return addRoiMetrics({ accountId: safeId, events: events.length, ...aggregateEvents(events) });
  }

  function export24hMarkdownTable(hours = SETTINGS.defaultSummaryHours) {
    const summary = getAllAccountsSummary(hours);
    const header = "| account_id | events | net | spent | earned | tokens_earned | tokens_lost | case_click_earned | buy_case_spent | case_open_return | case_open_net | case_open_roi_percent | cases_bought | sell_item_earned | trade_skin_events |";
    const divider = "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
    const rows = summary.rows.map(
      (row) =>
        `| ${row.accountId} | ${row.events} | ${row.net.toFixed(2)} | ${row.spent.toFixed(2)} | ${row.earned.toFixed(2)} | ${row.tokensEarned.toFixed(2)} | ${row.tokensLost.toFixed(2)} | ${row.caseClickEarned.toFixed(2)} | ${row.buyCaseSpent.toFixed(2)} | ${row.caseOpenReturn.toFixed(2)} | ${row.caseOpenNet.toFixed(2)} | ${row.caseOpenRoiPercent.toFixed(2)} | ${row.casesBought} | ${row.sellItemEarned.toFixed(2)} | ${row.tradeSkinEvents} |`
    );

    return [header, divider, ...rows].join("\n");
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) {
      throw new Error("Clipboard write is not available in this context.");
    }

    return true;
  }

  async function copyCsvToClipboard() {
    await copyToClipboard(exportCsv());
    console.log("[CCO Tracker] Copied all-account CSV to clipboard.");
  }

  async function copy24hSummaryToClipboard(hours = SETTINGS.defaultSummaryHours) {
    await copyToClipboard(export24hSummaryCsv(hours));
    console.log(`[CCO Tracker] Copied ${hours}h summary CSV to clipboard.`);
  }

  async function copyMarkdownSummaryToClipboard(hours = SETTINGS.defaultSummaryHours) {
    await copyToClipboard(export24hMarkdownTable(hours));
    console.log(`[CCO Tracker] Copied ${hours}h summary Markdown table to clipboard.`);
  }

  async function copyJsonToClipboard() {
    await copyToClipboard(exportJson());
    console.log("[CCO Tracker] Copied JSON database to clipboard.");
  }

  function getStorageInfo() {
    const raw = localStorage.getItem(SETTINGS.storageKey) || "";
    return {
      storage: "localStorage",
      key: SETTINGS.storageKey,
      accounts: Object.keys(state.db.accounts),
      total_events: totalEventsCount(),
      bytes: raw.length,
      last_updated_at: state.db.meta?.lastUpdatedAt || null,
      session_id: state.db.meta?.sessionId || null,
      paused: state.paused,
    };
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCsv(filename = `cco-all-accounts-events-${Date.now()}.csv`) {
    downloadText(filename, exportCsv());
  }

  function download24hSummaryCsv(hours = SETTINGS.defaultSummaryHours) {
    downloadText(`cco-all-accounts-summary-${hours}h-${Date.now()}.csv`, export24hSummaryCsv(hours));
  }

  function downloadJson(filename = `cco-all-accounts-data-${Date.now()}.json`) {
    const blob = new Blob([exportJson()], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function getEventsFiltered({ accountId = null, hours = null, type = null, action = null } = {}) {
    const selectedAccounts = accountId
      ? [sanitizeAccountId(accountId)]
      : Object.keys(state.db.accounts);

    let events = selectedAccounts.flatMap((id) => state.db.accounts[id] || []);

    if (hours !== null) {
      const since = Date.now() - Number(hours) * 60 * 60 * 1000;
      events = events.filter((e) => new Date(e.at).getTime() >= since);
    }

    if (type) events = events.filter((e) => e.type === type);
    if (action) events = events.filter((e) => e.action === action);

    return [...events];
  }

  function exportAccountCsv(accountId = state.accountId, hours = null) {
    const safeId = sanitizeAccountId(accountId);
    const events = getEventsFiltered({ accountId: safeId, hours });
    const header = ["id", "at", "account_id", "type", "action", "reason", "money_delta", "token_delta", "source", "session_id"];
    const rows = events.map((e) =>
      [e.id, e.at, safeId, e.type, e.action, e.reason, e.money_delta, e.token_delta, e.source || "", e.session_id || ""]
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    return [header.join(","), ...rows].join("\n");
  }

  function downloadAccountCsv(accountId = state.accountId, hours = null) {
    const safeId = sanitizeAccountId(accountId);
    const suffix = hours == null ? "all" : `${hours}h`;
    downloadText(`cco-account-${safeId}-${suffix}-${Date.now()}.csv`, exportAccountCsv(safeId, hours));
  }

  function renameAccount(oldAccountId, newAccountId) {
    const oldId = sanitizeAccountId(oldAccountId);
    const newId = sanitizeAccountId(newAccountId);
    if (!oldId || !newId || oldId === newId || !state.db.accounts[oldId]) return false;

    if (!state.db.accounts[newId]) state.db.accounts[newId] = [];
    state.db.accounts[newId].push(...state.db.accounts[oldId].map((e) => ({ ...e, accountId: newId })));
    delete state.db.accounts[oldId];
    pruneEvents(newId);

    if (state.accountId === oldId) state.accountId = newId;
    if (state.db.activeAccountId === oldId) state.db.activeAccountId = newId;

    refreshActiveAccountTimestamp();
    saveDb();
    return true;
  }

  function deleteAccount(accountId) {
    const safeId = sanitizeAccountId(accountId);
    if (!safeId || !state.db.accounts[safeId]) return false;
    delete state.db.accounts[safeId];
    ensureAccountBucket(state.accountId);
    refreshActiveAccountTimestamp();
    saveDb();
    return true;
  }

  function pause() {
    state.paused = true;
    return true;
  }

  function resume() {
    state.paused = false;
    return true;
  }

  function isPaused() {
    return state.paused;
  }

  function getHealthReport() {
    const allEvents = getEventsFiltered();
    const unknownActions = allEvents.filter((e) => e.action === "other").length;
    const unknownTypes = allEvents.filter((e) => e.type === "unknown").length;

    return {
      version: "1.7.0",
      accounts: Object.keys(state.db.accounts).length,
      total_events: allEvents.length,
      unknown_action_events: unknownActions,
      unknown_type_events: unknownTypes,
      paused: state.paused,
      last_updated_at: state.db.meta?.lastUpdatedAt || null,
      active_account: state.accountId,
    };
  }

  function printSummary(hours = SETTINGS.defaultSummaryHours) {
    const summary = getAllAccountsSummary(hours);
    console.table(
      summary.rows.map((row) => ({
        account_id: row.accountId,
        events: row.events,
        net: +row.net.toFixed(2),
        spent: +row.spent.toFixed(2),
        earned: +row.earned.toFixed(2),
        tokens_earned: +row.tokensEarned.toFixed(2),
        tokens_lost: +row.tokensLost.toFixed(2),
        case_click_earned: +row.caseClickEarned.toFixed(2),
        buy_case_spent: +row.buyCaseSpent.toFixed(2),
        case_open_return: +row.caseOpenReturn.toFixed(2),
        case_open_net: +row.caseOpenNet.toFixed(2),
        case_open_roi_percent: +row.caseOpenRoiPercent.toFixed(2),
        cases_bought: row.casesBought,
        sell_item_earned: +row.sellItemEarned.toFixed(2),
        trade_skin_events: row.tradeSkinEvents,
      }))
    );

    console.log(`[CCO Tracker] Combined ${hours}h net: ${summary.totals.net.toFixed(2)}`);
    console.log(`[CCO Tracker] Case ROI ${hours}h: ${summary.totals.caseOpenRoiPercent.toFixed(2)}% (net ${summary.totals.caseOpenNet.toFixed(2)} on cost ${summary.totals.buyCaseSpent.toFixed(2)}).`);
  }

  function clearEvents(accountId = null) {
    if (accountId) {
      const safeId = sanitizeAccountId(accountId);
      if (safeId && state.db.accounts[safeId]) {
        state.db.accounts[safeId] = [];
      }
    } else {
      state.db.accounts = {};
      ensureAccountBucket(state.accountId);
    }
    refreshActiveAccountTimestamp();
    saveDb();
    console.log("[CCO Tracker] Cleared stored events.");
  }

  function setAccount(accountId) {
    const safeId = sanitizeAccountId(accountId);
    if (!safeId) {
      console.warn("[CCO Tracker] Invalid account id.");
      return;
    }

    state.accountId = safeId;
    state.db.activeAccountId = safeId;
    ensureAccountBucket(safeId);
    refreshActiveAccountTimestamp();
    saveDb();
    state.previousMoney = null;
    state.previousTokens = null;
    console.log(`[CCO Tracker] Active account set to: ${safeId}`);
  }

  function attachClickTracker() {
    if (state.observerStarted) return;

    document.addEventListener(
      "click",
      (event) => {
        const context = readClickContext(event.target);
        if (context) state.latestClickContext = context;
      },
      { capture: true }
    );

    state.observerStarted = true;
  }

  function attachApi() {
    window.CCOMoneyTracker = {
      getEvents: () => [...currentEvents()],
      getAllEventsByAccount: () => JSON.parse(JSON.stringify(state.db.accounts)),
      getAllAccountsSummary,
      getAccountSummary,
      getStorageInfo,
      getHealthReport,
      getEventsFiltered,
      setAccount,
      renameAccount,
      deleteAccount,
      pause,
      resume,
      isPaused,
      importJson,
      clear: clearEvents,
      exportCsv,
      export24hSummaryCsv,
      export24hMarkdownTable,
      exportJson,
      copyCsvToClipboard,
      copy24hSummaryToClipboard,
      copyMarkdownSummaryToClipboard,
      copyJsonToClipboard,
      downloadCsv,
      download24hSummaryCsv,
      downloadJson,
      exportAccountCsv,
      downloadAccountCsv,
      summary: printSummary,
      settings: SETTINGS,
      getAccount: () => state.accountId,
    };
  }

  function start() {
    state.accountId = detectAccountId();
    state.db.activeAccountId = state.accountId;
    ensureAccountBucket(state.accountId);
    refreshActiveAccountTimestamp();
    saveDb();

    if (!state.db.meta) state.db.meta = {};
    state.db.meta.sessionId = `session_${Date.now()}`;

    attachClickTracker();
    attachApi();
    if (state.pollIntervalId) clearInterval(state.pollIntervalId);
    state.pollIntervalId = setInterval(pollBalances, SETTINGS.pollMs);
    console.log(`[CCO Tracker] Started for account: ${state.accountId}.`);
    console.log("[CCO Tracker] Data is stored in localStorage; use getStorageInfo() for details.");
    console.log("[CCO Tracker] Use download24hSummaryCsv() for spreadsheet totals or copyMarkdownSummaryToClipboard() for GitHub pages.");
    console.log("[CCO Tracker] Backup/restore with downloadJson() and importJson(jsonText).");
    console.log("[CCO Tracker] Extra tools: pause()/resume(), getHealthReport(), downloadAccountCsv(accountId, hours).");
  }

  start();
})();
