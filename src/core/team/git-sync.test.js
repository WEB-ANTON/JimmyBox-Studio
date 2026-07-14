const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { syncRepository, gitStatus, releaseReadiness } = require('./git-sync');

const execFileAsync = promisify(execFile);

async function git(args, cwd) {
  await execFileAsync('git', args, { cwd, maxBuffer: 1024 * 1024 * 8 });
}

async function makeOrigin(tmp) {
  const origin = path.join(tmp, 'origin.git');
  const work = path.join(tmp, 'work');
  await fs.mkdir(work, { recursive: true });

  await git(['init', '--bare', origin], tmp);
  await git(['init'], work);
  await fs.writeFile(path.join(work, 'README.md'), '# Team Project\n', 'utf8');
  await git(['add', 'README.md'], work);
  await git(['-c', 'user.name=JimmyBox Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Initial commit'], work);
  await git(['remote', 'add', 'origin', origin], work);
  await git(['push', '-u', 'origin', 'HEAD'], work);

  return origin;
}

async function withTemp(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jbx-git-sync-test-'));
  try {
    await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('syncRepository clones into a missing project folder', async () => {
  await withTemp(async (tmp) => {
    const origin = await makeOrigin(tmp);
    const projectPath = path.join(tmp, 'sites', 'example.test');

    const result = await syncRepository(projectPath, origin);
    assert.equal(result.success, true);
    assert.equal(result.message, 'Repository cloned.');

    const readme = await fs.readFile(path.join(projectPath, 'README.md'), 'utf8');
    assert.match(readme, /Team Project/);

    const status = await gitStatus(projectPath);
    assert.equal(status.state, 'git');
    assert.equal(status.clean, true);
  });
});

test('syncRepository refuses a non-empty non-git folder', async () => {
  await withTemp(async (tmp) => {
    const origin = await makeOrigin(tmp);
    const projectPath = path.join(tmp, 'sites', 'example.test');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(path.join(projectPath, 'index.php'), '<?php\n', 'utf8');

    const result = await syncRepository(projectPath, origin);
    assert.equal(result.success, false);
    assert.match(result.message, /not a Git repository/);
  });
});

test('syncRepository refuses to pull over uncommitted changes', async () => {
  await withTemp(async (tmp) => {
    const origin = await makeOrigin(tmp);
    const projectPath = path.join(tmp, 'sites', 'example.test');

    const first = await syncRepository(projectPath, origin);
    assert.equal(first.success, true);

    await fs.writeFile(path.join(projectPath, 'README.md'), '# Local change\n', 'utf8');
    const second = await syncRepository(projectPath, origin);
    assert.equal(second.success, false);
    assert.match(second.message, /uncommitted changes/);
  });
});

test('releaseReadiness accepts a clean repository that matches upstream', async () => {
  await withTemp(async (tmp) => {
    const origin = await makeOrigin(tmp);
    const projectPath = path.join(tmp, 'sites', 'example.test');

    const cloned = await syncRepository(projectPath, origin);
    assert.equal(cloned.success, true);

    const ready = await releaseReadiness(projectPath, origin);
    assert.equal(ready.success, true);
    assert.match(ready.message, /clean/);
  });
});

test('releaseReadiness blocks uncommitted and unpushed changes', async () => {
  await withTemp(async (tmp) => {
    const origin = await makeOrigin(tmp);
    const dirtyPath = path.join(tmp, 'sites', 'dirty.test');
    const aheadPath = path.join(tmp, 'sites', 'ahead.test');

    assert.equal((await syncRepository(dirtyPath, origin)).success, true);
    await fs.writeFile(path.join(dirtyPath, 'README.md'), '# Local change\n', 'utf8');
    const dirty = await releaseReadiness(dirtyPath, origin);
    assert.equal(dirty.success, false);
    assert.match(dirty.message, /uncommitted changes/);

    assert.equal((await syncRepository(aheadPath, origin)).success, true);
    await fs.writeFile(path.join(aheadPath, 'CHANGELOG.md'), 'Local commit\n', 'utf8');
    await git(['add', 'CHANGELOG.md'], aheadPath);
    await git(['-c', 'user.name=JimmyBox Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Local commit'], aheadPath);
    const ahead = await releaseReadiness(aheadPath, origin);
    assert.equal(ahead.success, false);
    assert.match(ahead.message, /not pushed/);
  });
});

test('releaseReadiness blocks repositories behind upstream', async () => {
  await withTemp(async (tmp) => {
    const origin = await makeOrigin(tmp);
    const projectPath = path.join(tmp, 'sites', 'behind.test');
    const otherPath = path.join(tmp, 'other');

    assert.equal((await syncRepository(projectPath, origin)).success, true);
    await git(['clone', origin, otherPath], tmp);
    await fs.writeFile(path.join(otherPath, 'REMOTE.md'), 'Remote commit\n', 'utf8');
    await git(['add', 'REMOTE.md'], otherPath);
    await git(['-c', 'user.name=JimmyBox Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Remote commit'], otherPath);
    await git(['push'], otherPath);

    const ready = await releaseReadiness(projectPath, origin);
    assert.equal(ready.success, false);
    assert.match(ready.message, /behind/);
  });
});
