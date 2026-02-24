import { getSupabase } from '../lib/supabase'

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
    <div class="event-name" id="eventName">Loading…</div>
    <div class="attendee-count" id="attendeeCount"></div>
    <button class="btn-primary" id="btnConnect">Connect with Attendees →</button>
    <button class="btn-secondary" id="btnPost">Generate LinkedIn Post →</button>
  `

  document.getElementById('btnConnect')!.addEventListener('click', onConnect)
  document.getElementById('btnPost')!.addEventListener('click', onPost)
}

async function onConnect() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  document.getElementById('status')!.textContent = 'Scraping attendees…'

  chrome.tabs.sendMessage(tab.id!, { type: 'SCRAPE_LUMA' }, async (response) => {
    if (!response?.guestProfileUrls) {
      document.getElementById('status')!.textContent = 'Could not scrape page.'
      return
    }
    document.getElementById('status')!.textContent = 'Saving contacts…'

    chrome.runtime.sendMessage({
      type: 'SAVE_CONTACTS',
      data: {
        eventName: response.eventName,
        lumaUrl: tab.url,
        hostName: response.hostName,
        guestProfileUrls: response.guestProfileUrls,
      }
    }, (result) => {
      document.getElementById('status')!.textContent =
        `Queued ${result?.saved ?? 0} contacts. Sending connections at 40/day.`
    })
  })
}

async function onPost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  document.getElementById('status')!.textContent = 'Scraping event…'
  chrome.tabs.sendMessage(tab.id!, { type: 'SCRAPE_LUMA_FOR_POST' }, (response) => {
    if (response?.eventName) {
      const params = new URLSearchParams({
        event: response.eventName,
        host: response.hostName ?? '',
      })
      chrome.tabs.create({ url: `http://localhost:3000/post?${params}` })
    }
  })
}

init()
