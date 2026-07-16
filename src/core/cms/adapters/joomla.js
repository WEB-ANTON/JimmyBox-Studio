const fs = require('fs/promises');
const path = require('path');
const { exists, guestProjectPath, phpBin, projectShell } = require('../helpers');

function phpSingle(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function upsertConfigProperty(content, prop, value) {
  const re = new RegExp(`\\b(public|var)\\s+\\$${prop}\\s*=\\s*(?:'[^']*'|"[^"]*"|[^;]*);`);
  const replacement = (match, visibility) => `${visibility} $${prop} = ${phpSingle(value)};`;
  if (re.test(content)) return content.replace(re, replacement);
  return content.replace(/}\s*$/, `    public $${prop} = ${phpSingle(value)};\n}\n`);
}

module.exports = {
  id: 'joomla',
  label: 'Joomla',
  docroot: 'public',
  mediaPaths: ['public/images'],
  phpRange: '>=7.4',
  recommendedPhpVersion: '8.3',
  installPhpMin: '8.3',
  phpExtensions: ['curl', 'gd', 'intl', 'mbstring', 'mysqli', 'xml', 'zip'],

  async detect(projectPath) {
    return (await exists(path.join(projectPath, 'public', 'configuration.php'))) ||
      (await exists(path.join(projectPath, 'configuration.php')));
  },

  async writeDbConfig() {
    return { success: true, changed: false, message: 'Joomla writes configuration.php during CLI install.' };
  },

  async setupRoutines({ phpVersion } = {}) {
    return [
      { name: 'Joomla cache clean', cmd: `${phpBin(phpVersion)} cli/joomla.php cache:clean || true`, cwd: 'public', runOn: ['checkout', 'sync'], location: 'vm' }
    ];
  },

  async install({ domain, projectPath, dbName, phpVersion, vm }) {
    // Imported/existing project: don't re-download or re-run the installer
    // (Joomla removes installation/ after setup, so a re-run fails anyway).
    if (await this.detect(projectPath)) {
      return { success: true, changed: false, message: 'Existing Joomla project detected — left unchanged.' };
    }

    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    if (!(await this.detect(projectPath))) {
      const publicDir = `${guestProjectPath(domain)}/public`;
      const downloaded = await vm.shell([
        'tmp="$(mktemp -d)"',
        // The GitHub "latest" asset name is version-specific, so resolve the
        // current full-package zip URL from the releases API instead of guessing.
        `url="$(curl -fsSL https://api.github.com/repos/joomla/joomla-cms/releases/latest | grep -oE 'https://[^"]*Stable-Full_Package.zip' | head -1)"`,
        'test -n "$url"',
        'curl -fL -o "$tmp/joomla.zip" "$url"',
        `unzip -q "$tmp/joomla.zip" -d ${vm.shellQuote(publicDir)}`,
        'rm -rf "$tmp"'
      ].join(' && '));
      if (!downloaded.success) return downloaded;
    }

    const install = await projectShell(
      vm,
      domain,
      `cd public && ${phpBin(phpVersion)} installation/joomla.php install --site-name=${vm.shellQuote(domain)} ` +
        `--admin-user=admin --admin-username=admin --admin-password=${vm.shellQuote('Studio.admin1')} --admin-email=admin@example.test ` +
        '--db-type=mysqli --db-host=localhost --db-user=root --db-pass=root ' +
        `--db-name=${vm.shellQuote(dbName)} --db-prefix=jbx_ --no-interaction`
    );
    if (!install.success) return install;

    return { success: true, changed: true, message: 'Joomla is ready.' };
  },

  // Point an imported Joomla at the local DB (keep the dump's table prefix) and
  // clear $live_site so it uses the local host. URLs are otherwise relative.
  async localize({ projectPath, dbName, docroot }) {
    const steps = [];
    const configPath = path.join(projectPath, docroot || 'public', 'configuration.php');
    let content = await fs.readFile(configPath, 'utf8');
    content = upsertConfigProperty(content, 'db', dbName);
    content = upsertConfigProperty(content, 'user', 'root');
    content = upsertConfigProperty(content, 'password', 'root');
    content = upsertConfigProperty(content, 'host', 'localhost');
    content = upsertConfigProperty(content, 'live_site', '');
    await fs.writeFile(configPath, content, 'utf8');
    steps.push({ name: 'joomla config', success: true, message: 'configuration.php pointed at the local database.' });
    return { success: true, steps };
  }
};
