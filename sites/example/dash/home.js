// The example site: every entity id the dashboards use, in one place. Dashboards pick from here instead of repeating ids.
// Everything is made up and played by the mock (sites/example/mock/states.mjs). Edit this file and dashboards/ for your own hardware.
const person = (key, name) => ({ entity: `person.${key}`, name,
  devices: [{ battery: `sensor.${key}_phone_battery_level`, charging: `sensor.${key}_phone_battery_state`, icon: 'cellphone' }] });
// optional: temperature 'F' or 'C' (what your sensors report), clock '12h' or '24h' (engine/core/units.js)
export const units = { temperature: 'F', clock: '12h' };

export const people = { alex: person('alex', 'Alex'), sam: person('sam', 'Sam') };

export const security = {
  alarm: 'alarm_control_panel.alarmo',
  siren_battery: 'sensor.siren_battery_level',
  entry_doors: { 'binary_sensor.front_door_sensor': 'Front', 'binary_sensor.back_door_sensor': 'Back' },
  open_doors: 'sensor.open_doors',
  open_windows: 'sensor.open_windows',
  lock: 'lock.front_door',
  garage: 'cover.garage_door',
  household: ['person.alex', 'person.sam'],
  disarm: { call: 'script.alarm_disarm', target: null },
  window_floors: [
    { name: 'Downstairs', rooms: [
      { name: 'Living Room', icon: 'sofa-outline', windows: { 'binary_sensor.living_room_left_window': 'Left', 'binary_sensor.living_room_right_window': 'Right' } },
      { name: 'Kitchen', icon: 'stove', windows: { 'binary_sensor.kitchen_window': 'Sink' } },
    ] },
    { name: 'Upstairs', rooms: [{ name: 'Bedroom', icon: 'bed-outline', windows: { 'binary_sensor.bedroom_window': 'Front' } }] },
  ],
};

export const climate = [
  { entity: 'climate.living_room', name: 'Living Room', humidity: 'sensor.living_room_humidity' },
  { entity: 'climate.bedroom', name: 'Bedroom', humidity: 'sensor.bedroom_humidity' },
];

export const lights = {
  kitchen: { entity: 'light.kitchen', name: 'Kitchen', icon: 'ceiling-light' },
  living_room: { entity: 'light.living_room', name: 'Living Room', icon: 'lamp' },
  bedroom: { entity: 'light.bedroom', name: 'Bedroom', icon: 'lamp' },
  accent: { entity: 'light.accent_strip', name: 'Accent strip', icon: 'led-strip-variant' },
};

// stream / fullStream: Frigate's go2rtc stream names. fit, ratio: cards/camera-wall.js
export const cameras = [
  { entity: 'camera.front_doorbell', name: 'Front Door', stream: 'front_doorbell_sub', fullStream: 'front_doorbell', ratio: '4/3' },
  { entity: 'camera.back_yard', name: 'Back Yard', stream: 'back_yard_sub', fullStream: 'back_yard', ratio: '16/9' },
  { entity: 'camera.driveway', name: 'Driveway', stream: 'driveway_sub', fullStream: 'driveway', ratio: '16/9' },
];

export const vacuum = {
  entity: 'vacuum.robot', battery: 'sensor.robot_battery', map: 'image.robot_map',
  schedule: 'input_boolean.vacuum_schedule', morning: 'input_datetime.vacuum_morning',
  areas: [['kitchen', 'Kitchen'], ['living_room', 'Living Room'], ['bedroom', 'Bedroom']],
};

export const timers = { count: 4, prefix: 'voice_timer', ringing: 'input_boolean.voice_timer_ringing', last: 'input_text.voice_timer_last_ended' };

export const players = [
  { entity: 'media_player.living_room_tv', name: 'Living Room TV', power: 'media_player.living_room_tv_remote', remote: 'remote.living_room_tv' },
  { entity: 'media_player.kitchen_speaker', name: 'Kitchen Speaker' },
];
export const playTargets = [{ entity: 'media_player.kitchen_speaker_ma', name: 'Kitchen', icon: 'speaker' }];
export const tvApps = [{ name: 'YouTube', pkg: 'com.google.android.youtube.tv' }];

export const weather = 'weather.forecast_home';
// US National Weather Service. The cards and radar read home's location from HA after sign-in, so it stays out of this file (see README, Security). iem: { station, network, name } adds an airport's METAR as a source (core/current.js).
export const nws = { entity: 'weather.home_nws', alerts: 'sensor.nws_alerts', now: 'sensor.outdoor_temperature' };
// CARTO's base maps need a browser key of your own: the radar's map stays blank without one.
export const carto_key = '';
export const map_tiles = { provider: 'carto', style: 'voyager', key: carto_key };   // person maps, cards/map.js lists the providers

export const calendars = [
  { entity: 'calendar.family', name: 'Family', tone: 'mist', color: '#4fc3f7' },
];

// Bambu Lab printer (ha-bambulab integration)
const bp = (s) => `sensor.printer_${s}`, bb = (s) => `binary_sensor.printer_${s}`;
export const printer = {
  name: 'Printer', icon: 'printer-3d',
  status: bp('print_status'), stage: bp('current_stage'), progress: bp('print_progress'), remaining: bp('remaining_time'), end: bp('end_time'),
  task: bp('task_name'), layer: bp('current_layer'), layers: bp('total_layer_count'), weight: bp('print_weight'), length: bp('print_length'),
  online: bb('online'), door: bb('door'), cover: 'image.printer_cover', light: 'light.printer_chamber',
  camera: { entity: 'camera.printer', name: 'Printer', stream: 'printer', fullStream: 'printer', fit: 'contain', ratio: '16/9' },
  controls: { pause: 'button.printer_pause', resume: 'button.printer_resume', stop: 'button.printer_stop' },   // appear only when the entities exist
  rec: { save: 'input_boolean.printer_save_job', saved: 'input_boolean.printer_job_saved', started: 'input_datetime.printer_job_started', ended: 'input_datetime.printer_job_ended',
    name: 'input_text.printer_job_name', script: 'script.printer_save_job', buffer_days: 7, frigate: '', media: null },
  ams: { name: 'AMS', letter: 'A', humidity: bp('ams_humidity'), temp: bp('ams_temperature'), drying: bb('ams_drying'), drying_left: bp('ams_drying_left'),
    humid: { warn: 35, crit: 50 }, trays: [1, 2, 3, 4].map((n) => bp(`ams_tray_${n}`)) },
  external: { entity: bp('external_spool'), active: bb('external_spool_active') },
};

// ---- Systems: what dashboards/systems.js shows. Limits are [attention, problem]. ----
const rt = (x) => `sensor.router_${x}`;
const vm = (v) => ({ ...v, power: { restart: `button.proxmox_${v.p}_restart`, shut_down: `button.proxmox_${v.p}_shut_down`, start: `button.proxmox_${v.p}_start` },
  status: `sensor.proxmox_${v.p}_status`, up: `sensor.proxmox_${v.p}_uptime`, cpu: `sensor.proxmox_${v.p}_cpu_usage`, mem: `sensor.proxmox_${v.p}_memory_usage_percentage`, ram: `sensor.proxmox_${v.p}_max_memory_usage` });
// A real site finds containers in HA's registries: containers: cachedContainers() from core/discover.js. Listed by hand here, as the mock has no registries.
const container = (cname, name, opts = {}) => { const c = (x) => `sensor.${cname}_container_${x}`; return { cname, name, p: cname, controls: true, ...opts,
  state: c('state'), health: c('health'), started: c('started'), cpu: c('cpu_usage'), mem: c('memory_usage_percentage'), mem_mb: c('memory_usage'), restarts: c('restart_count'), image: c('image'), version: c('image_version'),
  status: `binary_sensor.${cname}_container_status`, oom: `binary_sensor.${cname}_container_out_of_memory`, power: `switch.${cname}_container`, restart: `button.${cname}_container_restart`, update: `update.${cname}_container_image_update` }; };
const ap = (key, name) => ({ name, state: `sensor.${key}_ap_state`, up: `sensor.${key}_ap_uptime`, cpu: `sensor.${key}_ap_cpu_utilization`, fw: `update.${key}_ap_firmware`, clients: `sensor.${key}_ap_clients` });
export const systems = {
  network: {
    router: { up: rt('uptime'), temp: rt('cpu_temperature'), mem: rt('memory_usage'), load: rt('load_avg_15m'), fw: 'update.router_firmware', clients: rt('connected_clients'),
      limits: { mem: [85, 95], temp: [176, 194] }, temp_range: [80, 200] },
    // scale = B/s to Mbit/s; dial = what the gauges run up to; floor = smallest span a trace is drawn over
    wan: { status: rt('wan_status'), down: rt('wan_download_rate'), up: rt('wan_upload_rate'), total_down: rt('wan_total_download'), total_up: rt('wan_total_upload'), scale: 8e-6, dial: { down: 1000, up: 1000 }, floor: { down: 5, up: 2 } },
    aps: [ap('upstairs', 'Upstairs'), ap('downstairs', 'Downstairs')],
  },
  nas: {
    cpu: 'sensor.nas_cpu_utilization', mem: 'sensor.nas_memory_usage', vol: 'sensor.nas_volume_used', up: 'sensor.nas_uptime', status: 'sensor.nas_volume_status', fw: 'update.nas_firmware',
    drives: [1, 2, 3, 4].map((n) => ({ name: `Drive ${n}`, status: `sensor.nas_drive_${n}_status`, temp: `sensor.nas_drive_${n}_temperature`,
      bad: `binary_sensor.nas_drive_${n}_bad_sectors`, life: `binary_sensor.nas_drive_${n}_remaining_life` })),
  },
  proxmox: {
    status: 'sensor.proxmox_status', up: 'sensor.proxmox_uptime', cpu: 'sensor.proxmox_cpu_usage', mem: 'sensor.proxmox_memory_usage_percentage', mem_total: 'sensor.proxmox_max_memory_usage',
    backup: null,   // a sensor with the last backup's time; null shows "Not set up"
    updates: 'sensor.proxmox_agent_system_updates_count', restart: 'binary_sensor.proxmox_agent_required_restart', agent: 'binary_sensor.proxmox_agent_online',
    temps: { cpu: 'sensor.proxmox_agent_cpu_temperature', disk: 'sensor.proxmox_disk_temperature', board: 'sensor.proxmox_agent_board_temperature' },
    limits: { cpu: [194, 212], disk: [140, 158], board: [185, 203] },
    drive: { health: 'binary_sensor.proxmox_disk_health', wear: 'sensor.proxmox_disk_wearout', hours: 'sensor.proxmox_disk_power_on_hours' },
    storage: [
      { name: 'System disk', pct: 'sensor.proxmox_storage_local_storage_usage_percentage', used: 'sensor.proxmox_storage_local_used_storage', total: 'sensor.proxmox_storage_local_total_storage' },
      { name: 'VM storage', pct: 'sensor.proxmox_storage_local_lvm_storage_usage_percentage', used: 'sensor.proxmox_storage_local_lvm_used_storage', total: 'sensor.proxmox_storage_local_lvm_total_storage' },
    ],
    vms: [
      vm({ name: 'Home Assistant', p: 'haos', icon: 'home-assistant', self: true, impact: 'Home Assistant, its automations and these dashboards stop until it is back.',
        guest: { cpu: 'sensor.system_monitor_processor_use', mem: 'sensor.system_monitor_memory_usage', disk: 'sensor.system_monitor_disk_usage', disk_used: 'sensor.system_monitor_disk_use', disk_free: 'sensor.system_monitor_disk_free',
          net_in: ['sensor.system_monitor_network_throughput_in_eth0'], net_out: ['sensor.system_monitor_network_throughput_out_eth0'] } }),
      vm({ name: 'Ubuntu (Docker)', p: 'ubuntu', icon: 'ubuntu', os: 'sensor.proxmox_ubuntu_os_state', impact: 'Every Docker container stops.',
        guest: { cpu: 'sensor.ubuntu_server_cpu_usage', mem: 'sensor.ubuntu_server_memory_usage', disk: 'sensor.ubuntu_server_disk_usage', disk_used: 'sensor.ubuntu_server_disk_used', disk_size: 'sensor.ubuntu_server_disk_size',
          net_in: ['sensor.ubuntu_server_eth0_rx'], net_out: ['sensor.ubuntu_server_eth0_tx'], rx: 'sensor.ubuntu_server_eth0_rx', tx: 'sensor.ubuntu_server_eth0_tx',
          procs: 'sensor.ubuntu_server_total', updates: 'sensor.ubuntu_agent_system_updates_count', reboot: 'binary_sensor.ubuntu_agent_required_restart', agent: 'binary_sensor.ubuntu_agent_online' } }),
    ],
  },
  docker: {
    cores: 4,   // Portainer reports container CPU per core
    impact: { frigate: 'Cameras and recordings stop while it is down.', mosquitto: 'Everything on MQTT drops while it is down.' },
    status: 'binary_sensor.docker_host_status', running: 'sensor.docker_host_containers_running', stopped: 'sensor.docker_host_containers_stopped',
    images: 'sensor.docker_host_image_count', image_size: 'sensor.docker_host_image_disk_usage_total_size', reclaim: 'sensor.docker_host_image_disk_usage_reclaimable',
    cpu: 'sensor.ubuntu_server_containers_cpu_usage', mem_used: 'sensor.ubuntu_server_containers_memory_used', mem_total: 'sensor.docker_host_total_memory',
    glances: 'sensor.glances_container_network',   // attributes.containers: { <name>: { in, out } }, Mbit/s
    containers: [container('frigate', 'Frigate'), container('glances', 'Glances'), container('mosquitto', 'Mosquitto'), container('portainer', 'Portainer', { controls: false })],
  },
  ha: {
    backup_last: 'sensor.backup_last_successful_automatic_backup', backup_next: 'sensor.backup_next_scheduled_automatic_backup',
    updates: [['Home Assistant', 'update.home_assistant_core_update'], ['HA OS', 'update.home_assistant_operating_system_update'], ['Mosquitto', 'update.mosquitto_broker_update'], ['HACS', 'update.get_hacs_update']],
  },
};
