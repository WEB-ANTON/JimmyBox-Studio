const fs = require('fs/promises');
const path = require('path');
const { composerCmd, composerCreateProject, exists, mysqlUrl, phpBin, phpString, projectShell, randomSecret } = require('../helpers');

const OVERRIDE_START = '// >>> JimmyBox local override >>>';
const OVERRIDE_END = '// <<< JimmyBox local override <<<';

function settingsPhp(dbName) {
  return `<?php
$databases['default']['default'] = [
  'database' => '${phpString(dbName)}',
  'username' => 'root',
  'password' => 'root',
  'prefix' => '',
  'host' => 'localhost',
  'port' => '3306',
  'namespace' => 'Drupal\\\\mysql\\\\Driver\\\\Database\\\\mysql',
  'driver' => 'mysql',
];
$settings['hash_salt'] = '${randomSecret(48)}';
$settings['trusted_host_patterns'] = ['.*'];
`;
}

module.exports = {
  id: 'drupal',
  label: 'Drupal',
  docroot: 'web',
  mediaPaths: ['web/sites/default/files'],
  phpRange: '>=7.4',
  recommendedPhpVersion: '8.2',
  phpExtensions: ['curl', 'gd', 'intl', 'mbstring', 'mysqli', 'xml', 'zip'],

  async detect(projectPath) {
    return (await exists(path.join(projectPath, 'web', 'core', 'lib', 'Drupal.php'))) ||
      (await exists(path.join(projectPath, 'core', 'lib', 'Drupal.php')));
  },

  async writeDbConfig({ projectPath, dbName }) {
    const dir = path.join(projectPath, 'web', 'sites', 'default');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'settings.php'), settingsPhp(dbName), 'utf8');
    return { success: true, changed: true };
  },

  async setupRoutines({ phpVersion } = {}) {
    // vendor/bin/drush is a shell wrapper; call the PHP entrypoint directly so it
    // runs under the project's PHP, not the VM's default `php`.
    return [
      { name: 'Drupal cache rebuild', cmd: `${phpBin(phpVersion)} vendor/drush/drush/drush.php cr || true`, cwd: '', runOn: ['checkout', 'sync'], location: 'vm' }
    ];
  },

  async install({ domain, projectPath, dbName, phpVersion, vm }) {
    // Imported/existing project: NEVER run site:install (it drops and recreates
    // the database) or overwrite settings.php. Leave it untouched.
    if (await this.detect(projectPath)) {
      return { success: true, changed: false, message: 'Existing Drupal project detected — left unchanged.' };
    }

    const created = await projectShell(vm, domain, composerCreateProject(phpVersion, 'drupal/recommended-project:^10'));
    if (!created.success) return created;
    const drush = await projectShell(vm, domain, composerCmd(phpVersion, 'require drush/drush --no-interaction'));
    if (!drush.success) return drush;

    const config = await this.writeDbConfig({ projectPath, dbName });
    if (!config.success) return config;

    const installed = await projectShell(
      vm,
      domain,
      `${phpBin(phpVersion)} vendor/drush/drush/drush.php site:install standard --db-url=${vm.shellQuote(mysqlUrl({ dbName }))} --site-name=${vm.shellQuote(domain)} --account-name=admin --account-pass=${vm.shellQuote('admin')} -y`
    );
    if (!installed.success) return installed;

    return { success: true, changed: true, message: 'Drupal is ready.' };
  },

  // Point an imported Drupal at the local DB and trust any local host. Drupal
  // uses relative URLs, so no domain search-replace is needed.
  async localize({ projectPath, dbName }) {
    const steps = [];
    const webDir = path.join(projectPath, 'web', 'sites', 'default');
    const rootDir = path.join(projectPath, 'sites', 'default');
    const dir = await exists(path.join(webDir, 'settings.php')) ? webDir : rootDir;
    const settings = path.join(dir, 'settings.php');
    const existing = await fs.readFile(settings, 'utf8').catch(() => '');
    const prefix = (existing.match(/'prefix'\s*=>\s*'([^']*)'/) || [])[1] || '';
    const namespace = (existing.match(/'namespace'\s*=>\s*'([^']+)'/) || [])[1] || 'Drupal\\\\mysql\\\\Driver\\\\Database\\\\mysql';
    const override = `
${OVERRIDE_START}
$databases['default']['default'] = [
  'database' => '${phpString(dbName)}',
  'username' => 'root',
  'password' => 'root',
  'host' => 'localhost',
  'port' => '3306',
  'prefix' => '${phpString(prefix)}',
  'namespace' => '${phpString(namespace)}',
  'driver' => 'mysql',
];
$settings['trusted_host_patterns'] = ['.*'];
${OVERRIDE_END}
`;
    // Drupal hardens sites/default to read-only after install; make it writable
    // on the host mount before appending.
    await fs.chmod(dir, 0o755).catch(() => {});
    await fs.chmod(settings, 0o644).catch(() => {});
    const escapedStart = OVERRIDE_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = OVERRIDE_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockRe = new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, 'g');
    await fs.writeFile(settings, `${existing.replace(blockRe, '').replace(/\s*$/, '\n')}${override}`, 'utf8');
    steps.push({ name: 'drupal config', success: true, message: 'Local DB override appended to settings.php.' });
    return { success: true, steps };
  }
};
