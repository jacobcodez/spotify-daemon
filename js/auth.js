// auth.js — Spotify Authorization Code + PKCE flow for a backend-less site.
// The client id is public (fine for PKCE). Tokens live in localStorage.

const CFG = (typeof window !== 'undefined' && window.SEGUE_CONFIG) || {};
const CLIENT_ID = CFG.clientId || '';
const REDIRECT_URI = CFG.redirectUri || (location.origin + location.pathname);
const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOK_KEY = 'segue.token.v1';
const VERIFIER_KEY = 'segue.pkce_verifier';

// ---- PKCE helpers ---------------------------------------------------------

function randString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function sha256base64url(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let bin = '';
  new Uint8Array(digest).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---- token storage --------------------------------------------------------

function saveToken(tok) {
  tok.obtained_at = Date.now();
  localStorage.setItem(TOK_KEY, JSON.stringify(tok));
}
function readToken() {
  try { return JSON.parse(localStorage.getItem(TOK_KEY)); } catch { return null; }
}
export function clearToken() {
  localStorage.removeItem(TOK_KEY);
}
export function isConnected() {
  return !!readToken();
}
export function isConfigured() {
  return !!CLIENT_ID;
}

// ---- flow -----------------------------------------------------------------

export async function login() {
  if (!CLIENT_ID) throw new Error('no client id — copy config.example.js to config.js and fill it in');
  const verifier = randString(64);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = await sha256base64url(verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
  });
  location.href = `${AUTH_URL}?${params}`;
}

// Call once on load: if we came back with ?code=..., exchange it.
export async function handleRedirect() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err) {
    cleanUrl();
    throw new Error(`Spotify auth error: ${err}`);
  }
  if (!code) return false;

  const verifier = localStorage.getItem(VERIFIER_KEY);
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier || '',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  cleanUrl();
  if (!res.ok) throw new Error('token exchange failed: ' + (await res.text()));
  const tok = await res.json();
  saveToken(tok);
  localStorage.removeItem(VERIFIER_KEY);
  return true;
}

async function refresh() {
  const tok = readToken();
  if (!tok || !tok.refresh_token) throw new Error('no refresh token — reconnect');
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: tok.refresh_token,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) { clearToken(); throw new Error('refresh failed — reconnect'); }
  const fresh = await res.json();
  // Spotify may omit a new refresh_token; keep the old one.
  if (!fresh.refresh_token) fresh.refresh_token = tok.refresh_token;
  saveToken(fresh);
  return fresh;
}

// Return a valid access token, refreshing if it's expired/near expiry.
export async function getAccessToken() {
  let tok = readToken();
  if (!tok) throw new Error('not connected');
  const ageMs = Date.now() - (tok.obtained_at || 0);
  const ttlMs = (tok.expires_in || 3600) * 1000;
  if (ageMs > ttlMs - 60_000) tok = await refresh();
  return tok.access_token;
}

function cleanUrl() {
  const url = new URL(location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  history.replaceState({}, '', url.pathname + url.search + url.hash);
}
