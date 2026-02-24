"use strict";
(() => {
  // content/linkedin.ts
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "CONNECT") {
      sendResponse({ success: false, error: "Not implemented yet" });
    }
    return true;
  });
})();
