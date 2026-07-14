const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const settings = require('../settings/store');
const db = require('../db/db-manager');
const projectSetup = require('./project-setup');
const archiveUtils = require('./archive-utils');

const execFileAsync = promisify(execFile);
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);
const DOMAIN_RE = /^[A-Za-z0-9._-]+$/;
const INDEX_VERSION = 1;

function validateDomain(domain) {
  const clean = String(domain || '').trim();
  if (!clean || !DOMAIN_RE.test(clean)) throw new Error('Invalid project domain.');
  return clean;
}

function checkpointsDir(projectPath) {
  return path.join(projectPath, '.jimmybox-studio', 'checkpoints');
}

function indexPath(projectPath) {
  return path.join(projectPath, '.jimmybox-studio', 'checkpoints.json');
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (_error) {
    return false;
  }
}

async function projectPathForDomain(domain) {
  const clean = validateDomain(domain);
  const sitesPath = await settings.getExpandedSitesPath();
  return archiveUtils.safeProjectPath(sitesPath, clean);
}

async function readMetadata(projectPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), 'utf8'));
  } catch (_error) {
    return null;
  }
}

async function readIndex(projectPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath(projectPath), 'utf8'));
    return {
      schemaVersion: INDEX_VERSION,
      checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { schemaVersion: INDEX_VERSION, checkpoints: [] };
  }
}

async function writeIndex(projectPath, index) {
  const target = indexPath(projectPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify({ schemaVersion: INDEX_VERSION, checkpoints: index.checkpoints }, null, 2)}\n`, 'utf8');
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fsSync.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function gzipBuffer(buffer) {
  return gzipAsync(buffer);
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fileInfo(root, relativePath) {
  const file = path.join(root, relativePath);
  const stat = await fs.stat(file);
  return {
    file: relativePath,
    sha256: await sha256File(file),
    size: stat.size
  };
}

async function git(args, cwd) {
  const result = await execFileAsync('git', args, { cwd, maxBuffer: 1024 * 1024 * 16 });
  return String(result.stdout || '').trim();
}

async function gitInfo(projectPath) {
  try {
    const commit = await git(['rev-parse', 'HEAD'], projectPath);
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath).catch(() => '');
    const status = await git(['status', '--porcelain'], projectPath).catch(() => '');
    return { commit, branch, dirty: Boolean(status.trim()) };
  } catch (_error) {
    return { commit: '', branch: '', dirty: false, missing: true };
  }
}

function latestCheckpoint(index) {
  return index.checkpoints[0] || null;
}

async function prune(projectPath, index, keepLast) {
  const keep = Math.max(1, parseInt(keepLast, 10) || 50);
  const pinned = index.checkpoints.filter((item) => item.pinned);
  const recent = index.checkpoints.filter((item) => !item.pinned).slice(0, keep);
  const retained = new Set([...pinned, ...recent].map((item) => item.id));
  const removed = index.checkpoints.filter((item) => !retained.has(item.id));
  index.checkpoints = index.checkpoints.filter((item) => retained.has(item.id));

  for (const checkpoint of removed) {
    for (const artifact of [checkpoint.filesArchive, checkpoint.database, checkpoint.media, checkpoint.setup]) {
      if (artifact && artifact.file) {
        await fs.unlink(path.join(checkpointsDir(projectPath), artifact.file)).catch(() => {});
      }
    }
  }
}

async function createLocal({ domain, message, author, keepLast = 50 } = {}) {
  try {
    const cleanDomain = validateDomain(domain);
    const projectPath = await projectPathForDomain(cleanDomain);
    const metadata = await readMetadata(projectPath);
    const setup = await projectSetup.readSetup(projectPath, {
      domain: cleanDomain,
      phpVersion: metadata && metadata.phpVersion,
      database: metadata && metadata.database,
      mediaPaths: metadata && metadata.mediaPaths,
      uploadsPath: metadata && metadata.uploadsPath
    });
    const dbName = setup.database || (metadata && metadata.database);
    if (!dbName) throw new Error('Project database metadata is missing.');

    const id = crypto.randomUUID();
    const baseDir = checkpointsDir(projectPath);
    await fs.mkdir(path.join(baseDir, 'files'), { recursive: true });
    await fs.mkdir(path.join(baseDir, 'db'), { recursive: true });
    await fs.mkdir(path.join(baseDir, 'media'), { recursive: true });
    await fs.mkdir(path.join(baseDir, 'setup'), { recursive: true });

    const filesRelative = `files/${id}.tar.gz`;
    const dbRelative = `db/${id}.sql.gz`;
    const mediaRelative = `media/${id}.tar.gz`;
    const setupRelative = `setup/${id}.json`;
    const filesPath = path.join(baseDir, filesRelative);
    const dbPath = path.join(baseDir, dbRelative);
    const mediaPath = path.join(baseDir, mediaRelative);
    const setupPath = path.join(baseDir, setupRelative);
    const steps = [];

    const gitState = await gitInfo(projectPath);
    steps.push({ name: 'git', success: true, message: gitState.missing ? 'Project is not a Git repository.' : `Captured ${gitState.commit.slice(0, 8)}${gitState.dirty ? ' (dirty)' : ''}.` });

    const files = await walkProjectFiles(projectPath);
    const archived = await archiveUtils.createProjectArchive(projectPath, filesPath);
    steps.push({ name: 'files archive', success: archived.success, message: archived.success ? `${files.length} files archived.` : archived.message });
    if (!archived.success) return { success: false, message: archived.message, steps };

    const dumped = await createCheckpointDatabaseSnapshot(dbName, dbPath, steps);
    if (!dumped.success) return { success: false, message: dumped.message, steps };

    const media = await archiveUtils.createMediaArchive(projectPath, setup.mediaPaths, mediaPath);
    steps.push({ name: 'media', success: media.success, message: media.success ? 'Media archived.' : media.message });
    if (!media.success) return { success: false, message: media.message, steps };

    await fs.writeFile(setupPath, `${JSON.stringify(setup, null, 2)}\n`, 'utf8');
    const setupHash = await sha256File(setupPath);
    const index = await readIndex(projectPath);
    const databaseInfo = await fileInfo(baseDir, dbRelative);
    databaseInfo.empty = Boolean(dumped.empty);

    const checkpoint = {
      id,
      message: String(message || 'Checkpoint').trim() || 'Checkpoint',
      author: String(author || (metadata && metadata.author) || os.userInfo().username || '').trim(),
      createdAt: new Date().toISOString(),
      parentId: latestCheckpoint(index) ? latestCheckpoint(index).id : null,
      pinned: false,
      git: gitState,
      files: files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })),
      filesArchive: await fileInfo(baseDir, filesRelative),
      database: databaseInfo,
      media: await fileInfo(baseDir, mediaRelative),
      setup: await fileInfo(baseDir, setupRelative),
      setupHash
    };
    index.checkpoints.unshift(checkpoint);
    await prune(projectPath, index, keepLast);
    await writeIndex(projectPath, index);

    return { success: true, message: `Checkpoint created: ${checkpoint.message}`, checkpoint, steps };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function listLocal(domain) {
  try {
    const projectPath = await projectPathForDomain(domain);
    const index = await readIndex(projectPath);
    return { success: true, checkpoints: index.checkpoints };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function backupDir(kind) {
  const sitesPath = await settings.getExpandedSitesPath();
  const dir = path.join(sitesPath, '.jbx-solo-backups', 'checkpoints', kind);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function restoreProjectBackup(projectPath, backupPath, steps) {
  const restored = typeof archiveUtils.replaceDirectoryFromArchive === 'function'
    ? await archiveUtils.replaceDirectoryFromArchive(projectPath, backupPath)
    : await archiveUtils.extractArchive(backupPath, projectPath);
  if (steps) {
    steps.push({
      name: 'project rollback',
      success: restored.success,
      message: restored.success ? 'Project files rolled back from the pre-restore backup.' : restored.message
    });
  }
  return restored;
}

async function restoreDatabaseBackup(dbName, backupPath, steps) {
  const restored = await db.importDatabase({
    dbName,
    sourcePath: backupPath,
    createIfMissing: true
  });
  if (steps) {
    steps.push({
      name: 'database rollback',
      success: restored.success,
      message: restored.success ? 'Database rolled back from the pre-restore backup.' : restored.message
    });
  }
  return restored;
}

async function restoreLocal(domain, id, opts = {}) {
  try {
    const cleanDomain = validateDomain(domain);
    const projectPath = await projectPathForDomain(cleanDomain);
    const index = await readIndex(projectPath);
    const checkpoint = index.checkpoints.find((item) => item.id === id);
    if (!checkpoint) throw new Error('Checkpoint not found.');

    const metadata = await readMetadata(projectPath);
    const setup = await projectSetup.readSetup(projectPath, {
      domain: cleanDomain,
      database: metadata && metadata.database,
      mediaPaths: metadata && metadata.mediaPaths,
      uploadsPath: metadata && metadata.uploadsPath
    });
    const dbName = setup.database || (metadata && metadata.database);
    if (!dbName) throw new Error('Project database metadata is missing.');

    const steps = [];
    const backupBase = await backupDir('project');
    const projectBackup = path.join(backupBase, `${cleanDomain}-${Date.now()}-before-checkpoint-restore.tar.gz`);
    const projectPacked = await archiveUtils.createBackupArchive(projectPath, projectBackup);
    steps.push({ name: 'project backup', success: projectPacked.success, message: projectPacked.success ? `Project backup: ${projectBackup}` : projectPacked.message });
    if (!projectPacked.success) return { success: false, message: projectPacked.message, steps };

    const dbBackup = path.join(await backupDir('database'), `${cleanDomain}-${Date.now()}-before-checkpoint-restore.sql.gz`);
    const dumped = await db.exportDatabase({
      dbName,
      destinationPath: dbBackup,
      content: 'full',
      charset: 'utf8mb4',
      tableMode: 'all',
      gzip: true
    });
    steps.push({ name: 'database backup', success: dumped.success, message: dumped.success ? `Database backup: ${dbBackup}` : dumped.message });
    if (!dumped.success) return { success: false, message: dumped.message, steps };

    if (checkpoint.filesArchive && checkpoint.filesArchive.file) {
      const keepPaths = new Set((checkpoint.files || []).map((file) => assertSafeRelativePath(file.path)));
      await removeFilesNotInManifest(projectPath, keepPaths);
      const extracted = await archiveUtils.extractArchive(path.join(checkpointsDir(projectPath), checkpoint.filesArchive.file), projectPath);
      steps.push({ name: 'files restore', success: extracted.success, message: extracted.success ? `${(checkpoint.files || []).length} files restored from archive.` : extracted.message });
      if (!extracted.success) {
        // Files were pruned before the extract failed — roll the tree back from
        // the pre-restore backup (the database has not been touched yet).
        await restoreProjectBackup(projectPath, projectBackup, steps);
        return { success: false, message: extracted.message, steps };
      }
    } else if (checkpoint.git && checkpoint.git.commit) {
      const state = await gitInfo(projectPath);
      if (state.dirty && !opts.force) {
        return { success: false, message: 'Git working tree is dirty. Commit or force restore first.', steps };
      }
      await git(['checkout', checkpoint.git.commit], projectPath);
      steps.push({ name: 'git checkout', success: true, message: `Checked out ${checkpoint.git.commit.slice(0, 8)}.` });
    }

    const imported = await db.importDatabase({
      dbName,
      sourcePath: path.join(checkpointsDir(projectPath), checkpoint.database.file),
      createIfMissing: true,
      allowDatabaseLifecycleStatements: Boolean(checkpoint.database && checkpoint.database.empty)
    });
    steps.push({ name: 'database restore', success: imported.success, message: imported.message });
    if (!imported.success) {
      await restoreProjectBackup(projectPath, projectBackup, steps);
      await restoreDatabaseBackup(dbName, dbBackup, steps);
      return { success: false, message: imported.message, steps };
    }

    if (checkpoint.media && checkpoint.media.file) {
      const media = await archiveUtils.restoreMediaArchive(projectPath, setup.mediaPaths, path.join(checkpointsDir(projectPath), checkpoint.media.file));
      steps.push({ name: 'media restore', success: media.success, message: media.message });
      if (!media.success) {
        await restoreProjectBackup(projectPath, projectBackup, steps);
        await restoreDatabaseBackup(dbName, dbBackup, steps);
        return { success: false, message: media.message, steps };
      }
    }

    if (checkpoint.setup && checkpoint.setup.file) {
      await fs.copyFile(path.join(checkpointsDir(projectPath), checkpoint.setup.file), projectSetup.setupPath(projectPath));
      steps.push({ name: 'setup restore', success: true, message: 'Setup descriptor restored.' });
    }

    return { success: true, message: `Restored checkpoint: ${checkpoint.message}`, checkpoint, backupPath: projectBackup, databaseBackupPath: dbBackup, steps };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function setPinnedLocal(domain, id, pinned) {
  try {
    const projectPath = await projectPathForDomain(domain);
    const index = await readIndex(projectPath);
    const checkpoint = index.checkpoints.find((item) => item.id === id);
    if (!checkpoint) throw new Error('Checkpoint not found.');
    checkpoint.pinned = Boolean(pinned);
    await writeIndex(projectPath, index);
    return { success: true, checkpoint };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function removeLocal(domain, id) {
  try {
    const projectPath = await projectPathForDomain(domain);
    const index = await readIndex(projectPath);
    const checkpoint = index.checkpoints.find((item) => item.id === id);
    if (!checkpoint) throw new Error('Checkpoint not found.');
    if (checkpoint.pinned) throw new Error('Pinned checkpoints must be unpinned before deletion.');
    index.checkpoints = index.checkpoints.filter((item) => item.id !== id);
    for (const artifact of [checkpoint.filesArchive, checkpoint.database, checkpoint.media, checkpoint.setup]) {
      if (artifact && artifact.file) await fs.unlink(path.join(checkpointsDir(projectPath), artifact.file)).catch(() => {});
    }
    await writeIndex(projectPath, index);
    return { success: true, message: 'Checkpoint deleted.' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function readMaybeGzipBuffer(filePath) {
  const data = await fs.readFile(filePath);
  if (filePath.endsWith('.gz')) return gunzipAsync(data);
  return data;
}

async function readMaybeGzip(filePath) {
  return (await readMaybeGzipBuffer(filePath)).toString('utf8');
}

function extractCreateTables(sql) {
  const tables = new Map();
  // Terminate at a ';' that ends a line so string literals/comments containing
  // ';' mid-line don't truncate the statement (multiline flag).
  const re = /CREATE TABLE\s+`?([^`\s(]+)`?[\s\S]*?;\s*$/gim;
  let match;
  while ((match = re.exec(sql))) {
    const name = match[1];
    const block = match[0];
    const start = block.indexOf('(');
    const end = block.lastIndexOf(')');
    if (start === -1 || end === -1 || end <= start) continue;
    const body = block.slice(start + 1, end)
      .split('\n')
      .map((line) => line.trim().replace(/,\s*$/, ''))
      .filter(Boolean)
      .join('\n');
    tables.set(name, body);
  }
  return tables;
}

function tableInsertOverview(sql) {
  const tables = new Map();
  // Terminate at a ';' that ends a line so ';' inside INSERT values doesn't cut
  // the statement short (multiline flag).
  const re = /INSERT INTO\s+`?([^`\s(]+)`?[\s\S]*?;\s*$/gim;
  let match;
  while ((match = re.exec(sql))) {
    const table = match[1];
    const value = tables.get(table) || { rows: 0, hash: crypto.createHash('sha256') };
    value.rows += (match[0].match(/\),\(/g) || []).length + 1;
    value.hash.update(match[0]);
    tables.set(table, value);
  }
  return [...tables.entries()].map(([table, value]) => ({
    table,
    rows: value.rows,
    sha256: value.hash.digest('hex')
  }));
}

function compareSchema(sqlA, sqlB) {
  const a = extractCreateTables(sqlA);
  const b = extractCreateTables(sqlB);
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  return names.map((table) => {
    if (!a.has(table)) return { table, state: 'added' };
    if (!b.has(table)) return { table, state: 'removed' };
    if (a.get(table) !== b.get(table)) return { table, state: 'changed', before: a.get(table), after: b.get(table) };
    return { table, state: 'unchanged' };
  }).filter((item) => item.state !== 'unchanged');
}

function compareData(sqlA, sqlB) {
  const a = new Map(tableInsertOverview(sqlA).map((item) => [item.table, item]));
  const b = new Map(tableInsertOverview(sqlB).map((item) => [item.table, item]));
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  return names.map((table) => {
    const left = a.get(table);
    const right = b.get(table);
    if (!left) return { table, state: 'added', rowsAfter: right.rows };
    if (!right) return { table, state: 'removed', rowsBefore: left.rows };
    if (left.rows !== right.rows || left.sha256 !== right.sha256) {
      return { table, state: 'changed', rowsBefore: left.rows, rowsAfter: right.rows };
    }
    return { table, state: 'unchanged', rowsBefore: left.rows, rowsAfter: right.rows };
  }).filter((item) => item.state !== 'unchanged');
}

async function diffLocal(domain, idA, idB) {
  try {
    const projectPath = await projectPathForDomain(domain);
    const index = await readIndex(projectPath);
    const a = index.checkpoints.find((item) => item.id === idA);
    const b = index.checkpoints.find((item) => item.id === idB);
    if (!a || !b) throw new Error('Both checkpoints are required.');

    let code = { nameStatus: '', patch: '' };
    if (a.git && a.git.commit && b.git && b.git.commit) {
      code = {
        nameStatus: await git(['diff', '--name-status', a.git.commit, b.git.commit], projectPath).catch((error) => error.message),
        patch: await git(['diff', a.git.commit, b.git.commit], projectPath).catch((error) => error.message)
      };
    }

    const sqlA = await readMaybeGzip(path.join(checkpointsDir(projectPath), a.database.file));
    const sqlB = await readMaybeGzip(path.join(checkpointsDir(projectPath), b.database.file));
    return {
      success: true,
      checkpoints: [a, b],
      code,
      schema: compareSchema(sqlA, sqlB),
      data: compareData(sqlA, sqlB)
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function isIgnoredCheckpointPath(relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  return parts.some((part) => (
    part === '.git' ||
    part === '.jimmybox-studio' ||
    part === '.jbx-team-backups' ||
    part === '.jbx-transfer'
  ));
}

function assertSafeRelativePath(relativePath) {
  const clean = String(relativePath || '').replace(/\\/g, '/').trim();
  if (!clean || clean.startsWith('/') || clean.split('/').some((part) => !part || part === '..')) {
    throw new Error(`Unsafe checkpoint path: ${clean || '(empty)'}`);
  }
  return clean;
}

async function walkProjectFiles(root, dir = '') {
  const fullDir = path.join(root, dir);
  const entries = await fs.readdir(fullDir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (isIgnoredCheckpointPath(relative)) continue;
    const full = path.join(root, relative);
    if (entry.isDirectory()) {
      files.push(...await walkProjectFiles(root, relative));
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      files.push({
        path: relative,
        sha256: await sha256File(full),
        size: stat.size,
        fullPath: full
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function tempFilePath(domain, suffix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `jbx-checkpoint-${domain}-`));
  return { dir, file: path.join(dir, suffix) };
}

function sqlIdentifier(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

async function writeEmptyDatabaseSnapshot(filePath, dbName, reason) {
  const identifier = sqlIdentifier(dbName);
  const sql = [
    '-- JimmyBox Studio checkpoint database snapshot',
    `-- Database: ${dbName}`,
    `-- Reason: ${reason}`,
    '',
    `DROP DATABASE IF EXISTS ${identifier};`,
    `CREATE DATABASE ${identifier} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `USE ${identifier};`,
    ''
  ].join('\n');
  await fs.writeFile(filePath, await gzipAsync(Buffer.from(sql, 'utf8')));
}

async function databaseTableCount(dbName) {
  const queried = await db.query(dbName, 'SHOW FULL TABLES;');
  if (!queried.success) return { success: false, message: queried.message };
  return { success: true, count: Array.isArray(queried.rows) ? queried.rows.length : 0 };
}

async function createCheckpointDatabaseSnapshot(dbName, destinationPath, steps) {
  const dumped = await db.exportDatabase({
    dbName,
    destinationPath,
    content: 'full',
    charset: 'utf8mb4',
    tableMode: 'all',
    gzip: true
  });

  if (!dumped.success) {
    steps.push({ name: 'database', success: false, message: dumped.message });
    return dumped;
  }

  const stat = await fs.stat(destinationPath).catch(() => null);
  if (stat && stat.size > 0) {
    steps.push({ name: 'database', success: true, message: dumped.message });
    return { success: true, message: dumped.message };
  }

  const tables = await databaseTableCount(dbName);
  if (!tables.success) {
    const message = `Database export for ${dbName} is empty and the table list could not be verified: ${tables.message}`;
    steps.push({ name: 'database', success: false, message });
    return { success: false, message };
  }

  if (tables.count > 0) {
    const message = `Database export for ${dbName} is empty although the database contains ${tables.count} tables. Check the local VM database export before creating a checkpoint.`;
    steps.push({ name: 'database', success: false, message });
    return { success: false, message };
  }

  const reason = 'The local database exists but has no tables.';
  await writeEmptyDatabaseSnapshot(destinationPath, dbName, reason);
  const message = `Database ${dbName} has no tables; stored an empty checkpoint snapshot.`;
  steps.push({ name: 'database', success: true, skipped: true, message });
  return { success: true, message, empty: true };
}

function createDatabaseDelta(baseBuffer, targetBuffer, fullCompressedSize) {
  let prefix = 0;
  const maxPrefix = Math.min(baseBuffer.length, targetBuffer.length);
  while (prefix < maxPrefix && baseBuffer[prefix] === targetBuffer[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(baseBuffer.length - prefix, targetBuffer.length - prefix);
  while (
    suffix < maxSuffix &&
    baseBuffer[baseBuffer.length - 1 - suffix] === targetBuffer[targetBuffer.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const middle = targetBuffer.subarray(prefix, targetBuffer.length - suffix);
  const payload = Buffer.from(JSON.stringify({
    format: 'jbx-db-prefix-suffix-v1',
    baseSha256: sha256Buffer(baseBuffer),
    baseSize: baseBuffer.length,
    targetSha256: sha256Buffer(targetBuffer),
    targetSize: targetBuffer.length,
    prefix,
    suffix,
    data: middle.toString('base64')
  }));
  return gzipBuffer(payload).then((compressed) => {
    const useful = compressed.length < Math.floor(fullCompressedSize * 0.85);
    return {
      useful,
      compressed,
      prefix,
      suffix,
      middleSize: middle.length,
      baseSha256: sha256Buffer(baseBuffer),
      baseSize: baseBuffer.length,
      targetSha256: sha256Buffer(targetBuffer),
      targetSize: targetBuffer.length
    };
  });
}

async function applyDatabaseDelta(baseBuffer, deltaBuffer) {
  const parsed = JSON.parse((await gunzipAsync(deltaBuffer)).toString('utf8'));
  if (!parsed || parsed.format !== 'jbx-db-prefix-suffix-v1') {
    throw new Error('Unsupported database delta format.');
  }
  if (sha256Buffer(baseBuffer) !== parsed.baseSha256 || baseBuffer.length !== parsed.baseSize) {
    throw new Error('Database delta base does not match the referenced checkpoint.');
  }
  const prefix = Number(parsed.prefix || 0);
  const suffix = Number(parsed.suffix || 0);
  if (!Number.isSafeInteger(prefix) || !Number.isSafeInteger(suffix) || prefix < 0 || suffix < 0 || prefix + suffix > baseBuffer.length) {
    throw new Error('Database delta ranges are invalid.');
  }
  const middle = Buffer.from(String(parsed.data || ''), 'base64');
  const restored = Buffer.concat([
    baseBuffer.subarray(0, prefix),
    middle,
    suffix ? baseBuffer.subarray(baseBuffer.length - suffix) : Buffer.alloc(0)
  ]);
  if (sha256Buffer(restored) !== parsed.targetSha256 || restored.length !== parsed.targetSize) {
    throw new Error('Database delta restore checksum mismatch.');
  }
  return restored;
}

async function checkpointMode() {
  return { hub: false };
}

function isMissingHubProject(result) {
  return result && result.status === 404 && /Project .* not found\./i.test(result.message || '');
}

async function hubProjectState(domain) {
  const cleanDomain = validateDomain(domain);
  const result = await teamClient.getProject(cleanDomain);
  if (result.success) return { success: true, exists: true, project: result.project, domain: cleanDomain };
  if (isMissingHubProject(result)) return { success: true, exists: false, domain: cleanDomain };
  return { success: false, message: result.message || 'Could not inspect Hub project.' };
}

async function uploadManifestObject(domain, ref, steps, label) {
  const uploaded = await teamClient.uploadCheckpointObject(domain, ref.sha256, ref.fullPath || ref.filePath);
  if (!uploaded.success) {
    steps.push({ name: label, success: false, message: uploaded.message });
    return uploaded;
  }
  return uploaded;
}

async function localArtifactRef(baseDir, artifact, label) {
  if (!artifact || !artifact.file) throw new Error(`${label} artifact is missing.`);
  const relative = assertSafeRelativePath(artifact.file);
  const filePath = path.join(baseDir, relative);
  const stat = await fs.stat(filePath);
  return {
    sha256: await sha256File(filePath),
    size: stat.size,
    filePath
  };
}

async function uploadLocalCheckpointObject(domain, ref, steps, label) {
  const uploaded = await teamClient.uploadCheckpointObject(domain, ref.sha256, ref.filePath);
  steps.push({
    name: label,
    success: uploaded.success,
    skipped: uploaded.success && uploaded.object && uploaded.object.created === false,
    message: uploaded.success
      ? (uploaded.object && uploaded.object.created === false ? 'Already on Hub.' : 'Uploaded to Hub.')
      : uploaded.message
  });
  return uploaded;
}

async function checkpointSyncLock(domain, mode, steps) {
  const projectResult = await teamClient.getProject(domain);
  if (!projectResult.success) return projectResult;

  const lock = projectResult.project && projectResult.project.lock;
  const mine = lock && lock.state === 'active' && mode && mode.user && lock.holderUserId === mode.user.id;
  if (mine || (mode && mode.user && mode.user.role === 'admin')) {
    return { success: true, release: false, project: projectResult.project };
  }

  const reserved = await teamClient.reserveProject(domain, {
    ttlMinutes: 30,
    message: 'Syncing local JimmyBox checkpoints'
  });
  steps.push({
    name: 'reserve checkpoints',
    success: reserved.success,
    message: reserved.success ? 'Project reserved for local checkpoint sync.' : reserved.message
  });
  if (!reserved.success) return reserved;
  return { success: true, release: true, project: reserved.project || projectResult.project };
}

function collectCheckpointObjectRefs(checkpoints) {
  const refs = new Set();
  for (const checkpoint of checkpoints || []) {
    if (checkpoint.filesArchive && checkpoint.filesArchive.sha256) refs.add(checkpoint.filesArchive.sha256);
    if (!checkpoint.filesArchive) {
      for (const file of checkpoint.files || []) {
        if (file && file.sha256) refs.add(file.sha256);
      }
    }
    if (checkpoint.database && checkpoint.database.sha256) refs.add(checkpoint.database.sha256);
    if (checkpoint.setup && checkpoint.setup.sha256) refs.add(checkpoint.setup.sha256);
  }
  return refs;
}

async function uploadObjectUnlessKnown(domain, ref, knownObjects, steps, label) {
  if (knownObjects.has(ref.sha256)) {
    steps.push({ name: label, success: true, skipped: true, message: 'Already referenced on Hub.' });
    return { success: true, skipped: true };
  }
  const uploaded = await uploadManifestObject(domain, ref, steps, label);
  if (uploaded.success) knownObjects.add(ref.sha256);
  return uploaded;
}

async function uploadFileObjects(domain, files, knownObjects, steps) {
  let uploaded = 0;
  let skipped = 0;
  const unique = [];
  const queued = new Set();
  for (const file of files) {
    if (knownObjects.has(file.sha256) || queued.has(file.sha256)) {
      skipped += 1;
      continue;
    }
    queued.add(file.sha256);
    unique.push(file);
  }

  const failures = [];
  await mapLimit(unique, 4, async (file) => {
    const uploadedObject = await teamClient.uploadCheckpointObject(domain, file.sha256, file.fullPath);
    if (!uploadedObject.success) {
      failures.push(`${file.path}: ${uploadedObject.message}`);
      return;
    }
    knownObjects.add(file.sha256);
    if (uploadedObject.object && uploadedObject.object.created === false) skipped += 1;
    else uploaded += 1;
  });

  steps.push({
    name: 'file objects',
    success: failures.length === 0,
    skipped: unique.length === 0 || uploaded === 0,
    message: failures.length
      ? failures.slice(0, 3).join('; ')
      : `${uploaded} uploaded, ${skipped} reused.`
  });
  return failures.length ? { success: false, message: failures[0] } : { success: true, uploaded, skipped };
}

async function syncLocalToHub(domain, opts = {}, existingMode = null) {
  let releaseDomain = '';

  try {
    const cleanDomain = validateDomain(domain);
    const projectPath = await projectPathForDomain(cleanDomain);
    const index = await readIndex(projectPath);
    const localCheckpoints = index.checkpoints.filter((checkpoint) => checkpoint && checkpoint.id);
    if (!localCheckpoints.length) {
      return { success: true, skipped: true, synced: 0, message: `${cleanDomain} has no local checkpoints.` };
    }

    const mode = existingMode || await checkpointMode();
    if (!mode.hub) {
      return { success: true, skipped: true, synced: 0, message: 'Team Mode is disabled; checkpoints stay local.' };
    }
    if (!mode.ready) return { success: false, message: mode.message || 'Team Hub is not connected.' };

    const hubProject = await hubProjectState(cleanDomain);
    if (!hubProject.success) return hubProject;
    if (!hubProject.exists) {
      return { success: true, skipped: true, synced: 0, message: `${cleanDomain} is not on the Hub yet.` };
    }

    const remote = await teamClient.listCheckpoints(cleanDomain);
    if (!remote.success) return remote;
    const remoteIds = new Set((remote.checkpoints || []).map((checkpoint) => checkpoint.id));
    const missing = localCheckpoints.filter((checkpoint) => !remoteIds.has(checkpoint.id));
    if (!missing.length) {
      return { success: true, skipped: true, synced: 0, message: `${cleanDomain} local checkpoints are already on the Hub.` };
    }

    const steps = [];
    const lock = await checkpointSyncLock(cleanDomain, mode, steps);
    if (!lock.success) {
      return { success: true, skipped: true, synced: 0, message: `Local checkpoint sync skipped: ${lock.message}`, steps };
    }
    if (lock.release) releaseDomain = cleanDomain;

    const baseDir = checkpointsDir(projectPath);
    const metadata = await readMetadata(projectPath);
    let synced = 0;
    let skipped = 0;
    const knownRemoteIds = new Set(remoteIds);

    for (const checkpoint of missing.reverse()) {
      const shortId = String(checkpoint.id).slice(0, 8);
      if (!checkpoint.filesArchive || !checkpoint.filesArchive.file) {
        skipped += 1;
        steps.push({
          name: `checkpoint ${shortId}`,
          success: true,
          skipped: true,
          message: 'Legacy local checkpoint has no project archive and was left local.'
        });
        continue;
      }
      if (!checkpoint.database || !checkpoint.database.file) {
        skipped += 1;
        steps.push({
          name: `checkpoint ${shortId}`,
          success: true,
          skipped: true,
          message: 'Local checkpoint has no database snapshot and was left local.'
        });
        continue;
      }

      const filesArchiveRef = await localArtifactRef(baseDir, checkpoint.filesArchive, 'Files archive');
      const databaseRef = await localArtifactRef(baseDir, checkpoint.database, 'Database');
      const setupRef = checkpoint.setup && checkpoint.setup.file
        ? await localArtifactRef(baseDir, checkpoint.setup, 'Setup')
        : null;

      const refs = [
        ['files archive', filesArchiveRef],
        ['database', databaseRef],
        ['setup', setupRef]
      ].filter((item) => item[1]);
      for (const [label, ref] of refs) {
        const uploaded = await uploadLocalCheckpointObject(cleanDomain, ref, steps, `${label} ${shortId}`);
        if (!uploaded.success) return { success: false, message: uploaded.message, steps, synced, skipped };
      }

      const manifest = {
        schemaVersion: 1,
        id: checkpoint.id,
        createdAt: checkpoint.createdAt || new Date().toISOString(),
        author: String(checkpoint.author || opts.author || (mode.user && mode.user.name) || (metadata && metadata.author) || os.userInfo().username || '').trim(),
        trigger: checkpoint.trigger || 'local-sync',
        message: checkpoint.message || 'Local checkpoint',
        parentId: checkpoint.parentId && knownRemoteIds.has(checkpoint.parentId) ? checkpoint.parentId : null,
        pinned: Boolean(checkpoint.pinned),
        git: checkpoint.git || null,
        files: (checkpoint.files || []).map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })),
        filesArchive: { sha256: filesArchiveRef.sha256, size: filesArchiveRef.size },
        database: {
          sha256: databaseRef.sha256,
          size: databaseRef.size,
          baseId: null,
          delta: false,
          empty: Boolean(checkpoint.database && checkpoint.database.empty)
        },
        setup: setupRef ? { sha256: setupRef.sha256, size: setupRef.size } : null
      };

      const created = await teamClient.createCheckpoint(cleanDomain, manifest);
      if (!created.success && created.status === 409) {
        skipped += 1;
        knownRemoteIds.add(checkpoint.id);
        steps.push({ name: `manifest ${shortId}`, success: true, skipped: true, message: 'Checkpoint already exists on Hub.' });
        continue;
      }
      steps.push({
        name: `manifest ${shortId}`,
        success: created.success,
        message: created.success ? 'Local checkpoint stored on Hub.' : created.message
      });
      if (!created.success) return { success: false, message: created.message, steps, synced, skipped };
      synced += 1;
      knownRemoteIds.add(checkpoint.id);
    }

    const bits = [];
    if (synced) bits.push(`${synced} synced`);
    if (skipped) bits.push(`${skipped} skipped`);
    return {
      success: true,
      synced,
      skipped,
      steps,
      message: bits.length ? `${cleanDomain} local checkpoints: ${bits.join(', ')}.` : `${cleanDomain} local checkpoints are already on the Hub.`
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    if (releaseDomain) {
      await teamClient.releaseProject(releaseDomain).catch(() => {});
    }
  }
}

async function createHub({ domain, message, author, trigger = 'manual' } = {}, mode = null) {
  const workspace = [];
  try {
    const cleanDomain = validateDomain(domain);
    const projectPath = await projectPathForDomain(cleanDomain);
    const metadata = await readMetadata(projectPath);
    const setup = await projectSetup.readSetup(projectPath, {
      domain: cleanDomain,
      phpVersion: metadata && metadata.phpVersion,
      database: metadata && metadata.database,
      mediaPaths: metadata && metadata.mediaPaths,
      uploadsPath: metadata && metadata.uploadsPath
    });
    const dbName = setup.database || (metadata && metadata.database);
    if (!dbName) throw new Error('Project database metadata is missing.');

    const steps = [];
    const existing = await teamClient.listCheckpoints(cleanDomain);
    if (!existing.success) return { success: false, message: existing.message, steps };
    const parent = existing.checkpoints && existing.checkpoints[0] ? existing.checkpoints[0] : null;
    const parentId = parent ? parent.id : null;
    const knownObjects = collectCheckpointObjectRefs(existing.checkpoints || []);

    const files = await walkProjectFiles(projectPath);
    steps.push({ name: 'scan', success: true, message: `${files.length} files hashed.` });
    const fileUpload = await uploadFileObjects(cleanDomain, files, knownObjects, steps);
    if (!fileUpload.success) return { success: false, message: fileUpload.message, steps };

    const dbTemp = await tempFilePath(cleanDomain, 'database.sql.gz');
    workspace.push(dbTemp.dir);
    const dumped = await createCheckpointDatabaseSnapshot(dbName, dbTemp.file, steps);
    if (!dumped.success) return { success: false, message: dumped.message, steps };
    const dbStat = await fs.stat(dbTemp.file);
    const fullDatabaseRef = {
      sha256: await sha256File(dbTemp.file),
      size: dbStat.size,
      filePath: dbTemp.file
    };
    const targetDatabaseBuffer = await readMaybeGzipBuffer(dbTemp.file);
    let databaseRef = {
      sha256: fullDatabaseRef.sha256,
      size: fullDatabaseRef.size,
      filePath: fullDatabaseRef.filePath,
      baseId: null,
      delta: false,
      empty: Boolean(dumped.empty)
    };

    if (parent && parent.database) {
      try {
        const parentBuffer = await databaseBufferForHubCheckpoint(cleanDomain, parent, workspace);
        if (sha256Buffer(parentBuffer) === sha256Buffer(targetDatabaseBuffer)) {
          databaseRef = {
            ...parent.database,
            reusedFrom: parent.id,
            empty: Boolean(dumped.empty)
          };
          steps.push({ name: 'database delta', success: true, skipped: true, message: 'Database unchanged; reused parent snapshot.' });
        } else {
          const delta = await createDatabaseDelta(parentBuffer, targetDatabaseBuffer, fullDatabaseRef.size);
          if (delta.useful) {
            const deltaTemp = await tempFilePath(cleanDomain, 'database.delta.gz');
            workspace.push(deltaTemp.dir);
            await fs.writeFile(deltaTemp.file, delta.compressed);
            databaseRef = {
              sha256: sha256Buffer(delta.compressed),
              size: delta.compressed.length,
              filePath: deltaTemp.file,
              baseId: parent.id,
              delta: true,
              algorithm: 'jbx-db-prefix-suffix-v1',
              baseSha256: delta.baseSha256,
              baseSize: delta.baseSize,
              targetSha256: delta.targetSha256,
              targetSize: delta.targetSize,
              fullSize: fullDatabaseRef.size,
              empty: Boolean(dumped.empty)
            };
            steps.push({ name: 'database delta', success: true, message: `Delta ${Math.round(delta.compressed.length / 1024)} KB instead of ${Math.round(fullDatabaseRef.size / 1024)} KB.` });
          } else {
            steps.push({ name: 'database delta', success: true, skipped: true, message: 'Delta was not smaller; stored a full DB snapshot.' });
          }
        }
      } catch (error) {
        steps.push({ name: 'database delta', success: true, skipped: true, message: `Delta skipped: ${error.message}` });
      }
    }

    if (!databaseRef.reusedFrom) {
      const dbUploaded = await uploadObjectUnlessKnown(cleanDomain, databaseRef, knownObjects, steps, databaseRef.delta ? 'database delta upload' : 'database upload');
      if (!dbUploaded.success) return { success: false, message: dbUploaded.message, steps };
    }

    const setupTemp = await tempFilePath(cleanDomain, 'setup.json');
    workspace.push(setupTemp.dir);
    await fs.writeFile(setupTemp.file, `${JSON.stringify(setup, null, 2)}\n`, 'utf8');
    const setupStat = await fs.stat(setupTemp.file);
    const setupRef = {
      sha256: await sha256File(setupTemp.file),
      size: setupStat.size,
      filePath: setupTemp.file
    };
    const setupUploaded = await uploadObjectUnlessKnown(cleanDomain, setupRef, knownObjects, steps, 'setup upload');
    if (!setupUploaded.success) return { success: false, message: setupUploaded.message, steps };

    const manifest = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      author: String(author || (mode && mode.user && mode.user.name) || (metadata && metadata.author) || os.userInfo().username || '').trim(),
      trigger,
      message: String(message || 'Checkpoint').trim() || 'Checkpoint',
      parentId,
      pinned: false,
      git: await gitInfo(projectPath),
      files: files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })),
      filesArchive: null,
      database: {
        ...databaseRef,
        filePath: undefined
      },
      setup: { sha256: setupRef.sha256, size: setupRef.size }
    };

    const created = await teamClient.createCheckpoint(cleanDomain, manifest);
    steps.push({ name: 'manifest', success: created.success, message: created.success ? 'Checkpoint manifest stored on Hub.' : created.message });
    if (!created.success) return { success: false, message: created.message, steps };

    return {
      success: true,
      message: `Checkpoint created on Hub: ${manifest.message}`,
      checkpoint: created.checkpoint,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    await Promise.all(workspace.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
  }
}

async function downloadObjectTemp(domain, ref, suffix) {
  const temp = await tempFilePath(domain, suffix);
  const downloaded = await teamClient.downloadCheckpointObject(domain, ref.sha256, temp.file, ref.size || 0);
  if (!downloaded.success) {
    await fs.rm(temp.dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(downloaded.message);
  }
  return temp;
}

async function databaseBufferForHubCheckpoint(domain, checkpoint, workspace, seen = new Set()) {
  if (!checkpoint || !checkpoint.database) throw new Error('Checkpoint database reference is missing.');
  const ref = checkpoint.database;
  if (!ref.delta) {
    const dbTemp = await downloadObjectTemp(domain, ref, 'database.sql.gz');
    workspace.push(dbTemp.dir);
    return readMaybeGzipBuffer(dbTemp.file);
  }

  if (!ref.baseId) throw new Error('Database delta is missing its base checkpoint id.');
  if (seen.has(checkpoint.id)) throw new Error('Database delta chain contains a cycle.');
  seen.add(checkpoint.id);

  const base = await teamClient.getCheckpoint(domain, ref.baseId);
  if (!base.success) throw new Error(base.message || `Base checkpoint ${ref.baseId} not found.`);
  const baseBuffer = await databaseBufferForHubCheckpoint(domain, base.checkpoint, workspace, seen);

  const deltaTemp = await downloadObjectTemp(domain, ref, 'database.delta.gz');
  workspace.push(deltaTemp.dir);
  const deltaBuffer = await fs.readFile(deltaTemp.file);
  return applyDatabaseDelta(baseBuffer, deltaBuffer);
}

async function materializeHubDatabase(domain, checkpoint, workspace, suffix = 'database.sql') {
  const temp = await tempFilePath(domain, suffix);
  workspace.push(temp.dir);
  const buffer = await databaseBufferForHubCheckpoint(domain, checkpoint, workspace);
  await fs.writeFile(temp.file, buffer);
  return temp;
}

async function removeFilesNotInManifest(projectPath, keepPaths) {
  const current = await walkProjectFiles(projectPath);
  for (const file of current) {
    if (!keepPaths.has(file.path)) {
      await fs.unlink(path.join(projectPath, file.path)).catch(() => {});
    }
  }
}

async function restoreHub(domain, id) {
  const workspace = [];
  try {
    const cleanDomain = validateDomain(domain);
    const fetched = await teamClient.getCheckpoint(cleanDomain, id);
    if (!fetched.success) return fetched;
    const checkpoint = fetched.checkpoint;
    const projectPath = await projectPathForDomain(cleanDomain);
    const steps = [];

    const setupTemp = checkpoint.setup ? await downloadObjectTemp(cleanDomain, checkpoint.setup, 'setup.json') : null;
    if (setupTemp) workspace.push(setupTemp.dir);
    const setup = setupTemp
      ? JSON.parse(await fs.readFile(setupTemp.file, 'utf8'))
      : await projectSetup.readSetup(projectPath, { domain: cleanDomain });
    const metadata = await readMetadata(projectPath);
    const dbName = setup.database || (metadata && metadata.database);
    if (!dbName) throw new Error('Project database metadata is missing.');

    const backupBase = await backupDir('project');
    const projectBackup = path.join(backupBase, `${cleanDomain}-${Date.now()}-before-hub-checkpoint-restore.tar.gz`);
    const projectPacked = await archiveUtils.createBackupArchive(projectPath, projectBackup);
    steps.push({ name: 'project backup', success: projectPacked.success, message: projectPacked.success ? `Project backup: ${projectBackup}` : projectPacked.message });
    if (!projectPacked.success) return { success: false, message: projectPacked.message, steps };

    const dbBackup = path.join(await backupDir('database'), `${cleanDomain}-${Date.now()}-before-hub-checkpoint-restore.sql.gz`);
    const dumped = await db.exportDatabase({
      dbName,
      destinationPath: dbBackup,
      content: 'full',
      charset: 'utf8mb4',
      tableMode: 'all',
      gzip: true
    });
    steps.push({ name: 'database backup', success: dumped.success, message: dumped.success ? `Database backup: ${dbBackup}` : dumped.message });
    if (!dumped.success) return { success: false, message: dumped.message, steps };

    const keepPaths = new Set((checkpoint.files || []).map((file) => assertSafeRelativePath(file.path)));
    await removeFilesNotInManifest(projectPath, keepPaths);

    if (checkpoint.filesArchive) {
      const filesTemp = await downloadObjectTemp(cleanDomain, checkpoint.filesArchive, 'files.tar.gz');
      workspace.push(filesTemp.dir);
      const extracted = await archiveUtils.extractArchive(filesTemp.file, projectPath);
      steps.push({ name: 'files restore', success: extracted.success, message: extracted.success ? `${(checkpoint.files || []).length} files restored from archive.` : extracted.message });
      if (!extracted.success) {
        // Roll the pruned project tree back from the pre-restore backup.
        await restoreProjectBackup(projectPath, projectBackup, steps);
        return { success: false, message: extracted.message, steps };
      }
    } else {
      let restoredFiles = 0;
      for (const file of checkpoint.files || []) {
        const relative = assertSafeRelativePath(file.path);
        const target = path.join(projectPath, relative);
        const exists = await fs.stat(target).catch(() => null);
        if (exists && exists.isFile() && exists.size === file.size && await sha256File(target) === file.sha256) continue;
        const downloaded = await teamClient.downloadCheckpointObject(cleanDomain, file.sha256, target, file.size || 0);
        if (!downloaded.success) {
          steps.push({ name: 'files restore', success: false, message: downloaded.message });
          await restoreProjectBackup(projectPath, projectBackup, steps);
          return { success: false, message: downloaded.message, steps };
        }
        restoredFiles += 1;
      }
      steps.push({ name: 'files restore', success: true, message: `${restoredFiles} files restored; unchanged files reused.` });
    }

    const dbTemp = await materializeHubDatabase(cleanDomain, checkpoint, workspace, 'database.sql');
    const imported = await db.importDatabase({
      dbName,
      sourcePath: dbTemp.file,
      createIfMissing: true,
      allowDatabaseLifecycleStatements: Boolean(checkpoint.database && checkpoint.database.empty)
    });
    steps.push({ name: 'database restore', success: imported.success, message: imported.message });
    if (!imported.success) {
      await restoreProjectBackup(projectPath, projectBackup, steps);
      await restoreDatabaseBackup(dbName, dbBackup, steps);
      return { success: false, message: imported.message, steps };
    }

    if (setupTemp) {
      await fs.copyFile(setupTemp.file, projectSetup.setupPath(projectPath));
      steps.push({ name: 'setup restore', success: true, message: 'Setup descriptor restored.' });
    }

    return {
      success: true,
      message: `Restored Hub checkpoint: ${checkpoint.message}`,
      checkpoint,
      backupPath: projectBackup,
      databaseBackupPath: dbBackup,
      steps
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    await Promise.all(workspace.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
  }
}

function compareManifestFiles(a, b) {
  const left = new Map((a.files || []).map((file) => [file.path, file]));
  const right = new Map((b.files || []).map((file) => [file.path, file]));
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  return paths.map((filePath) => {
    if (!left.has(filePath)) return `A\t${filePath}`;
    if (!right.has(filePath)) return `D\t${filePath}`;
    return left.get(filePath).sha256 === right.get(filePath).sha256 ? '' : `M\t${filePath}`;
  }).filter(Boolean).join('\n');
}

async function diffHub(domain, idA, idB) {
  const workspace = [];
  try {
    const cleanDomain = validateDomain(domain);
    const [resA, resB] = await Promise.all([
      teamClient.getCheckpoint(cleanDomain, idA),
      teamClient.getCheckpoint(cleanDomain, idB)
    ]);
    if (!resA.success) return resA;
    if (!resB.success) return resB;
    const a = resA.checkpoint;
    const b = resB.checkpoint;
    const sqlA = (await databaseBufferForHubCheckpoint(cleanDomain, a, workspace)).toString('utf8');
    const sqlB = (await databaseBufferForHubCheckpoint(cleanDomain, b, workspace)).toString('utf8');
    return {
      success: true,
      checkpoints: [a, b],
      code: {
        nameStatus: compareManifestFiles(a, b),
        patch: ''
      },
      schema: compareSchema(sqlA, sqlB),
      data: compareData(sqlA, sqlB)
    };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    await Promise.all(workspace.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
  }
}

async function create(payload = {}) {
  const mode = await checkpointMode();
  if (mode.hub && !mode.ready) return { success: false, message: mode.message };
  if (mode.hub) {
    const hubProject = await hubProjectState(payload.domain);
    if (!hubProject.success) return hubProject;
    if (!hubProject.exists) return createLocal({ ...payload, domain: hubProject.domain });
    return createHub({ ...payload, domain: hubProject.domain }, mode);
  }
  return createLocal(payload);
}

async function list(domain) {
  const mode = await checkpointMode();
  if (mode.hub && !mode.ready) return { success: false, message: mode.message };
  if (!mode.hub) return listLocal(domain);
  const hubProject = await hubProjectState(domain);
  if (!hubProject.success) return hubProject;
  if (!hubProject.exists) return listLocal(hubProject.domain);
  return teamClient.listCheckpoints(hubProject.domain);
}

async function restore(domain, id, opts = {}) {
  const mode = await checkpointMode();
  if (mode.hub && !mode.ready) return { success: false, message: mode.message };
  if (!mode.hub) return restoreLocal(domain, id, opts);
  const hubProject = await hubProjectState(domain);
  if (!hubProject.success) return hubProject;
  if (!hubProject.exists) return restoreLocal(hubProject.domain, id, opts);
  return restoreHub(hubProject.domain, id);
}

async function setPinned(domain, id, pinned) {
  const mode = await checkpointMode();
  if (mode.hub && !mode.ready) return { success: false, message: mode.message };
  if (!mode.hub) return setPinnedLocal(domain, id, pinned);
  const hubProject = await hubProjectState(domain);
  if (!hubProject.success) return hubProject;
  if (!hubProject.exists) return setPinnedLocal(hubProject.domain, id, pinned);
  return teamClient.setCheckpointPinned(hubProject.domain, id, pinned);
}

async function remove(domain, id) {
  const mode = await checkpointMode();
  if (mode.hub && !mode.ready) return { success: false, message: mode.message };
  if (!mode.hub) return removeLocal(domain, id);
  const hubProject = await hubProjectState(domain);
  if (!hubProject.success) return hubProject;
  if (!hubProject.exists) return removeLocal(hubProject.domain, id);
  return teamClient.deleteCheckpoint(hubProject.domain, id);
}

async function diff(domain, idA, idB) {
  const mode = await checkpointMode();
  if (mode.hub && !mode.ready) return { success: false, message: mode.message };
  if (!mode.hub) return diffLocal(domain, idA, idB);
  const hubProject = await hubProjectState(domain);
  if (!hubProject.success) return hubProject;
  if (!hubProject.exists) return diffLocal(hubProject.domain, idA, idB);
  return diffHub(hubProject.domain, idA, idB);
}

module.exports = {
  create,
  list,
  restore,
  diff,
  setPinned,
  delete: remove,
  _private: {
    compareData,
    compareSchema,
    extractCreateTables,
    tableInsertOverview
  }
};
