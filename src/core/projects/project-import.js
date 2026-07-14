// Import an existing (previously live) project: a code archive + a database dump
// are turned into a working local JimmyBox project. Files are placed into the
// project's docroot, the DB is imported, and the CMS config is pointed at the
// local database. The production domain stays the working domain locally via
// /etc/hosts, so deployments do not need URL rewrites.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const settings = require('../settings/store');
const db = require('../db/db-manager');
const projects = require('./project-manager');
const cmsRegistry = require('../cms');
const vm = require('../vm/lima');
const domainAliases = require('./domain-aliases');

const DOMAIN_RE = domainAliases.DOMAIN_RE;

function validateDomain(domain) {
  const clean = domainAliases.canonicalProjectDomain(domain);
  if (!clean || !DOMAIN_RE.test(clean)) throw new Error('Invalid project domain.');
  return clean;
}

function safeProjectPath(sitesPath, domain) {
  const root = path.resolve(sitesPath);
  const target = path.resolve(root, domain);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Project path resolves outside the Sites path.');
  }
  return target;
}

async function run(cmd, args) {
  try {
    const r = await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 64, env: { ...process.env, COPYFILE_DISABLE: '1' } });
    return { success: true, stdout: r.stdout || '' };
  } catch (error) {
    return { success: false, message: (error.stderr || error.message || `${cmd} failed`).trim() };
  }
}

function validateArchiveEntryName(name) {
  const raw = String(name || '');
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (
    !raw ||
    raw.includes('\0') ||
    /[\r\n]/.test(raw) ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    parts.includes('..')
  ) {
    throw new Error(`Unsafe archive entry: ${raw || '(empty)'}`);
  }
}

function rejectSymlinkListing(stdout) {
  const linkLine = String(stdout || '')
    .split('\n')
    .find((line) => /^[lh]/.test(line));
  if (linkLine) {
    throw new Error(/^h/.test(linkLine)
      ? 'Code archive contains a hardlink entry.'
      : 'Code archive contains a symlink entry.');
  }
}

async function inspectArchive(archivePath) {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    const listed = await run('unzip', ['-Z', '-1', archivePath]);
    if (!listed.success) return listed;
    try {
      String(listed.stdout || '').split('\n').filter(Boolean).forEach(validateArchiveEntryName);
      const details = await run('unzip', ['-Z', '-l', archivePath]);
      if (!details.success) return details;
      rejectSymlinkListing(details.stdout);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) {
    const listed = await run('tar', ['-tf', archivePath]);
    if (!listed.success) return listed;
    try {
      String(listed.stdout || '').split('\n').filter(Boolean).forEach(validateArchiveEntryName);
      const details = await run('tar', ['-tvf', archivePath]);
      if (!details.success) return details;
      rejectSymlinkListing(details.stdout);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  return { success: false, message: 'Code archive must be .zip, .tar.gz, .tgz or .tar.' };
}

async function extractArchive(archivePath, destDir) {
  const lower = archivePath.toLowerCase();
  const inspected = await inspectArchive(archivePath);
  if (!inspected.success) return inspected;
  await fs.mkdir(destDir, { recursive: true });
  if (lower.endsWith('.zip')) return run('unzip', ['-q', '-o', archivePath, '-d', destDir]);
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) {
    return run('tar', ['-xf', archivePath, '-C', destDir]);
  }
  return { success: false, message: 'Code archive must be .zip, .tar.gz, .tgz or .tar.' };
}

// Marker files that identify a CMS root inside the extracted tree. `placement`
// says whether the found dir is the docroot (WP/Joomla) or the composer project
// root that contains the docroot (TYPO3/Contao/Drupal).
const MARKERS = [
  { cmsId: 'wordpress', rel: path.join('public', 'wp-load.php'), placement: 'root', docroot: 'public' },
  { cmsId: 'wordpress', rel: 'wp-load.php', placement: 'docroot' },
  { cmsId: 'drupal', rel: path.join('core', 'lib', 'Drupal.php'), placement: 'docroot', docroot: 'web' },
  { cmsId: 'drupal', rel: path.join('web', 'core', 'lib', 'Drupal.php'), placement: 'root' },
  { cmsId: 'typo3', rel: path.join('typo3conf', 'LocalConfiguration.php'), placement: 'docroot', docroot: 'public' },
  { cmsId: 'typo3', rel: path.join('typo3', 'sysext', 'core'), placement: 'docroot', docroot: 'public' },
  { cmsId: 'typo3', rel: path.join('public', 'typo3'), placement: 'root' },
  { cmsId: 'typo3', rel: path.join('vendor', 'typo3', 'cms-core'), placement: 'root' },
  { cmsId: 'contao', rel: path.join('web', 'contao-manager.phar.php'), placement: 'root', docroot: 'web' },
  { cmsId: 'contao', rel: path.join('web', 'index.php'), placement: 'root', docroot: 'web', also: path.join('vendor', 'contao') },
  { cmsId: 'contao', rel: path.join('vendor', 'contao'), placement: 'root' },
  { cmsId: 'joomla', rel: 'configuration.php', placement: 'docroot', also: 'administrator' },
  { cmsId: 'joomla', rel: 'administrator', placement: 'docroot', also: 'libraries' }
];

async function pathExists(p) {
  try { await fs.access(p); return true; } catch (_e) { return false; }
}

async function assertNoSymbolicLinks(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const stat = await fs.lstat(entryPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Code archive contains a symlink: ${path.relative(dir, entryPath)}`);
    }
    if (stat.isDirectory()) {
      await assertNoSymbolicLinks(entryPath);
    }
  }
}

// Walk up to `maxDepth` directories collecting candidate roots, most-specific first.
async function detectRoot(baseDir, maxDepth = 3) {
  const queue = [{ dir: baseDir, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    for (const m of MARKERS) {
      if (await pathExists(path.join(dir, m.rel))) {
        if (m.also && !(await pathExists(path.join(dir, m.also)))) continue;
        return { cmsId: m.cmsId, rootDir: dir, placement: m.placement, docroot: m.docroot };
      }
    }
    if (depth < maxDepth) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
          queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
        }
      }
    }
  }
  return null;
}

async function moveContents(fromDir, toDir) {
  await fs.mkdir(toDir, { recursive: true });
  const entries = await fs.readdir(fromDir);
  for (const name of entries) {
    await fs.rename(path.join(fromDir, name), path.join(toDir, name)).catch(async (error) => {
      if (error.code === 'EXDEV') {
        const copied = await run('cp', ['-a', path.join(fromDir, name), toDir]);
        if (!copied.success) throw new Error(copied.message || 'Copy fallback failed.');
      } else {
        throw error;
      }
    });
  }
}

function localDbName(domain) {
  return domainAliases.dbNameForDomain(domain);
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

async function cleanupImportedProject({ domain, projectPath }) {
  let deleted = null;
  if (projects && typeof projects.deleteProject === 'function') {
    deleted = await projects.deleteProject(domain).catch((error) => ({ success: false, message: error.message }));
    if (deleted && deleted.success) return deleted;
  }
  const hasMetadata = await pathExists(path.join(projectPath, '.jimmybox-studio', 'project.json')) ||
    await pathExists(path.join(projectPath, '.jimmybox-studio', 'setup.json'));
  if (hasMetadata && deleted && deleted.success === false) return deleted;
  await fs.rm(projectPath, { recursive: true, force: true }).catch(() => {});
  return { success: true, message: 'Imported project files removed.' };
}

async function importProject(payload) {
  const steps = [];
  let workspace = null;
  const push = (name, success, message) => steps.push({ name, success, message });

  try {
    const domain = validateDomain(payload && payload.domain);
    const phpVersion = String((payload && payload.phpVersion) || '8.3').trim();
    const archivePath = String((payload && payload.archivePath) || '').trim();
    const dumpPath = String((payload && payload.dumpPath) || '').trim();
    if (!archivePath) return { success: false, message: 'Choose a code archive (.zip/.tar.gz).', steps };

    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, domain);
    if (await pathExists(projectPath)) {
      return { success: false, message: `A project folder for ${domain} already exists. Delete it first or pick another domain.`, steps };
    }
    const aliasFolder = await findAliasProjectFolder(sitesPath, domain);
    if (aliasFolder) {
      return {
        success: false,
        message: `A project folder for alias ${aliasFolder.alias} already exists. Delete it first so ${domain} can be imported cleanly.`,
        steps
      };
    }
    const dbName = localDbName(domain);
    if (dumpPath && typeof db.databaseExists === 'function') {
      const dbExists = await db.databaseExists(dbName);
      if (!dbExists.success) return { success: false, message: `Could not inspect database ${dbName}: ${dbExists.message}`, steps };
      if (dbExists.exists) {
        return { success: false, message: `Database ${dbName} already exists. Delete it first or choose another domain before importing.`, steps };
      }
    }

    // 1) Extract + locate the CMS root inside the archive.
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), `jbx-import-${domain}-`));
    const extractDir = path.join(workspace, 'extract');
    const extracted = await extractArchive(archivePath, extractDir);
    push('extract', extracted.success, extracted.success ? 'Code archive extracted.' : extracted.message);
    if (!extracted.success) return { success: false, message: extracted.message, steps };
    await assertNoSymbolicLinks(extractDir);

    const found = await detectRoot(extractDir);
    const cmsId = (payload && payload.cms) || (found && found.cmsId) || 'plain';
    const cms = cmsRegistry.get(cmsId);
    const docroot = (found && found.docroot) || cms.docroot || 'public';
    push('detect cms', true, `Detected ${cms.label}.`);

    // 2) Place files so <projectPath>/<docroot> holds the site.
    const sourceRoot = found ? found.rootDir : extractDir;
    const placement = found ? found.placement : 'docroot';
    if (placement === 'root') {
      await moveContents(sourceRoot, projectPath);
    } else {
      await moveContents(sourceRoot, path.join(projectPath, docroot));
    }
    push('place files', true, `Files placed into ${path.join(domain, placement === 'root' ? '' : docroot)}.`);

    // 3) Register the project locally (vhost, SSL, hosts, DB name) without
    //    re-installing the CMS (detect() finds the imported files).
    const registered = await projects.createProject({
      domain, phpVersion, dbName, cms: cmsId, skipCmsInstall: true,
      adoptExistingFiles: true,
      docroot,
      installWordpress: false, installPlugins: false
    });
    // createProject is resilient (records per-step failures and continues). A
    // non-critical failure such as the /etc/hosts entry must not abort the
    // import — the DB import and localization below are what matter, and the
    // hosts entry is re-applied when the user clicks "Open".
    push('register', registered.success, registered.success
      ? 'Project registered (vhost, SSL, hosts, DB).'
      : registered.message);
    if (!registered.success) {
      await cleanupImportedProject({ domain, projectPath });
      return { success: false, message: `Project registration failed: ${registered.message}`, steps };
    }

    // 4) Import the database dump (if provided).
    if (dumpPath) {
      const imported = await db.importDatabase({ dbName, sourcePath: dumpPath, createIfMissing: true });
      push('database', imported.success, imported.success ? `Database imported into ${dbName}.` : imported.message);
      if (!imported.success) {
        await cleanupImportedProject({ domain, projectPath });
        return { success: false, message: `Database import failed: ${imported.message}`, steps };
      }
    } else {
      push('database', true, 'No database dump provided — skipped.');
    }

    // 5) Localize: point the CMS config at the local DB while keeping the
    //    production domain as the local working domain via /etc/hosts.
    if (typeof cms.localize === 'function') {
      const local = await cms.localize({
        projectPath, docroot, dbName, domain, phpVersion, vm,
        hasDump: Boolean(dumpPath)
      });
      for (const s of local.steps || []) steps.push(s);
      if (!local.success) {
        await cleanupImportedProject({ domain, projectPath });
        return { success: false, message: `Localization failed: ${local.message}`, steps };
      }
    }

    // The setup descriptor (incl. hosts aliases and setup routines) was already
    // written by the register step above, so there is nothing more to persist.
    return { success: true, message: `${domain} imported as ${cms.label}. Open it to continue working.`, projectPath, cms: cmsId, steps };
  } catch (error) {
    return { success: false, message: error.message, steps };
  } finally {
    if (workspace) await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  importProject,
  _private: {
    moveContents
  }
};
