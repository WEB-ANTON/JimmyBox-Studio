const os = require('os');
const path = require('path');

const DEFAULTS = {
  language: 'de',
  onboardingDone: false,
  sitesPath: '~/JimmyboxStudio/Sites',
  basePlugins: '',
  defaultPhpVersion: '8.2',
  cpus: 2,
  memory: 4,
  teamMode: false,
  teamHubUrl: '',
  teamToken: '',
  teamUserName: os.userInfo().username || '',
  teamTunnelEnabled: false,
  teamTunnelAutoStart: true,
  teamTunnelUser: 'deploy',
  teamTunnelHost: '',
  teamTunnelSshPort: 22,
  teamTunnelLocalHost: '127.0.0.1',
  teamTunnelLocalPort: 17345,
  teamTunnelRemoteHost: '127.0.0.1',
  teamTunnelRemotePort: 7345,
  teamTunnelIdentityFile: '',
  uiBlocks: {
    collapsed: {},
    order: {}
  }
};

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

let storePromise;

async function getStore() {
  if (!storePromise) {
    storePromise = import('electron-store').then((module) => {
      const Store = module.default || module;
      return new Store({
        name: 'jimmybox-studio',
        defaults: DEFAULTS
      });
    });
  }

  return storePromise;
}

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function normalizeSettings(value) {
  const language = value && ['de', 'en'].includes(value.language) ? value.language : DEFAULTS.language;
  const teamHubUrl = value && value.teamHubUrl ? String(value.teamHubUrl).trim().replace(/\/+$/, '') : '';
  const tunnelLocalHost = value && value.teamTunnelLocalHost ? String(value.teamTunnelLocalHost).trim() : DEFAULTS.teamTunnelLocalHost;
  const tunnelRemoteHost = value && value.teamTunnelRemoteHost ? String(value.teamTunnelRemoteHost).trim() : DEFAULTS.teamTunnelRemoteHost;
  const rawBlocks = value && value.uiBlocks && typeof value.uiBlocks === 'object' ? value.uiBlocks : {};
  const rawCollapsed = rawBlocks.collapsed && typeof rawBlocks.collapsed === 'object' ? rawBlocks.collapsed : {};
  const rawOrder = rawBlocks.order && typeof rawBlocks.order === 'object' ? rawBlocks.order : {};
  const collapsed = Object.fromEntries(
    Object.entries(rawCollapsed)
      .filter(([key]) => /^[A-Za-z0-9._:-]+$/.test(key))
      .map(([key, enabled]) => [key, Boolean(enabled)])
  );
  const order = Object.fromEntries(
    Object.entries(rawOrder)
      .filter(([key, list]) => /^[A-Za-z0-9._:-]+$/.test(key) && Array.isArray(list))
      .map(([key, list]) => [
        key,
        list.map((item) => String(item)).filter((item) => /^[A-Za-z0-9._:-]+$/.test(item))
      ])
  );
  const next = {
    language,
    onboardingDone: Boolean(value && value.onboardingDone),
    sitesPath: value && value.sitesPath ? String(value.sitesPath).trim() : DEFAULTS.sitesPath,
    basePlugins: value && value.basePlugins ? String(value.basePlugins).trim() : '',
    defaultPhpVersion: value && value.defaultPhpVersion ? String(value.defaultPhpVersion) : DEFAULTS.defaultPhpVersion,
    cpus: clampInt(value && value.cpus, DEFAULTS.cpus, 1, 12),
    memory: clampInt(value && value.memory, DEFAULTS.memory, 1, 32),
    teamMode: Boolean(value && value.teamMode),
    teamHubUrl,
    teamToken: value && value.teamToken ? String(value.teamToken).trim() : '',
    teamUserName: value && value.teamUserName ? String(value.teamUserName).trim() : DEFAULTS.teamUserName,
    teamTunnelEnabled: Boolean(value && value.teamTunnelEnabled),
    teamTunnelAutoStart: value && Object.prototype.hasOwnProperty.call(value, 'teamTunnelAutoStart') ? Boolean(value.teamTunnelAutoStart) : DEFAULTS.teamTunnelAutoStart,
    teamTunnelUser: value && value.teamTunnelUser ? String(value.teamTunnelUser).trim() : DEFAULTS.teamTunnelUser,
    teamTunnelHost: value && value.teamTunnelHost ? String(value.teamTunnelHost).trim() : DEFAULTS.teamTunnelHost,
    teamTunnelSshPort: clampInt(value && value.teamTunnelSshPort, DEFAULTS.teamTunnelSshPort, 1, 65535),
    teamTunnelLocalHost: tunnelLocalHost,
    teamTunnelLocalPort: clampInt(value && value.teamTunnelLocalPort, DEFAULTS.teamTunnelLocalPort, 1, 65535),
    teamTunnelRemoteHost: tunnelRemoteHost,
    teamTunnelRemotePort: clampInt(value && value.teamTunnelRemotePort, DEFAULTS.teamTunnelRemotePort, 1, 65535),
    teamTunnelIdentityFile: value && value.teamTunnelIdentityFile ? String(value.teamTunnelIdentityFile).trim() : '',
    uiBlocks: { collapsed, order }
  };

  if (!/^\d+\.\d+$/.test(next.defaultPhpVersion)) {
    next.defaultPhpVersion = DEFAULTS.defaultPhpVersion;
  }

  if (next.teamHubUrl && !/^https?:\/\//i.test(next.teamHubUrl)) {
    next.teamHubUrl = '';
  }

  if (!next.teamHubUrl || !next.teamToken) {
    next.teamMode = false;
  }

  if (!next.teamTunnelHost || !next.teamTunnelUser) {
    next.teamTunnelEnabled = false;
  }

  return next;
}

function withExpanded(settings) {
  return {
    ...settings,
    expandedSitesPath: expandHome(settings.sitesPath)
  };
}

async function getSettings() {
  const store = await getStore();
  return {
    success: true,
    settings: withExpanded(normalizeSettings(store.store))
  };
}

async function saveSettings(payload) {
  const store = await getStore();
  const next = normalizeSettings({
    ...store.store,
    ...payload
  });

  store.set(next);
  return {
    success: true,
    message: 'Settings saved.',
    settings: withExpanded(next)
  };
}

async function getExpandedSitesPath() {
  const result = await getSettings();
  return result.settings.expandedSitesPath;
}

async function getBasePlugins() {
  const result = await getSettings();
  return result.settings.basePlugins;
}

async function getResources() {
  const result = await getSettings();
  return { cpus: result.settings.cpus, memory: result.settings.memory };
}

module.exports = {
  DEFAULTS,
  expandHome,
  getSettings,
  saveSettings,
  getExpandedSitesPath,
  getBasePlugins,
  getResources
};
