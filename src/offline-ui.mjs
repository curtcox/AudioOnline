import { OfflineClient } from '../vendor/fragment-kit-v0.3.5/src/index.js';
const status = document.getElementById('offline-status'), action = document.getElementById('offline-action');
const repair = document.createElement('button'); repair.id = 'offline-repair'; repair.textContent = 'Repair offline copy'; document.getElementById('extra-tools')?.append(repair);
let updating = false;
const client = new OfflineClient({ timeout:180000, onStatus(value) {
  status.textContent = value.unsupported ? 'Offline unavailable' : value.ready ? 'Available offline' : 'Offline setup incomplete';
  action.hidden = value.ready || value.unsupported; action.textContent = 'Repair offline copy';
}, onUpdate() { updating = true; status.textContent = 'Offline update ready'; action.hidden = false; action.textContent = 'Update and reload'; } });
action.onclick = async () => {
  try { if (updating) { window.dispatchEvent(new Event('offline-before-reload')); navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); client.activateUpdate(); }
    else { await client.update(); await client.repair(); } }
  catch { status.textContent = 'Offline setup incomplete'; action.hidden = false; }
};
repair.onclick = async () => { try { await client.repair(); } catch { status.textContent = 'Offline setup incomplete'; } };
client.init().catch(() => { status.textContent = 'Offline setup incomplete'; action.hidden = false; });
