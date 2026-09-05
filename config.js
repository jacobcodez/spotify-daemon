// config.js — real config (committed; the PKCE client id is public and safe to
// expose, and redirectUri auto-derives from the page URL). Fill in your Spotify
// client id below. Until you do, the app runs fully offline (canvas + local
// editing) and shows "no config" — Connect/Import/Push stay dormant.
window.SEGUE_CONFIG = {
  clientId: '15f3f4f354684052a77f3d1d6b245c09', // Spotify Client ID (public/safe under PKCE)
  redirectUri: location.origin + location.pathname,
};
