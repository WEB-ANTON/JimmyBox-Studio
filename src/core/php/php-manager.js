const vm = require('../vm/lima');

const VERSION_RE = /^\d+\.\d+$/;

// Detect the PHP-FPM versions actually installed in the VM by listing the fpm
// sockets. This is what feeds every PHP dropdown, so adding a version never
// needs an app update — install it and it shows up.
async function listVersions() {
  const result = await vm.shell(
    "ls -1 /run/php/ 2>/dev/null | grep -E '^php[0-9]+\\.[0-9]+-fpm\\.sock$' | sed -E 's/^php([0-9]+\\.[0-9]+)-fpm\\.sock$/\\1/' | sort -Vr"
  );
  if (!result.success) return result;

  const versions = result.stdout
    .split('\n')
    .map((v) => v.trim())
    .filter((v) => VERSION_RE.test(v));

  return { success: true, versions };
}

// Install a PHP version from the ondrej PPA (already added during provisioning).
// Idempotent: apt is a no-op if the packages are already present.
async function installVersion(version) {
  const v = String(version || '').trim();
  if (!VERSION_RE.test(v)) {
    return { success: false, message: 'PHP version must look like "8.4".' };
  }

  const packages = ['', '-fpm', '-cli', '-common', '-curl', '-gd', '-intl', '-mbstring', '-mysql', '-opcache', '-xml', '-zip']
    .map((suffix) => `php${v}${suffix}`)
    .join(' ');

  const command = [
    'export DEBIAN_FRONTEND=noninteractive',
    'sudo apt-get update -qq',
    `sudo apt-get install -y ${packages}`,
    `sudo a2enconf php${v}-fpm >/dev/null 2>&1 || true`,
    `sudo systemctl enable --now php${v}-fpm`,
    'sudo systemctl reload apache2'
  ].join(' && ');

  const result = await vm.shell(command);
  if (!result.success) {
    return {
      success: false,
      message: `Could not install PHP ${v} (is it offered by the ondrej PPA for Ubuntu 22.04?): ${result.message}`
    };
  }

  return { success: true, message: `PHP ${v} installed and enabled.` };
}

module.exports = { listVersions, installVersion };
