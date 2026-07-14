const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const projectSetup = require('../projects/project-setup');
const { _private } = require('./team-sync');

const execFileAsync = promisify(execFile);

async function withTemp(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jbx-project-setup-test-'));
  try {
    await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function tar(args) {
  await execFileAsync('tar', args, {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    maxBuffer: 1024 * 1024 * 8
  });
}

test('project setup descriptor is sanitized and round-trips on disk', async () => {
  await withTemp(async (tmp) => {
    const projectPath = path.join(tmp, 'example.test');
    const written = await projectSetup.writeSetup(projectPath, {
      domain: 'example.test',
      cms: 'wordpress',
      docroot: 'public',
      phpVersion: '8.2',
      database: 'example',
      mediaPaths: ['public/wp-content/uploads'],
      hosts: [{ ip: '127.0.0.1', domain: 'example.test' }],
      provisioning: [{ path: 'provision/10-node.sh', runOn: ['checkout'] }],
      setupRoutines: [{ name: 'composer install', cmd: 'composer install --no-interaction', cwd: 'public', location: 'vm' }]
    });
    const read = await projectSetup.readSetup(projectPath);

    assert.equal(written.schemaVersion, 2);
    assert.equal(read.domain, 'example.test');
    assert.deepEqual(read.mediaPaths, ['public/wp-content/uploads']);
    assert.equal(read.setupRoutines[0].location, 'vm');
  });
});

test('project setup rejects traversal paths and invalid hosts', async () => {
  assert.throws(() => projectSetup.sanitizeSetup({
    domain: 'example.test',
    provisioning: [{ path: '../bad.sh' }]
  }), /relative path/);

  assert.throws(() => projectSetup.sanitizeSetup({
    domain: 'example.test',
    setupRoutines: [{ name: 'bad', cmd: 'true', cwd: '/tmp' }]
  }), /relative path/);

  assert.throws(() => projectSetup.sanitizeSetup({
    domain: 'example.test',
    hosts: [{ ip: '999.1.1.1', domain: 'example.test' }]
  }), /Invalid setup host IP/);
});

test('setup routines do not run without confirmed commands', async () => {
  await withTemp(async (tmp) => {
    const marker = path.join(tmp, 'marker.txt');
    const setup = projectSetup.sanitizeSetup({
      domain: 'example.test',
      setupRoutines: [{
        name: 'write marker',
        cmd: `printf yes > ${marker}`,
        location: 'local',
        runOn: ['checkout']
      }]
    });

    const result = await projectSetup.runSetupRoutines(setup, tmp, 'checkout', { confirmedCommands: [] });
    assert.equal(result.success, true);
    assert.equal(result.steps[0].skipped, true);
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  });
});

test('project bundle extraction accepts setup.json alongside the legacy payload', async () => {
  await withTemp(async (tmp) => {
    const projectPath = path.join(tmp, 'project');
    const workspace = path.join(tmp, 'bundle-work');
    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(projectPath, 'public', 'index.php'), '<?php echo "ok";\n', 'utf8');
    await projectSetup.writeSetup(projectPath, {
      domain: 'bundle.test',
      phpVersion: '8.3',
      database: 'bundle'
    });

    const projectArchive = path.join(workspace, 'project.tar.gz');
    const bundlePath = path.join(tmp, 'bundle.jbx-project.tar.gz');
    const created = await _private.createProjectArchive(projectPath, projectArchive);
    assert.equal(created.success, true);

    await fs.writeFile(path.join(workspace, 'manifest.json'), JSON.stringify({
      schemaVersion: 2,
      domain: 'bundle.test',
      phpVersion: '8.3',
      database: 'bundle',
      uploadsPath: 'public/wp-content/uploads'
    }), 'utf8');
    await fs.copyFile(projectSetup.setupPath(projectPath), path.join(workspace, 'setup.json'));
    await fs.writeFile(path.join(workspace, 'database.sql.gz'), 'placeholder', 'utf8');
    await tar(['-czf', bundlePath, '-C', workspace, 'manifest.json', 'setup.json', 'project.tar.gz', 'database.sql.gz']);

    const extractDir = path.join(tmp, 'extract');
    const extracted = await _private.extractBundle(bundlePath, extractDir);
    assert.equal(extracted.success, true);
    assert.equal(extracted.manifest.domain, 'bundle.test');
    assert.ok(extracted.setupPath.endsWith('setup.json'));
    const setup = JSON.parse(await fs.readFile(extracted.setupPath, 'utf8'));
    assert.equal(setup.domain, 'bundle.test');
  });
});
