type PostInput = {
  hostNames: string[]
  guestNames: string[]
  eventName: string
}

export function buildPostPrompt({ hostNames, guestNames, eventName }: PostInput): string {
  const hostList = hostNames.length > 0 ? hostNames.join(', ') : 'the host'
  const guestList = guestNames.length > 0
    ? `Mention these attendees by first name: ${guestNames.join(', ')}.`
    : ''

  return `Write a warm, genuine LinkedIn post for someone who just attended "${eventName}".

Requirements:
- Thank ${hostList} for hosting — write their names exactly as given so the poster can tag them on LinkedIn
- ${guestList} Use first names only
- Tone: genuine, warm, not corporate or salesy
- Length: 150–250 words
- No hashtags
- Write in first person
- Do not use phrases like "I had the pleasure" or "incredible" — keep it natural
- End with a call to connect with people at the event

Return only the post text, nothing else.`
}
