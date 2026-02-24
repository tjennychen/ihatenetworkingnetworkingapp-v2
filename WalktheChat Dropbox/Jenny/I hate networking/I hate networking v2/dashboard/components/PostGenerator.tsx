'use client'
import { useState } from 'react'
import type { Contact } from '@/lib/types'

export default function PostGenerator({ contacts }: { contacts: Contact[] }) {
  const [hostName, setHostName]   = useState('')
  const [eventName, setEventName] = useState('')
  const [post, setPost]           = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)

  // Pre-fill guests from contacts (first names only, non-hosts)
  const guestNames = contacts
    .filter(c => !c.is_host && c.first_name)
    .map(c => c.first_name)

  async function handleGenerate() {
    setLoading(true)
    setError('')
    setPost('')
    const res = await fetch('/api/generate-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName, guestNames, eventName }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to generate post')
    } else {
      setPost(data.post)
    }
    setLoading(false)
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(post)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-xl">
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Event name</label>
          <input value={eventName} onChange={e => setEventName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Founder Summit NYC" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Host name</label>
          <input value={hostName} onChange={e => setHostName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Sarah Chen" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Guests to tag <span className="text-gray-400">({guestNames.length} from contacts)</span>
          </label>
          <p className="text-xs text-gray-400">{guestNames.slice(0, 8).join(', ')}{guestNames.length > 8 ? '…' : ''}</p>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !hostName || !eventName}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {loading ? 'Generating…' : 'Generate Post'}
      </button>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {post && (
        <div className="mt-6">
          <div className="bg-white border border-gray-100 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {post}
          </div>
          <button
            onClick={handleCopy}
            className="mt-3 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
          <p className="mt-2 text-xs text-gray-400">
            Paste into LinkedIn, then manually tag the host and guests in your photo.
          </p>
        </div>
      )}
    </div>
  )
}
