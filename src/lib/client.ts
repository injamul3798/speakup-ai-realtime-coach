const CLIENT_ID_KEY = 'speakup_client_id';
const AUTH_TOKEN_KEY = 'speakup_auth_token';


export function getClientId() {
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

export function setClientId(clientId: string) {
  window.localStorage.setItem(CLIENT_ID_KEY, clientId);
}

export function getAuthToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function setAuthToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuth() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(CLIENT_ID_KEY);
}
