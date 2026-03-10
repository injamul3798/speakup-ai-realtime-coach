const CLIENT_ID_KEY = 'speakup_client_id';


export function getClientId() {
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}
