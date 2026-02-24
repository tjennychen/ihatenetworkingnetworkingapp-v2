async function init() {
  const content = document.getElementById('content')!
  const { session }: { session?: any } = await chrome.storage.local.get('session')

  if (!session) {
    content.innerHTML = `
      <div class="login-prompt">
        Not logged in.<br><br>
        <a href="http://localhost:3000/login" target="_blank">Open dashboard to log in</a>
      </div>`
    return
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab.url ?? ''
  const isLuma = url.includes('lu.ma') || url.includes('luma.com')

  if (!isLuma) {
    content.innerHTML = '<div class="not-luma">Navigate to a Luma event page to get started.</div>'
    return
  }

  content.innerHTML = `
    <button class="btn-primary" id="btnConnect">Connect with Attendees &rarr;</button>
  `

  document.getElementById('btnConnect')!.addEventListener('click', async () => {
    chrome.tabs.sendMessage(tab.id!, { type: 'OPEN_PANEL' })
    window.close()
  })
}

init()
