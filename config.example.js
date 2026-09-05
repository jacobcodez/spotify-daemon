// config.example.js — copy this to config.js and fill in your values.
// config.js is gitignored (it's per-deployment, not a secret — the client id is
// public and safe to expose in PKCE, but redirect URIs differ per environment).
window.SEGUE_CONFIG = {
  // From the Spotify developer dashboard → your app → Client ID.
  clientId: 'YOUR_SPOTIFY_CLIENT_ID',

  // Must EXACTLY match a Redirect URI registered on the Spotify app.
  //   local dev:  http://localhost:8000/
  //   GitHub Pages: https://<user>.github.io/<repo>/
  // Leave as-is to auto-use the current page URL.
  redirectUri: location.origin + location.pathname,
};
