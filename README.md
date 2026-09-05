# jacob's spotify daemon

A visual tool to build and refine **Spotify playlists as ordered, coloured sections** — not one flat list. Add songs, subdivide them into titled sections, sequence for flow (BPM + genre visible per track), then push the flattened order back to Spotify.

No build step — vanilla JS + one CDN dependency (SortableJS). Deploys to GitHub Pages as a static site. All section structure, colours, titles, target-lengths and BPM/genre overrides are **local metadata in your browser** (localStorage); what syncs to Spotify is the **flattened track order only** (Spotify has no concept of sections).

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. The app works fully offline (a demo list is seeded on first run) — connecting Spotify is only needed for import/search/push.

## One-time Spotify setup (needs your Spotify login)

1. Create a free app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard) → copy the **Client ID**.
2. Under the app's settings, add **Redirect URIs**:
   - `http://localhost:8000/` (local dev)
   - `https://<user>.github.io/<repo>/` (GitHub Pages, once deployed)
3. Under **Users and Access**, add your own Spotify account (the app starts in Development mode — up to 25 users).
4. Paste your Client ID into `config.js` and commit it.

`config.js` is committed (not a secret): the client id is public and safe to expose under the PKCE flow, and `redirectUri` auto-derives from the page URL, so the same file works for local dev and GitHub Pages. `config.example.js` documents the shape.

## What it does

- **One always-sectioned canvas.** A new list starts as one section; the `+ new section here` divider subdivides it.
- **Sections** are draggable Win98-style titlebars: recolour, set a target length (empty "find N more" slots appear), rename, duplicate, copy (paste into any list), delete.
- **Vibe gradient**: each section's colour blends into the next, flowing behind the songs.
- **Drag** songs within and across sections; drag titlebars to reorder sections.
- **BPM + genre** are editable inline on every song card (click the chips).
- **Import** a real playlist, **search** to add tracks, **push** the reordered result back.
- **Export / import JSON** for backup and moving between browsers.

### Not representable in Spotify
Section dividers, colours, and target-lengths live only here. A pushed playlist is the flat track order.

## Notes
- Spotify's audio-features (BPM) endpoint was deprecated for new apps in late 2024, so **BPM is manual** for now. Genres are auto-filled from artist genres on import where available.
- Files: `index.html` · `css/app.css` (all design tokens) · `js/{store,canvas,auth,spotify,app}.js`.
