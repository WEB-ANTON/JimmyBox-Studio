const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const domainAliases = require('./domain-aliases');

const execFileAsync = promisify(execFile);

const SETUP_DIR = '.jimmybox-studio';
const SETUP_FILE = 'setup.json';
const SCHEMA_VERSION = 2;
const DOMAIN_RE = domainAliases.DOMAIN_RE;
const IPV4_RE = /^(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(\.(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}$/;
const PHP_VERSION_RE = /^\d+\.\d+$/;
const CMS_SET = new Set(['wordpress', 'typo3', 'contao', 'drupal', 'joomla', 'plain']);
const LOCATION_SET = new Set(['vm', 'local']);
const DEFAULT_MEDIA_PATH = 'public/wp-content/uploads';
const KNOWN_SETUP_FIELDS = new Set([
  'schemaVersion',
  'domain',
  'cms',
  'docroot',
  'phpVersion',
  'database',
  'mediaPaths',
  'uploadsPath',
  'hosts',
  'provisioning',
  'setupRoutines',
  'staging',
  'services',
  'env'
]);

function setupPath(projectPath) {
  return path.join(projectPath, SETUP_DIR, SETUP_FILE);
}

function cleanDomain(value, fallback = '') {
  const raw = String(value || fallback || '').trim();
  const clean = raw ? domainAliases.canonicalProjectDomain(raw) : '';
  if (clean && !DOMAIN_RE.test(clean)) throw new Error(`Invalid setup domain: ${clean}`);
  return clean;
}

function safeRelativePath(value, label) {
  const clean = String(value || '').trim().replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || clean.includes('\0') || /[\r\n]/.test(clean) || clean.split('/').includes('..')) {
    throw new Error(`${label} must be a relative path without "..", newlines, or NUL bytes.`);
  }
  return clean;
}

function optionalRelativePath(value, fallback, label) {
  const raw = String(value || fallback || '').trim();
  return raw ? safeRelativePath(raw, label) : '';
}

function safeCwd(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return safeRelativePath(raw, 'setupRoutines.cwd');
}

function normalizeRunOn(value) {
  const raw = Array.isArray(value) ? value : [];
  const clean = raw.map((item) => String(item || '').trim()).filter((item) => ['checkout', 'sync'].includes(item));
  return clean.length ? [...new Set(clean)] : ['checkout'];
}

function sanitizeSetup(raw, fallback = {}) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const extra = {};
  for (const [key, value] of Object.entries(body)) {
    if (KNOWN_SETUP_FIELDS.has(key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    extra[key] = value;
  }
  const domain = cleanDomain(body.domain, fallback.domain);
  const phpVersion = String(body.phpVersion || fallback.phpVersion || '8.2').trim();
  if (!PHP_VERSION_RE.test(phpVersion)) throw new Error('setup.phpVersion must look like "8.2".');

  const database = String(body.database || fallback.database || (domain ? domain.replace(/[^A-Za-z0-9_]/g, '_') : '')).trim();
  if (database && !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('setup.database may only contain letters, numbers, and underscores.');
  }

  const docroot = optionalRelativePath(body.docroot, fallback.docroot || 'public', 'setup.docroot');
  let mediaSource;
  if (Array.isArray(body.mediaPaths)) {
    mediaSource = body.mediaPaths;
  } else if (Array.isArray(fallback.mediaPaths)) {
    mediaSource = fallback.mediaPaths;
  } else {
    mediaSource = [fallback.uploadsPath || DEFAULT_MEDIA_PATH];
  }
  const mediaPaths = mediaSource.map((item) => safeRelativePath(item, 'setup.mediaPaths[]'));

  const hostSource = Array.isArray(body.hosts) && body.hosts.length
    ? body.hosts
    : (Array.isArray(fallback.hosts) && fallback.hosts.length ? fallback.hosts : (domain ? domainAliases.aliasHosts(domain) : []));
  const hosts = hostSource
    .map((entry) => ({
      ip: String(entry && entry.ip ? entry.ip : '127.0.0.1').trim(),
      domain: entry && entry.domain ? domainAliases.hostFromInput(entry.domain) : domain,
      enabled: !entry || entry.enabled !== false
    }))
    .filter((entry) => entry.domain)
    .map((entry) => {
      if (!IPV4_RE.test(entry.ip)) throw new Error(`Invalid setup host IP: ${entry.ip}`);
      return entry;
    });

  const provisioning = (Array.isArray(body.provisioning) ? body.provisioning : [])
    .map((item) => ({
      path: safeRelativePath(item && item.path, 'setup.provisioning[].path'),
      runOn: normalizeRunOn(item && item.runOn)
    }));

  const setupRoutines = (Array.isArray(body.setupRoutines) ? body.setupRoutines : [])
    .map((item, index) => {
      const cmd = String(item && item.cmd ? item.cmd : '').trim();
      if (!cmd) throw new Error(`setup.setupRoutines[${index}].cmd is required.`);
      return {
        name: String((item && item.name) || cmd).trim(),
        cmd,
        cwd: safeCwd(item && item.cwd),
        runOn: normalizeRunOn(item && item.runOn),
        location: item && LOCATION_SET.has(item.location) ? item.location : 'vm'
      };
    });

  const staging = body.staging && typeof body.staging === 'object'
    ? {
        url: String(body.staging.url || '').trim(),
        branch: String(body.staging.branch || '').trim(),
        deploy: body.staging.deploy && typeof body.staging.deploy === 'object'
          ? {
              type: String(body.staging.deploy.type || '').trim(),
              remote: String(body.staging.deploy.remote || '').trim(),
              notes: String(body.staging.deploy.notes || '').trim()
            }
          : null
      }
    : null;

  return {
    ...extra,
    schemaVersion: SCHEMA_VERSION,
    domain,
    cms: CMS_SET.has(body.cms) ? body.cms : (CMS_SET.has(fallback.cms) ? fallback.cms : 'wordpress'),
    docroot,
    phpVersion,
    database,
    mediaPaths,
    hosts,
    provisioning,
    setupRoutines,
    staging,
    services: Array.isArray(body.services) ? body.services.map(String).map((item) => item.trim()).filter(Boolean) : [],
    env: body.env && typeof body.env === 'object' && !Array.isArray(body.env) ? body.env : {}
  };
}

async function readSetup(projectPath, fallback = {}) {
  try {
    const parsed = JSON.parse(await fs.readFile(setupPath(projectPath), 'utf8'));
    return sanitizeSetup(parsed, fallback);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return sanitizeSetup({}, fallback);
  }
}

async function writeSetup(projectPath, setup) {
  const clean = sanitizeSetup(setup);
  const filePath = setupPath(projectPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  return clean;
}

function commandKey(command) {
  return `${command.type}:${command.name}:${command.command || command.path}:${command.cwd || ''}:${command.location || 'vm'}`;
}

function plannedCommands(setup, phase) {
  const clean = sanitizeSetup(setup);
  const commands = [];
  for (const item of clean.provisioning) {
    if (item.runOn.includes(phase)) {
      commands.push({
        type: 'provisioning',
        name: path.basename(item.path),
        path: item.path,
        command: `bash ${item.path}`,
        location: 'vm',
        key: commandKey({ type: 'provisioning', name: path.basename(item.path), path: item.path, location: 'vm' })
      });
    }
  }
  for (const item of clean.setupRoutines) {
    if (item.runOn.includes(phase)) {
      const command = {
        type: 'setupRoutine',
        name: item.name,
        command: item.cmd,
        cwd: item.cwd,
        location: item.location
      };
      commands.push({ ...command, key: commandKey(command) });
    }
  }
  return commands;
}

function isConfirmed(command, confirmedCommands) {
  if (confirmedCommands === 'all') return true;
  const allowed = Array.isArray(confirmedCommands) ? new Set(confirmedCommands) : new Set();
  return allowed.has(command.key) || allowed.has(command.command) || allowed.has(command.path);
}

async function applyHosts(setup) {
  const clean = sanitizeSetup(setup);
  if (!clean.domain) {
    return { success: true, message: 'No project domain to apply hosts for.', steps: [] };
  }
  const vm = require('../vm/lima');
  const ipResult = await vm.getIp();
  const currentIp = ipResult.success ? ipResult.ip : '';
  const entries = (clean.hosts.length ? clean.hosts : domainAliases.aliasHosts(clean.domain))
    .map((entry) => ({
      ...entry,
      ip: currentIp || entry.ip
    }));
  const hosts = require('../hosts/hosts-manager');
  return hosts.upsertProjectGroup(clean.domain, entries);
}

async function runProvisioning(setup, projectPath, phase = 'checkout', opts = {}) {
  const clean = sanitizeSetup(setup);
  const vm = require('../vm/lima');
  const steps = [];
  const commands = plannedCommands(clean, phase).filter((item) => item.type === 'provisioning');
  for (const command of commands) {
    if (!isConfirmed(command, opts.confirmedCommands)) {
      steps.push({ name: `provision ${command.path}`, success: true, skipped: true, message: 'Skipped; not confirmed by user.' });
      continue;
    }

    try {
      const localPath = path.join(projectPath, command.path);
      const stat = await fs.stat(localPath);
      if (!stat.isFile()) throw new Error(`Provisioning file not found: ${command.path}`);
      const script = await fs.readFile(localPath, 'utf8');
      const remotePath = `/tmp/jimmybox-project-${clean.domain.replace(/[^A-Za-z0-9_-]/g, '_')}-${Date.now()}.sh`;
      const encoded = Buffer.from(script, 'utf8').toString('base64');
      const result = await vm.shell(`printf '%s' '${encoded}' | base64 -d > ${vm.shellQuote(remotePath)} && sudo bash ${vm.shellQuote(remotePath)}`);
      steps.push({ name: `provision ${command.path}`, success: result.success, message: result.success ? 'Provisioning script ran.' : result.message });
      if (!result.success) break;
    } catch (error) {
      steps.push({ name: `provision ${command.path}`, success: false, message: error.message });
      break;
    }
  }
  return { success: steps.every((step) => step.success), steps };
}

async function runSetupRoutines(setup, projectPath, phase = 'checkout', opts = {}) {
  const clean = sanitizeSetup(setup);
  const steps = [];
  const commands = plannedCommands(clean, phase).filter((item) => item.type === 'setupRoutine');
  const vm = commands.some((item) => item.location === 'vm') ? require('../vm/lima') : null;

  for (const command of commands) {
    if (!isConfirmed(command, opts.confirmedCommands)) {
      steps.push({ name: command.name, success: true, skipped: true, message: 'Skipped; not confirmed by user.' });
      continue;
    }

    try {
      if (command.location === 'local') {
        const cwd = command.cwd ? path.join(projectPath, command.cwd) : projectPath;
        const root = path.resolve(projectPath);
        const resolved = path.resolve(cwd);
        if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
          throw new Error(`Setup routine cwd escapes project folder: ${command.cwd}`);
        }
        const result = await execFileAsync('/bin/sh', ['-c', command.command], {
          cwd: resolved,
          maxBuffer: 1024 * 1024 * 8
        });
        steps.push({ name: command.name, success: true, message: (result.stdout || result.stderr || 'Setup command ran.').trim() });
      } else {
        const remoteProjectPath = `/var/www/sites/${clean.domain}`;
        const remoteCwd = command.cwd ? `${remoteProjectPath}/${command.cwd}` : remoteProjectPath;
        const result = await vm.shell(`cd ${vm.shellQuote(remoteCwd)} && ${command.command}`);
        steps.push({ name: command.name, success: result.success, message: result.success ? (result.stdout || 'Setup command ran.').trim() : result.message });
      }
    } catch (error) {
      steps.push({ name: command.name, success: false, message: error.stderr || error.message });
    }

    if (!steps[steps.length - 1].success) break;
  }

  return { success: steps.every((step) => step.success), steps };
}

function setupSummary(setup) {
  const clean = sanitizeSetup(setup);
  const commands = plannedCommands(clean, 'checkout');
  return {
    schemaVersion: clean.schemaVersion,
    domain: clean.domain,
    cms: clean.cms,
    docroot: clean.docroot,
    phpVersion: clean.phpVersion,
    database: clean.database,
    hostsCount: clean.hosts.length,
    mediaPaths: clean.mediaPaths,
    routineCount: clean.setupRoutines.length,
    routineNames: clean.setupRoutines.map((item) => item.name),
    stagingUrl: clean.staging && clean.staging.url ? clean.staging.url : '',
    stagingDeployNotes: clean.staging && clean.staging.deploy ? clean.staging.deploy.notes : '',
    commands
  };
}

module.exports = {
  SETUP_DIR,
  SETUP_FILE,
  setupPath,
  sanitizeSetup,
  readSetup,
  writeSetup,
  applyHosts,
  runProvisioning,
  runSetupRoutines,
  plannedCommands,
  setupSummary,
  commandKey,
  safeRelativePath
};
