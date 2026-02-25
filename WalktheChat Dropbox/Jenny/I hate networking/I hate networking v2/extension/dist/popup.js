"use strict";
(() => {
  // lib/icons.ts
  var s = (content, w = 16, h = 16, vb = "0 0 16 16") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="currentColor" width="${w}" height="${h}" style="display:inline-block;vertical-align:middle;flex-shrink:0">${content}</svg>`;
  var icons = {
    // Close / X
    xMark: s(
      `<path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>`,
      20,
      20,
      "0 0 20 20"
    ),
    // Checkmark (small, inline)
    check: s(
      `<path fill-rule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/>`
    ),
    // Check circle (large — for launched screen)
    checkCircle: s(
      `<path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clip-rule="evenodd"/>`,
      36,
      36,
      "0 0 24 24"
    ),
    // Download / arrow-down-tray
    download: s(
      `<path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z"/><path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z"/>`
    ),
    // Warning / exclamation-triangle
    warning: s(
      `<path fill-rule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/>`
    ),
    // External link / arrow-top-right-on-square
    externalLink: s(
      `<path d="M6.22 8.72a.75.75 0 0 0 1.06 1.06l5.22-5.22v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0 0 1.5h1.69L6.22 8.72Z"/><path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z"/>`
    ),
    // Arrow right
    arrowRight: s(
      `<path fill-rule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clip-rule="evenodd"/>`
    ),
    // Arrow left
    arrowLeft: s(
      `<path fill-rule="evenodd" d="M14 8a.75.75 0 0 1-.75.75H4.56l3.22 3.22a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 1.06L4.56 7.25h8.69A.75.75 0 0 1 14 8Z" clip-rule="evenodd"/>`
    ),
    // Chevron down (expand)
    chevronDown: s(
      `<path fill-rule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/>`,
      12,
      12
    ),
    // Chevron right (collapsed)
    chevronRight: s(
      `<path fill-rule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06L7.28 11.78a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/>`,
      12,
      12
    ),
    // Pause
    pause: s(
      `<path d="M4.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-2Zm5 0a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-2Z"/>`,
      14,
      14
    ),
    // Play
    play: s(
      `<path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z"/>`,
      14,
      14
    )
  };

  // popup/popup.ts
  var brandHtml = `
  <div class="brand">
    <img src="../icons/icon48.png" class="brand-logo" alt="">
    <div class="brand-text">
      <div class="brand-name">I hate networking</div>
      <div class="brand-sub">networking app</div>
    </div>
  </div>
`;
  async function init() {
    const root = document.getElementById("root");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isLuma = (tab.url ?? "").includes("lu.ma") || (tab.url ?? "").includes("luma.com");
    const [progressResp, pausedResp, statusResp] = await Promise.all([
      new Promise((r) => chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, r)),
      new Promise((r) => chrome.runtime.sendMessage({ type: "GET_CAMPAIGN_PAUSED" }, r)),
      new Promise((r) => chrome.runtime.sendMessage({ type: "GET_QUEUE_STATUS" }, r))
    ]);
    const events = progressResp?.events ?? [];
    const paused = pausedResp?.paused ?? false;
    const lastSentAt = statusResp?.lastSentAt;
    const lastSentName = statusResp?.lastSentName;
    const nextScheduledAt = statusResp?.nextScheduledAt;
    let sent = 0, pending = 0, failed = 0;
    const recentSent = [];
    for (const event of events) {
      for (const contact of event.contacts ?? []) {
        const status = contact.connection_queue?.[0]?.status;
        if (status === "sent" || status === "accepted") {
          sent++;
          if (recentSent.length < 4) recentSent.push(contact.name ?? "");
        } else if (status === "pending") {
          pending++;
        } else if (status === "failed") {
          failed++;
        }
      }
    }
    const hasQueue = sent + pending + failed > 0;
    if (!hasQueue) {
      root.innerHTML = `
      <div class="header">
        ${brandHtml}
        <span class="status-pill status-idle"><span class="dot"></span>Idle</span>
      </div>
      <div class="idle-wrap">
        <div class="idle-emoji">\u{1F91D}</div>
        <div class="idle-title">No active campaign</div>
        <div class="idle-sub">${isLuma ? "Find attendees and connect on LinkedIn." : "Start from any Luma event page."}</div>
        ${isLuma ? `<button class="btn-primary" id="btnScan">Scan this event \u2192</button>` : `<button class="btn-secondary" id="btnLuma">Open Luma.com \u2192</button>`}
      </div>
    `;
      if (isLuma) {
        root.querySelector("#btnScan").addEventListener("click", () => {
          chrome.tabs.sendMessage(tab.id, { type: "OPEN_PANEL" });
          window.close();
        });
      } else {
        root.querySelector("#btnLuma").addEventListener("click", () => {
          chrome.tabs.create({ url: "https://lu.ma" });
          window.close();
        });
      }
      return;
    }
    const isRunning = pending > 0 && !paused;
    const isDone = pending === 0;
    const statusHtml = isDone ? `<span class="status-pill status-idle"><span class="dot"></span>Done</span>` : paused ? `<span class="status-pill status-paused"><span class="dot"></span>Paused</span>` : `<span class="status-pill status-running"><span class="dot"></span>Running</span>`;
    const instructionHtml = isDone ? `All connections have been sent or processed.` : paused ? `Campaign is paused. <strong>Resume</strong> to continue sending.` : `Sending requests automatically. <strong>Keep Chrome open</strong> while it runs.`;
    const pauseBtnHtml = isDone ? "" : paused ? `<button class="btn-resume" id="btnPause">${icons.play} Resume campaign</button>` : `<button class="btn-pause" id="btnPause">${icons.pause} Pause campaign</button>`;
    const recentHtml = recentSent.length > 0 ? `
    <div class="section">
      <div class="recent-title">Recently sent</div>
      ${recentSent.map((n) => `
        <div class="recent-row">
          <span class="recent-check">${icons.check}</span>
          <span class="recent-name">${escHtml(n)}</span>
        </div>
      `).join("")}
    </div>
  ` : "";
    const scanBtnHtml = isLuma ? `<div class="section"><button class="btn-secondary" id="btnScan">Scan another event \u2192</button></div>` : "";
    root.innerHTML = `
    <div class="header">
      ${brandHtml}
      ${statusHtml}
    </div>
    <div class="section">
      <div class="instruction">${instructionHtml}</div>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-num green">${sent}</div>
        <div class="stat-label">Sent</div>
      </div>
      <div class="stat">
        <div class="stat-num">${pending}</div>
        <div class="stat-label">Queued</div>
      </div>
      ${failed > 0 ? `
      <div class="stat">
        <div class="stat-num red">${failed}</div>
        <div class="stat-label">Skipped</div>
      </div>` : ""}
    </div>
    ${pauseBtnHtml ? `<div class="section">${pauseBtnHtml}</div>` : ""}
    ${recentHtml}
    ${scanBtnHtml}
    ${isRunning ? `<div class="rate-note">${timingLine(lastSentName, lastSentAt, nextScheduledAt)}</div>` : ""}
  `;
    root.querySelector("#btnPause")?.addEventListener("click", async () => {
      const msg = paused ? "RESUME_CAMPAIGN" : "PAUSE_CAMPAIGN";
      await new Promise((r) => chrome.runtime.sendMessage({ type: msg }, () => r()));
      init();
    });
    if (isLuma) {
      root.querySelector("#btnScan")?.addEventListener("click", () => {
        chrome.tabs.sendMessage(tab.id, { type: "OPEN_PANEL" });
        window.close();
      });
    }
  }
  function escHtml(s2) {
    return s2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function timingLine(lastSentName, lastSentAt, nextScheduledAt) {
    const parts = [];
    if (lastSentName && lastSentAt) {
      const mins = Math.round((Date.now() - new Date(lastSentAt).getTime()) / 6e4);
      parts.push(`Last: ${escHtml(lastSentName)} \xB7 ${mins}m ago`);
    }
    if (nextScheduledAt) {
      const mins = Math.max(0, Math.round((new Date(nextScheduledAt).getTime() - Date.now()) / 6e4));
      parts.push(mins === 0 ? "Next: soon" : `Next in ~${mins}m`);
    } else if (parts.length === 0) {
      return "First send starting soon \u2014 keep Chrome open";
    }
    return parts.join(" \xB7 ");
  }
  init();
})();
