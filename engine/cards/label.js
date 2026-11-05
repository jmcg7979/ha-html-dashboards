// A small sub-heading inside a panel or pop-up.  { type: 'label', text: 'Individual' }
import { h, esc } from '../core/dom.js';
export default (cfg) => h(`<div class="label${cfg.note ? ' note' : ''}">${esc(cfg.text)}</div>`);
