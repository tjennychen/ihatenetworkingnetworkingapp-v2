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
    const paywall = document.querySelector('[class*="premium"], [class*="upsell"]');
    if (!paywall) return false;
    const closeBtn = document.querySelector(
      '[aria-label="Dismiss"], [aria-label="Close"], button[data-modal-dismiss]'
    );
    closeBtn?.click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }
  async function sendConnection() {
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
    const addNoteBtn = findButtonByText("Add a note");
    if (addNoteBtn) {
      if (await dismissPremiumPaywall()) {
      } else {
        addNoteBtn.click();
        await new Promise((r) => setTimeout(r, 500));
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
      sendConnection().then((result) => sendResponse(result));
      return true;
    }
  });
})();
