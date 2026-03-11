"use strict";
(() => {
  // content/login-bridge.ts
  var STORAGE_KEY = "sb-urgibxjxbcyvprdejplp-auth-token";
  function forwardSession() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.access_token && data.user) {
        chrome.runtime.sendMessage({
          type: "SET_AUTH",
          session: {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user: { id: data.user.id, email: data.user.email }
          }
        });
      }
    } catch {
    }
  }
  forwardSession();
  new MutationObserver(() => forwardSession()).observe(document.body, { childList: true, subtree: true });
})();
