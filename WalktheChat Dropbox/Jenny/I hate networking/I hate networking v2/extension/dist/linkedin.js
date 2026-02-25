"use strict";
(() => {
  // content/linkedin.ts
  function getMain() {
    return document.querySelector("main") ?? document.body;
  }
  function findButtonByText(text, root = document.body) {
    return Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) ?? null;
  }
  function findConnectButton() {
    const main = getMain();
    const direct = main.querySelector(
      '[aria-label*="Connect with"], button[aria-label*="Invite"], [data-control-name="connect"]'
    );
    if (direct) return direct;
    return findButtonByText("Connect", main);
  }
  async function openMoreActionsIfNeeded() {
    const main = getMain();
    const moreBtn = main.querySelector(
      "button[aria-label='More actions'], button[aria-label*='More member actions']"
    );
    if (moreBtn) {
      moreBtn.click();
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  async function dismissPremiumPaywall() {
    const paywall = document.querySelector(
      '[class*="premium-upsell"], [class*="premium_upsell"], [data-test-modal*="premium"], [class*="upsell"], [aria-label*="Premium"]'
    );
    if (!paywall) return false;
    const closeBtn = document.querySelector(
      '[aria-label="Dismiss"], [aria-label="Close"], [data-test-modal-close-btn], button[data-modal-dismiss]'
    );
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
    const parts = normalize(expectedName).split(/\s+/).filter(Boolean);
    return parts.every((part) => page.includes(part));
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
    if (findButtonByText("Message", main) && !findConnectButton()) {
      return { success: false, error: "already_connected" };
    }
    const degreeEl = document.querySelector('[class*="distance-badge"], [class*="dist-value"]');
    const degree = degreeEl?.textContent?.trim() ?? "";
    const isThirdDegree = degree.startsWith("3");
    let connectBtn = findConnectButton();
    if (!connectBtn) {
      await openMoreActionsIfNeeded();
      connectBtn = findConnectButton();
    }
    if (!connectBtn) {
      if (isThirdDegree) return { success: false, error: "third_degree" };
      return { success: false, error: "connect_not_available" };
    }
    connectBtn.click();
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
    await dismissPremiumPaywall();
    if (note) {
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
          await new Promise((r) => setTimeout(r, 800));
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
    const sendBtn = findButtonByText("Send") ?? findButtonByText("Send without a note") ?? document.querySelector('[aria-label="Send now"]');
    if (!sendBtn) {
      return { success: false, error: "send_btn_not_found" };
    }
    sendBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    return { success: true };
  }
  if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "CONNECT") {
      sendConnection(msg.note || "", msg.expectedName || "").then((result) => sendResponse(result));
      return true;
    }
  });
})();
