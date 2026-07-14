const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const domains = require('../projects/domain-aliases');
const projectSetup = require('../projects/project-setup');

test('domain inputs are normalized to the canonical project domain', () => {
  assert.equal(domains.canonicalProjectDomain('https://www.lettmaierhof.at/foo?x=1'), 'lettmaierhof.at');
  assert.equal(domains.canonicalProjectDomain('HTTP://LETTMAIERHOF.AT/'), 'lettmaierhof.at');
  assert.equal(domains.canonicalProjectDomain('www.shop.kunde.at'), 'shop.kunde.at');
  assert.equal(domains.dbNameForDomain('https://www.lettmaierhof.at'), 'lettmaierhof_at');
  assert.equal(domains.preferredHttpsUrl('lettmaierhof.at'), 'https://www.lettmaierhof.at');
  assert.equal(domains.preferredHttpsUrl('shop.kunde.at'), 'https://shop.kunde.at');
});

test('project aliases include apex and www without collapsing real subdomains', () => {
  assert.deepEqual(domains.projectAliases('lettmaierhof.at'), [
    'lettmaierhof.at',
    'www.lettmaierhof.at'
  ]);
  assert.deepEqual(domains.projectAliases('www.lettmaierhof.at'), [
    'lettmaierhof.at',
    'www.lettmaierhof.at'
  ]);
  assert.deepEqual(domains.projectAliases('shop.kunde.at'), [
    'shop.kunde.at',
    'www.shop.kunde.at'
  ]);
});

test('setup descriptors derive host aliases from the canonical domain', () => {
  const setup = projectSetup.sanitizeSetup({
    domain: 'https://www.lettmaierhof.at',
    phpVersion: '8.3',
    database: 'lettmaierhof'
  });

  assert.equal(setup.domain, 'lettmaierhof.at');
  assert.deepEqual(setup.hosts.map((entry) => entry.domain), [
    'lettmaierhof.at',
    'www.lettmaierhof.at'
  ]);
});

test('generated apache vhosts carry an explicit managed marker', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'projects', 'templates', 'vhost.conf.tpl'), 'utf8');
  assert.ok(template.startsWith('# MANAGED BY JIMMYBOX STUDIO\n'));
});
