const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const indexHtml = read('src/index.html');
const renderer = read('src/renderer.js');
const i18n = read('src/i18n.js');
const tray = read('src/tray.js');
const readme = read('README.md');
const support = read('SUPPORT.md');
const releaseTemplate = read('.github/release-template.md');
const releaseProcess = read('docs/RELEASE.md');
const bugReportTemplate = read('.github/ISSUE_TEMPLATE/bug_report.yml');
const featureRequestTemplate = read('.github/ISSUE_TEMPLATE/feature_request.yml');
const fetchLima = read('scripts/fetch-lima.sh');
const preload = read('preload.js');
const main = read('main.js');
const pkg = JSON.parse(read('package.json'));

test('solo release does not expose Team or Hub entry points', () => {
  for (const htmlNeedle of [
    'id="hub-status"',
    'id="team-tab-button"'
  ]) {
    assert.doesNotMatch(indexHtml, new RegExp(htmlNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${htmlNeedle} is not rendered`);
  }

  assert.doesNotMatch(preload, /\bteam\s*:/, 'preload exposes no team API');
  assert.doesNotMatch(main, /registerTeamIpc|teamTunnel|team\.ipc|ssh-tunnel/, 'main process does not register team IPC or tunnel shutdown');
  assert.doesNotMatch(pkg.scripts.test, /hub\/test/, 'test script excludes Hub suites');
  assert.equal(pkg.scripts.hub, undefined);
  assert.equal(pkg.scripts['hub:test'], undefined);
});

test('solo public copy avoids Team-only placeholders and release guidance', () => {
  assert.doesNotMatch(indexHtml, /Team hosts|Team-Hosts/, 'hosts UI uses neutral remote-list wording');
  assert.doesNotMatch(i18n, /Team hosts|Team-Hosts/, 'translated hosts placeholders use neutral wording');
  assert.doesNotMatch(support, /Team Mode|Team Hub/, 'support diagnostics stay Solo-focused');
  assert.doesNotMatch(releaseTemplate, /Team Mode|Team Hub|Hub support/, 'release template stays Solo-focused');
  assert.doesNotMatch(releaseProcess, /\binternal\b.*\bplanning\b/i, 'release checklist avoids internal-only planning language');
  assert.doesNotMatch(readme, /\binternal\b.*\bplanning\b/i, 'README checklist avoids internal-only planning language');
  assert.doesNotMatch(bugReportTemplate, /Team Mode|Hub/, 'bug report areas stay Solo-focused');
  assert.doesNotMatch(featureRequestTemplate, /Team Mode|Hub/, 'feature request areas stay Solo-focused');
});

test('repeated host and tray toggles expose accessible state and context', () => {
  assert.match(renderer, /aria-pressed="\$\{enabled \? 'true' : 'false'\}"/, 'host toggles expose aria-pressed');
  assert.match(renderer, /aria-label="\$\{escapeHtml\(ariaLabel\)\}"/, 'host toggles expose contextual aria-label');
  assert.match(tray, /role="switch"/, 'tray host rows use switch semantics');
  assert.match(tray, /aria-checked="\$\{enabled \? 'true' : 'false'\}"/, 'tray rows expose checked state');
});

test('empty SQL, PHP install, and checkpoint actions report user-visible messages', () => {
  for (const key of ['db.needDatabase', 'db.needQuery', 'php.needVersion', 'history.needProject', 'history.needMessage']) {
    assert.match(i18n, new RegExp(`'${key}'`), `${key} translation exists`);
  }
  assert.match(renderer, /setMessage\(t\('db\.needQuery'\), true\)/, 'empty SQL shows a message');
  assert.match(renderer, /setMessage\(t\('php\.needVersion'\), true\)/, 'empty PHP install shows a message');
  assert.match(renderer, /setMessage\(t\('history\.needProject'\), true\)/, 'empty checkpoint project shows a message');
  assert.match(renderer, /setMessage\(t\('history\.needMessage'\), true\)/, 'empty checkpoint message shows a message');
});

test('VM controls include action context for non-obvious operations', () => {
  for (const key of ['vm.startHelp', 'vm.stopHelp', 'vm.provisionHelp']) {
    assert.match(i18n, new RegExp(`'${key}'`), `${key} translation exists`);
  }
  assert.match(indexHtml, /id="vm-start"[^>]+data-i18n-title="vm\.startHelp"/, 'Start button has translated help');
  assert.match(indexHtml, /id="vm-stop"[^>]+data-i18n-title="vm\.stopHelp"/, 'Stop button has translated help');
  assert.match(indexHtml, /id="vm-provision"[^>]+data-i18n-title="vm\.provisionHelp"/, 'Provision button has translated help');
});

test('project form guides CMS-specific PHP selection', () => {
  assert.match(indexHtml, /id="project-php-hint"/, 'project PHP hint exists');
  assert.match(i18n, /'proj\.phpRecommended'/, 'project PHP recommendation copy exists');
  assert.match(renderer, /function updateProjectPhpRecommendation\(force = false\)/, 'renderer updates CMS PHP recommendation');
  assert.match(renderer, /projectCms\.addEventListener\('change'/, 'CMS changes trigger PHP recommendation');
});

test('Lima fetch script defaults to the current macOS CPU architecture', () => {
  assert.doesNotMatch(fetchLima, /LIMA_ARCH:-arm64/, 'script must not default every Mac to arm64');
  assert.match(fetchLima, /uname -m/, 'script detects the current host architecture');
});

test('release docs expose quickstart, FAQ, and release checklist', () => {
  for (const heading of ['## Release Status', '## Quickstart', '## FAQ']) {
    assert.match(readme, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${heading} exists`);
  }
});

test('German UI copy avoids stale mixed-language labels', () => {
  for (const stale of [
    'Verlauf / History',
    'FAQ & Anleitung',
    'Auschecken & Starten',
    'Keine Users',
    'Media pullen',
    'Media pushen',
    'restoren',
    'Nächste(n)',
    'SSH-User'
  ]) {
    assert.doesNotMatch(`${indexHtml}\n${i18n}`, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${stale} is no longer used`);
  }
});
