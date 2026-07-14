const fs = require('fs/promises');
const { accessSync, constants: fsConstants } = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const settings = require('../settings/store');

const execFileAsync = promisify(execFile);
const INSTANCE_NAME = 'jimmybox-studio';
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');

function pathIncludesAsar(value) {
  return String(value || '').split(path.sep).some((part) => part.endsWith('.asar'));
}

function resolveRunCwd() {
  if (pathIncludesAsar(ROOT_DIR) && process.resourcesPath) {
    return process.resourcesPath;
  }

  return ROOT_DIR;
}

// Prefer the copy of limactl bundled with the app (so users don't need to run
// `brew install lima`); fall back to a system install if present.
function resolveLimactl() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'lima', 'bin', 'limactl'));
  candidates.push(path.join(ROOT_DIR, 'vendor', 'lima', 'bin', 'limactl'));
  candidates.push('/opt/homebrew/bin/limactl');
  for (const candidate of candidates) {
    try { accessSync(candidate, fsConstants.X_OK); return candidate; } catch (_error) { /* try next */ }
  }
  return 'limactl';
}
const LIMACTL = resolveLimactl();
const RUN_CWD = resolveRunCwd();
const TEMPLATE_PATH = path.join(__dirname, 'lima-template.yaml');
const PROVISION_DIR = path.join(__dirname, 'provision');
const RUNTIME_TEMPLATE_PATH = path.join(os.tmpdir(), 'jimmybox-studio-lima-template.yaml');

async function runLimactl(args, options = {}) {
  try {
    const result = await execFileAsync(LIMACTL, args, {
      cwd: RUN_CWD,
      maxBuffer: 1024 * 1024 * 16,
      ...options
    });

    return {
      success: true,
      stdout: result.stdout || '',
      stderr: result.stderr || ''
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return missingLimactl();
    }

    return {
      success: false,
      message: error.stderr || error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message
    };
  }
}

function missingLimactl() {
  return {
    success: false,
    state: 'missing',
    message: 'limactl was not found. Install Lima with: brew install lima'
  };
}

async function ensureLimactl() {
  const result = await runLimactl(['--version']);
  if (!result.success) return result;
  return { success: true };
}

function normalizeState(value) {
  const state = String(value || '').toLowerCase();
  if (state.includes('running')) return 'running';
  if (state.includes('stopped')) return 'stopped';
  if (state.includes('exited')) return 'stopped';
  return state || 'missing';
}

function parseListJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  return trimmed
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function status() {
  const limactl = await ensureLimactl();
  if (!limactl.success) return limactl;

  const result = await runLimactl(['list', '--json']);
  if (!result.success) return result;

  try {
    const instances = parseListJson(result.stdout);
    const match = instances.find((item) => item.name === INSTANCE_NAME);

    return {
      success: true,
      state: match ? normalizeState(match.status || match.state) : 'missing'
    };
  } catch (error) {
    return {
      success: false,
      state: 'missing',
      message: `Could not parse limactl list output: ${error.message}`
    };
  }
}

async function readProvisionScript() {
  const files = ['00-base.sh', '10-php.sh', '20-apache.sh', '30-mariadb.sh'];

  // The combined script MUST start with the shebang on line 1, otherwise lima
  // runs it with /bin/sh (dash) and `set -o pipefail` aborts immediately. We
  // strip the per-file shebang/set/export lines and emit a single header.
  const chunks = ['#!/bin/bash', 'set -euo pipefail', 'export DEBIAN_FRONTEND=noninteractive', ''];

  for (const file of files) {
    const raw = await fs.readFile(path.join(PROVISION_DIR, file), 'utf8');
    const body = raw
      .split('\n')
      .filter((line) => !line.trim().startsWith('#!'))
      .filter((line) => line.trim() !== 'set -euo pipefail')
      .filter((line) => line.trim() !== 'export DEBIAN_FRONTEND=noninteractive')
      .join('\n')
      .trim();
    chunks.push(`# ${file}`, body, '');
  }

  return chunks.join('\n');
}

function indentYamlBlock(value, spaces) {
  const prefix = ' '.repeat(spaces);
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

async function writeRuntimeTemplate() {
  const sitesPath = await settings.getExpandedSitesPath();
  await fs.mkdir(sitesPath, { recursive: true });

  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const provisionScript = await readProvisionScript();
  const resources = await settings.getResources();
  const rendered = template
    .replace('${SITES_PATH}', yamlString(sitesPath))
    .replace('${CPUS}', String(resources.cpus))
    .replace('${MEMORY}', String(resources.memory))
    .replace('${PROVISION_SCRIPT}', indentYamlBlock(provisionScript, 6));

  await fs.writeFile(RUNTIME_TEMPLATE_PATH, rendered, 'utf8');
  return RUNTIME_TEMPLATE_PATH;
}

// The host-reachable IP of the VM (its vzNAT interface, 192.168.64.x) — the
// slirp user-mode NIC (192.168.5.x) is filtered out. This is the "real IP"
// projects resolve to, like the JimmyBox 192.168.33.20.
async function getIp() {
  const result = await shell("ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -E '^192\\.168\\.' | grep -v '^192\\.168\\.5\\.' | head -1");
  if (!result.success) return result;
  const ip = String(result.stdout || '').trim().split('\n')[0].trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return { success: false, message: 'No host-reachable VM IP found (vzNAT). Restart the VM.' };
  }
  return { success: true, ip };
}

// Set the VM's CPU/RAM. Edits the instance config and restarts if running so
// the change takes effect. If the VM doesn't exist yet, the settings are used
// when it's created.
async function setResources(cpus, memory) {
  const c = Math.min(12, Math.max(1, parseInt(cpus, 10) || 2));
  const m = Math.min(32, Math.max(1, parseInt(memory, 10) || 4));

  const current = await status();
  if (current.success && current.state === 'missing') {
    return { success: true, message: `Saved — the VM will use ${c} CPUs / ${m} GiB when created.` };
  }

  const instanceYaml = path.join(os.homedir(), '.lima', INSTANCE_NAME, 'lima.yaml');
  try {
    const content = await fs.readFile(instanceYaml, 'utf8');
    const cpusRe = /^cpus:.*$/m;
    const memoryRe = /^memory:.*$/m;
    // Editing Lima's own YAML by regex is fragile: if a Lima update changes the
    // key layout the replace would silently no-op and the setting would be lost.
    // Fail loudly instead so the user knows the change was not applied.
    if (!cpusRe.test(content) || !memoryRe.test(content)) {
      return { success: false, message: 'Could not update VM config: unexpected lima.yaml format (cpus/memory keys not found).' };
    }
    const next = content
      .replace(cpusRe, `cpus: ${c}`)
      .replace(memoryRe, `memory: "${m}GiB"`);
    await fs.writeFile(instanceYaml, next, 'utf8');
  } catch (error) {
    return { success: false, message: `Could not update VM config: ${error.message}` };
  }

  const wasRunning = current.state === 'running';
  const stopped = await stop();
  if (!stopped.success) return stopped;
  if (wasRunning) {
    const started = await start();
    if (!started.success) return started;
  }
  return { success: true, message: `VM set to ${c} CPUs and ${m} GiB RAM${wasRunning ? ' (restarted)' : ''}.` };
}

async function start() {
  const limactl = await ensureLimactl();
  if (!limactl.success) return limactl;

  const current = await status();
  if (!current.success) return current;

  if (current.state === 'running') {
    return {
      success: true,
      state: 'running',
      message: 'JimmyBox Studio VM is already running.'
    };
  }

  if (current.state === 'missing') {
    const template = await writeRuntimeTemplate();
    const created = await runLimactl(['start', `--name=${INSTANCE_NAME}`, template]);
    if (!created.success) return created;

    return {
      success: true,
      state: 'running',
      message: 'JimmyBox Studio VM created and started.'
    };
  }

  const result = await runLimactl(['start', INSTANCE_NAME]);
  if (!result.success) return result;

  return {
    success: true,
    state: 'running',
    message: 'JimmyBox Studio VM started.'
  };
}

async function stop() {
  const limactl = await ensureLimactl();
  if (!limactl.success) return limactl;

  const current = await status();
  if (!current.success) return current;
  if (current.state === 'missing') {
    return {
      success: true,
      state: 'missing',
      message: 'JimmyBox Studio VM does not exist yet.'
    };
  }

  const result = await runLimactl(['stop', INSTANCE_NAME]);
  if (!result.success) return result;

  return {
    success: true,
    state: 'stopped',
    message: 'JimmyBox Studio VM stopped.'
  };
}

async function provision() {
  const started = await start();
  if (!started.success) return started;

  const files = ['00-base.sh', '10-php.sh', '20-apache.sh', '30-mariadb.sh'];
  for (const file of files) {
    const script = await fs.readFile(path.join(PROVISION_DIR, file), 'utf8');
    const remotePath = `/tmp/jimmybox-studio-${file}`;
    const encoded = Buffer.from(script, 'utf8').toString('base64');
    const result = await shell(`printf '%s' '${encoded}' | base64 -d > ${shellQuote(remotePath)} && sudo bash ${shellQuote(remotePath)}`);
    if (!result.success) return result;
  }

  return {
    success: true,
    message: 'Provisioning finished.'
  };
}

async function shell(command) {
  const limactl = await ensureLimactl();
  if (!limactl.success) return limactl;

  const current = await status();
  if (!current.success) return current;
  if (current.state !== 'running') {
    return {
      success: false,
      message: 'JimmyBox Studio VM is not running.'
    };
  }

  return runLimactl(['shell', INSTANCE_NAME, '--', 'bash', '-lc', command]);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

module.exports = {
  INSTANCE_NAME,
  status,
  start,
  stop,
  provision,
  shell,
  shellQuote,
  getIp,
  setResources
};
