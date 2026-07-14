const els = {
  list: document.querySelector('#hosts-list'),
  status: document.querySelector('#status'),
  openStudio: document.querySelector('#open-studio'),
  refresh: document.querySelector('#refresh')
};

const I18N = window.I18N || {
  t: (key) => key,
  setLang: () => {},
  applyStatic: () => {}
};

function t(key, vars) {
  return I18N.t(key, vars);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setStatus(message, isError = false) {
  els.status.textContent = message || '';
  els.status.classList.toggle('is-error', Boolean(isError));
}

function renderProjects(projects) {
  if (!projects.length) {
    els.list.innerHTML = `<div class="empty">${t('tray.noProjects')}</div>`;
    return;
  }

  els.list.innerHTML = projects.map((project) => {
    const enabled = Boolean(project.hosts);
    const label = t('tray.toggleHost', {
      domain: project.domain,
      state: enabled ? t('pill.on') : t('pill.off')
    });
    return `
      <button class="host-row${enabled ? ' is-on' : ''}" type="button" role="switch" aria-checked="${enabled ? 'true' : 'false'}" aria-label="${escapeHtml(label)}" data-domain="${escapeHtml(project.domain)}" data-enabled="${enabled ? 'true' : 'false'}">
        <span class="doc-icon" aria-hidden="true"></span>
        <span class="domain">${escapeHtml(project.domain)}</span>
        <span class="switch" aria-hidden="true"></span>
      </button>
    `;
  }).join('');
}

async function loadProjects() {
  els.list.innerHTML = `<div class="loading">${t('tray.loading')}</div>`;
  setStatus('');
  const result = await window.api.tray.listHostProjects();
  if (!result.success) {
    els.list.innerHTML = `<div class="empty">${t('tray.loadFailed')}</div>`;
    setStatus(result.message || t('tray.loadFailed'), true);
    return;
  }
  renderProjects(result.projects || []);
}

async function toggleProject(row) {
  const domain = row.dataset.domain;
  const enabled = row.dataset.enabled !== 'true';
  row.classList.add('is-busy');
  setStatus(t(enabled ? 'tray.enabling' : 'tray.disabling', { domain }));

  const result = await window.api.tray.setProjectHost(domain, enabled);
  if (!result.success) {
    row.classList.remove('is-busy');
    setStatus(result.message || t('tray.updateFailed'), true);
    return;
  }

  setStatus(t(enabled ? 'tray.enabled' : 'tray.disabled', { domain }));
  await loadProjects();
}

els.list.addEventListener('click', (event) => {
  const row = event.target.closest('[data-domain]');
  if (!row || row.classList.contains('is-busy')) return;
  toggleProject(row).catch((error) => {
    setStatus(error.message || String(error), true);
    loadProjects().catch(() => {});
  });
});

els.refresh.addEventListener('click', () => {
  loadProjects().catch((error) => setStatus(error.message || String(error), true));
});

els.openStudio.addEventListener('click', async () => {
  await window.api.tray.openStudio();
  await window.api.tray.hide();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.api.tray.hide();
  }
});

if (window.api.tray.onShow) {
  window.api.tray.onShow(() => {
    boot().catch((error) => setStatus(error.message || String(error), true));
  });
}

async function boot() {
  if (window.api.settings && typeof window.api.settings.get === 'function') {
    const result = await window.api.settings.get();
    if (result.success && result.settings) {
      I18N.setLang(result.settings.language || 'de');
    }
  }
  I18N.applyStatic(document);
  await loadProjects();
}

boot().catch((error) => setStatus(error.message || String(error), true));
