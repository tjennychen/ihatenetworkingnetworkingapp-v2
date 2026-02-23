export type Event = {
  id: string
  user_id: string
  luma_url: string
  name: string
  date: string | null
  city: string
  created_at: string
}

export type Contact = {
  id: string
  user_id: string
  event_id: string
  name: string
  first_name: string
  last_name: string
  linkedin_url: string
  linkedin_urn: string
  headline: string
  company: string
  city: string
  instagram_url: string
  photo_url: string
  luma_profile_url: string
  is_host: boolean
  created_at: string
  // Joined
  events?: Event
}

export type ConnectionQueue = {
  id: string
  user_id: string
  contact_id: string
  status: 'pending' | 'sent' | 'accepted' | 'failed'
  scheduled_at: string
  sent_at: string | null
  accepted_at: string | null
  error: string
  created_at: string
}
