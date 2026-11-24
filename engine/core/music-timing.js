// Every wait, time limit and "kept for" of the music cards and their core, in one place, each with what it answers.
// Milliseconds unless the name says otherwise. The numbers were tuned on real speakers and TVs: one that changes should
// change with a reason beside it (and the tests that replay recorded song changes will say what it did:
// engine/_dev/test/music-steady.test.mjs).

// ---- a song change, as a screen shows it (core/steady.js) ----
export const SOFT_ARMED = 4000;        // a change from elsewhere may still stop the sound for this long
export const CAST_BACK = 1000;         // Cast stopped and has played again for this long: the sound is back
export const CAST_NO_STOP = 6000;      // Cast was playing at the press and never stopped: not before this age,
export const CAST_WAS_IDLE = 3000;     //   (Cast wasn't playing at the press: this age)
export const PLAYING_FOR = 2000;       //   and then this long of playing
export const DIRECT_AGE = 1200;        // not Cast (Sendspin): the next song is there within a second: this age,
export const DIRECT_PLAYING = 800;     //   and this long of playing
export const SKIP_GIVES_UP = 20000;    // a skip that never settles ends
export const HOLD = 8000;              // the last song stays while the player is idle / buffering between songs
export const TITLE_HOLDS = 1500;       // a new title this screen didn't ask for shows once it has held this long

// ---- one player's session (core/session.js) ----
export const LOOK_UNSETTLED = 400;     // while a song change is under way the session looks again this often
export const QUEUE_ELSEWHERE = 2500;   // the queue has been on another song than our skip's for this long: the queue is right
export const CHECK_SKIP = 4000;        // after our own skip: is the queue on the song the screen shows?
export const MINE_FOR = 15000;         // our Pause / Stop, on a player that never stopped its queue (a Cast speaker pauses for real): forgotten once it plays again after this

// ---- which entity is believed, and what still counts as paused (core/players.js) ----
export const CONFIRMED_FOR = 120000;   // a Spotify cast stays this TV's own this long after its title last matched the account's (the account's player lags a song change by up to 30 s)
export const PAUSED_SHOWS = 2 * 3600000;   // a queue that stopped with a song is listed as paused under Playing for this long

// ---- Music Assistant through the relay (core/ma.js) ----
export const REFRESH_WAIT = 150;       // several queue events in a row are one reload of the queue
export const RETRY_REFUSED = 5000;     // the relay refused the subscription (MA down), or HA doesn't know the relay (not loaded yet after a restart): ask again after this. One small question each time, so often: until it answers a queue on screen stands still
export const RETRY_UNSENT = 2000;      // the subscription couldn't be sent: again after this
export const PARTY_KEPT = 30000;       // MA's Party (its link, where it plays, its rules) is asked at most this often

// ---- music on its way: starting it, turning a TV on for it (core/wake.js, core/play.js) ----
export const LOOK_EVERY = 1000;        // "does it play yet" and "is the TV ready" are looked at this often
// (none of these three runs while a play that was sent is unanswered: Music Assistant answers once it has every song of
// what it is to play, and a long playlist can take it a minute or more: core/wake.js answering)
export const PENDING_FOR = 90000;      // "Starting the music…" on a player's card goes after this if it never played
export const START_LIMIT = 40000;      // Play on: not playing this long after Music Assistant's answer, the page says it hasn't started
export const START_SAYS = 6 * 60000;   // "Starting on …" stays up at most this long (how it went replaces it sooner: longer than the relay waits for a play's answer, its PLAY_TIMEOUT, plus START_LIMIT)
export const WAKE_LIMIT = 60000;       // a TV turned on for music gets this long for its Cast to come back
export const WAKE_SAYS_WAITING = 8000; // still not ready after this: "Waiting for the TV to be ready…"
export const WAKE_STEP_SAYS = 70000;   // a step's toast stays until the next step says what's happening, this at most
export const CAST_SETTLES = 2000;      // a TV that has just come on: a moment before music is sent to it
export const SAYS_LONG = 8000;         // a toast that names a failure and what to do stays this long
export const SAYS_SHORT = 3000;        // "… is on"

// ---- rooms (core/sync.js, the player card's Rooms) ----
export const SYNC_MAP_KEPT = 60000;    // MA's answer on who syncs with whom is kept this long
export const QUIET_FOR = 20000;        // a speaker group starting: its members' own queues are stopped as MA names them, this long
export const ROOM_ARMED = 5000;        // "Tap again to move the music here" waits this long for the second tap
export const ROOMS_WANTED = 12000;     // the rooms just asked for stay lit this long while Music Assistant makes it so
export const LEAVES_AFTER_MOVE = 400;  // the music left this room: the card follows it (or goes) after this, so the tap is seen

// ---- a Spotify cast (core/spotify.js, the player card) ----
export const SPOTIFY_AGAIN = 4000;     // up next is asked once more this long after a title change: Spotify's own answer lags the cast
export const SPOTIFY_EVERY = 30000;    // and again when the last answer is this old
export const SPOTIFY_FRESH = 20000;    // an answer younger than this is shown even if its title isn't the cast's yet
export const SPOTIFY_NUDGE = 1200;     // after a press of ours SpotifyPlus is told to ask Spotify now, this long after it
export const SPOTIFY_MOVED = [1500, 5000];   // and after the music moved to another device: twice, the move takes a while to show

// ---- lyrics (core/lyrics-ui.js). Music Assistant looks lyrics up one song at a time: one a second when its LRCLIB
// provider has an API URL of its own set, one per 30 s with the default (engine/docs/integrations.md). A lookup asked
// sooner waits its turn there, so the songs ahead are asked for early and one skipped past is not asked for ----
export const LYRICS_SETTLE = 300;      // a song that was not asked ahead is asked for once it has been current this long: one skipped past in a run of presses never is
export const LYRICS_AHEAD_SONGS = 2;   // (a count) the songs after this one whose lyrics are asked for as soon as this one's are in
export const LYRICS_LATE_AGAIN = 1000; // MA didn't answer in the relay's time (it was waiting its turn): asked again after this, it goes on looking meanwhile
export const LYRICS_LATE_TRIES = 4;    //   this many times, then it reads as none
export const LYRICS_AGAIN = [10000, 30000];  // "no lyrics" is asked again after these: MA's first lookup can come back empty
export const LYRICS_BEAT = 100;        // the sung line is looked for this often
export const LYRICS_LEAD_S = 0.15;     // seconds: a line is up this much early, as the singing starts

// ---- the queue's list (core/queue-ui.js) ----
export const LIST_LEFT_ALONE = 60000;  // a list that was scrolled or tapped follows a new song again once nobody has touched it for this long

// ---- the player card (cards/media-detail.js) ----
export const PROGRESS_EVERY = 500;     // large screens: the progress row steps twice a second (a TV pays for every frame)
export const GHOST_FOR = 600;          // the old song's art and name fade out over this (css: .mghost)
export const PARTY_ASK = 30000;        // is this music the party's: asked this often while it plays
export const RESUME_TAKES = 2000;      // after our own Stop, Resume takes a press only once it has been up this long: the highlight lands on it, and an OK pressed again while a slow TV was still drawing the stop would start the music again

// ---- the Music page (cards/music.js and its parts) ----
export const SEARCH_KEPT = 5 * 60000;  // a search's answer
export const LIBRARY_KEPT = 10 * 60000;   // the library's playlists (Made for you, Pinned)
export const RECENT_KEPT = 60000;      // Recently played
export const RATE_WAIT = 8000;         // a page is drawn after this even if not every number is in; the rest fill in when they come
export const MORE_AGAIN = 5000;        // the bigger search came back smaller than the first: asked again after this (MA lets a slow service finish in the background)
export const TYPED_WAIT = 700;         // Search waits this long after the last key

// ---- the artist's photo (core/artistart.js) ----
export const PHOTO_KEPT = 7 * 864e5;   // a photo found for an artist is kept a week on this screen
export const NO_PHOTO_KEPT = 864e5;    // "none" a day
