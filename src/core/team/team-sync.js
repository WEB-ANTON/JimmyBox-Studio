const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const settings = require('../settings/store');
const projects = require('../projects/project-manager');
const db = require('../db/db-manager');
const vm = require('../vm/lima');
const teamClient = require('./team-client');
const gitSync = require('./git-sync');
const projectSetup = require('../projects/project-setup');
const domainAliases = require('../projects/domain-aliases');
const hosts = require('../hosts/hosts-manager');

const execFileAsync = promisify(execFile);
const DOMAIN_RE = domainAliases.DOMAIN_RE;
const DEFAULT_UPLOADS_PATH = 'public/wp-content/uploads';
const DEFAULT_RESERVATION_TTL_MINUTES = 5 * 24 * 60;

function validateDomain(domain) {
  const clean = domainAliases.canonicalProjectDomain(domain);
  if (!clean || !DOMAIN_RE.test(clean)) {
    throw new Error('Invalid team project domain.');
  }
  return clean;
}

function safeProjectPath(sitesPath, domain) {
  const root = path.resolve(sitesPath);
  const target = path.resolve(root, domain);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Project path resolves outside the Sites path.');
  }
  return target;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

async function getLockedTeamProject(domain) {
  const cleanDomain = validateDomain(domain);
  const status = await teamClient.status();
  if (!status.success || !status.enabled) {
    return { success: false, message: status.message || 'Team Hub is not connected.' };
  }

  const result = await teamClient.getProject(cleanDomain);
  if (!result.success) return result;

  const project = result.project;
  const lock = project && project.lock;
  if (!lock || lock.state !== 'active' || lock.holderUserId !== status.user.id) {
    return { success: false, message: `Reserve ${cleanDomain} before syncing it locally.` };
  }

  return { success: true, domain: cleanDomain, project, user: status.user };
}

async function teamBackupDir() {
  const sitesPath = await settings.getExpandedSitesPath();
  const dir = path.join(sitesPath, '.jbx-team-backups', 'database');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function mediaBackupDir() {
  const sitesPath = await settings.getExpandedSitesPath();
  const dir = path.join(sitesPath, '.jbx-team-backups', 'media');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function projectBackupDir() {
  const sitesPath = await settings.getExpandedSitesPath();
  const dir = path.join(sitesPath, '.jbx-team-backups', 'project');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function tempSnapshotPath(domain, suffix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `jbx-team-${domain}-`));
  return {
    dir,
    file: path.join(dir, `${domain}-${suffix}.sql.gz`)
  };
}

async function tempArchivePath(domain, suffix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `jbx-team-${domain}-`));
  return {
    dir,
    file: path.join(dir, `${domain}-${suffix}.tar.gz`)
  };
}

async function tempWorkspace(domain, suffix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `jbx-team-${domain}-${suffix}-`));
  return { dir };
}

async function createBackgroundCheckpoint(domain, trigger, message, author = '') {
  try {
    const checkpoints = require('../projects/checkpoints');
    const result = await checkpoints.create({ domain, trigger, message, author });
    if (!result.success) {
      // A failed background checkpoint must not abort the sync, but the reason
      // (permissions, corrupt snapshot, …) must still be visible for debugging.
      console.error(`[team-sync] background checkpoint for ${domain} did not complete: ${result.message || 'unknown reason'}`);
    }
    return result.success
      ? { name: 'checkpoint', success: true, message: result.message }
      : { name: 'checkpoint', success: true, skipped: true, message: result.message || 'Checkpoint skipped.' };
  } catch (error) {
    console.error(`[team-sync] background checkpoint for ${domain} threw:`, error);
    return { name: 'checkpoint', success: true, skipped: true, message: error.message || 'Checkpoint skipped.' };
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (_error) {
    return false;
  }
}

async function runTar(args) {
  try {
    const result = await execFileAsync('tar', args, {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      maxBuffer: 1024 * 1024 * 16
    });
    return { success: true, stdout: result.stdout || '', stderr: result.stderr || '' };
  } catch (error) {
    return {
      success: false,
      message: (error.stderr || error.message || 'tar command failed.').trim(),
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    };
  }
}

function safeRelativePath(rawValue, label = 'media path') {
  const raw = String(rawValue || '').trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || raw.split('/').includes('..')) {
    throw new Error(`Team project ${label} must be a safe relative path.`);
  }
  return raw;
}

function mediaRelativePaths(projectOrSetup) {
  const raw = projectOrSetup && Array.isArray(projectOrSetup.mediaPaths)
    ? projectOrSetup.mediaPaths
    : [projectOrSetup && projectOrSetup.uploadsPath ? projectOrSetup.uploadsPath : DEFAULT_UPLOADS_PATH];
  return raw.map((item) => safeRelativePath(item, 'mediaPaths[]'));
}

function mediaRelativePath(project) {
  return mediaRelativePaths(project)[0] || DEFAULT_UPLOADS_PATH;
}

function mediaPathForProject(projectPath, relativePath) {
  const root = path.resolve(projectPath);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Media path resolves outside the project folder.');
  }
  return target;
}

async function setupForLocalProject(projectPath, project = {}) {
  return projectSetup.readSetup(projectPath, {
    domain: project.domain,
    phpVersion: project.phpVersion,
    database: project.database,
    uploadsPath: project.uploadsPath || DEFAULT_UPLOADS_PATH,
    mediaPaths: project.mediaPaths
  });
}

async function createArchive(sourceDir, destinationPath) {
  const stat = await fs.stat(sourceDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { success: false, message: `Media/uploads folder not found: ${sourceDir}` };
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  return runTar(['-czf', destinationPath, '-C', sourceDir, '.']);
}

async function createMediaArchive(projectPath, mediaPaths, destinationPath) {
  const cleanPaths = mediaRelativePaths({ mediaPaths });
  const workspace = await tempWorkspace('media', 'manifest');
  try {
    const manifest = {
      schemaVersion: 1,
      format: 'jimmybox-media-paths',
      mediaPaths: cleanPaths,
      createdAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(workspace.dir, '.jbx-media-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });

    const existing = [];
    for (const relativePath of cleanPaths) {
      const fullPath = mediaPathForProject(projectPath, relativePath);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat && stat.isDirectory()) existing.push(relativePath);
    }

    return runTar([
      '-czf', destinationPath,
      '-C', workspace.dir, '.jbx-media-manifest.json',
      ...(existing.length ? ['-C', projectPath, ...existing] : [])
    ]);
  } finally {
    await fs.rm(workspace.dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function createProjectArchive(projectPath, destinationPath) {
  const stat = await fs.stat(projectPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { success: false, message: `Project folder not found: ${projectPath}` };
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  return runTar([
    '-czf', destinationPath,
    '--exclude', './.git',
    '--exclude', './.jimmybox-studio',
    '--exclude', './.jbx-team-backups',
    '--exclude', './.jbx-transfer',
    '-C', projectPath,
    '.'
  ]);
}

// Full local safety backup. Unlike the shared bundle above, this KEEPS .git and
// .jimmybox-studio so an overwriting checkout/pull can be fully undone. Only the
// backup/transfer dirs are skipped (to avoid recursion).
async function createBackupArchive(projectPath, destinationPath) {
  const stat = await fs.stat(projectPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { success: false, message: `Project folder not found: ${projectPath}` };
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  return runTar([
    '-czf', destinationPath,
    '--exclude', './.jbx-team-backups',
    '--exclude', './.jbx-transfer',
    '-C', projectPath,
    '.'
  ]);
}

function validateArchiveName(name) {
  const clean = String(name || '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || clean.includes('\0')) {
    throw new Error(`Unsafe media archive entry: ${name}`);
  }
  const parts = clean.split('/').filter(Boolean);
  if (parts.includes('..')) {
    throw new Error(`Unsafe media archive entry: ${name}`);
  }
}

async function validateArchive(archivePath) {
  const names = await runTar(['-tzf', archivePath]);
  if (!names.success) return names;
  names.stdout.split('\n').filter(Boolean).forEach(validateArchiveName);

  const verbose = await runTar(['-tvzf', archivePath]);
  if (!verbose.success) return verbose;
  const unsafeLink = verbose.stdout.split('\n').find((line) => /^[lh]/.test(line));
  if (unsafeLink) {
    return { success: false, message: 'Media archive contains symlinks or hardlinks, which are not allowed.' };
  }

  return { success: true };
}

async function extractArchive(archivePath, targetDir) {
  const valid = await validateArchive(archivePath);
  if (!valid.success) return valid;
  await fs.mkdir(targetDir, { recursive: true });
  return runTar(['-xzf', archivePath, '-C', targetDir]);
}

async function replaceDirectoryFromArchive(targetDir, archivePath) {
  const parent = path.dirname(targetDir);
  const stash = path.join(parent, `.jbx-${path.basename(targetDir)}-${process.pid}-${Date.now()}.old`);
  const existed = await pathExists(targetDir);

  await fs.mkdir(parent, { recursive: true });
  if (existed) {
    await fs.rename(targetDir, stash);
  }

  try {
    const extracted = await extractArchive(archivePath, targetDir);
    if (!extracted.success) throw new Error(extracted.message);
    if (existed) await fs.rm(stash, { recursive: true, force: true });
    return { success: true, restoredFromStash: false };
  } catch (error) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    if (existed) {
      await fs.rename(stash, targetDir).catch(() => {});
    }
    return { success: false, restoredFromStash: existed, message: error.message };
  }
}

async function replaceDirectoryFromDirectory(targetDir, sourceDir) {
  const parent = path.dirname(targetDir);
  const stash = path.join(parent, `.jbx-${path.basename(targetDir)}-${process.pid}-${Date.now()}.old`);
  const existed = await pathExists(targetDir);

  await fs.mkdir(parent, { recursive: true });
  if (existed) await fs.rename(targetDir, stash);

  try {
    const stat = await fs.stat(sourceDir).catch(() => null);
    if (stat && stat.isDirectory()) {
      await fs.cp(sourceDir, targetDir, { recursive: true });
    } else {
      await fs.mkdir(targetDir, { recursive: true });
    }
    if (existed) await fs.rm(stash, { recursive: true, force: true });
    return { success: true, restoredFromStash: false };
  } catch (error) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    if (existed) await fs.rename(stash, targetDir).catch(() => {});
    return { success: false, restoredFromStash: existed, message: error.message };
  }
}

async function restoreMediaArchive(projectPath, mediaPaths, archivePath) {
  const workspace = await tempWorkspace('media', 'restore');
  try {
    const extracted = await extractArchive(archivePath, workspace.dir);
    if (!extracted.success) return extracted;

    const manifestPath = path.join(workspace.dir, '.jbx-media-manifest.json');
    const manifest = await fs.readFile(manifestPath, 'utf8')
      .then((raw) => JSON.parse(raw))
      .catch(() => null);

    if (!manifest || manifest.format !== 'jimmybox-media-paths') {
      const first = mediaRelativePaths({ mediaPaths })[0] || DEFAULT_UPLOADS_PATH;
      return replaceDirectoryFromArchive(mediaPathForProject(projectPath, first), archivePath);
    }

    const cleanPaths = mediaRelativePaths({ mediaPaths: manifest.mediaPaths || mediaPaths });
    const results = [];
    for (const relativePath of cleanPaths) {
      const targetDir = mediaPathForProject(projectPath, relativePath);
      const sourceDir = path.join(workspace.dir, relativePath);
      const replaced = await replaceDirectoryFromDirectory(targetDir, sourceDir);
      results.push({ relativePath, ...replaced });
      if (!replaced.success) {
        return { success: false, message: `Media restore failed for ${relativePath}: ${replaced.message}`, results };
      }
    }

    return { success: true, message: `Media restored (${cleanPaths.join(', ') || 'none'}).`, results };
  } finally {
    await fs.rm(workspace.dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readLocalProjectMetadata(projectPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), 'utf8'));
  } catch (_error) {
    return null;
  }
}

async function writeLocalProjectMetadata(projectPath, next) {
  const dir = path.join(projectPath, '.jimmybox-studio');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'project.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function patchLocalProjectMetadata(projectPath, patch) {
  const current = await readLocalProjectMetadata(projectPath) || {};
  await writeLocalProjectMetadata(projectPath, { ...current, ...patch });
}

function metadataForHub(domain, meta) {
  const mediaPaths = Array.isArray(meta && meta.mediaPaths)
    ? meta.mediaPaths
    : [meta && meta.uploadsPath ? meta.uploadsPath : DEFAULT_UPLOADS_PATH];
  return {
    domain,
    phpVersion: meta && meta.phpVersion ? meta.phpVersion : '8.2',
    database: meta && meta.database ? meta.database : domain.replace(/[^A-Za-z0-9_]/g, '_'),
    uploadsPath: mediaPaths[0] || '',
    cms: meta && meta.cms ? meta.cms : 'wordpress',
    docroot: meta && meta.docroot ? meta.docroot : 'public',
    mediaPaths
  };
}

function localBaseRevision(meta) {
  return meta && meta.teamRevisionId ? String(meta.teamRevisionId) : '';
}

function snapshotRevision(snapshot) {
  return snapshot && snapshot.revisionId ? String(snapshot.revisionId) : '';
}

function localBaseDatabaseRevision(meta) {
  return meta && meta.teamDatabaseRevisionId ? String(meta.teamDatabaseRevisionId) : '';
}

function localBaseMediaRevision(meta) {
  return meta && meta.teamMediaRevisionId ? String(meta.teamMediaRevisionId) : '';
}

function localSnapshotBases(meta) {
  return {
    database: localBaseDatabaseRevision(meta),
    media: localBaseMediaRevision(meta)
  };
}

async function ensureHubProject(domain, meta) {
  const found = await teamClient.getProject(domain);
  if (found.success) return { success: true, project: found.project, created: false };
  if (found.status && found.status !== 404) return found;

  const created = await teamClient.createProject(metadataForHub(domain, meta));
  if (!created.success) return created;
  return { success: true, project: created.project, created: true };
}

async function createProjectBundle(domain, projectPath, meta, destinationPath) {
  const workspace = await tempWorkspace(domain, 'bundle');
  try {
    const setup = await projectSetup.readSetup(projectPath, {
      domain,
      phpVersion: meta.phpVersion,
      database: meta.database,
      uploadsPath: meta.uploadsPath || DEFAULT_UPLOADS_PATH,
      cms: meta.cms || 'wordpress',
      docroot: meta.docroot || 'public',
      mediaPaths: meta.mediaPaths
    });
    await projectSetup.writeSetup(projectPath, setup);
    const setupSummary = projectSetup.setupSummary(setup);
    const manifest = {
      schemaVersion: 2,
      domain,
      phpVersion: meta.phpVersion,
      database: meta.database,
      uploadsPath: meta.uploadsPath || DEFAULT_UPLOADS_PATH,
      cms: setup.cms,
      docroot: setup.docroot,
      mediaPaths: setup.mediaPaths,
      setupSummary,
      createdAt: new Date().toISOString(),
      baseRevision: localBaseRevision(meta)
    };
    const projectArchive = path.join(workspace.dir, 'project.tar.gz');
    const databaseArchive = path.join(workspace.dir, 'database.sql.gz');
    const checkpointsArchive = path.join(workspace.dir, 'checkpoints.tar.gz');
    const manifestPath = path.join(workspace.dir, 'manifest.json');
    const setupPath = path.join(workspace.dir, 'setup.json');

    const code = await createProjectArchive(projectPath, projectArchive);
    if (!code.success) return code;

    const dumped = await db.exportDatabase({
      dbName: meta.database,
      destinationPath: databaseArchive,
      content: 'full',
      charset: 'utf8mb4',
      tableMode: 'all',
      gzip: true
    });
    if (!dumped.success) return dumped;

    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.writeFile(setupPath, `${JSON.stringify(setup, null, 2)}\n`, 'utf8');

    const checkpointWorkspace = path.join(workspace.dir, 'checkpoint-work');
    await fs.mkdir(checkpointWorkspace, { recursive: true });
    const localCheckpointIndex = path.join(projectPath, '.jimmybox-studio', 'checkpoints.json');
    const localCheckpointDir = path.join(projectPath, '.jimmybox-studio', 'checkpoints');
    if (await pathExists(localCheckpointIndex)) {
      await fs.copyFile(localCheckpointIndex, path.join(checkpointWorkspace, 'checkpoints.json'));
    } else {
      await fs.writeFile(path.join(checkpointWorkspace, 'checkpoints.json'), '{"schemaVersion":1,"checkpoints":[]}\n', 'utf8');
    }
    if (await pathExists(localCheckpointDir)) {
      await fs.cp(localCheckpointDir, path.join(checkpointWorkspace, 'checkpoints'), { recursive: true });
    }
    const checkpointPacked = await runTar(['-czf', checkpointsArchive, '-C', checkpointWorkspace, '.']);
    if (!checkpointPacked.success) return checkpointPacked;

    const packed = await runTar(['-czf', destinationPath, '-C', workspace.dir, 'manifest.json', 'setup.json', 'project.tar.gz', 'database.sql.gz', 'checkpoints.tar.gz']);
    if (!packed.success) return packed;

    return { success: true, manifest, setup, setupSummary };
  } finally {
    await fs.rm(workspace.dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractBundle(bundlePath, destinationDir) {
  const valid = await validateArchive(bundlePath);
  if (!valid.success) return valid;
  await fs.mkdir(destinationDir, { recursive: true });
  const extracted = await runTar(['-xzf', bundlePath, '-C', destinationDir]);
  if (!extracted.success) return extracted;

  const allowed = new Set(['manifest.json', 'setup.json', 'project.tar.gz', 'database.sql.gz', 'checkpoints.tar.gz']);
  const entries = await fs.readdir(destinationDir);
  const unexpected = entries.find((entry) => !allowed.has(entry));
  if (unexpected) {
    return { success: false, message: `Project bundle contains unexpected entry: ${unexpected}` };
  }

  const manifest = JSON.parse(await fs.readFile(path.join(destinationDir, 'manifest.json'), 'utf8'));
  return {
    success: true,
    manifest,
    setupPath: entries.includes('setup.json') ? path.join(destinationDir, 'setup.json') : null,
    projectArchive: path.join(destinationDir, 'project.tar.gz'),
    databaseArchive: path.join(destinationDir, 'database.sql.gz'),
    checkpointsArchive: entries.includes('checkpoints.tar.gz') ? path.join(destinationDir, 'checkpoints.tar.gz') : null
  };
}

async function backupProjectFolder(domain, projectPath) {
  if (!(await pathExists(projectPath))) {
    return { success: true, message: 'No existing local project folder to back up.', backupPath: null };
  }

  const backupDir = await projectBackupDir();
  const backupPath = path.join(backupDir, `${domain}-${timestamp()}-before-checkout.tar.gz`);
  const backup = await createBackupArchive(projectPath, backupPath);
  return { ...backup, backupPath, message: backup.success ? `Project folder backup created at ${backupPath}.` : backup.message };
}

async function backupDatabase(domain, dbName) {
  const exists = await db.databaseExists(dbName);
  if (!exists.success) return { success: false, message: exists.message };
  if (!exists.exists) return { success: true, message: 'No existing local database to back up.', backupPath: null };

  const backupDir = await teamBackupDir();
  const backupPath = path.join(backupDir, `${domain}-${timestamp()}-before-checkout.sql.gz`);
  const backup = await db.exportDatabase({
    dbName,
    destinationPath: backupPath,
    content: 'full',
    charset: 'utf8mb4',
    tableMode: 'all',
    gzip: true
  });
  return { ...backup, backupPath, message: backup.success ? backup.message : backup.message };
}

async function syncProject(domain) {
  try {
    const teamProject = await getLockedTeamProject(domain);
    if (!teamProject.success) return teamProject;

    const cleanDomain = teamProject.domain;
    const project = teamProject.project;
    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, cleanDomain);
    const steps = [];

    const git = await gitSync.syncRepository(projectPath, project.repositoryUrl);
    steps.push({ name: 'git', success: git.success, message: git.message });
    if (!git.success) {
      return {
        success: false,
        message: `Git sync failed: ${git.message}`,
        steps
      };
    }

    const local = await projects.createProject({
      domain: cleanDomain,
      phpVersion: project.phpVersion,
      dbName: project.database,
      cms: project.setupSummary && project.setupSummary.cms ? project.setupSummary.cms : undefined,
      docroot: project.setupSummary && project.setupSummary.docroot ? project.setupSummary.docroot : undefined,
      mediaPaths: project.setupSummary && Array.isArray(project.setupSummary.mediaPaths) ? project.setupSummary.mediaPaths : undefined,
      adoptExistingFiles: true,
      skipCmsInstall: true,
      installWordpress: false,
      installPlugins: false
    });
    steps.push({ name: 'local project', success: local.success, message: local.message });

    if (!local.success) {
      return {
        success: false,
        message: `Local project setup failed: ${local.message}`,
        steps
      };
    }

    return {
      success: true,
      message: `Team project ${cleanDomain} synced locally.`,
      projectPath,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function pullDatabase(domain) {
  let download = null;

  try {
    const teamProject = await getLockedTeamProject(domain);
    if (!teamProject.success) return teamProject;

    const { domain: cleanDomain, project } = teamProject;
    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, cleanDomain);
    const steps = [];
    download = await tempSnapshotPath(cleanDomain, 'pull');

    const pulled = await teamClient.downloadDatabaseSnapshot(cleanDomain, download.file);
    steps.push({ name: 'download', success: pulled.success, message: pulled.message });
    if (!pulled.success || !pulled.snapshot) {
      return {
        success: pulled.success,
        message: pulled.message,
        steps
      };
    }

    const dbName = project.database;
    const exists = await db.databaseExists(dbName);
    if (!exists.success) {
      steps.push({ name: 'backup', success: false, message: exists.message });
      return { success: false, message: `Could not inspect local database: ${exists.message}`, steps };
    }

    let backupPath = null;
    if (exists.exists) {
      const backupDir = await teamBackupDir();
      backupPath = path.join(backupDir, `${cleanDomain}-${timestamp()}-before-pull.sql.gz`);
      const backup = await db.exportDatabase({
        dbName,
        destinationPath: backupPath,
        content: 'full',
        charset: 'utf8mb4',
        tableMode: 'all',
        gzip: true
      });
      steps.push({ name: 'backup', success: backup.success, message: backup.message });
      if (!backup.success) {
        return { success: false, message: `Local backup failed: ${backup.message}`, steps };
      }
    } else {
      steps.push({ name: 'backup', success: true, message: 'No existing local database to back up.' });
    }

    const imported = await db.importDatabase({
      dbName,
      sourcePath: download.file,
      createIfMissing: true
    });
    steps.push({ name: 'import', success: imported.success, message: imported.message });
    if (!imported.success) {
      return { success: false, message: `Database import failed: ${imported.message}`, backupPath, steps };
    }

    await patchLocalProjectMetadata(projectPath, {
      domain: cleanDomain,
      phpVersion: project.phpVersion,
      database: dbName,
      teamDatabaseRevisionId: snapshotRevision(pulled.snapshot),
      teamDatabasePulledAt: new Date().toISOString()
    });

    return {
      success: true,
      message: backupPath
        ? `Database ${dbName} pulled. Local backup: ${backupPath}`
        : `Database ${dbName} pulled.`,
      backupPath,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    if (download && download.dir) {
      await fs.rm(download.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function pushDatabase(domain) {
  let exported = null;

  try {
    const teamProject = await getLockedTeamProject(domain);
    if (!teamProject.success) return teamProject;

    const { domain: cleanDomain, project } = teamProject;
    const steps = [];

    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, cleanDomain);
    const meta = await readLocalProjectMetadata(projectPath);
    const remoteDatabaseRevision = snapshotRevision(project.databaseSnapshot);
    const baseDatabaseRevision = localBaseDatabaseRevision(meta);
    if (remoteDatabaseRevision !== baseDatabaseRevision) {
      return { success: false, message: `${cleanDomain} database changed on the Hub. Pull the latest database before pushing.`, steps };
    }

    exported = await tempSnapshotPath(cleanDomain, 'push');

    const dumped = await db.exportDatabase({
      dbName: project.database,
      destinationPath: exported.file,
      content: 'full',
      charset: 'utf8mb4',
      tableMode: 'all',
      gzip: true
    });
    steps.push({ name: 'export', success: dumped.success, message: dumped.message });
    if (!dumped.success) {
      return { success: false, message: `Database export failed: ${dumped.message}`, steps };
    }

    const uploaded = await teamClient.uploadDatabaseSnapshot(cleanDomain, exported.file, baseDatabaseRevision);
    steps.push({ name: 'upload', success: uploaded.success, message: uploaded.message || 'Snapshot uploaded.' });
    if (!uploaded.success) {
      return { success: false, message: `Database upload failed: ${uploaded.message}`, steps };
    }

    await patchLocalProjectMetadata(projectPath, {
      domain: cleanDomain,
      phpVersion: project.phpVersion,
      database: project.database,
      teamDatabaseRevisionId: snapshotRevision(uploaded.snapshot),
      teamDatabasePushedAt: new Date().toISOString()
    });

    return {
      success: true,
      message: `Database ${project.database} pushed to Hub.`,
      snapshot: uploaded.snapshot,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    if (exported && exported.dir) {
      await fs.rm(exported.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function pullMedia(domain) {
  let download = null;

  try {
    const teamProject = await getLockedTeamProject(domain);
    if (!teamProject.success) return teamProject;

    const { domain: cleanDomain, project } = teamProject;
    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, cleanDomain);
    const setup = await setupForLocalProject(projectPath, { ...project, domain: cleanDomain });
    const mediaPaths = setup.mediaPaths;
    const steps = [];
    download = await tempArchivePath(cleanDomain, 'media-pull');

    const pulled = await teamClient.downloadMediaSnapshot(cleanDomain, download.file);
    steps.push({ name: 'download', success: pulled.success, message: pulled.message });
    if (!pulled.success || !pulled.snapshot) {
      return {
        success: pulled.success,
        message: pulled.message,
        steps
      };
    }

    let backupPath = null;
    if (mediaPaths.length) {
      const backupDir = await mediaBackupDir();
      backupPath = path.join(backupDir, `${cleanDomain}-${timestamp()}-before-pull.tar.gz`);
      const backup = await createMediaArchive(projectPath, mediaPaths, backupPath);
      steps.push({ name: 'backup', success: backup.success, message: backup.success ? `Media backup created at ${backupPath}.` : backup.message });
      if (!backup.success) {
        return { success: false, message: `Media backup failed: ${backup.message}`, steps };
      }
    } else {
      steps.push({ name: 'backup', success: true, message: 'This project has no media paths to back up.' });
    }

    const replaced = await restoreMediaArchive(projectPath, mediaPaths, download.file);
    steps.push({ name: 'extract', success: replaced.success, message: replaced.success ? replaced.message : replaced.message });
    if (!replaced.success) {
      return { success: false, message: `Media import failed: ${replaced.message}`, backupPath, steps };
    }

    await patchLocalProjectMetadata(projectPath, {
      domain: cleanDomain,
      phpVersion: project.phpVersion,
      database: project.database,
      mediaPaths,
      uploadsPath: mediaPaths[0] || project.uploadsPath || DEFAULT_UPLOADS_PATH,
      teamMediaRevisionId: snapshotRevision(pulled.snapshot),
      teamMediaPulledAt: new Date().toISOString()
    });

    return {
      success: true,
      message: backupPath
        ? `Media/uploads pulled. Local backup: ${backupPath}`
        : 'Media/uploads pulled.',
      backupPath,
      mediaPaths,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    if (download && download.dir) {
      await fs.rm(download.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function pushMedia(domain) {
  let archive = null;

  try {
    const teamProject = await getLockedTeamProject(domain);
    if (!teamProject.success) return teamProject;

    const { domain: cleanDomain, project } = teamProject;
    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, cleanDomain);
    const setup = await setupForLocalProject(projectPath, { ...project, domain: cleanDomain });
    const mediaPaths = setup.mediaPaths;
    const steps = [];

    const meta = await readLocalProjectMetadata(projectPath);
    const remoteMediaRevision = snapshotRevision(project.mediaSnapshot);
    const baseMediaRevision = localBaseMediaRevision(meta);
    if (remoteMediaRevision !== baseMediaRevision) {
      return { success: false, message: `${cleanDomain} media changed on the Hub. Pull the latest media before pushing.`, steps };
    }

    archive = await tempArchivePath(cleanDomain, 'media-push');

    const packed = await createMediaArchive(projectPath, mediaPaths, archive.file);
    steps.push({ name: 'archive', success: packed.success, message: packed.success ? `Media archive created for ${mediaPaths.join(', ') || 'no media paths'}.` : packed.message });
    if (!packed.success) {
      return { success: false, message: `Media archive failed: ${packed.message}`, steps };
    }

    const valid = await validateArchive(archive.file);
    steps.push({ name: 'validate', success: valid.success, message: valid.success ? 'Media archive validated.' : valid.message });
    if (!valid.success) {
      return { success: false, message: `Media archive validation failed: ${valid.message}`, steps };
    }

    const uploaded = await teamClient.uploadMediaSnapshot(cleanDomain, archive.file, baseMediaRevision);
    steps.push({ name: 'upload', success: uploaded.success, message: uploaded.message || 'Media snapshot uploaded.' });
    if (!uploaded.success) {
      return { success: false, message: `Media upload failed: ${uploaded.message}`, steps };
    }

    await patchLocalProjectMetadata(projectPath, {
      domain: cleanDomain,
      phpVersion: project.phpVersion,
      database: project.database,
      mediaPaths,
      uploadsPath: mediaPaths[0] || project.uploadsPath || DEFAULT_UPLOADS_PATH,
      teamMediaRevisionId: snapshotRevision(uploaded.snapshot),
      teamMediaPushedAt: new Date().toISOString()
    });

    return {
      success: true,
      message: 'Media/uploads pushed to Hub.',
      snapshot: uploaded.snapshot,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    if (archive && archive.dir) {
      await fs.rm(archive.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function restoreProjectBundle(domain, bundlePath, hubProject, revision, opts = {}) {
  const workspace = await tempWorkspace(domain, 'restore');
  const steps = [];

  try {
    const extracted = await extractBundle(bundlePath, workspace.dir);
    steps.push({ name: 'bundle', success: extracted.success, message: extracted.success ? 'Project bundle extracted.' : extracted.message });
    if (!extracted.success) return { success: false, message: extracted.message, steps };

    const manifest = extracted.manifest;
    const cleanDomain = validateDomain(manifest.domain || domain);
    if (cleanDomain !== domain) {
      return { success: false, message: `Bundle is for ${cleanDomain}, not ${domain}.`, steps };
    }

    const setupRaw = extracted.setupPath
      ? JSON.parse(await fs.readFile(extracted.setupPath, 'utf8'))
      : {};
    const setup = projectSetup.sanitizeSetup(setupRaw, {
      domain: cleanDomain,
      phpVersion: manifest.phpVersion || hubProject.phpVersion,
      database: manifest.database || hubProject.database,
      uploadsPath: manifest.uploadsPath || hubProject.uploadsPath || DEFAULT_UPLOADS_PATH,
      docroot: manifest.docroot || 'public',
      mediaPaths: manifest.mediaPaths
    });
    const setupSummary = projectSetup.setupSummary(setup);

    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, cleanDomain);
    const dbName = String(setup.database || manifest.database || hubProject.database || '').trim();
    const phpVersion = String(setup.phpVersion || manifest.phpVersion || hubProject.phpVersion || '').trim();
    const uploadsPath = String((setup.mediaPaths && setup.mediaPaths[0]) || manifest.uploadsPath || hubProject.uploadsPath || DEFAULT_UPLOADS_PATH).trim();

    const projectBackup = await backupProjectFolder(cleanDomain, projectPath);
    steps.push({ name: 'project backup', success: projectBackup.success, message: projectBackup.message });
    if (!projectBackup.success) return { success: false, message: `Project backup failed: ${projectBackup.message}`, steps };

    const databaseBackup = await backupDatabase(cleanDomain, dbName);
    steps.push({ name: 'database backup', success: databaseBackup.success, message: databaseBackup.message });
    if (!databaseBackup.success) return { success: false, message: `Database backup failed: ${databaseBackup.message}`, steps };

    const replaced = await replaceDirectoryFromArchive(projectPath, extracted.projectArchive);
    steps.push({ name: 'project files', success: replaced.success, message: replaced.success ? 'Project files restored.' : replaced.message });
    if (!replaced.success) return { success: false, message: `Project restore failed: ${replaced.message}`, steps };

    if (extracted.checkpointsArchive) {
      const checkpointTarget = path.join(projectPath, '.jimmybox-studio');
      await fs.mkdir(checkpointTarget, { recursive: true });
      const checkpoints = await extractArchive(extracted.checkpointsArchive, checkpointTarget);
      steps.push({ name: 'checkpoints', success: checkpoints.success, message: checkpoints.success ? 'Checkpoint history restored.' : checkpoints.message });
      if (!checkpoints.success) return { success: false, message: `Checkpoint restore failed: ${checkpoints.message}`, steps };
    }

    // Import the database right after the project files are in place and before
    // provisioning/setup routines run (they assume a populated DB), so a failed
    // import cannot leave new files paired with the previous database.
    const imported = await db.importDatabase({
      dbName,
      sourcePath: extracted.databaseArchive,
      createIfMissing: true
    });
    steps.push({ name: 'database', success: imported.success, message: imported.message });
    if (!imported.success) return { success: false, message: `Database import failed: ${imported.message}`, steps };

    await projectSetup.writeSetup(projectPath, setup);
    steps.push({ name: 'setup descriptor', success: true, message: 'Project setup descriptor restored.' });

    const local = await projects.createProject({
      domain: cleanDomain,
      phpVersion,
      dbName,
      cms: setup.cms,
      docroot: setup.docroot,
      mediaPaths: setup.mediaPaths,
      skipCmsInstall: true,
      installWordpress: false,
      installPlugins: false
    });
    steps.push({ name: 'local project', success: local.success, message: local.message });
    if (!local.success) return { success: false, message: `Local project setup failed: ${local.message}`, steps };

    const hostResult = await projectSetup.applyHosts(setup);
    steps.push({ name: 'project hosts', success: hostResult.success, message: hostResult.message });
    if (!hostResult.success) return { success: false, message: `Project hosts failed: ${hostResult.message}`, steps };

    const provisioned = await projectSetup.runProvisioning(setup, projectPath, 'checkout', {
      confirmedCommands: opts.confirmedCommands
    });
    steps.push(...provisioned.steps);
    if (!provisioned.success) return { success: false, message: 'Project provisioning failed.', steps };

    const routines = await projectSetup.runSetupRoutines(setup, projectPath, 'checkout', {
      confirmedCommands: opts.confirmedCommands
    });
    steps.push(...routines.steps);
    if (!routines.success) return { success: false, message: 'Project setup routine failed.', steps };

    await writeLocalProjectMetadata(projectPath, {
      domain: cleanDomain,
      phpVersion,
      database: dbName,
      cms: setup.cms,
      docroot: setup.docroot,
      mediaPaths: setup.mediaPaths,
      uploadsPath,
      teamRevisionId: revision && revision.id ? revision.id : '',
      teamRevisionAt: revision && revision.pushedAt ? revision.pushedAt : '',
      teamDatabaseRevisionId: snapshotRevision(hubProject.databaseSnapshot),
      teamMediaRevisionId: snapshotRevision(hubProject.mediaSnapshot),
      teamPulledAt: new Date().toISOString()
    });

    return {
      success: true,
      message: `${cleanDomain} checked out from Hub.`,
      projectPath,
      backupPath: projectBackup.backupPath,
      databaseBackupPath: databaseBackup.backupPath,
      setup: setupSummary,
      steps
    };
  } finally {
    await fs.rm(workspace.dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function checkoutProject(domain, opts = {}) {
  let download = null;
  let reservedDomain = '';
  let keepReservation = false;

  try {
    const cleanDomain = validateDomain(domain);
    const reserved = await teamClient.reserveProject(cleanDomain, { ttlMinutes: DEFAULT_RESERVATION_TTL_MINUTES, message: 'Checked out in JimmyBox Studio' });
    if (!reserved.success) return reserved;
    reservedDomain = cleanDomain;

    const started = await vm.start();
    if (!started.success) {
      return {
        success: false,
        message: `VM start failed: ${started.message}`,
        steps: [
          { name: 'reserve', success: true, message: 'Project reserved.' },
          { name: 'vm', success: false, message: started.message }
        ]
      };
    }

    const project = reserved.project;
    if (!project.projectBundle || !project.revision) {
      const local = await projects.createProject({
        domain: cleanDomain,
        phpVersion: project.phpVersion,
        dbName: project.database,
        cms: project.setupSummary && project.setupSummary.cms ? project.setupSummary.cms : 'plain',
        docroot: project.setupSummary && project.setupSummary.docroot ? project.setupSummary.docroot : 'public',
        mediaPaths: project.setupSummary && Array.isArray(project.setupSummary.mediaPaths) ? project.setupSummary.mediaPaths : [project.uploadsPath || DEFAULT_UPLOADS_PATH],
        skipCmsInstall: true,
        installWordpress: false,
        installPlugins: false
      });
      if (!local.success) {
        return {
          ...local,
          steps: [
            { name: 'reserve', success: true, message: 'Project reserved.' },
            { name: 'vm', success: true, message: started.message },
            { name: 'local project', success: false, message: local.message }
          ]
        };
      }

      const sitesPath = await settings.getExpandedSitesPath();
      const projectPath = safeProjectPath(sitesPath, cleanDomain);
      const setup = await projectSetup.writeSetup(projectPath, projectSetup.sanitizeSetup({}, {
        domain: cleanDomain,
        phpVersion: project.phpVersion,
        database: project.database,
        uploadsPath: project.uploadsPath || DEFAULT_UPLOADS_PATH,
        cms: project.setupSummary && project.setupSummary.cms ? project.setupSummary.cms : 'plain',
        docroot: project.setupSummary && project.setupSummary.docroot ? project.setupSummary.docroot : 'public',
        mediaPaths: project.setupSummary && Array.isArray(project.setupSummary.mediaPaths) ? project.setupSummary.mediaPaths : [project.uploadsPath || DEFAULT_UPLOADS_PATH]
      }));
      await writeLocalProjectMetadata(projectPath, {
        domain: cleanDomain,
        phpVersion: project.phpVersion,
        database: project.database,
        cms: setup.cms,
        docroot: setup.docroot,
        mediaPaths: setup.mediaPaths,
        uploadsPath: project.uploadsPath || DEFAULT_UPLOADS_PATH,
        teamRevisionId: '',
        teamRevisionAt: '',
        teamDatabaseRevisionId: snapshotRevision(project.databaseSnapshot),
        teamMediaRevisionId: snapshotRevision(project.mediaSnapshot),
        teamPulledAt: new Date().toISOString()
      });

      keepReservation = true;
      const steps = [
        { name: 'reserve', success: true, message: 'Project reserved.' },
        { name: 'vm', success: true, message: started.message },
        { name: 'local project', success: true, message: local.message },
        { name: 'setup descriptor', success: true, message: 'Project setup descriptor created.' }
      ];
      steps.push(await createBackgroundCheckpoint(cleanDomain, 'checkout', 'Initial checkout checkpoint'));
      return {
        success: true,
        message: `${cleanDomain} reserved. No Hub bundle exists yet.`,
        project,
        setup: projectSetup.setupSummary(setup),
        steps
      };
    }

    download = await tempArchivePath(cleanDomain, 'checkout');
    const pulled = await teamClient.downloadProjectBundle(cleanDomain, download.file);
    const leadingSteps = [
      { name: 'reserve', success: true, message: 'Project reserved.' },
      { name: 'vm', success: true, message: started.message },
      { name: 'download', success: pulled.success, message: pulled.message }
    ];
    if (!pulled.success) return { ...pulled, steps: leadingSteps };

    const restored = await restoreProjectBundle(cleanDomain, download.file, project, project.revision, opts);
    restored.steps = [...leadingSteps, ...(restored.steps || [])];
    if (!restored.success) return restored;

    keepReservation = true;
    restored.steps.push(await createBackgroundCheckpoint(cleanDomain, 'checkout', 'Checkout checkpoint'));
    return {
      ...restored,
      project,
      message: `${cleanDomain} reserved and current Hub revision downloaded.`
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    if (reservedDomain && !keepReservation) {
      await teamClient.releaseProject(reservedDomain).catch(() => {});
    }
    if (download && download.dir) {
      await fs.rm(download.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function pushLocalProject(domain) {
  let bundle = null;
  let reserved = false;
  let reservedDomain = '';

  try {
    const cleanDomain = validateDomain(domain);
    const status = await teamClient.status();
    if (!status.success || !status.enabled) {
      return { success: false, message: status.message || 'Team Hub is not connected.' };
    }

    const sitesPath = await settings.getExpandedSitesPath();
    const projectPath = safeProjectPath(sitesPath, cleanDomain);
    const meta = await readLocalProjectMetadata(projectPath);
    if (!meta) return { success: false, message: `${cleanDomain} has no local JimmyBox project metadata.` };

    const steps = [];
    const hub = await ensureHubProject(cleanDomain, meta);
    steps.push({ name: 'hub project', success: hub.success, message: hub.created ? 'Project created on Hub.' : 'Project found on Hub.' });
    if (!hub.success) return { success: false, message: hub.message, steps };

    const remoteRevision = hub.project && hub.project.revision && hub.project.revision.id ? hub.project.revision.id : '';
    const baseRevision = localBaseRevision(meta);
    if (remoteRevision !== baseRevision) {
      return {
        success: false,
        message: `Local project is based on revision "${baseRevision || 'none'}", but Hub has "${remoteRevision}". Reserve/Pull the latest Hub revision before pushing.`,
        steps
      };
    }

    const remoteDatabaseRevision = snapshotRevision(hub.project && hub.project.databaseSnapshot);
    const baseDatabaseRevision = localBaseDatabaseRevision(meta);
    if (remoteDatabaseRevision !== baseDatabaseRevision) {
      return {
        success: false,
        message: `Local project is based on database snapshot "${baseDatabaseRevision || 'none'}", but Hub has "${remoteDatabaseRevision}". Pull the latest database before pushing.`,
        steps
      };
    }

    const remoteMediaRevision = snapshotRevision(hub.project && hub.project.mediaSnapshot);
    const baseMediaRevision = localBaseMediaRevision(meta);
    if (remoteMediaRevision !== baseMediaRevision) {
      return {
        success: false,
        message: `Local project is based on media snapshot "${baseMediaRevision || 'none'}", but Hub has "${remoteMediaRevision}". Pull the latest media before pushing.`,
        steps
      };
    }

    const lock = hub.project && hub.project.lock;
    if (lock && lock.state === 'active' && status.user && lock.holderUserId !== status.user.id) {
      return { success: false, message: `${cleanDomain} is reserved by ${lock.holderName}.`, steps };
    }

    const reserve = await teamClient.reserveProject(cleanDomain, { ttlMinutes: DEFAULT_RESERVATION_TTL_MINUTES, message: 'Publishing from JimmyBox Studio' });
    steps.push({ name: 'reserve', success: reserve.success, message: reserve.message || 'Project reserved for push.' });
    if (!reserve.success) return { success: false, message: reserve.message, steps };
    reserved = true;
    reservedDomain = cleanDomain;

    bundle = await tempArchivePath(cleanDomain, 'project-push');
    const packed = await createProjectBundle(cleanDomain, projectPath, {
      ...metadataForHub(cleanDomain, meta),
      teamRevisionId: baseRevision
    }, bundle.file);
    steps.push({ name: 'bundle', success: packed.success, message: packed.success ? 'Project bundle created.' : packed.message });
    if (!packed.success) return { success: false, message: `Project bundle failed: ${packed.message}`, steps };

    const uploaded = await teamClient.uploadProjectBundle(cleanDomain, bundle.file, baseRevision, packed.setupSummary, localSnapshotBases(meta));
    steps.push({ name: 'upload', success: uploaded.success, message: uploaded.message || 'Project bundle uploaded.' });
    if (!uploaded.success) return { success: false, message: uploaded.message, steps };

    const revision = uploaded.revision || {};
    await writeLocalProjectMetadata(projectPath, {
      ...metadataForHub(cleanDomain, meta),
      teamDatabaseRevisionId: baseDatabaseRevision,
      teamMediaRevisionId: baseMediaRevision,
      teamRevisionId: revision.id || '',
      teamRevisionAt: revision.pushedAt || '',
      teamPushedAt: new Date().toISOString()
    });

    const checkpoints = require('../projects/checkpoints');
    const localCheckpointSync = await checkpoints.syncLocalToHub(cleanDomain, {
      author: status.user && status.user.name ? status.user.name : ''
    });
    steps.push({
      name: 'local checkpoints',
      success: localCheckpointSync.success,
      skipped: Boolean(localCheckpointSync.skipped),
      message: localCheckpointSync.message || 'Local checkpoints synced to Hub.'
    });
    if (!localCheckpointSync.success) {
      return { success: false, message: `Project pushed, but local checkpoint sync failed: ${localCheckpointSync.message}`, revision, steps };
    }

    steps.push(await createBackgroundCheckpoint(
      cleanDomain,
      'push',
      `Push checkpoint ${revision.id ? revision.id.slice(0, 8) : ''}`.trim(),
      status.user && status.user.name ? status.user.name : ''
    ));

    const released = await teamClient.releaseProject(cleanDomain);
    steps.push({ name: 'release', success: released.success, message: released.message || 'Project released.' });
    if (!released.success) {
      return { success: false, message: `Project pushed, but release failed: ${released.message}`, revision, steps };
    }
    reserved = false;

    // Turn the local hosts entry off after pushing, so you can't keep editing a
    // project you've handed back without checking it out again first.
    const hostOff = await hosts.setProjectEntriesEnabled(domainAliases.projectAliases(cleanDomain), false).catch((error) => ({ success: false, message: error.message }));
    steps.push({
      name: 'local host',
      success: true,
      message: hostOff.success
        ? 'Local host disabled — check the project out again before you keep working.'
        : `Could not disable the local host: ${hostOff.message || 'unknown error'}.`
    });

    return {
      success: true,
      message: `${cleanDomain} pushed to Hub and released. Local host disabled — check it out again to keep working.`,
      revision,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    if (reserved) {
      await teamClient.releaseProject(reservedDomain).catch(() => {});
    }
    if (bundle && bundle.dir) {
      await fs.rm(bundle.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function syncLocalCheckpoints(domain = '') {
  try {
    const checkpoints = require('../projects/checkpoints');
    if (domain) return checkpoints.syncLocalToHub(domain);

    const listed = await projects.listProjects();
    if (!listed.success) return listed;

    const steps = [];
    let synced = 0;
    let skipped = 0;
    for (const project of listed.projects || []) {
      const result = await checkpoints.syncLocalToHub(project.domain);
      synced += result.synced || 0;
      skipped += result.skipped ? 1 : 0;
      steps.push({
        name: project.domain,
        success: result.success,
        skipped: Boolean(result.skipped),
        message: result.message
      });
      if (!result.success) {
        return { success: false, message: result.message || 'Local checkpoint sync failed.', steps, synced, skipped };
      }
    }

    return {
      success: true,
      synced,
      skipped,
      steps,
      message: synced
        ? `Synced ${synced} local checkpoint(s) to the Hub.`
        : 'No local checkpoints needed Hub sync.'
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function releaseProject(domain) {
  try {
    const cleanDomain = validateDomain(domain);
    const teamProject = await getLockedTeamProject(cleanDomain);
    if (!teamProject.success) return teamProject;
    const released = await teamClient.releaseProject(cleanDomain);
    if (!released.success) return released;

    return {
      ...released,
      message: `${cleanDomain} released.`
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

module.exports = {
  syncProject,
  checkoutProject,
  pushLocalProject,
  pullDatabase,
  pushDatabase,
  pullMedia,
  pushMedia,
  syncLocalCheckpoints,
  releaseProject,
  _private: {
    createProjectArchive,
    createBackupArchive,
    createMediaArchive,
    restoreMediaArchive,
    replaceDirectoryFromArchive,
    extractArchive,
    extractBundle,
    validateArchive,
    safeProjectPath,
    mediaRelativePath,
    metadataForHub
  }
};
