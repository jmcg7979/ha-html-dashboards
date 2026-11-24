// Sizes and rates as text: plain functions on numbers. NaN (no reading) is '–', never 0.
// Binary or decimal follows what the sensor counts in, and the label is GB / TB either way: HA's Proxmox VE, System Monitor
// and LNXlink sensors are GiB and the Docker host's are MiB (gb, MIB_GB); Portainer's container memory is MB (mb).
// gigabytes in (binary steps): '0.5 GB', '12 GB', '1.5 TB'
export const gb = (v) => (isNaN(v) ? '–' : v >= 1024 ? (v / 1024).toFixed(1) + ' TB' : v.toFixed(v < 10 ? 1 : 0) + ' GB');
// gigabytes in (decimal steps, for a sensor that is bytes / 1e9, like a site's own backup-folder size): '301 GB', '2.25 TB'
export const gbDec = (v) => (isNaN(v) ? '–' : v >= 1000 ? (v / 1000).toFixed(2) + ' TB' : Math.round(v) + ' GB');
// megabytes in: '512 MB', '1.5 GB'
export const mb = (v) => (isNaN(v) ? '–' : v >= 1000 ? (v / 1000).toFixed(1) + ' GB' : Math.round(v) + ' MB');
// a rate in Mbit/s: '0.4 Mbit/s', '12 Mbit/s', '940 Mbit/s'
export const mbit = (v) => (isNaN(v) ? '–' : (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1)) + ' Mbit/s');
// a figure with one decimal while it is under 10: '4.2', '42'
export const fmt1 = (v) => (isNaN(v) ? '–' : v >= 10 ? String(Math.round(v)) : v.toFixed(1));
// bytes in (decimal steps): '640 kB', '12 MB', '1.5 GB', '2.25 TB'
export const bytes = (v) => (isNaN(v) ? '–' : v >= 1e12 ? (v / 1e12).toFixed(2) + ' TB' : v >= 1e9 ? (v / 1e9).toFixed(1) + ' GB' : v >= 1e6 ? Math.round(v / 1e6) + ' MB' : Math.round(v / 1e3) + ' kB');
// MiB to GB, for a figure whose unit is written next to it and for the scale a chart is given
export const MIB_GB = 1 / 1024;
export const mibGb = (v) => (isNaN(v) ? '–' : (v * MIB_GB).toFixed(1));
// what follows a number: '%' and degrees touch it ('42%', '71°'), any other unit comes after a space ('12 Mbit/s').
// letter: keep the letter of a degree unit ('250°C': a reading in another unit than the site's, like a printer's)
export const unitTag = (u, letter) => { const t = (u || '').trim(); return !t ? '' : t === '%' ? '%' : t[0] === '°' ? (letter ? t : '°') : ' ' + t; };
