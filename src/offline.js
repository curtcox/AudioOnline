/** Only promise offline access after the complete precache is confirmed. */
(async () => {
  const status = document.getElementById('offline-status'), button = document.getElementById('offline-action');
  if (!('serviceWorker' in navigator)) { status.textContent = 'Offline unavailable'; return; }
  let registration, reloading = false, controlled = Boolean(navigator.serviceWorker.controller);
  function failed() { status.textContent = 'Offline setup incomplete'; button.textContent = 'Retry offline setup'; button.hidden = false; }
  function updateReady() { status.textContent = 'Offline update ready'; button.textContent = 'Update and reload'; button.hidden = false; }
  async function check(type = 'offline-status') {
    if (registration?.waiting) { updateReady(); return; }
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    const channel = new MessageChannel();
    return new Promise(resolve => {
      const timer = setTimeout(() => { channel.port1.close(); failed(); resolve(); }, 15000);
      channel.port1.onmessage = ({ data }) => { clearTimeout(timer); channel.port1.close();
        if (data.ready) { status.textContent = 'Available offline'; button.hidden = true; } else failed(); resolve(); };
      worker.postMessage({ type }, [channel.port2]);
    });
  }
  function watch(worker) {
    if (!worker) return;
    status.textContent = 'Saving for offline use…';
    worker.addEventListener('statechange', () => {
      if (worker.state === 'redundant') failed();
      if (worker.state === 'installed' && navigator.serviceWorker.controller) updateReady();
      if (worker.state === 'activated') check();
    });
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled || reloading) { window.dispatchEvent(new Event('offline-before-reload')); location.reload(); }
    else { controlled = true; check(); }
  });
  async function register() {
    registration = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
    registration.addEventListener('updatefound', () => watch(registration.installing)); watch(registration.installing);
    if (registration.waiting) updateReady();
    if (!navigator.serviceWorker.controller && !registration.installing && registration.active) check();
  }
  button.onclick = async () => {
    button.hidden = true;
    if (registration?.waiting) { reloading = true; registration.waiting.postMessage({ type: 'activate-update' }); }
    else { status.textContent = 'Saving for offline use…'; try { await register(); await registration.update(); await check('repair-offline'); } catch (_) { failed(); } }
  };
  try { await register(); await check(); } catch (_) { failed(); }
})();
