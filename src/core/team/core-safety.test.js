const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function withTemp(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jbx-core-safety-test-'));
  try {
    await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function makeWritableForCleanup(target) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return;
  if (stat.isDirectory()) {
    await fs.chmod(target, 0o755).catch(() => {});
    const entries = await fs.readdir(target).catch(() => []);
    for (const entry of entries) {
      await makeWritableForCleanup(path.join(target, entry));
    }
  } else {
    await fs.chmod(target, 0o644).catch(() => {});
  }
}

function installMock(resolvedPath, exports) {
  const previous = require.cache[resolvedPath];
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports
  };
  return () => {
    if (previous) {
      require.cache[resolvedPath] = previous;
    } else {
      delete require.cache[resolvedPath];
    }
  };
}

async function withFreshModule(moduleRequest, mocks, fn) {
  const modulePath = require.resolve(moduleRequest);
  const restore = [];
  const previousTarget = require.cache[modulePath];
  delete require.cache[modulePath];

  for (const [request, exports] of mocks) {
    restore.push(installMock(require.resolve(request), exports));
  }

  try {
    const loaded = require(moduleRequest);
    await fn(loaded);
  } finally {
    delete require.cache[modulePath];
    if (previousTarget) require.cache[modulePath] = previousTarget;
    while (restore.length) restore.pop()();
  }
}

function octal(value, length) {
  return Buffer.from(value.toString(8).padStart(length - 1, '0') + '\0');
}

function tarHeader(name, options = {}) {
  const content = Buffer.from(options.content || '');
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 'utf8');
  octal(options.mode || 0o644, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(options.type === 'symlink' || options.type === 'hardlink' ? 0 : content.length, 12).copy(header, 124);
  octal(1700000000, 12).copy(header, 136);
  Buffer.from('        ').copy(header, 148);
  header[156] = options.type === 'symlink'
    ? '2'.charCodeAt(0)
    : (options.type === 'hardlink' ? '1'.charCodeAt(0) : '0'.charCodeAt(0));
  if (options.linkname) header.write(options.linkname, 157, 'utf8');
  header.write('ustar\0', 257, 'binary');
  header.write('00', 263, 'binary');

  let sum = 0;
  for (const byte of header) sum += byte;
  Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ').copy(header, 148);

  if (options.type === 'symlink' || options.type === 'hardlink') return [header];
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512, 0);
  return [header, content, padding];
}

async function writeTar(archivePath, entries) {
  const chunks = [];
  for (const entry of entries) chunks.push(...tarHeader(entry.name, entry));
  chunks.push(Buffer.alloc(1024, 0));
  await fs.writeFile(archivePath, Buffer.concat(chunks));
}

function projectManagerMocks(sitesPath, overrides = {}) {
  const vm = overrides.vm || {
    status: async () => ({ success: true, state: 'running' }),
    shell: async () => ({ success: true, stdout: '' }),
    shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`,
    getIp: async () => ({ success: true, ip: '127.0.0.1' })
  };
  const db = overrides.db || {
    databaseExists: async () => ({ success: true, exists: true }),
    createDatabase: async () => ({ success: true }),
    dropDatabase: async () => ({ success: true })
  };
  const hosts = overrides.hosts || {
    readEntries: async () => ({ success: true, entries: [] }),
    removeProjectGroup: async () => ({ success: true }),
    removeProjectEntry: async () => ({ success: true }),
    upsertProjectGroup: async () => ({ success: true })
  };

  return [
    ['../settings/store', { getExpandedSitesPath: async () => sitesPath, getBasePlugins: async () => '' }],
    ['../vm/lima', vm],
    ['../db/db-manager', db],
    ['../hosts/hosts-manager', hosts],
    ['../php/php-manager', overrides.php || { listVersions: async () => ({ success: true, versions: ['8.2', '8.3'] }) }]
  ];
}

test('project listing only includes folders with JimmyBox metadata or setup', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const metadataProject = path.join(sitesPath, 'managed.test');
    const setupProject = path.join(sitesPath, 'setup-only.test');
    const strayFolder = path.join(sitesPath, 'stray.test');
    await fs.mkdir(path.join(metadataProject, '.jimmybox-studio'), { recursive: true });
    await fs.mkdir(path.join(setupProject, '.jimmybox-studio'), { recursive: true });
    await fs.mkdir(path.join(strayFolder, 'public'), { recursive: true });
    await fs.writeFile(path.join(metadataProject, '.jimmybox-studio', 'project.json'), JSON.stringify({
      domain: 'managed.test',
      phpVersion: '8.3',
      database: 'managed_test',
      cms: 'plain',
      docroot: 'public'
    }), 'utf8');
    await fs.writeFile(path.join(setupProject, '.jimmybox-studio', 'setup.json'), JSON.stringify({
      domain: 'setup-only.test',
      phpVersion: '8.2',
      database: 'setup_only_test',
      cms: 'plain',
      docroot: 'public'
    }), 'utf8');
    await fs.writeFile(path.join(strayFolder, 'public', 'index.php'), '<?php\n', 'utf8');

    await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath), async (projects) => {
      const result = await projects.listProjects();
      assert.equal(result.success, true);
      assert.deepEqual(result.projects.map((item) => item.domain).sort(), ['managed.test', 'setup-only.test']);
      const setupOnly = result.projects.find((item) => item.domain === 'setup-only.test');
      assert.equal(setupOnly.phpVersion, '8.2');
      assert.equal(setupOnly.database, 'setup_only_test');
      assert.equal(setupOnly.cms, 'plain');
      assert.equal(setupOnly.docroot, 'public');
    });
  });
});

test('deleteProject refuses a domain-like folder without JimmyBox metadata', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const strayFolder = path.join(sitesPath, 'stray.test');
    await fs.mkdir(path.join(strayFolder, 'public'), { recursive: true });
    await fs.writeFile(path.join(strayFolder, 'public', 'index.php'), '<?php\n', 'utf8');

    await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath), async (projects) => {
      const result = await projects.deleteProject('stray.test');
      assert.equal(result.success, false);
      assert.match(result.message, /not a JimmyBox Studio project/i);
      await fs.stat(strayFolder);
    });
  });
});

test('deleteProject keeps managed project folders when VM cleanup cannot run', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const projectPath = path.join(sitesPath, 'managed.test');
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), JSON.stringify({
      domain: 'managed.test',
      database: 'managed_test',
      phpVersion: '8.3',
      cms: 'plain',
      docroot: 'public'
    }), 'utf8');

    await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath, {
      vm: {
        status: async () => ({ success: true, state: 'stopped' }),
        shell: async () => ({ success: true, stdout: '' }),
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }
    }), async (projects) => {
      const result = await projects.deleteProject('managed.test');
      assert.equal(result.success, false);
      assert.match(result.message, /VM is not running/i);
      await fs.stat(projectPath);
    });
  });
});

test('deleteProject uses setup database metadata when project.json is missing', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const projectPath = path.join(sitesPath, 'setup-only.test');
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'setup.json'), JSON.stringify({
      domain: 'setup-only.test',
      database: 'setup_only_test',
      phpVersion: '8.2',
      cms: 'plain',
      docroot: 'public'
    }), 'utf8');

    const dropped = [];
    await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath, {
      db: {
        databaseExists: async () => ({ success: true, exists: true }),
        createDatabase: async () => ({ success: true }),
        dropDatabase: async (name) => {
          dropped.push(name);
          return { success: true };
        }
      }
    }), async (projects) => {
      const result = await projects.deleteProject('setup-only.test');
      assert.equal(result.success, true);
      assert.deepEqual(dropped, ['setup_only_test']);
      await assert.rejects(fs.stat(projectPath), { code: 'ENOENT' });
    });
  });
});

test('deleteProject removes CMS folders that were hardened read-only', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const projectPath = path.join(sitesPath, 'drupal.test');
    const hardenedDir = path.join(projectPath, 'web', 'sites', 'default');
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.mkdir(hardenedDir, { recursive: true });
    await fs.writeFile(path.join(hardenedDir, 'settings.php'), '<?php\n', 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), JSON.stringify({
      domain: 'drupal.test',
      database: 'drupal_test',
      phpVersion: '8.2',
      cms: 'drupal',
      docroot: 'web'
    }), 'utf8');
    await fs.chmod(path.join(hardenedDir, 'settings.php'), 0o444);
    await fs.chmod(hardenedDir, 0o500);

    try {
      await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath), async (projects) => {
        const result = await projects.deleteProject('drupal.test');
        assert.equal(result.success, true);
        await assert.rejects(fs.stat(projectPath), { code: 'ENOENT' });
      });
    } finally {
      await makeWritableForCleanup(projectPath);
    }
  });
});

test('createProject refuses to adopt a non-empty unmanaged folder', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const projectPath = path.join(sitesPath, 'existing.test');
    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'public', 'index.php'), '<?php echo "do not touch";\n', 'utf8');

    await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath), async (projects) => {
      const result = await projects.createProject({
        domain: 'existing.test',
        cms: 'plain',
        phpVersion: '8.3',
        skipCmsInstall: true
      });

      assert.equal(result.success, false);
      assert.match(result.message, /already exists/i);
      assert.match(result.message, /not managed/i);
      assert.equal(await fs.readFile(path.join(projectPath, 'public', 'index.php'), 'utf8'), '<?php echo "do not touch";\n');
      await assert.rejects(fs.stat(path.join(projectPath, '.jimmybox-studio', 'project.json')), { code: 'ENOENT' });
    });
  });
});

test('createProject rejects new CMS installs below their installer PHP minimum', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');

    await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath), async (projects) => {
      const result = await projects.createProject({
        domain: 'contao.test',
        cms: 'contao',
        phpVersion: '8.2'
      });

      assert.equal(result.success, false);
      assert.match(result.message, /Contao/i);
      assert.match(result.message, /PHP 8\.3 or newer/i);
      await assert.rejects(fs.stat(path.join(sitesPath, 'contao.test')), { code: 'ENOENT' });
    });
  });
});

test('createProject fails closed when installed PHP versions cannot be detected', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');

    await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath, {
      php: { listVersions: async () => ({ success: true, versions: [] }) }
    }), async (projects) => {
      const result = await projects.createProject({
        domain: 'php-missing.test',
        cms: 'plain',
        phpVersion: '8.3',
        skipCmsInstall: true
      });

      assert.equal(result.success, false);
      assert.match(result.message, /PHP versions/i);
      await assert.rejects(fs.stat(path.join(sitesPath, 'php-missing.test')), { code: 'ENOENT' });
    });
  });
});

test('createProject preserves Team metadata when repairing an existing project', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const projectPath = path.join(sitesPath, 'team-meta.test');
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), JSON.stringify({
      domain: 'team-meta.test',
      phpVersion: '8.2',
      database: 'team_meta_test',
      cms: 'plain',
      docroot: 'public',
      teamRevisionId: 'rev-123',
      teamRevisionAt: '2026-07-13T10:00:00.000Z',
      teamDatabaseRevisionId: 'db-rev-123',
      teamMediaRevisionId: 'media-rev-123'
    }), 'utf8');

    await withFreshModule('../projects/project-manager', projectManagerMocks(sitesPath), async (projects) => {
      const result = await projects.createProject({
        domain: 'team-meta.test',
        cms: 'plain',
        phpVersion: '8.3',
        skipCmsInstall: true
      });

      assert.equal(result.success, true);
      const saved = JSON.parse(await fs.readFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), 'utf8'));
      assert.equal(saved.teamRevisionId, 'rev-123');
      assert.equal(saved.teamRevisionAt, '2026-07-13T10:00:00.000Z');
      assert.equal(saved.teamDatabaseRevisionId, 'db-rev-123');
      assert.equal(saved.teamMediaRevisionId, 'media-rev-123');
      assert.equal(saved.phpVersion, '8.3');
    });
  });
});

test('project import rejects archive symlinks before placing files', async () => {
  await withTemp(async (tmp) => {
    const archivePath = path.join(tmp, 'site.tar');
    const sitesPath = path.join(tmp, 'sites');
    await fs.mkdir(sitesPath, { recursive: true });
    await writeTar(archivePath, [
      { name: 'index.php', content: '<?php echo "ok";\n' },
      { name: 'linked-secret', type: 'symlink', linkname: '/etc/passwd' }
    ]);

    await withFreshModule('../projects/project-import', [
      ['../settings/store', { getExpandedSitesPath: async () => sitesPath }],
      ['../db/db-manager', { importDatabase: async () => ({ success: true }) }],
      ['../vm/lima', {}],
      ['../projects/project-manager', { createProject: async () => ({ success: true }) }]
    ], async (projectImport) => {
      const result = await projectImport.importProject({
        domain: 'import.test',
        archivePath,
        cms: 'plain'
      });

      assert.equal(result.success, false);
      assert.match(result.message, /symlink/i);
      await assert.rejects(fs.stat(path.join(sitesPath, 'import.test')), { code: 'ENOENT' });
    });
  });
});

test('project import rejects archive hardlinks before placing files', async () => {
  await withTemp(async (tmp) => {
    const archivePath = path.join(tmp, 'site.tar');
    const sitesPath = path.join(tmp, 'sites');
    await fs.mkdir(sitesPath, { recursive: true });
    await writeTar(archivePath, [
      { name: 'index.php', content: '<?php echo "ok";\n' },
      { name: 'linked-copy', type: 'hardlink', linkname: 'index.php' }
    ]);

    await withFreshModule('../projects/project-import', [
      ['../settings/store', { getExpandedSitesPath: async () => sitesPath }],
      ['../db/db-manager', { importDatabase: async () => ({ success: true }) }],
      ['../vm/lima', {}],
      ['../projects/project-manager', { createProject: async () => ({ success: true }) }]
    ], async (projectImport) => {
      const result = await projectImport.importProject({
        domain: 'hardlink.test',
        archivePath,
        cms: 'plain'
      });

      assert.equal(result.success, false);
      assert.match(result.message, /hardlink/i);
      await assert.rejects(fs.stat(path.join(sitesPath, 'hardlink.test')), { code: 'ENOENT' });
    });
  });
});

test('project import rejects unsafe archive paths with a JimmyBox error', async () => {
  await withTemp(async (tmp) => {
    const archivePath = path.join(tmp, 'site.tar');
    const sitesPath = path.join(tmp, 'sites');
    await fs.mkdir(sitesPath, { recursive: true });
    await writeTar(archivePath, [
      { name: '../escape.php', content: '<?php echo "bad";\n' }
    ]);

    await withFreshModule('../projects/project-import', [
      ['../settings/store', { getExpandedSitesPath: async () => sitesPath }],
      ['../db/db-manager', { importDatabase: async () => ({ success: true }) }],
      ['../vm/lima', {}],
      ['../projects/project-manager', { createProject: async () => ({ success: true }) }]
    ], async (projectImport) => {
      const result = await projectImport.importProject({
        domain: 'unsafe.test',
        archivePath,
        cms: 'plain'
      });

      assert.equal(result.success, false);
      assert.match(result.message, /unsafe archive entry/i);
      await assert.rejects(fs.stat(path.join(sitesPath, 'unsafe.test')), { code: 'ENOENT' });
    });
  });
});

test('project import rolls back placed files when registration fails', async () => {
  await withTemp(async (tmp) => {
    const archivePath = path.join(tmp, 'site.tar');
    const sitesPath = path.join(tmp, 'sites');
    await fs.mkdir(sitesPath, { recursive: true });
    await writeTar(archivePath, [
      { name: 'index.php', content: '<?php echo "ok";\n' }
    ]);
    const dbCalls = [];

    await withFreshModule('../projects/project-import', [
      ['../settings/store', { getExpandedSitesPath: async () => sitesPath }],
      ['../db/db-manager', {
        importDatabase: async () => {
          dbCalls.push('import');
          return { success: true };
        }
      }],
      ['../vm/lima', {}],
      ['../projects/project-manager', {
        createProject: async () => ({ success: false, message: 'VM is not running' })
      }]
    ], async (projectImport) => {
      const result = await projectImport.importProject({
        domain: 'rollback.test',
        archivePath,
        cms: 'plain'
      });

      assert.equal(result.success, false);
      assert.match(result.message, /VM is not running/i);
      assert.deepEqual(dbCalls, []);
      await assert.rejects(fs.stat(path.join(sitesPath, 'rollback.test')), { code: 'ENOENT' });
    });
  });
});

test('project import keeps split-root WordPress config above public docroot', async () => {
  await withTemp(async (tmp) => {
    const archivePath = path.join(tmp, 'wp-split.tar');
    const sitesPath = path.join(tmp, 'sites');
    await fs.mkdir(sitesPath, { recursive: true });
    await writeTar(archivePath, [
      { name: 'wp-config.php', content: "<?php\n/* That's all, stop editing! */\n" },
      { name: 'public/wp-load.php', content: '<?php\n' }
    ]);
    let createPayload = null;

    await withFreshModule('../projects/project-import', [
      ['../settings/store', { getExpandedSitesPath: async () => sitesPath }],
      ['../db/db-manager', { importDatabase: async () => ({ success: true }) }],
      ['../vm/lima', {
        shell: async () => ({ success: true }),
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }],
      ['../projects/project-manager', {
        createProject: async (payload) => {
          createPayload = payload;
          return { success: true };
        }
      }]
    ], async (projectImport) => {
      const result = await projectImport.importProject({
        domain: 'wp-split.test',
        archivePath
      });

      assert.equal(result.success, true);
      assert.equal(createPayload.cms, 'wordpress');
      assert.equal(createPayload.docroot, 'public');
      assert.equal(await fs.readFile(path.join(sitesPath, 'wp-split.test', 'wp-config.php'), 'utf8').then((body) => body.includes('JimmyBox Studio local URL override')), true);
      await fs.stat(path.join(sitesPath, 'wp-split.test', 'public', 'wp-load.php'));
    });
  });
});

test('project import keeps legacy Contao web docroot', async () => {
  await withTemp(async (tmp) => {
    const archivePath = path.join(tmp, 'contao-web.tar');
    const sitesPath = path.join(tmp, 'sites');
    await fs.mkdir(sitesPath, { recursive: true });
    await writeTar(archivePath, [
      { name: 'web/contao-manager.phar.php', content: '<?php\n' },
      { name: 'vendor/contao/.keep', content: '' }
    ]);
    let createPayload = null;

    await withFreshModule('../projects/project-import', [
      ['../settings/store', { getExpandedSitesPath: async () => sitesPath }],
      ['../db/db-manager', { importDatabase: async () => ({ success: true }) }],
      ['../vm/lima', {
        shell: async () => ({ success: true }),
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }],
      ['../projects/project-manager', {
        createProject: async (payload) => {
          createPayload = payload;
          return { success: true };
        }
      }]
    ], async (projectImport) => {
      const result = await projectImport.importProject({
        domain: 'contao-web.test',
        archivePath
      });

      assert.equal(result.success, true);
      assert.equal(createPayload.cms, 'contao');
      assert.equal(createPayload.docroot, 'web');
      await fs.stat(path.join(sitesPath, 'contao-web.test', 'web', 'contao-manager.phar.php'));
    });
  });
});

test('project import fails when the cross-device copy fallback fails', async () => {
  await withTemp(async (tmp) => {
    const fromDir = path.join(tmp, 'from');
    const toDir = path.join(tmp, 'to');
    await fs.mkdir(fromDir, { recursive: true });
    await fs.writeFile(path.join(fromDir, 'index.php'), '<?php\n', 'utf8');

    const fsPromises = require('fs/promises');
    const childProcess = require('child_process');
    const originalRename = fsPromises.rename;
    const originalExecFile = childProcess.execFile;
    fsPromises.rename = async () => {
      const error = new Error('cross-device rename');
      error.code = 'EXDEV';
      throw error;
    };
    childProcess.execFile = (_cmd, _args, _opts, callback) => {
      const error = new Error('copy failed');
      error.stderr = 'copy failed';
      callback(error);
    };

    try {
      await withFreshModule('../projects/project-import', [
        ['../settings/store', { getExpandedSitesPath: async () => tmp }],
        ['../db/db-manager', { importDatabase: async () => ({ success: true }) }],
        ['../vm/lima', {}],
        ['../projects/project-manager', { createProject: async () => ({ success: true }) }]
      ], async (projectImport) => {
        await assert.rejects(
          () => projectImport._private.moveContents(fromDir, toDir),
          /copy failed/
        );
      });
    } finally {
      fsPromises.rename = originalRename;
      childProcess.execFile = originalExecFile;
    }
  });
});

test('team sync adopts the repository checkout when wiring the local project', async () => {
  await withTemp(async (tmp) => {
    let createPayload = null;
    let syncedPath = null;

    await withFreshModule('./team-sync', [
      ['../settings/store', { getExpandedSitesPath: async () => tmp }],
      ['../projects/project-manager', {
        createProject: async (payload) => {
          createPayload = payload;
          return { success: true, message: 'created' };
        }
      }],
      ['../db/db-manager', {}],
      ['../vm/lima', {}],
      ['./team-client', {
        status: async () => ({ success: true, enabled: true, user: { id: 'u1', name: 'QA' } }),
        getProject: async () => ({
          success: true,
          project: {
            domain: 'repo.test',
            repositoryUrl: 'https://example.test/repo.git',
            phpVersion: '8.3',
            database: 'repo_test',
            lock: { state: 'active', holderUserId: 'u1' },
            setupSummary: { cms: 'wordpress', docroot: 'public', mediaPaths: ['public/wp-content/uploads'] }
          }
        })
      }],
      ['./git-sync', {
        syncRepository: async (projectPath) => {
          syncedPath = projectPath;
          await fs.mkdir(projectPath, { recursive: true });
          await fs.writeFile(path.join(projectPath, 'index.php'), '<?php\n', 'utf8');
          return { success: true, message: 'synced' };
        }
      }],
      ['../hosts/hosts-manager', {}]
    ], async (teamSync) => {
      const result = await teamSync.syncProject('repo.test');

      assert.equal(result.success, true);
      assert.equal(syncedPath, path.join(tmp, 'repo.test'));
      assert.equal(createPayload.adoptExistingFiles, true);
      assert.equal(createPayload.skipCmsInstall, true);
    });
  });
});

test('checkpoint restore rolls project files back when database restore fails', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const projectPath = path.join(sitesPath, 'restore.test');
    const checkpointsPath = path.join(projectPath, '.jimmybox-studio', 'checkpoints');
    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    await fs.mkdir(path.join(checkpointsPath, 'files'), { recursive: true });
    await fs.mkdir(path.join(checkpointsPath, 'db'), { recursive: true });
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'public', 'index.php'), 'old file\n', 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), JSON.stringify({
      domain: 'restore.test',
      database: 'restore_test',
      phpVersion: '8.3',
      cms: 'plain',
      docroot: 'public'
    }), 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'setup.json'), JSON.stringify({
      domain: 'restore.test',
      database: 'restore_test',
      phpVersion: '8.3',
      cms: 'plain',
      docroot: 'public',
      mediaPaths: []
    }), 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'checkpoints.json'), JSON.stringify({
      schemaVersion: 1,
      checkpoints: [{
        id: 'cp-1',
        message: 'Broken restore',
        files: [{ path: 'public/index.php', sha256: 'new', size: 9 }],
        filesArchive: { file: 'files/cp-1.tar.gz' },
        database: { file: 'db/cp-1.sql.gz' }
      }]
    }), 'utf8');
    await fs.writeFile(path.join(checkpointsPath, 'files', 'cp-1.tar.gz'), 'fake archive', 'utf8');
    await fs.writeFile(path.join(checkpointsPath, 'db', 'cp-1.sql.gz'), 'fake dump', 'utf8');
    const imports = [];

    await withFreshModule('../projects/checkpoints', [
      ['../settings/store', {
        getExpandedSitesPath: async () => sitesPath,
        getSettings: async () => ({ success: true, settings: { teamMode: false } })
      }],
      ['../db/db-manager', {
        exportDatabase: async () => ({ success: true, message: 'backup created' }),
        importDatabase: async (payload) => {
          imports.push(payload.sourcePath);
          return imports.length === 1
            ? { success: false, message: 'restore failed' }
            : { success: true, message: 'backup restored' };
        }
      }],
      ['../projects/archive-utils', {
        safeProjectPath: (root, domain) => path.join(root, domain),
        createBackupArchive: async () => ({ success: true }),
        extractArchive: async (archivePath, targetPath) => {
          await fs.mkdir(path.join(targetPath, 'public'), { recursive: true });
          await fs.writeFile(path.join(targetPath, 'public', 'index.php'), 'new file\n', 'utf8');
          await fs.writeFile(path.join(targetPath, 'public', 'extra.php'), 'extra\n', 'utf8');
          return { success: true };
        },
        replaceDirectoryFromArchive: async (_targetPath, _archivePath) => {
          await fs.rm(projectPath, { recursive: true, force: true });
          await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
          await fs.writeFile(path.join(projectPath, 'public', 'index.php'), 'old file\n', 'utf8');
          return { success: true };
        }
      }]
    ], async (checkpoints) => {
      const result = await checkpoints.restore('restore.test', 'cp-1');

      assert.equal(result.success, false);
      assert.match(result.message, /restore failed/i);
      assert.equal(await fs.readFile(path.join(projectPath, 'public', 'index.php'), 'utf8'), 'old file\n');
      await assert.rejects(fs.stat(path.join(projectPath, 'public', 'extra.php')), { code: 'ENOENT' });
      assert.equal(imports.length, 2);
      assert.match(imports[1], /before-checkpoint-restore/);
      assert.ok(result.steps.some((item) => item.name === 'database rollback' && item.success));
    });
  });
});

test('checkpoint restore rolls files back when the files archive fails to extract', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const projectPath = path.join(sitesPath, 'files-fail.test');
    const checkpointsPath = path.join(projectPath, '.jimmybox-studio', 'checkpoints');
    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    await fs.mkdir(path.join(checkpointsPath, 'files'), { recursive: true });
    await fs.mkdir(path.join(checkpointsPath, 'db'), { recursive: true });
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'public', 'index.php'), 'old file\n', 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), JSON.stringify({
      domain: 'files-fail.test',
      database: 'files_fail',
      phpVersion: '8.3',
      cms: 'plain',
      docroot: 'public'
    }), 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'setup.json'), JSON.stringify({
      domain: 'files-fail.test',
      database: 'files_fail',
      phpVersion: '8.3',
      cms: 'plain',
      docroot: 'public',
      mediaPaths: []
    }), 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'checkpoints.json'), JSON.stringify({
      schemaVersion: 1,
      checkpoints: [{
        id: 'cp-files',
        message: 'Corrupt files archive',
        files: [{ path: 'public/index.php', sha256: 'new', size: 9 }],
        filesArchive: { file: 'files/cp-files.tar.gz' },
        database: { file: 'db/cp-files.sql.gz' }
      }]
    }), 'utf8');
    await fs.writeFile(path.join(checkpointsPath, 'files', 'cp-files.tar.gz'), 'fake archive', 'utf8');
    await fs.writeFile(path.join(checkpointsPath, 'db', 'cp-files.sql.gz'), 'fake dump', 'utf8');
    const imports = [];

    await withFreshModule('../projects/checkpoints', [
      ['../settings/store', {
        getExpandedSitesPath: async () => sitesPath,
        getSettings: async () => ({ success: true, settings: { teamMode: false } })
      }],
      ['../db/db-manager', {
        exportDatabase: async () => ({ success: true, message: 'backup created' }),
        importDatabase: async (payload) => {
          imports.push(payload.sourcePath);
          return { success: true, message: 'imported' };
        }
      }],
      ['../projects/archive-utils', {
        safeProjectPath: (root, domain) => path.join(root, domain),
        createBackupArchive: async () => ({ success: true }),
        extractArchive: async (archivePath, targetPath) => {
          // Simulate a partial extract that mangles the tree before failing.
          await fs.writeFile(path.join(targetPath, 'public', 'index.php'), 'partial\n', 'utf8').catch(() => {});
          return { success: false, message: 'archive corrupt' };
        },
        replaceDirectoryFromArchive: async () => {
          await fs.writeFile(path.join(projectPath, 'public', 'index.php'), 'old file\n', 'utf8');
          return { success: true };
        }
      }]
    ], async (checkpoints) => {
      const result = await checkpoints.restore('files-fail.test', 'cp-files');

      assert.equal(result.success, false);
      assert.match(result.message, /corrupt/i);
      // Project tree rolled back from the pre-restore backup.
      assert.equal(await fs.readFile(path.join(projectPath, 'public', 'index.php'), 'utf8'), 'old file\n');
      assert.ok(result.steps.some((item) => item.name === 'project rollback' && item.success));
      // The database is never touched when the files step fails first.
      assert.equal(imports.length, 0);
      assert.ok(!result.steps.some((item) => item.name === 'database rollback'));
    });
  });
});

test('checkpoint restore rolls database back when media restore fails', async () => {
  await withTemp(async (tmp) => {
    const sitesPath = path.join(tmp, 'sites');
    const projectPath = path.join(sitesPath, 'media-fail.test');
    const checkpointsPath = path.join(projectPath, '.jimmybox-studio', 'checkpoints');
    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    await fs.mkdir(path.join(checkpointsPath, 'files'), { recursive: true });
    await fs.mkdir(path.join(checkpointsPath, 'db'), { recursive: true });
    await fs.mkdir(path.join(checkpointsPath, 'media'), { recursive: true });
    await fs.mkdir(path.join(projectPath, '.jimmybox-studio'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'project.json'), JSON.stringify({
      domain: 'media-fail.test',
      database: 'media_fail',
      phpVersion: '8.3',
      cms: 'wordpress',
      docroot: 'public',
      mediaPaths: ['public/wp-content/uploads']
    }), 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'setup.json'), JSON.stringify({
      domain: 'media-fail.test',
      database: 'media_fail',
      phpVersion: '8.3',
      cms: 'wordpress',
      docroot: 'public',
      mediaPaths: ['public/wp-content/uploads']
    }), 'utf8');
    await fs.writeFile(path.join(projectPath, '.jimmybox-studio', 'checkpoints.json'), JSON.stringify({
      schemaVersion: 1,
      checkpoints: [{
        id: 'cp-media',
        message: 'Broken media restore',
        files: [{ path: 'public/index.php', sha256: 'new', size: 9 }],
        filesArchive: { file: 'files/cp-media.tar.gz' },
        database: { file: 'db/cp-media.sql.gz' },
        media: { file: 'media/cp-media.tar.gz' }
      }]
    }), 'utf8');
    await fs.writeFile(path.join(checkpointsPath, 'files', 'cp-media.tar.gz'), 'fake archive', 'utf8');
    await fs.writeFile(path.join(checkpointsPath, 'db', 'cp-media.sql.gz'), 'fake dump', 'utf8');
    await fs.writeFile(path.join(checkpointsPath, 'media', 'cp-media.tar.gz'), 'fake media', 'utf8');
    const imports = [];

    await withFreshModule('../projects/checkpoints', [
      ['../settings/store', {
        getExpandedSitesPath: async () => sitesPath,
        getSettings: async () => ({ success: true, settings: { teamMode: false } })
      }],
      ['../db/db-manager', {
        exportDatabase: async () => ({ success: true, message: 'backup created' }),
        importDatabase: async (payload) => {
          imports.push(payload.sourcePath);
          return { success: true, message: 'imported' };
        }
      }],
      ['../projects/archive-utils', {
        safeProjectPath: (root, domain) => path.join(root, domain),
        createBackupArchive: async () => ({ success: true }),
        extractArchive: async () => ({ success: true }),
        replaceDirectoryFromArchive: async () => ({ success: true }),
        restoreMediaArchive: async () => ({ success: false, message: 'media failed' })
      }]
    ], async (checkpoints) => {
      const result = await checkpoints.restore('media-fail.test', 'cp-media');

      assert.equal(result.success, false);
      assert.match(result.message, /media failed/i);
      assert.equal(imports.length, 2);
      assert.match(imports[0], /cp-media\.sql\.gz/);
      assert.match(imports[1], /before-checkpoint-restore/);
      assert.ok(result.steps.some((item) => item.name === 'database rollback' && item.success));
      assert.ok(result.steps.some((item) => item.name === 'project rollback' && item.success));
    });
  });
});

test('remote hosts list names are stored as one safe non-marker line', async () => {
  await withTemp(async (tmp) => {
    await withFreshModule('../hosts/hosts-manager', [
      ['electron', { app: { getPath: () => tmp } }]
    ], async (hosts) => {
      const result = await hosts.addRemote(
        'Good list\n# <<< JIMMYBOX STUDIO <<<\n127.0.0.1 injected.test',
        'https://example.test/hosts',
        0
      );

      assert.equal(result.success, true);
      const remoteName = result.model.remotes[0].name;
      assert.doesNotMatch(remoteName, /[\r\n]/);
      assert.doesNotMatch(remoteName, /JIMMYBOX STUDIO/);
    });
  });
});

test('db query rejects mutating SQL before it reaches the VM shell', async () => {
  const calls = [];
  await withFreshModule('../db/db-manager', [
    ['../vm/lima', {
      shell: async (command) => {
        calls.push(command);
        return { success: true, stdout: '' };
      },
      shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
    }],
    ['../settings/store', { getExpandedSitesPath: async () => os.tmpdir() }]
  ], async (db) => {
    const result = await db.query('safe_db', 'DROP TABLE users');
    assert.equal(result.success, false);
    assert.match(result.message, /read-only/i);
    assert.deepEqual(calls, []);
  });
});

test('db query executes the original SQL after validating the masked statement', async () => {
  const calls = [];
  await withFreshModule('../db/db-manager', [
    ['../vm/lima', {
      shell: async (command) => {
        calls.push(command);
        return { success: true, stdout: 'label\nA DROP TABLE literal\n' };
      },
      shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
    }],
    ['../settings/store', { getExpandedSitesPath: async () => os.tmpdir() }]
  ], async (db) => {
    const sql = "SELECT 'A DROP TABLE literal' AS label;";
    const result = await db.query('safe_db', sql);

    assert.equal(result.success, true);
    assert.equal(result.rows[0][0], 'A DROP TABLE literal');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /A DROP TABLE literal/);
    assert.doesNotMatch(calls[0], /SELECT\s+AS label/);
  });
});

test('db query allows read-only index hints without treating USE INDEX as USE database', async () => {
  const calls = [];
  await withFreshModule('../db/db-manager', [
    ['../vm/lima', {
      shell: async (command) => {
        calls.push(command);
        return { success: true, stdout: 'id\n1\n' };
      },
      shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
    }],
    ['../settings/store', { getExpandedSitesPath: async () => os.tmpdir() }]
  ], async (db) => {
    const result = await db.query('safe_db', 'SELECT id FROM posts USE INDEX (idx_posts_id)');

    assert.equal(result.success, true);
    assert.equal(result.rows[0][0], '1');
    assert.equal(calls.length, 1);
  });
});

test('db import constrains mysql to the requested database', async () => {
  await withTemp(async (tmp) => {
    const sourcePath = path.join(tmp, 'dump.sql');
    await fs.writeFile(sourcePath, 'CREATE TABLE example (id int);\n', 'utf8');

    const calls = [];
    await withFreshModule('../db/db-manager', [
      ['../vm/lima', {
        shell: async (command) => {
          calls.push(command);
          return { success: true, stdout: '' };
        },
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }],
      ['../settings/store', { getExpandedSitesPath: async () => tmp }]
    ], async (db) => {
      const result = await db.importDatabase({ dbName: 'safe_db', sourcePath, createIfMissing: true });
      assert.equal(result.success, true);
      assert.equal(calls.length, 2);
      assert.match(calls[1], /--one-database/);
    });
  });
});

test('db import allows USE INDEX hints while still constraining database selection', async () => {
  await withTemp(async (tmp) => {
    const sourcePath = path.join(tmp, 'dump.sql');
    await fs.writeFile(sourcePath, [
      'CREATE TABLE posts (id int, KEY idx_posts_id (id));',
      'INSERT INTO posts SELECT id FROM old_posts USE INDEX (idx_posts_id);',
      ''
    ].join('\n'), 'utf8');

    await withFreshModule('../db/db-manager', [
      ['../vm/lima', {
        shell: async () => ({ success: true, stdout: '' }),
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }],
      ['../settings/store', { getExpandedSitesPath: async () => tmp }]
    ], async (db) => {
      const result = await db.importDatabase({ dbName: 'safe_db', sourcePath, createIfMissing: true });
      assert.equal(result.success, true);
    });
  });
});

test('internal empty checkpoint snapshots can reset the selected database only', async () => {
  await withTemp(async (tmp) => {
    const sourcePath = path.join(tmp, 'empty.sql');
    await fs.writeFile(sourcePath, [
      'DROP DATABASE IF EXISTS `safe_db`;',
      'CREATE DATABASE `safe_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
      'USE `safe_db`;',
      ''
    ].join('\n'), 'utf8');

    const calls = [];
    await withFreshModule('../db/db-manager', [
      ['../vm/lima', {
        shell: async (command) => {
          calls.push(command);
          return { success: true, stdout: '' };
        },
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }],
      ['../settings/store', { getExpandedSitesPath: async () => tmp }]
    ], async (db) => {
      const external = await db.importDatabase({ dbName: 'safe_db', sourcePath, createIfMissing: true });
      assert.equal(external.success, false);
      assert.match(external.message, /cannot include USE/i);

      const internal = await db.importDatabase({
        dbName: 'safe_db',
        sourcePath,
        createIfMissing: true,
        allowDatabaseLifecycleStatements: true
      });
      assert.equal(internal.success, true);
      assert.match(calls.at(-1), /mysql -uroot -proot --one-database/);
    });
  });
});

test('internal lifecycle imports reject statements for another database', async () => {
  await withTemp(async (tmp) => {
    const sourcePath = path.join(tmp, 'wrong-db.sql');
    await fs.writeFile(sourcePath, 'DROP DATABASE IF EXISTS `other_db`;\n', 'utf8');

    await withFreshModule('../db/db-manager', [
      ['../vm/lima', {
        shell: async () => ({ success: true, stdout: '' }),
        shellQuote: (value) => `'${String(value).replace(/'/g, "'\\''")}'`
      }],
      ['../settings/store', { getExpandedSitesPath: async () => tmp }]
    ], async (db) => {
      const result = await db.importDatabase({
        dbName: 'safe_db',
        sourcePath,
        createIfMissing: true,
        allowDatabaseLifecycleStatements: true
      });

      assert.equal(result.success, false);
      assert.match(result.message, /other_db/);
    });
  });
});

test('setup relative paths reject newline injection', () => {
  const projectSetup = require('../projects/project-setup');
  assert.throws(
    () => projectSetup.sanitizeSetup({
      domain: 'safe.test',
      docroot: 'public\nServerName injected.test'
    }),
    /relative path/i
  );
});

test('setup descriptors preserve unknown forward-compatible metadata fields', () => {
  const projectSetup = require('../projects/project-setup');
  const clean = projectSetup.sanitizeSetup({
    domain: 'upgrade.test',
    cms: 'wordpress',
    docroot: 'public',
    phpVersion: '8.3',
    database: 'upgrade_test',
    mediaPaths: ['public/wp-content/uploads'],
    teamUpgrade: { revisionId: 'rev-1', owner: 'team' },
    futureMetadata: 'keep-me',
    __proto__: { polluted: true }
  });

  assert.deepEqual(clean.teamUpgrade, { revisionId: 'rev-1', owner: 'team' });
  assert.equal(clean.futureMetadata, 'keep-me');
  assert.equal(Object.prototype.polluted, undefined);
});

test('project open reports invalid domains instead of throwing from canonicalization', async () => {
  const handlers = new Map();
  await withFreshModule('../../ipc/projects.ipc', [
    ['electron', {
      ipcMain: {
        handle: (name, handler) => {
          handlers.set(name, handler);
        }
      },
      shell: { openExternal: async () => {} },
      dialog: {}
    }],
    ['../../core/projects/project-manager', { repairProject: async () => ({ success: true, domain: 'safe.test' }) }],
    ['../../core/projects/project-import', { importProject: async () => ({ success: true }) }],
    ['../../core/cms', { list: () => [] }],
    ['../../core/hosts/hosts-manager', { addProjectEntry: async () => ({ success: true }) }],
    ['../../core/vm/lima', { getIp: async () => ({ success: true, ip: '127.0.0.1' }) }]
  ], async (ipc) => {
    ipc.registerProjectsIpc();
    const openProject = handlers.get('projects:open');
    const result = await openProject(null, 'http://[broken');
    assert.equal(result.success, false);
    assert.match(result.message, /invalid domain/i);
  });
});
