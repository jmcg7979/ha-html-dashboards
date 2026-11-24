// Made-up answers for what HA keeps over time: history, long-term statistics, the logbook, calendars, weather forecasts.
// Each is computed from the entity's current state and the clock, so a run shows the same shapes every time.

// history/history_during_period. Numbers: 96 points waving around the current state. Climate: 30 rows of temperatures,
// set points and heating / cooling. Entities whose state is a word or a time (a door, a helper, a switch, a sensor that
// is unavailable or reports text): the state they have now for the whole period, with a row at the moment it last
// changed when that is inside the period.
const STEADY = /^(binary_sensor|input_boolean|input_datetime|input_text|input_select|switch|lock|cover|person)\./;
export function history(m, S) {
  const out = {}, now = Date.now() / 1000;
  const t0 = Math.max(Date.parse(m.start_time) / 1000 || 0, now - 10 * 86400);
  for (const id of m.entity_ids) {
    const e = S[id] || {}, base = parseFloat(e.s), k = swingOf(e), num = !isNaN(base) && !id.startsWith('climate.');
    if (STEADY.test(id) || (!num && id.startsWith('sensor.') && S[id])) { out[id] = !S[id] ? [] : [t0, e.lc].filter((t, i) => !i || t > t0).map((lu) => ({ s: e.s, a: e.a || {}, lu })); continue; }
    const n = num ? 96 : 30;
    out[id] = Array.from({ length: n }, (_, i) => ({
      s: num ? String(wave(base, k * (0.22 * Math.sin(i / 9 + id.length) + 0.05 * Math.sin(i * 1.3 + id.length * 3)))) : String(45 + Math.sin(i / 3) * 5),
      a: { current_temperature: 68 + Math.sin(i / 4) * 2, target_temp_low: i < 15 ? 67 : 68, target_temp_high: 74, hvac_action: (i % 7 < 2 ? 'heating' : i % 11 === 3 ? 'cooling' : 'idle') },
      lu: t0 + i * (now - t0) / n }));
  }
  return out;
}
// how far a reading moves: a state's own `swing` scales the wave (1 = the usual ±22%; 0.1 for a battery's voltage, which barely moves)
const swingOf = (e) => (e && e.swing != null ? e.swing : 1);
// a value around `base`; readings that can't be negative (most) stop at 0, ones that are (a signal in dBm) keep their sign
const wave = (base, swing) => (base < 0 ? base * (1 + swing) : Math.max(0, base * (1 + swing)));

// recorder/statistics_during_period: hourly or daily means for up to 40 days, for every numeric entity (none for ids matching `skip`)
export function statistics(m, S, skip) {
  const out = {}, P = m.period === 'day' ? 86400e3 : 3600e3, first = Date.now() - 40 * 86400e3;
  const t = Math.ceil(Math.max(Date.parse(m.start_time), first) / P) * P;
  for (const id of m.statistic_ids) {
    const base = parseFloat((S[id] || {}).s), w = swingOf(S[id]);
    if (isNaN(base) || (skip && skip.test(id))) continue;
    const rows = [];
    for (let x = t; x < Date.now() - P; x += P) {
      const k = x / P, v = wave(base, w * (0.18 * Math.sin(k / (P > 3600e3 ? 5 : 20) + id.length) + 0.06 * Math.sin(k * 1.7)));
      rows.push({ start: x, end: x + P, mean: v, min: v * (1 - 0.1 * w), max: v * (1 + 0.12 * w) });
    }
    out[id] = rows;
  }
  return out;
}

// logbook/get_events: armed two hours ago by the first user, disarmed an hour ago by the second
export const logbook = (m) => [
  { when: Date.now() / 1000 - 7200, state: 'armed_away', entity_id: m.entity_ids[0], context_user_id: 'u1' },
  { when: Date.now() / 1000 - 3600, state: 'disarmed', entity_id: m.entity_ids[0], context_user_id: 'u2' }];

// /api/calendars/<entity>: the same five events for every calendar, from today on
export function calendarEvents() {
  const d = new Date();
  const at = (hour, days, summary) => { const x = new Date(d); x.setDate(x.getDate() + days); x.setHours(hour, 0, 0, 0);
    return { summary, start: { dateTime: x.toISOString() }, end: { dateTime: new Date(+x + 3600e3).toISOString() } }; };
  const day = (n) => new Date(+d + n * 864e5).toISOString().slice(0, 10);
  return [at(23, 0, 'Book club'), at(9, 1, 'Recycling pickup'), { summary: 'Long weekend', start: { date: day(2) }, end: { date: day(3) } }, at(16, 2, 'Dentist'), at(18, 4, 'Dinner with friends')];
}

// weather.get_forecasts: 30 hours, 6 days, or 14 half-days
export function forecast(type) {
  if (type === 'hourly') return Array.from({ length: 30 }, (_, i) => ({ datetime: new Date(Date.now() + i * 3600e3).toISOString(), temperature: 62 + 8 * Math.sin(i / 5),
    precipitation_probability: i > 12 && i < 20 ? 60 : 0, condition: 'partlycloudy' }));
  if (type === 'twice_daily') {
    const cond = ['sunny', 'partlycloudy', 'cloudy', 'rainy', 'lightning-rainy', 'sunny', 'partlycloudy'], rain = [0, 10, 20, 70, 60, 0, 10];
    return Array.from({ length: 14 }, (_, i) => { const dt = new Date(Date.now() + Math.floor(i / 2) * 864e5); dt.setHours(i % 2 ? 18 : 6);
      return { datetime: dt.toISOString(), is_daytime: !(i % 2), temperature: i % 2 ? 50 + i : 70 - i, condition: cond[Math.floor(i / 2)], precipitation_probability: rain[Math.floor(i / 2)],
        short_description: i % 2 ? 'Mostly clear' : 'Partly sunny',
        detailed_description: i % 2 ? 'Mostly clear, with a low around 50. North wind 3 to 7 mph.' : 'Partly sunny, with a high near 70. Light north wind.' }; });
  }
  return ['sunny', 'partlycloudy', 'cloudy', 'rainy', 'lightning-rainy', 'sunny'].map((c, i) => ({ datetime: new Date(Date.now() + i * 864e5).toISOString(), temperature: 72 - i, templow: 55 + i,
    condition: c, precipitation_probability: c.includes('rain') ? 70 : 0 }));
}
