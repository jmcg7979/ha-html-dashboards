// The example site's fake Home Assistant data for engine/_dev/mock/server.mjs. Every value is made up.
// Exports: S = entity states { id: { s: state, a: attributes } }; user = the signed-in name; onCall (optional) = what a service call changes here.
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const ahead = (min) => new Date(Date.now() + min * 60000).toISOString();
const off = (...ids) => Object.fromEntries(ids.map((id) => [id, { s: 'off' }]));
const on = (...ids) => Object.fromEntries(ids.map((id) => [id, { s: 'on' }]));
const vals = (o) => Object.fromEntries(Object.entries(o).map(([id, v]) => [id, { s: String(v) }]));
const prefix = (p, o) => vals(Object.fromEntries(Object.entries(o).map(([k, v]) => [p + k, v])));

export const S = {
  // people
  'person.alex': { s: 'home', a: { friendly_name: 'Alex', user_id: 'u1', entity_picture: '/local/dash/assets/people/alex.svg', latitude: 39.05, longitude: -95.68, gps_accuracy: 20 } },
  'person.sam': { s: 'not_home', a: { friendly_name: 'Sam', user_id: 'u2', entity_picture: '/local/dash/assets/people/sam.svg', latitude: 39.03, longitude: -95.7, gps_accuracy: 30 } },
  ...vals({ 'sensor.alex_phone_battery_level': 72, 'sensor.alex_phone_battery_state': 'discharging', 'sensor.sam_phone_battery_level': 41, 'sensor.sam_phone_battery_state': 'charging' }),

  // security
  'alarm_control_panel.alarmo': { s: 'disarmed', a: { changed_by: 'Alex' } },
  ...off('binary_sensor.front_door_sensor', 'binary_sensor.living_room_left_window', 'binary_sensor.living_room_right_window', 'binary_sensor.bedroom_window'),
  ...on('binary_sensor.back_door_sensor', 'binary_sensor.kitchen_window'),
  ...vals({ 'sensor.siren_battery_level': 88, 'sensor.open_doors': 1, 'sensor.open_windows': 1, 'lock.front_door': 'locked', 'cover.garage_door': 'closed' }),

  // climate
  'climate.living_room': { s: 'heat_cool', a: { current_temperature: 70, target_temp_low: 68, target_temp_high: 74, hvac_action: 'idle', min_temp: 45, max_temp: 92, current_humidity: 46, fan_modes: ['on', 'auto'], fan_mode: 'auto', hvac_modes: ['off', 'heat', 'cool', 'heat_cool'] } },
  'climate.bedroom': { s: 'heat_cool', a: { current_temperature: 67, target_temp_low: 68, target_temp_high: 74, hvac_action: 'heating', min_temp: 45, max_temp: 92, current_humidity: 44, fan_modes: ['on', 'auto'], fan_mode: 'auto', hvac_modes: ['off', 'heat', 'cool', 'heat_cool'] } },
  ...vals({ 'sensor.living_room_humidity': 46, 'sensor.bedroom_humidity': 44 }),

  // lights
  'light.kitchen': { s: 'on', a: { brightness: 180 } },
  'light.living_room': { s: 'on', a: { brightness: 90 } },
  'light.bedroom': { s: 'off' },
  'light.accent_strip': { s: 'on', a: { rgb_color: [120, 90, 255], brightness: 180, effect: 'Solid', effect_list: ['Solid', 'Rainbow', 'Breathe'] } },

  // cameras (the mock streams its test video to all of them)
  ...Object.fromEntries(['front_doorbell', 'back_yard', 'driveway', 'printer'].flatMap((c) => [
    [`camera.${c}`, { s: 'recording', a: { entity_picture: `/api/camera_proxy/camera.${c}?token=x` } }], [`sensor.${c}_review_status`, { s: 'NONE' }]])),

  // vacuum
  'vacuum.robot': { s: 'docked', a: { fan_speed: 'balanced', fan_speed_list: ['quiet', 'balanced', 'turbo', 'max'] } },
  'image.robot_map': { s: ago(30), a: { entity_picture: '/pic.png' } },
  'input_boolean.vacuum_schedule': { s: 'on' },
  'input_datetime.vacuum_morning': { s: '09:00:00', a: { has_date: false, has_time: true } },
  'sensor.robot_battery': { s: '100' },

  // timers
  'timer.voice_timer_1': { s: 'active', a: { finishes_at: ahead(4), duration: '0:05:00' } },
  'input_text.voice_timer_1_label': { s: 'Pasta' },
  'input_text.voice_timer_last_ended': { s: JSON.stringify({ l: '10 minutes', t: Date.now() - 3600e3 }) },
  ...off('input_boolean.voice_timer_ringing'),

  // media
  'media_player.living_room_tv': { s: 'playing', a: { media_title: 'A Show About Nothing Much', app_name: 'YouTube', entity_picture: '/pic.png', volume_level: 0.3 } },
  'media_player.living_room_tv_remote': { s: 'on', a: { app_name: 'YouTube' } },
  'remote.living_room_tv': { s: 'on' },
  'media_player.kitchen_speaker': { s: 'playing', a: { media_title: 'Example Song', media_artist: 'The Placeholders', entity_picture: '/pic.png', volume_level: 0.4 } },

  // weather
  'sun.sun': { s: 'above_horizon', a: { elevation: 34, next_rising: ahead(900), next_setting: ahead(300) } },
  'weather.forecast_home': { s: 'partlycloudy', a: { temperature: 68, apparent_temperature: 66, humidity: 48, wind_speed: 7, wind_speed_unit: 'mph' } },
  'weather.home_nws': { s: 'sunny', a: { temperature: 66, humidity: 50, pressure: 30.1, pressure_unit: 'inHg', wind_bearing: 200, wind_speed: 8, visibility: 10, visibility_unit: 'mi' } },
  'sensor.nws_alerts': { s: '0', a: { Alerts: [] } },
  'sensor.outdoor_temperature': { s: '66.2', a: { condition: 'partlycloudy', humidity: 50, dew_point: 47, wind_speed: 8, wind_bearing: 200, wind_gust_speed: null, pressure: 30.1, visibility: 10, source: 'metar', source_name: 'Example station', observed: ago(12) } },

  // calendars (their events: the mock's /api/calendars)
  'calendar.family': { s: 'off', a: { friendly_name: 'Family' } },

  // 3D printer
  ...prefix('sensor.printer_', { print_status: 'running', current_stage: 'printing', print_progress: 42, remaining_time: 1.6, end_time: ahead(96), task_name: 'Benchy', current_layer: 84, total_layer_count: 200, print_weight: 18.4, print_length: 6.1, ams_humidity: 22, ams_temperature: 24, ams_drying_left: 0 }),
  ...on('binary_sensor.printer_online'),
  ...vals({ 'button.printer_pause': 'unknown', 'button.printer_resume': 'unknown', 'button.printer_stop': 'unknown' }),
  ...off('binary_sensor.printer_door', 'binary_sensor.printer_ams_drying', 'binary_sensor.printer_external_spool_active', 'light.printer_chamber', 'input_boolean.printer_save_job', 'input_boolean.printer_job_saved'),
  'image.printer_cover': { s: ago(60), a: { entity_picture: '/pic.png' } },
  'input_datetime.printer_job_started': { s: ago(70) }, 'input_datetime.printer_job_ended': { s: ago(1500) }, 'input_text.printer_job_name': { s: 'Benchy' },
  'sensor.printer_ams_tray_1': { s: 'Bambu PLA Basic', a: { type: 'PLA', color: '#2E7D32FF', active: true, remain: 64 } },
  'sensor.printer_ams_tray_2': { s: 'Bambu PLA Basic', a: { type: 'PLA', color: '#F5F5F5FF', active: false, remain: 80 } },
  'sensor.printer_ams_tray_3': { s: 'Generic PETG', a: { type: 'PETG', color: '#1565C0FF', active: false, remain: -1 } },
  'sensor.printer_ams_tray_4': { s: 'Empty', a: { type: 'Empty', empty: true } },
  'sensor.printer_external_spool': { s: 'Generic TPU', a: { type: 'TPU', color: '#000000FF', active: false } },

  // Systems: router and access points
  ...prefix('sensor.router_', { uptime: ago(60 * 24 * 12), cpu_temperature: 142, memory_usage: 48, load_avg_15m: 0.32, connected_clients: 34, wan_status: 'Up', wan_download_rate: 2.4e6, wan_upload_rate: 3.1e5, wan_total_download: 8.4e11, wan_total_upload: 1.2e11 }),
  'update.router_firmware': { s: 'off', a: { installed_version: '4.1.0' } },
  ...Object.assign({}, ...[['upstairs', 14, 2.5], ['downstairs', 20, 1.4]].map(([k, c, cpu]) => ({
    ...prefix(`sensor.${k}_ap_`, { state: 'connected', uptime: ago(60 * 24 * 30), cpu_utilization: cpu, clients: c }), [`update.${k}_ap_firmware`]: { s: 'off', a: { installed_version: '6.7.0' } } }))),

  // Systems: NAS
  ...prefix('sensor.nas_', { cpu_utilization: 7, memory_usage: 31, volume_used: 62, uptime: ago(60 * 24 * 40), volume_status: 'normal' }),
  'update.nas_firmware': { s: 'on', a: { installed_version: '7.2', latest_version: '7.3' } },
  ...Object.assign({}, ...[1, 2, 3, 4].map((n) => ({ ...vals({ [`sensor.nas_drive_${n}_status`]: 'normal', [`sensor.nas_drive_${n}_temperature`]: 118 + n * 2 }),
    ...off(`binary_sensor.nas_drive_${n}_bad_sectors`, `binary_sensor.nas_drive_${n}_remaining_life`) }))),

  // Systems: Proxmox (the mock's button.press handler plays a VM restart on these ids)
  ...prefix('sensor.proxmox_', { status: 'online', uptime: ago(60 * 24 * 21), cpu_usage: 14, memory_usage_percentage: 71, max_memory_usage: 64, disk_temperature: 104, disk_wearout: 3, disk_power_on_hours: 9120, agent_cpu_temperature: 118, agent_board_temperature: 102, agent_system_updates_count: 0,
    storage_local_storage_usage_percentage: 22, storage_local_used_storage: 21, storage_local_total_storage: 94, storage_local_lvm_storage_usage_percentage: 38, storage_local_lvm_used_storage: 180, storage_local_lvm_total_storage: 470,
    haos_status: 'running', haos_uptime: ago(60 * 24 * 7), haos_cpu_usage: 12, haos_memory_usage_percentage: 60, haos_max_memory_usage: 8,
    ubuntu_status: 'running', ubuntu_uptime: ago(60 * 24 * 7), ubuntu_cpu_usage: 22, ubuntu_memory_usage_percentage: 68, ubuntu_max_memory_usage: 16, ubuntu_os_state: 'running' }),
  ...on('binary_sensor.proxmox_agent_online', 'binary_sensor.ubuntu_agent_online', 'binary_sensor.docker_host_status'),
  ...off('binary_sensor.proxmox_agent_required_restart', 'binary_sensor.ubuntu_agent_required_restart', 'binary_sensor.proxmox_disk_health'),
  ...prefix('sensor.system_monitor_', { processor_use: 11, memory_usage: 52, disk_usage: 34, disk_use: 11, disk_free: 21, network_throughput_in_eth0: 0.3, network_throughput_out_eth0: 0.5 }),
  ...prefix('sensor.ubuntu_', { server_cpu_usage: 19, server_memory_usage: 58, server_disk_usage: 41, server_disk_used: 82, server_disk_size: 200, server_eth0_rx: 34.6, server_eth0_tx: 12.2, server_total: 212, server_containers_cpu_usage: 42, server_containers_memory_used: 3200, agent_system_updates_count: 3 }),

  // Systems: Docker
  ...prefix('sensor.docker_host_', { containers_running: 4, containers_stopped: 0, image_count: 6, image_disk_usage_total_size: 9800, image_disk_usage_reclaimable: 1200, total_memory: 16000 }),
  'sensor.glances_container_network': { s: 'ok', a: { containers: { frigate: { in: 34.2, out: 2.1 }, glances: { in: 0.1, out: 0.4 }, mosquitto: { in: 0.2, out: 0.2 }, portainer: { in: 0.01, out: 0.02 } } } },
  ...Object.assign({}, ...[['frigate', 88, 34, 2800, 'blakeblackshear/frigate:stable', '0.16'], ['glances', 1.2, 2.5, 110, 'nicolargo/glances:latest', '4.5'], ['mosquitto', 0.3, 0.4, 30, 'eclipse-mosquitto:2', '2.0'], ['portainer', 0.1, 0.9, 40, 'portainer/portainer-ce:latest', '2.33']].map(([k, cpu, mem, mb, image, version]) => ({
    ...prefix(`sensor.${k}_container_`, { state: 'running', health: 'healthy', started: ago(60 * 24 * 7), cpu_usage: cpu, memory_usage_percentage: mem, memory_usage: mb, restart_count: 0, image, image_version: version }),
    ...on(`binary_sensor.${k}_container_status`, `switch.${k}_container`), ...off(`binary_sensor.${k}_container_out_of_memory`, `update.${k}_container_image_update`) }))),

  // Home Assistant's own updates and backups
  'sensor.backup_last_successful_automatic_backup': { s: ago(340) }, 'sensor.backup_next_scheduled_automatic_backup': { s: ahead(1100) },
  'update.home_assistant_core_update': { s: 'on', a: { installed_version: '2026.10.2', latest_version: '2026.10.3' } },
  ...off('update.home_assistant_operating_system_update', 'update.mosquitto_broker_update', 'update.get_hacs_update'),
};
// things the dashboards press or run: buttons, scripts, the idle timer slots, Music Assistant's players
for (const c of ['frigate', 'glances', 'mosquitto', 'portainer']) S[`button.${c}_container_restart`] = { s: 'unknown' };
for (const v of ['haos', 'ubuntu']) for (const a of ['restart', 'shut_down', 'start']) S[`button.proxmox_${v}_${a}`] = { s: 'unknown' };
for (const n of [2, 3, 4]) { S[`timer.voice_timer_${n}`] = { s: 'idle' }; S[`input_text.voice_timer_${n}_label`] = { s: '' }; }
Object.assign(S, off('script.voice_timer_start', 'script.alarm_disarm', 'script.printer_save_job'));
for (const m of ['living_room_tv', 'kitchen_speaker']) S[`media_player.${m}_ma`] = { s: 'idle' };

const now = Date.now() / 1000;
for (const k in S) { S[k].a = S[k].a || {}; S[k].lc = S[k].lc || now - 3600; }

export const user = 'Alex';
