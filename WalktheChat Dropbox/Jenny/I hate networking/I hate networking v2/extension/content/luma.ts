chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SCRAPE_LUMA' || msg.type === 'SCRAPE_LUMA_FOR_POST') {
    sendResponse({ count: 0, error: 'Not implemented yet' })
  }
  return true
})
