const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const DEFAULT_UPLOADS_PATH = 'public/wp-content/uploads';

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (_error) {
    return false;
  }
}

function safeProjectPath(sitesPath, domain) {
  const root = path.resolve(sitesPath);
  const target = path.resolve(root, domain);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Project path resolves outside the Sites path.');
  }
  return target;
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
    throw new Error(`Project ${label} must be a safe relative path.`);
  }
  return raw;
}

function mediaRelativePaths(projectOrSetup) {
  const raw = projectOrSetup && Array.isArray(projectOrSetup.mediaPaths)
    ? projectOrSetup.mediaPaths
    : [projectOrSetup && projectOrSetup.uploadsPath ? projectOrSetup.uploadsPath : DEFAULT_UPLOADS_PATH];
  return raw.map((item) => safeRelativePath(item, 'mediaPaths[]'));
}

function mediaPathForProject(projectPath, relativePath) {
  const root = path.resolve(projectPath);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Media path resolves outside the project folder.');
  }
  return target;
}

async function tempWorkspace(domain, suffix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `jbx-solo-${domain}-${suffix}-`));
  return { dir };
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

    return await runTar([
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
    '--exclude', './.jbx-solo-backups',
    '--exclude', './.jbx-team-backups',
    '--exclude', './.jbx-transfer',
    '-C', projectPath,
    '.'
  ]);
}

async function createBackupArchive(projectPath, destinationPath) {
  const stat = await fs.stat(projectPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { success: false, message: `Project folder not found: ${projectPath}` };
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  return runTar([
    '-czf', destinationPath,
    '--exclude', './.jbx-solo-backups',
    '--exclude', './.jbx-team-backups',
    '--exclude', './.jbx-transfer',
    '-C', projectPath,
    '.'
  ]);
}

function validateArchiveName(name) {
  const clean = String(name || '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || clean.includes('\0')) {
    throw new Error(`Unsafe archive entry: ${name}`);
  }
  const parts = clean.split('/').filter(Boolean);
  if (parts.includes('..')) {
    throw new Error(`Unsafe archive entry: ${name}`);
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
    return { success: false, message: 'Archive contains symlinks or hardlinks, which are not allowed.' };
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
  if (existed) await fs.rename(targetDir, stash);

  try {
    const extracted = await extractArchive(archivePath, targetDir);
    if (!extracted.success) throw new Error(extracted.message);
    if (existed) await fs.rm(stash, { recursive: true, force: true });
    return { success: true, restoredFromStash: false };
  } catch (error) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    if (existed) await fs.rename(stash, targetDir).catch(() => {});
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

module.exports = {
  createBackupArchive,
  createMediaArchive,
  createProjectArchive,
  extractArchive,
  mediaPathForProject,
  mediaRelativePaths,
  replaceDirectoryFromArchive,
  restoreMediaArchive,
  safeProjectPath
};
