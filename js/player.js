// player.js — playback via Spotify's iframe Embed (IFrame API).
//
// Why the embed and not <audio>: new Spotify apps no longer receive
// `preview_url`, and full-track playback via the Web Playback SDK needs
// Premium + extra scopes. The embed plays a 30s preview for everyone (or the
// full track for Premium users logged into Spotify in this browser), needs no
// preview_url, no extra scope, and no backend. We drive it invisibly and let
// each song's album art be the play/pause control.

let api = null;         // the IFrameAPI object once ready
let controller = null;  // the embed controller once created
let pending = null;     // a play request queued before api/controller exist
let currentId = null;   // track id currently loaded
let paused = true;      // playback state
const listeners = new Set();

function emit() {
  const s = { currentId, paused };
  listeners.forEach((fn) => fn(s));
}

export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function state() { return { currentId, paused }; }

// Define the callback BEFORE injecting the script so we never miss it.
window.onSpotifyIframeApiReady = (a) => {
  api = a;
  if (pending) { const p = pending; pending = null; createController(p.uri, p.then); }
};

function injectApi() {
  if (document.getElementById('sp-iframe-api')) return;
  const s = document.createElement('script');
  s.id = 'sp-iframe-api';
  s.src = 'https://open.spotify.com/embed/iframe-api/v1';
  s.async = true;
  document.head.appendChild(s);
}
injectApi();

function createController(uri, then) {
  const el = document.getElementById('sp-embed');
  if (!el || !api) { pending = { uri, then }; return; }
  api.createController(el, { uri, width: '100%', height: 80 }, (c) => {
    controller = c;
    c.addListener('playback_update', (e) => {
      // e.data.isPaused reflects the embed's real state
      if (e && e.data && typeof e.data.isPaused === 'boolean') {
        paused = e.data.isPaused;
        emit();
      }
    });
    if (then) then();
  });
}

function isPlayableUri(uri) {
  // real Spotify track ids are 22 base62 chars; skip demo/fake ids
  return typeof uri === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(uri);
}

// Click handler for album art: play this track, toggle if it's the active one.
export function toggle(trackId, uri) {
  if (!isPlayableUri(uri)) return false; // demo tracks / no uri
  if (currentId === trackId && controller) {
    controller.togglePlay();
    return true;
  }
  currentId = trackId;
  paused = false;
  emit(); // optimistic: flip the icon immediately; playback_update will confirm
  if (controller) {
    controller.loadUri(uri);
    controller.play();
  } else if (api) {
    createController(uri, () => controller && controller.play());
  } else {
    pending = { uri, then: () => controller && controller.play() };
  }
  return true;
}
