// spotify.js — thin Web API wrapper. All calls run client-side with the PKCE
// token (Spotify's API allows browser CORS).

import { getAccessToken } from './auth.js';

const API = 'https://api.spotify.com/v1';

async function api(path, opts = {}) {
  const token = await getAccessToken();
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify ${res.status}: ${text}`);
  }
  return res.json();
}

export function me() {
  return api('/me');
}

// all of the current user's playlists (paginated 50s)
export async function myPlaylists() {
  const out = [];
  let url = '/me/playlists?limit=50';
  while (url) {
    const page = await api(url);
    out.push(...page.items);
    url = page.next; // absolute url or null
  }
  return out;
}

// every track of a playlist as TrackMeta (paginated 100s)
export async function playlistTracks(id) {
  const out = [];
  let url = `/playlists/${id}/tracks?limit=100&fields=next,items(track(id,uri,name,duration_ms,artists(name,id),album(images)))`;
  while (url) {
    const page = await api(url);
    for (const item of page.items) {
      const t = item.track;
      if (!t || !t.id) continue; // skip local/unavailable tracks
      out.push(trackToMeta(t));
    }
    url = page.next;
  }
  return out;
}

export async function search(q, limit = 20) {
  if (!q.trim()) return [];
  const page = await api(`/search?type=track&limit=${limit}&q=${encodeURIComponent(q)}`);
  return (page.tracks?.items || []).map(trackToMeta);
}

// Optional cheap nicety on import: fill genres from artist genres.
export async function artistGenres(artistIds) {
  const map = {};
  for (let i = 0; i < artistIds.length; i += 50) {
    const batch = artistIds.slice(i, i + 50).filter(Boolean);
    if (!batch.length) continue;
    const page = await api(`/artists?ids=${batch.join(',')}`);
    for (const a of page.artists || []) map[a.id] = a.genres || [];
  }
  return map;
}

export function createPlaylist(userId, name, isPublic = false) {
  return api(`/users/${userId}/playlists`, {
    method: 'POST',
    body: JSON.stringify({ name, public: isPublic, description: 'built with segue' }),
  });
}

// Replace the whole playlist with an ordered URI list (batched for >100).
export async function replaceTracks(playlistId, uris) {
  // first 100 via PUT (replaces), remainder via POST (append)
  const first = uris.slice(0, 100);
  await api(`/playlists/${playlistId}/tracks`, {
    method: 'PUT',
    body: JSON.stringify({ uris: first }),
  });
  for (let i = 100; i < uris.length; i += 100) {
    await api(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
    });
  }
}

// ---- mapping --------------------------------------------------------------

function trackToMeta(t) {
  const images = t.album?.images || [];
  return {
    id: t.id,
    uri: t.uri || `spotify:track:${t.id}`,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name),
    artistIds: (t.artists || []).map((a) => a.id),
    albumArt: images.length ? images[images.length - 1].url : null, // smallest
    durationMs: t.duration_ms,
    bpm: null,
    genres: [],
  };
}
