"use strict";
(() => {
  // content/linkedin.ts
  function getMain() {
    return document.querySelector("main") ?? document.body;
  }
  function getProfileTopCard() {
    const h1 = document.querySelector("h1");
    if (h1) {
      let el = h1.parentElement;
      for (let i = 0; i < 8 && el && el !== document.documentElement; i++) {
        if (el.tagName === "SECTION") return el;
        el = el.parentElement;
      }
    }
    return getMain();
  }
  function findButtonByText(text, root = document.body) {
    const lower = text.toLowerCase();
    const buttons = Array.from(root.querySelectorAll("button"));
    return buttons.find((b) => b.textContent?.trim() === text) ?? buttons.find((b) => b.textContent?.trim().toLowerCase().includes(lower)) ?? null;
  }
  function findConnectButton() {
    const main = getMain();
    const direct = main.querySelector(
      'button[aria-label*="Connect"], [aria-label*="Connect with"], button[aria-label*="Invite"], [data-control-name="connect"]'
    );
    if (direct) return direct;
    const openMenu = document.querySelector(
      '[role="menu"], .artdeco-dropdown__content--is-open, [data-test-dropdown-content]'
    );
    if (openMenu) {
      const ariaBtn = openMenu.querySelector('[aria-label*="Connect"]');
      if (ariaBtn) return ariaBtn;
      const inMenu = findButtonByText("Connect", openMenu);
      if (inMenu) return inMenu;
      const divBtn = openMenu.querySelector(
        'div[role="button"][aria-label*="Invite"][aria-label*="connect"], div[role="button"][aria-label*="connect" i]'
      );
      if (divBtn) return divBtn;
    }
    const menuItems = Array.from(document.querySelectorAll(
      '[role="menuitem"], [role="option"], .artdeco-dropdown__item'
    ));
    const connectItem = menuItems.find(
      (el) => /^connect$/i.test(el.textContent?.trim() ?? "") || el.textContent?.trim().toLowerCase().startsWith("connect")
    );
    if (connectItem) return connectItem;
    return findButtonByText("Connect", getProfileTopCard());
  }
  async function openMoreActionsIfNeeded() {
    const topCard = getProfileTopCard();
    const moreBtn = topCard.querySelector(
      "button[aria-label*='More actions'], button[aria-label*='More member actions']"
    ) ?? findButtonByText("More", topCard);
    if (moreBtn) {
      moreBtn.click();
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  async function dismissPremiumPaywall() {
    const paywall = document.querySelector(
      '[class*="premium-upsell"], [class*="premium_upsell"], [data-test-modal*="premium"], [aria-label*="Premium"]'
    );
    const reactivateBtn = findButtonByText("Reactivate Premium");
    if (!paywall && !reactivateBtn) return false;
    const dialog = (reactivateBtn ?? paywall)?.closest('[role="dialog"]') ?? document;
    const closeBtn = dialog.querySelector('[aria-label="Dismiss"], [aria-label="Close"], [data-test-modal-close-btn], button[data-modal-dismiss]') ?? document.querySelector('[aria-label="Dismiss"], [aria-label="Close"]');
    closeBtn?.click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }
  function getProfileName() {
    const h1 = document.querySelector("h1");
    return h1?.textContent?.trim() ?? "";
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
  function getNoteQuotaReached() {
    return new Promise((resolve) => chrome.storage.local.get("noteQuotaReached", (r) => resolve(!!r.noteQuotaReached)));
  }
  function setNoteQuotaReached() {
    return new Promise((resolve) => chrome.storage.local.set({ noteQuotaReached: true }, resolve));
  }
  async function sendConnection(note, expectedName) {
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1e3));
    if (!window.location.pathname.startsWith("/in/")) {
      return { success: false, error: "Not a profile page" };
    }
    const pageName = getProfileName();
    if (!namesMatch(pageName, expectedName ?? "")) {
      return { success: false, error: `wrong_profile: expected "${expectedName}", got "${pageName}"` };
    }
    const main = getMain();
    if (findButtonByText("Pending", main) || findButtonByText("Withdraw", main)) {
      return { success: false, error: "already_pending" };
    }
    const degreeEl = document.querySelector('[class*="distance-badge"], [class*="dist-value"]');
    const degree = degreeEl?.textContent?.trim() ?? "";
    const isThirdDegree = degree.startsWith("3");
    let connectBtn = findConnectButton();
    if (!connectBtn) {
      await openMoreActionsIfNeeded();
      connectBtn = findConnectButton();
    }
    if (!connectBtn && findButtonByText("Message", main)) {
      return { success: false, error: "already_connected" };
    }
    if (!connectBtn) {
      if (isThirdDegree) return { success: false, error: "third_degree" };
      return { success: false, error: "connect_not_available" };
    }
    connectBtn.click();
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
    const errorToast = document.querySelector('div[data-test-artdeco-toast-item-type="error"]');
    if (errorToast) {
      return { success: false, error: `linkedin_error: ${errorToast.textContent?.trim() ?? "unknown"}` };
    }
    if (expectedName) {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        const dialogText = dialog.textContent ?? "";
        if (!namesMatch(dialogText, expectedName)) {
          dialog.querySelector('[aria-label="Dismiss"], [aria-label="Close"]')?.click();
          return { success: false, error: `wrong_connect_modal: expected "${expectedName}"` };
        }
      }
    }
    await dismissPremiumPaywall();
    const noteQuotaReached = await getNoteQuotaReached();
    if (note && !noteQuotaReached) {
      const addNoteBtn = findButtonByText("Add a note");
      if (addNoteBtn) {
        addNoteBtn.click();
        await new Promise((r) => setTimeout(r, 500));
        const paywalled = await dismissPremiumPaywall();
        if (!paywalled) {
          const textarea = document.querySelector(
            'textarea[name="message"], textarea[id*="note"], [class*="connect-button"] textarea, textarea'
          );
          if (textarea) {
            textarea.focus();
            textarea.value = note;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            textarea.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 300));
          }
        } else {
          await setNoteQuotaReached();
          await new Promise((r) => setTimeout(r, 600));
          if (!findButtonByText("Send without a note")) {
            let retryBtn = findConnectButton();
            if (!retryBtn) {
              await openMoreActionsIfNeeded();
              retryBtn = findConnectButton();
            }
            if (!retryBtn) return { success: false, error: "note_quota_reached" };
            retryBtn.click();
            await new Promise((r) => setTimeout(r, 800 + Math.random() * 500));
          }
        }
      }
    }
    const sendBtn = findButtonByText("Send") ?? findButtonByText("Send without a note") ?? document.querySelector('[aria-label="Send now"]') ?? // Reference fallback: data-control-name="send_invite" for older LinkedIn modal variants
    document.querySelector('[data-control-name="send_invite"]');
    if (!sendBtn) {
      return { success: false, error: "send_btn_not_found" };
    }
    sendBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    const bodyText = document.body.innerText;
    if (bodyText.includes("weekly invitation limit") || bodyText.includes("reached the weekly")) {
      return { success: false, error: "weekly_limit_reached" };
    }
    return { success: true };
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
