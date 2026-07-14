const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function normalizeGitUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

// Reject URLs that could turn `git clone <url>` into local code execution:
// option injection ("-..."), and remote-helper transports like `ext::`/`fd::`
// (e.g. `ext::sh -c "..."`). Only allow real git URL forms.
function isSafeGitUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  // Block option injection ("-...") and remote-helper transports ("ext::"/"fd::"
  // → `ext::sh -c "..."`) that can run arbitrary commands. Normal URLs, scp-like
  // remotes, and local filesystem paths are all allowed.
  if (value.startsWith('-')) return false;
  if (/^[a-z][a-z0-9+.-]*::/i.test(value)) return false;
  return true;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (_error) {
    return false;
  }
}

async function isEmptyDirectory(target) {
  try {
    const entries = await fs.readdir(target);
    return entries.filter((entry) => entry !== '.DS_Store').length === 0;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function runGit(args, cwd, options = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 1024 * 1024 * 16,
      ...options,
      env: {
        ...process.env,
        GIT_ALLOW_PROTOCOL: 'http:https:ssh:git:file',
        GIT_TERMINAL_PROMPT: '0',
        ...(options.env || {})
      }
    });
    return {
      success: true,
      stdout: result.stdout || '',
      stderr: result.stderr || ''
    };
  } catch (error) {
    return {
      success: false,
      message: (error.stderr || error.message || 'Git command failed.').trim(),
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    };
  }
}

async function gitStatus(projectPath) {
  const exists = await pathExists(projectPath);
  if (!exists) return { success: true, state: 'missing', clean: true };

  const gitDir = path.join(projectPath, '.git');
  if (!(await pathExists(gitDir))) {
    return {
      success: true,
      state: await isEmptyDirectory(projectPath) ? 'empty' : 'not-git',
      clean: false
    };
  }

  const status = await runGit(['status', '--porcelain'], projectPath);
  if (!status.success) return status;
  const porcelain = status.stdout.trim();
  return {
    success: true,
    state: 'git',
    clean: porcelain.length === 0,
    porcelain
  };
}

async function ensureOriginMatches(projectPath, repositoryUrl) {
  const expected = normalizeGitUrl(repositoryUrl);
  if (!expected) return { success: true };

  const result = await runGit(['remote', 'get-url', 'origin'], projectPath);
  if (!result.success) return result;

  const actual = normalizeGitUrl(result.stdout);
  if (actual !== expected) {
    return {
      success: false,
      message: `Git origin mismatch. Local origin is "${actual}", Hub expects "${expected}".`
    };
  }

  return { success: true };
}

async function releaseReadiness(projectPath, repositoryUrl) {
  const repo = normalizeGitUrl(repositoryUrl);
  if (!repo) {
    return {
      success: true,
      message: 'No Git repository configured for this team project.'
    };
  }
  if (!isSafeGitUrl(repo)) {
    return { success: false, message: `Unsafe or unsupported Git URL: ${repo}` };
  }

  const status = await gitStatus(projectPath);
  if (!status.success) return status;

  if (status.state === 'missing' || status.state === 'empty') {
    return {
      success: true,
      message: 'No local repository exists for this team project.'
    };
  }

  if (status.state === 'not-git') {
    return {
      success: false,
      message: 'Local project folder exists but is not a Git repository. Move it away or connect it to Git before releasing.'
    };
  }

  if (!status.clean) {
    return {
      success: false,
      message: 'Local Git repository has uncommitted changes. Commit or stash them before releasing the project.'
    };
  }

  const origin = await ensureOriginMatches(projectPath, repo);
  if (!origin.success) return origin;

  const fetched = await runGit(['fetch', '--prune', 'origin'], projectPath);
  if (!fetched.success) return fetched;

  const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  if (!branch.success) return branch;
  if (branch.stdout.trim() === 'HEAD') {
    return {
      success: false,
      message: 'Local Git repository is in detached HEAD state. Check out a branch before releasing.'
    };
  }

  const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], projectPath);
  if (!upstream.success) {
    return {
      success: false,
      message: 'Local Git branch has no upstream. Push it with an upstream before releasing.'
    };
  }

  const counts = await runGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], projectPath);
  if (!counts.success) return counts;

  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map((value) => parseInt(value, 10));
  if (ahead > 0) {
    return {
      success: false,
      message: `Local Git branch has ${ahead} commit${ahead === 1 ? '' : 's'} not pushed yet. Push before releasing.`
    };
  }

  if (behind > 0) {
    return {
      success: false,
      message: `Local Git branch is ${behind} commit${behind === 1 ? '' : 's'} behind its upstream. Sync before releasing.`
    };
  }

  return {
    success: true,
    message: 'Local Git repository is clean and matches its upstream.'
  };
}

async function syncRepository(projectPath, repositoryUrl) {
  const repo = normalizeGitUrl(repositoryUrl);
  if (!repo) {
    return {
      success: true,
      changed: false,
      message: 'No Git repository configured for this team project.'
    };
  }
  if (!isSafeGitUrl(repo)) {
    return { success: false, message: `Unsafe or unsupported Git URL: ${repo}` };
  }

  const status = await gitStatus(projectPath);
  if (!status.success) return status;

  if (status.state === 'missing' || status.state === 'empty') {
    await fs.mkdir(path.dirname(projectPath), { recursive: true });
    const cloned = await runGit(['clone', '--', repo, projectPath], path.dirname(projectPath));
    if (!cloned.success) return cloned;
    return {
      success: true,
      changed: true,
      message: 'Repository cloned.'
    };
  }

  if (status.state === 'not-git') {
    return {
      success: false,
      message: 'Local project folder already exists and is not a Git repository. Move it away or connect it to Git before syncing.'
    };
  }

  if (!status.clean) {
    return {
      success: false,
      message: 'Local Git repository has uncommitted changes. Commit or stash them before syncing.'
    };
  }

  const origin = await ensureOriginMatches(projectPath, repo);
  if (!origin.success) return origin;

  const fetched = await runGit(['fetch', '--prune', 'origin'], projectPath);
  if (!fetched.success) return fetched;

  const pulled = await runGit(['pull', '--ff-only'], projectPath);
  if (!pulled.success) return pulled;

  return {
    success: true,
    changed: true,
    message: 'Repository updated.'
  };
}

module.exports = {
  gitStatus,
  syncRepository,
  releaseReadiness,
  normalizeGitUrl
};
