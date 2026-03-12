"use strict";
(() => {
  // content/luma.ts
  function parseGuestLinks(doc) {
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
    if (links.length === 0) {
      const modalEl = doc.querySelector('[role="dialog"], [class*="modal"], [class*="guest"], [class*="attendee"]');
      if (modalEl) {
        modalEl.querySelectorAll("a[href]").forEach((a) => {
          const href = a.href || a.getAttribute("href") || "";
          if (!href || seen.has(href)) return;
          try {
            const u = new URL(href, location.origin);
            const isLuma = u.hostname.includes("lu.ma") || u.hostname.includes("luma.com") || u.hostname === location.hostname;
            if (!isLuma) return;
            const parts = u.pathname.split("/").filter(Boolean);
            if (parts.length >= 2 && (parts[0] === "u" || parts[0] === "user" || parts[0] === "p")) {
              seen.add(href);
              links.push(href);
            }
          } catch {
          }
        });
      }
    }
    return links;
  }
  function extractLinkedInUrl(doc) {
    const selectors = [
      "a[href*='linkedin.com/in/']",
      "a[href*='linkedin.com/pub/']"
    ];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) return el.href || el.getAttribute("href") || "";
    }
    return "";
  }
  function extractInstagramUrl(doc) {
    const el = doc.querySelector("a[href*='instagram.com/']");
    return el ? el.href || el.getAttribute("href") || "" : "";
  }
  function extractEventName(doc) {
    const selectors = ["h1", '[class*="event-title"]', '[class*="title"] h1'];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return "";
  }
  function extractHostName(doc) {
    const selectors = [
      '[class*="organizer"] [class*="name"]',
      '[class*="host"] [class*="name"]',
      '[data-testid*="organizer"]'
    ];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return "";
  }
  function extractHostProfileUrls(doc) {
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
  function extractDisplayName(doc) {
    const h1 = doc.querySelector("h1");
    if (h1?.textContent?.trim()) return h1.textContent.trim();
    const titleEl = doc.querySelector("title");
    if (titleEl?.textContent) {
      const match = titleEl.textContent.match(/^([^|<\n]+?)\s*(?:\||$)/);
      if (match) return match[1].trim();
    }
    return "";
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
      const newHeight = container.scrollHeight;
      if (newHeight === prevHeight) break;
      prevHeight = newHeight;
    }
  }
  function findAndOpenGuestButton() {
    const labels = ["Guests", "Going", "Attendees", "See all", "Went"];
    for (const label of labels) {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const btn = btns.find((b) => b.textContent?.includes(label));
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }
  async function scrapeLumaPage() {
    const eventName = extractEventName(document);
    const hostName = extractHostName(document);
    const hostProfileUrls = extractHostProfileUrls(document);
    findAndOpenGuestButton();
    await new Promise((r) => setTimeout(r, 1e3));
    const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="guest-list"]');
    await scrollToLoadAll(modal ?? document.scrollingElement);
    const allLinks = parseGuestLinks(document);
    const hostSet = new Set(hostProfileUrls);
    const guestProfileUrls = allLinks.filter((u) => !hostSet.has(u));
    return { eventName, hostName, hostProfileUrls, guestProfileUrls };
  }
  function findModalScrollable(preClickLinks) {
    const allLinks = Array.from(document.querySelectorAll("a[href*='/u/'], a[href*='/user/']"));
    const newLinks = allLinks.filter((a) => {
      const href = a.href || a.getAttribute("href") || "";
      return href && !preClickLinks.has(href);
    });
    if (newLinks.length > 0) {
      let el = newLinks[0].parentElement;
      while (el && el !== document.documentElement) {
        const s = getComputedStyle(el);
        if ((s.overflow === "auto" || s.overflow === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 10) return el;
        el = el.parentElement;
      }
    }
    const dialogEl = document.querySelector('[role="dialog"], [class*="modal"]');
    if (dialogEl) {
      const scrollables = dialogEl.querySelectorAll("*");
      for (const candidate of scrollables) {
        const s = getComputedStyle(candidate);
        if ((s.overflow === "auto" || s.overflow === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll") && candidate.scrollHeight > candidate.clientHeight + 10) return candidate;
      }
      const ds = getComputedStyle(dialogEl);
      if ((ds.overflow === "auto" || ds.overflow === "scroll" || ds.overflowY === "auto" || ds.overflowY === "scroll") && dialogEl.scrollHeight > dialogEl.clientHeight + 10) return dialogEl;
    }
    return null;
  }
  function extractProfileFromNextData(html) {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;
    try {
      const data = JSON.parse(match[1]);
      const user = data?.props?.pageProps?.initialData?.user;
      if (!user?.name) return null;
      return {
        name: user.name,
        linkedInUrl: user.linkedin_handle ? `https://www.linkedin.com${user.linkedin_handle.startsWith("/") ? "" : "/in/"}${user.linkedin_handle}` : "",
        instagramUrl: user.instagram_handle ? `https://www.instagram.com/${user.instagram_handle}` : "",
        twitterUrl: user.twitter_handle ? `https://x.com/${user.twitter_handle}` : "",
        websiteUrl: user.website || ""
      };
    } catch {
      return null;
    }
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
  function extractWebsiteUrlFromHtml(html) {
    const skip = /linkedin\.com|instagram\.com|twitter\.com|x\.com|lu\.ma|luma\.co/;
    const matches = html.matchAll(/href="(https?:\/\/[^"]+)"[^>]*target="_blank"/g);
    for (const m of matches) {
      if (!skip.test(m[1])) return m[1];
    }
    return "";
  }
  function extractDisplayNameFromHtml(html) {
    const titleMatch = html.match(/<title>\s*([^|<\n]+?)\s*(?:\||<)/);
    const raw = titleMatch ? titleMatch[1].trim() : (html.match(/property="og:title"\s+content="([^"]+)"/) ?? [])[1]?.trim() ?? "";
    return raw.replace(/\s*·\s*Luma\s*$/i, "").trim();
  }
  function installGuestApiInterceptor(apiPatternOverride) {
    const capturedMap = /* @__PURE__ */ new Map();
    const originalFetch = window.fetch;
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    const profileBase = location.origin.replace(/\/$/, "");
    const GUEST_API_PATTERN = apiPatternOverride ?? /(guest|guests|ticket|tickets|attendee|attendees|rsvp|participant|participants)/i;
    const addGuest = (usernameRaw, nameRaw, social) => {
      const username = String(usernameRaw || "").trim().replace(/^\/+/, "").replace(/^u\//, "");
      if (!username) return;
      if (capturedMap.has(username)) return;
      capturedMap.set(username, {
        username,
        name: String(nameRaw || "").trim(),
        profileUrl: `${profileBase}/u/${username}`,
        linkedInUrl: social.linkedin ? social.linkedin.startsWith("http") ? social.linkedin : `https://www.linkedin.com/in/${social.linkedin}` : "",
        instagramUrl: social.instagram ? social.instagram.startsWith("http") ? social.instagram : `https://www.instagram.com/${social.instagram}` : "",
        twitterUrl: social.twitter ? social.twitter.startsWith("http") ? social.twitter : `https://x.com/${social.twitter}` : "",
        websiteUrl: social.website || ""
      });
    };
    const visitNodes = (node, visitor) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach((child) => visitNodes(child, visitor));
        return;
      }
      if (typeof node !== "object") return;
      visitor(node);
      Object.values(node).forEach((child) => visitNodes(child, visitor));
    };
    const captureFromPayload = (payload, sourceUrl) => {
      let before = capturedMap.size;
      visitNodes(payload, (obj) => {
        const user = obj.user && typeof obj.user === "object" ? obj.user : obj;
        const username = user.username ?? user.slug ?? user.handle ?? user.user_handle;
        if (!username) return;
        const name = user.name ?? user.display_name ?? user.full_name ?? "";
        addGuest(username, name, {
          linkedin: user.linkedin_handle ?? user.linkedin ?? "",
          instagram: user.instagram_handle ?? user.instagram ?? "",
          twitter: user.twitter_handle ?? user.twitter ?? "",
          website: user.website ?? user.website_url ?? ""
        });
      });
      const added = capturedMap.size - before;
      if (added > 0) {
        console.log("[IHN] Intercepted API guests from", sourceUrl, "added:", added, "total:", capturedMap.size);
      }
    };
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (GUEST_API_PATTERN.test(url)) {
        try {
          const clone = response.clone();
          const data = await clone.json();
          captureFromPayload(data, url);
        } catch {
        }
      }
      return response;
    };
    XMLHttpRequest.prototype.open = function(method, url, async, username, password) {
      ;
      this.__ihnUrl = String(url ?? "");
      return originalXhrOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
    };
    XMLHttpRequest.prototype.send = function(body) {
      this.addEventListener("load", function() {
        const url = this.__ihnUrl || this.responseURL || "";
        if (!GUEST_API_PATTERN.test(url)) return;
        const contentType = this.getResponseHeader("content-type") ?? "";
        if (!/json/i.test(contentType) && typeof this.responseText !== "string") return;
        try {
          const text = typeof this.responseText === "string" ? this.responseText : "";
          if (!text) return;
          const data = JSON.parse(text);
          captureFromPayload(data, url);
        } catch {
        }
      });
      return originalXhrSend.call(this, body);
    };
    return {
      getGuests: () => Array.from(capturedMap.values()),
      cleanup: () => {
        window.fetch = originalFetch;
        XMLHttpRequest.prototype.open = originalXhrOpen;
        XMLHttpRequest.prototype.send = originalXhrSend;
      }
    };
  }
  function extractGuestProfileUrlsFromPage() {
    const seen = /* @__PURE__ */ new Set();
    const urls = [];
    document.querySelectorAll("a[href*='/u/'], a[href*='/user/']").forEach((a) => {
      const href = a.href || a.getAttribute("href") || "";
      if (href && !seen.has(href)) {
        seen.add(href);
        urls.push(href);
      }
    });
    return urls;
  }
  async function runScan(existingUrls = []) {
    const eventName = document.querySelector("h1")?.textContent?.trim() ?? document.title;
    const lumaUrl = location.href;
    let remoteConfig = null;
    try {
      remoteConfig = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (resp) => {
          resolve(resp?.config || null);
        });
      });
    } catch {
    }
    const apiPatternOverride = remoteConfig?.luma_api_pattern ? new RegExp(remoteConfig.luma_api_pattern, "i") : void 0;
    const interceptor = installGuestApiInterceptor(apiPatternOverride);
    const preClickLinks = new Set(extractGuestProfileUrlsFromPage());
    console.log("[IHN] Pre-click /u/ links on page:", preClickLinks.size);
    const buttonLabels = remoteConfig?.luma_button_labels || ["Guests", "Going", "Attendees", "See all", "Went", "Registered"];
    const labelPatterns = [
      /\band \d+ others\b/i,
      ...buttonLabels.map((label) => new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"))
    ];
    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
    const allBtnTexts = allBtns.map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 20);
    let buttonClicked = false;
    for (const pattern of labelPatterns) {
      const btn = allBtns.find((b) => pattern.test(b.textContent ?? ""));
      if (btn) {
        btn.click();
        buttonClicked = true;
        break;
      }
    }
    console.log("[IHN] Guest button clicked:", buttonClicked);
    await new Promise((r) => setTimeout(r, 3e3));
    const modal = findModalScrollable(/* @__PURE__ */ new Set());
    if (modal) {
      console.log("[IHN] Scrollable modal found, scrolling to load all");
      await scrollToLoadAll(modal, 20);
      await new Promise((r) => setTimeout(r, 1500));
    }
    interceptor.cleanup();
    let apiGuests = interceptor.getGuests();
    console.log("[IHN] Intercepted API guests:", apiGuests.length);
    if (apiGuests.length === 0) {
      const postClickLinks = extractGuestProfileUrlsFromPage();
      console.log("[IHN] Post-click /u/ links on page:", postClickLinks.length);
      apiGuests = postClickLinks.map((url) => ({
        username: url.split("/").pop() ?? "",
        name: "",
        profileUrl: url,
        linkedInUrl: "",
        instagramUrl: "",
        twitterUrl: "",
        websiteUrl: ""
      }));
    }
    const hostProfileUrls = extractHostProfileUrls(document);
    const hostSet = new Set(hostProfileUrls);
    const normalizeProfileUrl = (url) => {
      try {
        const u = new URL(url, location.origin);
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length >= 2 && (parts[0] === "user" || parts[0] === "u")) {
          return `${location.origin.replace(/\/$/, "")}/u/${parts[1]}`;
        }
      } catch {
      }
      return url;
    };
    const seen = /* @__PURE__ */ new Set();
    const contacts = [];
    for (const h of hostProfileUrls) {
      const norm = normalizeProfileUrl(h);
      if (seen.has(norm)) continue;
      seen.add(norm);
      const apiEntry = apiGuests.find((g) => normalizeProfileUrl(g.profileUrl) === norm);
      contacts.push({
        url: norm,
        isHost: true,
        name: apiEntry?.name || norm.split("/").pop()?.replace(/-/g, " ") || "",
        linkedInUrl: apiEntry?.linkedInUrl || "",
        instagramUrl: apiEntry?.instagramUrl || "",
        twitterUrl: apiEntry?.twitterUrl || "",
        websiteUrl: apiEntry?.websiteUrl || ""
      });
    }
    for (const g of apiGuests) {
      const norm = normalizeProfileUrl(g.profileUrl);
      if (seen.has(norm)) continue;
      seen.add(norm);
      const isHost = hostSet.has(g.profileUrl) || hostProfileUrls.some((h) => normalizeProfileUrl(h) === norm);
      contacts.push({
        url: norm,
        isHost,
        name: g.name || norm.split("/").pop()?.replace(/-/g, " ") || "",
        linkedInUrl: g.linkedInUrl,
        instagramUrl: g.instagramUrl,
        twitterUrl: g.twitterUrl,
        websiteUrl: g.websiteUrl
      });
    }
    const apiHadSocial = contacts.some((c) => c.linkedInUrl);
    console.log("[IHN] Contacts from API:", contacts.length, "with LinkedIn from API:", contacts.filter((c) => c.linkedInUrl).length);
    const existingUrlsSet = new Set(existingUrls);
    const newContacts = existingUrlsSet.size > 0 ? contacts.filter((c) => !existingUrlsSet.has(c.url)) : contacts;
    console.log("[IHN] Delta scan: existingUrls:", existingUrlsSet.size, "newContacts:", newContacts.length);
    chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", phase: "scraping_done", total: newContacts.length, eventName, lumaUrl });
    if (!apiHadSocial && newContacts.length > 0) {
      console.log("[IHN] API had no social data, fetching profile pages as fallback");
      let done = 0;
      for (const contact of newContacts) {
        try {
          const resp = await fetch(contact.url, { credentials: "include" });
          const html = await resp.text();
          const profile = extractProfileFromNextData(html);
          if (profile) {
            contact.name = profile.name || contact.name;
            contact.linkedInUrl = profile.linkedInUrl;
            contact.instagramUrl = profile.instagramUrl;
            contact.twitterUrl = profile.twitterUrl;
            contact.websiteUrl = profile.websiteUrl;
          } else {
            contact.name = extractDisplayNameFromHtml(html) || contact.name;
            contact.linkedInUrl = extractLinkedInUrlFromHtml(html);
            contact.instagramUrl = extractInstagramUrlFromHtml(html);
            contact.twitterUrl = extractTwitterUrlFromHtml(html);
            contact.websiteUrl = extractWebsiteUrlFromHtml(html);
          }
        } catch (err) {
          console.error("[IHN] Fetch failed for", contact.url, err);
        }
        done++;
        chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", phase: "enriching", done, total: newContacts.length, currentName: contact.name });
      }
    }
    console.log("[IHN] Enrichment done. Contacts:", contacts.length, "with LinkedIn:", contacts.filter((c) => c.linkedInUrl).length);
    chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", phase: "saving", done: contacts.length, total: contacts.length });
    const saveResult = await Promise.race([
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "START_ENRICHMENT", data: { tabId: 0, lumaUrl, eventName, contacts: newContacts } }, resolve);
      }),
      new Promise((resolve) => setTimeout(() => resolve({ eventId: "", found: 0, total: newContacts.length }), 15e3))
    ]);
    const actualTotal = newContacts.length;
    const actualFound = newContacts.filter((c) => c.linkedInUrl).length;
    console.log("[IHN] SCAN_COMPLETE sending. newContacts:", actualTotal, "found:", actualFound, "eventId:", saveResult.eventId || "(save failed)");
    const scanDebug = {
      eventUrl: lumaUrl,
      buttonClicked,
      buttonTexts: allBtnTexts.slice(0, 10),
      preClickLinks: preClickLinks.size,
      apiGuestsCount: apiGuests.length,
      domGuestsCount: extractGuestProfileUrlsFromPage().length,
      modalFound: !!modal,
      apiHadSocial
    };
    chrome.runtime.sendMessage({ type: "SCAN_COMPLETE", eventId: saveResult.eventId, total: actualTotal, found: actualFound, contacts: newContacts, newCount: actualFound, scanDebug });
  }
  if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "START_SCAN") {
      runScan(msg.existingUrls ?? []);
      sendResponse({ started: true });
      return true;
    }
    if (msg.type === "SCRAPE_LUMA" || msg.type === "SCRAPE_LUMA_FOR_POST") {
      scrapeLumaPage().then((result) => {
        sendResponse({
          count: result.guestProfileUrls.length + result.hostProfileUrls.length,
          eventName: result.eventName,
          hostName: result.hostName,
          hostProfileUrls: result.hostProfileUrls,
          guestProfileUrls: result.guestProfileUrls
        });
      });
      return true;
    }
    if (msg.type === "GET_PREVIEW_EVENT_URL") {
      const nonEventPaths = /* @__PURE__ */ new Set(["", "/", "/home", "/calendar", "/events", "/discover", "/explore", "/settings", "/dashboard"]);
      const links = Array.from(document.querySelectorAll("a[href]"));
      const eventLink = links.find((a) => {
        try {
          const url = new URL(a.href);
          if (!url.hostname.includes("lu.ma") && !url.hostname.includes("luma.com")) return false;
          const parts = url.pathname.split("/").filter(Boolean);
          return parts.length === 1 && !nonEventPaths.has("/" + parts[0]);
        } catch {
          return false;
        }
      });
      const name = eventLink ? eventLink.closest('[class*="event"], [class*="card"], [class*="item"]')?.querySelector('h1,h2,h3,[class*="title"],[class*="name"]')?.textContent?.trim() ?? null : null;
      sendResponse({ url: eventLink?.href ?? null, name });
      return false;
    }
  });
})();
