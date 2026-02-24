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
    const labels = ["Guests", "Going", "Attendees", "See all"];
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
  if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
  });
})();
