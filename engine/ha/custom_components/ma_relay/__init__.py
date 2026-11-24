"""Music Assistant relay for the HTML dashboard.

Gives every screen signed in to Home Assistant the Music Assistant API the dashboard's Music page and Now playing use,
through HA's own WebSocket and the connection HA's Music Assistant integration already holds: no MA login on any device,
and it works wherever the dashboard does (away from home too).

  ma_relay/info                       -> {connected, image_key, time, artist_photo}   time: this server's clock (seconds),
                                      as on every event: MA stamps its queue's position with the server's time, and a
                                      screen whose clock differs would show the song that much early or late;
                                      artist_photo: this relay serves artists' photos (below)
  ma_relay/cmd {command, args}        -> MA's answer, unchanged (only the commands in ALLOWED; an MA that doesn't answer
                                      within CMD_TIMEOUT seconds is an error, code "timeout"; a play gets PLAY_TIMEOUT)
  ma_relay/subscribe {events, ids}    -> MA events {event, object_id, data} for these queues until unsubscribed (only the
                                      events in EVENTS). One more event, {event: "relay_reset"}: HA's Music Assistant
                                      integration was reloaded or MA went away, this subscription hears nothing any
                                      more; subscribe again once ma_relay/info says connected
  ma_relay/playlist_size {item_id, provider}  -> {count, duration}: how many songs a playlist has and how long they run,
                                      counted here so a screen doesn't download every playlist it lists (kept SIZE_KEPT s)
  ma_relay/party_player {entity_id?}  -> {entity_id, player_id}: where MA's Party plays (an HA media_player of the Music
                                      Assistant integration); with entity_id, sets it first (the Party plugin's one setting
                                      this relays: guest access and the join code stay as they are)
  ma_relay/ratings {uris}             -> {uri: {saves | likes, plays, count, duration}}: what other listeners think of
                                      these playlists and songs, for the Music page to sort by (MA drops these numbers).
                                      A Spotify playlist: its saves (followers) and songs, through a SpotifyPlus player,
                                      when HA has one (MA's Spotify reads a playlist at one request every 2 s, 100 songs a
                                      request, so counting songs there held up the playlist a screen opened). A SoundCloud playlist: likes, songs and length; a SoundCloud song: likes and
                                      plays (SoundCloud's own API). A Spotify song needs none: MA gives its popularity.
                                      An item that has no number is left out. Kept RATING_KEPT s.
  ma_relay/sc_playlist {item_id}      -> [tracks]: a SoundCloud playlist's songs in MA's shape (uri, name, duration,
                                      artists, metadata.images) plus likes and plays, read from SoundCloud in batches of
                                      50: MA reads them one by one (about a second each), so a long one ran past any wait
  ma_relay/sources                    -> [{domain, name}]: the music services MA searches for songs and playlists (one
                                      per service, however many accounts; not radio-only ones), for the Music page's
                                      Search to pick from: a service added in MA shows up there by itself
  ma_relay/recent                     -> [items]: what the house played last, newest first, in MA's shape (uri, name,
                                      media_type, provider, image) plus domain (the item's service, a library item's
                                      too), and for a song duration and artists. Only what somebody picked (a playlist,
                                      an artist, a song chosen itself), played to its end or not. MA keeps this log per
                                      MA user and answers for the user who asks: HA's own connection sees only what
                                      was started through it. With admin_token this is every user's log, put together:
                                      MA gives no play times, so each item is placed by the smallest of RECENT_WINDOWS
                                      it was played in (within 15 minutes, 30, an hour, …). Without admin_token: HA's
                                      own user's log. Kept RECENT_KEPT s.
  GET /api/ma_relay/image/<proxy_id>?size=80&k=<image_key>   MA's image proxy (an <img> can't send HA's token,
                                      so images carry a key that only a signed-in screen gets from ma_relay/info)
  GET /api/ma_relay/artist?name=<artist credit>&k=<image_key>   a wide photo of the artist, for the backdrop of Now
                                      playing: TheAudioDB's "fanart" (its public test key), looked up and fetched here,
                                      once for the house, so screens ask Home Assistant only. The whole credit is tried,
                                      then its first artist; only an exact name match counts. 204 (empty): no photo. Needs no MA.
Enable with `ma_relay:` in configuration.yaml (needs HA's Music Assistant integration set up). HA's own MA connection is MA's
"service" user, which may not change settings, so setting the Party player needs an MA admin token (so does
reading the other users' play logs):
  ma_relay:
    admin_token: !secret ma_admin_token     # a long-lived token of an MA admin user: the Party player, and
                                            # Recently played for every MA user
    spotifyplus_entity: media_player.x      # optional: the SpotifyPlus player that reads Spotify playlists' saves
                                            # (default: the first SpotifyPlus player HA has)
    soundcloud_client_id: !secret x         # optional: SoundCloud's API key. Without it the relay uses the one
                                            # soundcloud.com's own web player uses (read from its page, as MA's
                                            # SoundCloud setup asks you to; found again when SoundCloud changes it)
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import re
import secrets
import time
import unicodedata
from typing import Any

import aiohttp
import voluptuous as vol
from aiohttp import WSMsgType, web
from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import SIGNAL_CONFIG_ENTRY_CHANGED, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.http import KEY_HASS
from homeassistant.helpers.storage import Store

DOMAIN = "ma_relay"
_LOGGER = logging.getLogger(__name__)
CONFIG_SCHEMA = vol.Schema({DOMAIN: vol.Any(None, vol.Schema({
    vol.Optional("admin_token"): cv.string,
    vol.Optional("spotifyplus_entity"): cv.entity_id,
    vol.Optional("soundcloud_client_id"): cv.string,
}))}, extra=vol.ALLOW_EXTRA)
# The commands the dashboard sends, and no others: browsing, one queue's songs and switches, lyrics, pins (favorites),
# Party's join link and rules. Any signed-in HA user can send these, so nothing of MA's settings, providers, accounts or
# library edits is in the list. (engine/_dev/test/music-relay.test.mjs compares it with the dashboard's code.)
ALLOWED = frozenset({
    "music/search", "music/item_by_uri", "music/recently_played_items",
    "music/playlists/library_items", "music/playlists/playlist_tracks",
    "music/favorites/add_item", "music/favorites/remove_item",
    "metadata/get_track_lyrics",
    "player_queues/get", "player_queues/items", "player_queues/play_index", "player_queues/play_media",
    "player_queues/move_item", "player_queues/move_item_end", "player_queues/delete_item",
    "player_queues/autoplay", "player_queues/crossfade",
    "players/all",
    "party/url", "party/config",
})
# the MA events a screen may follow, for the queues it names
EVENTS = frozenset({"queue_updated", "queue_items_updated", "queue_time_updated"})
PROXY_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
CMD_TIMEOUT = 30     # seconds for MA to answer a command (a search over every provider, a long playlist's tracks)
PLAY_TIMEOUT = 300   # seconds for player_queues/play_media: MA answers once it has every song of what it is to play, and
                     # MA 2.10 reads a SoundCloud playlist one song at a time (46 s seen; in batches of 50 from 2.11). A
                     # screen says "it hasn't started" only some time after this answer, so the answer has to reach it
ADMIN_TIMEOUT = 20   # seconds for the whole admin connection (connect, sign in, read and save the Party setting)
IMAGE_TIMEOUT = 15   # seconds for MA's image proxy
SIZE_KEPT = 900      # seconds a playlist's size is kept
SIZES_KEPT = 300     # playlists whose size is kept
RATING_KEPT = 6 * 3600   # seconds a playlist's or song's numbers are kept (an item with none is kept as such too)
RATINGS_KEPT = 5000      # items whose numbers are kept
RATINGS_WAIT = 20        # seconds one ma_relay/ratings may take; what isn't known by then is left out
RATING_LOOKUPS = 4       # lookups at once (Spotify and SoundCloud both limit how fast they are asked)
RECENT_LIMIT = 40        # items ma_relay/recent answers with (and asks of each user)
RECENT_KEPT = 30         # seconds its answer is kept
RECENT_USERS = 60        # MA users read at most (a Party's guests are users too)
RECENT_BUDGET = 10       # seconds for reading the users' logs (up to 14 requests a user): no further user is started
                         # after that and the answer is made of the ones read, HA's own and the oldest accounts first
RECENT_WINDOWS = tuple(900 * 2 ** i for i in range(13))   # seconds: 15 minutes, doubling to about six weeks
RECENT_DETAILS_WAIT = 10   # seconds for looking up the songs' lengths and artists; what isn't known by then goes without
RECENT_DETAILS_KEPT = 2000  # items whose details are kept
ARTIST_API = "https://www.theaudiodb.com/api/v1/json/123/search.php"   # TheAudioDB, its public test key
ARTIST_HOST = re.compile(r"^https://([a-z0-9-]+\.)*theaudiodb\.com/", re.IGNORECASE)   # where a photo may be fetched from
ARTIST_TIMEOUT = 10             # seconds for the lookup, and for the picture
ARTIST_FOUND_KEPT = 7 * 86400   # seconds an artist's photo address is kept
ARTIST_NONE_KEPT = 86400        # seconds "no photo" is kept (a failed lookup is not kept)
ARTISTS_KEPT = 1000             # artists whose answer is kept
ARTIST_PHOTOS_KEPT = 12         # pictures held in memory (1280x720, about a quarter of a megabyte each)
ARTIST_NAME_MAX = 200           # characters of a credit that is looked up
SC_PLAYLIST_KEPT = 900   # seconds a SoundCloud playlist's songs are kept
SC_TRACKS_MAX = 1000     # songs read of one SoundCloud playlist
SC_API = "https://api-v2.soundcloud.com"
SC_TIMEOUT = 10          # seconds for one SoundCloud request
# MA's uri of a playlist or song: spotify--abc://playlist/<id>, soundcloud://track/<id>
ITEM_URI = re.compile(r"^(?P<domain>[a-z_]+)(?:--[A-Za-z0-9_]+)?://(?P<kind>playlist|track)/(?P<id>[A-Za-z0-9_-]{1,64})$")
SC_CLIENT_ID = re.compile(r'client_id\s*[:=]\s*"([A-Za-z0-9]{20,64})"')
SC_ASSET = re.compile(r'src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)"')


def _mass(hass: HomeAssistant):
    """HA's Music Assistant client, or None while MA is down / not set up."""
    for entry in hass.config_entries.async_loaded_entries("music_assistant"):
        # (where HA's Music Assistant integration keeps its client; read defensively, it is that integration's own)
        mass = getattr(getattr(entry, "runtime_data", None), "mass", None)
        if mass is not None and getattr(getattr(mass, "connection", None), "connected", False):
            return mass
    return None


def _plain(data: Any) -> Any:
    return data.to_dict() if hasattr(data, "to_dict") else data


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    store = Store(hass, 1, DOMAIN)
    saved = await store.async_load() or {}
    if not saved.get("image_key"):   # kept across restarts, so image links on open screens keep working
        saved = {"image_key": secrets.token_urlsafe(24)}
        await store.async_save(saved)
    hass.data[DOMAIN] = saved["image_key"]
    conf = config.get(DOMAIN) or {}
    hass.data[DOMAIN + "_admin"] = conf.get("admin_token") or None
    hass.data[DOMAIN + "_rate"] = Ratings(hass, conf.get("spotifyplus_entity"), conf.get("soundcloud_client_id"))
    subs: dict = {}   # (connection, message id) -> MA's unsubscribe, for every screen's queue subscription
    hass.data[DOMAIN + "_subs"] = subs
    hass.data[DOMAIN + "_sizes"] = {}   # (item id, provider) -> (when, {count, duration})
    hass.data[DOMAIN + "_artists"] = Artists(hass)

    @callback
    def ma_changed(change, entry) -> None:
        """HA's Music Assistant entry stopped being loaded: its client is gone, and the subscriptions made on it with it.

        A reload makes a new client, which knows nothing of them, and HA's own link to the screen stays up, so without
        a word a screen would keep a queue that no longer moves. Each one is told, and subscribes again.
        """
        if entry.domain != "music_assistant" or entry.state is ConfigEntryState.LOADED:
            return
        for (connection, mid), unsub in list(subs.items()):
            subs.pop((connection, mid), None)
            try:
                unsub()
            except Exception:  # noqa: BLE001 - the client it was made on is already gone
                pass
            connection.send_message(websocket_api.event_message(mid, {"event": "relay_reset", "object_id": None, "data": None}))

    async_dispatcher_connect(hass, SIGNAL_CONFIG_ENTRY_CHANGED, ma_changed)
    websocket_api.async_register_command(hass, ws_info)
    websocket_api.async_register_command(hass, ws_cmd)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_playlist_size)
    websocket_api.async_register_command(hass, ws_party_player)
    websocket_api.async_register_command(hass, ws_ratings)
    websocket_api.async_register_command(hass, ws_sc_playlist)
    websocket_api.async_register_command(hass, ws_sources)
    websocket_api.async_register_command(hass, ws_recent)
    hass.http.register_view(ImageView())
    hass.http.register_view(ArtistView())
    return True


@websocket_api.websocket_command({vol.Required("type"): "ma_relay/info"})
@callback
def ws_info(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    connection.send_result(msg["id"], {"connected": _mass(hass) is not None, "image_key": hass.data[DOMAIN], "time": time.time(),
                                       "artist_photo": True})


@websocket_api.websocket_command({
    vol.Required("type"): "ma_relay/cmd",
    vol.Required("command"): str,
    vol.Optional("args", default={}): dict,
})
@websocket_api.async_response
async def ws_cmd(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    command = msg["command"]
    if command not in ALLOWED:
        connection.send_error(msg["id"], "not_allowed", f"{command} isn't relayed")
        return
    mass = _mass(hass)
    if mass is None:
        connection.send_error(msg["id"], "not_connected", "Music Assistant isn't connected")
        return
    # the arguments are MA's own; `require_schema` is the client library's (it would not reach MA), so it isn't passed on
    args = {k: v for k, v in msg["args"].items() if k != "require_schema"}
    wait = PLAY_TIMEOUT if command == "player_queues/play_media" else CMD_TIMEOUT
    try:
        async with asyncio.timeout(wait):
            result = await mass.send_command(command, **args)
    except TimeoutError:
        connection.send_error(msg["id"], "timeout", f"Music Assistant didn't answer {command} within {wait} s")
        return
    except Exception as err:  # noqa: BLE001 - MA's own error, passed on to the screen
        connection.send_error(msg["id"], "ma_error", str(err) or type(err).__name__)
        return
    connection.send_result(msg["id"], _plain(result))


@websocket_api.websocket_command({
    vol.Required("type"): "ma_relay/subscribe",
    vol.Required("events"): vol.All([vol.In(EVENTS)], vol.Length(min=1)),
    vol.Required("ids"): vol.All([str], vol.Length(min=1, max=20)),
})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    mass = _mass(hass)
    if mass is None:
        connection.send_error(msg["id"], "not_connected", "Music Assistant isn't connected")
        return
    events = tuple(msg["events"])
    ids = tuple(msg["ids"])

    @callback
    def forward(ev) -> None:
        name = getattr(ev.event, "value", ev.event)
        if name not in events:
            return
        connection.send_message(websocket_api.event_message(msg["id"], {"event": name, "object_id": ev.object_id, "data": _plain(ev.data), "time": time.time()}))

    subs, key, unsub = hass.data[DOMAIN + "_subs"], (connection, msg["id"]), mass.subscribe(forward, None, ids)
    subs[key] = unsub

    @callback
    def close() -> None:   # the screen unsubscribed or went away (not after a reset: MA's side is already closed then)
        if subs.pop(key, None) is not None:
            unsub()

    connection.subscriptions[msg["id"]] = close
    connection.send_result(msg["id"])


@websocket_api.websocket_command({
    vol.Required("type"): "ma_relay/playlist_size",
    vol.Required("item_id"): vol.All(str, vol.Length(min=1, max=256)),
    vol.Required("provider"): vol.All(str, vol.Length(min=1, max=128)),
})
@websocket_api.async_response
async def ws_playlist_size(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    sizes, key, now = hass.data[DOMAIN + "_sizes"], (msg["item_id"], msg["provider"]), time.monotonic()
    had = sizes.get(key)
    if had and now - had[0] < SIZE_KEPT:
        connection.send_result(msg["id"], had[1])
        return
    mass = _mass(hass)
    if mass is None:
        connection.send_error(msg["id"], "not_connected", "Music Assistant isn't connected")
        return
    try:
        async with asyncio.timeout(CMD_TIMEOUT):
            tracks = await mass.send_command("music/playlists/playlist_tracks", item_id=msg["item_id"], provider_instance_id_or_domain=msg["provider"])
    except TimeoutError:
        connection.send_error(msg["id"], "timeout", "Music Assistant didn't answer in time")
        return
    except Exception as err:  # noqa: BLE001 - MA's own error, passed on to the screen
        connection.send_error(msg["id"], "ma_error", str(err) or type(err).__name__)
        return
    tracks = _plain(tracks) or []
    size = {"count": len(tracks), "duration": sum((t.get("duration") or 0) for t in tracks if isinstance(t, dict))}
    if len(sizes) >= SIZES_KEPT:   # the oldest goes
        sizes.pop(min(sizes, key=lambda k: sizes[k][0]), None)
    sizes[key] = (now, size)
    connection.send_result(msg["id"], size)


@websocket_api.websocket_command({vol.Required("type"): "ma_relay/party_player", vol.Optional("entity_id"): str})
@websocket_api.async_response
async def ws_party_player(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    mass = _mass(hass)
    if mass is None:
        connection.send_error(msg["id"], "not_connected", "Music Assistant isn't connected")
        return
    reg = er.async_get(hass)
    try:
        if entity := msg.get("entity_id"):
            entry = reg.async_get(entity)
            if entry is None or entry.platform != "music_assistant" or entry.domain != "media_player":
                connection.send_error(msg["id"], "not_found", f"{entity} isn't a Music Assistant player")
                return
            token = hass.data.get(DOMAIN + "_admin")
            if not token:
                connection.send_error(msg["id"], "no_admin_token", "Setting the party player needs ma_relay's admin_token")
                return
            await _set_party_player(hass, mass.server_info.base_url, token, entry.unique_id)
            connection.send_result(msg["id"], {"entity_id": entity, "player_id": entry.unique_id})
            return
        async with asyncio.timeout(CMD_TIMEOUT):
            player = await mass.send_command("party/player")
    except TimeoutError:
        connection.send_error(msg["id"], "timeout", "Music Assistant didn't answer in time")
        return
    except Exception as err:  # noqa: BLE001 - MA's own error, passed on to the screen
        connection.send_error(msg["id"], "ma_error", str(err) or type(err).__name__)
        return
    entity = reg.async_get_entity_id("media_player", "music_assistant", player) if player else None
    connection.send_result(msg["id"], {"entity_id": entity, "player_id": player})


async def _as_admin(hass: HomeAssistant, base_url: str, token: str, work) -> Any:
    """Run `work(call)` as MA's admin user; call(command, **args) -> MA's answer.

    Over a short admin connection of its own (MA's websocket API: hello, auth, then commands, one at a time),
    ADMIN_TIMEOUT seconds at most for all of it: an MA that stops answering part-way is an error, not a wait without end.
    """
    seq = 0
    try:
        async with asyncio.timeout(ADMIN_TIMEOUT):
            async with async_get_clientsession(hass).ws_connect(base_url.rstrip("/") + "/ws") as ws:
                async def call(command: str, **args: Any) -> Any:
                    nonlocal seq
                    seq += 1
                    mid = str(seq)
                    await ws.send_json({"message_id": mid, "command": command, "args": args})
                    async for m in ws:
                        if m.type != WSMsgType.TEXT:
                            break
                        d = m.json()
                        if str(d.get("message_id")) != mid or d.get("partial"):
                            continue
                        if "error_code" in d:
                            raise HomeAssistantError(d.get("details") or f"MA error {d['error_code']}")
                        return d.get("result")
                    raise HomeAssistantError("Music Assistant closed the connection")

                await ws.receive_json()   # the server's hello
                await call("auth", token=token)
                return await work(call)
    except TimeoutError as err:
        raise HomeAssistantError("Music Assistant didn't answer in time") from err


async def _set_party_player(hass: HomeAssistant, base_url: str, token: str, player_id: str) -> None:
    """Set MA's Party player (the Party plugin's one setting this relays)."""
    async def work(call) -> None:
        party = [c for c in await call("config/providers", provider_domain="party") if c.get("domain") == "party"]
        if not party:
            raise HomeAssistantError("Music Assistant's Party plugin isn't set up")
        await call("config/providers/save", provider_domain="party", instance_id=party[0]["instance_id"], values={"player": player_id})

    await _as_admin(hass, base_url, token, work)


# ---- Recently played, for the whole house ----
_RECENT_ARGS = {"limit": RECENT_LIMIT, "fully_played_only": False, "user_initiated_only": True}


def _recent_key(item: dict) -> tuple:
    return (item.get("media_type"), item.get("provider"), str(item.get("item_id")))


def merge_recent(logs: list[list[tuple[int, dict]]]) -> list[dict]:
    """Every user's log ([(window, item)], each newest first) as one list, newest first, an item once.

    The window (an index of RECENT_WINDOWS, or one past it) is all that is known of when; inside one window a user's
    own order holds, and the users take turns.
    """
    rows = [(window, at, n, item) for n, log in enumerate(logs) for at, (window, item) in enumerate(log)]
    out, seen = [], set()
    for _, _, _, item in sorted(rows, key=lambda r: r[:3]):
        if _recent_key(item) not in seen:
            seen.add(_recent_key(item))
            out.append(item)
    return out[:RECENT_LIMIT]


async def _recent_everyone(hass: HomeAssistant, mass, token: str) -> list[dict]:
    try:   # HA's own MA user is a system user: auth/users leaves it out
        own = (_plain(await mass.send_command("auth/me")) or {}).get("user_id")
    except Exception:  # noqa: BLE001 - an MA that doesn't say: the listed users only
        own = None

    async def work(call) -> list[dict]:
        ids = [u.get("user_id") for u in await call("auth/users") or []]
        ids = list(dict.fromkeys(i for i in [own, *ids] if i))[:RECENT_USERS]
        now, logs, until = int(time.time()), [], time.monotonic() + RECENT_BUDGET
        for uid in ids:
            if logs and time.monotonic() > until:
                _LOGGER.debug("Recently played: %s of %s MA users read in %s s, the rest left out", ids.index(uid), len(ids), RECENT_BUDGET)
                break
            log = await call("music/recently_played_items", userid=uid, **_RECENT_ARGS) or []
            if not log:
                continue
            windows, placed = [len(RECENT_WINDOWS)] * len(log), 0
            for w, span in enumerate(RECENT_WINDOWS):   # the log is newest first: each window holds its first n
                if placed >= len(log):
                    break
                n = len(await call("music/recently_played_items", userid=uid, played_after_timestamp=now - span, **_RECENT_ARGS) or [])
                for i in range(placed, min(n, len(log))):
                    windows[i] = w
                placed = max(placed, n)
            logs.append(list(zip(windows, log)))
        return merge_recent(logs)

    return await _as_admin(hass, mass.server_info.base_url, token, work)


async def _recent_details(hass: HomeAssistant, mass, items: list[dict]) -> None:
    """Add to each item its service (domain) and, for a song, its length and artists (MA's play log keeps none)."""
    kept: dict = hass.data.setdefault(DOMAIN + "_recent_details", {})
    gate = asyncio.Semaphore(RATING_LOOKUPS)

    async def look(item: dict) -> None:
        async with gate:
            try:
                full = _plain(await mass.send_command("music/item_by_uri", uri=item["uri"])) or {}
            except Exception:  # noqa: BLE001 - an item MA no longer finds: shown as the log has it
                return
        maps = [m for m in full.get("provider_mappings") or [] if isinstance(m, dict)]
        maps = [m for m in maps if m.get("available", True)] or maps
        d = {"domain": (maps[0].get("provider_domain") if maps else None) or str(item.get("provider") or "").split("--")[0]}
        if item.get("media_type") == "track":
            d["duration"] = full.get("duration")
            d["artists"] = [{"name": a.get("name")} for a in full.get("artists") or [] if isinstance(a, dict) and a.get("name")]
        if len(kept) >= RECENT_DETAILS_KEPT:
            kept.clear()
        kept[item["uri"]] = d

    ask = [i for i in items if i.get("uri") and i["uri"] not in kept and (i.get("media_type") == "track" or i.get("provider") == "library")]
    if ask:
        await asyncio.wait([asyncio.ensure_future(look(i)) for i in ask], timeout=RECENT_DETAILS_WAIT)
    for i in items:
        i.update(kept.get(i.get("uri")) or {"domain": str(i.get("provider") or "").split("--")[0]})


@websocket_api.websocket_command({vol.Required("type"): "ma_relay/recent"})
@websocket_api.async_response
async def ws_recent(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    mass = _mass(hass)
    if mass is None:
        connection.send_error(msg["id"], "not_connected", "Music Assistant isn't connected")
        return
    state: dict = hass.data.setdefault(DOMAIN + "_recent", {"lock": asyncio.Lock(), "at": 0.0, "items": []})
    try:
        async with state["lock"]:   # screens asking together get one reading
            if time.monotonic() - state["at"] > RECENT_KEPT or not state["at"]:
                token, items = hass.data.get(DOMAIN + "_admin"), None
                if token:
                    try:
                        items = await _recent_everyone(hass, mass, token)
                    except Exception as err:  # noqa: BLE001 - the admin connection failed: HA's own user's log
                        _LOGGER.warning("Recently played: the other MA users' logs couldn't be read (%s); showing HA's own", err)
                        items = None
                if items is None:
                    async with asyncio.timeout(CMD_TIMEOUT):
                        items = [_plain(x) for x in await mass.send_command("music/recently_played_items", **_RECENT_ARGS) or []]
                items = [dict(x) for x in items if isinstance(x, dict)]
                await _recent_details(hass, mass, items)
                state.update(at=time.monotonic(), items=items)
    except TimeoutError:
        connection.send_error(msg["id"], "timeout", "Music Assistant didn't answer in time")
        return
    except Exception as err:  # noqa: BLE001 - MA's own error, passed on to the screen
        connection.send_error(msg["id"], "ma_error", str(err) or type(err).__name__)
        return
    connection.send_result(msg["id"], state["items"])


@websocket_api.websocket_command({
    vol.Required("type"): "ma_relay/ratings",
    vol.Required("uris"): vol.All([str], vol.Length(max=100)),
})
@websocket_api.async_response
async def ws_ratings(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    connection.send_result(msg["id"], await hass.data[DOMAIN + "_rate"].ratings(msg["uris"]))


@websocket_api.websocket_command({
    vol.Required("type"): "ma_relay/sc_playlist",
    vol.Required("item_id"): vol.All(str, vol.Match(r"^[0-9]{1,20}$")),
})
@websocket_api.async_response
async def ws_sc_playlist(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        connection.send_result(msg["id"], await hass.data[DOMAIN + "_rate"].sc_playlist(msg["item_id"]))
    except (aiohttp.ClientError, TimeoutError, HomeAssistantError) as err:
        connection.send_error(msg["id"], "soundcloud", str(err) or "SoundCloud didn't answer")


# a provider that finds songs or playlists has one of these besides search (a radio-only one, as SomaFM, has none)
SONG_FEATURES = frozenset({"library_tracks", "library_playlists", "artist_toptracks", "similar_tracks"})


@websocket_api.websocket_command({vol.Required("type"): "ma_relay/sources"})
@websocket_api.async_response
async def ws_sources(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    mass = _mass(hass)
    if mass is None:
        connection.send_error(msg["id"], "not_connected", "Music Assistant isn't connected")
        return
    try:
        async with asyncio.timeout(CMD_TIMEOUT):
            found = await mass.send_command("providers", provider_type="music")
    except Exception as err:  # noqa: BLE001 - MA refused or didn't answer: the list HA's client keeps (kept up to date by MA's events)
        found = [p for p in (getattr(mass, "providers", None) or []) if getattr(getattr(p, "type", None), "value", getattr(p, "type", None)) == "music"]
        if not found:
            connection.send_error(msg["id"], "ma_error", str(err) or type(err).__name__)
            return
    out, seen = [], set()
    for p in (_plain(x) for x in (found or [])):
        if not isinstance(p, dict) or not p.get("available", True) or p.get("domain") in seen:
            continue
        features = {getattr(f, "value", f) for f in p.get("supported_features") or []}
        if "search" in features and features & SONG_FEATURES:
            seen.add(p["domain"])
            out.append({"domain": p["domain"], "name": re.sub(r"\s*\[[^\]]*\]$", "", p.get("name") or p["domain"])})   # "Spotify [account]" -> "Spotify"
    connection.send_result(msg["id"], out)


class Ratings:
    """What other listeners think of a playlist or song, from Spotify (through SpotifyPlus) and SoundCloud."""

    def __init__(self, hass: HomeAssistant, spotifyplus: str | None, sc_client_id: str | None) -> None:
        self.hass = hass
        self.spotifyplus = spotifyplus
        self.sc_fixed = sc_client_id   # set in configuration.yaml: used as it is, never looked for
        self.sc_id: str | None = sc_client_id
        self.sc_lock = asyncio.Lock()
        self.kept: dict[str, tuple[float, dict]] = {}   # uri -> (when, numbers)
        self.playlists: dict[str, tuple[float, list]] = {}   # SoundCloud playlist id -> (when, songs)
        self.gate = asyncio.Semaphore(RATING_LOOKUPS)

    def keep(self, uri: str, numbers: dict) -> None:
        if len(self.kept) >= RATINGS_KEPT:   # the oldest half goes
            for k in sorted(self.kept, key=lambda k: self.kept[k][0])[: RATINGS_KEPT // 2]:
                self.kept.pop(k, None)
        self.kept[uri] = (time.monotonic(), numbers)

    async def ratings(self, uris: list[str]) -> dict:
        now, out, spotify, sc_lists, sc_tracks = time.monotonic(), {}, [], [], []
        for uri in dict.fromkeys(uris):
            had = self.kept.get(uri)
            if had and now - had[0] < RATING_KEPT:
                if had[1]:
                    out[uri] = had[1]
                continue
            m = ITEM_URI.match(uri) if len(uri) <= 200 else None
            if not m:
                continue
            where = {("spotify", "playlist"): spotify, ("soundcloud", "playlist"): sc_lists, ("soundcloud", "track"): sc_tracks}.get((m["domain"], m["kind"]))
            if where is not None:
                where.append((uri, m["id"]))
        jobs = [self._spotify_playlist(u, i) for u, i in spotify] + [self._sc_playlist_numbers(u, i) for u, i in sc_lists]
        jobs += [self._sc_tracks(sc_tracks[i:i + 50]) for i in range(0, len(sc_tracks), 50)]
        if jobs:
            try:
                async with asyncio.timeout(RATINGS_WAIT):
                    await asyncio.gather(*jobs, return_exceptions=True)
            except TimeoutError:
                pass   # what came back in time is kept and sent; the rest is asked again next time
        for uri, _ in spotify + sc_lists + sc_tracks:
            had = self.kept.get(uri)
            if had and had[1]:
                out[uri] = had[1]
        return out

    # ---- Spotify: a playlist's saves, through SpotifyPlus's get_playlist (MA's Spotify provider doesn't keep them) ----
    def _spotifyplus(self) -> str | None:
        if self.spotifyplus:
            return self.spotifyplus
        for entry in er.async_get(self.hass).entities.values():
            if entry.platform == "spotifyplus" and entry.domain == "media_player" and not entry.disabled_by:
                return entry.entity_id
        return None

    async def _spotify_playlist(self, uri: str, playlist_id: str) -> None:
        entity = self._spotifyplus()
        if not entity or not self.hass.services.has_service("spotifyplus", "get_playlist"):
            return
        async with self.gate:
            try:
                r = await self.hass.services.async_call("spotifyplus", "get_playlist", {"entity_id": entity, "playlist_id": playlist_id, "fields": "followers,tracks(total)"},
                                                        blocking=True, return_response=True)
            except Exception as err:  # noqa: BLE001 - SpotifyPlus's own errors
                # Spotify refuses its own playlists to other apps ("Resource not found"): no number, kept as such.
                # Anything else (too many requests, a hiccup) is asked again next time.
                if "resource not found" in str(err).lower():
                    self.keep(uri, {})
                return
        got = (r or {}).get("result") or {}
        saves, count = (got.get("followers") or {}).get("total"), (got.get("tracks") or {}).get("total")
        self.keep(uri, {k: v for k, v in (("saves", saves), ("count", count)) if isinstance(v, int)})

    # ---- SoundCloud: its own API (api-v2), with the key its web player uses ----
    async def _sc_key(self, refused: str | None = None) -> str | None:
        """SoundCloud's key; `refused`: the key SoundCloud just turned down, to be found again (once, however many ask)."""
        if self.sc_fixed:
            return self.sc_fixed
        async with self.sc_lock:
            if self.sc_id and self.sc_id != refused:
                return self.sc_id
            session = async_get_clientsession(self.hass)
            timeout = aiohttp.ClientTimeout(total=SC_TIMEOUT)
            async with session.get("https://soundcloud.com/", timeout=timeout, headers={"User-Agent": "Mozilla/5.0"}) as resp:
                page = await resp.text()
            for src in reversed(SC_ASSET.findall(page)):   # the key is in one of the last scripts
                async with session.get(src, timeout=timeout) as resp:
                    found = SC_CLIENT_ID.search(await resp.text())
                if found:
                    self.sc_id = found.group(1)
                    return self.sc_id
            raise HomeAssistantError("SoundCloud's key wasn't found on its page")

    async def _sc_get(self, path: str, **params: Any) -> Any:
        session, refused = async_get_clientsession(self.hass), None
        while True:
            key = await self._sc_key(refused)
            async with session.get(SC_API + path, params={**params, "client_id": key}, timeout=aiohttp.ClientTimeout(total=SC_TIMEOUT)) as resp:
                if resp.status in (401, 403) and not refused and not self.sc_fixed:
                    refused = key   # SoundCloud changed its key: find the new one, once
                    continue
                if resp.status == 404:
                    return None
                resp.raise_for_status()
                return await resp.json()

    async def _sc_playlist_numbers(self, uri: str, playlist_id: str) -> None:
        async with self.gate:
            try:
                p = await self._sc_get(f"/playlists/{playlist_id}", representation="compact")
            except (aiohttp.ClientError, TimeoutError, HomeAssistantError):
                return   # not kept: asked again next time
        self.keep(uri, _sc_numbers(p) if isinstance(p, dict) else {})

    async def _sc_tracks(self, batch: list[tuple[str, str]]) -> None:
        async with self.gate:
            try:
                got = await self._sc_get("/tracks", ids=",".join(i for _, i in batch))
            except (aiohttp.ClientError, TimeoutError, HomeAssistantError):
                return
        by_id = {str(t.get("id")): t for t in (got or []) if isinstance(t, dict)}
        for uri, i in batch:
            self.keep(uri, _sc_numbers(by_id[i]) if i in by_id else {})

    async def sc_playlist(self, playlist_id: str) -> list:
        had = self.playlists.get(playlist_id)
        if had and time.monotonic() - had[0] < SC_PLAYLIST_KEPT:
            return had[1]
        p = await self._sc_get(f"/playlists/{playlist_id}")
        if not isinstance(p, dict):
            raise HomeAssistantError("SoundCloud has no such playlist")
        listed = [t for t in (p.get("tracks") or []) if isinstance(t, dict) and t.get("id")][:SC_TRACKS_MAX]
        full = {str(t["id"]): t for t in listed if t.get("title")}   # SoundCloud gives the first few in full, the rest by id
        missing = [str(t["id"]) for t in listed if str(t["id"]) not in full]
        for i in range(0, len(missing), 50):
            async with self.gate:
                got = await self._sc_get("/tracks", ids=",".join(missing[i:i + 50]))
            full.update({str(t.get("id")): t for t in (got or []) if isinstance(t, dict)})
        songs = []
        for t in listed:
            t = full.get(str(t["id"]))
            # not playable here (BLOCK), or a 30 s preview of a song for SoundCloud's subscribers only (SNIP): MA's own
            # SoundCloud search leaves those out for an account that can't play them in full, and so does this list
            if not t or t.get("policy") in ("BLOCK", "SNIP"):
                continue
            song = _sc_track(t)
            self.keep(song["uri"], _sc_numbers(t))
            songs.append(song)
        if len(self.playlists) >= 50:
            self.playlists.pop(min(self.playlists, key=lambda k: self.playlists[k][0]), None)
        self.playlists[playlist_id] = (time.monotonic(), songs)
        return songs


def _sc_numbers(x: dict) -> dict:
    """A SoundCloud playlist's or song's numbers: likes, plays; a playlist's songs and length."""
    n = {"likes": x.get("likes_count"), "plays": x.get("playback_count")}
    if x.get("kind") == "playlist":
        n.update(count=x.get("track_count"), duration=round((x.get("duration") or 0) / 1000) or None)
    return {k: v for k, v in n.items() if isinstance(v, int)}


def _sc_track(t: dict) -> dict:
    """A SoundCloud song in MA's shape, as MA's own SoundCloud provider gives it (MA plays it by its uri)."""
    tid, user = str(t["id"]), t.get("user") or {}
    pic = t.get("artwork_url") or user.get("avatar_url") or ""
    return {
        "item_id": tid, "provider": "soundcloud", "media_type": "track", "uri": f"soundcloud://track/{tid}",
        "name": t.get("title") or "", "duration": round((t.get("duration") or 0) / 1000),
        "artists": [{"name": user.get("username") or "", "media_type": "artist", "uri": f"soundcloud://artist/{user.get('id')}"}],
        "provider_mappings": [{"item_id": tid, "provider_domain": "soundcloud", "provider_instance": "soundcloud"}],
        "metadata": {"images": [{"type": "thumb", "path": pic.replace("-large.", "-t500x500."), "remotely_accessible": True}] if pic else []},
        **_sc_numbers(t),
    }


class ImageView(HomeAssistantView):
    url = "/api/ma_relay/image/{proxy_id}"
    name = "api:ma_relay:image"
    requires_auth = False   # checked with the image key instead (an <img> can't send HA's token)

    async def get(self, request: web.Request, proxy_id: str) -> web.StreamResponse:
        hass: HomeAssistant = request.app[KEY_HASS]
        # (compared as bytes: a key with a letter outside ASCII is a wrong key, not an error)
        if not hmac.compare_digest(request.query.get("k", "").encode(), hass.data[DOMAIN].encode()) or not PROXY_ID.match(proxy_id):
            return web.Response(status=403)
        mass = _mass(hass)
        if mass is None or not mass.server_info:
            return web.Response(status=503)
        size = request.query.get("size", "0")
        size = size if size.isdigit() else "0"
        url = f"{mass.server_info.base_url.rstrip('/')}/imageproxy/{proxy_id}?size={size}&fmt=jpg"
        try:
            async with async_get_clientsession(hass).get(url, timeout=aiohttp.ClientTimeout(total=IMAGE_TIMEOUT)) as resp:
                if resp.status != 200:
                    return web.Response(status=resp.status)
                body = await resp.read()
                return web.Response(body=body, content_type=resp.content_type or "image/jpeg",
                                    headers={"Cache-Control": "private, max-age=86400"})
        except (aiohttp.ClientError, TimeoutError):   # MA restarting, or not answering: no picture, and no traceback per image
            return web.Response(status=502)


def artist_norm(name: str) -> str:
    """A name as it is compared: lower case, no accents, anything but letters and digits a space."""
    plain = re.sub(r"[\u0300-\u036f]", "", unicodedata.normalize("NFKD", (name or "").lower()))
    return re.sub(r"[^a-z0-9]+", " ", plain).strip()


def artist_names(credit: str) -> list[str]:
    """The names to try for a credit: all of it, then its first artist ("A/B", "A, B", "A feat. B", "A & B")."""
    parts = [credit, re.split(r"\s*[/,;]\s*", credit)[0], re.split(r"\s+(?:feat\.?|ft\.?|featuring|with|&|x)\s+", credit, flags=re.IGNORECASE)[0]]
    out: list[str] = []
    for n in (x.strip() for x in parts):
        if n and n not in out:
            out.append(n)
    return out


class Artists:
    """Artists' photos: the address from TheAudioDB (kept), and the picture itself (a few held in memory)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.urls: dict[str, tuple[float, str | None]] = {}   # name as compared -> (when, address or None)
        self.asking: dict[str, asyncio.Future] = {}
        self.pics: dict[str, tuple[bytes, str]] = {}          # address -> (picture, content type), the last used last

    async def _one(self, name: str) -> str | None | bool:
        """The photo's address for a name; None: it has none; False: the lookup failed (not kept)."""
        key = artist_norm(name)
        if not key:
            return None
        had = self.urls.get(key)
        if had and time.time() - had[0] < (ARTIST_FOUND_KEPT if had[1] else ARTIST_NONE_KEPT):
            return had[1]
        if key not in self.asking:   # several screens ask for the same artist as a song starts: one lookup
            self.asking[key] = asyncio.ensure_future(self._lookup(name, key))
        try:
            return await asyncio.shield(self.asking[key])
        finally:
            if key in self.asking and self.asking[key].done():
                del self.asking[key]

    async def _lookup(self, name: str, key: str) -> str | None | bool:
        try:
            async with async_get_clientsession(self.hass).get(ARTIST_API, params={"s": name}, timeout=aiohttp.ClientTimeout(total=ARTIST_TIMEOUT)) as resp:
                if resp.status != 200:
                    return False   # refused or busy: asked again next time
                data = await resp.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError):
            return False
        if not isinstance(data, dict):
            return False
        url = None
        for a in data.get("artists") or []:
            if artist_norm(a.get("strArtist") or "") == key:   # two artists can share a search: only the one named
                url = next((a.get(k) for k in ("strArtistFanart", "strArtistFanart2", "strArtistFanart3", "strArtistFanart4") if a.get(k)), None)
                break
        if url and not ARTIST_HOST.match(url):
            url = None
        if len(self.urls) >= ARTISTS_KEPT:
            self.urls.pop(next(iter(self.urls)))
        self.urls[key] = (time.time(), url)
        return url

    async def photo(self, credit: str) -> tuple[bytes, str] | None | bool:
        """The picture and its content type; None: this artist has none; False: it couldn't be asked or fetched now."""
        url, failed = None, False
        for name in artist_names(credit):
            url = await self._one(name)
            if url:
                break
            failed = failed or url is False
        if not url:
            return False if failed else None
        if url in self.pics:
            self.pics[url] = self.pics.pop(url)
            return self.pics[url]
        try:
            async with async_get_clientsession(self.hass).get(url, timeout=aiohttp.ClientTimeout(total=ARTIST_TIMEOUT)) as resp:
                if resp.status != 200:
                    return False
                got = (await resp.read(), resp.content_type or "image/jpeg")
        except (aiohttp.ClientError, TimeoutError):
            return False
        self.pics[url] = got
        while len(self.pics) > ARTIST_PHOTOS_KEPT:
            self.pics.pop(next(iter(self.pics)))
        return got


class ArtistView(HomeAssistantView):
    url = "/api/ma_relay/artist"
    name = "api:ma_relay:artist"
    requires_auth = False   # checked with the image key, as the images are

    async def get(self, request: web.Request) -> web.StreamResponse:
        hass: HomeAssistant = request.app[KEY_HASS]
        if not hmac.compare_digest(request.query.get("k", "").encode(), hass.data[DOMAIN].encode()):
            return web.Response(status=403)
        credit = request.query.get("name", "").strip()
        if not credit or len(credit) > ARTIST_NAME_MAX:
            return web.Response(status=400)
        got = await hass.data[DOMAIN + "_artists"].photo(credit)
        # No picture is an empty answer, not an error (a browser logs every 4xx on its console): the screen shows the
        # art's wash. None: this artist has none, the browser needn't ask again for an hour; False: TheAudioDB couldn't
        # be asked just now, the next song of this artist asks again.
        if not got:
            return web.Response(status=204, headers={"Cache-Control": "private, max-age=3600" if got is None else "no-store"})
        return web.Response(body=got[0], content_type=got[1], headers={"Cache-Control": "private, max-age=604800"})
