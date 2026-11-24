// Component gallery (?d=gallery): every card type this site's dashboards and pop-ups use (engine/pages/gallery.js).
import main from './main.js';
import mobile from './mobile.js';
import systems from './systems.js';
import popups from '../popups.js';
import { gallery } from '../pages/gallery.js';

export default gallery({ sources: [['Main', main.views], ['Mobile', mobile.views], ['Systems', [systems]]], popups, settings: main.settings });
