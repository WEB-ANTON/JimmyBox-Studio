const fs = require('fs/promises');
const path = require('path');
const {
  exists,
  guestProjectPath,
  phpBin,
  phpString,
  randomSecret,
  writeFileIfMissing
} = require('../helpers');
const domainAliases = require('../../projects/domain-aliases');

const PLUGIN_RE = /^[A-Za-z0-9_-]+$/;
const URL_BLOCK_START = '// >>> JimmyBox Studio local URL override >>>';
const URL_BLOCK_END = '// <<< JimmyBox Studio local URL override <<<';

function parsePlugins(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function localUrlBlock(domain) {
  const fallback = phpString(domainAliases.canonicalProjectDomain(domain || 'example.test'));
  return `${URL_BLOCK_START}
$jimmybox_host = isset($_SERVER['HTTP_HOST']) ? strtolower(preg_replace('/:\\d+$/', '', $_SERVER['HTTP_HOST'])) : '${fallback}';
if (!preg_match('/^[a-z0-9._-]+$/', $jimmybox_host)) {
    $jimmybox_host = '${fallback}';
}
$jimmybox_url = 'https://' . $jimmybox_host;
if (!defined('WP_HOME')) {
    define('WP_HOME', $jimmybox_url);
}
if (!defined('WP_SITEURL')) {
    define('WP_SITEURL', $jimmybox_url);
}
${URL_BLOCK_END}
`;
}

async function upsertLocalUrlBlock(configPath, domain) {
  const block = localUrlBlock(domain);
  let content = await fs.readFile(configPath, 'utf8');
  const escapedStart = URL_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = URL_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`);
  if (blockRe.test(content)) {
    content = content.replace(blockRe, block);
  } else {
    const markers = [
      "/* That's all, stop editing!",
      '/** Absolute path to the WordPress directory. */',
      "if ( ! defined( 'ABSPATH' ) )",
      "if (!defined('ABSPATH'))"
    ];
    const index = markers.map((marker) => content.indexOf(marker)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (Number.isInteger(index)) {
      content = `${content.slice(0, index).replace(/\s*$/, '\n\n')}${block}\n${content.slice(index)}`;
    } else {
      content = `${content.replace(/\s*$/, '\n\n')}${block}\n`;
    }
  }
  await fs.writeFile(configPath, content, 'utf8');
  return { success: true, changed: true };
}

function wpConfig(dbName, domain) {
  const secrets = {
    AUTH_KEY: randomSecret(48),
    SECURE_AUTH_KEY: randomSecret(48),
    LOGGED_IN_KEY: randomSecret(48),
    NONCE_KEY: randomSecret(48),
    AUTH_SALT: randomSecret(48),
    SECURE_AUTH_SALT: randomSecret(48),
    LOGGED_IN_SALT: randomSecret(48),
    NONCE_SALT: randomSecret(48)
  };

  return `<?php
define('DB_NAME', '${phpString(dbName)}');
define('DB_USER', 'root');
define('DB_PASSWORD', 'root');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

define('AUTH_KEY', '${phpString(secrets.AUTH_KEY)}');
define('SECURE_AUTH_KEY', '${phpString(secrets.SECURE_AUTH_KEY)}');
define('LOGGED_IN_KEY', '${phpString(secrets.LOGGED_IN_KEY)}');
define('NONCE_KEY', '${phpString(secrets.NONCE_KEY)}');
define('AUTH_SALT', '${phpString(secrets.AUTH_SALT)}');
define('SECURE_AUTH_SALT', '${phpString(secrets.SECURE_AUTH_SALT)}');
define('LOGGED_IN_SALT', '${phpString(secrets.LOGGED_IN_SALT)}');
define('NONCE_SALT', '${phpString(secrets.NONCE_SALT)}');

$table_prefix = 'wp_';

define('WP_DEBUG', true);

${localUrlBlock(domain)}

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}

require_once ABSPATH . 'wp-settings.php';
`;
}

async function installPlugin({ domain, slug, vm }) {
  if (!PLUGIN_RE.test(slug)) return { success: false, message: `Invalid plugin slug: ${slug}` };
  const pluginsDir = `${guestProjectPath(domain)}/public/wp-content/plugins`;
  const pluginDir = `${pluginsDir}/${slug}`;
  const check = await vm.shell(`test -d ${vm.shellQuote(pluginDir)} && echo yes || echo no`);
  if (check.success && check.stdout.trim().endsWith('yes')) {
    return { success: true, changed: false, message: `Plugin ${slug} already installed.` };
  }

  return vm.shell([
    'tmp="$(mktemp -d)"',
    `curl -fsSL -o "$tmp/plugin.zip" ${vm.shellQuote(`https://downloads.wordpress.org/plugin/${slug}.zip`)}`,
    `unzip -q "$tmp/plugin.zip" -d ${vm.shellQuote(pluginsDir)}`,
    'rm -rf "$tmp"'
  ].join(' && '));
}

module.exports = {
  id: 'wordpress',
  label: 'WordPress',
  docroot: 'public',
  mediaPaths: ['public/wp-content/uploads'],
  phpRange: '>=7.4',
  recommendedPhpVersion: '8.2',
  phpExtensions: ['curl', 'gd', 'intl', 'mbstring', 'mysqli', 'xml', 'zip'],

  async detect(projectPath) {
    return (await exists(path.join(projectPath, 'public', 'wp-load.php'))) ||
      (await exists(path.join(projectPath, 'wp-load.php')));
  },

  async writeDbConfig({ projectPath, dbName, domain }) {
    return writeFileIfMissing(path.join(projectPath, 'public', 'wp-config.php'), wpConfig(dbName, domain));
  },

  async setupRoutines({ phpVersion } = {}) {
    return [
      { name: 'wp cache flush', cmd: `${phpBin(phpVersion)} "$(command -v wp)" cache flush || true`, cwd: 'public', runOn: ['checkout'], location: 'vm' }
    ];
  },

  async install({ domain, projectPath, dbName, vm, basePlugins }) {
    // Imported/existing project: leave core files, wp-config.php and content
    // untouched (don't re-download or re-add base plugins).
    if (await this.detect(projectPath)) {
      return { success: true, changed: false, message: 'Existing WordPress project detected — left unchanged.' };
    }

    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    const publicDir = `${guestProjectPath(domain)}/public`;
    const check = await vm.shell(`test -f ${vm.shellQuote(`${publicDir}/wp-load.php`)} && echo yes || echo no`);
    const alreadyInstalled = check.success && check.stdout.trim().endsWith('yes');

    if (!alreadyInstalled) {
      const downloaded = await vm.shell([
        'tmp="$(mktemp -d)"',
        'curl -fsSL -o "$tmp/wordpress.zip" https://wordpress.org/latest.zip',
        'unzip -q "$tmp/wordpress.zip" -d "$tmp"',
        `cp -R "$tmp/wordpress/." ${vm.shellQuote(publicDir)}`,
        'rm -rf "$tmp"'
      ].join(' && '));
      if (!downloaded.success) return downloaded;
    }

    const config = await this.writeDbConfig({ projectPath, dbName, domain });
    if (!config.success) return config;

    for (const slug of parsePlugins(basePlugins)) {
      const plugin = await installPlugin({ domain, slug, vm });
      if (!plugin.success) return plugin;
    }

    return { success: true, changed: !alreadyInstalled || config.changed, message: 'WordPress is ready.' };
  },

  // Point wp-config at the local DB and otherwise leave the database exactly as
  // it came from production. Local WP_HOME/WP_SITEURL are derived from the
  // current HTTPS host, so apex and www aliases both work without DB rewrites.
  async localize({ projectPath, domain, docroot, dbName, phpVersion, vm }) {
    const steps = [];
    const guestDocroot = `/var/www/sites/${domain}/${docroot || 'public'}`;
    const wpcli = '/usr/local/bin/wp';
    const ensure = await vm.shell(`test -x ${wpcli} || (sudo curl -fsSL -o ${wpcli} https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && sudo chmod +x ${wpcli})`);
    if (!ensure.success) return { success: false, message: `wp-cli install failed: ${ensure.message}`, steps };
    const wp = `${phpBin(phpVersion)} ${wpcli} --allow-root --path=${vm.shellQuote(guestDocroot)}`;

    const cfg = await vm.shell(`${wp} config set DB_NAME ${vm.shellQuote(dbName)} && ${wp} config set DB_USER root && ${wp} config set DB_PASSWORD root && ${wp} config set DB_HOST localhost`);
    steps.push({ name: 'wp-config', success: cfg.success, message: cfg.success ? 'wp-config.php pointed at the local database (URLs kept identical to production).' : cfg.message });
    if (!cfg.success) return { success: false, message: cfg.message, steps };
    const docrootConfig = path.join(projectPath, docroot || 'public', 'wp-config.php');
    const rootConfig = path.join(projectPath, 'wp-config.php');
    const configPath = await exists(docrootConfig) ? docrootConfig : rootConfig;
    const localUrls = await upsertLocalUrlBlock(configPath, domain);
    steps.push({ name: 'wp local urls', success: localUrls.success, message: 'WordPress will use the current HTTPS host locally.' });
    return { success: true, steps };
  }
};
