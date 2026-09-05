// app.js — glue: topbar, dialogs, Spotify connect / import / push, sample seed.

import * as store from './store.js?v=3';
import * as canvas from './canvas.js?v=3';
import * as auth from './auth.js?v=3';
import * as api from './spotify.js?v=3';

const $ = (s) => document.querySelector(s);
const toast = canvas.toast;

let currentListId = null;
let me = null; // Spotify profile once connected

// ---------------------------------------------------------------- boot ----

async function boot() {
  seedIfEmpty();
  currentListId = store.getStore().lists[0]?.id;

  canvas.setHandlers({ openSectionDialog, openSearch, onCopy: updatePasteFab });

  wireTopbar();
  wireFabs();
  wireDialogs();

  refreshListPicker();
  renderCurrent();
  updatePasteFab();

  // Spotify: finish a redirect if we came back with ?code, else reflect state.
  try {
    if (await auth.handleRedirect()) toast('connected to Spotify');
  } catch (e) {
    toast(e.message, true);
  }
  await reflectAuth();
}

function renderCurrent() {
  const list = store.getList(currentListId);
  $('#listTitle').value = list?.name || '';
  $('#listSub').textContent = list?.spotifyPlaylistId
    ? 'linked · pushes back to Spotify'
    : 'local · not linked to Spotify';
  canvas.render(currentListId);
  $('#pushBtn').disabled = !auth.isConnected() || !list || store.flatUris(currentListId).length === 0;
  updatePasteFab();
}

// --------------------------------------------------------------- topbar ---

function wireTopbar() {
  $('#listTitle').addEventListener('change', (e) => {
    store.renameList(currentListId, e.target.value.trim() || 'untitled list');
    refreshListPicker();
  });
  $('#newListBtn').addEventListener('click', () => {
    const list = store.createList('new list');
    currentListId = list.id;
    refreshListPicker();
    renderCurrent();
  });
  $('#listPicker').addEventListener('change', (e) => {
    currentListId = e.target.value;
    renderCurrent();
  });
  $('#connectBtn').addEventListener('click', async () => {
    if (!auth.isConfigured()) {
      toast('add your Spotify client id to config.js first', true);
      return;
    }
    if (auth.isConnected()) { auth.clearToken(); await reflectAuth(); toast('disconnected'); return; }
    try { await auth.login(); } catch (e) { toast(e.message, true); }
  });
  $('#importBtn').addEventListener('click', openImport);
  $('#pushBtn').addEventListener('click', pushToSpotify);
}

function refreshListPicker() {
  const sel = $('#listPicker');
  sel.innerHTML = '';
  for (const l of store.getStore().lists) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.name;
    if (l.id === currentListId) o.selected = true;
    sel.appendChild(o);
  }
}

async function reflectAuth() {
  const pill = $('#authPill');
  const btn = $('#connectBtn');
  if (auth.isConnected()) {
    try {
      me = await api.me();
      pill.textContent = me.display_name || 'connected';
      pill.className = 'pill ok';
      btn.textContent = 'Disconnect';
      $('#importBtn').hidden = false;
    } catch (e) {
      pill.textContent = 'token expired';
      pill.className = 'pill';
      btn.textContent = 'Reconnect';
    }
  } else {
    pill.textContent = auth.isConfigured() ? 'offline' : 'no config';
    pill.className = 'pill';
    btn.textContent = 'Connect Spotify';
    $('#importBtn').hidden = true;
  }
  renderCurrent();
}

// ----------------------------------------------------------------- fabs ---

function wireFabs() {
  $('#addSongFab').addEventListener('click', () => openSearch());
  $('#addSectionFab').addEventListener('click', () => {
    // start with a few empty slots so the section is visible; drag its bottom
    // edge (or use the section dialog) to resize.
    const sec = store.addSection(currentListId, { title: '', targetLength: 4 });
    renderCurrent();
    if (sec) {
      const node = document.querySelector(`.section[data-section-id="${sec.id}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    toast('empty section added — drag its bottom edge to resize');
  });
  $('#pasteSectionFab').addEventListener('click', () => {
    const sec = store.pasteSection(currentListId);
    renderCurrent();
    if (sec) {
      const node = document.querySelector(`.section[data-section-id="${sec.id}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('section pasted');
    }
  });
  $('#moreFab').addEventListener('click', () => $('#dataDialog').showModal());
}

function updatePasteFab() {
  $('#pasteSectionFab').hidden = !store.hasClipboard();
}

// -------------------------------------------------------- section dialog ---

let dialogSectionId = null;
let dialogColor = null;

function openSectionDialog(sectionId) {
  const sec = store.findSection(currentListId, sectionId);
  if (!sec) return;
  dialogSectionId = sectionId;
  dialogColor = sec.color;
  $('#secTitle').value = sec.title || '';
  $('#secLength').value = sec.targetLength || sec.trackIds.length;
  renderSwatches();
  $('#secDialog').showModal();
}

function renderSwatches() {
  const wrap = $('#secSwatches');
  wrap.innerHTML = '';
  for (const c of store.SECTION_COLORS) {
    const s = document.createElement('button');
    s.className = 'swatch' + (c === dialogColor ? ' sel' : '');
    s.style.background = c;
    s.style.color = c;
    s.addEventListener('click', (e) => { e.preventDefault(); dialogColor = c; renderSwatches(); });
    wrap.appendChild(s);
  }
}

function wireDialogs() {
  // generic [data-close]
  document.querySelectorAll('dialog [data-close]').forEach((b) =>
    b.addEventListener('click', (e) => { e.preventDefault(); b.closest('dialog').close(); }));

  $('#secSave').addEventListener('click', (e) => {
    e.preventDefault();
    const len = parseInt($('#secLength').value, 10);
    store.updateSection(currentListId, dialogSectionId, {
      title: $('#secTitle').value.trim(),
      color: dialogColor,
      targetLength: Number.isFinite(len) ? Math.max(0, len) : 0,
    });
    $('#secDialog').close();
    renderCurrent();
  });

  // search
  let searchTimer = null;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(e.target.value), 300);
  });

  // data dialog
  $('#exportBtn').addEventListener('click', exportJSON);
  $('#importJsonBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', importJSON);
  $('#renameListBtn').addEventListener('click', () => {
    // the top title input is the rename affordance — just focus it
    $('#dataDialog').close();
    const input = $('#listTitle');
    input.focus();
    input.select();
  });
  $('#deleteListBtn').addEventListener('click', async () => {
    if (!(await confirmBox('delete this list? (local only — does not touch Spotify)', 'delete'))) return;
    store.deleteList(currentListId);
    if (store.getStore().lists.length === 0) store.createList('new list');
    currentListId = store.getStore().lists[0].id;
    $('#dataDialog').close();
    refreshListPicker();
    renderCurrent();
  });
}

// --------------------------------------------------------- search / add ---

let searchTargetSectionId = null;

function openSearch(sectionId = null) {
  const list = store.getList(currentListId);
  searchTargetSectionId = sectionId;
  const sel = $('#searchTargetSection');
  sel.innerHTML = '';
  for (const sec of list.sections) {
    const o = document.createElement('option');
    o.value = sec.id;
    o.textContent = (sec.title || 'untitled') + ` (${sec.trackIds.length})`;
    if (sec.id === sectionId) o.selected = true;
    sel.appendChild(o);
  }
  $('#searchInput').value = '';
  $('#searchResults').innerHTML = auth.isConnected()
    ? '<div class="muted center">start typing to search Spotify.</div>'
    : '<div class="muted center">connect Spotify to search for tracks.</div>';
  $('#searchDialog').showModal();
  setTimeout(() => $('#searchInput').focus(), 50);
}

async function runSearch(q) {
  const box = $('#searchResults');
  if (!auth.isConnected()) { box.innerHTML = '<div class="muted center">connect Spotify to search.</div>'; return; }
  if (!q.trim()) { box.innerHTML = '<div class="muted center">start typing…</div>'; return; }
  box.innerHTML = '<div class="muted center">searching…</div>';
  try {
    const results = await api.search(q);
    if (!results.length) { box.innerHTML = '<div class="muted center">no matches.</div>'; return; }
    box.innerHTML = '';
    for (const meta of results) box.appendChild(resultRow(meta));
  } catch (e) {
    box.innerHTML = `<div class="muted center">search failed: ${e.message}</div>`;
  }
}

function resultRow(meta) {
  const row = document.createElement('div');
  row.className = 'result';
  const art = document.createElement('img');
  art.className = 'art'; if (meta.albumArt) art.src = meta.albumArt;
  const m = document.createElement('div');
  m.className = 'meta';
  m.innerHTML = `<div class="title">${escapeHtml(meta.name)}</div><div class="artist">${escapeHtml(meta.artists.join(', '))}</div>`;
  const add = document.createElement('button');
  add.className = 'btn btn-neon add'; add.textContent = '＋';
  add.addEventListener('click', () => {
    store.upsertTrack(meta);
    const targetSec = $('#searchTargetSection').value;
    store.addTrackToSection(currentListId, targetSec, meta.id);
    toast(`added ${meta.name}`);
    renderCurrent();
  });
  row.append(art, m, add);
  return row;
}

// ------------------------------------------------------------- import -----

async function openImport() {
  const dlg = $('#importDialog');
  const box = $('#importResults');
  box.innerHTML = '<div class="muted center">loading your playlists…</div>';
  dlg.showModal();
  try {
    const playlists = await api.myPlaylists();
    if (!playlists.length) { box.innerHTML = '<div class="muted center">no playlists found.</div>'; return; }
    box.innerHTML = '';
    for (const pl of playlists) {
      const row = document.createElement('div');
      row.className = 'result';
      const art = document.createElement('img');
      art.className = 'art'; if (pl.images?.[0]) art.src = pl.images[0].url;
      const m = document.createElement('div');
      m.className = 'meta';
      m.innerHTML = `<div class="title">${escapeHtml(pl.name)}</div><div class="artist">${pl.tracks?.total ?? 0} tracks</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn btn-neon add'; btn.textContent = 'import';
      btn.addEventListener('click', () => importPlaylist(pl, btn));
      row.append(art, m, btn);
      box.appendChild(row);
    }
  } catch (e) {
    box.innerHTML = `<div class="muted center">failed: ${e.message}</div>`;
  }
}

async function importPlaylist(pl, btn) {
  btn.disabled = true; btn.textContent = 'importing…';
  try {
    const tracks = await api.playlistTracks(pl.id);
    // cheap nicety: fill genres from artist genres
    try {
      const ids = [...new Set(tracks.flatMap((t) => t.artistIds || []))];
      const gmap = await api.artistGenres(ids);
      for (const t of tracks) {
        const g = (t.artistIds || []).flatMap((id) => gmap[id] || []);
        if (g.length) t.genres = [g[0]];
      }
    } catch (_) { /* genres are optional */ }

    tracks.forEach((t) => store.upsertTrack(t));
    const list = store.createList(pl.name, { spotifyPlaylistId: pl.id });
    // put everything into the single default section
    const sec = list.sections[0];
    store.setSectionTracks(list.id, sec.id, tracks.map((t) => t.id));
    store.updateSection(list.id, sec.id, { title: 'imported' });

    currentListId = list.id;
    $('#importDialog').close();
    refreshListPicker();
    renderCurrent();
    toast(`imported ${tracks.length} tracks`);
  } catch (e) {
    const msg = /403/.test(e.message)
      ? "can't read this one — Spotify blocks API access to its own playlists (Discover Weekly, Daily Mix, editorial). Try a playlist you created."
      : 'import failed: ' + e.message;
    toast(msg, true);
    btn.disabled = false; btn.textContent = 'import';
  }
}

// --------------------------------------------------------------- push -----

async function pushToSpotify() {
  const list = store.getList(currentListId);
  const uris = store.flatUris(currentListId);
  if (!uris.length) { toast('nothing to push', true); return; }
  if (!(await confirmBox(`Push ${uris.length} tracks to Spotify in this exact order? Section dividers aren't representable in Spotify — the pushed playlist is the flat order only.`, 'push'))) return;

  const btn = $('#pushBtn');
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'pushing…';
  try {
    let playlistId = list.spotifyPlaylistId;
    if (!playlistId) {
      if (!me) me = await api.me();
      const created = await api.createPlaylist(me.id, list.name);
      playlistId = created.id;
      store.getList(currentListId).spotifyPlaylistId = playlistId;
      store.save();
    }
    await api.replaceTracks(playlistId, uris);
    toast(`pushed ${uris.length} tracks ✓`);
    renderCurrent();
  } catch (e) {
    toast('push failed: ' + e.message, true);
  } finally {
    btn.textContent = label; btn.disabled = false;
  }
}

// ----------------------------------------------------------- data I/O -----

function exportJSON() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'segue-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      store.importJSON(reader.result);
      currentListId = store.getStore().lists[0]?.id;
      $('#dataDialog').close();
      refreshListPicker();
      renderCurrent();
      toast('imported backup');
    } catch (err) {
      toast('bad file: ' + err.message, true);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ----------------------------------------------------------- sample seed --

function seedIfEmpty() {
  const s = store.getStore();
  if (s.lists.length) return;

  const sample = [
    { id: 's1', name: 'Yègellé Tezeta', artists: ['Mulatu Astatke'], genres: ['ethio-jazz'], bpm: 92 },
    { id: 's2', name: 'Tezeta (Nostalgia)', artists: ['Mulatu Astatke'], genres: ['ethio-jazz'], bpm: 84 },
    { id: 's3', name: 'Ejigayehu', artists: ['Getatchew Mekurya'], genres: ['ethio-jazz'], bpm: 110 },
    { id: 's4', name: 'Von', artists: ['Sigur Rós'], genres: ['ambient'], bpm: 70 },
    { id: 's5', name: 'Avril 14th', artists: ['Aphex Twin'], genres: ['idm'], bpm: 0 },
    { id: 's6', name: '360', artists: ['Charli XCX'], genres: ['hyperpop'], bpm: 128 },
    { id: 's7', name: 'Von dutch', artists: ['Charli XCX'], genres: ['hyperpop'], bpm: 130 },
  ];
  sample.forEach((t) => store.upsertTrack({
    id: t.id, uri: `spotify:track:${t.id}`, name: t.name, artists: t.artists,
    albumArt: null, durationMs: 200000, bpm: t.bpm || null, genres: t.genres,
  }));

  const list = store.createList('demo · dawn set');
  const s0 = list.sections[0];
  store.updateSection(list.id, s0.id, { title: 'ethiopian jazz', color: '#c79a44' });
  store.setSectionTracks(list.id, s0.id, ['s1', 's2', 's3']);

  const s1 = store.addSection(list.id, { title: 'drift', color: '#3fa7a0', targetLength: 4 });
  store.setSectionTracks(list.id, s1.id, ['s4', 's5']); // 2 songs, 4 slots → 2 "find" rows

  const s2 = store.addSection(list.id, { title: 'brat', color: '#3f8bed', targetLength: 5 });
  store.setSectionTracks(list.id, s2.id, ['s6', 's7']); // 3 empty slots
}

// ----------------------------------------------------------- utils --------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Promise-based in-app confirm (native confirm() is blocked in sandboxed previews).
function confirmBox(message, yesLabel = 'yes') {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    $('#confirmMsg').textContent = message;
    $('#confirmYes').textContent = yesLabel;
    const cleanup = () => {
      $('#confirmYes').removeEventListener('click', onYes);
      $('#confirmNo').removeEventListener('click', onNo);
      dlg.removeEventListener('close', onNo);
    };
    const onYes = () => { cleanup(); dlg.close(); resolve(true); };
    const onNo = () => { cleanup(); dlg.close(); resolve(false); };
    $('#confirmYes').addEventListener('click', onYes);
    $('#confirmNo').addEventListener('click', onNo);
    dlg.addEventListener('close', onNo); // ESC / ✕ counts as cancel
    dlg.showModal();
  });
}

boot();
