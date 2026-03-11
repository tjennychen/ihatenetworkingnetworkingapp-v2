"use strict";
(() => {
  // content/linkedin.ts
  function nativeClick(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }
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
      const ariaBtn = openMenu.querySelector('[aria-label^="Connect" i], [aria-label^="Invite" i]');
      if (ariaBtn) return ariaBtn;
      const inMenu = findButtonByText("Connect", openMenu);
      if (inMenu && /^connect/i.test(inMenu.textContent?.trim() ?? "")) return inMenu;
      const divBtn = openMenu.querySelector(
        'div[role="button"][aria-label^="Invite" i], div[role="button"][aria-label^="Connect" i]'
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
    const lastResort = findButtonByText("Connect", getProfileTopCard());
    if (lastResort && /^connect/i.test(lastResort.textContent?.trim() ?? "")) return lastResort;
    return null;
  }
  function buildTrace() {
    const fields = [];
    return {
      set(key, val) {
        fields.push(`${key}=${val}`);
      },
      toString() {
        return fields.join("|");
      }
    };
  }
  function waitForDropdown(timeoutMs = 2e3) {
    return new Promise((resolve) => {
      const interval = 100;
      let elapsed = 0;
      const check = () => {
        const open = !!document.querySelector(
          '.artdeco-dropdown__content--is-open, [role="menu"], [data-test-dropdown-content]'
        );
        if (open) {
          resolve(true);
          return;
        }
        elapsed += interval;
        if (elapsed >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }
  function waitForModal(timeoutMs = 3e3) {
    return new Promise((resolve) => {
      const interval = 150;
      let elapsed = 0;
      const check = () => {
        const hasDialog = !!document.querySelector('[role="dialog"]');
        const hasShadow = !!document.querySelector("#interop-outlet")?.shadowRoot?.childElementCount;
        if (hasDialog || hasShadow) {
          resolve(true);
          return;
        }
        elapsed += interval;
        if (elapsed >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }
  async function openMoreActionsIfNeeded() {
    const topCard = getProfileTopCard();
    const moreBtn = topCard.querySelector(
      "button[aria-label*='More actions'], button[aria-label*='More member actions'], button[aria-label*='Resources']"
    ) ?? findButtonByText("More", topCard) ?? findButtonByText("Resources", topCard);
    if (!moreBtn) return "not-found";
    nativeClick(moreBtn);
    const opened = await waitForDropdown(2e3);
    return opened ? "opened" : "timeout";
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
    if (parts.length === 0) return true;
    const firstName = parts[0];
    return page.includes(firstName) || pageWords.some((w) => w.length === 1 && firstName.startsWith(w));
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
    const trace = buildTrace();
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
    trace.set("connectBtn", connectBtn ? "direct" : "null");
    if (!connectBtn) {
      const moreResult = await openMoreActionsIfNeeded();
      trace.set("more", moreResult);
      connectBtn = findConnectButton();
      trace.set("connectAfterMore", connectBtn ? "found" : "null");
    }
    if (!connectBtn && findButtonByText("Message", main)) {
      return { success: false, error: "already_connected" };
    }
    if (!connectBtn) {
      if (isThirdDegree) return { success: false, error: "third_degree" };
      return { success: false, error: "connect_not_available" };
    }
    nativeClick(connectBtn);
    const modalAppeared = await waitForModal(3e3);
    trace.set("modal", modalAppeared ? "yes" : "timeout");
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
    const paywallDismissed = await dismissPremiumPaywall();
    trace.set("paywall", paywallDismissed ? "yes" : "no");
    if (paywallDismissed) {
      await new Promise((r) => setTimeout(r, 600));
      const remainingDialog = document.querySelector('[role="dialog"]');
      if (remainingDialog) {
        remainingDialog.querySelector('[aria-label="Dismiss"], [aria-label="Close"]')?.click();
        await new Promise((r) => setTimeout(r, 500));
      }
      let retryBtn = findConnectButton();
      if (!retryBtn) {
        await openMoreActionsIfNeeded();
        retryBtn = findConnectButton();
      }
      trace.set("paywallRetry", retryBtn ? "found" : "null");
      if (!retryBtn) return { success: false, error: "paywall_no_connect", trace: trace.toString() };
      nativeClick(retryBtn);
      await waitForModal(2e3);
      const paywallAgain = await dismissPremiumPaywall();
      if (paywallAgain) return { success: false, error: "paywall_loop", trace: trace.toString() };
    }
    const noteQuotaReached = await getNoteQuotaReached();
    if (note && !noteQuotaReached) {
      const addNoteBtn = findButtonByText("Add a note");
      if (addNoteBtn) {
        nativeClick(addNoteBtn);
        await new Promise((r) => setTimeout(r, 500));
        const paywalled = await dismissPremiumPaywall();
        if (!paywalled) {
          const textarea = document.querySelector(
            'textarea#custom-message, textarea[name="message"], textarea[id*="note"], [class*="connect-button"] textarea, textarea'
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
            if (!retryBtn) return { success: false, error: "note_quota_reached", trace: trace.toString() };
            nativeClick(retryBtn);
            await waitForModal(2e3);
          }
        }
      }
    }
    const shadowHost = document.querySelector("#interop-outlet");
    const shadowSendBtn = shadowHost?.shadowRoot?.querySelector(
      'button[aria-label="Send without a note"], button[aria-label="Send now"], button.artdeco-button--primary'
    ) ?? null;
    trace.set("shadowBtn", shadowSendBtn ? "found" : "null");
    const openDialog = document.querySelector('[role="dialog"]');
    const sendBtn = shadowSendBtn ?? (openDialog ? findButtonByText("Send without a note", openDialog) : null) ?? (openDialog ? findButtonByText("Send", openDialog) : null) ?? document.querySelector('[aria-label="Send now"]') ?? document.querySelector('[data-control-name="send_invite"]');
    trace.set("regularBtn", sendBtn ? "found" : "null");
    if (!sendBtn) {
      return { success: false, error: "send_btn_not_found", trace: trace.toString() };
    }
    const preSendLimit = document.querySelector(".ip-fuse-limit-alert, #ip-fuse-limit-alert__header");
    if (preSendLimit && getComputedStyle(preSendLimit).display !== "none") {
      return { success: false, error: "weekly_limit_reached", trace: trace.toString() };
    }
    nativeClick(sendBtn);
    let modalClosed = false;
    const verifyDeadline = Date.now() + 3e3;
    while (Date.now() < verifyDeadline) {
      await new Promise((r) => setTimeout(r, 300));
      const bodyText = document.body.innerText;
      if (bodyText.includes("weekly invitation limit") || bodyText.includes("reached the weekly")) {
        return { success: false, error: "weekly_limit_reached", trace: trace.toString() };
      }
      const stillOpen = !!document.querySelector('[role="dialog"]') || !!document.querySelector("#interop-outlet")?.shadowRoot?.childElementCount;
      if (!stillOpen) {
        modalClosed = true;
        break;
      }
    }
    trace.set("modalClosed", modalClosed ? "yes" : "no");
    if (!modalClosed) {
      return { success: false, error: "send_unverified", trace: trace.toString() };
    }
    return { success: true, trace: trace.toString() };
  }
  var BAD_NAMES = /* @__PURE__ */ new Set(["linkedin", "sign in", "log in", "login", "join linkedin"]);
  function extractNameFromHtml(html) {
    const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/) ?? html.match(/content="([^"]+)"\s+property="og:title"/);
    if (ogMatch) {
      const name = ogMatch[1].trim();
      if (!BAD_NAMES.has(name.toLowerCase())) return name;
    }
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      const name = titleMatch[1].replace(/\s*[|\-–]\s*.*$/i, "").trim();
      if (!BAD_NAMES.has(name.toLowerCase())) return name;
    }
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
            if (resp.ok) {
              const html = await resp.text();
              linkedinName = extractNameFromHtml(html);
            }
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
