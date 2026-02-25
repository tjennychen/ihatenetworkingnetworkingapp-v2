async function init() {
  const content = document.getElementById('content')!
  const { session }: { session?: any } = await chrome.storage.local.get('session')

  if (!session) {
    content.innerHTML = `
      <div class="login-prompt">
        Not logged in.<br><br>
        <a href="https://ihn-dashboard.vercel.app/login" target="_blank">Open dashboard to log in</a>
      </div>`
    return
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const isLuma = (tab.url ?? '').includes('lu.ma') || (tab.url ?? '').includes('luma.com')

  if (!isLuma) {
    content.innerHTML = '<div class="not-luma">Navigate to a Luma event page to get started.</div>'
    return
  }

  content.innerHTML = `<button class="btn-primary" id="btnScan">Scan this event →</button>`
  document.getElementById('btnScan')!.addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id!, { type: 'OPEN_PANEL' })
    window.close()
  })
}

init()
