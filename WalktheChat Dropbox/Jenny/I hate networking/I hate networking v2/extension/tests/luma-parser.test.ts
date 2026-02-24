import { JSDOM } from 'jsdom'
import { extractLinkedInUrl, extractInstagramUrl, parseGuestLinks } from '../content/luma'

describe('extractLinkedInUrl', () => {
  it('extracts linkedin URL from profile page HTML', () => {
    const html = '<a href="https://linkedin.com/in/alice-chen">LinkedIn</a>'
    const dom = new JSDOM(html)
    expect(extractLinkedInUrl(dom.window.document)).toBe('https://linkedin.com/in/alice-chen')
  })
  it('returns empty string if no linkedin link', () => {
    const dom = new JSDOM('<p>no links here</p>')
    expect(extractLinkedInUrl(dom.window.document)).toBe('')
  })
})

describe('parseGuestLinks', () => {
  it('extracts /u/ links from page HTML', () => {
    const html = `
      <a href="/u/alice">Alice</a>
      <a href="/u/bob">Bob</a>
      <a href="/other">Other</a>
    `
    const dom = new JSDOM(html)
    const links = parseGuestLinks(dom.window.document)
    expect(links).toHaveLength(2)
    expect(links[0]).toContain('/u/alice')
  })
})
