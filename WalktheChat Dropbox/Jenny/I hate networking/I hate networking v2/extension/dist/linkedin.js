"use strict";
(() => {
  // content/linkedin.ts
  var VOYAGER = "https://www.linkedin.com/voyager/api";
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
      "x-li-lang": "en_US"
    };
  }
  function getProfileIdFromPage() {
    const codeEls = Array.from(document.querySelectorAll("code"));
    for (const el of codeEls) {
      const text = el.textContent ?? "";
      let m = text.match(/"entityUrn":"urn:li:fsd_profile:([A-Za-z0-9_-]+)"/);
      if (m) return m[1];
      m = text.match(/"entityUrn":"urn:li:fs_miniProfile:([A-Za-z0-9_-]+)"/);
      if (m) return m[1];
    }
    return null;
  }
  async function fetchProfileId(vanityName, headers) {
    try {
      const resp = await fetch(
        `${VOYAGER}/identity/profiles/${encodeURIComponent(vanityName)}/profileView`,
        { headers, credentials: "include" }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const miniUrn = data?.profile?.miniProfile?.entityUrn ?? "";
      const m = miniUrn.match(/urn:li:(?:fsd_profile|fs_miniProfile):([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
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
    const msg = String(body?.message ?? body?.exceptionClass ?? "").toUpperCase();
    if (resp.status === 429) return "weekly_limit_reached";
    if (resp.status === 403) return "not_logged_in";
    if (msg.includes("FIRST_DEGREE") || msg.includes("ALREADY_CONNECTED")) return "already_connected";
    if (msg.includes("DUPLICATE") || msg.includes("ALREADY") && msg.includes("INVIT")) return "already_pending";
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
  async function postInvite(profileId, note, headers) {
    const payload = {
      emberEntityName: "growth/invitation",
      invitee: {
        "com.linkedin.voyager.growth.invitation.InviteeProfile": { profileId }
      }
    };
    if (note) payload.message = note;
    let resp;
    try {
      resp = await fetch(`${VOYAGER}/growth/normInvitations`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return { success: false, error: `fetch_failed: ${String(e)}` };
    }
    if (resp.status === 201) return { success: true };
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
    let profileId = getProfileIdFromPage();
    if (!profileId) {
      profileId = await fetchProfileId(vanityName, headers);
    }
    if (!profileId) {
      return { success: false, error: "no_profile_urn" };
    }
    const noteQuotaReached = await getNoteQuotaReached();
    const effectiveNote = note && !noteQuotaReached ? note : "";
    const result = await postInvite(profileId, effectiveNote, headers);
    if (!result.success && effectiveNote && result.error?.includes("already_pending")) {
      await setNoteQuotaReached();
      return postInvite(profileId, "", headers);
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
