"use strict";
(() => {
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
  async function scrapeLuma() {
    const eventName = document.querySelector("h1")?.textContent?.trim() ?? document.title;
    const labels = ["Guests", "Going", "Attendees", "See all"];
    for (const label of labels) {
      const btn = Array.from(document.querySelectorAll('button, [role="button"]')).find((b) => b.textContent?.includes(label));
      if (btn) {
        btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1e3));
    const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="guest-list"]');
    await scrollToLoadAll(modal ?? document.scrollingElement);
    const hostProfileUrls = extractHostProfileUrlsFromDoc(document);
    const allLinks = parseGuestLinksFromDoc(document);
    const hostSet = new Set(hostProfileUrls);
    const guestProfileUrls = allLinks.filter((u) => !hostSet.has(u));
    return { eventName, hostProfileUrls, guestProfileUrls };
  }
  function extractLinkedInUrlFromHtml(html) {
    const match = html.match(/href="(https:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\/[^"?#]+)[^"]*"/);
    return match ? match[1] : "";
  }
  function extractDisplayNameFromHtml(html) {
    const titleMatch = html.match(/<title>\s*([^|<\n]+?)\s*(?:\||<)/);
    if (titleMatch) return titleMatch[1].trim();
    const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/);
    if (ogMatch) return ogMatch[1].trim();
    return "";
  }
  var state = { type: "idle" };
  var panelEl = null;
  var noteValue = "";
  var DEFAULT_NOTE = "Hi [first name], I was also at the event. I'd love to stay connected!";
  var MAX_NOTE = 300;
  async function checkLinkedInLogin() {
    try {
      const resp = await fetch("https://www.linkedin.com/feed/", {
        credentials: "include",
        redirect: "manual"
      });
      return resp.type !== "opaqueredirect" && resp.status === 200;
    } catch {
      return false;
    }
  }
  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function etaString(done, total, startTime) {
    if (done === 0) return "";
    const elapsed = (Date.now() - startTime) / 1e3;
    const perItem = elapsed / done;
    const remaining = Math.ceil((total - done) * perItem);
    if (remaining < 60) return `~${remaining}s remaining`;
    return `~${Math.ceil(remaining / 60)} min remaining`;
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
      body.innerHTML = `
      <div class="ihn-found-count">&#10003; Found LinkedIn for ${state.found}/${state.total}</div>
      <div class="ihn-found-label">Connections will be sent over ~${Math.ceil(state.found / 40)} day(s) at 40/day.</div>

      <div class="ihn-label">
        Message <span class="ihn-char-count" id="ihn-char-count">(optional) ${charCount}/${MAX_NOTE}</span>
      </div>
      <textarea id="ihn-note-textarea" maxlength="${MAX_NOTE}">${escHtml(noteValue)}</textarea>

      <div class="ihn-linkedin-status ${state.linkedInReady ? "ihn-ok" : "ihn-warn"}">
        ${state.linkedInReady ? "&#10003; LinkedIn ready" : '&#9888;&#65039; Not logged into LinkedIn \xA0<a class="ihn-open-linkedin" href="https://www.linkedin.com/login" target="_blank">Open LinkedIn &#8599;</a>'}
      </div>

      <button id="ihn-connect-btn" ${state.linkedInReady ? "" : "disabled"}>
        Connect on LinkedIn &rarr;
      </button>
    `;
      panelEl.querySelector("#ihn-note-textarea")?.addEventListener("input", (e) => {
        noteValue = e.target.value;
        const cc = panelEl?.querySelector("#ihn-char-count");
        if (cc) cc.textContent = `(optional) ${noteValue.length}/${MAX_NOTE}`;
      });
      panelEl.querySelector("#ihn-connect-btn")?.addEventListener("click", handleLaunch);
    } else if (state.type === "launched") {
      const dashUrl = `http://localhost:3000/campaigns/${state.eventId}`;
      const postUrl = `http://localhost:3000/post`;
      titleEl.textContent = "Campaign launched!";
      subtitleEl.textContent = "";
      body.innerHTML = `
      <div class="ihn-launched-icon">&#9989;</div>
      <div class="ihn-launched-title">Campaign launched!</div>
      <div class="ihn-launched-sub">${state.queued} connections queued &middot; done in ~${Math.ceil(Math.max(state.queued, 1) / 40)} day(s)</div>
      <a class="ihn-cta-btn ihn-cta-btn-secondary" href="${dashUrl}" target="_blank">View Campaign &rarr;</a>
      <a class="ihn-cta-btn ihn-cta-btn-primary" href="${postUrl}" target="_blank">Draft your event post &rarr;</a>
    `;
    }
  }
  function handleLaunch() {
    if (state.type !== "results") return;
    const connectBtn = panelEl?.querySelector("#ihn-connect-btn");
    if (connectBtn) {
      connectBtn.disabled = true;
      connectBtn.textContent = "Launching\u2026";
    }
    const eventId = state.eventId;
    chrome.runtime.sendMessage(
      { type: "LAUNCH_CAMPAIGN", data: { eventId, note: noteValue } },
      (result) => {
        state = { type: "launched", queued: result?.queued ?? 0, eventId };
        renderPanel();
      }
    );
  }
  async function handleImportClick() {
    openPanel();
    state = { type: "scanning", current: "Gathering attendees\u2026", done: 0, total: 0, startTime: Date.now() };
    renderPanel();
    const { eventName, hostProfileUrls, guestProfileUrls } = await scrapeLuma();
    const allUrls = [
      ...hostProfileUrls.map((u) => ({ url: u, isHost: true })),
      ...guestProfileUrls.map((u) => ({ url: u, isHost: false }))
    ];
    const total = allUrls.length;
    const startTime = Date.now();
    const enriched = [];
    for (let i = 0; i < allUrls.length; i++) {
      const { url, isHost } = allUrls[i];
      let displayName = "";
      let linkedInUrl = "";
      try {
        const resp = await fetch(url, { credentials: "include" });
        if (resp.ok) {
          const html = await resp.text();
          displayName = extractDisplayNameFromHtml(html);
          linkedInUrl = extractLinkedInUrlFromHtml(html);
        }
      } catch {
      }
      const fallbackName = url.split("/").pop()?.replace(/-/g, " ") ?? "Unknown";
      const name = displayName || fallbackName;
      enriched.push({ url, isHost, name, linkedInUrl });
      state = { type: "scanning", current: name, done: i + 1, total, startTime };
      renderPanel();
    }
    chrome.runtime.sendMessage({
      type: "START_ENRICHMENT",
      data: { lumaUrl: location.href, eventName, contacts: enriched }
    });
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
      <button id="ihn-close-btn" aria-label="Close">&times;</button>
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
  }
  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "OPEN_PANEL") {
        handleImportClick();
      }
      if (msg.type === "ENRICH_COMPLETE") {
        checkLinkedInLogin().then((linkedInReady) => {
          noteValue = DEFAULT_NOTE;
          state = {
            type: "results",
            found: msg.found,
            total: msg.total,
            eventId: msg.eventId,
            linkedInReady
          };
          renderPanel();
        });
      }
    });
  }
})();
