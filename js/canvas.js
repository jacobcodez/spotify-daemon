// canvas.js — renders the always-sectioned canvas and wires drag-and-drop.
// The visual arranging surface is the heart of the app; Spotify is plumbing.

import * as store from './store.js';

let _listId = null;
let _handlers = {}; // { openSectionDialog, openSearch }
let _sortables = [];

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function setHandlers(h) { _handlers = { ..._handlers, ...h }; }

export function render(listId) {
  _listId = listId;
  const list = store.getList(listId);
  const mount = $('#sections');
  if (!mount) return;

  destroySortables();
  mount.innerHTML = '';
  if (!list) return;

  let trackNo = 0; // running number across the whole master list
  list.sections.forEach((sec, i) => {
    const next = list.sections[i + 1];
    mount.appendChild(renderSection(sec, next, i, trackNo));
    trackNo += sec.trackIds.length;
  });

  mountSortables();
}

// ---- section -------------------------------------------------------------

function renderSection(sec, next, index, startNo) {
  const node = el('div', 'section');
  node.dataset.sectionId = sec.id;
  node.style.setProperty('--sec-color', sec.color);
  node.style.setProperty('--sec-next', (next && next.color) || sec.colorTo || sec.color);

  // slim subheading squeezed between the rows (drag handle + hover toolbar)
  const head = el('div', 'sec-head');
  const label = sec.title ? sec.title : 'untitled';
  const dash = '- - - -';
  const divider = el('div', 'sec-divider', `${dash} ${label.toLowerCase()} ${dash}`);
  divider.title = 'double-click to rename';
  divider.addEventListener('dblclick', () => makeDividerEditable(divider, sec.id));

  const count = el('span', 'sec-count', `${sec.trackIds.length}/${sec.targetLength || sec.trackIds.length}`);

  const btns = el('div', 'sec-btns');
  btns.appendChild(sqBtn('◑', 'recolor / resize / rename', () => _handlers.openSectionDialog?.(sec.id)));
  btns.appendChild(sqBtn('＋', 'insert section below', () => { store.addSection(_listId, { title: '' }, index + 1); render(_listId); }));
  btns.appendChild(sqBtn('⧉', 'duplicate', () => { store.duplicateSection(_listId, sec.id); render(_listId); }));
  btns.appendChild(sqBtn('⎘', 'copy section', () => { store.copySection(_listId, sec.id); _handlers.onCopy?.(); toast('section copied — paste into any list'); }));
  btns.appendChild(sqBtn('✕', 'delete section', () => { store.deleteSection(_listId, sec.id); render(_listId); }));

  head.append(divider, count, btns);
  // stop button clicks from starting a section drag
  btns.addEventListener('pointerdown', (e) => e.stopPropagation());

  const body = el('div', 'sec-body');
  body.dataset.sectionId = sec.id;

  sec.trackIds.forEach((tid, k) => body.appendChild(renderSong(tid, sec.id, startNo + k + 1)));

  // empty slots: "find N more"
  const slots = Math.max(0, (sec.targetLength || 0) - sec.trackIds.length);
  for (let k = 0; k < slots; k++) body.appendChild(renderSlot(sec.id));

  // drag the bottom edge to add / remove empty slots (i.e. set target length)
  const grip = el('div', 'sec-resize');
  grip.title = 'drag to add / remove “find one more” slots';
  wireResize(grip, body, count, sec.id);

  node.append(head, body, grip);
  return node;
}

const ROW_H = 40; // must match --row-h in app.css

function setPreviewSlots(body, sectionId, slotCount) {
  body.querySelectorAll('.slot').forEach((n) => n.remove());
  for (let k = 0; k < slotCount; k++) body.appendChild(renderSlot(sectionId));
}

function wireResize(grip, body, countEl, sectionId) {
  grip.addEventListener('pointerdown', (e) => {
    const sec = store.findSection(_listId, sectionId);
    if (!sec) return;
    e.preventDefault();
    const startY = e.clientY;
    const nSongs = sec.trackIds.length;
    const startTarget = Math.max(sec.targetLength || 0, nSongs);
    let curTarget = startTarget;

    grip.setPointerCapture(e.pointerId);
    grip.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';

    const onMove = (ev) => {
      const delta = Math.round((ev.clientY - startY) / ROW_H);
      const nt = Math.max(nSongs, startTarget + delta); // never remove real songs
      if (nt === curTarget) return;
      curTarget = nt;
      setPreviewSlots(body, sectionId, nt - nSongs);
      if (countEl) countEl.textContent = `${nSongs}/${nt}`;
    };
    const end = () => {
      try { grip.releasePointerCapture(e.pointerId); } catch (_) {}
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      grip.classList.remove('dragging');
      document.body.style.cursor = '';
      store.updateSection(_listId, sectionId, { targetLength: curTarget });
      render(_listId);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });
}

function sqBtn(glyph, title, onClick) {
  const b = el('button', 'sq', glyph);
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function makeDividerEditable(divider, sectionId) {
  const sec = store.findSection(_listId, sectionId);
  const input = el('input', 'sec-divider');
  input.value = sec.title || '';
  input.placeholder = 'section title';
  divider.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    store.updateSection(_listId, sectionId, { title: input.value.trim() });
    render(_listId);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = sec.title || ''; input.blur(); }
  });
}

// ---- song card -----------------------------------------------------------

function renderSong(trackId, sectionId, no) {
  const t = store.getTrack(trackId) || { name: '(missing)', artists: [] };
  const node = el('div', 'song');
  node.dataset.trackId = trackId;

  const idx = el('span', 'idx', no != null ? String(no) : '');

  const art = el('img', 'art');
  art.alt = '';
  art.loading = 'lazy';
  if (t.albumArt) art.src = t.albumArt;

  const meta = el('div', 'meta');
  meta.append(
    el('div', 'title', t.name || '(untitled)'),
    el('div', 'artist', (t.artists || []).join(', ') || '—'),
  );

  const chips = el('div', 'chips');
  chips.append(
    editableChip('bpm', t.bpm != null ? String(t.bpm) : '', 'bpm', (v) => {
      const n = parseInt(v, 10);
      store.updateTrackMeta(trackId, { bpm: Number.isFinite(n) ? n : null });
    }),
    editableChip('genre', (t.genres && t.genres[0]) || '', '', (v) => {
      store.updateTrackMeta(trackId, { genres: v ? [v] : [] });
    }),
  );

  const rm = el('button', 'rm', '✕');
  rm.title = 'remove from list';
  rm.addEventListener('click', (e) => {
    e.stopPropagation();
    store.removeTrackFromSection(_listId, sectionId, trackId);
    render(_listId);
  });

  node.append(idx, art, meta, chips, rm);
  return node;
}

function editableChip(cls, value, placeholderKind, onCommit) {
  const chip = el('span', `chip ${cls}`.trim());
  chip.contentEditable = 'true';
  chip.spellcheck = false;
  chip.textContent = value || (placeholderKind === 'bpm' ? 'bpm' : 'genre');
  if (!value) chip.style.opacity = '0.55';
  chip.addEventListener('focus', () => {
    if (!value && (chip.textContent === 'bpm' || chip.textContent === 'genre')) chip.textContent = '';
    chip.style.opacity = '1';
  });
  chip.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't start a drag
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); chip.blur(); }
  });
  chip.addEventListener('blur', () => {
    const v = chip.textContent.trim();
    onCommit(v);
    if (!v) { chip.textContent = placeholderKind === 'bpm' ? 'bpm' : 'genre'; chip.style.opacity = '0.55'; }
  });
  return chip;
}

// ---- empty slot ----------------------------------------------------------

function renderSlot(sectionId) {
  const node = el('div', 'slot');
  node.append(el('span', 'slotart', '＋'), el('span', null, 'find one more'));
  node.title = 'add a song here';
  node.addEventListener('click', () => _handlers.openSearch?.(sectionId));
  return node;
}

// ---- SortableJS wiring ---------------------------------------------------

function destroySortables() {
  _sortables.forEach((s) => { try { s.destroy(); } catch (_) {} });
  _sortables = [];
}

function mountSortables() {
  if (typeof Sortable === 'undefined') { console.warn('SortableJS not loaded yet'); return; }

  // reorder whole sections (drag by titlebar)
  const secContainer = $('#sections');
  _sortables.push(new Sortable(secContainer, {
    handle: '.sec-head',
    draggable: '.section',
    animation: 160,
    chosenClass: 'sortable-chosen',
    onEnd: () => {
      const order = [...secContainer.querySelectorAll('.section')].map((n) => n.dataset.sectionId);
      reorderSections(order);
      render(_listId);
    },
  }));

  // songs — one group across all sections so they drag between sections
  secContainer.querySelectorAll('.sec-body').forEach((body) => {
    _sortables.push(new Sortable(body, {
      group: 'songs',
      draggable: '.song',
      filter: '.slot',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: () => { syncTracksFromDOM(); render(_listId); },
    }));
  });
}

function reorderSections(orderedIds) {
  const list = store.getList(_listId);
  if (!list) return;
  const byId = Object.fromEntries(list.sections.map((s) => [s.id, s]));
  list.sections = orderedIds.map((id) => byId[id]).filter(Boolean);
  store.save();
}

// after a song drag, re-derive every section's trackIds from the DOM
function syncTracksFromDOM() {
  document.querySelectorAll('#sections .sec-body').forEach((body) => {
    const sectionId = body.dataset.sectionId;
    const ids = [...body.querySelectorAll('.song')].map((n) => n.dataset.trackId);
    store.setSectionTracks(_listId, sectionId, ids);
  });
}

// ---- toast ---------------------------------------------------------------

let _toastTimer = null;
export function toast(msg, isErr = false) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show${isErr ? ' err' : ''}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}
