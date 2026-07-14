const fs = require('fs/promises');
const path = require('path');
const vm = require('../vm/lima');
const db = require('../db/db-manager');
const hosts = require('../hosts/hosts-manager');
const settings = require('../settings/store');
const php = require('../php/php-manager');
const cmsRegistry = require('../cms');
const projectSetup = require('./project-setup');
const domainAliases = require('./domain-aliases');

const DOMAIN_RE = domainAliases.DOMAIN_RE;
const DB_RE = /^[A-Za-z0-9_]+$/;
const PHP_VERSION_RE = /^\d+\.\d+$/;
const MANAGED_VHOST_MARKER = '# MANAGED BY JIMMYBOX STUDIO';
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'vhost.conf.tpl');

function validateDomain(domain) {
  const clean = domainAliases.canonicalProjectDomain(domain);
  if (!clean || !DOMAIN_RE.test(clean)) {
    throw new Error('Domain may only contain letters, numbers, dots, underscores, and hyphens.');
  }
  return clean;
}

function validateDatabaseName(name) {
  if (!name || !DB_RE.test(name)) {
    throw new Error('Database name may only contain letters, numbers, and underscores.');
  }
}

function validatePhpVersion(version) {
  if (!PHP_VERSION_RE.test(version)) {
    throw new Error('PHP version must look like "8.2".');
  }
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

function safeProjectPath(sitesPath, domain) {
  const root = path.resolve(sitesPath);
  const target = path.resolve(root, domain);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Domain resolves outside the Sites path.');
  }
  return target;
}

async function ensureProjectFolders(projectPath, docroot = 'public') {
  await fs.mkdir(path.join(projectPath, docroot), { recursive: true });
  await fs.mkdir(path.join(projectPath, '.jimmybox-studio', 'ssl'), { recursive: true });
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch (_error) {
    return false;
  }
}

async function nonIgnoredFolderEntries(target) {
  const entries = await fs.readdir(target).catch(() => []);
  return entries.filter((name) => !['.DS_Store'].includes(name));
}

async function removeNewProjectFolder(projectPath) {
  await makeProjectFolderWritable(projectPath).catch(() => {});
  await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
}

// Best-effort rollback of a brand-new project whose creation failed partway
// through: undo the Apache vhost, the /etc/hosts entry, and the database — but
// only when the database was freshly created here (never a pre-existing one) —
// then drop the project folder. Each step is best-effort so cleanup can never
// throw over the original failure.
async function rollbackNewProject({ domain, projectPath, dbName, dbWasCreated }) {
  await disableAndRemoveVhost(domain).catch(() => {});
  await removeHostEntry(domain).catch(() => {});
  if (dbWasCreated && dbName) {
    await db.dropDatabase(dbName).catch(() => {});
  }
  await removeNewProjectFolder(projectPath);
}

async function makeProjectFolderWritable(target) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || stat.isSymbolicLink()) return { success: true, changed: false };

  try {
    if (stat.isDirectory()) {
      await fs.chmod(target, 0o755).catch(() => {});
      const entries = await fs.readdir(target);
      for (const entry of entries) {
        const child = await makeProjectFolderWritable(path.join(target, entry));
        if (!child.success) return child;
      }
      return { success: true, changed: true };
    }

    await fs.chmod(target, 0o644).catch(() => {});
    return { success: true, changed: true };
  } catch (error) {
    return { success: false, message: `Could not make project folder writable: ${error.message}` };
  }
}

async function findAliasProjectFolder(sitesPath, domain) {
  for (const alias of domainAliases.projectAliases(domain)) {
    const aliasPath = safeProjectPath(sitesPath, alias);
    if (alias !== domain && await pathExists(aliasPath)) {
      return { alias, aliasPath };
    }
  }
  return null;
}

async function resolveExistingProjectFolder(sitesPath, requestedDomain, cleanDomain) {
  const candidates = [requestedDomain, cleanDomain, ...domainAliases.projectAliases(cleanDomain)]
    .filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    const projectPath = safeProjectPath(sitesPath, candidate);
    if (await pathExists(projectPath)) {
      return { projectPath, folderDomain: candidate };
    }
  }
  return {
    projectPath: safeProjectPath(sitesPath, cleanDomain),
    folderDomain: cleanDomain
  };
}

// Write the vhost config only if it isn't there yet — never clobber a file the
// user may have hand-tuned.
function renderServerAliases(domain) {
  return domainAliases.apacheServerAliases(domain)
    .map((alias) => `    ServerAlias ${alias}`)
    .join('\n');
}

async function ensureVhostConf(domain, phpVersion, projectPath, docroot = 'public', projectDir = domain) {
  const target = path.join(projectPath, '.jimmybox-studio', 'vhost.conf');
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const rendered = template
    .replaceAll('${DOMAIN}', domain)
    .replaceAll('${SERVER_ALIASES}', renderServerAliases(domain))
    .replaceAll('${PROJECT_DIR}', projectDir)
    .replaceAll('${DOCROOT}', docroot)
    .replaceAll('${PHP_SOCK}', `/run/php/php${phpVersion}-fpm.sock`);
  if (await pathExists(target)) {
    const existing = await fs.readFile(target, 'utf8').catch(() => '');
    const hasManagedMarker = existing.includes(MANAGED_VHOST_MARKER);
    const legacyManaged = (
      existing.includes(`/var/www/sites/${domain}/`) ||
      existing.includes(`/var/www/sites/${projectDir}/`)
    ) && existing.includes(`${domain}-ssl-error.log`);
    const appManaged = hasManagedMarker || legacyManaged;
    const aliases = domainAliases.apacheServerAliases(domain);
    const hasAliases = aliases.every((alias) => existing.includes(`ServerAlias ${alias}`));
    const hasHttpsRedirect = existing.includes('RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=302,L]');
    const hasProjectDir = existing.includes(`/var/www/sites/${projectDir}/`);
    // Re-render when the wired PHP-FPM socket no longer matches the requested
    // version — otherwise switching a project's PHP version has no effect.
    const hasPhpSocket = existing.includes(`/run/php/php${phpVersion}-fpm.sock`);
    if (appManaged && (!hasManagedMarker || !hasAliases || !hasHttpsRedirect || !hasProjectDir || !hasPhpSocket)) {
      await fs.writeFile(target, rendered, 'utf8');
      return { success: true, changed: true };
    }
    return { success: true, changed: false };
  }
  await fs.writeFile(target, rendered, 'utf8');
  return { success: true, changed: true };
}

async function enableVhost(domain, projectDir = domain) {
  const source = `/var/www/sites/${projectDir}/.jimmybox-studio/vhost.conf`;
  const target = `/etc/apache2/sites-available/${domain}.conf`;
  const check = await vm.shell(`test -e "/etc/apache2/sites-enabled/${domain}.conf" && echo yes || echo no`);
  const wasEnabled = check.success && check.stdout.trim().endsWith('yes');
  const command = [
    `sudo cp ${vm.shellQuote(source)} ${vm.shellQuote(target)}`,
    `sudo a2ensite ${vm.shellQuote(`${domain}.conf`)} >/dev/null`,
    'sudo systemctl reload apache2'
  ].join(' && ');

  const result = await vm.shell(command);
  if (!result.success) return result;
  return { success: true, changed: !wasEnabled };
}

// Self-signed cert with a SAN (modern browsers require it). Regenerates only if
// a complete key+cert pair isn't already present — an existing cert is kept.
async function ensureSsl(domain, projectDir = domain) {
  const base = `/var/www/sites/${projectDir}/.jimmybox-studio/ssl`;
  const keyPath = `${base}/${domain}.key`;
  const certPath = `${base}/${domain}.crt`;
  const aliases = domainAliases.projectAliases(domain);
  const aliasChecks = aliases
    .map((host) => `openssl x509 -in "${certPath}" -noout -ext subjectAltName 2>/dev/null | grep -F ${vm.shellQuote(`DNS:${host}`)} >/dev/null`)
    .join(' && ');
  const check = await vm.shell(`test -f "${keyPath}" && test -f "${certPath}" && ${aliasChecks} && echo yes || echo no`);
  if (check.success && check.stdout.trim().endsWith('yes')) {
    return { success: true, changed: false };
  }
  const san = aliases.map((host) => `DNS:${host}`).join(',');
  const command = [
    'openssl req -x509 -nodes -newkey rsa:2048 -days 825',
    `-keyout "${keyPath}" -out "${certPath}"`,
    `-subj "/CN=${domain}"`,
    `-addext "subjectAltName=${san}"`,
    '>/dev/null 2>&1'
  ].join(' ');
  const result = await vm.shell(command);
  if (!result.success) return result;
  return { success: true, changed: true };
}

async function ensureHost(domain) {
  const ipResult = await requireVmIp();
  if (!ipResult.success) return ipResult;
  return hosts.upsertProjectGroup(domain, domainAliases.aliasHosts(domain, ipResult.ip));
}

async function requireVmIp() {
  const ipResult = await vm.getIp();
  if (!ipResult.success || !ipResult.ip) {
    return {
      success: false,
      message: ipResult.message || 'Could not determine the JimmyBox VM IP address.'
    };
  }
  return { success: true, ip: ipResult.ip };
}

async function writeMetadata(projectPath, payload) {
  const target = path.join(projectPath, '.jimmybox-studio', 'project.json');
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function createProject(payload) {
  try {
    const rawDomain = String(payload.domain || '').trim();
    const domain = validateDomain(rawDomain);

    const currentVm = await vm.status();
    if (!currentVm.success) return currentVm;
    if (currentVm.state !== 'running') {
      return { success: false, message: 'JimmyBox Studio VM is not running. Start it first.' };
    }

    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, domain);
    const aliasFolder = await findAliasProjectFolder(sitesPath, domain);
    if (aliasFolder && !(await pathExists(projectPath))) {
      return {
        success: false,
        message: `A project folder for alias ${aliasFolder.alias} already exists. Delete it first so ${domain} can be managed cleanly.`
      };
    }
    const existingMeta = await readProjectMetadata(projectPath);
    const hasSetup = await pathExists(projectSetup.setupPath(projectPath));
    const existingSetup = hasSetup
      ? await projectSetup.readSetup(projectPath, {
          domain,
          phpVersion: existingMeta && existingMeta.phpVersion ? existingMeta.phpVersion : payload.phpVersion,
          database: existingMeta && existingMeta.database ? existingMeta.database : payload.dbName
        }).catch(() => null)
      : null;
    const detectedCms = await cmsRegistry.detect(projectPath).catch(() => null);
    const detectedCmsId = detectedCms && detectedCms.detected ? detectedCms.id : '';
    const projectFolderExists = await pathExists(projectPath);
    if (projectFolderExists && !existingMeta && !hasSetup && payload.adoptExistingFiles !== true) {
      const existingEntries = await nonIgnoredFolderEntries(projectPath);
      if (existingEntries.length > 0) {
        return {
          success: false,
          message: `A folder for ${domain} already exists but is not managed by JimmyBox Studio. Import or move it before creating a project with this domain.`
        };
      }
    }

    // Reuse existing metadata so re-creating a forgotten project REPAIRS it and
    // reconnects to its original database — never a fresh empty one, never a wipe.
    const submittedPhpVersion = String(payload.phpVersion || '').trim();
    const submittedDbName = String(payload.dbName || '').trim();
    const rawAutoDbName = rawDomain ? rawDomain.replace(/[^A-Za-z0-9_]/g, '_') : '';
    const canonicalAutoDbName = domainAliases.dbNameForDomain(domain);
    const dbName = String(
      (existingMeta && existingMeta.database) ||
      (submittedDbName && submittedDbName !== rawAutoDbName ? submittedDbName : canonicalAutoDbName)
    ).trim();
    validateDatabaseName(dbName);

    const cmsId = String(
      payload.cms ||
      (existingMeta && existingMeta.cms) ||
      (existingSetup && existingSetup.cms) ||
      detectedCmsId ||
      (payload.installWordpress === false ? 'plain' : 'wordpress')
    );
    const cms = cmsRegistry.get(cmsId);
    const phpVersion = String(
      submittedPhpVersion ||
      (existingMeta && existingMeta.phpVersion) ||
      (existingSetup && existingSetup.phpVersion) ||
      cms.recommendedPhpVersion ||
      '8.2'
    );
    validatePhpVersion(phpVersion);

    // docroot flows into the privileged Apache vhost template and mkdir; validate
    // it as a safe relative path (no "..", no absolute, no newlines) before use.
    const docroot = projectSetup.safeRelativePath(
      String(payload.docroot || (existingSetup && existingSetup.docroot) || cms.docroot || 'public'),
      'docroot'
    );
    const mediaPaths = Array.isArray(payload.mediaPaths)
      ? payload.mediaPaths
      : (existingSetup && existingSetup.mediaPaths && existingSetup.mediaPaths.length ? existingSetup.mediaPaths : cms.mediaPaths);

    const shouldInstallCms = payload.skipCmsInstall !== true;
    if (shouldInstallCms && cms.installPhpMin && comparePhpVersions(phpVersion, cms.installPhpMin) < 0) {
      return {
        success: false,
        message: `${cms.label} new installations need PHP ${cms.installPhpMin} or newer. Select PHP ${cms.installPhpMin}+ or import an existing compatible project.`
      };
    }

    // Refuse to wire a vhost to a PHP-FPM socket that isn't installed.
    const phpList = await php.listVersions();
    if (!phpList.success) {
      return { success: false, message: phpList.message || 'Could not detect PHP versions in the VM.' };
    }
    if (!Array.isArray(phpList.versions) || phpList.versions.length === 0) {
      return { success: false, message: 'No installed PHP versions could be detected in the VM. Add the required PHP version under Settings before creating a project.' };
    }
    if (!phpList.versions.includes(phpVersion)) {
      return { success: false, message: `PHP ${phpVersion} is not installed in the VM. Add it under Settings → PHP versions.` };
    }

    const created = [];
    const kept = [];
    const failed = [];
    const skipped = [];

    // Runs a step without ever aborting the whole creation: a failing step is
    // recorded and the rest still run, so nothing is left half-done and a re-run
    // simply completes what's missing. Dependent steps are gated below.
    const run = async (label, fn) => {
      try {
        const res = await fn();
        if (!res || res.success === false) {
          failed.push(res && res.message ? `${label} (${res.message})` : label);
          return false;
        }
        (res.changed ? created : kept).push(label);
        return true;
      } catch (error) {
        failed.push(`${label} (${error.message})`);
        return false;
      }
    };
    const skip = (label, reason) => {
      skipped.push(`${label} (${reason})`);
      return false;
    };

    await ensureProjectFolders(projectPath, docroot);

    const vhostConfigReady = await run('vhost config', () => ensureVhostConf(domain, phpVersion, projectPath, docroot));
    await run('SSL certificate', () => ensureSsl(domain));
    if (vhostConfigReady) {
      await run('Apache vhost', () => enableVhost(domain));
    } else {
      skip('Apache vhost', 'vhost config failed');
    }

    let dbWasCreated = false;
    const databaseReady = await run('database', async () => {
      const dbExisted = await db.databaseExists(dbName);
      if (!dbExisted.success) return dbExisted;
      const res = await db.createDatabase(dbName);
      dbWasCreated = Boolean(res.success) && !dbExisted.exists;
      return { ...res, changed: !dbExisted.exists };
    });

    let cmsReady = true;
    if (shouldInstallCms) {
      if (databaseReady) {
        const pluginSource = payload.installPlugins ? (payload.basePlugins || await settings.getBasePlugins()) : '';
        cmsReady = await run(cms.label, () => cms.install({
          domain,
          projectPath,
          dbName,
          phpVersion,
          vm,
          basePlugins: pluginSource
        }));
      } else {
        cmsReady = skip(cms.label, 'database step failed');
      }
    }

    await run('hosts entry', () => ensureHost(domain));

    if (databaseReady && cmsReady) {
      const setupRoutines = existingSetup && existingSetup.setupRoutines && existingSetup.setupRoutines.length
        ? existingSetup.setupRoutines
        : await cms.setupRoutines({ domain, projectPath, dbName, phpVersion });
      await run('setup descriptor', async () => {
        const ipResult = await requireVmIp();
        if (!ipResult.success) return ipResult;
        await projectSetup.writeSetup(projectPath, {
          ...(existingSetup || {}),
          domain,
          cms: cms.id,
          docroot,
          phpVersion,
          database: dbName,
          mediaPaths,
          hosts: domainAliases.aliasHosts(domain, ipResult.ip),
          setupRoutines
        });
        return { success: true, changed: true };
      });

      await run('metadata', async () => {
        await writeMetadata(projectPath, {
          ...(existingMeta || {}),
          domain,
          aliases: domainAliases.projectAliases(domain),
          phpVersion,
          database: dbName,
          cms: cms.id,
          docroot,
          mediaPaths,
          uploadsPath: mediaPaths[0] || ''
        });
        return { success: true, changed: true };
      });
    } else {
      skip('setup descriptor', databaseReady ? 'CMS step failed' : 'database step failed');
      skip('metadata', databaseReady ? 'CMS step failed' : 'database step failed');
    }

    const parts = [`Project ${domain} ${existingMeta ? 'updated' : 'created'}.`];
    if (created.length) parts.push(`Added: ${created.join(', ')}.`);
    if (kept.length) parts.push(`Kept (already existed): ${kept.join(', ')}.`);
    if (skipped.length) parts.push(`Skipped: ${skipped.join(', ')}.`);
    if (failed.length) parts.push(`Failed — nothing was overwritten, re-run to complete: ${failed.join(', ')}.`);

    const success = failed.length === 0;
    if (!success && !existingMeta && !hasSetup) {
      await rollbackNewProject({ domain, projectPath, dbName, dbWasCreated });
    }

    return { success, message: parts.join(' ') };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function readProjectMetadata(projectPath) {
  try {
    const raw = await fs.readFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), 'utf8');
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

async function readProjectSetupMetadata(projectPath, fallback = {}) {
  if (!await pathExists(projectSetup.setupPath(projectPath))) return null;
  try {
    return await projectSetup.readSetup(projectPath, fallback);
  } catch (_error) {
    return null;
  }
}

async function describeExistingProject(projectPath, domain, metadata = null, overrides = {}) {
  const fallback = metadata || {};
  const setup = await projectSetup.readSetup(projectPath, {
    domain,
    phpVersion: fallback.phpVersion || overrides.phpVersion || '8.2',
    database: fallback.database || domainAliases.dbNameForDomain(domain),
    cms: fallback.cms || 'plain',
    docroot: fallback.docroot || 'public',
    mediaPaths: fallback.mediaPaths
  }).catch(() => null);
  const detected = await cmsRegistry.detect(projectPath).catch(() => ({ id: 'plain', docroot: 'public', mediaPaths: [] }));
  const cmsId = String(overrides.cms || fallback.cms || (setup && setup.cms) || detected.id || 'plain');
  const cms = cmsRegistry.get(cmsId);
  const phpVersion = String(overrides.phpVersion || fallback.phpVersion || (setup && setup.phpVersion) || '8.2');
  const database = String(fallback.database || (setup && setup.database) || domainAliases.dbNameForDomain(domain));
  const docroot = projectSetup.safeRelativePath(
    String(overrides.docroot || fallback.docroot || (setup && setup.docroot) || detected.docroot || cms.docroot || 'public'),
    'docroot'
  );
  const mediaPaths = Array.isArray(overrides.mediaPaths)
    ? overrides.mediaPaths
    : (Array.isArray(fallback.mediaPaths) && fallback.mediaPaths.length
        ? fallback.mediaPaths
        : ((setup && setup.mediaPaths && setup.mediaPaths.length) ? setup.mediaPaths : (detected.mediaPaths || cms.mediaPaths || [])));

  validatePhpVersion(phpVersion);
  validateDatabaseName(database);

  return { setup, cms, phpVersion, database, docroot, mediaPaths };
}

async function repairProject(domain, options = {}) {
  const steps = [];

  try {
    const requestedDomain = domainAliases.hostFromInput(domain);
    const cleanDomain = validateDomain(domain);
    const sitesPath = await settings.getExpandedSitesPath();
    const { projectPath, folderDomain } = await resolveExistingProjectFolder(sitesPath, requestedDomain, cleanDomain);
    const metadata = await readProjectMetadata(projectPath);
    const projectDomain = validateDomain((metadata && metadata.domain) || cleanDomain);
    const details = await describeExistingProject(projectPath, projectDomain, metadata, options);
    const run = async (name, fn) => {
      const result = await fn();
      steps.push({
        name,
        success: result && result.success !== false,
        message: result && result.message ? result.message : (result && result.changed ? 'Repaired.' : 'Already OK.')
      });
      return result && result.success !== false;
    };

    const currentVm = await vm.status();
    if (!currentVm.success) return currentVm;
    if (currentVm.state !== 'running') {
      return { success: false, message: 'JimmyBox Studio VM is not running. Start it first.', steps };
    }

    await ensureProjectFolders(projectPath, details.docroot);
    if (!await run('vhost config', () => ensureVhostConf(projectDomain, details.phpVersion, projectPath, details.docroot, folderDomain))) {
      return { success: false, message: 'Could not repair vhost config.', steps };
    }
    if (!await run('SSL certificate', () => ensureSsl(projectDomain, folderDomain))) {
      return { success: false, message: 'Could not repair SSL certificate.', steps };
    }
    if (!await run('Apache vhost', () => enableVhost(projectDomain, folderDomain))) {
      return { success: false, message: 'Could not enable Apache vhost.', steps };
    }

    const ipResult = await requireVmIp();
    if (!ipResult.success) {
      steps.push(step('setup descriptor', false, ipResult.message));
      return { success: false, message: `Could not repair setup descriptor: ${ipResult.message}`, steps };
    }
    const setupRoutines = details.setup && details.setup.setupRoutines ? details.setup.setupRoutines : [];
    await projectSetup.writeSetup(projectPath, {
      ...(details.setup || {}),
      domain: projectDomain,
      cms: details.cms.id,
      docroot: details.docroot,
      phpVersion: details.phpVersion,
      database: details.database,
      mediaPaths: details.mediaPaths,
      hosts: domainAliases.aliasHosts(projectDomain, ipResult.ip),
      setupRoutines
    });
    steps.push(step('setup descriptor', true, 'Setup descriptor repaired.'));

    await writeMetadata(projectPath, {
      ...(metadata || {}),
      domain: projectDomain,
      aliases: domainAliases.projectAliases(projectDomain),
      phpVersion: details.phpVersion,
      database: details.database,
      cms: details.cms.id,
      docroot: details.docroot,
      mediaPaths: details.mediaPaths,
      uploadsPath: details.mediaPaths[0] || ''
    });
    steps.push(step('metadata', true, 'Project metadata repaired.'));

    if (options.applyHosts) {
      const host = await ensureHost(projectDomain);
      steps.push(step('hosts entry', host.success, host.success ? 'Hosts entry repaired.' : host.message));
      if (!host.success) return { success: false, message: `Could not repair hosts entry: ${host.message}`, steps };
    }

    return {
      success: true,
      message: `${projectDomain} repaired.`,
      domain: projectDomain,
      folderDomain,
      projectPath,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message, steps };
  }
}

async function readEnabledVhost(domain, vmIsRunning) {
  if (!vmIsRunning) return null;

  const result = await vm.shell(`if [ -e ${vm.shellQuote(`/etc/apache2/sites-enabled/${domain}.conf`)} ]; then echo enabled; else echo disabled; fi`);
  if (!result.success) return null;
  return result.stdout.trim() === 'enabled';
}

async function listProjects() {
  try {
    const sitesPath = await settings.getExpandedSitesPath();
    let entries = [];

    try {
      entries = await fs.readdir(sitesPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true, projects: [] };
      }
      throw error;
    }

    const hostResult = await hosts.readEntries();
    if (!hostResult.success) return hostResult;
    const hostDomains = new Set(hostResult.entries.map((entry) => entry.domain));
    const vmResult = await vm.status();
    const vmIsRunning = vmResult.success && vmResult.state === 'running';

    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const projectPath = path.join(sitesPath, entry.name);
      const metadata = await readProjectMetadata(projectPath);
      const setup = await readProjectSetupMetadata(projectPath, {
        ...(metadata || {}),
        domain: (metadata && metadata.domain) || entry.name
      });
      if (!metadata && !setup) continue;

      const detectedCms = await cmsRegistry.detect(projectPath);
      // Skip stray folders whose name/metadata isn't a valid project domain,
      // instead of letting one bad folder break the entire project list.
      let displayDomain;
      try {
        displayDomain = metadata && metadata.domain
          ? validateDomain(metadata.domain)
          : validateDomain((setup && setup.domain) || entry.name);
      } catch (_error) {
        continue;
      }

      projects.push({
        domain: displayDomain,
        phpVersion: metadata && metadata.phpVersion ? metadata.phpVersion : ((setup && setup.phpVersion) || '—'),
        database: metadata && metadata.database ? metadata.database : ((setup && setup.database) || '—'),
        cms: metadata && metadata.cms ? metadata.cms : ((setup && setup.cms) || detectedCms.id),
        docroot: metadata && metadata.docroot ? metadata.docroot : ((setup && setup.docroot) || detectedCms.docroot),
        mediaPaths: metadata && Array.isArray(metadata.mediaPaths) ? metadata.mediaPaths : ((setup && setup.mediaPaths) || detectedCms.mediaPaths),
        teamRevisionId: metadata && metadata.teamRevisionId ? metadata.teamRevisionId : '',
        hosts: domainAliases.projectAliases(displayDomain).some((domain) => hostDomains.has(domain)),
        enabled: await readEnabledVhost(displayDomain, vmIsRunning)
      });
    }

    return {
      success: true,
      projects
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

function step(name, success, message) {
  return { name, success, message };
}

async function disableAndRemoveVhost(domain) {
  const confName = `${domain}.conf`;
  const availablePath = `/etc/apache2/sites-available/${confName}`;
  const enabledPath = `/etc/apache2/sites-enabled/${confName}`;
  const command = [
    `sudo a2dissite ${vm.shellQuote(confName)} >/dev/null 2>&1 || true`,
    `sudo rm -f ${vm.shellQuote(availablePath)} ${vm.shellQuote(enabledPath)}`,
    'sudo systemctl reload apache2'
  ].join(' && ');

  return vm.shell(command);
}

async function removeHostEntry(domain) {
  const group = hosts.removeProjectGroup ? await hosts.removeProjectGroup(domain) : { success: true };
  if (!group.success) return group;
  return hosts.removeProjectEntry(domain);
}

function deleteDomainsFor(cleanDomain, folderDomain, metadata, setup) {
  const domains = [cleanDomain, folderDomain, ...domainAliases.projectAliases(cleanDomain)];
  if (metadata && metadata.domain) {
    try {
      const metaDomain = domainAliases.hostFromInput(metadata.domain);
      domains.push(metaDomain, ...domainAliases.projectAliases(metaDomain));
    } catch (_error) {
      /* ignore invalid legacy metadata while deleting */
    }
  }
  if (setup && setup.domain) {
    try {
      const setupDomain = domainAliases.hostFromInput(setup.domain);
      domains.push(setupDomain, ...domainAliases.projectAliases(setupDomain));
    } catch (_error) {
      /* ignore invalid setup metadata while deleting */
    }
  }
  return [...new Set(domains.filter(Boolean))];
}

async function deleteProject(domain) {
  const steps = [];

  try {
    const requestedDomain = domainAliases.hostFromInput(domain);
    const cleanDomain = validateDomain(domain);

    const sitesPath = await settings.getExpandedSitesPath();
    const { projectPath, folderDomain } = await resolveExistingProjectFolder(sitesPath, requestedDomain, cleanDomain);
    const metadata = await readProjectMetadata(projectPath);
    const setup = await readProjectSetupMetadata(projectPath, {
      ...(metadata || {}),
      domain: (metadata && metadata.domain) || folderDomain || cleanDomain
    });
    if (!metadata && !setup) {
      return {
        success: false,
        message: `${folderDomain} is not a JimmyBox Studio project. Add project metadata before deleting it from Studio.`,
        steps
      };
    }
    const domainsToRemove = deleteDomainsFor(cleanDomain, folderDomain, metadata, setup);
    const databaseName = (metadata && metadata.database) || (setup && setup.database);

    const currentVm = await vm.status();
    const vmIsRunning = currentVm.success && currentVm.state === 'running';

    if (!vmIsRunning) {
      steps.push(step('vm cleanup', false, `VM is ${currentVm.success ? currentVm.state : 'unavailable'}.`));
      return {
        success: false,
        message: 'JimmyBox Studio VM is not running. Start the VM before deleting this project so Apache and database cleanup can run safely.',
        steps
      };
    }

    for (const item of domainsToRemove) {
      const vhost = await disableAndRemoveVhost(item);
      steps.push(step(`vhost ${item}`, vhost.success, vhost.success ? 'Apache vhost removed.' : vhost.message));
      if (!vhost.success) {
        return { success: false, message: `Project deletion stopped at vhost ${item}: ${vhost.message}`, steps };
      }
    }

    if (databaseName) {
      validateDatabaseName(databaseName);
      const dropped = await db.dropDatabase(databaseName);
      steps.push(step('database', dropped.success, dropped.success ? `Database ${databaseName} dropped.` : dropped.message));
      if (!dropped.success) {
        return { success: false, message: `Project deletion stopped at database: ${dropped.message}`, steps };
      }
    } else {
      steps.push(step('database', true, 'No project database metadata found.'));
    }

    for (const item of domainsToRemove) {
      const host = await removeHostEntry(item);
      steps.push(step(`hosts ${item}`, host.success, host.success ? 'Hosts entry removed.' : host.message));
      if (!host.success) {
        return { success: false, message: `Project deletion stopped at hosts ${item}: ${host.message}`, steps };
      }
    }

    const writable = await makeProjectFolderWritable(projectPath);
    steps.push(step('folder permissions', writable.success, writable.success ? 'Project folder made removable.' : writable.message));
    if (!writable.success) {
      return { success: false, message: `Project deletion stopped at folder permissions: ${writable.message}`, steps };
    }

    await fs.rm(projectPath, { recursive: true, force: true });
    steps.push(step('folder', true, 'Project folder removed.'));

    return {
      success: true,
      message: `Project ${folderDomain} deleted.`,
      steps
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
      steps
    };
  }
}

// Switch an existing project's PHP version: re-render its vhost with the new
// FPM socket (deliberate change, so overwriting vhost.conf is intended here),
// re-enable, reload apache, and update the stored metadata.
async function setProjectPhp(domain, phpVersion) {
  try {
    validatePhpVersion(phpVersion);

    const phpList = await php.listVersions();
    if (phpList.success && phpList.versions.length && !phpList.versions.includes(phpVersion)) {
      return { success: false, message: `PHP ${phpVersion} is not installed. Add it under Settings → PHP versions.` };
    }

    const repaired = await repairProject(domain, { phpVersion });
    if (!repaired.success) return repaired;

    return { ...repaired, message: `${repaired.domain} now runs on PHP ${phpVersion}.` };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

module.exports = {
  createProject,
  listProjects,
  deleteProject,
  repairProject,
  setProjectPhp
};
