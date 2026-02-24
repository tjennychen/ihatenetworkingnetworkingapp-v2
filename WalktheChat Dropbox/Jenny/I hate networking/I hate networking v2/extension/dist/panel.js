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
      const s = getComputedStyle(el);
      if ((s.overflow === "auto" || s.overflow === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 10) {
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
  var authMode = "signup";
  var DEFAULT_NOTE = "Hi [first name], I was also at the event. I'd love to stay connected!";
  var MAX_NOTE = 300;
  async function checkLinkedInLogin() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "CHECK_LINKEDIN_LOGIN" }, (resp) => {
        resolve(resp?.loggedIn ?? false);
      });
    });
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
        <div class="ihn-found-count">&#10003; Found LinkedIn for ${state.found}/${state.total}</div>
        <button id="ihn-export-csv" title="Export CSV" class="ihn-export-btn">&#8681; CSV</button>
      </div>
      <div class="ihn-found-label">Connections will be sent over ~${Math.ceil(state.found / 40)} day(s) at 40/day.</div>

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
        ${state.linkedInReady ? "&#10003; LinkedIn ready" : '&#9888;&#65039; Not logged into LinkedIn \xA0<a class="ihn-open-linkedin" href="https://www.linkedin.com/login" target="_blank">Open LinkedIn &#8599;</a>'}
      </div>

      <button id="ihn-connect-btn" ${state.linkedInReady ? "" : "disabled"}>
        Connect on LinkedIn &rarr;
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
      <div class="ihn-launched-icon">&#10003;</div>
      <div class="ihn-launched-title">Running in background</div>
      <div class="ihn-launched-sub">
        ${state.queued} connections queued${state.queued > 0 ? ` &middot; ~${Math.ceil(state.queued / 40)} day(s) at 40/day` : ""}
      </div>
      <div class="ihn-launched-note">Chrome connects people automatically. You don't need to stay on this page.</div>
      <button id="ihn-scan-another" class="ihn-cta-btn ihn-cta-btn-secondary">Scan another event</button>
    `;
      panelEl?.querySelector("#ihn-scan-another")?.addEventListener("click", () => {
        state = { type: "idle" };
        enrichedContacts = [];
        noteValue = "";
        closePanel();
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
        if (!result?.success) {
          btn.disabled = false;
          btn.textContent = isSignup ? "Create account" : "Sign in";
          errEl.textContent = result?.error ?? (isSignup ? "Sign up failed" : "Sign in failed");
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
        state = { type: "launched", queued: result.queued, eventId: result.eventId || state.eventId };
        renderPanel();
      }
    );
  }
  async function handleImportClick() {
    authMode = "signup";
    openPanel();
    state = { type: "scanning", current: "Gathering attendees\u2026", done: 0, total: 0, startTime: Date.now() };
    renderPanel();
    const { eventName, eventLocation, hostProfileUrls, guestProfileUrls } = await scrapeLuma();
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
    const guests = enriched.filter((c) => !c.isHost);
    chrome.runtime.sendMessage(
      { type: "START_ENRICHMENT", data: { lumaUrl: location.href, eventName, contacts: enriched } },
      (result) => {
        if (chrome.runtime.lastError) console.warn("[IHN] START_ENRICHMENT:", chrome.runtime.lastError.message);
        checkLinkedInLogin().then((linkedInReady) => {
          noteValue = DEFAULT_NOTE;
          state = {
            type: "results",
            found: enriched.filter((c) => c.linkedInUrl).length,
            total: enriched.length,
            eventId: result?.eventId ?? "",
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
    });
  }
})();
