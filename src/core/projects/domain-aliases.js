const DOMAIN_RE = /^[A-Za-z0-9._-]+$/;

function stripTrailingDot(value) {
  return String(value || '').replace(/\.+$/, '');
}

function hostFromInput(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Domain is required.');

  let host = raw;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
    host = new URL(raw).hostname;
  } else if (/[/?#:]/.test(raw)) {
    host = new URL(`http://${raw}`).hostname;
  }

  const clean = stripTrailingDot(host).toLowerCase();
  if (!clean || !DOMAIN_RE.test(clean) || clean.includes('..')) {
    throw new Error(`Invalid domain: ${raw}`);
  }
  return clean;
}

function canonicalProjectDomain(value) {
  const host = hostFromInput(value);
  return host.startsWith('www.') ? host.slice(4) : host;
}

function hasWwwAlias(domain) {
  return String(domain || '').includes('.');
}

function isLikelyApexDomain(domain) {
  return String(domain || '').split('.').filter(Boolean).length === 2;
}

function projectAliases(value) {
  const domain = canonicalProjectDomain(value);
  const aliases = [domain];
  if (hasWwwAlias(domain)) aliases.push(`www.${domain}`);
  return [...new Set(aliases)];
}

function aliasHosts(domain, ip = '127.0.0.1', enabled = true) {
  return projectAliases(domain).map((host) => ({
    ip,
    domain: host,
    enabled
  }));
}

function dbNameForDomain(domain) {
  return canonicalProjectDomain(domain).replace(/[^A-Za-z0-9_]/g, '_');
}

function preferredHttpsUrl(domain) {
  const canonical = canonicalProjectDomain(domain);
  const host = isLikelyApexDomain(canonical) ? `www.${canonical}` : canonical;
  return `https://${host}`;
}

function apacheServerAliases(domain) {
  const canonical = canonicalProjectDomain(domain);
  return projectAliases(canonical).filter((host) => host !== canonical);
}

module.exports = {
  DOMAIN_RE,
  aliasHosts,
  apacheServerAliases,
  canonicalProjectDomain,
  dbNameForDomain,
  hostFromInput,
  preferredHttpsUrl,
  projectAliases
};
