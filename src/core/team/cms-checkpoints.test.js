const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const cms = require('../cms');
const db = require('../db/db-manager');
const settings = require('../settings/store');
const projectSetup = require('../projects/project-setup');
const checkpoints = require('../projects/checkpoints');
const teamClient = require('./team-client');

async function withTemp(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jbx-cms-checkpoint-test-'));
  try {
    await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('CMS registry exposes all requested adapters', () => {
  const ids = cms.list().map((adapter) => adapter.id).sort();
  assert.deepEqual(ids, ['contao', 'drupal', 'joomla', 'plain', 'typo3', 'wordpress']);
  for (const adapter of cms.list()) {
    assert.ok(adapter.label);
    assert.ok(adapter.docroot);
    assert.ok(Array.isArray(adapter.mediaPaths));
    assert.match(adapter.recommendedPhpVersion, /^\d+\.\d+$/);
    if (adapter.installPhpMin) assert.match(adapter.installPhpMin, /^\d+\.\d+$/);
  }

  const byId = Object.fromEntries(cms.list().map((adapter) => [adapter.id, adapter]));
  assert.equal(byId.contao.installPhpMin, '8.3');
  assert.equal(byId.joomla.installPhpMin, '8.3');
});

test('CMS detection recognizes common marker files', async () => {
  await withTemp(async (tmp) => {
    const empty = path.join(tmp, 'empty');
    await fs.mkdir(empty, { recursive: true });
    const fallback = await cms.detect(empty);
    assert.equal(fallback.id, 'plain');
    assert.equal(fallback.detected, false);

    const wp = path.join(tmp, 'wp');
    await fs.mkdir(path.join(wp, 'public'), { recursive: true });
    await fs.writeFile(path.join(wp, 'public', 'wp-load.php'), '<?php', 'utf8');
    const detectedWp = await cms.detect(wp);
    assert.equal(detectedWp.id, 'wordpress');
    assert.equal(detectedWp.detected, true);

    const drupal = path.join(tmp, 'drupal');
    await fs.mkdir(path.join(drupal, 'web', 'core', 'lib'), { recursive: true });
    await fs.writeFile(path.join(drupal, 'web', 'core', 'lib', 'Drupal.php'), '<?php', 'utf8');
    assert.equal((await cms.detect(drupal)).id, 'drupal');
  });
});

test('setup descriptor supports CMS-specific empty media paths', () => {
  const setup = projectSetup.sanitizeSetup({
    domain: 'plain.test',
    cms: 'plain',
    mediaPaths: []
  });
  assert.equal(setup.cms, 'plain');
  assert.deepEqual(setup.mediaPaths, []);
});

test('Team metadata preserves intentionally empty media paths', async () => {
  const teamSync = require('./team-sync');
  const meta = teamSync._private.metadataForHub('plain.test', {
    phpVersion: '8.2',
    database: 'plain_test',
    cms: 'plain',
    docroot: 'public',
    mediaPaths: []
  });

  assert.deepEqual(meta.mediaPaths, []);
  assert.equal(meta.uploadsPath, '');
});

test('Contao installer seeds a useful starter redirect instead of a 404 homepage', async () => {
  await withTemp(async (tmp) => {
    const commands = [];
    const contao = cms.get('contao');
    const projectPath = path.join(tmp, 'contao.test');
    await fs.mkdir(projectPath, { recursive: true });
    const result = await contao.install({
      domain: 'contao.test',
      projectPath,
      dbName: 'contao_test',
      phpVersion: '8.3',
      vm: {
        shell: async (command) => {
          commands.push(command);
          return { success: true, stdout: '', stderr: '' };
        },
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }
    });

    assert.equal(result.success, true);
    assert.ok(commands.some((command) => /INSERT INTO tl_page/.test(command) && /redirect/.test(command) && /\/contao/.test(command)));
  });
});

test('Contao localize preserves unrelated .env.local settings', async () => {
  await withTemp(async (tmp) => {
    const contao = cms.get('contao');
    const projectPath = path.join(tmp, 'contao.test');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(path.join(projectPath, '.env.local'), [
      'APP_ENV=prod',
      'APP_SECRET=existing-secret',
      'MAILER_DSN=smtp://mail.example.test',
      'DATABASE_URL=mysql://old',
      ''
    ].join('\n'), 'utf8');

    const result = await contao.localize({
      projectPath,
      dbName: 'contao_test',
      domain: 'contao.test',
      phpVersion: '8.3',
      hasDump: false,
      vm: {
        shell: async () => ({ success: true }),
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }
    });

    assert.equal(result.success, true);
    const env = await fs.readFile(path.join(projectPath, '.env.local'), 'utf8');
    assert.match(env, /^APP_ENV=prod$/m);
    assert.match(env, /^APP_SECRET=existing-secret$/m);
    assert.match(env, /^MAILER_DSN=smtp:\/\/mail\.example\.test$/m);
    assert.match(env, /^DATABASE_URL=mysql:\/\/root:root@localhost\/contao_test$/m);
  });
});

test('WordPress localize supports split-root wp-config.php above public', async () => {
  await withTemp(async (tmp) => {
    const wordpress = cms.get('wordpress');
    const projectPath = path.join(tmp, 'wp-split.test');
    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'wp-config.php'), "<?php\n/* That's all, stop editing! */\n", 'utf8');
    await fs.writeFile(path.join(projectPath, 'public', 'wp-load.php'), '<?php\n', 'utf8');

    const result = await wordpress.localize({
      projectPath,
      docroot: 'public',
      dbName: 'wp_split',
      domain: 'wp-split.test',
      phpVersion: '7.4',
      vm: {
        shell: async () => ({ success: true }),
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }
    });

    assert.equal(result.success, true);
    const config = await fs.readFile(path.join(projectPath, 'wp-config.php'), 'utf8');
    assert.match(config, /JimmyBox Studio local URL override/);
    await assert.rejects(fs.stat(path.join(projectPath, 'public', 'wp-config.php')), { code: 'ENOENT' });
  });
});

test('Joomla localize updates legacy var and quoted configuration properties', async () => {
  await withTemp(async (tmp) => {
    const joomla = cms.get('joomla');
    const projectPath = path.join(tmp, 'joomla.test');
    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'public', 'configuration.php'), [
      '<?php',
      'class JConfig {',
      '  var $db = "old_db";',
      "  public $user    = 'old_user';",
      '  public $password = "old_pass";',
      "  var $host = 'old-host';",
      '  public $live_site = "https://example.com";',
      '}',
      ''
    ].join('\n'), 'utf8');

    const result = await joomla.localize({
      projectPath,
      docroot: 'public',
      dbName: 'joomla_test',
      domain: 'joomla.test'
    });

    assert.equal(result.success, true);
    const config = await fs.readFile(path.join(projectPath, 'public', 'configuration.php'), 'utf8');
    assert.match(config, /var \$db = 'joomla_test';/);
    assert.match(config, /public \$user = 'root';/);
    assert.match(config, /public \$password = 'root';/);
    assert.match(config, /var \$host = 'localhost';/);
    assert.match(config, /public \$live_site = '';/);
  });
});

test('TYPO3 localize writes legacy AdditionalConfiguration for classic projects', async () => {
  await withTemp(async (tmp) => {
    const typo3 = cms.get('typo3');
    const projectPath = path.join(tmp, 'typo3.test');
    await fs.mkdir(path.join(projectPath, 'public', 'typo3conf'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'public', 'typo3conf', 'LocalConfiguration.php'), '<?php return [];\n', 'utf8');

    const result = await typo3.localize({ projectPath, docroot: 'public', dbName: 'typo3_test' });

    assert.equal(result.success, true);
    const legacyOverride = await fs.readFile(path.join(projectPath, 'public', 'typo3conf', 'AdditionalConfiguration.php'), 'utf8');
    assert.match(legacyOverride, /typo3_test/);
    await assert.rejects(fs.stat(path.join(projectPath, 'config', 'system', 'additional.php')), { code: 'ENOENT' });
  });
});

test('Contao localize updates legacy parameters.yml when present', async () => {
  await withTemp(async (tmp) => {
    const contao = cms.get('contao');
    const projectPath = path.join(tmp, 'contao-legacy.test');
    await fs.mkdir(path.join(projectPath, 'app', 'config'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'app', 'config', 'parameters.yml'), [
      'parameters:',
      '    database_host: old-host',
      '    database_user: old-user',
      '    database_password: old-pass',
      '    database_name: old-db',
      ''
    ].join('\n'), 'utf8');

    const result = await contao.localize({
      projectPath,
      dbName: 'contao_legacy',
      domain: 'contao-legacy.test',
      phpVersion: '7.4',
      hasDump: false,
      vm: {
        shell: async () => ({ success: true }),
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }
    });

    assert.equal(result.success, true);
    const parameters = await fs.readFile(path.join(projectPath, 'app', 'config', 'parameters.yml'), 'utf8');
    assert.match(parameters, /database_host: localhost/);
    assert.match(parameters, /database_user: root/);
    assert.match(parameters, /database_password: root/);
    assert.match(parameters, /database_name: contao_legacy/);
  });
});

test('Drupal localize supports root-style settings and is idempotent', async () => {
  await withTemp(async (tmp) => {
    const drupal = cms.get('drupal');
    const projectPath = path.join(tmp, 'drupal-root.test');
    await fs.mkdir(path.join(projectPath, 'sites', 'default'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'sites', 'default', 'settings.php'), [
      '<?php',
      "$databases['default']['default'] = [",
      "  'database' => 'old',",
      "  'prefix' => 'drp_',",
      "  'namespace' => 'Drupal\\\\Core\\\\Database\\\\Driver\\\\mysql',",
      "];",
      ''
    ].join('\n'), 'utf8');

    const first = await drupal.localize({ projectPath, docroot: '.', dbName: 'drupal_root' });
    const second = await drupal.localize({ projectPath, docroot: '.', dbName: 'drupal_root' });

    assert.equal(first.success, true);
    assert.equal(second.success, true);
    const settingsPhp = await fs.readFile(path.join(projectPath, 'sites', 'default', 'settings.php'), 'utf8');
    assert.equal((settingsPhp.match(/JimmyBox local override/g) || []).length, 2);
    assert.match(settingsPhp, /'database' => 'drupal_root'/);
    assert.match(settingsPhp, /'prefix' => 'drp_'/);
    assert.match(settingsPhp, /Drupal\\\\Core\\\\Database\\\\Driver\\\\mysql/);
  });
});

test('checkpoint helpers summarize schema and data differences', () => {
  const before = [
    'CREATE TABLE `wp_posts` (',
    '  `id` int NOT NULL,',
    '  `title` varchar(255)',
    ');',
    "INSERT INTO `wp_posts` VALUES (1,'A');"
  ].join('\n');
  const after = [
    'CREATE TABLE `wp_posts` (',
    '  `id` int NOT NULL,',
    '  `title` varchar(255),',
    '  `slug` varchar(255)',
    ');',
    "INSERT INTO `wp_posts` VALUES (1,'B'),(2,'C');"
  ].join('\n');

  const schema = checkpoints._private.compareSchema(before, after);
  const data = checkpoints._private.compareData(before, after);
  assert.equal(schema[0].table, 'wp_posts');
  assert.equal(schema[0].state, 'changed');
  assert.equal(data[0].table, 'wp_posts');
  assert.equal(data[0].state, 'changed');
  assert.equal(data[0].rowsBefore, 1);
  assert.equal(data[0].rowsAfter, 2);
});

test('Solo checkpoint creation stays local when old Team settings exist', async () => {
  await withTemp(async (tmp) => {
    const domain = 'archive-dedupe.test';
    const projectPath = path.join(tmp, domain);
    const source = Buffer.from('<?php echo "ok";' + '\n', 'utf8');
    const sourceSha = crypto.createHash('sha256').update(source).digest('hex');
    const uploaded = new Set();

    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'public', 'index.php'), source);
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), `${JSON.stringify({
      domain,
      phpVersion: '8.3',
      database: 'archive_dedupe',
      cms: 'wordpress',
      docroot: 'public',
      mediaPaths: ['public/wp-content/uploads']
    }, null, 2)}\n`, 'utf8');

    const originals = {
      getSettings: settings.getSettings,
      getExpandedSitesPath: settings.getExpandedSitesPath,
      exportDatabase: db.exportDatabase,
      query: db.query,
      status: teamClient.status,
      getProject: teamClient.getProject,
      listCheckpoints: teamClient.listCheckpoints,
      uploadCheckpointObject: teamClient.uploadCheckpointObject,
      createCheckpoint: teamClient.createCheckpoint
    };

    settings.getSettings = async () => ({
      success: true,
      settings: {
        teamMode: true,
        expandedSitesPath: tmp,
        teamHubUrl: 'http://hub.test',
        teamToken: 'token'
      }
    });
    settings.getExpandedSitesPath = async () => tmp;
    db.exportDatabase = async ({ destinationPath }) => {
      const sql = Buffer.from('CREATE TABLE `wp_posts` (`id` int);\n', 'utf8');
      await fs.writeFile(destinationPath, zlib.gzipSync(sql));
      return { success: true, message: 'Database exported.' };
    };
    db.query = async () => ({ success: true, rows: [{ table: 'wp_posts' }] });
    teamClient.status = async () => ({ success: true, enabled: true, user: { id: 'u1', name: 'Tester', role: 'admin' } });
    teamClient.getProject = async () => ({ success: true, project: { domain } });
    teamClient.listCheckpoints = async () => ({
      success: true,
      checkpoints: [{
        id: 'archive-backed-parent',
        filesArchive: { sha256: 'a'.repeat(64), size: 123 },
        files: [{ path: 'public/index.php', sha256: sourceSha, size: source.length }],
        database: null,
        setup: null
      }]
    });
    teamClient.uploadCheckpointObject = async (_domain, sha256) => {
      uploaded.add(sha256);
      return { success: true, object: { sha256, created: true } };
    };
    teamClient.createCheckpoint = async (_domain, manifest) => {
      const required = [
        ...manifest.files.map((file) => file.sha256),
        manifest.database && manifest.database.sha256,
        manifest.setup && manifest.setup.sha256
      ].filter(Boolean);
      const missing = required.find((sha256) => !uploaded.has(sha256));
      if (missing) return { success: false, message: `Checkpoint object ${missing} is missing.` };
      return { success: true, checkpoint: manifest };
    };

    try {
      const result = await checkpoints.create({ domain, message: 'Regression checkpoint' });
      assert.equal(result.success, true, result.message);
      assert.equal(uploaded.size, 0);
      assert.equal(uploaded.has(sourceSha), false);
    } finally {
      Object.assign(settings, {
        getSettings: originals.getSettings,
        getExpandedSitesPath: originals.getExpandedSitesPath
      });
      Object.assign(db, {
        exportDatabase: originals.exportDatabase,
        query: originals.query
      });
      Object.assign(teamClient, {
        status: originals.status,
        getProject: originals.getProject,
        listCheckpoints: originals.listCheckpoints,
        uploadCheckpointObject: originals.uploadCheckpointObject,
        createCheckpoint: originals.createCheckpoint
      });
    }
  });
});
