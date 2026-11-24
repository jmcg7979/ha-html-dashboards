// A phone as a player (the Media Bridge integration, engine/ha/custom_components/media_bridge): what its own attributes
// mean beyond a media player's, and the commands that have no media_player action.
//   likeable(attributes)        the player says whether the song is liked, and can change it
//   like(entity, attributes)    like the song, or take the like back (the playing app's own button)
//   command(entity, { cmd, … })  any command of the integration's list (queue_item, play_search, custom, …)
import { call } from './ha.js';

const LIKE = /^(ADD_TO|REMOVE_FROM|CHECK_FILL)$|like/i;   // Spotify's add to / remove from the collection (it names the second CHECK_FILL); SoundCloud's like
const likeAction = (a) => (a.custom_actions || []).find((x) => LIKE.test(x.action));

export const likeable = (a) => typeof a.liked === 'boolean' && !!likeAction(a);
export const command = (entity, cmd) => call('media_bridge.command', { entity_id: entity, command: cmd });
export const like = (entity, a) => { const x = likeAction(a); if (x) command(entity, { cmd: 'custom', action: x.action }); };
