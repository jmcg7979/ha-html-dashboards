// A small sub-heading inside a panel or pop-up.  { type: 'label', text: 'Individual' }
// note: true = a footnote; caption: true = a quiet all-caps caption over plain content (TV: "COMING UP", the room)
import { h, esc } from '../core/dom.js';
export default (cfg) => h(`<div class="label${cfg.note ? ' note' : ''}${cfg.caption ? ' caption' : ''}">${esc(cfg.text)}</div>`);
