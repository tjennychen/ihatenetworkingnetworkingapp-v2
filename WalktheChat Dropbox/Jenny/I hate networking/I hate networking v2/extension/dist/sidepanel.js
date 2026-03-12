"use strict";
(() => {
  // sidepanel/sidepanel.ts
  var scanState = { type: "idle" };
  var noteValue = "";
  var MAX_NOTE = 300;
  var DASHBOARD_LOGIN_URL = "https://ihatenetworking.space/login";
  var expandedEvents = /* @__PURE__ */ new Set();
  var exportMode = false;
  var exportSelected = /* @__PURE__ */ new Set();
  var draftState = "closed";
  var draftViewOpen = false;
  var draftNamesStartTime = 0;
  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function initials(name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  function generateCsv(selectedIds, events) {
    const rows = ["Event,Name,LinkedIn URL,Instagram,Twitter,Website"];
    for (const ev of events) {
      if (!selectedIds.has(ev.id ?? "")) continue;
      for (const c of ev.contacts ?? []) {
        const row = [ev.name ?? "", c.name ?? "", c.linkedin_url ?? "", c.instagram_url ?? "", c.twitter_url ?? "", c.website_url ?? ""].map((v) => `"${v.replace(/"/g, '""')}"`).join(",");
        rows.push(row);
      }
    }
    return rows.join("\n");
  }
  function downloadCsv(csv) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "connections.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  var nonEventPaths = ["", "/", "/home", "/calendar", "/events", "/discover", "/explore", "/settings", "/dashboard"];
  function isLumaEventPath(pathname) {
    return !nonEventPaths.includes(pathname) && pathname.split("/").length === 2;
  }
  function shortEventLabel(name) {
    let s = name.split(/[:\|]/)[0];
    s = s.replace(/\s*[-–—]\s*(Open Registration|Waitlist|Registration|RSVP|Sign Up).*$/i, "");
    s = s.replace(/#\d+/g, "");
    s = s.trim();
    if (!s) return "event";
    const words = s.split(/\s+/);
    if (words.length <= 4) return s.toLowerCase();
    const m = s.match(/\b(hackathon|meetup|mixer|workshop|night|summit|conference|brunch|social|happy hour|bootcamp|jam|sprint|demo day|pitch night|office hours)\b/i);
    if (m && m.index !== void 0) return s.slice(0, m.index + m[0].length).trim().toLowerCase();
    return words.slice(0, 3).join(" ").toLowerCase();
  }
  function defaultNote(eventName) {
    const raw = eventName.split("\xB7")[0].trim();
    const label = shortEventLabel(raw);
    return `I saw you at the ${label}, I'd like to stay in touch!`;
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
  async function hasSession() {
    const { session } = await chrome.storage.local.get("session");
    return !!session;
  }
  async function signOut() {
    await new Promise((r) => chrome.runtime.sendMessage({ type: "SIGN_OUT" }, r));
    render();
  }
  async function resolveAppState() {
    const [ctx, storage] = await Promise.all([
      resolveTabContext(),
      chrome.storage.local.get(["queuePending", "campaignPaused"])
    ]);
    const storagePending = storage.queuePending ?? 0;
    const paused = storage.campaignPaused ?? false;
    if (storagePending > 0 || paused) {
      return { type: "campaign", pending: storagePending, paused, ctx };
    }
    const dbResp = await new Promise(
      (r) => chrome.runtime.sendMessage({ type: "GET_PENDING_COUNT" }, r)
    );
    const dbPending = dbResp?.pending ?? 0;
    if (dbPending > 0) {
      await chrome.storage.local.set({ queuePending: dbPending });
      return { type: "campaign", pending: dbPending, paused: false, ctx };
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
          <div class="step-desc">25/day max \xB7 business hours only \xB7 keeps your account safe</div>
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
  async function startDraftFetch(eventId, eventName, state) {
    draftState = { stage: "loading", eventId, eventName, fetching: 0 };
    await renderDraftView(state);
    const resp = await new Promise(
      (resolve) => chrome.runtime.sendMessage({ type: "GET_DRAFT_DATA", eventId }, resolve)
    );
    if (!resp) {
      draftState = "closed";
      draftViewOpen = false;
      render();
      return;
    }
    const { hosts, guests, totalGuests } = resp;
    const isBadName = (n) => !n || /^(LinkedIn|Log In|Sign In|Sign Up)$/i.test(n.trim());
    const needFetch = [
      ...hosts.filter((h) => (!h.linkedin_name || isBadName(h.linkedin_name)) && h.linkedin_url),
      ...guests.filter((g) => (!g.linkedin_name || isBadName(g.linkedin_name)) && g.linkedin_url)
    ];
    if (needFetch.length > 0) {
      draftNamesStartTime = Date.now();
      draftState = { stage: "loading", eventId, eventName, fetching: needFetch.length };
      _draftFetchContext = { eventId, eventName, hosts, guests, totalGuests, state };
      await renderDraftView(state);
    }
    let fetchedNames = [];
    if (needFetch.length > 0) {
      try {
        const raw = await Promise.race([
          new Promise(
            (resolve) => chrome.runtime.sendMessage({ type: "GET_LINKEDIN_NAMES", contacts: needFetch.map((c) => ({ id: c.id, linkedin_url: c.linkedin_url })) }, resolve)
          ),
          new Promise((resolve) => setTimeout(() => resolve(null), 9e4))
        ]);
        fetchedNames = Array.isArray(raw) ? raw : [];
      } catch (e) {
        console.error("[IHN] Name fetch error:", e);
      }
    }
    finishDraft(eventId, eventName, hosts, guests, totalGuests, fetchedNames, state);
  }
  var _draftFetchContext = null;
  function finishDraft(eventId, eventName, hosts, guests, totalGuests, fetchedNames, state) {
    if (draftState === "closed") return;
    if (typeof draftState === "object" && draftState.stage === "ready") return;
    _draftFetchContext = null;
    const isBadName = (n) => !n || /^(LinkedIn|Log In|Sign In|Sign Up)$/i.test(n.trim());
    const fetchedMap = new Map(fetchedNames.filter((f) => f.linkedin_name && !isBadName(f.linkedin_name)).map((f) => [f.id, f.linkedin_name]));
    const nameMap = /* @__PURE__ */ new Map();
    for (const g of [...guests, ...hosts]) nameMap.set(g.id, !isBadName(g.linkedin_name) && g.linkedin_name || g.name || "");
    for (const [id, name] of fetchedMap) nameMap.set(id, name);
    const hostMentions = hosts.map((h) => fetchedMap.get(h.id) || !isBadName(h.linkedin_name) && h.linkedin_name || !isBadName(h.name) && h.name || "").filter(Boolean).map((n) => `@${n}`).join(" ");
    const shortName = eventName.replace(/\s*·\s*[^·]+$/, "").replace(/\s*·\s*[^·]+$/, "").trim();
    const postText = hostMentions ? `Thanks ${hostMentions} for organizing the ${shortName} event!` : `Thanks everyone for organizing the ${shortName} event!`;
    const extractHandle = (url) => {
      if (!url) return "";
      const cleaned = url.replace(/\/$/, "");
      const parts = cleaned.split("/");
      return parts[parts.length - 1] || "";
    };
    const isFullName = (n) => n.trim().split(/\s+/).length >= 2;
    const guestEntries = guests.map((g) => {
      const name = nameMap.get(g.id) || g.name || "";
      return { name, ig: extractHandle(g.instagram_url || ""), x: extractHandle(g.twitter_url || "") };
    }).filter((ge) => isFullName(ge.name));
    draftState = { stage: "ready", eventId, eventName, postText, guests: guestEntries, totalGuests };
    renderDraftView(state);
  }
  async function renderDraftView(state) {
    const backBtn = `
    <div class="compact-header">
      <button class="btn-back" id="btnBackDraft">\u2190 Back</button>
      <span class="compact-name" style="flex:1;text-align:center;">Draft LinkedIn post</span>
      <span style="width:48px;"></span>
    </div>
  `;
    const wireBack = () => {
      document.getElementById("btnBackDraft")?.addEventListener("click", () => {
        draftViewOpen = false;
        draftState = "closed";
        _draftFetchContext = null;
        render();
      });
    };
    if (typeof draftState === "object" && draftState.stage === "pick") {
      root.innerHTML = backBtn + `<div style="padding:20px;text-align:center;color:#9ca3af;font-size:13px;">Loading events\u2026</div>`;
      wireBack();
      const progressResp = await new Promise((r) => chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, r));
      const events = progressResp?.events ?? [];
      root.innerHTML = backBtn + `
      <div style="padding:20px;">
        <div style="font-size:13px;color:#374151;font-weight:600;margin-bottom:12px;">Which event?</div>
        ${events.map((ev) => `
          <button class="btn btn-secondary event-pick-btn" data-event-id="${escHtml(ev.id ?? "")}" data-event-name="${escHtml(ev.name ?? "")}" style="margin-bottom:8px;text-align:left;">
            ${escHtml(ev.name ?? "Event")}
          </button>
        `).join("")}
      </div>
    `;
      wireBack();
      document.querySelectorAll(".event-pick-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const evId = btn.getAttribute("data-event-id") ?? "";
          const evName = btn.getAttribute("data-event-name") ?? "";
          startDraftFetch(evId, evName, state);
        });
      });
      return;
    }
    if (typeof draftState === "object" && draftState.stage === "loading") {
      const n = draftState.fetching;
      const estSecs = n > 0 ? Math.ceil(n * 2) : 0;
      const hint = n > 0 ? ` \xB7 ~${estSecs}s` : "";
      root.innerHTML = backBtn + `
      <div style="text-align:center;padding:60px 20px;">
        <div style="color:#9ca3af;font-size:13px;" id="draftNamesProgress">
          ${n > 0 ? `Looking up ${n} social handles${hint}` : "Building your post draft\u2026"}
        </div>
        ${n > 0 ? '<div style="color:#b0b5bd;font-size:11px;margin-top:6px;">So you can @ them in your post</div>' : ""}
      </div>
    `;
      wireBack();
      return;
    }
    if (typeof draftState === "object" && draftState.stage === "ready") {
      const s = draftState;
      const hasGuests = s.guests.length > 0;
      const copyAllLinkedIn = s.guests.map((g) => `@${g.name}`).join(" ");
      const copyAllIg = s.guests.filter((g) => g.ig).map((g) => `@${g.ig}`).join(" ");
      const copyAllX = s.guests.filter((g) => g.x).map((g) => `@${g.x}`).join(" ");
      const tableRows = s.guests.map((g, i) => {
        const hasIg = !!g.ig;
        const hasX = !!g.x;
        return `<tr>
        <td style="padding:5px 8px 5px 0;font-size:12px;color:#374151;cursor:pointer;white-space:nowrap;" class="draft-copy-name" data-name="${escHtml(g.name)}" data-idx="${i}">${escHtml(g.name)}</td>
        <td style="padding:5px 4px;font-size:12px;color:${hasIg ? "#374151" : "#d1d5db"};text-align:center;${hasIg ? "cursor:pointer;" : ""}" class="${hasIg ? "draft-copy-handle" : ""}" data-handle="${hasIg ? escHtml(g.ig) : ""}">${hasIg ? escHtml(g.ig) : "\u2013"}</td>
        <td style="padding:5px 0 5px 4px;font-size:12px;color:${hasX ? "#374151" : "#d1d5db"};text-align:center;${hasX ? "cursor:pointer;" : ""}" class="${hasX ? "draft-copy-handle" : ""}" data-handle="${hasX ? escHtml(g.x) : ""}">${hasX ? escHtml(g.x) : "\u2013"}</td>
      </tr>`;
      }).join("");
      root.innerHTML = backBtn + `
      <div style="padding:20px;">
        <div style="font-size:11px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">Post draft</div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:13px;color:#374151;line-height:1.5;margin-bottom:8px;white-space:pre-wrap;">${escHtml(s.postText)}</div>
        <button class="btn btn-secondary" id="btnCopyPost" style="margin-bottom:20px;width:auto;padding:6px 16px;">Copy</button>

        ${hasGuests ? `
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 12px;margin-bottom:16px;">
          <div style="font-size:11px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Tip: Tag attendees for more reach</div>
          <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0;">In the LinkedIn app: tap your photo \u2192 Tag people \u2192 search each name below</p>
        </div>
        <div style="font-size:11px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Guest names <span style="font-size:10px;color:#9ca3af;font-weight:400;text-transform:none;">(click to copy)</span></div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
          <thead>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <th style="padding:4px 8px 4px 0;font-size:10px;font-weight:600;color:#9ca3af;text-align:left;text-transform:uppercase;">LinkedIn</th>
              <th style="padding:4px 4px;font-size:10px;font-weight:600;color:#9ca3af;text-align:center;text-transform:uppercase;">ig</th>
              <th style="padding:4px 0 4px 4px;font-size:10px;font-weight:600;color:#9ca3af;text-align:center;text-transform:uppercase;">x</th>
            </tr>
            <tr>
              <td style="padding:2px 8px 6px 0;"><span id="btnCopyAllLinkedIn" data-copyall="${escHtml(copyAllLinkedIn)}" style="display:inline-block;font-size:10px;font-weight:500;color:#374151;background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;padding:2px 7px;cursor:pointer;white-space:nowrap;">Copy all</span></td>
              <td style="padding:2px 4px 6px;text-align:center;">${copyAllIg ? `<span id="btnCopyAllIg" data-copyall="${escHtml(copyAllIg)}" style="display:inline-block;font-size:10px;font-weight:500;color:#374151;background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;padding:2px 7px;cursor:pointer;white-space:nowrap;">Copy all</span>` : ""}</td>
              <td style="padding:2px 0 6px 4px;text-align:center;">${copyAllX ? `<span id="btnCopyAllX" data-copyall="${escHtml(copyAllX)}" style="display:inline-block;font-size:10px;font-weight:500;color:#374151;background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;padding:2px 7px;cursor:pointer;white-space:nowrap;">Copy all</span>` : ""}</td>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div id="draftCopiedMsg" style="font-size:11px;color:#059669;min-height:16px;margin-bottom:4px;"></div>
        ${s.totalGuests >= 15 ? `<button class="btn btn-secondary" id="btnDraftShuffle" style="margin-bottom:16px;">Shuffle for new 15 (${s.totalGuests} total)</button>` : ""}
        ` : ""}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `;
      wireBack();
      document.getElementById("btnCopyPost")?.addEventListener("click", () => {
        navigator.clipboard.writeText(s.postText).then(() => {
          const btn = document.getElementById("btnCopyPost");
          if (btn) {
            btn.textContent = "Copied!";
            setTimeout(() => {
              if (btn) btn.textContent = "Copy";
            }, 1500);
          }
        }).catch(() => {
        });
      });
      document.querySelectorAll(".draft-copy-name").forEach((cell) => {
        cell.addEventListener("click", () => {
          const name = cell.getAttribute("data-name") ?? "";
          navigator.clipboard.writeText(name).then(() => {
            const msg = document.getElementById("draftCopiedMsg");
            if (msg) {
              msg.textContent = `Copied: ${name}`;
              setTimeout(() => {
                if (msg) msg.textContent = "";
              }, 1500);
            }
          }).catch(() => {
          });
        });
      });
      document.querySelectorAll(".draft-copy-handle").forEach((cell) => {
        cell.addEventListener("click", () => {
          const handle = cell.getAttribute("data-handle") ?? "";
          if (!handle) return;
          navigator.clipboard.writeText(handle).then(() => {
            const msg = document.getElementById("draftCopiedMsg");
            if (msg) {
              msg.textContent = `Copied: ${handle}`;
              setTimeout(() => {
                if (msg) msg.textContent = "";
              }, 1500);
            }
          }).catch(() => {
          });
        });
      });
      ["btnCopyAllLinkedIn", "btnCopyAllIg", "btnCopyAllX"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("click", () => {
          const text = el.getAttribute("data-copyall") ?? "";
          navigator.clipboard.writeText(text).then(() => {
            const msg = document.getElementById("draftCopiedMsg");
            if (msg) {
              msg.textContent = "Copied all!";
              setTimeout(() => {
                if (msg) msg.textContent = "";
              }, 1500);
            }
          }).catch(() => {
          });
        });
      });
      document.getElementById("btnDraftShuffle")?.addEventListener("click", () => {
        if (typeof draftState === "object" && draftState.stage === "ready") {
          startDraftFetch(s.eventId, s.eventName, state);
        }
      });
      return;
    }
  }
  function nextConnectionLabel(nextAt) {
    if (!nextAt) return "";
    const diff = new Date(nextAt).getTime() - Date.now();
    if (diff <= 0) return "Next: now";
    const mins = Math.ceil(diff / 6e4);
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem > 0 ? `Next in ~${hrs}h ${rem}m` : `Next in ~${hrs}h`;
    }
    return `Next in ~${mins} min`;
  }
  function renderDailyChart(dailyCounts) {
    const rawDays = Object.keys(dailyCounts).sort().slice(-14);
    if (rawDays.length === 0) return "";
    const last = rawDays.length > 0 ? rawDays[rawDays.length - 1] : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const minDays = 3;
    const days = [];
    for (let i = Math.max(rawDays.length, minDays) - 1; i >= 0; i--) {
      const d = /* @__PURE__ */ new Date(last + "T12:00:00");
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const merged = days.map((d) => ({ date: d, count: dailyCounts[d] ?? 0 }));
    const maxCount = Math.max(...merged.map((m) => m.count), 1);
    const barHtml = merged.map((m) => {
      const h = Math.round(m.count / maxCount * 44);
      const dt = /* @__PURE__ */ new Date(m.date + "T12:00:00");
      const label = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `<div class="chart-col"><div class="chart-bar" style="height:${h}px" title="${label}: ${m.count}"></div><div class="chart-day">${label}</div></div>`;
    }).join("");
    const total = merged.reduce((s, m) => s + m.count, 0);
    return `
    <div class="section">
      <div class="feed-header"><span class="feed-title">Sent per day</span><span style="font-size:11px;color:#6b7280;">${total} total</span></div>
      <div class="chart-wrap">${barHtml}</div>
    </div>
  `;
  }
  async function renderCampaign(state) {
    const [progressResp, storageData, tabCtx] = await Promise.all([
      new Promise((r) => chrome.runtime.sendMessage({ type: "GET_PROGRESS_DATA" }, r)),
      chrome.storage.local.get(["nextScheduledAt", "pauseReason"]),
      resolveTabContext()
    ]);
    const events = progressResp?.events ?? [];
    const dailyCounts = progressResp?.dailyCounts ?? {};
    const nextAt = storageData.nextScheduledAt ?? null;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
    let allSent = 0, dbPending = 0, allFailed = 0, sent7d = 0;
    for (const event of events) {
      for (const contact of event.contacts ?? []) {
        const q = contact.connection_queue?.[0];
        const status = q?.status;
        if (status === "sent" || status === "accepted") {
          allSent++;
          const sentAt = q?.sent_at ? new Date(q.sent_at).getTime() : 0;
          if (sentAt >= sevenDaysAgo) sent7d++;
        } else if (status === "pending") dbPending++;
        else if (status === "failed") allFailed++;
      }
    }
    const total = allSent + dbPending + allFailed;
    const pct = total > 0 ? Math.round((allSent + allFailed) / total * 100) : 0;
    const isRunning = dbPending > 0 && !state.paused;
    const pauseReason = storageData.pauseReason ?? "";
    const statusHtml = isRunning ? `<span class="status-pill pill-running"><span class="dot"></span>Running</span>` : state.paused ? `<span class="status-pill pill-paused"><span class="dot"></span>Paused</span>` : `<span class="status-pill pill-done"><span class="dot"></span>Done</span>`;
    const pauseReasonHtml = state.paused && pauseReason ? `<div style="font-size:12px;color:#ef4444;padding:4px 16px 0;line-height:1.4;">${escHtml(pauseReason)}</div>` : "";
    const statsHtml = `
    <div style="font-size:9px;color:#9ca3af;text-align:right;margin:0 16px 4px;text-transform:uppercase;letter-spacing:0.05em;">Last 7 days</div>
    <div class="stats-row" style="margin:0 16px;">
      <div class="stat-card">
        <div class="stat-num green">${sent7d}</div>
        <div class="stat-label">Connected</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${dbPending}</div>
        <div class="stat-label">Queued</div>
      </div>
      ${allFailed > 0 ? `
      <div class="stat-card">
        <div class="stat-num" style="color:#9ca3af;">${allFailed}</div>
        <div class="stat-label">Skipped</div>
        <div style="font-size:9px;color:#d1d5db;margin-top:2px;line-height:1.3;">already connected<br>or unavailable</div>
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
    const eventsListHtml = events.length === 0 ? "" : (() => {
      if (exportMode) {
        const allSelected = exportSelected.size === events.length;
        const rowsHtml2 = events.map((ev) => {
          const evId = ev.id ?? "";
          const contacts = ev.contacts ?? [];
          const checked = exportSelected.has(evId);
          return `
          <label class="event-export-row ${checked ? "export-checked" : ""}" data-export-id="${escHtml(evId)}">
            <input type="checkbox" class="export-check" data-event-id="${escHtml(evId)}" ${checked ? "checked" : ""}>
            <span class="event-row-name">${escHtml(ev.name ?? "Event")}</span>
            <span class="event-row-badge">${contacts.length} contacts</span>
          </label>
        `;
        }).join("");
        return `
        <div class="section">
          <div class="feed-header">
            <span class="feed-title">Select events to export</span>
            <button class="export-cancel-btn" id="btnExportCancel">Cancel</button>
          </div>
          <div class="export-actions">
            <button class="export-toggle-btn" id="btnToggleAll">${allSelected ? "Select all" : "Deselect all"}</button>
          </div>
          <div class="events-list">${rowsHtml2}</div>
          <button class="btn btn-primary" id="btnDownloadCsv" style="margin-top:10px;">Download CSV</button>
        </div>
      `;
      }
      const exportBtn = `<button class="export-trigger-btn" id="btnExportCsv">Export CSV</button>`;
      const rowsHtml = events.map((ev) => {
        const evId = ev.id ?? "";
        const contacts = ev.contacts ?? [];
        const evSent = contacts.filter((c) => ["sent", "accepted"].includes(c.connection_queue?.[0]?.status ?? "")).length;
        const evPending = contacts.filter((c) => c.connection_queue?.[0]?.status === "pending").length;
        const isExpanded = expandedEvents.has(evId);
        const badgeText = evPending > 0 ? `${evPending} queued` : evSent > 0 ? `${evSent} sent` : `${contacts.length} scanned`;
        const badgeClass = evPending > 0 ? "queued" : "";
        const contactsHtml = isExpanded ? `
        <div class="event-contacts">
          ${contacts.map((c) => {
          const liUrl = c.linkedin_url ?? "";
          const igUrl = c.instagram_url ?? "";
          const xUrl = c.twitter_url ?? "";
          const webUrl = c.website_url ?? "";
          return `
              <div class="contact-row">
                <span class="contact-name">${escHtml(c.name ?? "")}</span>
                <div style="display:flex;align-items:center;gap:4px;">
                  ${liUrl ? `<a href="${escHtml(liUrl)}" target="_blank" class="badge badge-li">in</a>` : ""}
                  ${igUrl ? `<a href="${escHtml(igUrl)}" target="_blank" class="badge badge-ig">ig</a>` : ""}
                  ${xUrl ? `<a href="${escHtml(xUrl)}" target="_blank" class="badge badge-x">x</a>` : ""}
                  ${webUrl ? `<a href="${escHtml(webUrl)}" target="_blank" class="badge badge-web">web</a>` : ""}
                </div>
              </div>
            `;
        }).join("")}
        </div>
      ` : "";
        return `
        <div class="event-row">
          <div class="event-row-header" data-event-id="${escHtml(evId)}">
            <span class="event-row-name">${escHtml(ev.name ?? "Event")}</span>
            <span class="event-row-badge ${badgeClass}">${escHtml(badgeText)}</span>
            <span class="chevron" data-chevron>${isExpanded ? "\u25B2" : "\u25BC"}</span>
          </div>
          ${contactsHtml}
        </div>
      `;
      }).join("");
      return `
      <div class="section">
        <div class="feed-header">
          <span class="feed-title">Events</span>
          ${exportBtn}
        </div>
        <div class="events-list">${rowsHtml}</div>
      </div>
    `;
    })();
    const draftSectionHtml = `
    <div class="section">
      <button class="btn btn-secondary" id="btnDraftPost">\u270D Draft a LinkedIn post</button>
    </div>
  `;
    const onEventPage = tabCtx.kind === "luma-event";
    const scanCta = onEventPage ? `<div class="section">
        <button class="btn btn-primary" id="btnScanAnother">\u26A1 Scan this event</button>
       </div>` : `<div class="section">
        <button class="btn btn-secondary" id="btnScanAnother">+ Scan another event</button>
       </div>`;
    root.innerHTML = `
    <div class="compact-header">
      <div class="compact-brand">
        <img src="../icons/icon48.png" class="compact-logo" alt="">
        <span class="compact-name">I Hate Networking</span>
      </div>
      ${statusHtml}
    </div>
    ${pauseReasonHtml}

    ${scanCta}

    <div class="section">
      ${statsHtml}
      ${progressHtml}
      ${dbPending > 0 || state.paused ? `<div class="pause-row"><button class="btn btn-secondary" id="${pauseBtnId}">${pauseBtnLabel}</button></div>` : ""}
    </div>

    ${renderDailyChart(dailyCounts)}

    ${eventsListHtml}
    ${draftSectionHtml}

    ${isRunning ? `<div class="chrome-warning" id="chromeWarning">\u26A0 Keep Chrome open \u2014 connections send in background <button class="warning-close" id="btnDismissWarning">\u2715</button></div>` : ""}

    <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a> \xB7 <button class="signout-btn" id="btnSignOut">Sign out</button></div>
  `;
    document.getElementById("btnDismissWarning")?.addEventListener("click", () => {
      document.getElementById("chromeWarning")?.remove();
    });
    document.getElementById("btnPause")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "PAUSE_CAMPAIGN" }, () => render());
    });
    document.getElementById("btnResume")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "RESUME_CAMPAIGN" }, () => render());
    });
    document.getElementById("btnScanAnother")?.addEventListener("click", () => {
      if (tabCtx.kind === "luma-event") {
        scanState = { type: "idle" };
        startScan(tabCtx);
      } else {
        const tabId = tabCtx.tabId;
        if (tabId) {
          chrome.tabs.update(tabId, { url: "https://lu.ma/events", active: true });
        } else {
          chrome.tabs.create({ url: "https://lu.ma/events" });
        }
      }
    });
    document.querySelectorAll(".event-row-header").forEach((header) => {
      header.addEventListener("click", () => {
        const evId = header.getAttribute("data-event-id") ?? "";
        const eventRow = header.parentElement;
        const chevron = header.querySelector("[data-chevron]");
        if (expandedEvents.has(evId)) {
          expandedEvents.delete(evId);
          eventRow.querySelector(".event-contacts")?.remove();
          if (chevron) chevron.textContent = "\u25BC";
        } else {
          expandedEvents.add(evId);
          const ev = events.find((e) => e.id === evId);
          if (ev) {
            if (chevron) chevron.textContent = "\u25B2";
            const contactsDiv = document.createElement("div");
            contactsDiv.className = "event-contacts";
            contactsDiv.innerHTML = (ev.contacts ?? []).map((c) => {
              const liUrl = c.linkedin_url ?? "";
              const igUrl = c.instagram_url ?? "";
              const xUrl = c.twitter_url ?? "";
              const webUrl = c.website_url ?? "";
              return `
              <div class="contact-row">
                <span class="contact-name">${escHtml(c.name ?? "")}</span>
                <div style="display:flex;align-items:center;gap:4px;">
                  ${liUrl ? `<a href="${escHtml(liUrl)}" target="_blank" class="badge badge-li">in</a>` : ""}
                  ${igUrl ? `<a href="${escHtml(igUrl)}" target="_blank" class="badge badge-ig">ig</a>` : ""}
                  ${xUrl ? `<a href="${escHtml(xUrl)}" target="_blank" class="badge badge-x">x</a>` : ""}
                  ${webUrl ? `<a href="${escHtml(webUrl)}" target="_blank" class="badge badge-web">web</a>` : ""}
                </div>
              </div>
            `;
            }).join("");
            eventRow.appendChild(contactsDiv);
          }
        }
      });
    });
    document.getElementById("btnExportCsv")?.addEventListener("click", () => {
      if (events.length === 1) {
        exportSelected = new Set(events.map((e) => e.id ?? ""));
        downloadCsv(generateCsv(exportSelected, events));
      } else {
        exportMode = true;
        exportSelected = new Set(events.map((e) => e.id ?? ""));
        render();
      }
    });
    document.getElementById("btnExportCancel")?.addEventListener("click", () => {
      exportMode = false;
      render();
    });
    document.getElementById("btnToggleAll")?.addEventListener("click", () => {
      if (exportSelected.size === events.length) {
        exportSelected.clear();
      } else {
        exportSelected = new Set(events.map((e) => e.id ?? ""));
      }
      render();
    });
    document.getElementById("btnDownloadCsv")?.addEventListener("click", () => {
      downloadCsv(generateCsv(exportSelected, events));
      exportMode = false;
      render();
    });
    document.querySelectorAll(".export-check").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const evId = checkbox.getAttribute("data-event-id") ?? "";
        if (checkbox.checked) {
          exportSelected.add(evId);
        } else {
          exportSelected.delete(evId);
        }
        const row = checkbox.closest(".event-export-row");
        if (row) row.classList.toggle("export-checked", checkbox.checked);
      });
    });
    document.getElementById("btnDraftPost")?.addEventListener("click", () => {
      if (events.length === 0) return;
      draftViewOpen = true;
      draftState = "closed";
      if (events.length === 1) {
        startDraftFetch(events[0].id, events[0].name ?? "", state);
      } else {
        draftState = { stage: "pick" };
        renderDraftView(state);
      }
    });
    document.getElementById("btnSignOut")?.addEventListener("click", () => signOut());
  }
  function renderAuthGate() {
    return `
    <div class="auth-gate" id="authGate">
      <button class="btn btn-primary" id="btnAuthSignIn">
        Sign in to auto-send LinkedIn connections
      </button>
    </div>
  `;
  }
  function wireAuthGate() {
    document.getElementById("btnAuthSignIn")?.addEventListener("click", () => {
      chrome.tabs.create({ url: DASHBOARD_LOGIN_URL });
    });
  }
  function startScan(ctx, hasCampaign = false) {
    noteValue = "";
    scanState = { type: "scanning", phase: "starting", done: 0, total: 0, currentName: "", startTime: Date.now(), eventName: ctx.eventName };
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
    if (scanState.type === "results" && scanState.eventUrl) {
      const currentUrl = await new Promise(
        (resolve) => chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => resolve(t?.url ?? ""))
      );
      if (currentUrl && currentUrl !== scanState.eventUrl) {
        scanState = { type: "idle" };
        noteValue = "";
      }
    }
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
      document.getElementById("btnViewProgress")?.addEventListener("click", () => {
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
      if (!s.eventId && await hasSession()) {
        const tabUrl = await new Promise(
          (resolve) => chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => resolve(t?.url ?? ""))
        );
        const result = await new Promise(
          (resolve) => chrome.runtime.sendMessage({
            type: "START_ENRICHMENT",
            data: { lumaUrl: tabUrl, eventName: s.eventName, contacts: s.contacts }
          }, resolve)
        );
        if (result?.eventId) {
          scanState = { ...s, eventId: result.eventId, found: result.found || s.found };
        }
      }
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
      if (s.total === 0) {
        const d = s.scanDebug;
        let errorMsg = "The guest list may be hidden on this event. Try scrolling down to load the Guests section first, then scan again.";
        if (d && !d.buttonClicked) {
          errorMsg = "Could not find the guest list button. Luma may have changed their page layout. Try refreshing the page and scanning again.";
        } else if (d && d.buttonClicked && !d.modalFound) {
          errorMsg = "Found the guest button but the attendee list did not load. Try scrolling down on the event page first, then scan again.";
        } else if (d && d.buttonClicked && d.modalFound && d.apiGuestsCount === 0 && d.domGuestsCount === 0) {
          errorMsg = "Opened the guest list but could not read any attendees. Luma may have changed their page structure.";
        }
        root.innerHTML = `
        <div class="compact-header">
          <div class="compact-brand">
            <img src="../icons/icon48.png" class="compact-logo" alt="">
            <span class="compact-name">I Hate Networking</span>
          </div>
        </div>
        <div class="section" style="text-align:center;padding:32px 20px;">
          <div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:8px;">No attendees found</div>
          <p style="font-size:13px;color:#9ca3af;line-height:1.5;margin:0 0 20px;">${errorMsg}</p>
          <button class="btn btn-secondary" id="btnTryAgain">Try again</button>
        </div>
        <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
      `;
        document.getElementById("btnTryAgain")?.addEventListener("click", () => {
          scanState = { type: "idle" };
          render();
        });
        return;
      }
      if (s.found === 0 && s.total > 0) {
        root.innerHTML = `
        <div class="compact-header">
          <div class="compact-brand">
            <img src="../icons/icon48.png" class="compact-logo" alt="">
            <span class="compact-name">I Hate Networking</span>
          </div>
        </div>
        <div class="section" style="text-align:center;padding:32px 20px;">
          <div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:8px;">No LinkedIn profiles found</div>
          <p style="font-size:13px;color:#9ca3af;line-height:1.5;margin:0 0 12px;">Found ${s.total} attendees but none had LinkedIn profiles linked on Luma.</p>
          <a href="#" id="btnDownloadCsvEmpty" style="font-size:12px;color:#6b7280;text-decoration:underline;">Download CSV of attendees</a>
          <div style="margin-top:16px;"><button class="btn btn-secondary" id="btnTryAgain2">Back</button></div>
        </div>
        <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
      `;
        document.getElementById("btnTryAgain2")?.addEventListener("click", () => {
          scanState = { type: "idle" };
          render();
        });
        document.getElementById("btnDownloadCsvEmpty")?.addEventListener("click", (e) => {
          e.preventDefault();
          const rows = [["Name", "LinkedIn", "Instagram", "Twitter", "Website", "Luma Profile"]];
          for (const c of s.contacts) {
            rows.push([c.name, c.linkedInUrl ?? "", c.instagramUrl ?? "", c.twitterUrl ?? "", c.websiteUrl ?? "", c.url]);
          }
          const csv = rows.map((r) => r.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${s.eventName || "attendees"}.csv`;
          a.click();
        });
        return;
      }
      root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section">
        <div class="results-count">Found ${s.found} contacts</div>
        <div class="results-sub">out of ${s.total} attendees scanned</div>
        <a href="#" id="btnDownloadCsv" style="font-size:12px;color:#6b7280;text-decoration:underline;display:inline-block;margin:6px 0 2px;">Download CSV</a>
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
      document.getElementById("btnDownloadCsv")?.addEventListener("click", () => {
        const rows = [["Name", "LinkedIn", "Instagram", "Twitter", "Website", "Luma Profile"]];
        for (const c of s.contacts) {
          rows.push([c.name, c.linkedInUrl, c.instagramUrl ?? "", c.twitterUrl ?? "", c.websiteUrl ?? "", c.url]);
        }
        const csv = rows.map((r) => r.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${(s.eventName || "contacts").replace(/[^a-z0-9]/gi, "_")}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
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
        <div class="launched-note">Sending 1 every 15\u201330 min during business hours \u2014 25/day max \u2014 to keep your account safe.</div>
        <button class="btn btn-primary" id="btnDraftLaunched" style="margin-bottom:8px;">\u270D Draft a LinkedIn post</button>
        <button class="btn btn-secondary" id="btnDone">Done</button>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `;
      document.getElementById("btnDraftLaunched")?.addEventListener("click", async () => {
        draftViewOpen = true;
        draftState = "closed";
        scanState = { type: "idle" };
        const appState = await resolveAppState();
        if (appState.type === "campaign") {
          startDraftFetch(s.eventId, s.eventName, appState);
        } else {
          draftState = { stage: "pick" };
          render();
        }
      });
      document.getElementById("btnDone").addEventListener("click", () => {
        scanState = { type: "idle" };
        render();
      });
      return;
    }
  }
  async function render() {
    if (_draftFetchContext) return;
    renderLoading();
    try {
      const [state, ctx] = await Promise.all([resolveAppState(), resolveTabContext()]);
      const hasCampaign = state.type === "campaign";
      if (scanState.type !== "idle" && ctx.kind === "luma-event") {
        await renderEventPage(ctx, hasCampaign);
        return;
      }
      if (state.type === "campaign" && draftViewOpen) {
        await renderDraftView(state);
      } else if (state.type === "campaign") {
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
  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === "LINKEDIN_NAMES_PROGRESS") {
      const el = document.getElementById("draftNamesProgress");
      if (!el) return;
      const done = msg.done;
      const total = msg.total;
      if (draftNamesStartTime > 0 && done > 0) {
        const elapsed = (Date.now() - draftNamesStartTime) / 1e3;
        const perItem = elapsed / done;
        const remaining = Math.ceil((total - done) * perItem);
        const eta = remaining > 0 ? ` \xB7 ~${remaining}s left` : "";
        el.textContent = `Looking up names ${done} / ${total}${eta}`;
      } else {
        el.textContent = `Looking up names ${done} / ${total}`;
      }
      if (done >= total && _draftFetchContext) {
        const ctx = _draftFetchContext;
        setTimeout(() => {
          if (typeof draftState === "object" && draftState.stage === "loading") {
            console.log("[IHN] Force-finishing draft after all names fetched");
            finishDraft(ctx.eventId, ctx.eventName, ctx.hosts, ctx.guests, ctx.totalGuests, [], ctx.state);
          }
        }, 2e3);
      }
      return;
    }
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
      const tabUrl = await new Promise(
        (resolve) => chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => resolve(t?.url ?? ""))
      );
      scanState = {
        type: "results",
        found: msg.found,
        total: msg.total,
        eventId: msg.eventId,
        eventName: scanState.eventName ?? "",
        eventUrl: tabUrl,
        contacts: msg.contacts ?? [],
        scanDebug: msg.scanDebug
      };
      if (msg.scanDebug) {
        chrome.runtime.sendMessage({
          type: "LOG_SCAN",
          data: {
            ...msg.scanDebug,
            eventName: scanState.eventName ?? "",
            totalContacts: msg.total,
            linkedInCount: msg.found,
            errorType: msg.total === 0 ? "no_contacts" : msg.found === 0 ? "no_linkedin" : ""
          }
        });
      }
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
