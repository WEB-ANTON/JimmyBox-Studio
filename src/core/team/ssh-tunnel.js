const { spawn } = require('child_process');
const fs = require('fs/promises');
const settings = require('../settings/store');

const HOST_RE = /^[A-Za-z0-9._:-]+$/;
const USER_RE = /^[A-Za-z0-9._-]+$/;

let tunnelProcess = null;
let tunnelConfig = null;
let lastError = '';

function clampPort(value, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

function assertSafeHost(value, label) {
  const clean = String(value || '').trim();
  if (!clean || !HOST_RE.test(clean)) {
    throw new Error(`${label} must be a hostname or IP address.`);
  }
  return clean;
}

function assertSafeUser(value) {
  const clean = String(value || '').trim();
  if (!clean || !USER_RE.test(clean)) {
    throw new Error('SSH user may only contain letters, numbers, dots, underscores, and hyphens.');
  }
  return clean;
}

function currentStatus() {
  const running = Boolean(tunnelProcess && !tunnelProcess.killed && tunnelProcess.exitCode === null);
  return {
    success: true,
    enabled: Boolean(tunnelConfig),
    running,
    pid: running ? tunnelProcess.pid : null,
    config: tunnelConfig,
    lastError
  };
}

async function buildConfig() {
  const result = await settings.getSettings();
  if (!result.success) return result;

  const s = result.settings;
  if (!s.teamTunnelEnabled) {
    return { success: false, disabled: true, message: 'SSH tunnel is disabled.' };
  }

  const config = {
    user: assertSafeUser(s.teamTunnelUser),
    host: assertSafeHost(s.teamTunnelHost, 'SSH host'),
    sshPort: clampPort(s.teamTunnelSshPort, 22),
    localHost: assertSafeHost(s.teamTunnelLocalHost || '127.0.0.1', 'Local bind host'),
    localPort: clampPort(s.teamTunnelLocalPort, 17345),
    remoteHost: assertSafeHost(s.teamTunnelRemoteHost || '127.0.0.1', 'Remote Hub host'),
    remotePort: clampPort(s.teamTunnelRemotePort, 7345),
    identityFile: String(s.teamTunnelIdentityFile || '').trim()
  };

  if (config.identityFile) {
    const stat = await fs.stat(settings.expandHome(config.identityFile)).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error(`SSH identity file not found: ${config.identityFile}`);
    }
  }

  return { success: true, config };
}

function sameConfig(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function cleanupExitedProcess() {
  if (tunnelProcess && tunnelProcess.exitCode !== null) {
    tunnelProcess = null;
    tunnelConfig = null;
  }
}

function sshArgs(config) {
  const args = [
    '-N',
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-p', String(config.sshPort),
    '-L', `${config.localHost}:${config.localPort}:${config.remoteHost}:${config.remotePort}`
  ];

  if (config.identityFile) {
    args.push('-i', settings.expandHome(config.identityFile));
  }

  args.push(`${config.user}@${config.host}`);
  return args;
}

function waitForStart(child, timeoutMs = 1800) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      resolve(result);
    };
    const onExit = (code, signal) => finish({ success: false, message: lastError || `SSH tunnel exited (${code || signal}).` });
    const onError = (error) => finish({ success: false, message: error.message });
    const timer = setTimeout(() => finish({ success: true }), timeoutMs);

    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function startTunnel() {
  try {
    cleanupExitedProcess();
    const built = await buildConfig();
    if (!built.success) return built;

    if (tunnelProcess && sameConfig(tunnelConfig, built.config)) {
      return {
        success: true,
        message: 'SSH tunnel is already running.',
        status: currentStatus()
      };
    }

    if (tunnelProcess) {
      await stopTunnel();
    }

    lastError = '';
    tunnelConfig = built.config;
    const child = spawn('/usr/bin/ssh', sshArgs(built.config), {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text) lastError = text;
    });

    child.on('exit', (code, signal) => {
      if (!lastError && (code || signal)) {
        lastError = `SSH tunnel exited (${code || signal}).`;
      }
      if (tunnelProcess === child) {
        tunnelProcess = null;
        tunnelConfig = null;
      }
    });

    tunnelProcess = child;
    const started = await waitForStart(child);
    if (!started.success) {
      tunnelProcess = null;
      tunnelConfig = null;
      return { success: false, message: started.message };
    }

    return {
      success: true,
      message: `SSH tunnel running on ${built.config.localHost}:${built.config.localPort}.`,
      status: currentStatus()
    };
  } catch (error) {
    lastError = error.message;
    return { success: false, message: error.message };
  }
}

async function stopTunnel() {
  if (!tunnelProcess) {
    tunnelConfig = null;
    return { success: true, message: 'SSH tunnel is not running.', status: currentStatus() };
  }

  const child = tunnelProcess;
  tunnelProcess = null;
  tunnelConfig = null;
  child.kill('SIGTERM');

  setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 1500).unref();

  return { success: true, message: 'SSH tunnel stopped.', status: currentStatus() };
}

function status() {
  cleanupExitedProcess();
  return currentStatus();
}

module.exports = {
  startTunnel,
  stopTunnel,
  status
};
