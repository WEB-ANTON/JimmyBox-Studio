const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { app } = require('electron');
const domainAliases = require('../projects/domain-aliases');

const execFileAsync = promisify(execFile);

const HOSTS_PATH = '/etc/hosts';
const START_MARKER = '# >>> JIMMYBOX STUDIO >>>';
const END_MARKER = '# <<< JIMMYBOX STUDIO <<<';
const HELPER_VERSION = '1';
const HELPER_PATH = '/Library/PrivilegedHelperTools/at.webanton.jimmybox-studio.hosts-helper';
const SUDOERS_PATH = '/etc/sudoers.d/jimmybox-studio-hosts';
const DEFAULT_GROUP = 'Default';
const PROJECT_GROUP_PREFIX = 'project:';
const DOMAIN_RE = domainAliases.DOMAIN_RE;
const IPV4_RE = /^(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(\.(25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}$/;
const REMOTE_FETCH_TIMEOUT_MS = 15000;
const REMOTE_MAX_BYTES = 1024 * 1024;

let modelCache = null;
let helperReady = false;

function modelPath() {
  return path.join(app.getPath('userData'), 'hosts-model.json');
}

function newId() {
  return crypto.randomUUID();
}

function blankModel() {
  return {
    groups: [{ id: newId(), name: DEFAULT_GROUP, enabled: true, entries: [] }],
    remotes: []
  };
}

function sanitizeRemoteName(value, fallback = 'Remote hosts') {
  const markerSafe = String(value || fallback || 'Remote hosts')
    .split(START_MARKER).join('')
    .split(END_MARKER).join('');
  const clean = markerSafe
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean) return clean;
  return fallback === 'Remote hosts' ? fallback : sanitizeRemoteName(fallback, 'Remote hosts');
}

function sanitizeModel(raw) {
  const model = raw && typeof raw === 'object' ? raw : {};
  const groups = Array.isArray(model.groups) ? model.groups : [];
  const remotes = Array.isArray(model.remotes) ? model.remotes : [];

  const cleanGroups = groups.map((group) => ({
    id: group.id || newId(),
    name: String(group.name || DEFAULT_GROUP),
    projectDomain: group.projectDomain && DOMAIN_RE.test(String(group.projectDomain)) ? String(group.projectDomain) : null,
    enabled: group.enabled !== false,
    entries: (Array.isArray(group.entries) ? group.entries : [])
    .filter((entry) => entry && IPV4_RE.test(String(entry.ip)) && DOMAIN_RE.test(String(entry.domain)))
      .map((entry) => ({
        id: entry.id || newId(),
        ip: String(entry.ip),
        domain: String(entry.domain),
        enabled: entry.enabled !== false
      }))
  }));

  if (cleanGroups.length === 0) {
    cleanGroups.push({ id: newId(), name: DEFAULT_GROUP, enabled: true, entries: [] });
  }

  const cleanRemotes = remotes
    .filter((remote) => remote && /^https?:\/\//i.test(String(remote.url)))
    .map((remote) => ({
      id: remote.id || newId(),
      name: sanitizeRemoteName(remote.name, remote.url),
      url: String(remote.url),
      enabled: remote.enabled !== false,
      refreshMinutes: Number.isFinite(remote.refreshMinutes) ? remote.refreshMinutes : 0,
      content: typeof remote.content === 'string' ? remote.content : '',
      lastFetched: remote.lastFetched || null
    }));

  return { groups: cleanGroups, remotes: cleanRemotes };
}

async function migrateExistingBlock(model) {
  try {
    const content = await fs.readFile(HOSTS_PATH, 'utf8');
    const start = content.indexOf(START_MARKER);
    const end = content.indexOf(END_MARKER);
    if (start === -1 || end === -1 || end < start) return model;

    const group = model.groups[0];
    content
      .slice(start + START_MARKER.length, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const [ip, ...domains] = line.split(/\s+/);
        if (!IPV4_RE.test(ip)) return;
        for (const domain of domains) {
          if (DOMAIN_RE.test(domain) && !group.entries.some((e) => e.domain === domain)) {
            group.entries.push({ id: newId(), ip, domain, enabled: true });
          }
        }
      });
  } catch (_error) {
    /* hosts file unreadable — start clean */
  }
  return model;
}

async function loadModel() {
  if (modelCache) return modelCache;

  try {
    const raw = JSON.parse(await fs.readFile(modelPath(), 'utf8'));
    modelCache = sanitizeModel(raw);
  } catch (_error) {
    modelCache = await migrateExistingBlock(blankModel());
    await persist(modelCache);
  }

  return modelCache;
}

async function persist(model) {
  modelCache = model;
  await fs.mkdir(path.dirname(modelPath()), { recursive: true });
  await fs.writeFile(modelPath(), `${JSON.stringify(model, null, 2)}\n`, 'utf8');
}

function parseRemoteLines(content) {
  return String(content || '')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .filter((line) => IPV4_RE.test(line.split(/\s+/)[0]));
}

function pushHostLine(lines, seenDomains, rawLine) {
  const parts = String(rawLine || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return;

  const [ip, ...domains] = parts;
  const freshDomains = domains.filter((domain) => !seenDomains.has(domain));
  if (!freshDomains.length) return;

  freshDomains.forEach((domain) => seenDomains.add(domain));
  lines.push(`${ip}   ${freshDomains.join(' ')}`);
}

function renderActiveLines(model) {
  const lines = [];
  const seenDomains = new Set();

  for (const group of model.groups) {
    if (!group.enabled) continue;
    for (const entry of group.entries) {
      if (entry.enabled) pushHostLine(lines, seenDomains, `${entry.ip} ${entry.domain}`);
    }
  }

  for (const remote of model.remotes) {
    if (!remote.enabled || !remote.content) continue;
    const remoteLines = [];
    for (const line of parseRemoteLines(remote.content)) {
      pushHostLine(remoteLines, seenDomains, line);
    }
    if (remoteLines.length) {
      lines.push(`# ${remote.name}`);
      lines.push(...remoteLines);
    }
  }

  return lines;
}

function replaceBlock(content, blockLines) {
  const block = [START_MARKER, ...blockLines, END_MARKER].join('\n');
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);

  if (start === -1 && end === -1) {
    return `${content.replace(/\s*$/, '')}\n\n${block}\n`;
  }
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Existing JimmyBox Studio hosts block is malformed.');
  }

  const before = content.slice(0, start).replace(/\s*$/, '\n');
  const after = content.slice(end + END_MARKER.length).replace(/^\s*/, '\n');
  return `${before}${block}${after}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function helperScript() {
  return `#!/bin/sh
set -eu

VERSION="${HELPER_VERSION}"
HOSTS_PATH="/etc/hosts"
START_MARKER="${START_MARKER}"
END_MARKER="${END_MARKER}"
MAX_BYTES="${REMOTE_MAX_BYTES}"

if [ "\${1:-}" = "--check" ]; then
  echo "jimmybox-hosts-helper \${VERSION}"
  exit 0
fi

BLOCK_FILE="\${1:-}"
if [ -z "\${BLOCK_FILE}" ] || [ ! -f "\${BLOCK_FILE}" ]; then
  echo "Missing hosts block file." >&2
  exit 1
fi

if [ -n "\${SUDO_UID:-}" ]; then
  OWNER_UID="$(/usr/bin/stat -f '%u' "\${BLOCK_FILE}" 2>/dev/null || true)"
  if [ "\${OWNER_UID}" != "\${SUDO_UID}" ]; then
    echo "Hosts block must be owned by the invoking user." >&2
    exit 1
  fi
fi

SIZE="$(/usr/bin/wc -c < "\${BLOCK_FILE}" | /usr/bin/tr -d ' ')"
if [ "\${SIZE}" -gt "\${MAX_BYTES}" ]; then
  echo "Hosts block is too large." >&2
  exit 1
fi

/usr/bin/awk '
  BEGIN {
    ipv4 = "^([0-9]{1,3}\\\\.){3}[0-9]{1,3}$";
    domain = "^[A-Za-z0-9._-]+$";
  }
  /^[[:space:]]*$/ { next }
  /^[[:space:]]*#/ { next }
  {
    if (NF < 2 || $1 !~ ipv4) exit 2;
    split($1, octets, ".");
    for (i = 1; i <= 4; i++) {
      if (octets[i] < 0 || octets[i] > 255) exit 2;
    }
    for (i = 2; i <= NF; i++) {
      if ($i !~ domain) exit 2;
    }
  }
' "\${BLOCK_FILE}" || {
  echo "Hosts block contains invalid entries." >&2
  exit 1
}

/usr/bin/awk -v start="\${START_MARKER}" -v end="\${END_MARKER}" '
  $0 == start {
    if (seen_start || seen_end) bad = 1;
    seen_start = 1;
  }
  $0 == end {
    if (!seen_start || seen_end) bad = 1;
    seen_end = 1;
  }
  END {
    if (bad || seen_start != seen_end) exit 1;
  }
' "\${HOSTS_PATH}" || {
  echo "Existing JimmyBox hosts block is malformed." >&2
  exit 1
}

TMP="$(/usr/bin/mktemp /tmp/jimmybox-hosts.XXXXXX)"
trap '/bin/rm -f "\${TMP}"' EXIT

/usr/bin/awk -v start="\${START_MARKER}" -v end="\${END_MARKER}" -v block="\${BLOCK_FILE}" '
  function print_block() {
    print start;
    while ((getline line < block) > 0) print line;
    close(block);
    print end;
  }
  BEGIN { in_block = 0; done = 0 }
  $0 == start {
    if (!done) {
      print_block();
      done = 1;
    }
    in_block = 1;
    next;
  }
  $0 == end && in_block {
    in_block = 0;
    next;
  }
  !in_block { print }
  END {
    if (!done) {
      print "";
      print_block();
    }
  }
' "\${HOSTS_PATH}" > "\${TMP}"

/bin/chmod 0644 "\${TMP}"
/bin/cp "\${TMP}" "\${HOSTS_PATH}"
`;
}

function sudoersPrincipal() {
  const username = os.userInfo().username || '';
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    throw new Error(`Unsupported macOS username for hosts helper: ${username}`);
  }
  return username;
}

function isAuthorizationCancelled(error) {
  const text = `${error && error.message ? error.message : ''}\n${error && error.stderr ? error.stderr : ''}`;
  return /User canceled|-128/i.test(text);
}

async function isHostsHelperReady() {
  try {
    const result = await execFileAsync('sudo', ['-n', HELPER_PATH, '--check'], { timeout: 5000 });
    return String(result.stdout || '').trim() === `jimmybox-hosts-helper ${HELPER_VERSION}`;
  } catch (_error) {
    return false;
  }
}

async function installHostsHelper() {
  const tempHelperPath = path.join(os.tmpdir(), `jimmybox-studio-hosts-helper-${process.pid}-${Date.now()}.sh`);
  const tempSudoersPath = path.join(os.tmpdir(), `jimmybox-studio-hosts-sudoers-${process.pid}-${Date.now()}`);
  await fs.writeFile(tempHelperPath, helperScript(), { encoding: 'utf8', mode: 0o700 });

  try {
    const sudoersContent = [
      '# JimmyBox Studio hosts helper',
      `${sudoersPrincipal()} ALL=(root) NOPASSWD: ${HELPER_PATH} *`,
      ''
    ].join('\n');

    const command = [
      `/usr/bin/install -d -o root -g wheel -m 0755 ${shellQuote(path.dirname(HELPER_PATH))}`,
      `/usr/bin/install -o root -g wheel -m 0755 ${shellQuote(tempHelperPath)} ${shellQuote(HELPER_PATH)}`,
      `/usr/bin/printf %s ${shellQuote(sudoersContent)} > ${shellQuote(tempSudoersPath)}`,
      `/usr/sbin/visudo -cf ${shellQuote(tempSudoersPath)}`,
      `/bin/chmod 0440 ${shellQuote(tempSudoersPath)}`,
      `/bin/mv ${shellQuote(tempSudoersPath)} ${shellQuote(SUDOERS_PATH)}`
    ].join(' && ');

    await execFileAsync('osascript', [
      '-e',
      `do shell script ${JSON.stringify(command)} with administrator privileges`
    ], { timeout: 120000 });
  } finally {
    await fs.unlink(tempHelperPath).catch(() => {});
    await fs.unlink(tempSudoersPath).catch(() => {});
  }
}

async function ensureHostsHelperInstalled() {
  if (helperReady || await isHostsHelperReady()) {
    helperReady = true;
    return { success: true };
  }

  try {
    await installHostsHelper();
    helperReady = await isHostsHelperReady();
    if (!helperReady) {
      return { success: false, message: 'Hosts helper could not be verified after installation.' };
    }
    return { success: true };
  } catch (error) {
    if (isAuthorizationCancelled(error)) {
      return { success: false, cancelled: true, message: 'Hosts helper installation was cancelled.' };
    }
    return { success: false, message: error.message };
  }
}

async function writeHostsBlockWithHelper(blockLines) {
  const helper = await ensureHostsHelperInstalled();
  if (!helper.success) return helper;

  const tempPath = path.join(os.tmpdir(), `jimmybox-studio-hosts-block-${process.pid}-${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${blockLines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await execFileAsync('sudo', ['-n', HELPER_PATH, tempPath], { timeout: 15000 });
    return { success: true };
  } catch (error) {
    helperReady = false;
    return { success: false, message: error.message };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function writeHostsWithPrivilege(content) {
  const tempPath = path.join(os.tmpdir(), `jimmybox-studio-hosts-${process.pid}.tmp`);
  await fs.writeFile(tempPath, content, 'utf8');
  try {
    const command = `cat ${shellQuote(tempPath)} > ${shellQuote(HOSTS_PATH)}`;
    await execFileAsync('osascript', [
      '-e',
      `do shell script ${JSON.stringify(command)} with administrator privileges`
    ]);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function applyToSystem() {
  try {
    const model = await loadModel();
    const blockLines = renderActiveLines(model);
    const helper = await writeHostsBlockWithHelper(blockLines);
    if (helper.success) {
      return { success: true, message: 'System hosts file updated.' };
    }
    if (helper.cancelled) return helper;

    const content = await fs.readFile(HOSTS_PATH, 'utf8');
    const next = replaceBlock(content, blockLines);
    await writeHostsWithPrivilege(next);
    return { success: true, message: 'System hosts file updated.' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function getModel() {
  try {
    return { success: true, model: await loadModel() };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function findGroup(model, groupId) {
  const group = model.groups.find((item) => item.id === groupId);
  if (!group) throw new Error('Group not found.');
  return group;
}

async function mutate(fn) {
  try {
    const model = await loadModel();
    fn(model);
    await persist(model);
    return { success: true, model };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function addGroup(name) {
  return mutate((model) => {
    model.groups.push({ id: newId(), name: String(name || 'New group').trim() || 'New group', enabled: true, entries: [] });
  });
}

function renameGroup(groupId, name) {
  return mutate((model) => {
    findGroup(model, groupId).name = String(name || '').trim() || DEFAULT_GROUP;
  });
}

function toggleGroup(groupId, enabled) {
  return mutate((model) => {
    findGroup(model, groupId).enabled = Boolean(enabled);
  });
}

function removeGroup(groupId) {
  return mutate((model) => {
    model.groups = model.groups.filter((group) => group.id !== groupId);
    if (model.groups.length === 0) {
      model.groups.push({ id: newId(), name: DEFAULT_GROUP, enabled: true, entries: [] });
    }
  });
}

function addEntry(groupId, ip, domain) {
  return mutate((model) => {
    const cleanIp = String(ip || '127.0.0.1').trim();
    const cleanDomain = String(domain || '').trim();
    if (!IPV4_RE.test(cleanIp)) throw new Error(`Invalid IP address: ${cleanIp}`);
    if (!DOMAIN_RE.test(cleanDomain)) throw new Error(`Invalid domain: ${cleanDomain}`);

    const group = findGroup(model, groupId);
    if (!group.entries.some((entry) => entry.ip === cleanIp && entry.domain === cleanDomain)) {
      group.entries.push({ id: newId(), ip: cleanIp, domain: cleanDomain, enabled: true });
    }
  });
}

function findEntry(model, entryId) {
  for (const group of model.groups) {
    const entry = group.entries.find((item) => item.id === entryId);
    if (entry) return entry;
  }
  throw new Error('Entry not found.');
}

function toggleEntry(entryId, enabled) {
  return mutate((model) => {
    findEntry(model, entryId).enabled = Boolean(enabled);
  });
}

function setProjectEntriesEnabled(domains, enabled, ip = '127.0.0.1') {
  return mutate((model) => {
    const cleanDomains = Array.isArray(domains)
      ? domains.map((domain) => String(domain || '').trim()).filter(Boolean).map((domain) => domainAliases.hostFromInput(domain))
      : [];
    if (!cleanDomains.length) throw new Error('No project domains found.');
    if (enabled && !IPV4_RE.test(String(ip))) throw new Error(`Invalid IP address: ${ip}`);

    const uniqueDomains = [...new Set(cleanDomains)];
    const defaultGroup = model.groups.find((group) => group.name === DEFAULT_GROUP) || model.groups[0];
    if (enabled) defaultGroup.enabled = true;

    for (const domain of uniqueDomains) {
      if (!DOMAIN_RE.test(domain)) throw new Error(`Invalid domain: ${domain}`);

      let found = false;
      for (const group of model.groups) {
        for (const entry of group.entries) {
          if (entry.domain === domain) {
            found = true;
            entry.enabled = Boolean(enabled);
            if (enabled) {
              entry.ip = String(ip);
              group.enabled = true;
            }
          }
        }
      }

      if (!found && enabled) {
        defaultGroup.entries.push({ id: newId(), ip: String(ip), domain, enabled: true });
      }
    }
  }).then(async (result) => {
    if (!result.success) return result;
    const applied = await applyToSystem();
    return { ...applied, model: result.model };
  });
}

function upsertProjectGroup(domain, entries = []) {
  let cleanDomain;
  try {
    cleanDomain = domainAliases.canonicalProjectDomain(domain);
  } catch (error) {
    return Promise.resolve({ success: false, message: error.message || 'Invalid domain.' });
  }
  if (!DOMAIN_RE.test(cleanDomain)) {
    return Promise.resolve({ success: false, message: `Invalid domain: ${cleanDomain}` });
  }

  return mutate((model) => {
    const sourceEntries = Array.isArray(entries) && entries.length
      ? entries
      : domainAliases.aliasHosts(cleanDomain);
    const cleanEntries = sourceEntries.map((entry) => {
      const cleanIp = String(entry && entry.ip ? entry.ip : '127.0.0.1').trim();
      const entryDomain = domainAliases.hostFromInput(entry && entry.domain ? entry.domain : cleanDomain);
      if (!IPV4_RE.test(cleanIp)) throw new Error(`Invalid IP address: ${cleanIp}`);
      if (!DOMAIN_RE.test(entryDomain)) throw new Error(`Invalid domain: ${entryDomain}`);
      return {
        id: newId(),
        ip: cleanIp,
        domain: entryDomain,
        enabled: !entry || entry.enabled !== false
      };
    });

    const groupName = `${PROJECT_GROUP_PREFIX}${cleanDomain}`;
    let group = model.groups.find((item) => item.projectDomain === cleanDomain || item.name === groupName);
    if (!group) {
      group = { id: newId(), name: groupName, projectDomain: cleanDomain, enabled: true, entries: [] };
      model.groups.push(group);
    }
    const projectDomains = new Set(cleanEntries.map((entry) => entry.domain));
    for (const otherGroup of model.groups) {
      if (otherGroup === group) continue;
      otherGroup.entries = otherGroup.entries.filter((entry) => !projectDomains.has(entry.domain));
    }
    group.name = groupName;
    group.projectDomain = cleanDomain;
    group.enabled = true;
    group.entries = cleanEntries;
  }).then(async (result) => {
    if (!result.success) return result;
    const applied = await applyToSystem();
    return { ...applied, model: result.model };
  });
}

function removeProjectGroup(domain) {
  const cleanDomain = domainAliases.canonicalProjectDomain(domain);
  if (!DOMAIN_RE.test(cleanDomain)) {
    return Promise.resolve({ success: false, message: `Invalid domain: ${cleanDomain}` });
  }
  const variants = new Set([cleanDomain, ...domainAliases.projectAliases(cleanDomain)]);

  return mutate((model) => {
    model.groups = model.groups.filter((group) => {
      const projectDomain = group.projectDomain ? String(group.projectDomain) : '';
      const groupProject = group.name && group.name.startsWith(PROJECT_GROUP_PREFIX)
        ? group.name.slice(PROJECT_GROUP_PREFIX.length)
        : '';
      return !variants.has(projectDomain) && !variants.has(groupProject);
    });
    if (model.groups.length === 0) {
      model.groups.push({ id: newId(), name: DEFAULT_GROUP, projectDomain: null, enabled: true, entries: [] });
    }
  }).then(async (result) => {
    if (!result.success) return result;
    const applied = await applyToSystem();
    return { ...applied, model: result.model };
  });
}

function removeEntry(entryId) {
  return mutate((model) => {
    for (const group of model.groups) {
      group.entries = group.entries.filter((entry) => entry.id !== entryId);
    }
  });
}

function addRemote(name, url, refreshMinutes) {
  return mutate((model) => {
    const cleanUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(cleanUrl)) throw new Error('Remote URL must start with http:// or https://');
    model.remotes.push({
      id: newId(),
      name: sanitizeRemoteName(name, cleanUrl),
      url: cleanUrl,
      enabled: true,
      refreshMinutes: Number(refreshMinutes) > 0 ? Number(refreshMinutes) : 0,
      content: '',
      lastFetched: null
    });
  });
}

function toggleRemote(remoteId, enabled) {
  return mutate((model) => {
    const remote = model.remotes.find((item) => item.id === remoteId);
    if (!remote) throw new Error('Remote not found.');
    remote.enabled = Boolean(enabled);
  });
}

function removeRemote(remoteId) {
  return mutate((model) => {
    model.remotes = model.remotes.filter((remote) => remote.id !== remoteId);
  });
}

async function readRemoteText(response, maxBytes = REMOTE_MAX_BYTES) {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('Remote hosts list is too large.');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('Remote hosts list is too large.');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function refreshRemote(remoteId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);

  try {
    const model = await loadModel();
    const remote = model.remotes.find((item) => item.id === remoteId);
    if (!remote) throw new Error('Remote not found.');

    const response = await fetch(remote.url, {
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Remote returned HTTP ${response.status}.`);

    remote.content = await readRemoteText(response);
    remote.lastFetched = new Date().toISOString();
    await persist(model);
    return { success: true, model };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, message: 'Remote hosts list timed out.' };
    }
    return { success: false, message: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function readEntries() {
  try {
    const model = await loadModel();
    const entries = [];
    const seenDomains = new Set();
    for (const group of model.groups) {
      if (!group.enabled) continue;
      for (const entry of group.entries) {
        if (!entry.enabled || seenDomains.has(entry.domain)) continue;
        seenDomains.add(entry.domain);
        entries.push({ ip: entry.ip, domain: entry.domain });
      }
    }
    return { success: true, entries };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function addProjectEntry(domain, ip = '127.0.0.1') {
  const cleanDomain = domainAliases.canonicalProjectDomain(domain);
  if (!DOMAIN_RE.test(cleanDomain)) {
    return { success: false, message: `Invalid domain: ${domain}` };
  }
  const wanted = domainAliases.projectAliases(cleanDomain);
  const model = await loadModel();
  const groupName = `${PROJECT_GROUP_PREFIX}${cleanDomain}`;
  let group = model.groups.find((item) => item.projectDomain === cleanDomain || item.name === groupName);
  if (!group) {
    group = { id: newId(), name: groupName, projectDomain: cleanDomain, enabled: true, entries: [] };
    model.groups.push(group);
  }
  const projectDomains = new Set(wanted);
  for (const otherGroup of model.groups) {
    if (otherGroup === group) continue;
    otherGroup.entries = otherGroup.entries.filter((entry) => !projectDomains.has(entry.domain));
  }
  group.name = groupName;
  group.projectDomain = cleanDomain;
  group.enabled = true;
  group.entries = domainAliases.aliasHosts(cleanDomain, ip);
  await persist(model);

  // If the domain is already active in /etc/hosts, skip the privileged write
  // (no needless password prompt). Otherwise apply so the site resolves.
  try {
    const content = await fs.readFile(HOSTS_PATH, 'utf8');
    const s = content.indexOf(START_MARKER);
    const e = content.indexOf(END_MARKER);
    if (s !== -1 && e !== -1) {
      const active = wanted.every((host) => content.slice(s, e).split('\n').some((l) => {
        const parts = l.trim().split(/\s+/);
        return parts[0] === ip && parts[1] === host;
      }));
      if (active) return { success: true, changed: false, message: 'Hosts entry already active.' };
    }
  } catch (_error) { /* fall through and write */ }

  const applied = await applyToSystem();
  return { ...applied, changed: applied.success };
}

async function removeProjectEntry(domain) {
  const removeDomains = domainAliases.projectAliases(domain);
  await mutate((model) => {
    for (const group of model.groups) {
      group.entries = group.entries.filter((entry) => !removeDomains.includes(entry.domain));
    }
  });
  return applyToSystem();
}

module.exports = {
  START_MARKER,
  END_MARKER,
  getModel,
  applyToSystem,
  addGroup,
  renameGroup,
  toggleGroup,
  removeGroup,
  addEntry,
  toggleEntry,
  setProjectEntriesEnabled,
  upsertProjectGroup,
  removeProjectGroup,
  removeEntry,
  addRemote,
  toggleRemote,
  removeRemote,
  refreshRemote,
  readEntries,
  addProjectEntry,
  removeProjectEntry
};
