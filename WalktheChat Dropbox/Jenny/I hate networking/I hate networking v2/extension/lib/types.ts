export type StoredSession = {
  access_token: string
  refresh_token: string
  user: { id: string; email: string }
}
