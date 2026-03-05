"use strict";
(() => {
  // content/linkedin.ts
  var VOYAGER = "https://www.linkedin.com/voyager/api";
  var INVITE_URL = `${VOYAGER}/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2`;
  function getCsrfToken() {
    const m = document.cookie.match(/JSESSIONID=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function voyagerHeaders(csrf) {
    return {
      accept: "application/vnd.linkedin.normalized+json+2.1",
      "content-type": "application/json; charset=UTF-8",
      "csrf-token": csrf,
      "x-restli-protocol-version": "2.0.0",
      "x-li-lang": "en_US",
      // These mimic LinkedIn's own frontend requests — helps avoid 403 rejections
      "x-li-page-instance": "urn:li:page:d_flagship3_profile_view_base;" + Math.random().toString(36).slice(2),
      "x-li-track": JSON.stringify({
        clientVersion: "1.13.3655",
        mpVersion: "1.13.3655",
        osName: "web",
        timezoneOffset: (/* @__PURE__ */ new Date()).getTimezoneOffset() / -60,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        mpName: "voyager-web",
        displayDensity: window.devicePixelRatio,
        displayWidth: window.screen.width,
        displayHeight: window.screen.height
      })
    };
  }
  function getProfileUrnFromPage(vanityName) {
    const html = document.documentElement.innerHTML;
    const pubIdx = html.indexOf(`"publicIdentifier":"${vanityName}"`);
    if (pubIdx !== -1) {
      const slice = html.slice(Math.max(0, pubIdx - 400), pubIdx + 400);
      const m2 = slice.match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/);
      if (m2) return m2[1];
    }
    const m = html.match(/"entityUrn":"(urn:li:fsd_profile:[A-Za-z0-9_-]+)"/);
    return m ? m[1] : null;
  }
  async function fetchProfileUrn(vanityName, headers) {
    try {
      const resp = await fetch(
        `${VOYAGER}/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanityName)}`,
        { headers, credentials: "include" }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const urn = data?.data?.entityUrn ?? data?.elements?.[0]?.entityUrn ?? (data?.included ?? [])[0]?.entityUrn ?? "";
      return urn.startsWith("urn:li:fsd_profile:") ? urn : null;
    } catch {
      return null;
    }
  }
  async function parseInviteError(resp) {
    let body = {};
    try {
      body = await resp.json();
    } catch {
    }
    const msg = String(body?.message ?? body?.code ?? "").toUpperCase();
    if (resp.status === 429) return "weekly_limit_reached";
    if (resp.status === 403) return `not_logged_in:${msg.slice(0, 80) || "no_body"}`;
    if (msg.includes("CANT_RESEND_YET") || msg.includes("DUPLICATE") || msg.includes("ALREADY") && msg.includes("INVIT")) return "already_pending";
    if (msg.includes("FIRST_DEGREE") || msg.includes("ALREADY_CONNECTED")) return "already_connected";
    if (msg.includes("QUOTA") || msg.includes("LIMIT")) return "weekly_limit_reached";
    return `api_error_${resp.status}:${msg.slice(0, 60)}`;
  }
  function getMain() {
    return document.querySelector("main") ?? document.body;
  }
  function getProfileName() {
    return document.querySelector("h1")?.textContent?.trim() ?? "";
  }
  function namesMatch(pageName, expectedName) {
    if (!expectedName) return true;
    const normalize = (s) => s.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    const page = normalize(pageName);
    const pageWords = page.split(/\s+/);
    const parts = normalize(expectedName).split(/\s+/).filter(Boolean);
    return parts.every(
      (part) => page.includes(part) || // LinkedIn abbreviates last names to "F." for privacy — accept single-letter match
      pageWords.some((w) => w.length === 1 && part.startsWith(w))
    );
  }
  function findButtonByText(text, root = document.body) {
    const lower = text.toLowerCase();
    const buttons = Array.from(root.querySelectorAll("button"));
    return buttons.find((b) => b.textContent?.trim() === text) ?? buttons.find((b) => b.textContent?.trim().toLowerCase().includes(lower)) ?? null;
  }
  function getNoteQuotaReached() {
    return new Promise((resolve) => chrome.storage.local.get("noteQuotaReached", (r) => resolve(!!r.noteQuotaReached)));
  }
  function setNoteQuotaReached() {
    return new Promise((resolve) => chrome.storage.local.set({ noteQuotaReached: true }, resolve));
  }
  async function postInvite(profileUrn, note, headers) {
    const payload = {
      invitee: {
        inviteeUnion: {
          memberProfile: profileUrn
          // full "urn:li:fsd_profile:..." string
        }
      }
    };
    if (note) payload.customMessage = note;
    let resp;
    try {
      resp = await fetch(INVITE_URL, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return { success: false, error: `fetch_failed: ${String(e)}` };
    }
    if (resp.ok) return { success: true };
    return { success: false, error: await parseInviteError(resp) };
  }
  async function sendConnection(note, expectedName) {
    if (!window.location.pathname.startsWith("/in/")) {
      return { success: false, error: "Not a profile page" };
    }
    const pageName = getProfileName();
    if (!namesMatch(pageName, expectedName ?? "")) {
      return { success: false, error: `wrong_profile: expected "${expectedName}", got "${pageName}"` };
    }
    const csrf = getCsrfToken();
    if (!csrf) return { success: false, error: "no_csrf_token" };
    const headers = voyagerHeaders(csrf);
    const vanityName = window.location.pathname.split("/").filter(Boolean)[1] ?? "";
    const main = getMain();
    if (findButtonByText("Pending", main) || findButtonByText("Withdraw", main)) {
      return { success: false, error: "already_pending" };
    }
    let profileUrn = getProfileUrnFromPage(vanityName);
    if (!profileUrn) {
      profileUrn = await fetchProfileUrn(vanityName, headers);
    }
    if (!profileUrn) {
      return { success: false, error: "no_profile_urn" };
    }
    const noteQuotaReached = await getNoteQuotaReached();
    const effectiveNote = note && !noteQuotaReached ? note : "";
    const result = await postInvite(profileUrn, effectiveNote, headers);
    if (!result.success && effectiveNote) {
      await setNoteQuotaReached();
      return postInvite(profileUrn, "", headers);
    }
    return result;
  }
  function extractNameFromHtml(html) {
    const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ?? html.match(/content="([^"]+)"\s+property="og:title"/);
    if (ogMatch) return ogMatch[1].trim();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) return titleMatch[1].replace(/\s*[|\-–]\s*.*$/i, "").trim();
    return "";
  }
  if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "CONNECT") {
      sendConnection(msg.note || "", msg.expectedName || "").then((result) => sendResponse(result));
      return true;
    }
    if (msg.type === "GET_LINKEDIN_NAME") {
      sendResponse({ name: getProfileName() });
      return true;
    }
    if (msg.type === "FETCH_LINKEDIN_PROFILES") {
      ;
      (async () => {
        const contacts = msg.contacts ?? [];
        const results = [];
        for (const c of contacts) {
          const url = c.linkedin_url.replace("https://linkedin.com/", "https://www.linkedin.com/");
          let linkedinName = "";
          try {
            const resp = await fetch(url, { credentials: "include" });
            const html = await resp.text();
            linkedinName = extractNameFromHtml(html);
          } catch {
          }
          results.push({ id: c.id, linkedin_name: linkedinName });
          chrome.runtime.sendMessage({ type: "LINKEDIN_NAMES_PROGRESS", done: results.length, total: contacts.length }).catch(() => {
          });
        }
        sendResponse(results);
      })();
      return true;
    }
  });
})();
