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

  // content/panel.ts
  function parseGuestLinksFromDoc(doc) {
    const selectors = ["a[href*='/u/']", "a[href*='/user/']"];
    const seen = /* @__PURE__ */ new Set();
    const links = [];
    for (const sel of selectors) {
      doc.querySelectorAll(sel).forEach((a) => {
        const href = a.href || a.getAttribute("href") || "";
        if (href && !seen.has(href)) {
          seen.add(href);
          links.push(href);
        }
      });
    }
    return links;
  }
  function extractHostProfileUrlsFromDoc(doc) {
    const hostSections = doc.querySelectorAll('[class*="organizer"], [class*="host"]');
    const seen = /* @__PURE__ */ new Set();
    const urls = [];
    hostSections.forEach((section) => {
      section.querySelectorAll("a[href*='/u/'], a[href*='/user/']").forEach((a) => {
        const href = a.href || a.getAttribute("href") || "";
        if (href && !seen.has(href)) {
          seen.add(href);
          urls.push(href);
        }
      });
    });
    return urls;
  }
  function shortEventName(name) {
    return name.replace(/\s*·\s*[^·]+$/, "").replace(/\s*·\s*[^·]+$/, "").trim();
  }
  async function scrollToLoadAll(container, maxIter = 15) {
    if (!container) return;
    let prevHeight = 0;
    for (let i = 0; i < maxIter; i++) {
      container.scrollTop += 600;
      await new Promise((r) => setTimeout(r, 500));
      if (container.scrollHeight === prevHeight) break;
      prevHeight = container.scrollHeight;
    }
  }
  function findModalScrollable(preClickLinks) {
    const allLinks = Array.from(
      document.querySelectorAll("a[href*='/u/'], a[href*='/user/']")
    );
    const newLinks = allLinks.filter((a) => {
      const href = a.href || a.getAttribute("href") || "";
      return href && !preClickLinks.has(href);
    });
    if (newLinks.length === 0) return null;
    let el = newLinks[0].parentElement;
    while (el && el !== document.documentElement) {
      const s2 = getComputedStyle(el);
      if ((s2.overflow === "auto" || s2.overflow === "scroll" || s2.overflowY === "auto" || s2.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 10) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }
  async function scrapeLuma() {
    const eventName = document.querySelector("h1")?.textContent?.trim() ?? document.title;
    const preClickLinks = new Set(parseGuestLinksFromDoc(document));
    const labelPatterns = [/\band \d+ others\b/i, /\bGuests\b/, /\bGoing\b/, /\bAttendees\b/, /\bSee all\b/];
    let clickedLabel = "";
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const pattern of labelPatterns) {
      const btn = allBtns.find((b) => pattern.test(b.textContent ?? ""));
      if (btn) {
        btn.click();
        clickedLabel = btn.textContent?.trim() ?? "matched";
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
    const modal = findModalScrollable(preClickLinks);
    await scrollToLoadAll(modal ?? document.scrollingElement);
    const hostProfileUrls = extractHostProfileUrlsFromDoc(document);
    const allLinks = parseGuestLinksFromDoc(document);
    const hostSet = new Set(hostProfileUrls);
    const guestProfileUrls = allLinks.filter((u) => !hostSet.has(u));
    const locationEl = document.querySelector('[class*="location"], [class*="venue"], [class*="address"]');
    const eventLocation = locationEl?.textContent?.trim().split("\n")[0].trim() ?? "";
    return { eventName, eventLocation, hostProfileUrls, guestProfileUrls };
  }
  function extractLinkedInUrlFromHtml(html) {
    const match = html.match(/href="(https:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\/[^"?#]+)[^"]*"/);
    return match ? match[1] : "";
  }
  function extractInstagramUrlFromHtml(html) {
    const match = html.match(/href="(https:\/\/(?:www\.)?instagram\.com\/[^"?#/][^"?#]*)[^"]*"/);
    return match ? match[1] : "";
  }
  function extractTwitterUrlFromHtml(html) {
    const match = html.match(/href="(https:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^"?#/][^"?#]*)[^"]*"/);
    return match ? match[1] : "";
  }
  function extractDisplayNameFromHtml(html) {
    const titleMatch = html.match(/<title>\s*([^|<\n]+?)\s*(?:\||<)/);
    const raw = titleMatch ? titleMatch[1].trim() : (html.match(/property="og:title"\s+content="([^"]+)"/) ?? [])[1]?.trim() ?? "";
    return raw.replace(/\s*·\s*Luma\s*$/i, "").trim();
  }
  var state = { type: "idle" };
  var enrichedContacts = [];
  var panelEl = null;
  var noteValue = "";
  var contactStatuses = /* @__PURE__ */ new Map();
  var authMode = "signup";
  var progressData = null;
  var pausedEvents = [];
  var progressRefreshTimer = null;
  var expandedEvents = /* @__PURE__ */ new Set();
  var exportPickerOpen = false;
  function shortEventLabel(name) {
    let s2 = name.replace(/\(.*?\)/g, "").replace(/[:\-–—].*$/, "").replace(/[^\w\s]/gu, " ").replace(/\s+/g, " ").trim();
    const withMatch = s2.match(/\bwith\s+(\S+(?:\s+\S+)?)/i);
    if (withMatch) return withMatch[1].trim();
    const filler = /* @__PURE__ */ new Set(["making", "money", "night", "day", "the", "a", "an", "and", "or", "for", "of", "in", "at", "to", "from", "ship", "it", "tonight", "session", "event", "meetup", "workshop", "vibe", "coding", "open", "mat", "finder"]);
    const words = s2.split(/\s+/).filter((w) => w.length > 1 && !filler.has(w.toLowerCase()));
    return words.slice(0, 2).join(" ");
  }
  function defaultNote(eventName) {
    const label = shortEventLabel(eventName);
    return label ? `I saw you at the ${label} event, I'd like to stay in touch!` : "I saw you at the event, I'd like to stay in touch!";
  }
  var MAX_NOTE = 300;
  async function checkLinkedInLogin() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "CHECK_LINKEDIN_LOGIN" }, (resp) => {
        resolve(resp?.loggedIn ?? false);
      });
    });
  }
  function escHtml(s2) {
    return s2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function etaString(done, total, startTime) {
    if (done === 0) return "";
    const elapsed = (Date.now() - startTime) / 1e3;
    const perItem = elapsed / done;
    const remaining = Math.ceil((total - done) * perItem);
    if (remaining < 60) return `~${remaining}s remaining`;
    return `~${Math.ceil(remaining / 60)} min remaining`;
  }
  function renderChart(chartData) {
    if (chartData.length < 2) return '<p class="ihn-chart-empty">No connections sent yet</p>';
    const W = 312, H = 100;
    const pad = { t: 8, r: 8, b: 20, l: 32 };
    const maxVal = chartData[chartData.length - 1].cumulative;
    const xS = (i) => pad.l + i / (chartData.length - 1) * (W - pad.l - pad.r);
    const yS = (v) => pad.t + (1 - v / maxVal) * (H - pad.t - pad.b);
    const pts = chartData.map((d, i) => `${xS(i)},${yS(d.cumulative)}`).join(" ");
    const area = `${xS(0)},${H - pad.b} ${pts} ${xS(chartData.length - 1)},${H - pad.b}`;
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="ihn-cg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0.03"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#ihn-cg)"/>
    <polyline points="${pts}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="${pad.l}" y="${H}" font-size="9" fill="#9ca3af">${chartData[0].date.slice(5)}</text>
    <text x="${W - pad.r}" y="${H}" font-size="9" fill="#9ca3af" text-anchor="end">${chartData[chartData.length - 1].date.slice(5)}</text>
    <text x="${pad.l - 4}" y="${pad.t + 6}" font-size="9" fill="#9ca3af" text-anchor="end">${maxVal}</text>
  </svg>`;
  }
  function renderPanel() {
    if (!panelEl) return;
    const body = panelEl.querySelector("#ihn-panel-body");
    const titleEl = panelEl.querySelector("#ihn-panel-title");
    const subtitleEl = panelEl.querySelector("#ihn-panel-subtitle");
    const eventShort = shortEventName(document.querySelector("h1")?.textContent?.trim() ?? document.title);
    if (state.type === "scanning") {
      const pct = state.total > 0 ? Math.round(state.done / state.total * 100) : 0;
      const eta = state.total > 0 ? etaString(state.done, state.total, state.startTime) : "";
      titleEl.textContent = eventShort || "Scanning attendees\u2026";
      subtitleEl.textContent = "";
      body.innerHTML = `
      <div class="ihn-scanning-name">Scanning <strong>${escHtml(state.current || "...")}</strong></div>
      <div class="ihn-progress-bar-bg">
        <div class="ihn-progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="ihn-progress-meta">
        <span>${state.done}/${state.total}</span>
        <span>${eta}</span>
      </div>
    `;
    } else if (state.type === "results") {
      titleEl.textContent = "Ready to connect";
      subtitleEl.textContent = eventShort;
      const charCount = noteValue.length;
      const allContacts = enrichedContacts;
      const leadsHtml = allContacts.map((c) => {
        const parts = c.name.trim().split(/\s+/);
        const initials = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
        const hasLI = !!c.linkedInUrl;
        const hasIG = !!c.instagramUrl;
        const hasX = !!c.twitterUrl;
        return `
        <div class="ihn-lead-row">
          <div class="ihn-lead-initials">${escHtml(initials)}</div>
          <div class="ihn-lead-name">${escHtml(c.name)}</div>
          <div class="ihn-lead-badges">
            ${hasLI ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="ihn-badge ihn-badge-li">in</a>` : ""}
            ${hasIG ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="ihn-badge ihn-badge-ig">ig</a>` : ""}
            ${hasX ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="ihn-badge ihn-badge-x">x</a>` : ""}
            ${!hasLI && !hasIG && !hasX ? '<span class="ihn-lead-none">\u2013</span>' : ""}
          </div>
        </div>
      `;
      }).join("");
      body.innerHTML = `
      <div class="ihn-results-header">
        <div class="ihn-found-count">${icons.check} Found LinkedIn for ${state.found}/${state.total}</div>
        <button id="ihn-export-csv" title="Export CSV" class="ihn-export-btn">${icons.download} CSV</button>
      </div>
      <div class="ihn-found-label">${state.found} people to connect with.</div>

      ${allContacts.length > 0 ? `<div class="ihn-leads-list">${leadsHtml}</div>` : ""}

      <div class="ihn-label">
        Message <span class="ihn-char-count" id="ihn-char-count">(optional) ${charCount}/${MAX_NOTE}</span>
      </div>
      <textarea id="ihn-note-textarea" maxlength="${MAX_NOTE}">${escHtml(noteValue)}</textarea>

      ${!state.eventId ? `
      <div class="ihn-login-gate">
        <div class="ihn-login-label">Log in to auto-connect with contacts on LinkedIn</div>
        <input id="ihn-login-email" type="email" placeholder="Email" class="ihn-login-input" autocomplete="email" />
        <input id="ihn-login-password" type="password" placeholder="Password" class="ihn-login-input" autocomplete="current-password" />
        <div class="ihn-login-error" id="ihn-login-error"></div>
        <button id="ihn-login-submit" class="ihn-cta-btn ihn-cta-btn-primary">
          ${authMode === "signup" ? "Create account" : "Sign in"}
        </button>
        <div class="ihn-auth-toggle">
          ${authMode === "signup" ? 'Already have an account? <button class="ihn-auth-toggle-btn" id="ihn-toggle-mode">Sign in</button>' : 'New here? <button class="ihn-auth-toggle-btn" id="ihn-toggle-mode">Create account</button>'}
        </div>
      </div>
      ` : `
      <div class="ihn-linkedin-status ${state.linkedInReady ? "ihn-ok" : "ihn-warn"}">
        ${state.linkedInReady ? `${icons.check} LinkedIn ready` : `${icons.warning} Not logged into LinkedIn \xA0<a class="ihn-open-linkedin" href="https://www.linkedin.com/login" target="_blank">Open LinkedIn ${icons.externalLink}</a>`}
      </div>

      <button id="ihn-connect-btn" ${state.linkedInReady ? "" : "disabled"}>
        Connect on LinkedIn ${icons.arrowRight}
      </button>
      `}
    `;
      panelEl.querySelector("#ihn-note-textarea")?.addEventListener("input", (e) => {
        noteValue = e.target.value;
        const cc = panelEl?.querySelector("#ihn-char-count");
        if (cc) cc.textContent = `(optional) ${noteValue.length}/${MAX_NOTE}`;
      });
      panelEl.querySelector("#ihn-connect-btn")?.addEventListener("click", handleLaunch);
      if (!state.eventId) {
        panelEl.querySelector("#ihn-login-submit")?.addEventListener("click", handleInlineLogin);
        panelEl.querySelector("#ihn-login-password")?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") handleInlineLogin();
        });
        panelEl.querySelector("#ihn-toggle-mode")?.addEventListener("click", () => {
          authMode = authMode === "signup" ? "signin" : "signup";
          renderPanel();
        });
      }
      panelEl.querySelector("#ihn-export-csv")?.addEventListener("click", () => {
        if (state.type !== "results") return;
        const rawSlug = state.eventName.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase();
        const slug = rawSlug.length > 30 ? rawSlug.slice(0, 31).replace(/_[^_]*$/, "") : rawSlug;
        const rows = [
          [state.eventName + " Contact List"],
          [state.eventLocation],
          [],
          ["Name", "LinkedIn", "X", "Instagram", "Luma", "Type"]
        ];
        enrichedContacts.forEach(
          (c) => rows.push([c.name, c.linkedInUrl, c.twitterUrl, c.instagramUrl, c.url, c.isHost ? "host" : "guest"])
        );
        const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = `luma_${slug}_contacts.csv`;
        a.click();
      });
      if (!state.linkedInReady) {
        const poll = setInterval(async () => {
          const ready = await checkLinkedInLogin();
          if (ready && state.type === "results") {
            clearInterval(poll);
            state = { ...state, linkedInReady: true };
            renderPanel();
          }
        }, 3e3);
      }
    } else if (state.type === "launched") {
      titleEl.textContent = shortEventName(document.querySelector("h1")?.textContent?.trim() ?? document.title);
      subtitleEl.textContent = "";
      body.innerHTML = `
      <div class="ihn-launched-icon">${icons.checkCircle}</div>
      <div class="ihn-launched-title">Running in background</div>
      <div class="ihn-launched-sub">
        ${state.queued} connections queued
      </div>
      <div class="ihn-launched-note">Chrome connects people automatically. You don't need to stay on this page.</div>
      <button id="ihn-view-contacts" class="ihn-cta-btn ihn-cta-btn-primary" style="margin-top:12px">
        View contacts ${icons.arrowRight}
      </button>
      <button id="ihn-scan-another" class="ihn-cta-btn ihn-cta-btn-secondary" style="margin-top:8px">Scan another event</button>
    `;
      panelEl?.querySelector("#ihn-view-contacts")?.addEventListener("click", () => {
        state = { type: "progress" };
        renderPanel();
        chrome.runtime.sendMessage({ type: "GET_PAUSED_EVENTS" }, (resp) => {
          pausedEvents = resp?.pausedEvents ?? [];
        });
        chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, (resp) => {
          progressData = resp;
          if (state.type === "progress") renderPanel();
        });
        if (progressRefreshTimer) clearInterval(progressRefreshTimer);
        progressRefreshTimer = setInterval(() => {
          if (state.type !== "progress") {
            clearInterval(progressRefreshTimer);
            progressRefreshTimer = null;
            return;
          }
          chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, (resp) => {
            progressData = resp;
            if (state.type === "progress") renderPanel();
          });
        }, 3e4);
      });
      panelEl?.querySelector("#ihn-scan-another")?.addEventListener("click", () => {
        state = { type: "idle" };
        enrichedContacts = [];
        noteValue = "";
        closePanel();
      });
    } else if (state.type === "progress") {
      titleEl.textContent = "Progress";
      subtitleEl.textContent = "";
      const data = progressData;
      if (exportPickerOpen) {
        body.innerHTML = `
        <div class="ihn-export-picker">
          <p class="ihn-export-picker-title">Select events to export</p>
          <div class="ihn-export-picker-list">
            ${(data?.events ?? []).map((event) => `
              <label class="ihn-export-picker-row">
                <input type="checkbox" class="ihn-event-checkbox" value="${escHtml(event.id)}" checked>
                <span>${escHtml(event.name ?? "Untitled event")}</span>
              </label>
            `).join("")}
          </div>
          <div class="ihn-export-picker-actions">
            <button id="ihn-export-cancel-btn">Cancel</button>
            <button id="ihn-export-confirm-btn" class="ihn-export-btn">&#8681; Export CSV</button>
          </div>
        </div>
      `;
        panelEl.querySelector("#ihn-export-cancel-btn")?.addEventListener("click", () => {
          exportPickerOpen = false;
          renderPanel();
        });
        panelEl.querySelector("#ihn-export-confirm-btn")?.addEventListener("click", () => {
          if (!progressData) return;
          const checked = new Set(
            Array.from(panelEl.querySelectorAll(".ihn-event-checkbox:checked")).map((cb) => cb.value)
          );
          const rows = [["Event", "Name", "LinkedIn", "Instagram"]];
          for (const event of progressData.events) {
            if (!checked.has(event.id)) continue;
            for (const c of event.contacts ?? []) {
              rows.push([event.name ?? "", c.name ?? "", c.linkedin_url ?? "", c.instagram_url ?? ""]);
            }
          }
          const csv = rows.map((r) => r.map((v) => `"${(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
          a.download = "ihn_contacts.csv";
          a.click();
          exportPickerOpen = false;
        });
        return;
      }
      let totalSent = 0;
      let totalPending = 0;
      for (const event of data?.events ?? []) {
        for (const c of event.contacts ?? []) {
          const s2 = c.connection_queue?.[0]?.status;
          if (["sent", "accepted"].includes(s2)) totalSent++;
          else if (s2 === "pending") totalPending++;
        }
      }
      const topLabel = totalSent > 0 ? `${totalSent} sent total` : totalPending > 0 ? `${totalPending} queued \xB7 sending soon` : "0 sent";
      body.innerHTML = `
      <div class="ihn-chart-wrap">
        ${data ? renderChart(data.chartData) : '<p class="ihn-chart-empty">Loading\u2026</p>'}
      </div>
      <div class="ihn-results-header">
        <p class="ihn-total-sent">${topLabel}</p>
        <button id="ihn-progress-export-csv" title="Export CSV" class="ihn-export-btn">${icons.download} CSV</button>
      </div>
      <div class="ihn-events-list">
        ${(data?.events ?? []).map((event) => {
        const contacts = event.contacts ?? [];
        const sentCount = contacts.filter(
          (c) => ["sent", "accepted"].includes(c.connection_queue?.[0]?.status)
        ).length;
        const pendingCount = contacts.filter(
          (c) => c.connection_queue?.[0]?.status === "pending"
        ).length;
        const isEventPaused = pausedEvents.includes(event.id);
        const expanded = expandedEvents.has(event.id);
        const eventBadge = sentCount > 0 ? `<span class="ihn-event-badge">${sentCount} sent</span>` : pendingCount > 0 ? `<span class="ihn-event-badge ihn-event-badge-queued">${pendingCount} queued</span>` : "";
        return `<div class="ihn-event-row" data-event-id="${escHtml(event.id)}">
            <div class="ihn-event-header">
              <span class="ihn-event-chevron">${expanded ? icons.chevronDown : icons.chevronRight}</span>
              <span class="ihn-event-name">${escHtml(event.name ?? "Untitled event")}</span>
              ${eventBadge}
              ${pendingCount > 0 ? `<button class="ihn-event-pause-btn" data-event-id="${escHtml(event.id)}" data-paused="${isEventPaused}">${isEventPaused ? icons.play + " Resume" : icons.pause + " Pause"}</button>` : ""}
            </div>
            ${expanded ? `<div class="ihn-event-contacts">${contacts.map((c) => {
          const status = c.connection_queue?.[0]?.status ?? "pending";
          const error = c.connection_queue?.[0]?.error ?? "";
          const showStatus = status !== "pending";
          const errorLabel = {
            already_pending: "Already sent on LinkedIn",
            already_connected: "Already connected",
            third_degree: "3rd degree \u2014 can't connect directly",
            connect_not_available: "Connect not available on their profile",
            send_btn_not_found: "LinkedIn UI changed \u2014 will retry",
            no_linkedin_url: "No LinkedIn profile found",
            note_quota_reached: "Free note quota reached"
          }[error] ?? (error ? error : "");
          const linkedInUrl = c.linkedin_url ?? "";
          const instagramUrl = c.instagram_url ?? "";
          return `<div class="ihn-contact-row">
                <span class="ihn-contact-name">${escHtml(c.name ?? "\u2014")}</span>
                <div class="ihn-contact-right">
                  ${linkedInUrl ? `<a href="${escHtml(linkedInUrl)}" target="_blank" class="ihn-badge ihn-badge-li" onclick="event.stopPropagation()">in</a>` : ""}
                  ${instagramUrl ? `<a href="${escHtml(instagramUrl)}" target="_blank" class="ihn-badge ihn-badge-ig" onclick="event.stopPropagation()">ig</a>` : ""}
                  ${showStatus ? `<span class="ihn-status-badge ihn-status-${escHtml(status)}">${escHtml(status)}</span>` : ""}
                  ${showStatus && errorLabel ? `<span class="ihn-error-tip" title="${escHtml(errorLabel)}">?</span>` : ""}
                </div>
              </div>`;
        }).join("")}</div>` : ""}
          </div>`;
      }).join("")}
        ${!data || data.events.length === 0 ? '<p class="ihn-empty">No events yet.</p>' : ""}
      </div>
    `;
      panelEl.querySelectorAll(".ihn-event-pause-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const evId = btn.dataset.eventId;
          const isPaused = btn.dataset.paused === "true";
          chrome.runtime.sendMessage({ type: isPaused ? "RESUME_EVENT" : "PAUSE_EVENT", eventId: evId }, () => {
            pausedEvents = isPaused ? pausedEvents.filter((id) => id !== evId) : [...pausedEvents, evId];
            renderPanel();
          });
        });
      });
      panelEl.querySelectorAll(".ihn-event-header").forEach((header) => {
        header.addEventListener("click", () => {
          const row = header.closest("[data-event-id]");
          const id = row?.dataset.eventId;
          if (!id) return;
          if (expandedEvents.has(id)) expandedEvents.delete(id);
          else expandedEvents.add(id);
          renderPanel();
        });
      });
      panelEl.querySelector("#ihn-progress-export-csv")?.addEventListener("click", () => {
        exportPickerOpen = true;
        renderPanel();
      });
      return;
    } else if (state.type === "contacts") {
      titleEl.textContent = "Contacts";
      subtitleEl.textContent = "";
      const leadsHtml = enrichedContacts.map((c) => {
        const parts = c.name.trim().split(/\s+/);
        const initials = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
        const hasLI = !!c.linkedInUrl;
        const hasIG = !!c.instagramUrl;
        const hasX = !!c.twitterUrl;
        const status = c.linkedInUrl ? contactStatuses.get(c.linkedInUrl) ?? null : null;
        const statusDot = status === "sent" || status === "accepted" ? '<span class="ihn-status-dot ihn-status-sent">\u25CF</span>' : status === "failed" ? '<span class="ihn-status-dot ihn-status-failed">\u25CF</span>' : status === "pending" ? '<span class="ihn-status-dot ihn-status-pending">\u25CF</span>' : "";
        return `
        <div class="ihn-lead-row">
          <div class="ihn-lead-initials">${escHtml(initials)}</div>
          <div class="ihn-lead-name">${escHtml(c.name)}</div>
          <div class="ihn-lead-badges">
            ${statusDot}
            ${hasLI ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="ihn-badge ihn-badge-li">in</a>` : ""}
            ${hasIG ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="ihn-badge ihn-badge-ig">ig</a>` : ""}
            ${hasX ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="ihn-badge ihn-badge-x">x</a>` : ""}
            ${!hasLI && !hasIG && !hasX ? '<span class="ihn-lead-none">\u2013</span>' : ""}
          </div>
        </div>
      `;
      }).join("");
      body.innerHTML = `
      <div class="ihn-leads-list" style="max-height:none">${leadsHtml || '<div style="padding:16px;color:#888">No contacts found.</div>'}</div>
      <button id="ihn-back-btn" class="ihn-cta-btn ihn-cta-btn-secondary" style="margin-top:8px">${icons.arrowLeft} Back</button>
    `;
      panelEl?.querySelector("#ihn-back-btn")?.addEventListener("click", () => {
        if (state.type !== "contacts") return;
        state = { type: "launched", queued: state.queued, eventId: state.eventId };
        renderPanel();
      });
    } else if (state.type === "already_scanned") {
      titleEl.textContent = eventShort || "Event";
      subtitleEl.textContent = "";
      body.innerHTML = `
      <div class="ihn-already-scanned">
        <div class="ihn-already-count">${icons.check} ${state.count} contacts saved &middot; ${state.linkedInCount} have LinkedIn</div>
        ${state.noNew ? '<div class="ihn-already-nonew">No new attendees found</div>' : ""}
        <button id="ihn-view-results-btn" class="ihn-cta-btn ihn-cta-btn-primary">View results ${icons.arrowRight}</button>
        <button id="ihn-scan-new-btn" class="ihn-cta-btn ihn-cta-btn-secondary">Scan for new attendees</button>
      </div>
    `;
      panelEl.querySelector("#ihn-view-results-btn")?.addEventListener("click", async () => {
        if (state.type !== "already_scanned") return;
        const linkedInReady = await checkLinkedInLogin();
        state = {
          type: "results",
          found: state.linkedInCount,
          total: state.count,
          eventId: state.eventId,
          linkedInReady,
          eventName: state.eventName,
          eventLocation: state.eventLocation
        };
        renderPanel();
      });
      panelEl.querySelector("#ihn-scan-new-btn")?.addEventListener("click", () => {
        handleImportClick(true);
      });
    }
  }
  function handleInlineLogin() {
    const emailEl = panelEl?.querySelector("#ihn-login-email");
    const passEl = panelEl?.querySelector("#ihn-login-password");
    const btn = panelEl?.querySelector("#ihn-login-submit");
    const errEl = panelEl?.querySelector("#ihn-login-error");
    if (!emailEl || !passEl || !btn || !errEl) return;
    btn.disabled = true;
    errEl.textContent = "";
    const isSignup = authMode === "signup";
    btn.textContent = isSignup ? "Creating account\u2026" : "Signing in\u2026";
    const msgType = isSignup ? "SIGN_UP" : "SIGN_IN";
    chrome.runtime.sendMessage(
      { type: msgType, data: { email: emailEl.value, password: passEl.value } },
      (result) => {
        if (chrome.runtime.lastError || !result?.success) {
          btn.disabled = false;
          btn.textContent = isSignup ? "Create account" : "Sign in";
          errEl.textContent = result?.error ?? chrome.runtime.lastError?.message ?? (isSignup ? "Sign up failed" : "Sign in failed");
          return;
        }
        if (isSignup && result.sessionReady === false) {
          errEl.style.color = "#059669";
          errEl.textContent = "Check your email to confirm, then sign in here";
          btn.disabled = false;
          btn.textContent = "Create account";
          authMode = "signin";
          renderPanel();
          return;
        }
        btn.textContent = "Saving contacts\u2026";
        const eventName = state.type === "results" ? state.eventName : "";
        chrome.runtime.sendMessage(
          { type: "START_ENRICHMENT", data: { lumaUrl: location.href, eventName, contacts: enrichedContacts } },
          (saveResult) => {
            if (chrome.runtime.lastError || !saveResult?.eventId) {
              btn.disabled = false;
              btn.textContent = isSignup ? "Create account" : "Sign in";
              errEl.style.color = "#dc2626";
              errEl.textContent = "Saved session but couldn't save contacts \u2014 try again";
              return;
            }
            if (state.type === "results") {
              state = { ...state, eventId: saveResult.eventId };
              renderPanel();
            }
          }
        );
      }
    );
  }
  function handleLaunch() {
    if (state.type !== "results") return;
    const contactsWithLI = enrichedContacts.filter((c) => c.linkedInUrl);
    const connectBtn = panelEl?.querySelector("#ihn-connect-btn");
    if (connectBtn) {
      connectBtn.disabled = true;
      connectBtn.textContent = "Launching\u2026";
    }
    chrome.runtime.sendMessage(
      {
        type: "LAUNCH_CAMPAIGN",
        data: {
          eventId: state.eventId,
          note: noteValue,
          lumaUrl: location.href,
          eventName: state.eventName,
          contacts: contactsWithLI.map((c) => ({
            url: c.url,
            name: c.name,
            linkedInUrl: c.linkedInUrl,
            isHost: c.isHost,
            instagramUrl: c.instagramUrl
          }))
        }
      },
      (result) => {
        if (!result?.queued) {
          if (connectBtn) {
            connectBtn.disabled = false;
            connectBtn.textContent = "Connect on LinkedIn \u2192";
          }
          const errEl = panelEl?.querySelector(".ihn-linkedin-status");
          if (errEl) errEl.innerHTML = "&#9888; Couldn't save \u2014 check you're logged into the dashboard";
          return;
        }
        if (state.type !== "results") return;
        state = { type: "progress" };
        progressData = null;
        renderPanel();
        chrome.runtime.sendMessage({ type: "GET_PAUSED_EVENTS" }, (resp) => {
          pausedEvents = resp?.pausedEvents ?? [];
        });
        chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, (resp) => {
          progressData = resp;
          if (state.type === "progress") renderPanel();
        });
        if (progressRefreshTimer) clearInterval(progressRefreshTimer);
        progressRefreshTimer = setInterval(() => {
          if (state.type !== "progress") {
            clearInterval(progressRefreshTimer);
            progressRefreshTimer = null;
            return;
          }
          chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, (resp) => {
            progressData = resp;
            if (state.type === "progress") renderPanel();
          });
        }, 3e4);
      }
    );
  }
  async function handleImportClick(rescan = false) {
    authMode = "signup";
    openPanel();
    state = { type: "scanning", current: "Gathering attendees\u2026", done: 0, total: 0, startTime: Date.now() };
    renderPanel();
    const { eventName, eventLocation, hostProfileUrls, guestProfileUrls } = await scrapeLuma();
    const allUrls = [
      ...hostProfileUrls.map((u) => ({ url: u, isHost: true })),
      ...guestProfileUrls.map((u) => ({ url: u, isHost: false }))
    ];
    const { eventId: cachedEventId, existingUrls, linkedInCount, contacts: existingContacts } = await new Promise(
      (resolve) => chrome.runtime.sendMessage({ type: "GET_EVENT_BY_URL", lumaUrl: location.href }, resolve)
    );
    const existingSet = new Set(existingUrls);
    const toEnrich = existingUrls.length > 0 ? allUrls.filter((u) => !existingSet.has(u.url)) : allUrls;
    if (toEnrich.length === 0) {
      state = { type: "progress" };
      progressData = null;
      renderPanel();
      chrome.runtime.sendMessage({ type: "GET_PAUSED_EVENTS" }, (resp) => {
        pausedEvents = resp?.pausedEvents ?? [];
      });
      chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, (resp) => {
        progressData = resp;
        if (state.type === "progress") renderPanel();
      });
      if (progressRefreshTimer) clearInterval(progressRefreshTimer);
      progressRefreshTimer = setInterval(() => {
        if (state.type !== "progress") {
          clearInterval(progressRefreshTimer);
          progressRefreshTimer = null;
          return;
        }
        chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, (resp) => {
          progressData = resp;
          if (state.type === "progress") renderPanel();
        });
      }, 3e4);
      return;
    }
    const total = toEnrich.length;
    const startTime = Date.now();
    const enriched = [];
    for (let i = 0; i < toEnrich.length; i++) {
      const { url, isHost } = toEnrich[i];
      let displayName = "";
      let linkedInUrl = "";
      let instagramUrl = "";
      let twitterUrl = "";
      try {
        const resp = await fetch(url, { credentials: "include" });
        if (resp.ok) {
          const html = await resp.text();
          displayName = extractDisplayNameFromHtml(html);
          linkedInUrl = extractLinkedInUrlFromHtml(html);
          instagramUrl = extractInstagramUrlFromHtml(html);
          twitterUrl = extractTwitterUrlFromHtml(html);
        }
      } catch {
      }
      const fallbackName = url.split("/").pop()?.replace(/-/g, " ") ?? "Unknown";
      const name = displayName || fallbackName;
      enriched.push({ url, isHost, name, linkedInUrl, instagramUrl, twitterUrl });
      state = { type: "scanning", current: name, done: i + 1, total, startTime };
      renderPanel();
    }
    enrichedContacts = enriched;
    chrome.runtime.sendMessage(
      { type: "START_ENRICHMENT", data: { lumaUrl: location.href, eventName, contacts: enriched } },
      (result) => {
        if (chrome.runtime.lastError) console.warn("[IHN] START_ENRICHMENT:", chrome.runtime.lastError.message);
        checkLinkedInLogin().then((linkedInReady) => {
          noteValue = defaultNote(eventName);
          state = {
            type: "results",
            found: enriched.filter((c) => c.linkedInUrl).length + linkedInCount,
            total: enriched.length + existingUrls.length,
            eventId: result?.eventId ?? cachedEventId ?? "",
            linkedInReady,
            eventName,
            eventLocation
          };
          renderPanel();
        });
      }
    );
  }
  function createPanel() {
    panelEl = document.createElement("div");
    panelEl.id = "ihn-panel";
    panelEl.innerHTML = `
    <div id="ihn-panel-header">
      <div>
        <div id="ihn-panel-title">Importing contacts\u2026</div>
        <div id="ihn-panel-subtitle"></div>
      </div>
      <button id="ihn-close-btn" aria-label="Close">${icons.xMark}</button>
    </div>
    <div id="ihn-panel-body"></div>
  `;
    document.body.appendChild(panelEl);
    panelEl.querySelector("#ihn-close-btn").addEventListener("click", closePanel);
  }
  function openPanel() {
    if (!panelEl) createPanel();
    requestAnimationFrame(() => panelEl?.classList.add("ihn-open"));
  }
  function closePanel() {
    panelEl?.classList.remove("ihn-open");
    if (progressRefreshTimer) {
      clearInterval(progressRefreshTimer);
      progressRefreshTimer = null;
    }
  }
  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "OPEN_PANEL") {
        handleImportClick();
      }
    });
  }
})();
