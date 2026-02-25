"use strict";
(() => {
  // content/linkedin.ts
  function findButtonByText(text) {
    return Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) ?? null;
  }
  function findConnectButton() {
    const direct = document.querySelector(
      '[aria-label*="Connect with"], button[aria-label*="Invite"], [data-control-name="connect"]'
    );
    if (direct) return direct;
    return findButtonByText("Connect");
  }
  async function openMoreActionsIfNeeded() {
    const moreBtn = document.querySelector(
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
  async function sendConnection(note) {
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1e3));
    if (!window.location.pathname.startsWith("/in/")) {
      return { success: false, error: "Not a profile page" };
    }
    let connectBtn = findConnectButton();
    if (!connectBtn) {
      await openMoreActionsIfNeeded();
      connectBtn = findConnectButton();
    }
    if (!connectBtn) {
      return { success: false, error: "Connect button not found \u2014 may already be connected or pending" };
    }
    connectBtn.click();
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
    await dismissPremiumPaywall();
    const addNoteBtn = findButtonByText("Add a note");
    if (addNoteBtn && note) {
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
      }
    }
    const sendBtn = findButtonByText("Send") ?? findButtonByText("Send without a note") ?? document.querySelector('[aria-label="Send now"]');
    if (!sendBtn) {
      return { success: false, error: "Send button not found" };
    }
    sendBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    return { success: true };
  }
  if (typeof chrome !== "undefined" && chrome.runtime) chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "CONNECT") {
      sendConnection(msg.note || "").then((result) => sendResponse(result));
      return true;
    }
  });
})();
