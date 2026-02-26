"use strict";
(() => {
  // sidepanel/sidepanel.ts
  var scanState = { type: "idle" };
  var noteValue = "";
  var authMode = "signup";
  var MAX_NOTE = 300;
  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function initials(name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  var nonEventPaths = ["", "/", "/home", "/calendar", "/events", "/discover", "/explore", "/settings", "/dashboard"];
  function isLumaEventPath(pathname) {
    return !nonEventPaths.includes(pathname) && pathname.split("/").length === 2;
  }
  function defaultNote(eventName) {
    const label = eventName.split("\xB7")[0].trim();
    return label ? `I saw you at the ${label} event, I'd like to stay in touch!` : "I saw you at the event, I'd like to stay in touch!";
  }
  function etaString(done, total, startTime) {
    if (done === 0) return "";
    const elapsed = (Date.now() - startTime) / 1e3;
    const perItem = elapsed / done;
    const remaining = Math.ceil((total - done) * perItem);
    if (remaining < 60) return `~${remaining}s remaining`;
    return `~${Math.ceil(remaining / 60)} min remaining`;
  }
  async function resolveTabContext() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.id) return { kind: "other" };
    const tabId = tab.id;
    const url = tab.url;
    const isLuma = url.includes("lu.ma") || url.includes("luma.com");
    if (!isLuma) return { kind: "other" };
    const pathname = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return "";
      }
    })();
    if (!isLumaEventPath(pathname)) return { kind: "luma-other", tabId };
    const eventName = tab.title?.replace(/\s*[·|–-].*$/, "").trim() ?? "";
    return { kind: "luma-event", tabId, eventName };
  }
  async function resolveAppState() {
    const [ctx, storage] = await Promise.all([
      resolveTabContext(),
      chrome.storage.local.get(["queuePending", "campaignPaused"])
    ]);
    const pending = storage.queuePending ?? 0;
    const paused = storage.campaignPaused ?? false;
    if (pending > 0 || paused) {
      return { type: "campaign", pending, paused, ctx };
    }
    return { type: "landing", ctx };
  }
  var root = document.getElementById("root");
  function renderLoading() {
    root.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#9ca3af;font-size:13px;">Loading\u2026</div>`;
  }
  function renderLanding(ctx) {
    const ctaLabel = ctx.kind === "luma-other" ? "Browse Luma events \u2192" : "Open Luma.com \u2192";
    const ctaHref = ctx.kind === "luma-other" ? "https://lu.ma/events" : "https://lu.ma";
    const step1desc = ctx.kind === "luma-other" ? "Open a specific event page on Luma" : "Open any event you attended on lu.ma";
    root.innerHTML = `
    <div class="hero">
      <img src="../icons/icon128.png" class="hero-logo" alt="">
      <div class="hero-name">I Hate Networking</div>
      <div class="hero-sub">networking, automated</div>
    </div>

    <p class="tagline">Event follow-up shouldn't be your second job.</p>

    <div class="divider" style="margin-top:16px;"></div>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">
          <div class="step-title">Go to a Luma event page</div>
          <div class="step-desc">${step1desc}</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">
          <div class="step-title">Scan the guest list</div>
          <div class="step-desc">We find everyone's LinkedIn profile</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text">
          <div class="step-title">LinkedIn connections send automatically</div>
          <div class="step-desc">35/day max \xB7 business hours only \xB7 keeps your account safe</div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="btn-wrap">
      <button class="btn btn-primary" id="btnCta">${ctaLabel}</button>
    </div>

    <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
  `;
    document.getElementById("btnCta").addEventListener("click", () => {
      chrome.tabs.create({ url: ctaHref });
    });
  }
  function nextConnectionLabel(nextAt) {
    if (!nextAt) return "";
    const diff = new Date(nextAt).getTime() - Date.now();
    if (diff <= 0) return "Next connection starting soon";
    const mins = Math.ceil(diff / 6e4);
    return `Next connection in ~${mins} min`;
  }
  async function renderCampaign(state) {
    const [progressResp, storageData] = await Promise.all([
      new Promise((r) => chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, r)),
      chrome.storage.local.get(["nextScheduledAt"])
    ]);
    const events = progressResp?.events ?? [];
    const nextAt = storageData.nextScheduledAt ?? null;
    let sent = 0, dbPending = 0, failed = 0;
    const recentActivity = [];
    for (const event of events) {
      for (const contact of event.contacts ?? []) {
        const status = contact.connection_queue?.[0]?.status;
        if (status === "sent" || status === "accepted") {
          sent++;
          recentActivity.push({ name: contact.name ?? "", eventName: event.name ?? "" });
        } else if (status === "pending") {
          dbPending++;
        } else if (status === "failed") {
          failed++;
        }
      }
    }
    const total = sent + dbPending + failed;
    const pct = total > 0 ? Math.round(sent / total * 100) : 0;
    const isRunning = state.pending > 0 && !state.paused;
    const statusHtml = isRunning ? `<span class="status-pill pill-running"><span class="dot"></span>Running</span>` : state.paused ? `<span class="status-pill pill-paused"><span class="dot"></span>Paused</span>` : `<span class="status-pill pill-done"><span class="dot"></span>Done</span>`;
    const statsHtml = `
    <div class="stats-row" style="margin:0 16px;">
      <div class="stat-card">
        <div class="stat-num green">${sent}</div>
        <div class="stat-label">Connected</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${state.pending}</div>
        <div class="stat-label">Queued</div>
      </div>
      ${failed > 0 ? `
      <div class="stat-card">
        <div class="stat-num red">${failed}</div>
        <div class="stat-label">Skipped</div>
      </div>` : ""}
    </div>
  `;
    const progressHtml = total > 0 ? `
    <div style="padding:0 16px;">
      <div class="progress-wrap">
        <div class="progress-bg">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="progress-meta">
          <span>${pct}% complete</span>
          <span>${nextConnectionLabel(isRunning ? nextAt : null)}</span>
        </div>
      </div>
    </div>
  ` : "";
    const pauseBtnLabel = isRunning ? "\u23F8 Pause campaign" : "\u25B6 Resume campaign";
    const pauseBtnId = isRunning ? "btnPause" : "btnResume";
    const activityHtml = recentActivity.length > 0 ? `
    <div class="section">
      <div class="feed-header">
        <span class="feed-title">Recently Connected</span>
      </div>
      <div class="feed-list">
        ${recentActivity.map((a) => `
          <div class="feed-row">
            <div class="feed-avatar">${escHtml(initials(a.name))}</div>
            <div class="feed-info">
              <div class="feed-name">${escHtml(a.name)}</div>
            </div>
            <span class="feed-event-tag" title="${escHtml(a.eventName)}">${escHtml(a.eventName)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  ` : "";
    const scanCta = state.ctx.kind === "luma-event" ? `
    <div class="section">
      <button class="btn btn-primary" id="btnScan">Scan this event's guest list</button>
    </div>
  ` : `
    <div class="section">
      <button class="btn btn-secondary" id="btnScanAnother">+ Scan another event</button>
    </div>
  `;
    root.innerHTML = `
    <div class="compact-header">
      <div class="compact-brand">
        <img src="../icons/icon48.png" class="compact-logo" alt="">
        <span class="compact-name">I Hate Networking</span>
      </div>
      ${statusHtml}
    </div>

    <div class="section">
      ${statsHtml}
      ${progressHtml}
      ${state.pending > 0 ? `<div class="pause-row"><button class="btn btn-secondary" id="${pauseBtnId}">${pauseBtnLabel}</button></div>` : ""}
    </div>

    ${activityHtml}
    ${scanCta}

    <p style="text-align:center;font-size:11px;color:#9ca3af;margin:8px 16px 0;">Closing this panel won't stop your campaign.</p>

    <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
  `;
    document.getElementById("btnPause")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "PAUSE_CAMPAIGN" }, () => render());
    });
    document.getElementById("btnResume")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "RESUME_CAMPAIGN" }, () => render());
    });
    document.getElementById("btnScanAnother")?.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://lu.ma" });
    });
    if (state.ctx.kind === "luma-event") {
      const eventCtx = state.ctx;
      document.getElementById("btnScan")?.addEventListener("click", () => startScan(eventCtx, true));
    }
  }
  function renderAuthGate() {
    return `
    <div class="auth-gate" id="authGate">
      <div class="auth-label">${authMode === "signup" ? "Create an account" : "Sign in"} to launch</div>
      <input id="authEmail" type="email" placeholder="Email" autocomplete="email">
      <input id="authPassword" type="password" placeholder="Password" autocomplete="current-password">
      <div class="auth-error" id="authError"></div>
      <button class="btn btn-primary" id="btnAuthSubmit" style="margin-top:4px;">
        ${authMode === "signup" ? "Create account" : "Sign in"}
      </button>
      <div class="auth-toggle">
        ${authMode === "signup" ? 'Already have an account? <button class="auth-toggle-btn" id="btnToggleAuth">Sign in</button>' : 'New here? <button class="auth-toggle-btn" id="btnToggleAuth">Create account</button>'}
      </div>
    </div>
  `;
  }
  function wireAuthGate() {
    document.getElementById("btnToggleAuth")?.addEventListener("click", () => {
      authMode = authMode === "signup" ? "signin" : "signup";
      render();
    });
    document.getElementById("btnAuthSubmit")?.addEventListener("click", async () => {
      const email = document.getElementById("authEmail")?.value ?? "";
      const password = document.getElementById("authPassword")?.value ?? "";
      const errEl = document.getElementById("authError");
      if (errEl) errEl.textContent = "";
      const type = authMode === "signup" ? "SIGN_UP" : "SIGN_IN";
      const result = await new Promise((r) => chrome.runtime.sendMessage({ type, data: { email, password } }, r));
      if (!result.success) {
        if (errEl) errEl.textContent = result.error ?? "Error";
      } else {
        render();
      }
    });
  }
  function startScan(ctx, hasCampaign = false) {
    scanState = { type: "scanning", phase: "starting", done: 0, total: 0, currentName: "", startTime: Date.now() };
    renderEventPage(ctx, hasCampaign);
    chrome.tabs.sendMessage(ctx.tabId, { type: "START_SCAN" });
  }
  async function launchCampaign(s) {
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "LAUNCH_CAMPAIGN", data: { eventId: s.eventId, note: noteValue } }, resolve);
    });
    scanState = { type: "launched", queued: result.queued, eventId: result.eventId };
    render();
  }
  async function renderEventPage(ctx, hasCampaign = false) {
    if (scanState.type === "idle") {
      const existing = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          chrome.runtime.sendMessage({ type: "GET_EVENT_BY_URL", lumaUrl: tab?.url ?? "" }, resolve);
        });
      });
      if (existing?.eventId && existing.existingUrls.length > 0) {
        scanState = { type: "already_scanned", count: existing.existingUrls.length, linkedInCount: existing.linkedInCount, eventId: existing.eventId, eventName: ctx.eventName };
      }
    }
    if (scanState.type === "idle") {
      root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section event-hero">
        <div class="event-name">${escHtml(ctx.eventName || "This event")}</div>
        <div class="event-meta">Luma event</div>
      </div>
      <div class="section">
        <button class="btn btn-primary" id="btnScan">Scan attendees for LinkedIn profiles</button>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `;
      document.getElementById("btnScan").addEventListener("click", () => startScan(ctx, hasCampaign));
      return;
    }
    if (scanState.type === "already_scanned") {
      const s = scanState;
      root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section">
        <div class="event-name">${escHtml(ctx.eventName || "This event")}</div>
        <div class="already-count" style="margin-top:8px;font-size:13px;color:#6b7280;">${s.count} attendees scanned \xB7 ${s.linkedInCount} on LinkedIn</div>
      </div>
      <div class="section">
        <button class="btn btn-primary" id="btnRescan">Scan again for new attendees</button>
        ${hasCampaign ? `<button class="btn btn-secondary" id="btnViewProgress" style="margin-top:8px;">View campaign progress</button>` : ""}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `;
      document.getElementById("btnRescan").addEventListener("click", () => startScan(ctx, hasCampaign));
      document.getElementById("btnViewProgress").addEventListener("click", () => {
        scanState = { type: "idle" };
        render();
      });
      return;
    }
    if (scanState.type === "scanning") {
      const s = scanState;
      const pct = s.total > 0 ? Math.round(s.done / s.total * 100) : 0;
      const eta = s.total > 0 ? etaString(s.done, s.total, s.startTime) : "";
      root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
        <span class="status-pill pill-running"><span class="dot"></span>Scanning</span>
      </div>
      <div class="section">
        <div class="scanning-label">Scanning <strong>${escHtml(s.currentName || "...")}</strong></div>
        <div class="progress-bg"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-meta"><span>${s.done}/${s.total || "?"}</span><span>${eta}</span></div>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `;
      return;
    }
    if (scanState.type === "results") {
      const s = scanState;
      if (!noteValue) noteValue = defaultNote(s.eventName);
      const linkedInReady = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "CHECK_LINKEDIN_LOGIN" }, (r) => resolve(r?.loggedIn ?? false)));
      const leadsHtml = s.contacts.filter((c) => c.linkedInUrl).map((c) => `
      <div class="lead-row">
        <div class="lead-initials">${escHtml(initials(c.name))}</div>
        <div class="lead-name">${escHtml(c.name)}</div>
        <div class="lead-badges">
          ${c.linkedInUrl ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="badge badge-li">in</a>` : ""}
          ${c.instagramUrl ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="badge badge-ig">ig</a>` : ""}
          ${c.twitterUrl ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="badge badge-x">x</a>` : ""}
        </div>
      </div>`).join("");
      root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section">
        <div class="results-count">Found ${s.found} on LinkedIn</div>
        <div class="results-sub">out of ${s.total} attendees scanned</div>
        ${s.contacts.length > 0 ? `<div class="leads-list">${leadsHtml}</div>` : ""}
        <div class="field-label">Message <span class="char-count" id="charCount">(optional) ${noteValue.length}/${MAX_NOTE}</span></div>
        <textarea id="noteInput" maxlength="${MAX_NOTE}">${escHtml(noteValue)}</textarea>
        ${s.eventId ? `
          <div class="li-status ${linkedInReady ? "ok" : "warn"}">
            ${linkedInReady ? "\u2713 LinkedIn ready" : '\u26A0 Not logged into LinkedIn &nbsp;<a class="li-open" href="https://www.linkedin.com/login" target="_blank">Open LinkedIn \u2197</a>'}
          </div>
          <button class="btn btn-primary" id="btnConnect" ${linkedInReady ? "" : "disabled"} style="margin-top:8px;">
            Send connection requests to ${s.found} people
          </button>
        ` : renderAuthGate()}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `;
      document.getElementById("noteInput")?.addEventListener("input", (e) => {
        noteValue = e.target.value;
        const el = document.getElementById("charCount");
        if (el) el.textContent = `(optional) ${noteValue.length}/${MAX_NOTE}`;
      });
      document.getElementById("btnConnect")?.addEventListener("click", () => launchCampaign(s));
      wireAuthGate();
      return;
    }
    if (scanState.type === "launched") {
      const s = scanState;
      root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section" style="text-align:center;padding:32px 20px;">
        <div class="launched-icon">\u{1F389}</div>
        <div class="launched-title">Campaign launched!</div>
        <div class="launched-sub">${s.queued} connection request${s.queued === 1 ? "" : "s"} queued</div>
        <div class="launched-note">We'll send them slowly during business hours \u2014 35/day max \u2014 to keep your account safe.</div>
        <button class="btn btn-secondary" id="btnDone">Done</button>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `;
      document.getElementById("btnDone").addEventListener("click", () => {
        scanState = { type: "idle" };
        render();
      });
      return;
    }
  }
  async function render() {
    renderLoading();
    try {
      const [state, ctx] = await Promise.all([resolveAppState(), resolveTabContext()]);
      const hasCampaign = state.type === "campaign";
      if (scanState.type !== "idle" && ctx.kind === "luma-event") {
        await renderEventPage(ctx, hasCampaign);
        return;
      }
      if (state.type === "campaign") {
        await renderCampaign(state);
      } else if (ctx.kind === "luma-event") {
        await renderEventPage(ctx, hasCampaign);
      } else {
        renderLanding(state.ctx);
      }
    } catch (err) {
      root.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#ef4444;font-size:13px;">Something went wrong. Try closing and reopening the panel.<br><br><small style="color:#9ca3af">${err}</small></div>`;
    }
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "SCAN_PROGRESS") {
      if (scanState.type !== "scanning") return;
      scanState = {
        ...scanState,
        phase: msg.phase,
        done: msg.done ?? scanState.done,
        total: msg.total ?? scanState.total,
        currentName: msg.currentName ?? scanState.currentName
      };
      resolveTabContext().then((ctx) => {
        if (ctx.kind === "luma-event") renderEventPage(ctx);
      });
    }
    if (msg.type === "SCAN_COMPLETE") {
      scanState = {
        type: "results",
        found: msg.found,
        total: msg.total,
        eventId: msg.eventId,
        eventName: scanState.eventName ?? "",
        contacts: msg.contacts ?? []
      };
      resolveTabContext().then((ctx) => {
        if (ctx.kind === "luma-event") renderEventPage(ctx);
      });
    }
  });
  chrome.tabs.onActivated.addListener(() => render());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url) render();
  });
  chrome.storage.onChanged.addListener(() => render());
  render();
})();
