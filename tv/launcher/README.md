# TV launcher

A small Android app for Google TV that shows a `tv` dashboard full screen as the TV's home screen, and gives the page what a web page can't do on its own: the installed apps and launching them, Continue watching, sign-in to Home Assistant, and take-overs (the timer alarm, camera alerts) shown over a playing app. Java with no libraries; built without Gradle.

It is a reference, shared as-is like the rest of this repo. It was built and tested on Google TV; other Android TV devices may differ.

## What it does
- **Home screen:** `HomeActivity` is a full-screen WebView on your dashboard URL (e.g. `http://<ha>:8123/local/dash/start.html?d=tv&p=tv`). The page reaches the app through `window.tvhost` (`engine/core/tvhost.js`): installed apps, launching one, opening a deep link, Android Settings. App banners are served to the page at `<ha origin>/__tv/banner/<package>`. Back and Home reach the page as `tv:back` / `tv:home`.
- **Sign-in:** the app answers HA's app-auth protocol (`window.externalApp.getExternalAuth`) with a long-lived token you give it, so the dashboard signs in with no login screen. It answers only while the page is on the URL's own origin.
- **Continue watching:** many apps publish what you're in the middle of to Android TV's Watch Next list (Netflix, Disney+, HBO Max, Hulu, Emby in our tests; not YouTube). The `watchnext` card shows it, and OK opens that episode.
- **Home button:** Google TV won't let another app be the real Home. **Never disable the stock launcher** (`com.google.android.apps.tv.launcherx`): the TV then falls back to an empty system Home that restarts every minute or two and launches nothing (fix: re-enable "Google TV" in Settings > Apps > System apps). Instead, `HomeGuard`, an accessibility service, opens this app whenever the stock home screen comes to the front. It sees only the stock launcher's window changes and reads nothing on screen (`res/xml/home_guard.xml`). Switch it off or uninstall the app, and the stock home screen is back.
- **Take-overs over a playing app:** HomeGuard's overlay window keeps the dashboard loaded at `&overlay=1` (only the take-overs, see-through) while another app is in front. When the page shows a take-over, the window takes the remote: Back or OK stops the timer or dismisses the alert. As a backup, `Watcher` follows the trigger entities the page names (`tvhost.watch`) over one HA WebSocket with the same token.
- **Offline:** when HA doesn't answer, `assets/fallback.html` shows every installed app and Settings, and the app tries HA again every 20 s.

## Build
`tv/launcher/build.sh [out.apk]`, on Linux. It needs:
- JDK 17: `JAVA_HOME`, default `~/.local/opt/jdk17`
- Android SDK command-line tools with `platforms;android-34` and `build-tools;34.0.0`: `ANDROID_HOME`, default `~/.local/opt/android-sdk`
- `adb` (Android SDK platform-tools) to install it

The first build makes a signing key in `TV_KEY_DIR` (default `~/.config/dash-tv`). **Keep it and back it up:** an APK signed with another key can't update the installed app.

## Set up a TV
Run these from the machine that built the APK, on the same network as the TV.
1. On the TV: Settings > System > About > Android TV OS build: press OK 7 times to unlock Developer options. Then Settings > System > Developer options > Wireless debugging on > Pair device with pairing code.
2. Pair and connect (IP, port and code from that screen; the connect port is the one on the Wireless debugging screen itself):
   ```
   adb pair <tv ip>:<pair port> <code>
   adb connect <tv ip>:<port>
   ```
3. Install it and give it what it needs:
   ```
   adb install -r ~/.cache/dash-tv/dash-tv.apk
   adb shell pm grant dash.tv android.permission.READ_TV_LISTINGS
   adb shell "am broadcast -a dash.tv.PROVISION -n dash.tv/.Provision --es url 'http://<ha>:8123/local/dash/start.html?d=tv&p=tv' --es token '<token>'"
   adb shell settings put secure enabled_accessibility_services dash.tv/dash.tv.HomeGuard
   adb shell settings put secure accessibility_enabled 1
   adb shell am start -n dash.tv/.HomeActivity
   ```
   The `settings put` line replaces the list of accessibility services that are on. If `adb shell settings get secure enabled_accessibility_services` shows others, add HomeGuard to them with `:` between.
4. Press Home: your dashboard comes up.

**Settings** (`Provision`, from adb only: the receiver needs the DUMP permission, which apps can't get): `--es url`, `--es token`, `--es id` / `--es name` (free text the page can read through `tvhost.info()`), `--ez guard false` (stock home screen back), `--ez overlay false` (no take-overs over apps), `--ez clear true` (forget everything). Extras you leave out keep their value.

**Sign-in:** make an HA user for the TVs (not an admin, local access only), sign in as that user, and create a long-lived token in its profile. The token is kept in the app's private storage. Without one, the page shows HA's login screen.

**Undo:** remove HomeGuard from `enabled_accessibility_services` (or `--ez guard false`), then `adb uninstall dash.tv`.

## Good to know
- **Don't `am force-stop dash.tv`.** Google TV then switches off the app's accessibility service, so HomeGuard and the take-overs stay off until you switch it on again (step 3).
- Wireless debugging and adb on a fixed port don't survive a reboot. The launcher itself does: HomeGuard brings it up at start-up.
- The app allows plain `http` to reach HA on your LAN (`usesCleartextTraffic`). Use `https` in the URL if your HA has it.
- The TV has the token's rights: anything that user can see or control in HA, someone with the remote can too.

## The page side
A TV page is a normal dashboard with `profile: 'tv'` (960×540 CSS px on every Google TV, no scrolling) and `remote: true` (`engine/core/remote.js`: arrows move the highlight, OK taps, Back closes a pop-up). Cards made for it: `statusbar`, `apps`, `watchnext`. `sites/example/dash/dashboards/tv.js` is a starting point. Try it in a browser on the mock: `http://localhost:8125/local/dash/start.html?d=tv&p=tv&tvdemo=1` (`tvdemo` fills Continue watching with made-up shows; the mock draws stand-in app banners). Check that every page fits:
```
SHOT_SCRIPT=fitcheck.mjs engine/_dev/tools/shot.sh mock <site> -- --strict --d tv --q p=tv --sizes 960x540 --out /tmp/fit
```
