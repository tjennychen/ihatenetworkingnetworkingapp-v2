'use client'
import { useState } from 'react'
import type { Contact } from '@/lib/types'

type Props = {
  contacts: Contact[]
  eventName?: string
}

export default function PostGenerator({ contacts, eventName: initialEvent = '' }: Props) {
  const [eventName, setEventName] = useState(initialEvent)
  const [post, setPost]           = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)

  const hosts = contacts.filter(c => c.is_host && c.name)
  const guests = contacts.filter(c => !c.is_host && c.name)

  const hostNames = hosts.map(c => c.name)
  const guestNames = guests.map(c => c.first_name || c.name.split(' ')[0])

  // All attendee names for photo tagging (hosts first, then guests)
  const allNames = [...hosts, ...guests].map(c => c.name)

  async function handleGenerate() {
    setLoading(true)
    setError('')
    setPost('')
    const res = await fetch('/api/generate-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostNames, guestNames, eventName }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to generate post')
    } else {
      setPost(data.post)
    }
    setLoading(false)
  }

  // The full block to copy: post + photo tagging section
  function buildCopyText() {
    const taggingSection = allNames.length > 0
      ? `\n\n📸 Tag these people in your event photo:\nTo get more engagement, tag attendees when you post your photo.\nJust type their names in LinkedIn's tag field when uploading:\n\n${allNames.join('\n')}`
      : ''
    return post + taggingSection
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildCopyText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
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

        {hosts.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              Hosts <span className="text-gray-400 font-normal">({hosts.length})</span>
            </p>
            <p className="text-sm text-gray-600">{hosts.map(h => h.name).join(', ')}</p>
          </div>
        )}

        {hosts.length === 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No hosts found yet. Run "Import LinkedIn Contacts" from a Luma event to populate hosts.
          </p>
        )}

        <div>
          <p className="text-sm font-medium text-gray-700 mb-1">
            Attendees to tag <span className="text-gray-400 font-normal">({guestNames.length} guests)</span>
          </p>
          <p className="text-xs text-gray-400">
            {guestNames.slice(0, 8).join(', ')}{guestNames.length > 8 ? `… +${guestNames.length - 8} more` : ''}
          </p>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !eventName}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {loading ? 'Generating…' : 'Generate Post'}
      </button>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {post && (
        <div className="mt-6">
          {/* Combined copy block */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {post}

            {allNames.length > 0 && (
              <>
                <div className="mt-4 pt-4 border-t border-gray-100 text-gray-500">
                  <p className="font-medium text-gray-700 mb-1">📸 Tag these people in your event photo:</p>
                  <p className="text-xs text-gray-400 mb-2">
                    To get more engagement, tag attendees when you post your photo.
                    Just type their names in LinkedIn's tag field when uploading:
                  </p>
                  <p className="text-gray-700 whitespace-pre-wrap">{allNames.join('\n')}</p>
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleCopy}
            className="mt-3 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {copied ? '✓ Copied! Now paste into LinkedIn.' : 'Copy LinkedIn Post'}
          </button>
        </div>
      )}
    </div>
  )
}
