// A wide photo of the artist, for the backdrop of Now playing (cards/media-detail.js): TheAudioDB's artist "fanart"
// (1280x720 press shots, the same source Music Assistant uses for its library).
//   artistPhoto('Ella Langley/The Hunger Games') -> Promise<url | null>
// Through Home Assistant where its relay offers it (engine/ha/custom_components/ma_relay: one lookup for the house, kept
// there, and the screen asks nobody but HA; the address is the picture itself, which comes back empty when there is
// none). Without the relay the screen looks the artist up itself, as below.
// Only an exact name match counts (two artists can share a search). The screen's own answers are kept in localStorage (a
// week; a miss a day), so a song costs no request once its artist has been seen. No key of ours: TheAudioDB's public test key.
import { artistPhotoUrl } from './ma.js';
import { PHOTO_KEPT, NO_PHOTO_KEPT } from './music-timing.js';

const API = 'https://www.theaudiodb.com/api/v1/json/123/search.php?s=';
const mem = new Map();
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// the names to try: the whole credit, then its first artist ("A/B", "A, B", "A feat. B", "A & B")
const names = (credit) => [...new Set([credit, credit.split(/\s*[/,;]\s*/)[0], credit.split(/\s+(?:feat\.?|ft\.?|featuring|with|&|x)\s+/i)[0]].map((s) => s.trim()).filter(Boolean))];
const stored = (k) => { try { const v = JSON.parse(localStorage.getItem('artistart:' + k)); return v && Date.now() - v.at < (v.url ? PHOTO_KEPT : NO_PHOTO_KEPT) ? v : null; } catch (e) { return null; } };
const store = (k, url) => { try { localStorage.setItem('artistart:' + k, JSON.stringify({ url, at: Date.now() })); } catch (e) { /* storage full or off: memory only */ } };

function one(name) {
  const k = norm(name); if (!k) return Promise.resolve(null);
  if (mem.has(k)) return mem.get(k);
  const s = stored(k); if (s) { const p = Promise.resolve(s.url); mem.set(k, p); return p; }
  const p = fetch(API + encodeURIComponent(name)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((d) => {
      const a = ((d && d.artists) || []).find((x) => norm(x.strArtist) === k);
      const url = a ? [a.strArtistFanart, a.strArtistFanart2, a.strArtistFanart3, a.strArtistFanart4].find(Boolean) || null : null;
      store(k, url); return url;
    }, () => { mem.delete(k); return null; });   // offline or refused: asked again next time
  mem.set(k, p); return p;
}
export async function artistPhoto(credit) {
  const who = String(credit || '').trim(); if (!who) return null;
  const through = await artistPhotoUrl(who).catch(() => null);
  if (through) return through;
  for (const n of names(who)) { const u = await one(n); if (u) return u; }
  return null;
}
