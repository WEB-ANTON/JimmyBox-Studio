const fs = require('fs/promises');
const path = require('path');
const { composerCreateProject, exists, phpBin, phpString, projectShell, randomSecret } = require('../helpers');

function settingsPhp(dbName) {
  const encryptionKey = randomSecret(48);
  return `<?php
return [
    'BE' => [
        'installToolPassword' => '${phpString(randomSecret(32))}',
    ],
    'SYS' => [
        'encryptionKey' => '${phpString(encryptionKey)}',
        'trustedHostsPattern' => '.*',
    ],
    'DB' => [
        'Connections' => [
            'Default' => [
                'charset' => 'utf8mb4',
                'dbname' => '${phpString(dbName)}',
                'driver' => 'mysqli',
                'host' => 'localhost',
                'password' => 'root',
                'port' => 3306,
                'user' => 'root',
            ],
        ],
    ],
];
`;
}

module.exports = {
  id: 'typo3',
  label: 'TYPO3',
  docroot: 'public',
  mediaPaths: ['public/fileadmin', 'public/uploads'],
  phpRange: '>=7.4',
  recommendedPhpVersion: '8.2',
  phpExtensions: ['gd', 'intl', 'mysqli', 'xml', 'zip'],

  async detect(projectPath) {
    // Match the TYPO3 core package (vendor/typo3/cms-core) or the public/typo3
    // runtime dir — not a bare vendor/typo3, which any project merely depending
    // on a standalone typo3/* library (e.g. phar-stream-wrapper) would have.
    return (await exists(path.join(projectPath, 'vendor', 'typo3', 'cms-core'))) ||
      (await exists(path.join(projectPath, 'public', 'typo3'))) ||
      (await exists(path.join(projectPath, 'public', 'typo3conf', 'LocalConfiguration.php'))) ||
      (await exists(path.join(projectPath, 'public', 'typo3', 'sysext', 'core')));
  },

  async writeDbConfig({ projectPath, dbName }) {
    const target = path.join(projectPath, 'config', 'system', 'settings.php');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, settingsPhp(dbName), 'utf8');
    return { success: true, changed: true };
  },

  async setupRoutines({ phpVersion } = {}) {
    return [
      { name: 'TYPO3 cache flush', cmd: `test -x vendor/bin/typo3 && ${phpBin(phpVersion)} vendor/bin/typo3 cache:flush || true`, cwd: '', runOn: ['checkout', 'sync'], location: 'vm' }
    ];
  },

  async install({ domain, projectPath, dbName, phpVersion, vm }) {
    // Imported/existing project: never re-scaffold or re-run setup — that would
    // fail or overwrite the developer's config. Leave it untouched.
    if (await this.detect(projectPath)) {
      return { success: true, changed: false, message: 'Existing TYPO3 project detected — left unchanged.' };
    }

    const created = await projectShell(vm, domain, composerCreateProject(phpVersion, '"typo3/cms-base-distribution:^13"'));
    if (!created.success) return created;

    // TYPO3 v13 `setup` writes config/system/settings.php itself (incl. the
    // encryptionKey), needs an explicit --server-type, and enforces a complex
    // admin password (upper case + special char). Do NOT pre-write settings.php:
    // an existing one makes setup abort silently.
    const setup = await projectShell(
      vm,
      domain,
      `${phpBin(phpVersion)} vendor/bin/typo3 setup --no-interaction --server-type=other --driver=mysqli --host=localhost --port=3306 --dbname=` +
        `${vm.shellQuote(dbName)} --username=root --password=root --admin-username=admin --admin-user-password=${vm.shellQuote('Studio.admin1')} --admin-email=admin@example.test --project-name=${vm.shellQuote(domain)} --create-site=${vm.shellQuote(`https://${domain}/`)}`
    );
    if (!setup.success) return setup;

    return { success: true, changed: true, message: 'TYPO3 is ready.' };
  },

  // Point an imported TYPO3 at the local DB via config/system/additional.php,
  // which overrides settings.php after it loads (non-destructive), and trust any
  // local host name.
  async localize({ projectPath, docroot, dbName }) {
    const steps = [];
    const legacyDir = path.join(projectPath, docroot || 'public', 'typo3conf');
    const legacyConfig = path.join(legacyDir, 'LocalConfiguration.php');
    const isLegacy = await exists(legacyConfig);
    const target = isLegacy
      ? path.join(legacyDir, 'AdditionalConfiguration.php')
      : path.join(projectPath, 'config', 'system', 'additional.php');
    const php = `<?php
$GLOBALS['TYPO3_CONF_VARS']['DB']['Connections']['Default']['dbname'] = '${phpString(dbName)}';
$GLOBALS['TYPO3_CONF_VARS']['DB']['Connections']['Default']['user'] = 'root';
$GLOBALS['TYPO3_CONF_VARS']['DB']['Connections']['Default']['password'] = 'root';
$GLOBALS['TYPO3_CONF_VARS']['DB']['Connections']['Default']['host'] = 'localhost';
$GLOBALS['TYPO3_CONF_VARS']['DB']['Connections']['Default']['port'] = 3306;
$GLOBALS['TYPO3_CONF_VARS']['DB']['Connections']['Default']['driver'] = 'mysqli';
$GLOBALS['TYPO3_CONF_VARS']['SYS']['trustedHostsPattern'] = '.*';
`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, php, 'utf8');
    steps.push({ name: 'typo3 config', success: true, message: `Local DB override written (${isLegacy ? path.join(docroot || 'public', 'typo3conf', 'AdditionalConfiguration.php') : 'config/system/additional.php'}).` });
    return { success: true, steps };
  }
};
