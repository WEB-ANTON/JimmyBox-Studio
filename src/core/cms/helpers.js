const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

function phpString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (_error) {
    return false;
  }
}

async function writeFileIfMissing(target, content) {
  if (await exists(target)) return { success: true, changed: false };
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return { success: true, changed: true };
}

function guestProjectPath(domain) {
  return `/var/www/sites/${domain}`;
}

function projectShell(vm, domain, command) {
  return vm.shell(`cd ${vm.shellQuote(guestProjectPath(domain))} && ${command}`);
}

function mysqlUrl({ dbName, dbUser = 'root', dbPass = 'root', dbHost = 'localhost' }) {
  return `mysql://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPass)}@${dbHost}/${encodeURIComponent(dbName)}`;
}

// The project's chosen PHP CLI (e.g. `php8.3`). The VM's default `php` can be a
// very new build (e.g. 8.5) that the packaged composer/symfony libs crash on, or
// a version missing extensions; the per-project PHP is always fully provisioned.
function phpBin(phpVersion) {
  return /^\d+\.\d+$/.test(String(phpVersion || '')) ? `php${phpVersion}` : 'php';
}

// Run the distro composer explicitly under the project's PHP version.
function composerCmd(phpVersion, args) {
  return `${phpBin(phpVersion)} "$(command -v composer)" ${args}`;
}

// `composer create-project` refuses a non-empty target, but our project folder
// already contains public/ (docroot) and .jimmybox-studio/ (SSL, metadata). So
// scaffold into a temp dir and copy the result in over the existing folder.
function composerCreateProject(phpVersion, pkg) {
  return `tmp="$(mktemp -d)" && ${phpBin(phpVersion)} "$(command -v composer)" create-project ${pkg} "$tmp" --no-interaction && cp -a "$tmp/." . && rm -rf "$tmp"`;
}

module.exports = {
  composerCmd,
  composerCreateProject,
  exists,
  guestProjectPath,
  mysqlUrl,
  phpBin,
  phpString,
  projectShell,
  randomSecret,
  writeFileIfMissing
};
