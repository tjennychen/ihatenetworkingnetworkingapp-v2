type PostInput = {
  hostName: string
  guestNames: string[]
  eventName: string
}

export function buildPostPrompt({ hostName, guestNames, eventName }: PostInput): string {
  const guestList = guestNames.length > 0
    ? `Guests to thank: ${guestNames.join(', ')}.`
    : 'No guests to tag.'

  return `Write a warm, genuine LinkedIn post for someone who just attended "${eventName}".

Requirements:
- Thank the host ${hostName} by name (they will manually tag them on LinkedIn)
- ${guestList} Include first names only — the user will manually tag them in the LinkedIn post
- Tone: genuine, warm, not corporate or salesy
- Length: 150–250 words
- No hashtags
- Write in first person
- Do not use phrases like "I had the pleasure" or "incredible" — keep it natural
- End with a call to connect with people at the event

Return only the post text, nothing else.`
}
