// Fluid UI scale (--s). Every size in tokens.css is "px * var(--s)", so this one number sizes the whole dashboard.
//   phone:   fixed (tokens.css profile value). Phones only span ~360-450 px and touch targets should stay the same size.
//   others:  follow the screen, sized off the tighter of width/1280 and height/800 (the Portal is the reference,
//            so it stays exactly 1), eased by half and kept between 0.9 and 1.25; the tablet profile keeps its 1.12 boost.
//   ?s=1.1   forces a value on any screen.
const REF_W = 1280, REF_H = 800, MIN = 0.9, MAX = 1.25, EASE = 0.5;
const BOOST = { tablet: 1.12 };

export function fluidScale(profile, forced) {
  const root = document.documentElement;
  if (forced) { root.style.setProperty('--s', String(forced)); return; }
  if (profile === 'phone') return;
  const set = () => {
    const r = Math.min(innerWidth / REF_W, innerHeight / REF_H);
    const s = Math.min(MAX, Math.max(MIN, 1 + (r - 1) * EASE)) * (BOOST[profile] || 1);
    root.style.setProperty('--s', s.toFixed(3));
  };
  set();
  let t = 0;
  addEventListener('resize', () => { cancelAnimationFrame(t); t = requestAnimationFrame(set); });
}
