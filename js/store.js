// store.js — the data model + localStorage persistence.
//
// Store {
//   lists: MasterList[]              // each maps to at most one Spotify playlist
//   tracks: { [id]: TrackMeta }      // shared cache so copy/paste reuses metadata
//   clipboardSection?: Section       // for cross-list paste
// }
// MasterList { id, name, spotifyPlaylistId?, sections: Section[] }
// Section    { id, title, color, colorTo?, targetLength, trackIds: string[] }
// TrackMeta  { id, uri, name, artists[], albumArt, durationMs, bpm?, genres?[] }

const STORAGE_KEY = 'segue.store.v1';

// A muted palette in the Windows XP / Media Player register (Luna blues,
// teal, olive, amber, slate) — glossy but not neon.
export const SECTION_COLORS = [
  '#3f8bed', // luna blue
  '#3fa7a0', // teal
  '#7a9a52', // xp olive
  '#c79a44', // amber / gold
  '#8a6fb0', // muted plum
  '#b06a56', // terracotta
  '#6f8fb0', // slate blue
  '#9aa2ac', // silver
];

let _store = null;
const _subs = new Set();

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyStore() {
  return { lists: [], tracks: {}, clipboardSection: null };
}

// ---- persistence -----------------------------------------------------------

export function load() {
  if (_store) return _store;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _store = raw ? JSON.parse(raw) : emptyStore();
  } catch (e) {
    console.warn('store: failed to parse, starting fresh', e);
    _store = emptyStore();
  }
  // shape guard for older / partial data
  _store.lists ||= [];
  _store.tracks ||= {};
  if (!('clipboardSection' in _store)) _store.clipboardSection = null;
  return _store;
}

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_store));
  } catch (e) {
    console.error('store: save failed (quota?)', e);
  }
  _subs.forEach((fn) => fn(_store));
}

export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

export function getStore() {
  return load();
}

// ---- track cache -----------------------------------------------------------

export function upsertTrack(meta) {
  load();
  const existing = _store.tracks[meta.id] || {};
  _store.tracks[meta.id] = { ...existing, ...meta };
  return _store.tracks[meta.id];
}

export function getTrack(id) {
  return load().tracks[id];
}

export function updateTrackMeta(id, patch) {
  load();
  if (!_store.tracks[id]) return;
  _store.tracks[id] = { ..._store.tracks[id], ...patch };
  save();
}

// ---- list CRUD -------------------------------------------------------------

export function createList(name = 'untitled list', { spotifyPlaylistId } = {}) {
  load();
  const list = {
    id: uid('list'),
    name,
    spotifyPlaylistId: spotifyPlaylistId || null,
    sections: [makeSection({ title: '' })],
  };
  _store.lists.push(list);
  save();
  return list;
}

export function getList(listId) {
  return load().lists.find((l) => l.id === listId) || null;
}

export function renameList(listId, name) {
  const list = getList(listId);
  if (list) { list.name = name; save(); }
}

export function deleteList(listId) {
  load();
  _store.lists = _store.lists.filter((l) => l.id !== listId);
  save();
}

// ---- section factory + CRUD ------------------------------------------------

let _colorCursor = 0;
function nextColor() {
  const c = SECTION_COLORS[_colorCursor % SECTION_COLORS.length];
  _colorCursor++;
  return c;
}

export function makeSection({ title = '', color, targetLength = 0, trackIds = [] } = {}) {
  return {
    id: uid('sec'),
    title,
    color: color || nextColor(),
    colorTo: null,
    targetLength: targetLength || trackIds.length,
    trackIds: [...trackIds],
  };
}

export function findSection(listId, sectionId) {
  const list = getList(listId);
  if (!list) return null;
  return list.sections.find((s) => s.id === sectionId) || null;
}

export function addSection(listId, opts = {}, atIndex = null) {
  const list = getList(listId);
  if (!list) return null;
  const sec = makeSection(opts);
  if (atIndex == null || atIndex >= list.sections.length) list.sections.push(sec);
  else list.sections.splice(atIndex, 0, sec);
  save();
  return sec;
}

export function updateSection(listId, sectionId, patch) {
  const sec = findSection(listId, sectionId);
  if (!sec) return;
  Object.assign(sec, patch);
  save();
}

export function deleteSection(listId, sectionId) {
  const list = getList(listId);
  if (!list) return;
  list.sections = list.sections.filter((s) => s.id !== sectionId);
  if (list.sections.length === 0) list.sections.push(makeSection());
  save();
}

export function moveSection(listId, fromIndex, toIndex) {
  const list = getList(listId);
  if (!list) return;
  const [sec] = list.sections.splice(fromIndex, 1);
  list.sections.splice(toIndex, 0, sec);
  save();
}

// ---- track placement -------------------------------------------------------

// Set the full ordered trackIds of a section (called by SortableJS after a drag).
export function setSectionTracks(listId, sectionId, trackIds) {
  const sec = findSection(listId, sectionId);
  if (!sec) return;
  sec.trackIds = [...trackIds];
  // keep targetLength >= actual count so slots never go negative
  if (sec.targetLength < sec.trackIds.length) sec.targetLength = sec.trackIds.length;
  save();
}

export function addTrackToSection(listId, sectionId, trackId, atIndex = null) {
  const sec = findSection(listId, sectionId);
  if (!sec) return;
  if (atIndex == null) sec.trackIds.push(trackId);
  else sec.trackIds.splice(atIndex, 0, trackId);
  if (sec.targetLength < sec.trackIds.length) sec.targetLength = sec.trackIds.length;
  save();
}

export function removeTrackFromSection(listId, sectionId, trackId) {
  const sec = findSection(listId, sectionId);
  if (!sec) return;
  sec.trackIds = sec.trackIds.filter((t) => t !== trackId);
  save();
}

// ---- copy / paste / duplicate sections -------------------------------------

function cloneSectionData(sec) {
  return {
    id: uid('sec'),
    title: sec.title,
    color: sec.color,
    colorTo: sec.colorTo || null,
    targetLength: sec.targetLength,
    trackIds: [...sec.trackIds], // reference shared track cache
  };
}

export function copySection(listId, sectionId) {
  const sec = findSection(listId, sectionId);
  if (!sec) return;
  _store.clipboardSection = cloneSectionData(sec);
  save();
}

export function hasClipboard() {
  return !!load().clipboardSection;
}

export function pasteSection(listId, atIndex = null) {
  load();
  if (!_store.clipboardSection) return null;
  const list = getList(listId);
  if (!list) return null;
  const sec = cloneSectionData(_store.clipboardSection);
  if (atIndex == null || atIndex >= list.sections.length) list.sections.push(sec);
  else list.sections.splice(atIndex, 0, sec);
  save();
  return sec;
}

export function duplicateSection(listId, sectionId) {
  const list = getList(listId);
  const sec = findSection(listId, sectionId);
  if (!list || !sec) return null;
  const idx = list.sections.indexOf(sec);
  const dup = cloneSectionData(sec);
  list.sections.splice(idx + 1, 0, dup);
  save();
  return dup;
}

// ---- export / import (portability + backup) --------------------------------

export function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.lists)) throw new Error('invalid store file');
  _store = {
    lists: parsed.lists,
    tracks: parsed.tracks || {},
    clipboardSection: parsed.clipboardSection || null,
  };
  save();
  return _store;
}

// ---- helpers ---------------------------------------------------------------

// Flattened ordered track URIs for a list — this is what gets pushed to Spotify.
export function flatUris(listId) {
  const list = getList(listId);
  if (!list) return [];
  const uris = [];
  for (const sec of list.sections) {
    for (const tid of sec.trackIds) {
      const t = _store.tracks[tid];
      if (t && t.uri) uris.push(t.uri);
    }
  }
  return uris;
}

export { uid };
