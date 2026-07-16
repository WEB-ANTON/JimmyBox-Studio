const state = {
  settings: null,
  projects: [],
  cmsAdapters: [],
  checkpoints: [],
  checkpointDomain: '',
  teamProjects: [],
  teamUsers: [],
  hostsModel: null,
  exportDbName: null,
  phpVersions: [],
  teamMe: null,
  vmState: 'missing',
  reservationGuard: {
    running: false,
    autoPushing: new Set(),
    lastHeartbeat: new Map(),
    expiryNotifications: new Set()
  }
};

const els = {
  vmStatus: document.querySelector('#vm-status'),
  hubStatus: document.querySelector('#hub-status'),
  vmStart: document.querySelector('#vm-start'),
  vmStop: document.querySelector('#vm-stop'),
  vmProvision: document.querySelector('#vm-provision'),
  teamTabButton: document.querySelector('#team-tab-button'),
  teamStatus: document.querySelector('#team-status'),
  teamProjectsList: document.querySelector('#team-projects-list'),
  teamOnboarding: document.querySelector('#team-onboarding'),
  teamInviteString: document.querySelector('#team-invite-string'),
  teamApplyInvite: document.querySelector('#team-apply-invite'),
  teamWizardRow: document.querySelector('#team-wizard-row'),
  teamWizardProject: document.querySelector('#team-wizard-project'),
  teamWizardCheckout: document.querySelector('#team-wizard-checkout'),
  activity: document.querySelector('#activity'),
  activitySummary: document.querySelector('#activity-summary'),
  activityIcon: document.querySelector('#activity-icon'),
  activityTitle: document.querySelector('#activity-title'),
  activityCount: document.querySelector('#activity-count'),
  activitySteps: document.querySelector('#activity-steps'),
  activityDismiss: document.querySelector('#activity-dismiss'),
  teamAdminPanel: document.querySelector('#team-admin-panel'),
  teamAdminUsers: document.querySelector('#team-admin-users'),
  teamAdminProjects: document.querySelector('#team-admin-projects'),
  teamRefreshAdmin: document.querySelector('#team-refresh-admin'),
  teamCreateUser: document.querySelector('#team-create-user'),
  newUserName: document.querySelector('#new-user-name'),
  newUserRole: document.querySelector('#new-user-role'),
  newUserResult: document.querySelector('#new-user-result'),
  refreshTeam: document.querySelector('#refresh-team'),
  testTeam: document.querySelector('#test-team'),
  projectsList: document.querySelector('#projects-list'),
  projectForm: document.querySelector('#project-form'),
  projectDomain: document.querySelector('#project-domain'),
  projectPhp: document.querySelector('#project-php'),
  projectPhpHint: document.querySelector('#project-php-hint'),
  importDomain: document.querySelector('#import-domain'),
  importPhp: document.querySelector('#import-php'),
  importArchive: document.querySelector('#import-archive'),
  importDump: document.querySelector('#import-dump'),
  importPickArchive: document.querySelector('#import-pick-archive'),
  importPickDump: document.querySelector('#import-pick-dump'),
  importRun: document.querySelector('#import-run'),
  projectCms: document.querySelector('#project-cms'),
  projectDb: document.querySelector('#project-db'),
  projectPlugins: document.querySelector('#project-plugins'),
  projectPluginsRow: document.querySelector('#project-plugins-row'),
  checkpointDomain: document.querySelector('#checkpoint-domain'),
  checkpointRefresh: document.querySelector('#checkpoint-refresh'),
  checkpointCreate: document.querySelector('#checkpoint-create'),
  checkpointA: document.querySelector('#checkpoint-a'),
  checkpointB: document.querySelector('#checkpoint-b'),
  checkpointCompare: document.querySelector('#checkpoint-compare'),
  checkpointList: document.querySelector('#checkpoint-list'),
  checkpointDiff: document.querySelector('#checkpoint-diff'),
  dbList: document.querySelector('#db-list'),
  dbForm: document.querySelector('#db-form'),
  dbName: document.querySelector('#db-name'),
  dbImportForm: document.querySelector('#db-import-form'),
  dbImportName: document.querySelector('#db-import-name'),
  dbImportCreate: document.querySelector('#db-import-create'),
  dbExportForm: document.querySelector('#db-export-form'),
  dbExportTitle: document.querySelector('#db-export-title'),
  dbExportContent: document.querySelector('#db-export-content'),
  dbExportCharset: document.querySelector('#db-export-charset'),
  dbExportTableMode: document.querySelector('#db-export-table-mode'),
  dbExportTables: document.querySelector('#db-export-tables'),
  dbExportDrop: document.querySelector('#db-export-drop'),
  dbExportRoutines: document.querySelector('#db-export-routines'),
  dbExportTriggers: document.querySelector('#db-export-triggers'),
  dbExportEvents: document.querySelector('#db-export-events'),
  dbExportTransaction: document.querySelector('#db-export-transaction'),
  dbExportExtended: document.querySelector('#db-export-extended'),
  dbExportComplete: document.querySelector('#db-export-complete'),
  dbExportHex: document.querySelector('#db-export-hex'),
  dbExportGzip: document.querySelector('#db-export-gzip'),
  hostsGroups: document.querySelector('#hosts-groups'),
  hostsRemotes: document.querySelector('#hosts-remotes'),
  hostsGroupForm: document.querySelector('#hosts-group-form'),
  hostsGroupName: document.querySelector('#hosts-group-name'),
  hostsRemoteForm: document.querySelector('#hosts-remote-form'),
  hostsRemoteName: document.querySelector('#hosts-remote-name'),
  hostsRemoteUrl: document.querySelector('#hosts-remote-url'),
  applyHosts: document.querySelector('#apply-hosts'),
  settingsForm: document.querySelector('#settings-form'),
  settingsLanguage: document.querySelector('#settings-language'),
  settingsSitesPath: document.querySelector('#settings-sites-path'),
  settingsBasePlugins: document.querySelector('#settings-base-plugins'),
  settingsDefaultPhp: document.querySelector('#settings-default-php'),
  browseDb: document.querySelector('#browse-db'),
  browseRefreshTables: document.querySelector('#browse-refresh-tables'),
  browseTables: document.querySelector('#browse-tables'),
  browseSql: document.querySelector('#browse-sql'),
  browseRun: document.querySelector('#browse-run'),
  browseResults: document.querySelector('#browse-results'),
  phpInstalled: document.querySelector('#php-installed'),
  phpInstallInput: document.querySelector('#php-install-version'),
  phpInstallBtn: document.querySelector('#php-install-btn'),
  stackStrip: document.querySelector('#stack-strip'),
  settingsCpus: document.querySelector('#settings-cpus'),
  settingsMemory: document.querySelector('#settings-memory'),
  applyResourcesBtn: document.querySelector('#apply-resources-btn'),
  settingsTeamMode: document.querySelector('#settings-team-mode'),
  settingsTeamHubUrl: document.querySelector('#settings-team-hub-url'),
  settingsTeamToken: document.querySelector('#settings-team-token'),
  settingsTeamUserName: document.querySelector('#settings-team-user-name'),
  settingsTeamTunnelEnabled: document.querySelector('#settings-team-tunnel-enabled'),
  settingsTeamTunnelAutoStart: document.querySelector('#settings-team-tunnel-auto-start'),
  settingsTeamTunnelUser: document.querySelector('#settings-team-tunnel-user'),
  settingsTeamTunnelHost: document.querySelector('#settings-team-tunnel-host'),
  settingsTeamTunnelLocalPort: document.querySelector('#settings-team-tunnel-local-port'),
  settingsTeamTunnelSshPort: document.querySelector('#settings-team-tunnel-ssh-port'),
  settingsTeamTunnelRemoteHost: document.querySelector('#settings-team-tunnel-remote-host'),
  settingsTeamTunnelRemotePort: document.querySelector('#settings-team-tunnel-remote-port'),
  settingsTeamTunnelIdentityFile: document.querySelector('#settings-team-tunnel-identity-file'),
  teamTunnelStart: document.querySelector('#team-tunnel-start'),
  teamTunnelStop: document.querySelector('#team-tunnel-stop'),
  teamTunnelStatus: document.querySelector('#team-tunnel-status')
};

const currentStatus = {
  title: '',
  steps: [],
  running: false,
  ok: true
};

const activityRecords = [];
const RESERVATION_TTL_MINUTES = 5 * 24 * 60;
const RESERVATION_CHECK_MS = 60000;
const RESERVATION_HEARTBEAT_THRESHOLD_MS = 30 * 60 * 1000;
const RESERVATION_NOTIFY_THRESHOLD_MS = 30 * 60 * 1000;
const RESERVATION_HEARTBEAT_MIN_MS = 5 * 60 * 1000;
const RESERVATION_EXPIRED_GRACE_MS = 30 * 1000;

const I18N = window.I18N || {
  t: (key) => key,
  setLang: () => {},
  getLang: () => 'en',
  applyStatic: () => {}
};

function t(key, vars) {
  return I18N.t(key, vars);
}

function resultMessage(result, fallback) {
  if (!result) return fallback;
  return result.message || fallback;
}

function confirmDelete(label) {
  return confirm(t('confirm.deleteReally', { item: label || t('common.delete') }));
}

function hasTeamApi() {
  return Boolean(window.api && window.api.team);
}

function isTeamEnabled() {
  return false;
}

async function withBusy(button, action) {
  const buttons = button ? [button] : Array.from(document.querySelectorAll('button'));
  const previous = buttons.map((item) => ({ item, disabled: item.disabled }));
  buttons.forEach((item) => {
    item.disabled = true;
  });
  try {
    return await action();
  } finally {
    previous.forEach(({ item, disabled }) => {
      item.disabled = disabled;
    });
  }
}

function renderVmStatus(stateName) {
  const label = stateName || 'missing';
  state.vmState = label;
  els.vmStatus.textContent = t(`vmState.${label}`);
  els.vmStatus.setAttribute('aria-label', t('vm.statusLabel', { state: t(`vmState.${label}`) }));
  els.vmStatus.classList.toggle('is-muted', label === 'missing');
  els.vmStatus.classList.toggle('is-stopped', label === 'stopped');
  els.vmStart.title = t('vm.startHelp');
  els.vmStop.title = t('vm.stopHelp');
  els.vmProvision.title = t('vm.provisionHelp');
}

function renderHubStatus(stateName, title = '') {
  if (!els.hubStatus) return;
  const stateMap = {
    off: t('hub.off'),
    checking: t('hub.checking'),
    connected: t('hub.connected'),
    offline: t('hub.offline')
  };
  const stateValue = stateMap[stateName] ? stateName : 'off';
  els.hubStatus.textContent = stateMap[stateValue];
  els.hubStatus.title = title || stateMap[stateValue];
  els.hubStatus.classList.toggle('is-muted', stateValue === 'off' || stateValue === 'checking');
  els.hubStatus.classList.toggle('is-stopped', stateValue === 'checking');
  els.hubStatus.classList.toggle('is-danger', stateValue === 'offline');
}

async function refreshVmStatus() {
  const result = await window.api.vm.status();
  if (!result.success) {
    renderVmStatus('missing');
    setMessage(result.message, true);
    return;
  }
  renderVmStatus(result.state);
}

function renderProjects(projects) {
  if (!projects.length) {
    els.projectsList.innerHTML = `<tr><td colspan="7" class="muted">${t('proj.none')}</td></tr>`;
    return;
  }

  els.projectsList.innerHTML = projects.map((project) => {
    const hostsPill = project.hosts ? `<span class="pill on">${t('pill.on')}</span>` : `<span class="pill off">${t('pill.off')}</span>`;
    const enabled = project.enabled === null || project.enabled === undefined
      ? '<span class="muted">—</span>'
      : (project.enabled ? `<span class="pill on">${t('pill.on')}</span>` : `<span class="pill off">${t('pill.off')}</span>`);
    const phpOptions = state.phpVersions.length
      ? state.phpVersions.map((v) => `<option value="${escapeHtml(v)}"${v === project.phpVersion ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')
      : `<option selected>${escapeHtml(project.phpVersion || '—')}</option>`;
    return `
      <tr>
        <td class="cell-domain">${escapeHtml(project.domain)}</td>
        <td>${escapeHtml(project.cms || 'plain')}</td>
        <td><select class="php-inline" data-php-domain="${escapeHtml(project.domain)}"${state.phpVersions.length ? '' : ' disabled'}>${phpOptions}</select></td>
        <td>${escapeHtml(project.database || '—')}</td>
        <td>${hostsPill}</td>
        <td>${enabled}</td>
        <td>
          <button type="button" data-open="${escapeHtml(project.domain)}">${t('common.open')}</button>
          ${isTeamEnabled() ? `<button type="button" data-team-push-project="${escapeHtml(project.domain)}">Push</button>` : ''}
          <button type="button" class="link-danger" data-delete-project="${escapeHtml(project.domain)}" data-project-db="${escapeHtml(project.database || '')}">${t('common.delete')}</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderCheckpointDomainOptions() {
  if (!els.checkpointDomain) return;
  const current = state.checkpointDomain || els.checkpointDomain.value;
  els.checkpointDomain.innerHTML = (state.projects || [])
    .map((project) => `<option value="${escapeHtml(project.domain)}">${escapeHtml(project.domain)}</option>`)
    .join('');
  if ((state.projects || []).some((project) => project.domain === current)) {
    els.checkpointDomain.value = current;
  }
  state.checkpointDomain = els.checkpointDomain.value || '';
}

function renderCheckpointSelects() {
  const options = state.checkpoints.map((checkpoint) => (
    `<option value="${escapeHtml(checkpoint.id)}">${escapeHtml(new Date(checkpoint.createdAt).toLocaleString())} · ${escapeHtml(checkpoint.message)}</option>`
  )).join('');
  els.checkpointA.innerHTML = options;
  els.checkpointB.innerHTML = options;
  if (state.checkpoints[1]) els.checkpointB.value = state.checkpoints[1].id;
}

function renderCheckpoints() {
  renderCheckpointSelects();
  if (!state.checkpointDomain) {
    els.checkpointList.innerHTML = `<p class="muted">${t('history.noProject')}</p>`;
    return;
  }
  if (!state.checkpoints.length) {
    els.checkpointList.innerHTML = `<p class="muted">${t('history.none')}</p>`;
    return;
  }

  els.checkpointList.innerHTML = state.checkpoints.map((checkpoint) => {
    const git = checkpoint.git && checkpoint.git.commit ? `${checkpoint.git.commit.slice(0, 8)} · ${checkpoint.git.branch || 'detached'}` : 'no git';
    const dbSize = checkpoint.database && checkpoint.database.size ? `${Math.round(checkpoint.database.size / 1024)} KB` : 'DB';
    return `
      <div class="checkpoint-item">
        <div>
          <strong>${escapeHtml(checkpoint.message)}</strong>
          <span class="muted small">${escapeHtml(checkpoint.author || '')} · ${escapeHtml(new Date(checkpoint.createdAt).toLocaleString())}</span>
          <div class="checkpoint-badges">
            <span class="chip">${escapeHtml(git)}</span>
            <span class="chip">${escapeHtml(dbSize)}</span>
            ${checkpoint.git && checkpoint.git.dirty ? `<span class="chip warn">${t('history.dirty')}</span>` : ''}
            ${checkpoint.pinned ? `<span class="chip">${t('history.pinned')}</span>` : ''}
          </div>
        </div>
        <div class="checkpoint-actions">
          <button type="button" data-restore-checkpoint="${escapeHtml(checkpoint.id)}">${t('history.restore')}</button>
          <button type="button" data-pin-checkpoint="${escapeHtml(checkpoint.id)}">${checkpoint.pinned ? t('history.unpin') : t('history.pin')}</button>
          <button type="button" class="link-danger" data-delete-checkpoint="${escapeHtml(checkpoint.id)}">${t('common.delete')}</button>
        </div>
      </div>
    `;
  }).join('');
}

async function refreshCheckpoints() {
  renderCheckpointDomainOptions();
  if (!state.checkpointDomain) {
    state.checkpoints = [];
    renderCheckpoints();
    return;
  }
  const result = await window.api.checkpoints.list(state.checkpointDomain);
  if (!result.success) {
    setMessage(result.message, true);
    return;
  }
  state.checkpoints = result.checkpoints || [];
  renderCheckpoints();
}

function renderCheckpointDiff(result) {
  if (!result.success) {
    els.checkpointDiff.innerHTML = `<p class="danger">${escapeHtml(result.message)}</p>`;
    return;
  }
  const schema = result.schema.length
    ? result.schema.map((item) => `<li><strong>${escapeHtml(item.table)}</strong> ${escapeHtml(item.state)}</li>`).join('')
    : `<li>${t('history.noSchemaDiff')}</li>`;
  const data = result.data.length
    ? result.data.map((item) => `<li><strong>${escapeHtml(item.table)}</strong> ${escapeHtml(item.state)} ${escapeHtml(item.rowsBefore || 0)} → ${escapeHtml(item.rowsAfter || 0)}</li>`).join('')
    : `<li>${t('history.noDataDiff')}</li>`;
  els.checkpointDiff.innerHTML = `
    <div class="diff-grid">
      <div>
        <h3>Code</h3>
        <pre>${escapeHtml(result.code.nameStatus || result.code.patch || t('history.noCodeDiff'))}</pre>
      </div>
      <div>
        <h3>Schema</h3>
        <ul>${schema}</ul>
      </div>
      <div>
        <h3>Data</h3>
        <ul>${data}</ul>
      </div>
    </div>
  `;
}

async function refreshProjects() {
  const result = await window.api.projects.list();
  if (!result.success) {
    setMessage(result.message, true);
    return;
  }
  state.projects = result.projects || [];
  renderProjects(state.projects);
  renderCheckpointDomainOptions();
  renderTeamOnboarding();
  if (state.teamProjects) renderTeamProjects(state.teamProjects);
}

function updateTeamVisibility() {
  const enabled = isTeamEnabled();
  if (els.teamTabButton) els.teamTabButton.hidden = true;

  if (!enabled) {
    state.teamMe = null;
    state.teamProjects = [];
    state.teamUsers = [];
    renderHubStatus('off', t('team.disabled'));
    if (els.teamStatus) els.teamStatus.textContent = t('team.disabled');
    renderTeamOnboarding();
    if (els.teamAdminPanel) els.teamAdminPanel.hidden = true;
    if (els.teamProjectsList) els.teamProjectsList.innerHTML = `<tr><td colspan="5" class="muted">${t('team.disabled')}</td></tr>`;
    return;
  }

  renderTeamOnboarding();
}

function lockLabel(project) {
  const lock = project.lock;
  if (!lock) return `<span class="pill off">${t('pill.free')}</span>`;
  if (lock.state === 'stale') return `<span class="pill off">${t('pill.stale')}</span>`;
  const mine = state.teamMe && lock.holderUserId === state.teamMe.id;
  return `<span class="pill ${mine ? 'on' : 'off'}">${mine ? t('pill.yours') : escapeHtml(lock.holderName)}</span>`;
}

function memberVisibleProject(project) {
  if (!state.teamMe || state.teamMe.role === 'admin') return true;
  const members = Array.isArray(project.members) ? project.members : [];
  return !members.length || members.some((member) => member.userId === state.teamMe.id);
}

function localProjectFor(domain) {
  return (state.projects || []).find((project) => project.domain === domain) || null;
}

function teamProjectPills(project) {
  const pills = [];
  const local = localProjectFor(project.domain);
  if (project.lock && project.lock.state === 'active') {
    const mine = state.teamMe && project.lock.holderUserId === state.teamMe.id;
    pills.push(`<span class="pill ${mine ? 'on' : 'off'}">${mine ? t('pill.yours') : escapeHtml(project.lock.holderName)}</span>`);
  } else {
    pills.push(`<span class="pill on">${t('pill.available')}</span>`);
  }
  if (local) {
    const remoteRevision = project.revision && project.revision.id ? project.revision.id : '';
    const behind = remoteRevision && local.teamRevisionId !== remoteRevision;
    pills.push(`<span class="pill ${behind ? 'warn' : 'on'}">${behind ? t('pill.behind') : t('pill.local')}</span>`);
  }
  return `<div class="pill-row">${pills.join('')}</div>`;
}

function setupSummaryHtml(summary) {
  if (!summary) return `<span class="muted small">${t('team.noSetup')}</span>`;
  const bits = [];
  if (summary.hostsCount) bits.push(escapeHtml(t('team.hostsCount', { n: summary.hostsCount })));
  if (summary.routineCount) bits.push(escapeHtml(t('team.routinesCount', { n: summary.routineCount })));
  if (summary.stagingUrl) bits.push(`<button type="button" class="inline-link" data-open-staging="${escapeHtml(summary.stagingUrl)}">Staging</button>`);
  return bits.length ? `<span class="muted small">${bits.join(' · ')}</span>` : `<span class="muted small">${t('team.noSetup')}</span>`;
}

function visibleTeamProjects(projects) {
  return (projects || []).filter(memberVisibleProject);
}

function setActivityExpanded(expanded) {
  els.activitySteps.hidden = !expanded;
  els.activitySummary.setAttribute('aria-expanded', String(expanded));
  els.activity.classList.toggle('is-open', expanded);
}

function activityStats(steps, running, ok) {
  const list = Array.isArray(steps) ? steps : [];
  const failed = list.filter((step) => step && step.success === false);
  const skipped = list.filter((step) => step && step.skipped && step.success !== false);
  const okCount = list.length - failed.length - skipped.length;
  return {
    list,
    failed,
    skipped,
    okCount,
    success: running ? false : (ok !== undefined ? ok : failed.length === 0)
  };
}

function upsertActivityRecord(record) {
  const index = activityRecords.findIndex((item) => item.id === record.id);
  if (index !== -1) activityRecords.splice(index, 1);
  activityRecords.unshift(record);
  activityRecords.splice(8);
}

function activityCountText(record) {
  if (!record) return '';
  if (record.running) return t('activity.running');
  if (!record.steps.length) return activityRecords.length > 1 ? t('activity.recordsN', { n: activityRecords.length }) : '';
  let count = `${record.okCount}/${record.steps.length}`;
  if (record.failed.length) count += ` · ${t('activity.failedN', { n: record.failed.length })}`;
  else if (record.skipped.length) count += ` · ${t('activity.skippedN', { n: record.skipped.length })}`;
  if (activityRecords.length > 1) count += ` · ${t('activity.recordsN', { n: activityRecords.length })}`;
  return count;
}

// A running step reads "Läuft… <task>" — the prefix carries the "in progress"
// meaning, so trailing dots/ellipsis on the task text are stripped.
function runningLabel(title) {
  const clean = String(title || '').replace(/\s*[.…]+\s*$/, '').trim();
  return clean ? `${t('activity.running')} ${clean}` : t('activity.running');
}

function activityStepHtml(step) {
  const state = step.success === false ? 'is-bad' : (step.skipped ? 'is-skip' : 'is-ok');
  const icon = step.success === false ? '✗' : (step.skipped ? '–' : '✓');
  const showMsg = (step.success === false || step.skipped) && step.message;
  const detail = showMsg ? `<span class="activity-step-msg">${escapeHtml(step.message)}</span>` : '';
  return `<li class="${state}"><span class="activity-step-icon" aria-hidden="true">${icon}</span><span class="activity-step-name">${escapeHtml(step.name || '')}</span>${detail}</li>`;
}

function renderActivitySteps(emptyText) {
  if (!activityRecords.length) {
    els.activitySteps.innerHTML = `<li class="is-ok"><span class="activity-step-name">${escapeHtml(emptyText || t('activity.empty'))}</span></li>`;
    return;
  }

  const rows = [];
  for (const record of activityRecords) {
    const state = record.running ? 'is-skip' : (record.success ? 'is-ok' : 'is-bad');
    const icon = record.running ? '' : (record.success ? '✓' : '✗');
    const recordName = record.running ? runningLabel(record.title) : (record.title || t('activity.empty'));
    rows.push(`<li class="${state}"><span class="activity-step-icon" aria-hidden="true">${icon}</span><span class="activity-step-name">${escapeHtml(recordName)}</span></li>`);
    if (record.steps.length) {
      rows.push(...record.steps.map((step) => activityStepHtml({
        ...step,
        name: `  ${step.name || ''}`
      })));
    }
  }
  els.activitySteps.innerHTML = rows.join('');
}

function setStatus({ id = '', title = '', steps = [], running = false, ok, emptyText } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const stats = activityStats(list, running, ok);
  const success = stats.success;

  currentStatus.title = title || '';
  currentStatus.steps = list;
  currentStatus.running = Boolean(running);
  currentStatus.ok = Boolean(success);

  const record = {
    id: id || title || t('activity.empty'),
    title: title || t('activity.empty'),
    steps: list,
    running: Boolean(running),
    success: Boolean(success),
    failed: stats.failed,
    skipped: stats.skipped,
    okCount: stats.okCount,
    updatedAt: Date.now()
  };
  upsertActivityRecord(record);

  els.activity.hidden = false;
  els.activity.classList.toggle('is-running', running);
  els.activity.classList.toggle('is-ok', !running && success);
  els.activity.classList.toggle('is-bad', !running && !success);

  els.activityIcon.textContent = running ? '' : (success ? '✓' : '✗');
  els.activityTitle.textContent = running ? runningLabel(title) : (title || t('activity.empty'));
  els.activityCount.textContent = running ? '' : activityCountText(record);
  renderActivitySteps(emptyText || title);

  // Expand automatically when something failed so the reason is visible; keep a
  // clean successful run collapsed. The user can toggle either way.
  setActivityExpanded(!running && !success);
}

function setMessage(message, isError = false) {
  setStatus({
    title: message || t('activity.empty'),
    steps: [],
    running: false,
    ok: !isError
  });
}

// Show a running indicator so the user knows something is in progress (e.g.
// "Restoring checkpoint…" with a spinner). Call setMessage or showActivity
// afterwards to set the final result.
function setRunning(message) {
  setStatus({
    title: message,
    steps: [],
    running: true
  });
}

// Dismiss the activity bar entirely so it disappears from the UI.
function clearStatus() {
  els.activity.hidden = true;
  activityRecords.length = 0;
  currentStatus.title = '';
  currentStatus.steps = [];
  currentStatus.running = false;
  currentStatus.ok = true;
}

// One concise, collapsible activity line. Shows an overall pass/fail summary;
// per-step detail is collapsed by default and only carries a message for the
// steps that failed or were skipped (successful steps stay a single tick).
function showActivity(title, steps, opts = {}) {
  setStatus({
    id: opts.id || title,
    title,
    steps,
    running: Boolean(opts.running),
    ok: opts.success,
    emptyText: opts.emptyText
  });
}

// Concise one-line status plus collapsible step detail when available.
function reportSteps(title, result, fallbackMessage) {
  const statusTitle = resultMessage(result, fallbackMessage || title);
  if (result && Array.isArray(result.steps) && result.steps.length) {
    showActivity(statusTitle, result.steps, { id: title, success: result.success });
  } else {
    setMessage(statusTitle, !(result && result.success));
  }
}

function setupCommandsForProject(project) {
  const commands = project && project.setupSummary && Array.isArray(project.setupSummary.commands)
    ? project.setupSummary.commands
    : [];
  return commands.filter((command) => command && command.key);
}

function isAutoSetupCommand(command) {
  const text = `${command.name || ''} ${command.command || ''} ${command.key || ''}`.toLowerCase();
  const compact = text.replace(/[^a-z0-9]+/g, '');
  return compact.includes('cacheflush') ||
    compact.includes('flushcache') ||
    compact.includes('cacheclear') ||
    compact.includes('clearcache') ||
    compact.includes('cacherebuild') ||
    compact.includes('rebuildcache');
}

function confirmSetupCommands(project) {
  const commands = setupCommandsForProject(project);
  if (!commands.length) return [];
  const automatic = commands.filter(isAutoSetupCommand);
  const manual = commands.filter((command) => !isAutoSetupCommand(command));
  if (!manual.length) return automatic.map((command) => command.key);
  const lines = manual.map((command) => `  •  ${command.name}`).join('\n');
  return confirm(t('confirm.setupCommands', { domain: project.domain, commands: lines }))
    ? [...automatic, ...manual].map((command) => command.key)
    : automatic.map((command) => command.key);
}

async function checkoutAndStart(domain, button) {
  const project = state.teamProjects.find((item) => item.domain === domain) || { domain };
  const confirmedCommands = confirmSetupCommands(project);
  return withBusy(button, async () => {
    setRunning(t('msg.checkoutStart', { domain }));
    showActivity(t('activity.checkout', { domain }), [], { running: true });
    const result = await window.api.team.checkout(domain, { confirmedCommands });
    showActivity(resultMessage(result, t('fb.checkoutStarted', { domain })), result.steps || [], { success: result.success });
    if (result.success) {
      await Promise.all([refreshTeamProjects(), refreshProjects(), refreshHosts()]);
      const opened = await window.api.projects.open(domain);
      if (!opened.success) setMessage(opened.message, true);
    } else {
      await refreshTeamProjects();
    }
    return result;
  });
}

// Hand a reserved project back in one step: push code, database and media, then
// release the reservation. Stops at the first failing push so a conflict never
// releases the lock with unsynced work still local.
async function teamPushAndRelease(domain) {
  const activityId = `push-release-${domain}`;
  const title = t('activity.pushRelease', { domain });
  const steps = [];
  showActivity(title, steps, { id: activityId, running: true });

  const stages = [
    { name: 'project', run: () => window.api.team.pushProject(domain) },
    { name: 'database', run: () => window.api.team.pushDatabase(domain) },
    { name: 'media', run: () => window.api.team.pushMedia(domain) }
  ];

  const appendSteps = (name, result) => {
    if (Array.isArray(result.steps) && result.steps.length) steps.push(...result.steps);
    else steps.push({ name, success: result.success, message: result.message });
  };

  for (const stage of stages) {
    const result = await stage.run();
    appendSteps(stage.name, result);
    if (!result.success) {
      showActivity(resultMessage(result, title), steps, { id: activityId, success: false });
      await refreshTeamProjects();
      return result;
    }
  }

  const released = await window.api.team.release(domain);
  appendSteps('release', released);
  showActivity(resultMessage(released, t('fb.pushReleased', { domain })), steps, { id: activityId, success: released.success });
  await Promise.all([refreshTeamProjects(), refreshProjects(), refreshHosts()]);
  return released;
}

function renderTeamProjects(projects) {
  if (!isTeamEnabled()) {
    updateTeamVisibility();
    return;
  }

  const visibleProjects = visibleTeamProjects(projects);
  if (!projects.length) {
    els.teamProjectsList.innerHTML = `<tr><td colspan="5" class="muted">${t('team.none')}</td></tr>`;
    return;
  }
  if (!visibleProjects.length) {
    els.teamProjectsList.innerHTML = `<tr><td colspan="5" class="muted">${t('team.noneForYou')}</td></tr>`;
    return;
  }

  els.teamProjectsList.innerHTML = visibleProjects.map((project) => {
    const domain = escapeHtml(project.domain);
    const lock = project.lock;
    const mine = lock && lock.state === 'active' && state.teamMe && lock.holderUserId === state.teamMe.id;
    const blocked = lock && lock.state === 'active' && !mine;
    const revision = project.revision
      ? `<br><span class="muted small">${t('team.revision', { when: new Date(project.revision.pushedAt).toLocaleString() })}</span>`
      : `<br><span class="muted small">${t('team.noRevision')}</span>`;
    const syncActions = mine
      ? `<button type="button" data-team-pull-db="${domain}">${t('team.pullDb')}</button>
         <button type="button" data-team-push-db="${domain}">${t('team.pushDb')}</button>
         <button type="button" data-team-pull-media="${domain}">${t('team.pullMedia')}</button>
         <button type="button" data-team-push-media="${domain}">${t('team.pushMedia')}</button>`
      : '';
    const actions = mine
      ? `<div class="team-actions">
           <button type="button" class="primary" data-team-push-release="${domain}">${t('team.pushRelease')}</button>
           <button type="button" data-team-heartbeat="${domain}">${t('team.heartbeat')}</button>
           ${syncActions}
         </div>`
      : `<button type="button" class="primary" data-team-checkout="${domain}"${blocked ? ' disabled' : ''}>${t('team.checkoutStart')}</button>`;

    return `
      <tr>
        <td class="cell-domain">${domain}<br>${setupSummaryHtml(project.setupSummary)}</td>
        <td>${escapeHtml(project.phpVersion || '—')}</td>
        <td>${escapeHtml(project.database || '—')}${revision}</td>
        <td>${teamProjectPills(project)}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('');
}

async function refreshTeamStatus(showMessage = false) {
  if (!isTeamEnabled()) {
    updateTeamVisibility();
    if (showMessage) setMessage(t('team.applyInviteToConnect'), true);
    return { success: true, enabled: false };
  }

  // Check in the background without flipping the pill to a transient "checking"
  // state — it keeps its last connected/not-connected value until we know more.
  const tunnel = await ensureTeamTunnel();
  if (!tunnel.success) {
    state.teamMe = null;
    renderHubStatus('offline', tunnel.message || t('team.tunnelFail'));
    els.teamStatus.textContent = tunnel.message || t('team.tunnelFail');
    if (showMessage) setMessage(els.teamStatus.textContent, true);
    return tunnel;
  }

  const result = await window.api.team.status();
  if (!result.success) {
    state.teamMe = null;
    renderHubStatus('offline', result.message || t('team.unavailable'));
    els.teamStatus.textContent = result.message || t('team.unavailable');
    if (showMessage) setMessage(result.message, true);
    return result;
  }

  state.teamMe = result.user || null;
  renderHubStatus(
    result.enabled ? 'connected' : 'off',
    result.enabled
      ? t('team.connectedAs', { url: state.settings.teamHubUrl, name: state.teamMe ? state.teamMe.name : t('team.unknown') })
      : t('team.disabled')
  );
  els.teamStatus.textContent = result.enabled
    ? t('team.connectedAs', { url: state.settings.teamHubUrl, name: state.teamMe ? state.teamMe.name : t('team.unknown') })
    : t('team.disabled');
  if (showMessage) setMessage(t('team.connOk'));
  return result;
}

async function refreshTeamProjects() {
  const status = await refreshTeamStatus();
  if (!status.success || !status.enabled) return;

  const result = await window.api.team.listProjects();
  if (!result.success) {
    setMessage(result.message, true);
    return;
  }
  state.teamProjects = result.projects || [];
  renderTeamProjects(state.teamProjects);
  renderTeamOnboarding();
  await refreshTeamAdmin();
}

function reservationRemainingMs(project) {
  const expiresAt = project && project.lock ? Date.parse(project.lock.expiresAt || '') : NaN;
  return Number.isFinite(expiresAt) ? expiresAt - Date.now() : null;
}

function minutesLeft(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

async function notifyReservationExpiring(project, remainingMs) {
  if (!window.api.app || !window.api.app.notify || !project || !project.lock || !project.lock.expiresAt) return;
  const key = `${project.domain}:${project.lock.expiresAt}`;
  if (state.reservationGuard.expiryNotifications.has(key)) return;
  state.reservationGuard.expiryNotifications.add(key);
  await window.api.app.notify({
    title: t('notify.reservationTitle', { domain: project.domain }),
    body: t('notify.reservationBody', {
      domain: project.domain,
      minutes: minutesLeft(remainingMs)
    })
  }).catch(() => {});
}

function localHostAliases(domain) {
  const clean = String(domain || '').trim();
  const bare = clean.replace(/^www\./i, '');
  return [...new Set([clean, bare, `www.${bare}`].filter(Boolean))];
}

async function disableLocalHostsFor(domain, steps) {
  const result = await window.api.hosts.setProjectEntriesEnabled(localHostAliases(domain), false);
  steps.push({
    name: 'local host',
    success: result.success,
    message: result.success ? 'Local hosts disabled.' : result.message
  });
  await refreshHosts();
  return result;
}

async function autoPushExpiredReservation(project, reason) {
  const domain = project.domain;
  if (state.reservationGuard.autoPushing.has(domain)) return;
  state.reservationGuard.autoPushing.add(domain);

  const activityId = `reservation-${domain}`;
  const prefixSteps = [{ name: 'reservation', success: true, skipped: true, message: reason }];
  showActivity(t('activity.reservationGuard', { domain }), prefixSteps, { id: activityId, running: true });

  try {
    let finalResult = null;
    let steps = [...prefixSteps];
    if (localProjectFor(domain)) {
      finalResult = await window.api.team.pushProject(domain);
      steps = [...steps, ...(finalResult.steps || [])];
    } else {
      finalResult = { success: false, message: `${domain} is not available locally.`, steps: [] };
      steps.push({ name: 'push', success: false, message: finalResult.message });
    }

    const hostOff = await disableLocalHostsFor(domain, steps);
    const ok = Boolean(finalResult.success && hostOff.success);
    showActivity(resultMessage(finalResult, t('fb.autoReservationHandled', { domain })), steps, {
      id: activityId,
      success: ok
    });
    await Promise.all([refreshProjects(), refreshTeamProjects()]);
  } finally {
    state.reservationGuard.autoPushing.delete(domain);
  }
}

async function runReservationGuard() {
  if (state.reservationGuard.running || !isTeamEnabled()) return;
  state.reservationGuard.running = true;

  try {
    const status = await refreshTeamStatus();
    if (!status.success || !status.enabled || !state.teamMe) return;

    const listed = await window.api.team.listProjects();
    if (!listed.success) return;
    state.teamProjects = listed.projects || [];
    renderTeamProjects(state.teamProjects);
    renderTeamOnboarding();

    for (const project of visibleTeamProjects(state.teamProjects)) {
      const lock = project.lock;
      const mine = lock && lock.state === 'active' && lock.holderUserId === state.teamMe.id;
      if (!mine) continue;

      const remainingMs = reservationRemainingMs(project);
      if (remainingMs === null) continue;
      if (remainingMs <= RESERVATION_EXPIRED_GRACE_MS) {
        await autoPushExpiredReservation(project, 'Reservation expired.');
        continue;
      }
      if (remainingMs > RESERVATION_HEARTBEAT_THRESHOLD_MS) continue;
      if (remainingMs <= RESERVATION_NOTIFY_THRESHOLD_MS) {
        await notifyReservationExpiring(project, remainingMs);
      }

      const lastHeartbeat = state.reservationGuard.lastHeartbeat.get(project.domain) || 0;
      if (Date.now() - lastHeartbeat < RESERVATION_HEARTBEAT_MIN_MS) continue;
      state.reservationGuard.lastHeartbeat.set(project.domain, Date.now());

      const result = await window.api.team.heartbeat(project.domain, RESERVATION_TTL_MINUTES);
      showActivity(t('activity.reservationGuard', { domain: project.domain }), [{
        name: 'heartbeat',
        success: result.success,
        message: result.success ? resultMessage(result, t('fb.reservationExtended', { domain: project.domain })) : result.message
      }], {
        id: `reservation-${project.domain}`,
        success: result.success
      });

      if (!result.success) {
        await autoPushExpiredReservation(project, result.message || 'Reservation heartbeat failed.');
      }
    }
  } finally {
    state.reservationGuard.running = false;
  }
}

function renderTeamOnboarding() {
  if (!els.teamOnboarding) return;
  const enabled = isTeamEnabled();
  const projects = enabled ? visibleTeamProjects(state.teamProjects) : [];
  const localDomains = new Set((state.projects || []).map((project) => project.domain));
  const hasLocalTeamProject = projects.some((project) => localDomains.has(project.domain));
  const showInvite = !enabled;
  const showCheckout = enabled && projects.length > 0 && !hasLocalTeamProject;
  if (showInvite) {
    els.teamOnboarding.hidden = false;
  } else {
    els.teamOnboarding.hidden = !showCheckout;
  }
  const hidden = els.teamOnboarding.hidden;
  const block = els.teamOnboarding.closest('.block');
  if (block) block.hidden = hidden;
  if (els.teamWizardRow) els.teamWizardRow.hidden = !showCheckout;
  els.teamWizardProject.innerHTML = projects.map((project) => `<option value="${escapeHtml(project.domain)}">${escapeHtml(project.domain)}</option>`).join('');
}

function renderTeamAdmin() {
  if (!els.teamAdminPanel) return;
  const isAdmin = state.teamMe && state.teamMe.role === 'admin';
  els.teamAdminPanel.hidden = !isAdmin;
  if (!isAdmin) return;

  els.teamAdminUsers.innerHTML = state.teamUsers.length
    ? state.teamUsers.map((user) => {
        const onlyAdminUser = state.teamUsers.length === 1 && user.role === 'admin';
        return `
        <div class="admin-row">
          <div>
            <strong>${escapeHtml(user.name)}</strong>
            <span class="muted small">${escapeHtml(user.role)} · ${escapeHtml(user.status || 'active')}</span>
          </div>
          <div class="admin-actions">
            ${user.status === 'disabled'
              ? `<button type="button" data-enable-user="${escapeHtml(user.id)}">${t('team.enable')}</button>`
              : `<button type="button" data-disable-user="${escapeHtml(user.id)}">${t('team.disable')}</button>`}
            <button type="button" data-rotate-user="${escapeHtml(user.id)}">${t('team.rotateToken')}</button>
            <button type="button" class="link-danger" data-delete-user="${escapeHtml(user.id)}"${onlyAdminUser ? ' disabled' : ''} title="${onlyAdminUser ? escapeHtml(t('team.lastAdmin')) : ''}">${t('common.delete')}</button>
          </div>
        </div>
      `;
      }).join('')
    : `<p class="muted">${t('team.noUsers')}</p>`;

  const userOptions = state.teamUsers
    .filter((user) => user.status !== 'disabled')
    .map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`)
    .join('');
  els.teamAdminProjects.innerHTML = state.teamProjects.length
    ? state.teamProjects.map((project) => `
        <form class="handover-row" data-handover-domain="${escapeHtml(project.domain)}">
          <strong>${escapeHtml(project.domain)}</strong>
          <div class="handover-actions">
            <select>${userOptions}</select>
            <button type="submit">${t('team.handover')}</button>
            <button type="button" class="link-danger" data-delete-hub="${escapeHtml(project.domain)}">${t('team.deleteHub')}</button>
          </div>
        </form>
      `).join('')
    : `<p class="muted">${t('team.none')}</p>`;
}

// Show the freshly created user's access token + invite string. The token is
// only returned once by the Hub, so make it easy to copy and hand over.
function renderNewUserResult(name, role, token, invite) {
  if (!els.newUserResult) return;
  els.newUserResult.hidden = false;
  els.newUserResult.innerHTML = `
    <p class="ok small">${t('team.userCreated', { name, role })}</p>
    <label class="muted small">${t('team.token')}</label>
    <textarea class="secret" rows="2" readonly onclick="this.select()">${escapeHtml(token)}</textarea>
    <label class="muted small">${t('team.inviteFor', { name })}</label>
    <textarea class="secret" rows="3" readonly onclick="this.select()">${escapeHtml(invite)}</textarea>
    <p class="note small">${t('team.tokenOnce')}</p>
  `;
}

async function refreshTeamAdmin() {
  if (!state.teamMe || state.teamMe.role !== 'admin') {
    state.teamUsers = [];
    renderTeamAdmin();
    return;
  }
  const users = await window.api.team.listUsers();
  if (!users.success) {
    setMessage(users.message, true);
    return;
  }
  state.teamUsers = users.users || [];
  renderTeamAdmin();
}

function base64UrlEncode(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const clean = String(value || '').trim().replaceAll('-', '+').replaceAll('_', '/');
  const padded = `${clean}${'='.repeat((4 - (clean.length % 4)) % 4)}`;
  return JSON.parse(decodeURIComponent(escape(atob(padded))));
}

function buildInviteString(payload) {
  return base64UrlEncode(payload);
}

async function applyInviteString() {
  try {
    const invite = base64UrlDecode(els.teamInviteString.value);
    if (!invite.hubUrl || !invite.token) throw new Error(t('team.inviteInvalid'));
    els.settingsTeamMode.checked = true;
    els.settingsTeamHubUrl.value = invite.hubUrl;
    els.settingsTeamToken.value = invite.token;
    els.settingsTeamUserName.value = invite.userName || '';
    const saved = await saveSettingsFromForm();
    setMessage(saved.success ? t('fb.inviteApplied') : saved.message, !saved.success);
    if (saved.success) {
      await refreshTeamStatus(true);
      await refreshTeamProjects();
    }
  } catch (error) {
    setMessage(error.message || t('team.inviteInvalid'), true);
  }
}

function renderDatabases(databases) {
  if (!databases.length) {
    els.dbList.innerHTML = `<li class="muted">${t('db.none')}</li>`;
    return;
  }

  els.dbList.innerHTML = databases.map((name) => `
    <li>
      <button type="button" class="db-name-button" data-browse-db-name="${escapeHtml(name)}">${escapeHtml(name)}</button>
      <span>
        <button type="button" data-export-db="${escapeHtml(name)}">${t('common.export')}</button>
        <button type="button" data-drop-db="${escapeHtml(name)}">${t('db.deleteDb')}</button>
      </span>
    </li>
  `).join('');
}

async function refreshDatabases() {
  const result = await window.api.db.list();
  if (!result.success) {
    setMessage(result.message, true);
    return;
  }
  renderDatabases(result.databases || []);
  await refreshBrowseDbs(result.databases || []);
}

async function refreshBrowseDbs(known) {
  let dbs = known;
  if (!Array.isArray(dbs)) {
    const result = await window.api.db.list();
    dbs = result.success ? (result.databases || []) : [];
  }
  const current = els.browseDb.value;
  els.browseDb.innerHTML = dbs.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  if (dbs.includes(current)) els.browseDb.value = current;
  await refreshBrowseTables();
}

async function refreshBrowseTables() {
  const db = els.browseDb.value;
  if (!db) { els.browseTables.innerHTML = `<span class="muted">${t('db.noDatabase')}</span>`; return; }
  const result = await window.api.db.listTables(db);
  const tables = result.success ? (result.tables || []) : [];
  els.browseTables.innerHTML = tables.length
    ? tables.map((t) => `<button type="button" class="table-chip" data-table="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')
    : `<span class="muted">${t('db.noTables')}</span>`;
}

function renderQueryResults(res) {
  if (!res.success) {
    els.browseResults.innerHTML = `<p class="danger">${escapeHtml(res.message || t('db.queryFailed'))}</p>`;
    return;
  }
  if (!res.columns || !res.columns.length) {
    els.browseResults.innerHTML = `<p class="muted">${escapeHtml(res.message || t('db.noRows'))}</p>`;
    return;
  }
  const head = res.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = res.rows.map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  els.browseResults.innerHTML = `<div class="table-scroll"><table class="result-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="muted small">${t('db.rows', { n: res.rows.length })}</p>`;
}

async function runBrowseQuery() {
  const db = els.browseDb.value;
  const sql = els.browseSql.value.trim();
  if (!db) {
    setMessage(t('db.needDatabase'), true);
    return;
  }
  if (!sql) {
    setMessage(t('db.needQuery'), true);
    return;
  }
  const result = await window.api.db.query(db, sql);
  renderQueryResults(result);
}

function resetExportOptions() {
  els.dbExportContent.value = 'full';
  els.dbExportCharset.value = 'utf8mb4';
  els.dbExportTableMode.value = 'all';
  els.dbExportDrop.checked = true;
  els.dbExportRoutines.checked = true;
  els.dbExportTriggers.checked = true;
  els.dbExportEvents.checked = false;
  els.dbExportTransaction.checked = true;
  els.dbExportExtended.checked = true;
  els.dbExportComplete.checked = false;
  els.dbExportHex.checked = true;
  els.dbExportGzip.checked = false;
}

async function openExportPanel(dbName) {
  state.exportDbName = dbName;
  resetExportOptions();
  els.dbExportTitle.textContent = `${t('common.export')} ${dbName}`;
  els.dbExportTables.innerHTML = '';
  els.dbExportForm.hidden = false;
  setMessage(t('msg.loadingTables', { db: dbName }));

  const result = await window.api.db.listTables(dbName);
  if (!result.success) {
    setMessage(result.message, true);
    return;
  }

  const tables = result.tables || [];
  if (!tables.length) {
    els.dbExportTables.innerHTML = `<option disabled>${t('db.noTablesOpt')}</option>`;
  } else {
    els.dbExportTables.innerHTML = tables.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  }

  setMessage(t('msg.exportReady', { db: dbName }));
}

function selectedExportTables() {
  return Array.from(els.dbExportTables.selectedOptions)
    .map((option) => option.value)
    .filter(Boolean);
}

function buildExportPayload() {
  return {
    dbName: state.exportDbName,
    content: els.dbExportContent.value,
    charset: els.dbExportCharset.value.trim(),
    tableMode: els.dbExportTableMode.value,
    selectedTables: selectedExportTables(),
    addDropTable: els.dbExportDrop.checked,
    routines: els.dbExportRoutines.checked,
    triggers: els.dbExportTriggers.checked,
    events: els.dbExportEvents.checked,
    singleTransaction: els.dbExportTransaction.checked,
    extendedInsert: els.dbExportExtended.checked,
    completeInsert: els.dbExportComplete.checked,
    hexBlob: els.dbExportHex.checked,
    gzip: els.dbExportGzip.checked
  };
}

function togglePill(enabled, dataAttr, id, contextLabel = id) {
  const cls = enabled ? 'pill on' : 'pill off';
  const label = enabled ? t('pill.on') : t('pill.off');
  const ariaLabel = t('hosts.toggleState', { item: contextLabel, state: label });
  return `<button type="button" class="${cls}" ${dataAttr}="${escapeHtml(id)}" aria-pressed="${enabled ? 'true' : 'false'}" aria-label="${escapeHtml(ariaLabel)}">${label}</button>`;
}

function renderGroup(group) {
  const entries = group.entries.length
    ? group.entries.map((entry) => `
        <li class="host-entry${entry.enabled ? '' : ' is-off'}">
          ${togglePill(entry.enabled, 'data-toggle-entry', entry.id, entry.domain)}
          <span class="host-ip">${escapeHtml(entry.ip)}</span>
          <span class="host-domain">${escapeHtml(entry.domain)}</span>
          <button type="button" class="link-danger" data-remove-entry="${escapeHtml(entry.id)}">${t('common.remove')}</button>
        </li>`).join('')
    : `<li class="muted">${t('hosts.noEntries')}</li>`;

  return `
    <div class="surface host-group${group.enabled ? '' : ' is-off'}">
      <div class="host-group-head">
        ${togglePill(group.enabled, 'data-toggle-group', group.id, group.name)}
        <strong class="host-group-name">${escapeHtml(group.name)}</strong>
        <button type="button" class="link-danger" data-remove-group="${escapeHtml(group.id)}">${t('hosts.deleteGroup')}</button>
      </div>
      <ul class="list host-entries">${entries}</ul>
      <form class="inline-form host-add-entry" data-group="${escapeHtml(group.id)}">
        <input type="text" class="host-add-domain" placeholder="${t('hosts.addDomainPh')}" required>
        <input type="text" class="host-add-ip" value="127.0.0.1" required>
        <button type="submit">${t('common.add')}</button>
      </form>
    </div>`;
}

function renderRemote(remote) {
  const fetched = remote.lastFetched
    ? t('hosts.fetched', { when: new Date(remote.lastFetched).toLocaleString() })
    : t('hosts.notFetched');
  return `
    <div class="host-remote${remote.enabled ? '' : ' is-off'}">
      ${togglePill(remote.enabled, 'data-toggle-remote', remote.id, remote.name)}
      <div class="host-remote-body">
        <strong>${escapeHtml(remote.name)}</strong>
        <span class="muted">${escapeHtml(remote.url)}</span>
        <span class="muted small">${escapeHtml(fetched)}</span>
      </div>
      <button type="button" data-refresh-remote="${escapeHtml(remote.id)}">${t('common.refresh')}</button>
      <button type="button" class="link-danger" data-remove-remote="${escapeHtml(remote.id)}">${t('common.remove')}</button>
    </div>`;
}

function renderHosts(model) {
  state.hostsModel = model;
  els.hostsGroups.innerHTML = model.groups.map(renderGroup).join('');
  els.hostsRemotes.innerHTML = model.remotes.length
    ? model.remotes.map(renderRemote).join('')
    : `<p class="muted">${t('hosts.noRemotes')}</p>`;
}

function applyLanguage(lang) {
  I18N.setLang(lang || 'de');
  I18N.applyStatic(document);
  if (els.settingsLanguage) els.settingsLanguage.value = I18N.getLang();
  if (state.projects) renderProjects(state.projects);
  if (state.teamProjects) renderTeamProjects(state.teamProjects);
  renderTeamOnboarding();
  renderTeamAdmin();
  if (state.hostsModel) renderHosts(state.hostsModel);
  renderVmStatus(state.vmState);
  refreshBlockTitles();
  syncFaqBlockVisibility();
}

async function refreshHosts() {
  const result = await window.api.hosts.getModel();
  if (!result.success) {
    setMessage(result.message, true);
    return;
  }
  renderHosts(result.model);
}

function fillSettings(settings) {
  state.settings = { ...settings, teamMode: false };
  applyLanguage(state.settings.language || 'de');
  if (els.settingsLanguage) els.settingsLanguage.value = state.settings.language || 'de';
  els.settingsSitesPath.value = state.settings.sitesPath || '';
  els.settingsBasePlugins.value = state.settings.basePlugins || '';
  els.settingsCpus.value = state.settings.cpus || 2;
  els.settingsMemory.value = state.settings.memory || 4;
  if (els.settingsTeamMode) els.settingsTeamMode.checked = false;
  if (els.settingsTeamHubUrl) els.settingsTeamHubUrl.value = state.settings.teamHubUrl || '';
  if (els.settingsTeamToken) els.settingsTeamToken.value = state.settings.teamToken || '';
  if (els.settingsTeamUserName) els.settingsTeamUserName.value = state.settings.teamUserName || '';
  if (els.settingsTeamTunnelEnabled) els.settingsTeamTunnelEnabled.checked = Boolean(state.settings.teamTunnelEnabled);
  if (els.settingsTeamTunnelAutoStart) els.settingsTeamTunnelAutoStart.checked = Boolean(state.settings.teamTunnelAutoStart);
  if (els.settingsTeamTunnelUser) els.settingsTeamTunnelUser.value = state.settings.teamTunnelUser || 'deploy';
  if (els.settingsTeamTunnelHost) els.settingsTeamTunnelHost.value = state.settings.teamTunnelHost || '';
  if (els.settingsTeamTunnelLocalPort) els.settingsTeamTunnelLocalPort.value = state.settings.teamTunnelLocalPort || 17345;
  if (els.settingsTeamTunnelSshPort) els.settingsTeamTunnelSshPort.value = state.settings.teamTunnelSshPort || 22;
  if (els.settingsTeamTunnelRemoteHost) els.settingsTeamTunnelRemoteHost.value = state.settings.teamTunnelRemoteHost || '127.0.0.1';
  if (els.settingsTeamTunnelRemotePort) els.settingsTeamTunnelRemotePort.value = state.settings.teamTunnelRemotePort || 7345;
  if (els.settingsTeamTunnelIdentityFile) els.settingsTeamTunnelIdentityFile.value = state.settings.teamTunnelIdentityFile || '';
  updateTeamVisibility();
}

function tunnelHubUrlFromForm() {
  const storedPort = state.settings ? state.settings.teamTunnelLocalPort : 17345;
  const formValue = els.settingsTeamTunnelLocalPort ? els.settingsTeamTunnelLocalPort.value : storedPort;
  const port = parseInt(formValue, 10) || 17345;
  return `http://127.0.0.1:${port}`;
}

function buildSettingsPayload() {
  const previous = state.settings || {};
  const tunnelEnabled = els.settingsTeamTunnelEnabled
    ? els.settingsTeamTunnelEnabled.checked
    : Boolean(previous.teamTunnelEnabled);
  const hubUrlFromInput = els.settingsTeamHubUrl
    ? els.settingsTeamHubUrl.value.trim()
    : (previous.teamHubUrl || '');
  const hubUrl = hubUrlFromInput || (tunnelEnabled ? tunnelHubUrlFromForm() : '');
  return {
    language: els.settingsLanguage ? els.settingsLanguage.value : 'de',
    sitesPath: els.settingsSitesPath.value.trim(),
    basePlugins: els.settingsBasePlugins.value.trim(),
    defaultPhpVersion: els.settingsDefaultPhp.value,
    cpus: parseInt(els.settingsCpus.value, 10),
    memory: parseInt(els.settingsMemory.value, 10),
    teamMode: false,
    teamHubUrl: hubUrl,
    teamToken: els.settingsTeamToken ? els.settingsTeamToken.value.trim() : (previous.teamToken || ''),
    teamUserName: els.settingsTeamUserName ? els.settingsTeamUserName.value.trim() : (previous.teamUserName || ''),
    teamTunnelEnabled: tunnelEnabled,
    teamTunnelAutoStart: els.settingsTeamTunnelAutoStart ? els.settingsTeamTunnelAutoStart.checked : Boolean(previous.teamTunnelAutoStart),
    teamTunnelUser: els.settingsTeamTunnelUser ? els.settingsTeamTunnelUser.value.trim() : (previous.teamTunnelUser || ''),
    teamTunnelHost: els.settingsTeamTunnelHost ? els.settingsTeamTunnelHost.value.trim() : (previous.teamTunnelHost || ''),
    teamTunnelLocalPort: els.settingsTeamTunnelLocalPort ? parseInt(els.settingsTeamTunnelLocalPort.value, 10) : previous.teamTunnelLocalPort,
    teamTunnelSshPort: els.settingsTeamTunnelSshPort ? parseInt(els.settingsTeamTunnelSshPort.value, 10) : previous.teamTunnelSshPort,
    teamTunnelRemoteHost: els.settingsTeamTunnelRemoteHost ? els.settingsTeamTunnelRemoteHost.value.trim() : (previous.teamTunnelRemoteHost || ''),
    teamTunnelRemotePort: els.settingsTeamTunnelRemotePort ? parseInt(els.settingsTeamTunnelRemotePort.value, 10) : previous.teamTunnelRemotePort,
    teamTunnelIdentityFile: els.settingsTeamTunnelIdentityFile ? els.settingsTeamTunnelIdentityFile.value.trim() : (previous.teamTunnelIdentityFile || '')
  };
}

async function saveSettingsFromForm() {
  const result = await window.api.settings.save(buildSettingsPayload());
  if (result.success) fillSettings(result.settings);
  return result;
}

async function syncLocalCheckpointsToHub() {
  if (!hasTeamApi() || !window.api.team.syncLocalCheckpoints) return { success: true, skipped: true };
  showActivity(t('activity.localCheckpointSync'), [], { id: 'local-checkpoint-sync', running: true });
  const result = await window.api.team.syncLocalCheckpoints();
  reportSteps(t('activity.localCheckpointSync'), result, t('fb.localCheckpointsSynced'));
  if (result.success) await refreshCheckpoints();
  return result;
}

async function refreshTunnelStatus() {
  if (!hasTeamApi()) {
    if (els.teamTunnelStatus) els.teamTunnelStatus.textContent = t('status.tunnelDisabled');
    return { success: true, skipped: true };
  }
  const result = await window.api.team.tunnelStatus();
  if (!result.success) {
    els.teamTunnelStatus.textContent = result.message || t('status.tunnelUnavailable');
    return result;
  }

  if (!state.settings || !state.settings.teamTunnelEnabled) {
    els.teamTunnelStatus.textContent = t('status.tunnelDisabled');
    return result;
  }

  els.teamTunnelStatus.textContent = result.running
    ? t('status.tunnelRunning', { host: state.settings.teamTunnelLocalHost || '127.0.0.1', port: state.settings.teamTunnelLocalPort || 17345 })
    : (result.lastError ? t('status.tunnelStopped', { err: result.lastError }) : t('status.tunnelNotRunning'));
  return result;
}

async function ensureTeamTunnel() {
  if (!hasTeamApi()) return { success: true, skipped: true };
  if (!state.settings || !state.settings.teamTunnelEnabled) return { success: true, skipped: true };

  const status = await window.api.team.tunnelStatus();
  if (status.success && status.running) return status;
  if (!state.settings.teamTunnelAutoStart) return { success: true, skipped: true };

  const started = await window.api.team.startTunnel();
  await refreshTunnelStatus();
  return started;
}

function populatePhpSelect(select, versions, selected) {
  const current = select.value;
  if (!versions.length) {
    select.innerHTML = `<option value="">${t('php.noneSelect')}</option>`;
    select.value = '';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = versions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  const want = versions.includes(selected) ? selected : (versions.includes(current) ? current : versions[0]);
  if (want) select.value = want;
}

function comparePhpVersions(a, b) {
  const left = String(a || '').split('.').map((part) => parseInt(part, 10) || 0);
  const right = String(b || '').split('.').map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function cmsAdapterById(id) {
  return state.cmsAdapters.find((adapter) => adapter.id === id) || null;
}

function recommendedPhpForAdapter(adapter) {
  if (!adapter || !state.phpVersions.length) return '';
  const sorted = [...state.phpVersions].sort(comparePhpVersions);
  if (adapter.recommendedPhpVersion && state.phpVersions.includes(adapter.recommendedPhpVersion)) {
    return adapter.recommendedPhpVersion;
  }
  if (adapter.installPhpMin) {
    return sorted.find((version) => comparePhpVersions(version, adapter.installPhpMin) >= 0) || '';
  }
  return adapter.recommendedPhpVersion || '';
}

function updateProjectPhpRecommendation(force = false) {
  if (!els.projectCms || !els.projectPhp) return;
  const adapter = cmsAdapterById(els.projectCms.value);
  const recommended = recommendedPhpForAdapter(adapter);
  const needsMinimum = adapter && adapter.installPhpMin && comparePhpVersions(els.projectPhp.value, adapter.installPhpMin) < 0;
  if (recommended && (force || !els.projectPhp.value || needsMinimum)) {
    els.projectPhp.value = recommended;
  }
  if (els.projectPhpHint) {
    els.projectPhpHint.textContent = adapter && recommended
      ? t('proj.phpRecommended', { cms: adapter.label, version: recommended })
      : '';
  }
}

// The base-plugins option only applies to WordPress; hide it for other CMS.
function updatePluginsRowVisibility() {
  if (!els.projectPluginsRow || !els.projectCms) return;
  els.projectPluginsRow.hidden = els.projectCms.value !== 'wordpress';
}

async function refreshCmsAdapters() {
  const result = await window.api.projects.listCms();
  state.cmsAdapters = result.success && Array.isArray(result.adapters) ? result.adapters : [];
  if (!els.projectCms) return;
  const current = els.projectCms.value || 'wordpress';
  if (!state.cmsAdapters.length) {
    els.projectCms.innerHTML = `<option value="plain">${t('cms.plainFallback')}</option>`;
    els.projectCms.value = 'plain';
    updatePluginsRowVisibility();
    if (els.projectPhpHint) els.projectPhpHint.textContent = '';
    return;
  }
  els.projectCms.innerHTML = state.cmsAdapters.map((adapter) => (
    `<option value="${escapeHtml(adapter.id)}">${escapeHtml(adapter.label)}</option>`
  )).join('');
  els.projectCms.value = state.cmsAdapters.some((adapter) => adapter.id === current) ? current : 'wordpress';
  updatePluginsRowVisibility();
  updateProjectPhpRecommendation();
}

async function refreshPhpVersions() {
  const result = await window.api.php.list();
  const versions = result.success && Array.isArray(result.versions) ? result.versions : [];
  state.phpVersions = versions;

  const def = state.settings ? state.settings.defaultPhpVersion : null;
  populatePhpSelect(els.projectPhp, versions, def);
  populatePhpSelect(els.settingsDefaultPhp, versions, def);
  if (els.importPhp) populatePhpSelect(els.importPhp, versions, def);
  updateProjectPhpRecommendation();

  els.phpInstalled.innerHTML = versions.length
    ? versions.map((v) => `<span class="chip">${escapeHtml(v)}</span>`).join('')
    : `<span class="muted">${t('php.none')}</span>`;

  if (versions.length) {
    els.stackStrip.textContent = `Ubuntu 22.04 · PHP ${versions.join('/')} · MariaDB · Redis`;
  } else {
    els.stackStrip.textContent = 'Ubuntu 22.04 · MariaDB · Redis';
  }
}

async function refreshSettings() {
  const result = await window.api.settings.get();
  if (!result.success) {
    setMessage(result.message, true);
    return;
  }
  fillSettings(result.settings);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const BLOCK_CONFIGS = [
  { selector: '#tab-projects > .grid.two > .surface:first-child', id: 'projects-list', titleKey: 'proj.title' },
  { selector: '#project-form', id: 'projects-new', titleKey: 'proj.new' },
  { selector: '#tab-projects > .surface.form-stack', id: 'projects-import', titleKey: 'import.title' },
  { selector: '#tab-projects > .history-panel', id: 'projects-history', titleKey: 'history.title' },
  { selector: '#tab-database > .grid.two > .surface', id: 'database-list', titleKey: 'db.title' },
  { selector: '#tab-database > .browse-panel', id: 'database-browse', titleKey: 'db.browse' },
  { selector: '#hosts-groups', id: 'hosts-groups-block', titleKey: 'hosts.title' },
  { selector: '#hosts-group-form', id: 'hosts-new-group', titleKey: 'hosts.addGroup' },
  { selector: '[data-block-id="hosts-remotes-block"]', id: 'hosts-remotes-block', titleKey: 'hosts.remoteLists' },
  { selector: '#settings-form > [data-block-id="settings-general"]', id: 'settings-general', titleKey: 'set.general' },
  { selector: '#settings-form > [data-block-id="settings-php"]', id: 'settings-php', title: 'PHP' },
  { selector: '#settings-form > [data-block-id="settings-vm"]', id: 'settings-vm', titleKey: 'set.vmResources' },
  { selector: '.faq[data-faq-lang]', idFromElement: true, titleKey: 'faq.title' }
];

let uiBlocksReady = false;
let draggedBlock = null;
let pointerDrag = null;
let suppressBlockClick = false;
let saveBlocksTimer = null;

function blockPrefs() {
  if (!state.settings) state.settings = {};
  if (!state.settings.uiBlocks || typeof state.settings.uiBlocks !== 'object') {
    state.settings.uiBlocks = { collapsed: {}, order: {} };
  }
  if (!state.settings.uiBlocks.collapsed || typeof state.settings.uiBlocks.collapsed !== 'object') {
    state.settings.uiBlocks.collapsed = {};
  }
  if (!state.settings.uiBlocks.order || typeof state.settings.uiBlocks.order !== 'object') {
    state.settings.uiBlocks.order = {};
  }
  return state.settings.uiBlocks;
}

function blockIdForElement(element, config, index) {
  if (config.id) return config.id;
  if (config.idFromElement) {
    const lang = element.getAttribute('data-faq-lang');
    if (lang) return `faq-${lang}`;
    if (element.id) return element.id;
  }
  if (element.dataset.blockId) return element.dataset.blockId;
  const heading = element.previousElementSibling && element.previousElementSibling.id
    ? element.previousElementSibling.id
    : '';
  return heading || `block-${index}`;
}

function blockTitleFor(element, config) {
  if (config.titleKey) return t(config.titleKey);
  if (config.title) return config.title;
  const heading = element.previousElementSibling && element.previousElementSibling.classList.contains('faq-h')
    ? element.previousElementSibling.textContent.trim()
    : '';
  return heading || element.dataset.blockTitle || 'Block';
}

function panelKeyForBlock(block) {
  const panel = block.closest('.panel');
  return panel ? panel.id.replace(/^tab-/, '') : 'global';
}

function scheduleBlockSave() {
  if (!state.settings) return;
  clearTimeout(saveBlocksTimer);
  saveBlocksTimer = setTimeout(async () => {
    const result = await window.api.settings.save({ uiBlocks: blockPrefs() });
    if (result && result.success && result.settings) {
      state.settings.uiBlocks = result.settings.uiBlocks;
    }
  }, 250);
}

function rememberBlockOrder(panelKey) {
  const panel = document.querySelector(`#tab-${panelKey}`);
  if (!panel) return;
  blockPrefs().order[panelKey] = Array.from(panel.querySelectorAll('.block[data-block-id]'))
    .map((block) => block.dataset.blockId)
    .filter(Boolean);
  scheduleBlockSave();
}

function applyCollapsedState(block) {
  const prefs = blockPrefs();
  const collapsed = Boolean(prefs.collapsed[block.dataset.blockId]);
  const body = block.querySelector(':scope > .block-body');
  const button = block.querySelector(':scope > .block-head .block-collapse');
  block.classList.toggle('is-collapsed', collapsed);
  if (body) body.hidden = collapsed;
  if (button) {
    // Chevron rotates via CSS; keep it a single glyph.
    button.setAttribute('aria-expanded', String(!collapsed));
  }
}

function applyBlockOrder() {
  const prefs = blockPrefs();
  document.querySelectorAll('.panel').forEach((panel) => {
    const panelKey = panel.id.replace(/^tab-/, '');
    const order = Array.isArray(prefs.order[panelKey]) ? prefs.order[panelKey] : [];
    if (!order.length) return;
    const rank = new Map(order.map((id, index) => [id, index]));
    const parents = new Set(Array.from(panel.querySelectorAll('.block[data-block-id]')).map((block) => block.parentElement));
    parents.forEach((parent) => {
      const blocks = Array.from(parent.children).filter((child) => child.classList && child.classList.contains('block'));
      blocks.sort((a, b) => (rank.get(a.dataset.blockId) ?? 9999) - (rank.get(b.dataset.blockId) ?? 9999));
      blocks.forEach((block) => parent.appendChild(block));
    });
  });
}

function refreshBlockTitles() {
  document.querySelectorAll('.block[data-block-title-key]').forEach((block) => {
    const title = block.querySelector(':scope > .block-head .block-title');
    if (title) title.textContent = t(block.dataset.blockTitleKey);
  });
}

function syncFaqBlockVisibility() {
  document.querySelectorAll('.faq[data-faq-lang]').forEach((faq) => {
    const block = faq.closest('.block');
    if (block) block.hidden = faq.hidden;
  });
}

function normalizeHeadingText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// The block head labels each section, so drop a heading inside the surface that
// would just repeat that title. The panel's own <h2> is left untouched, so the
// block keeps its own header label.
function removeDuplicateInnerHeading(element, titleText) {
  const target = normalizeHeadingText(titleText);
  if (!target) return;
  const inner = element.querySelector('h1, h2, h3, h4');
  if (inner && normalizeHeadingText(inner.textContent) === target) inner.remove();
}

function createBlock(element, config, index) {
  if (!element || element.closest('.block')) return null;
  const id = blockIdForElement(element, config, index);
  const wrapper = document.createElement('section');
  wrapper.className = 'block';
  wrapper.dataset.blockId = id;
  wrapper.draggable = false;
  wrapper.hidden = element.hidden;
  if (config.titleKey) wrapper.dataset.blockTitleKey = config.titleKey;

  const titleText = blockTitleFor(element, config);
  removeDuplicateInnerHeading(element, titleText);

  const head = document.createElement('div');
  head.className = 'block-head';
  const drag = document.createElement('button');
  drag.type = 'button';
  drag.className = 'block-drag';
  drag.draggable = true;
  drag.setAttribute('aria-label', 'Move block');
  drag.textContent = '⠿';
  const title = document.createElement('strong');
  title.className = 'block-title';
  title.textContent = titleText;
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'block-collapse';
  collapse.setAttribute('aria-label', 'Collapse block');
  collapse.textContent = '▾';
  head.append(drag, title, collapse);

  const body = document.createElement('div');
  body.className = element.classList.contains('surface') ? 'block-body has-surface' : 'block-body';
  element.parentNode.insertBefore(wrapper, element);
  body.appendChild(element);
  wrapper.append(head, body);
  applyCollapsedState(wrapper);
  return wrapper;
}

function initUiBlocks() {
  if (uiBlocksReady) return;
  let index = 0;
  BLOCK_CONFIGS.forEach((config) => {
    document.querySelectorAll(config.selector).forEach((element) => {
      createBlock(element, config, index);
      index += 1;
    });
  });
  applyBlockOrder();
  document.querySelectorAll('.block[data-block-id]').forEach(applyCollapsedState);
  syncFaqBlockVisibility();
  uiBlocksReady = true;
}

function wireUiBlocks() {
  document.addEventListener('click', (event) => {
    if (suppressBlockClick) {
      suppressBlockClick = false;
      return;
    }
    // Toggle by clicking anywhere on the header (FAQ-style), except the drag grip.
    if (event.target.closest('.block-drag')) return;
    const head = event.target.closest('.block-head');
    if (!head) return;
    const block = head.closest('.block');
    if (!block) return;
    const prefs = blockPrefs();
    const id = block.dataset.blockId;
    prefs.collapsed[id] = !prefs.collapsed[id];
    applyCollapsedState(block);
    scheduleBlockSave();
  });

  document.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.block-drag');
    const block = handle ? handle.closest('.block') : null;
    if (!block || (event.button !== undefined && event.button !== 0)) return;
    pointerDrag = {
      block,
      handle,
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
      panelKey: panelKeyForBlock(block)
    };
    handle.setPointerCapture?.(event.pointerId);
    block.classList.add('is-dragging');
    event.preventDefault();
  });

  document.addEventListener('pointermove', (event) => {
    if (!pointerDrag) return;
    if (Math.abs(event.clientY - pointerDrag.startY) > 4) pointerDrag.moved = true;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const over = target ? target.closest('.block') : null;
    if (!over || over === pointerDrag.block || over.parentElement !== pointerDrag.block.parentElement) return;
    const rect = over.getBoundingClientRect();
    const after = event.clientY > rect.top + (rect.height / 2);
    over.parentElement.insertBefore(pointerDrag.block, after ? over.nextSibling : over);
    event.preventDefault();
  });

  const finishPointerDrag = () => {
    if (!pointerDrag) return;
    pointerDrag.block.classList.remove('is-dragging');
    if (pointerDrag.moved) {
      suppressBlockClick = true;
      setTimeout(() => {
        suppressBlockClick = false;
      }, 0);
      rememberBlockOrder(pointerDrag.panelKey);
    }
    pointerDrag = null;
  };

  document.addEventListener('pointerup', finishPointerDrag);
  document.addEventListener('pointercancel', finishPointerDrag);

  document.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('.block-drag');
    const block = handle ? handle.closest('.block') : null;
    if (!block) {
      event.preventDefault();
      return;
    }
    draggedBlock = block;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', block.dataset.blockId || '');
    block.classList.add('is-dragging');
  });

  document.addEventListener('dragover', (event) => {
    const over = event.target.closest('.block');
    if (!draggedBlock || !over || over === draggedBlock || over.parentElement !== draggedBlock.parentElement) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });

  document.addEventListener('drop', (event) => {
    const over = event.target.closest('.block');
    if (!draggedBlock || !over || over === draggedBlock || over.parentElement !== draggedBlock.parentElement) return;
    event.preventDefault();
    const rect = over.getBoundingClientRect();
    const after = event.clientY > rect.top + (rect.height / 2);
    over.parentElement.insertBefore(draggedBlock, after ? over.nextSibling : over);
    rememberBlockOrder(panelKeyForBlock(draggedBlock));
  });

  document.addEventListener('dragend', () => {
    if (draggedBlock) draggedBlock.classList.remove('is-dragging');
    draggedBlock = null;
  });
}

function wireActivity() {
  if (!els.activitySummary) return;
  els.activitySummary.addEventListener('click', () => {
    setActivityExpanded(els.activitySteps.hidden);
  });
  if (els.activityDismiss) {
    els.activityDismiss.addEventListener('click', () => clearStatus());
  }
}

function wireImport() {
  if (!els.importRun) return;
  const pick = async (kind, input) => {
    const r = await window.api.projects.pickFile(kind);
    if (r && r.success) input.value = r.path;
  };
  els.importPickArchive.addEventListener('click', () => pick('archive', els.importArchive));
  els.importPickDump.addEventListener('click', () => pick('dump', els.importDump));
  els.importRun.addEventListener('click', () => withBusy(els.importRun, async () => {
    const domain = els.importDomain.value.trim();
    if (!domain) { setMessage(t('import.needDomain'), true); return; }
    if (!els.importArchive.value) { setMessage(t('import.needArchive'), true); return; }
    setRunning(t('import.running', { domain }));
    showActivity(t('activity.import', { domain }), [], { running: true });
    const result = await window.api.projects.import({
      domain,
      phpVersion: els.importPhp.value,
      archivePath: els.importArchive.value,
      dumpPath: els.importDump.value
    });
    showActivity(resultMessage(result, t('import.done', { domain })), result.steps || [], { success: result.success });
    if (result.success) {
      els.importDomain.value = '';
      els.importArchive.value = '';
      els.importDump.value = '';
      await Promise.all([refreshProjects(), refreshHosts()]);
      const opened = await window.api.projects.open(domain);
      if (!opened.success) setMessage(opened.message, true);
    }
    return result;
  }));
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('is-active'));
      tab.classList.add('is-active');

      document.querySelectorAll('.panel').forEach((panel) => {
        panel.hidden = panel.id !== `tab-${tab.dataset.tab}`;
      });

      if (tab.dataset.tab === 'database') withBusy(null, refreshDatabases);
      if (tab.dataset.tab === 'team') withBusy(null, refreshTeamProjects);
    });
  });

  const openFaqBtn = document.querySelector('#open-faq');
  if (openFaqBtn) {
    openFaqBtn.addEventListener('click', () => {
      document.querySelector('.tab[data-tab="faq"]').click();
    });
  }
}

function wireVmControls() {
  els.vmStart.addEventListener('click', () => withBusy(els.vmStart, async () => {
    setRunning(t('msg.vmStarting'));
    const result = await window.api.vm.start();
    setMessage(resultMessage(result, t('fb.start')), !result.success);
    await refreshVmStatus();
    if (result.success) {
      await refreshPhpVersions();
      await refreshProjects();
    }
  }));

  els.vmStop.addEventListener('click', () => withBusy(els.vmStop, async () => {
    setRunning(t('msg.vmStopping'));
    const result = await window.api.vm.stop();
    setMessage(resultMessage(result, t('fb.stop')), !result.success);
    await refreshVmStatus();
  }));

  els.vmProvision.addEventListener('click', () => withBusy(els.vmProvision, async () => {
    setRunning(t('msg.vmProvisioning'));
    const result = await window.api.vm.provision();
    setMessage(resultMessage(result, t('fb.provision')), !result.success);
    await refreshVmStatus();
    if (result.success) {
      await refreshPhpVersions();
      await refreshProjects();
    }
  }));
}

function wireProjects() {
  document.querySelector('#refresh-projects').addEventListener('click', () => withBusy(null, refreshProjects));

  els.projectDomain.addEventListener('input', () => {
    if (!els.projectDb.value.trim()) {
      els.projectDb.placeholder = els.projectDomain.value.replace(/[^A-Za-z0-9_]/g, '_');
    }
  });

  els.projectForm.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(els.projectForm.querySelector('button[type="submit"]'), async () => {
      const domain = els.projectDomain.value.trim();
      if (!els.projectPhp.value) {
        setMessage(t('php.needInstalled'), true);
        return;
      }
      const payload = {
        domain,
        cms: els.projectCms ? els.projectCms.value : 'wordpress',
        phpVersion: els.projectPhp.value,
        dbName: els.projectDb.value.trim() || domain.replace(/[^A-Za-z0-9_]/g, '_'),
        installPlugins: els.projectPlugins.checked,
        basePlugins: state.settings ? state.settings.basePlugins : ''
      };

      const result = await window.api.projects.create(payload);
      reportSteps(t('activity.create', { domain }), result, t('fb.projectCreate'));
      if (result.success) {
        els.projectForm.reset();
        if (state.settings) {
          els.projectPhp.value = state.settings.defaultPhpVersion || '8.2';
        }
        if (els.projectCms) els.projectCms.value = 'wordpress';
        updatePluginsRowVisibility();
        updateProjectPhpRecommendation(true);
        await Promise.all([refreshProjects(), refreshHosts()]);
      }
    });
  });

  if (els.projectCms) {
    els.projectCms.addEventListener('change', () => {
      updatePluginsRowVisibility();
      updateProjectPhpRecommendation(true);
    });
  }

  els.projectsList.addEventListener('click', (event) => {
    const openButton = event.target.closest('[data-open]');
    if (openButton) {
      const domain = openButton.dataset.open;
      withBusy(openButton, async () => {
        setRunning(t('msg.opening', { domain }));
        const result = await window.api.projects.open(domain);
        setMessage(resultMessage(result, t('fb.opened', { domain })), !result.success);
        if (result.success) await refreshProjects();
      });
      return;
    }

    const pushButton = event.target.closest('[data-team-push-project]');
    if (pushButton) {
      const domain = pushButton.dataset.teamPushProject;
      if (!confirm(t('confirm.push', { domain }))) return;
      withBusy(pushButton, async () => {
        const status = await refreshTeamStatus();
        if (!status.success || !status.enabled) {
          setMessage(status.message || t('team.notConnectedShort'), true);
          return;
        }
        setRunning(t('msg.pushing', { domain }));
        const result = await window.api.team.pushProject(domain);
        reportSteps(t('activity.push', { domain }), result, t('fb.pushed', { domain }));
        await Promise.all([refreshProjects(), refreshTeamProjects()]);
      });
      return;
    }

    const deleteButton = event.target.closest('[data-delete-project]');
    if (!deleteButton) return;

    const domain = deleteButton.dataset.deleteProject;
    const database = deleteButton.dataset.projectDb;
    const dbText = database && database !== '—' ? t('confirm.deleteDbText', { db: database }) : '';
    if (!confirm(t('confirm.delete', { domain, dbText }))) return;
    if (!confirmDelete(domain)) return;

    withBusy(deleteButton, async () => {
      setRunning(t('activity.delete', { domain }));
      const result = await window.api.projects.delete(domain);
      reportSteps(t('activity.delete', { domain }), result, t('fb.projectDelete'));
      if (result.success) {
        await Promise.all([refreshProjects(), refreshHosts(), refreshDatabases()]);
      }
    });
  });

  els.projectsList.addEventListener('change', (event) => {
    const select = event.target.closest('.php-inline');
    if (!select) return;
    const domain = select.dataset.phpDomain;
    const version = select.value;
    withBusy(select, async () => {
      setRunning(t('msg.switchingPhp', { domain, version }));
      const result = await window.api.projects.setPhp(domain, version);
      setMessage(resultMessage(result, t('fb.phpSwitched', { domain, version })), !result.success);
      await refreshProjects();
    });
  });
}

function wireCheckpoints() {
  if (!els.checkpointDomain) return;

  els.checkpointDomain.addEventListener('change', () => {
    state.checkpointDomain = els.checkpointDomain.value;
    withBusy(null, refreshCheckpoints);
  });

  els.checkpointRefresh.addEventListener('click', () => withBusy(els.checkpointRefresh, refreshCheckpoints));

  els.checkpointCreate.addEventListener('click', () => withBusy(els.checkpointCreate, async () => {
    const domain = els.checkpointDomain.value;
    if (!domain) {
      setMessage(t('history.needProject'), true);
      return;
    }
    const message = (prompt(t('history.messagePrompt'), t('history.defaultMessage')) || '').trim();
    if (!message) {
      setMessage(t('history.needMessage'), true);
      return;
    }
    setRunning(t('history.creating', { domain }));
    const result = await window.api.checkpoints.create({
      domain,
      message,
      author: state.settings ? state.settings.teamUserName : ''
    });
    reportSteps(t('activity.checkpoint', { domain }), result, t('history.created'));
    await refreshCheckpoints();
  }));

  els.checkpointCompare.addEventListener('click', () => withBusy(els.checkpointCompare, async () => {
    const domain = els.checkpointDomain.value;
    const idA = els.checkpointA.value;
    const idB = els.checkpointB.value;
    if (!domain || !idA || !idB || idA === idB) {
      setMessage(t('history.pickTwo'), true);
      return;
    }
    const result = await window.api.checkpoints.diff(domain, idA, idB);
    renderCheckpointDiff(result);
  }));

  els.checkpointList.addEventListener('click', (event) => {
    const restore = event.target.closest('[data-restore-checkpoint]');
    const pin = event.target.closest('[data-pin-checkpoint]');
    const del = event.target.closest('[data-delete-checkpoint]');
    const button = restore || pin || del;
    if (!button) return;

    const domain = els.checkpointDomain.value;
    const id = button.dataset.restoreCheckpoint || button.dataset.pinCheckpoint || button.dataset.deleteCheckpoint;
    const checkpoint = state.checkpoints.find((item) => item.id === id);
    if (!checkpoint) return;

    if (restore && !confirm(t('confirm.restoreCheckpoint', { message: checkpoint.message }))) return;
    if (del && !confirm(t('confirm.deleteCheckpoint', { message: checkpoint.message }))) return;
    if (del && !confirmDelete(checkpoint.message || id)) return;

    withBusy(button, async () => {
      let result;
      if (restore) setRunning(t('activity.restore', { domain }));
      if (del) setRunning(t('activity.delete', { domain: checkpoint.message || id }));
      if (restore) result = await window.api.checkpoints.restore(domain, id);
      if (pin) result = await window.api.checkpoints.setPinned(domain, id, !checkpoint.pinned);
      if (del) result = await window.api.checkpoints.delete(domain, id);
      if (restore) {
        reportSteps(t('activity.restore', { domain }), result, t('history.updated'));
      } else {
        setMessage(resultMessage(result, t('history.updated')), !result.success);
      }
      await Promise.all([refreshCheckpoints(), refreshProjects(), refreshHosts()]);
    });
  });
}

function wireDatabase() {
  document.querySelector('#refresh-db').addEventListener('click', () => withBusy(null, refreshDatabases));

  els.browseRefreshTables.addEventListener('click', () => withBusy(els.browseRefreshTables, refreshBrowseTables));
  els.browseDb.addEventListener('change', () => withBusy(null, refreshBrowseTables));
  els.browseTables.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-table]');
    if (!btn) return;
    els.browseSql.value = `SELECT * FROM \`${btn.dataset.table}\` LIMIT 200;`;
    withBusy(btn, runBrowseQuery);
  });
  els.browseRun.addEventListener('click', () => withBusy(els.browseRun, runBrowseQuery));

  els.dbForm.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(els.dbForm.querySelector('button[type="submit"]'), async () => {
      setRunning(t('msg.creatingDb'));
      const result = await window.api.db.create(els.dbName.value.trim());
      setMessage(resultMessage(result, t('fb.dbCreate')), !result.success);
      if (result.success) {
        els.dbName.value = '';
        await refreshDatabases();
      }
    });
  });

  els.dbImportForm.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(els.dbImportForm.querySelector('button[type="submit"]'), async () => {
      const dbName = els.dbImportName.value.trim();
      const tables = await window.api.db.listTables(dbName);
      if (tables.success && tables.tables.length > 0) {
        const ok = confirm(t('confirm.import', { db: dbName }));
        if (!ok) return;
      }

      setRunning(t('msg.importingDb'));
      const result = await window.api.db.import({
        dbName,
        createIfMissing: els.dbImportCreate.checked
      });
      setMessage(resultMessage(result, t('fb.dbImport')), !result.success);
      if (result.success) {
        await refreshDatabases();
      }
    });
  });

  els.dbList.addEventListener('click', (event) => {
    const browseButton = event.target.closest('[data-browse-db-name]');
    if (browseButton) {
      const dbName = browseButton.dataset.browseDbName;
      els.browseDb.value = dbName;
      withBusy(browseButton, async () => {
        await refreshBrowseTables();
        setMessage(t('fb.dbLoaded', { db: dbName }));
      });
      return;
    }

    const exportButton = event.target.closest('[data-export-db]');
    if (exportButton) {
      withBusy(exportButton, () => openExportPanel(exportButton.dataset.exportDb));
      return;
    }

    const button = event.target.closest('[data-drop-db]');
    if (!button) return;

    const name = button.dataset.dropDb;
    if (!confirm(t('confirm.dropDb', { db: name }))) return;
    if (!confirmDelete(name)) return;

    withBusy(button, async () => {
      setRunning(t('msg.droppingDb', { db: name }));
      const result = await window.api.db.drop(name);
      setMessage(resultMessage(result, t('fb.dbDelete')), !result.success);
      if (result.success) {
        await refreshDatabases();
      }
    });
  });

  document.querySelector('#db-export-cancel').addEventListener('click', () => {
    els.dbExportForm.hidden = true;
    state.exportDbName = null;
  });

  els.dbExportForm.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(els.dbExportForm.querySelector('button[type="submit"]'), async () => {
      const payload = buildExportPayload();
      if (payload.tableMode === 'selected' && payload.selectedTables.length === 0) {
        setMessage(t('msg.chooseTable'), true);
        return;
      }

      setRunning(t('msg.exportingDb'));
      const result = await window.api.db.export(payload);
      setMessage(result.path ? `${resultMessage(result, t('fb.dbExport'))} ${result.path}` : resultMessage(result, t('fb.dbExport')), !result.success);
    });
  });

  document.querySelector('#open-phpmyadmin').addEventListener('click', () => withBusy(null, async () => {
    setRunning(t('msg.phpMyAdminPrep'));
    const result = await window.api.db.openPhpMyAdmin();
    setMessage(resultMessage(result, t('fb.phpMyAdmin')), !result.success);
  }));
}

function wireTeam() {
  if (!hasTeamApi()) return;
  els.refreshTeam.addEventListener('click', () => withBusy(null, refreshTeamProjects));
  els.testTeam.addEventListener('click', () => withBusy(els.testTeam, () => refreshTeamStatus(true)));
  if (els.teamApplyInvite) {
    els.teamApplyInvite.addEventListener('click', () => withBusy(els.teamApplyInvite, applyInviteString));
  }
  if (els.teamWizardCheckout) {
    els.teamWizardCheckout.addEventListener('click', () => {
      const domain = els.teamWizardProject.value;
      if (domain) checkoutAndStart(domain, els.teamWizardCheckout);
    });
  }
  if (els.teamRefreshAdmin) {
    els.teamRefreshAdmin.addEventListener('click', () => withBusy(els.teamRefreshAdmin, refreshTeamAdmin));
  }

  els.teamProjectsList.addEventListener('click', (event) => {
    const staging = event.target.closest('[data-open-staging]');
    const checkout = event.target.closest('[data-team-checkout]');
    const pushRelease = event.target.closest('[data-team-push-release]');
    const heartbeat = event.target.closest('[data-team-heartbeat]');
    const pullDb = event.target.closest('[data-team-pull-db]');
    const pushDb = event.target.closest('[data-team-push-db]');
    const pullMedia = event.target.closest('[data-team-pull-media]');
    const pushMedia = event.target.closest('[data-team-push-media]');

    if (staging) {
      window.open(staging.dataset.openStaging, '_blank', 'noopener');
      return;
    }

    if (checkout) {
      const domain = checkout.dataset.teamCheckout;
      checkoutAndStart(domain, checkout);
      return;
    }

    if (pushRelease) {
      const domain = pushRelease.dataset.teamPushRelease;
      if (!confirm(t('confirm.pushRelease', { domain }))) return;
      withBusy(pushRelease, () => teamPushAndRelease(domain));
      return;
    }

    if (heartbeat) {
      const domain = heartbeat.dataset.teamHeartbeat;
      withBusy(heartbeat, async () => {
        const result = await window.api.team.heartbeat(domain, RESERVATION_TTL_MINUTES);
        setMessage(resultMessage(result, t('fb.reservationExtended', { domain })), !result.success);
        await refreshTeamProjects();
      });
      return;
    }

    if (pullDb) {
      const domain = pullDb.dataset.teamPullDb;
      if (!confirm(t('confirm.pullDb', { domain }))) return;
      withBusy(pullDb, async () => {
        setRunning(t('msg.pullingDb', { domain }));
        const result = await window.api.team.pullDatabase(domain);
        reportSteps(t('activity.pullDb', { domain }), result, t('fb.dbPulled', { domain }));
        await Promise.all([refreshProjects(), refreshTeamProjects(), refreshDatabases()]);
      });
      return;
    }

    if (pushDb) {
      const domain = pushDb.dataset.teamPushDb;
      if (!confirm(t('confirm.pushDb', { domain }))) return;
      withBusy(pushDb, async () => {
        setRunning(t('msg.pushingDb', { domain }));
        const result = await window.api.team.pushDatabase(domain);
        reportSteps(t('activity.pushDb', { domain }), result, t('fb.dbPushed', { domain }));
        await Promise.all([refreshProjects(), refreshTeamProjects(), refreshDatabases()]);
      });
      return;
    }

    if (pullMedia) {
      const domain = pullMedia.dataset.teamPullMedia;
      if (!confirm(t('confirm.pullMedia', { domain }))) return;
      withBusy(pullMedia, async () => {
        setRunning(t('msg.pullingMedia', { domain }));
        const result = await window.api.team.pullMedia(domain);
        reportSteps(t('activity.pullMedia', { domain }), result, t('fb.mediaPulled', { domain }));
        await Promise.all([refreshProjects(), refreshTeamProjects()]);
      });
      return;
    }

    if (pushMedia) {
      const domain = pushMedia.dataset.teamPushMedia;
      if (!confirm(t('confirm.pushMedia', { domain }))) return;
      withBusy(pushMedia, async () => {
        setRunning(t('msg.pushingMedia', { domain }));
        const result = await window.api.team.pushMedia(domain);
        reportSteps(t('activity.pushMedia', { domain }), result, t('fb.mediaPushed', { domain }));
        await Promise.all([refreshProjects(), refreshTeamProjects()]);
      });
    }
  });

  els.teamAdminUsers.addEventListener('click', (event) => {
    const disable = event.target.closest('[data-disable-user]');
    const enable = event.target.closest('[data-enable-user]');
    const rotate = event.target.closest('[data-rotate-user]');
    const del = event.target.closest('[data-delete-user]');
    const button = disable || enable || rotate || del;
    if (!button) return;

    const userId = button.dataset.disableUser || button.dataset.enableUser || button.dataset.rotateUser || button.dataset.deleteUser;
    const user = state.teamUsers.find((item) => item.id === userId);
    const name = user ? user.name : userId;

    if (disable && !confirm(t('confirm.disableUser', { name }))) return;
    if (del && !confirm(t('confirm.deleteUser', { name }))) return;
    if (del && !confirmDelete(name)) return;

    withBusy(button, async () => {
      let result;
      if (disable) result = await window.api.team.disableUser(userId);
      if (enable) result = await window.api.team.enableUser(userId);
      if (rotate) result = await window.api.team.rotateUserToken(userId);
      if (del) result = await window.api.team.deleteUser(userId);

      if (rotate && result.success && result.token) {
        const invite = buildInviteString({
          hubUrl: state.settings ? state.settings.teamHubUrl : '',
          token: result.token,
          userName: name
        });
        setMessage(t('fb.tokenRotated', { token: result.token, invite }));
      } else {
        setMessage(resultMessage(result, t('fb.adminUpdated')), !result.success);
      }
      await Promise.all([refreshTeamProjects(), refreshTeamAdmin()]);
    });
  });

  els.teamAdminProjects.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-handover-domain]');
    if (!form) return;
    event.preventDefault();
    const domain = form.dataset.handoverDomain;
    const toUserId = form.querySelector('select').value;
    withBusy(form.querySelector('button[type="submit"]'), async () => {
      const result = await window.api.team.handoverProject(domain, toUserId);
      setMessage(resultMessage(result, t('fb.handover')), !result.success);
      await refreshTeamProjects();
    });
  });

  // Delete a project's shared data from the Hub (admin-only, non-local).
  els.teamAdminProjects.addEventListener('click', (event) => {
    const del = event.target.closest('[data-delete-hub]');
    if (!del) return;
    const domain = del.dataset.deleteHub;
    if (!confirm(t('confirm.deleteHubProject', { domain }))) return;
    if (!confirmDelete(domain)) return;
    withBusy(del, async () => {
      const result = await window.api.team.deleteHubProject(domain);
      setMessage(resultMessage(result, t('fb.hubProjectDeleted', { domain })), !result.success);
      await Promise.all([refreshTeamProjects(), refreshTeamAdmin()]);
    });
  });

  // Create a Hub user (member or admin) and show the generated access token +
  // an invite string the new colleague pastes into their Studio.
  if (els.teamCreateUser) {
    els.teamCreateUser.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = els.newUserName.value.trim();
      if (!name) { setMessage(t('team.needUserName'), true); return; }
      const role = els.newUserRole.value === 'admin' ? 'admin' : 'member';
      withBusy(els.teamCreateUser.querySelector('button[type="submit"]'), async () => {
        const result = await window.api.team.createUser({ name, role });
        if (!result.success || !result.token) {
          setMessage(resultMessage(result, t('team.createUserFailed')), true);
          return;
        }
        els.newUserName.value = '';
        els.newUserRole.value = 'member';
        const invite = buildInviteString({
          hubUrl: state.settings ? state.settings.teamHubUrl : '',
          token: result.token,
          userName: name
        });
        renderNewUserResult(name, role, result.token, invite);
        setMessage(t('team.userCreated', { name, role }));
        await refreshTeamAdmin();
      });
    });
  }
}

async function runHostMutation(action, busyEl, successMessage) {
  return withBusy(busyEl, async () => {
    const result = await action();
    setMessage(resultMessage(result, successMessage), !result.success);
    if (result.success) await refreshHosts();
    return result;
  });
}

function wireHosts() {
  document.querySelector('#refresh-hosts').addEventListener('click', () => withBusy(null, refreshHosts));

  els.applyHosts.addEventListener('click', () => withBusy(els.applyHosts, async () => {
    setRunning(t('msg.writingHosts'));
    const result = await window.api.hosts.apply();
    setMessage(resultMessage(result, t('fb.hostsUpdated')), !result.success);
  }));

  els.hostsGroupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runHostMutation(() => window.api.hosts.addGroup(els.hostsGroupName.value.trim()), els.hostsGroupForm.querySelector('button'), t('fb.groupAdded'))
      .then((result) => { if (result.success) els.hostsGroupName.value = ''; });
  });

  els.hostsRemoteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runHostMutation(
      () => window.api.hosts.addRemote(els.hostsRemoteName.value.trim(), els.hostsRemoteUrl.value.trim(), 0),
      els.hostsRemoteForm.querySelector('button'),
      t('fb.remoteAdded')
    ).then((result) => {
      if (result.success) {
        els.hostsRemoteName.value = '';
        els.hostsRemoteUrl.value = '';
      }
    });
  });

  els.hostsGroups.addEventListener('submit', (event) => {
    const form = event.target.closest('.host-add-entry');
    if (!form) return;
    event.preventDefault();
    const groupId = form.dataset.group;
    const domain = form.querySelector('.host-add-domain').value.trim();
    const ip = form.querySelector('.host-add-ip').value.trim();
    runHostMutation(() => window.api.hosts.addEntry(groupId, ip, domain), form.querySelector('button'), t('fb.entryAdded'));
  });

  els.hostsGroups.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const d = target.dataset;

    if (d.toggleEntry) {
      const entry = findEntryById(d.toggleEntry);
      runHostMutation(() => window.api.hosts.toggleEntry(d.toggleEntry, !(entry && entry.enabled)), target, t('fb.entryUpdated'));
    } else if (d.removeEntry) {
      const entry = findEntryById(d.removeEntry);
      if (!confirmDelete(entry ? entry.domain : d.removeEntry)) return;
      runHostMutation(() => window.api.hosts.removeEntry(d.removeEntry), target, t('fb.entryRemoved'));
    } else if (d.toggleGroup) {
      const group = state.hostsModel.groups.find((g) => g.id === d.toggleGroup);
      runHostMutation(() => window.api.hosts.toggleGroup(d.toggleGroup, !(group && group.enabled)), target, t('fb.groupUpdated'));
    } else if (d.removeGroup) {
      if (!confirm(t('confirm.deleteGroup'))) return;
      const group = state.hostsModel.groups.find((item) => item.id === d.removeGroup);
      if (!confirmDelete(group ? group.name : d.removeGroup)) return;
      runHostMutation(() => window.api.hosts.removeGroup(d.removeGroup), target, t('fb.groupRemoved'));
    }
  });

  els.hostsRemotes.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const d = target.dataset;

    if (d.toggleRemote) {
      const remote = state.hostsModel.remotes.find((r) => r.id === d.toggleRemote);
      runHostMutation(() => window.api.hosts.toggleRemote(d.toggleRemote, !(remote && remote.enabled)), target, t('fb.remoteUpdated'));
    } else if (d.refreshRemote) {
      runHostMutation(() => window.api.hosts.refreshRemote(d.refreshRemote), target, t('fb.remoteRefreshed'));
    } else if (d.removeRemote) {
      const remote = state.hostsModel.remotes.find((item) => item.id === d.removeRemote);
      if (!confirmDelete(remote ? remote.name : d.removeRemote)) return;
      runHostMutation(() => window.api.hosts.removeRemote(d.removeRemote), target, t('fb.remoteRemoved'));
    }
  });
}

function findEntryById(entryId) {
  if (!state.hostsModel) return null;
  for (const group of state.hostsModel.groups) {
    const entry = group.entries.find((item) => item.id === entryId);
    if (entry) return entry;
  }
  return null;
}

function wireSettings() {
  if (els.settingsLanguage) {
    els.settingsLanguage.addEventListener('change', () => {
      applyLanguage(els.settingsLanguage.value);
      refreshTunnelStatus().catch(() => {});
    });
  }

  document.querySelector('#pick-sites-path').addEventListener('click', () => withBusy(null, async () => {
    const result = await window.api.settings.pickDirectory();
    if (result.success && result.path) {
      els.settingsSitesPath.value = result.path;
    }
  }));

  els.phpInstallBtn.addEventListener('click', () => withBusy(els.phpInstallBtn, async () => {
    const version = els.phpInstallInput.value.trim();
    if (!version) {
      setMessage(t('php.needVersion'), true);
      return;
    }
    setRunning(t('msg.installingPhp', { version }));
    const result = await window.api.php.install(version);
    setMessage(resultMessage(result, t('fb.phpInstall')), !result.success);
    if (result.success) {
      els.phpInstallInput.value = '';
      await refreshPhpVersions();
    }
  }));

  els.applyResourcesBtn.addEventListener('click', () => withBusy(els.applyResourcesBtn, async () => {
    const cpus = parseInt(els.settingsCpus.value, 10);
    const memory = parseInt(els.settingsMemory.value, 10);
    await window.api.settings.save({ cpus, memory });
    setRunning(t('msg.applyingResources', { cpus, memory }));
    const result = await window.api.vm.setResources(cpus, memory);
    setMessage(resultMessage(result, t('fb.resourcesApplied')), !result.success);
    await refreshVmStatus();
  }));

  if (hasTeamApi() && els.teamTunnelStart) {
    els.teamTunnelStart.addEventListener('click', () => withBusy(els.teamTunnelStart, async () => {
      const saved = await saveSettingsFromForm();
      if (!saved.success) {
        setMessage(saved.message, true);
        return;
      }
      const result = await window.api.team.startTunnel();
      setMessage(resultMessage(result, t('fb.tunnelStarted')), !result.success);
      await refreshTunnelStatus();
      await refreshTeamStatus();
    }));
  }

  if (hasTeamApi() && els.teamTunnelStop) {
    els.teamTunnelStop.addEventListener('click', () => withBusy(els.teamTunnelStop, async () => {
      const result = await window.api.team.stopTunnel();
      setMessage(resultMessage(result, t('fb.tunnelStopped')), !result.success);
      await refreshTunnelStatus();
      await refreshTeamStatus();
    }));
  }

  els.settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(els.settingsForm.querySelector('button[type="submit"]'), async () => {
      const wasTeamMode = isTeamEnabled();
      setRunning(t('msg.savingSettings'));
      const result = await saveSettingsFromForm();
      setMessage(result.success ? t('fb.settingsSaved') : resultMessage(result, t('fb.settingsSaved')), !result.success);
      if (result.success) {
        await refreshTunnelStatus();
        const status = await refreshTeamStatus();
        if (!wasTeamMode && result.settings && result.settings.teamMode && status.success && status.enabled) {
          await syncLocalCheckpointsToHub();
          await refreshTeamProjects();
        }
      }
    });
  });
}

// ---- First-run onboarding tutorial ----
const TUTORIAL_STEPS = [
  { key: 'welcome', tab: 'projects', highlight: null },
  { key: 'vm', tab: 'projects', highlight: '.vm-controls' },
  { key: 'projects', tab: 'projects', highlight: '.tab[data-tab="projects"]' },
  { key: 'database', tab: 'database', highlight: '.tab[data-tab="database"]' },
  { key: 'hosts', tab: 'hosts', highlight: '.tab[data-tab="hosts"]' },
  { key: 'settings', tab: 'settings', highlight: '.tab[data-tab="settings"]' },
  { key: 'faq', tab: 'faq', highlight: '.tab[data-tab="faq"]' },
  { key: 'done', tab: 'projects', highlight: null }
];
const tut = {};
let tutorialIndex = 0;

function clearTutorialHighlight() {
  document.querySelectorAll('.tutorial-highlight').forEach((el) => el.classList.remove('tutorial-highlight'));
}

function showTutorialStep(index) {
  tutorialIndex = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, index));
  const step = TUTORIAL_STEPS[tutorialIndex];
  const tabBtn = document.querySelector(`.tab[data-tab="${step.tab}"]`);
  if (tabBtn) tabBtn.click();
  clearTutorialHighlight();
  if (step.highlight) {
    const target = document.querySelector(step.highlight);
    if (target) target.classList.add('tutorial-highlight');
  }
  tut.title.textContent = t(`tutorial.${step.key}.title`);
  tut.body.textContent = t(`tutorial.${step.key}.body`);
  tut.progress.innerHTML = TUTORIAL_STEPS
    .map((_, i) => `<span class="tutorial-dot${i === tutorialIndex ? ' is-active' : ''}"></span>`)
    .join('');
  tut.back.hidden = tutorialIndex === 0;
  const last = tutorialIndex === TUTORIAL_STEPS.length - 1;
  tut.next.textContent = last ? t('tutorial.finish') : t('tutorial.next');
  tut.skip.hidden = last;
}

function startTutorial() {
  if (!tut.overlay) return;
  tutorialIndex = 0;
  tut.overlay.hidden = false;
  showTutorialStep(0);
}

async function endTutorial() {
  clearTutorialHighlight();
  if (tut.overlay) tut.overlay.hidden = true;
  try {
    if (state.settings) {
      state.settings.onboardingDone = true;
      await window.api.settings.save({ ...state.settings, onboardingDone: true });
    }
  } catch (_error) {
    /* onboarding flag is best-effort — never block the app on it */
  }
}

function wireTutorial() {
  tut.overlay = document.querySelector('#tutorial-overlay');
  if (!tut.overlay) return;
  tut.title = document.querySelector('#tutorial-title');
  tut.body = document.querySelector('#tutorial-body');
  tut.progress = document.querySelector('#tutorial-progress');
  tut.back = document.querySelector('#tutorial-back');
  tut.next = document.querySelector('#tutorial-next');
  tut.skip = document.querySelector('#tutorial-skip');
  tut.next.addEventListener('click', () => {
    if (tutorialIndex >= TUTORIAL_STEPS.length - 1) endTutorial();
    else showTutorialStep(tutorialIndex + 1);
  });
  tut.back.addEventListener('click', () => showTutorialStep(tutorialIndex - 1));
  tut.skip.addEventListener('click', () => endTutorial());
  const restartBtn = document.querySelector('#restart-tutorial');
  if (restartBtn) restartBtn.addEventListener('click', () => startTutorial());
}

function maybeStartTutorial() {
  if (state.settings && !state.settings.onboardingDone) startTutorial();
}

async function boot() {
  wireTabs();
  wireActivity();
  wireVmControls();
  wireProjects();
  wireImport();
  wireCheckpoints();
  wireTeam();
  wireDatabase();
  wireHosts();
  wireSettings();
  wireUiBlocks();
  wireTutorial();

  if (window.api.hosts.onChanged) {
    window.api.hosts.onChanged(() => {
      Promise.all([refreshHosts(), refreshProjects()]).catch((error) => setMessage(error.message, true));
    });
  }

  await refreshSettings();
  initUiBlocks();
  await refreshCmsAdapters();
  await refreshPhpVersions();
  await refreshTunnelStatus();
  await refreshTeamStatus();
  await Promise.all([
    refreshVmStatus(),
    refreshProjects(),
    refreshHosts()
  ]);
  await refreshCheckpoints();
  if (isTeamEnabled()) {
    await refreshTeamProjects();
    runReservationGuard().catch((error) => setMessage(error.message, true));
  }

  setInterval(() => {
    if (isTeamEnabled()) {
      refreshTeamStatus().catch(() => {});
    }
  }, 30000);
  setInterval(() => {
    runReservationGuard().catch((error) => setMessage(error.message, true));
  }, RESERVATION_CHECK_MS);

  maybeStartTutorial();
}

boot().catch((error) => {
  setMessage(error.message || String(error), true);
});
