const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const settings = require('../settings/store');

const REQUEST_TIMEOUT_MS = 15000;
// Project/database/media transfers can run for minutes on large sites. A hard
// overall timeout (the old 15 s) aborted real uploads mid-stream. Instead we use
// a stall timeout: the transfer is only aborted if no data flows for this long.
const TRANSFER_STALL_MS = 120000;
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAY_MS = 1200;
const DEFAULT_RESERVATION_TTL_MINUTES = 5 * 24 * 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transferErrorMessage(error) {
  if (error && error.name === 'AbortError') return 'Team Hub transfer stalled and timed out.';
  return error && error.message ? error.message : String(error || 'Transfer failed.');
}

function startStallTimer(controller) {
  let timer = setTimeout(() => controller.abort(), TRANSFER_STALL_MS);
  return {
    bump() {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), TRANSFER_STALL_MS);
    },
    stop() {
      clearTimeout(timer);
    }
  };
}

// Pass-through that resets the stall timer as each chunk is pulled by fetch,
// without forcing the source stream into flowing mode (which would corrupt it).
function meteredUpload(sourcePath, onProgress) {
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      onProgress();
      callback(null, chunk);
    }
  });
  fsSync.createReadStream(sourcePath).on('error', (error) => meter.destroy(error)).pipe(meter);
  return meter;
}

async function downloadUrlOnce({ url, headers, destinationPath, expectedSha256 = '', expectedSize = null }) {
  const controller = new AbortController();
  const stall = startStallTimer(controller);
  const tmpPath = `${destinationPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  let handle = null;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      return {
        success: false,
        retryable: response.status >= 500,
        status: response.status,
        message: payload.message || `Hub returned HTTP ${response.status}.`
      };
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    handle = await fs.open(tmpPath, 'w');
    let size = 0;
    const hash = crypto.createHash('sha256');

    for await (const chunk of response.body) {
      stall.bump();
      size += chunk.length;
      hash.update(chunk);
      await handle.write(chunk);
    }

    await handle.close();
    handle = null;

    const sha256 = hash.digest('hex');
    if (Number.isSafeInteger(expectedSize) && size !== expectedSize) {
      await fs.unlink(tmpPath).catch(() => {});
      return {
        success: false,
        retryable: true,
        message: `Downloaded file size mismatch (${size} bytes, expected ${expectedSize}).`
      };
    }

    if (expectedSha256 && sha256 !== expectedSha256) {
      await fs.unlink(tmpPath).catch(() => {});
      return {
        success: false,
        retryable: true,
        message: 'Downloaded file checksum mismatch.'
      };
    }

    await fs.rename(tmpPath, destinationPath);
    return { success: true, path: destinationPath, size, sha256 };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tmpPath).catch(() => {});
    return {
      success: false,
      retryable: true,
      message: transferErrorMessage(error)
    };
  } finally {
    stall.stop();
  }
}

async function downloadUrlWithRetries(options) {
  let lastResult = null;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    const result = await downloadUrlOnce(options);
    if (result.success) {
      return {
        ...result,
        attempts: attempt
      };
    }

    lastResult = result;
    if (!result.retryable || attempt === DOWNLOAD_ATTEMPTS) break;
    await sleep(DOWNLOAD_RETRY_DELAY_MS * attempt);
  }

  return {
    ...lastResult,
    message: `${lastResult && lastResult.message ? lastResult.message : 'Download failed.'} (${DOWNLOAD_ATTEMPTS} attempts)`
  };
}

async function getConfig() {
  const result = await settings.getSettings();
  if (!result.success) return result;

  const config = result.settings;
  if (!config.teamMode) {
    return {
      success: false,
      disabled: true,
      message: 'Team mode is disabled.'
    };
  }

  if (!config.teamHubUrl || !config.teamToken) {
    return {
      success: false,
      disabled: true,
      message: 'Team Hub URL and access token are required.'
    };
  }

  return {
    success: true,
    hubUrl: config.teamHubUrl.replace(/\/+$/, ''),
    token: config.teamToken,
    userName: config.teamUserName
  };
}

function authHeaders(config, extra = {}) {
  return {
    Authorization: `Bearer ${config.token}`,
    'X-JimmyBox-User': config.userName || '',
    ...extra
  };
}

async function request(method, path, body) {
  const config = await getConfig();
  if (!config.success) return config;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.hubUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...authHeaders(config),
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        message: payload.message || `Hub returned HTTP ${response.status}.`,
        ...payload
      };
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, message: 'Team Hub request timed out.' };
    }
    return { success: false, message: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function status() {
  const config = await getConfig();
  if (!config.success) {
    if (config.disabled) return { success: true, enabled: false, message: config.message };
    return config;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let health;
  try {
    const response = await fetch(`${config.hubUrl}/api/health`, { signal: controller.signal });
    health = await response.json();
  } catch (error) {
    health = {
      success: false,
      message: error.name === 'AbortError' ? 'Team Hub request timed out.' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!health.success) return health;

  const me = await request('GET', '/api/me');
  if (!me.success) return me;

  return {
    success: true,
    enabled: true,
    hub: health,
    user: me.user
  };
}

function listProjects() {
  return request('GET', '/api/projects');
}

function createProject(payload) {
  return request('POST', '/api/projects', payload);
}

function listUsers() {
  return request('GET', '/api/users');
}

function createUser(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  return request('POST', '/api/users', {
    name: String(body.name || '').trim(),
    role: body.role === 'admin' ? 'admin' : 'member'
  });
}

// Delete a project (and its snapshots/bundle) from the Hub. Admin-only, enforced
// by the Hub — this removes shared team data, not anything local.
function deleteHubProject(domain) {
  return request('DELETE', `/api/projects/${encodeURIComponent(domain)}`);
}

function disableUser(userId) {
  return request('POST', `/api/users/${encodeURIComponent(userId)}/disable`);
}

function enableUser(userId) {
  return request('POST', `/api/users/${encodeURIComponent(userId)}/enable`);
}

function rotateUserToken(userId) {
  return request('POST', `/api/users/${encodeURIComponent(userId)}/rotate-token`);
}

function deleteUser(userId) {
  return request('DELETE', `/api/users/${encodeURIComponent(userId)}`);
}

function getProject(domain) {
  return request('GET', `/api/projects/${encodeURIComponent(domain)}`);
}

function setProjectMembers(domain, members) {
  return request('PUT', `/api/projects/${encodeURIComponent(domain)}/members`, { members });
}

function handoverProject(domain, toUserId) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/handover`, { toUserId });
}

function databaseSnapshot(domain) {
  return request('GET', `/api/projects/${encodeURIComponent(domain)}/database-snapshot`);
}

function mediaSnapshot(domain) {
  return request('GET', `/api/projects/${encodeURIComponent(domain)}/media-snapshot`);
}

function projectBundle(domain) {
  return request('GET', `/api/projects/${encodeURIComponent(domain)}/project-bundle`);
}

async function downloadArtifact(domain, kind, destinationPath) {
  const config = await getConfig();
  if (!config.success) return config;

  const metadata = kind === 'project'
    ? await projectBundle(domain)
    : (kind === 'media' ? await mediaSnapshot(domain) : await databaseSnapshot(domain));
  if (!metadata.success) return metadata;
  const artifact = metadata.bundle || metadata.snapshot || null;
  if (!artifact) {
    return { success: true, snapshot: null, message: `No ${kind} snapshot exists yet.` };
  }

  const artifactPath = kind === 'project' ? 'project-bundle' : `${kind}-snapshot`;
  const downloaded = await downloadUrlWithRetries({
    url: `${config.hubUrl}/api/projects/${encodeURIComponent(domain)}/${artifactPath}/download`,
    headers: authHeaders(config),
    destinationPath,
    expectedSha256: artifact.sha256 || '',
    expectedSize: Number.isSafeInteger(artifact.size) ? artifact.size : null
  });
  if (!downloaded.success) return downloaded;

  return {
    success: true,
    path: destinationPath,
    snapshot: artifact,
    bundle: artifact,
    attempts: downloaded.attempts,
    message: `Downloaded ${kind} snapshot to ${destinationPath}${downloaded.attempts > 1 ? ` after ${downloaded.attempts} attempts` : ''}.`
  };
}

function downloadDatabaseSnapshot(domain, destinationPath) {
  return downloadArtifact(domain, 'database', destinationPath);
}

function downloadMediaSnapshot(domain, destinationPath) {
  return downloadArtifact(domain, 'media', destinationPath);
}

function downloadProjectBundle(domain, destinationPath) {
  return downloadArtifact(domain, 'project', destinationPath);
}

async function uploadArtifact(domain, kind, sourcePath, baseSnapshotRevision = '') {
  const config = await getConfig();
  if (!config.success) return config;

  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return { success: false, message: `${kind} snapshot not found: ${sourcePath}` };
  }

  const controller = new AbortController();
  const stall = startStallTimer(controller);

  try {
    const revisionHeader = kind === 'media'
      ? 'X-JimmyBox-Base-Media-Revision'
      : 'X-JimmyBox-Base-Database-Revision';
    const response = await fetch(`${config.hubUrl}/api/projects/${encodeURIComponent(domain)}/${kind}-snapshot`, {
      method: 'PUT',
      signal: controller.signal,
      duplex: 'half',
      headers: authHeaders(config, {
        'Content-Type': 'application/gzip',
        'Content-Length': String(stat.size),
        [revisionHeader]: baseSnapshotRevision || ''
      }),
      body: meteredUpload(sourcePath, () => stall.bump())
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        message: payload.message || `Hub returned HTTP ${response.status}.`,
        ...payload
      };
    }

    return payload;
  } catch (error) {
    return {
      success: false,
      message: error.name === 'AbortError' ? 'Team Hub transfer stalled and timed out.' : error.message
    };
  } finally {
    stall.stop();
  }
}

function uploadDatabaseSnapshot(domain, sourcePath, baseSnapshotRevision = '') {
  return uploadArtifact(domain, 'database', sourcePath, baseSnapshotRevision);
}

function uploadMediaSnapshot(domain, sourcePath, baseSnapshotRevision = '') {
  return uploadArtifact(domain, 'media', sourcePath, baseSnapshotRevision);
}

async function uploadCheckpointObject(domain, sha256, sourcePath) {
  const config = await getConfig();
  if (!config.success) return config;

  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return { success: false, message: `Checkpoint object not found: ${sourcePath}` };
  }

  const controller = new AbortController();
  const stall = startStallTimer(controller);

  try {
    const response = await fetch(`${config.hubUrl}/api/projects/${encodeURIComponent(domain)}/objects/${encodeURIComponent(sha256)}`, {
      method: 'PUT',
      signal: controller.signal,
      duplex: 'half',
      headers: authHeaders(config, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size)
      }),
      body: meteredUpload(sourcePath, () => stall.bump())
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        message: payload.message || `Hub returned HTTP ${response.status}.`,
        ...payload
      };
    }

    return payload;
  } catch (error) {
    return {
      success: false,
      message: error.name === 'AbortError' ? 'Team Hub transfer stalled and timed out.' : error.message
    };
  } finally {
    stall.stop();
  }
}

async function downloadCheckpointObject(domain, sha256, destinationPath, expectedSize = null) {
  const config = await getConfig();
  if (!config.success) return config;

  const downloaded = await downloadUrlWithRetries({
    url: `${config.hubUrl}/api/projects/${encodeURIComponent(domain)}/objects/${encodeURIComponent(sha256)}`,
    headers: authHeaders(config),
    destinationPath,
    expectedSha256: sha256,
    expectedSize: Number.isSafeInteger(expectedSize) ? expectedSize : null
  });
  if (!downloaded.success) return downloaded;

  return {
    success: true,
    path: destinationPath,
    attempts: downloaded.attempts,
    object: { sha256, size: downloaded.size }
  };
}

async function uploadProjectBundle(domain, sourcePath, baseRevision, setupSummary = null, baseSnapshots = {}) {
  const config = await getConfig();
  if (!config.success) return config;

  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return { success: false, message: `project bundle not found: ${sourcePath}` };
  }

  const controller = new AbortController();
  const stall = startStallTimer(controller);

  try {
    const summaryHeader = setupSummary
      ? Buffer.from(JSON.stringify(setupSummary), 'utf8').toString('base64url')
      : '';
    const response = await fetch(`${config.hubUrl}/api/projects/${encodeURIComponent(domain)}/project-bundle`, {
      method: 'PUT',
      signal: controller.signal,
      duplex: 'half',
      headers: authHeaders(config, {
        'Content-Type': 'application/gzip',
        'Content-Length': String(stat.size),
        'X-JimmyBox-Base-Revision': baseRevision || '',
        'X-JimmyBox-Base-Database-Revision': baseSnapshots.database || '',
        'X-JimmyBox-Base-Media-Revision': baseSnapshots.media || '',
        ...(summaryHeader ? { 'X-JimmyBox-Setup-Summary': summaryHeader } : {})
      }),
      body: meteredUpload(sourcePath, () => stall.bump())
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        message: payload.message || `Hub returned HTTP ${response.status}.`,
        ...payload
      };
    }

    return payload;
  } catch (error) {
    return {
      success: false,
      message: error.name === 'AbortError' ? 'Team Hub transfer stalled and timed out.' : error.message
    };
  } finally {
    stall.stop();
  }
}

function reserveProject(domain, opts = {}) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/reserve`, {
    ttlMinutes: opts.ttlMinutes || DEFAULT_RESERVATION_TTL_MINUTES,
    message: opts.message || ''
  });
}

function heartbeatProject(domain, ttlMinutes = DEFAULT_RESERVATION_TTL_MINUTES) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/heartbeat`, { ttlMinutes });
}

function releaseProject(domain) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/release`);
}

function createCheckpoint(domain, manifest) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/checkpoints`, { manifest });
}

function listCheckpoints(domain) {
  return request('GET', `/api/projects/${encodeURIComponent(domain)}/checkpoints`);
}

function getCheckpoint(domain, id) {
  return request('GET', `/api/projects/${encodeURIComponent(domain)}/checkpoints/${encodeURIComponent(id)}`);
}

function setCheckpointPinned(domain, id, pinned) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/checkpoints/${encodeURIComponent(id)}/pin`, { pinned });
}

function deleteCheckpoint(domain, id) {
  return request('DELETE', `/api/projects/${encodeURIComponent(domain)}/checkpoints/${encodeURIComponent(id)}`);
}

function garbageCollectCheckpointObjects(domain) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/objects/gc`);
}

function getCheckpointRefs(domain) {
  return request('GET', `/api/projects/${encodeURIComponent(domain)}/refs`);
}

function setCheckpointRefs(domain, refs) {
  return request('PUT', `/api/projects/${encodeURIComponent(domain)}/refs`, { refs });
}

function previewCapabilities() {
  return request('GET', '/api/preview/capabilities');
}

function previewSlots() {
  return request('GET', '/api/preview/slots');
}

function createPreview(domain, opts = {}) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/preview`, opts);
}

function listPreviews(domain) {
  return request('GET', `/api/projects/${encodeURIComponent(domain)}/preview`);
}

function rotatePreviewPassword(domain, slot) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/preview/${encodeURIComponent(slot)}/rotate-password`);
}

function deletePreview(domain, slot) {
  return request('DELETE', `/api/projects/${encodeURIComponent(domain)}/preview/${encodeURIComponent(slot)}`);
}

function importPreview(domain, slot) {
  return request('POST', `/api/projects/${encodeURIComponent(domain)}/preview/${encodeURIComponent(slot)}/import-to-hub`);
}

module.exports = {
  status,
  listProjects,
  createProject,
  deleteHubProject,
  listUsers,
  createUser,
  disableUser,
  enableUser,
  rotateUserToken,
  deleteUser,
  getProject,
  setProjectMembers,
  handoverProject,
  databaseSnapshot,
  mediaSnapshot,
  projectBundle,
  downloadDatabaseSnapshot,
  uploadDatabaseSnapshot,
  downloadMediaSnapshot,
  uploadMediaSnapshot,
  uploadCheckpointObject,
  downloadCheckpointObject,
  downloadProjectBundle,
  uploadProjectBundle,
  reserveProject,
  heartbeatProject,
  releaseProject,
  createCheckpoint,
  listCheckpoints,
  getCheckpoint,
  setCheckpointPinned,
  deleteCheckpoint,
  garbageCollectCheckpointObjects,
  getCheckpointRefs,
  setCheckpointRefs,
  previewCapabilities,
  previewSlots,
  createPreview,
  listPreviews,
  rotatePreviewPassword,
  deletePreview,
  importPreview
};
