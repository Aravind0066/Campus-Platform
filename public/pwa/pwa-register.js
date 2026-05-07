(function () {
  const PWA_STORAGE_KEY = 'campus-pwa-install-dismissed';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
  let deferredPrompt = null;
  let installChip = null;
  let installTitle = null;
  let installText = null;
  let installButton = null;
  let networkChip = null;

  function markDismissed() {
    try {
      localStorage.setItem(PWA_STORAGE_KEY, 'true');
    } catch (err) {
      // Ignore storage failures.
    }
  }

  function wasDismissed() {
    try {
      return localStorage.getItem(PWA_STORAGE_KEY) === 'true';
    } catch (err) {
      return false;
    }
  }

  function ensureUi() {
    if (installChip) return;

    installChip = document.createElement('aside');
    installChip.className = 'pwa-install-chip';
    installChip.setAttribute('data-visible', 'false');
    installChip.innerHTML = `
      <div class="pwa-install-copy">
        <div class="pwa-install-title">Install Campus Intelligence</div>
        <div class="pwa-install-text">Add this app to your phone for a fullscreen campus demo.</div>
      </div>
      <button type="button">Install</button>
    `;

    installTitle = installChip.querySelector('.pwa-install-title');
    installText = installChip.querySelector('.pwa-install-text');
    installButton = installChip.querySelector('button');
    installButton.addEventListener('click', handleInstallClick);

    networkChip = document.createElement('div');
    networkChip.className = 'pwa-network-chip';
    networkChip.setAttribute('data-visible', 'false');

    document.body.appendChild(installChip);
    document.body.appendChild(networkChip);
  }

  function showInstallChip(config) {
    ensureUi();
    if (standalone || wasDismissed()) return;
    installTitle.textContent = config.title;
    installText.textContent = config.text;
    installButton.textContent = config.button;
    installButton.disabled = Boolean(config.disabled);
    installChip.setAttribute('data-visible', 'true');
  }

  function hideInstallChip() {
    if (!installChip) return;
    installChip.setAttribute('data-visible', 'false');
  }

  function updateNetworkChip() {
    ensureUi();
    if (navigator.onLine) {
      networkChip.textContent = 'Online';
      networkChip.setAttribute('data-state', 'online');
      networkChip.setAttribute('data-visible', 'false');
    } else {
      networkChip.textContent = 'Offline mode';
      networkChip.setAttribute('data-state', 'offline');
      networkChip.setAttribute('data-visible', 'true');
    }
  }

  async function handleInstallClick() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        hideInstallChip();
        markDismissed();
      }
      deferredPrompt = null;
      return;
    }

    if (isIos) {
      showInstallChip({
        title: 'Add to Home Screen',
        text: 'On iPhone, open Share and choose "Add to Home Screen" for the demo app shortcut.',
        button: 'Shown above',
        disabled: true
      });
      return;
    }

    showInstallChip({
      title: 'Install not ready yet',
      text: 'Keep using the site once in Chrome or Edge and the install prompt should appear automatically.',
      button: 'Okay',
      disabled: true
    });

    window.setTimeout(() => {
      hideInstallChip();
    }, 2800);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {
        // Ignore registration failures in unsupported contexts.
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureUi();
    updateNetworkChip();

    if (isIos && !standalone && !wasDismissed()) {
      showInstallChip({
        title: 'Install on iPhone',
        text: 'Use Share -> Add to Home Screen to pin this campus demo like a native app.',
        button: 'How to'
      });
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallChip({
      title: 'Install Campus Intelligence',
      text: 'Add the platform to your phone for a smoother fullscreen demo.',
      button: 'Install'
    });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallChip();
    markDismissed();
  });

  window.addEventListener('online', updateNetworkChip);
  window.addEventListener('offline', updateNetworkChip);

  registerServiceWorker();
})();
