// Behaviour settings; defaults here, overridden by the dashboard's `settings` block at boot.
export const settings = {
  instantLightOff: true,   // lights turned off from the dashboard skip the dimmer fade
  perf: false,             // show the timing readout
  camRefreshMs: 10000,     // snapshot refresh for cameras that are not streaming
};
export function applySettings(s) { Object.assign(settings, s || {}); }
