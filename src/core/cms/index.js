const wordpress = require('./adapters/wordpress');
const typo3 = require('./adapters/typo3');
const contao = require('./adapters/contao');
const drupal = require('./adapters/drupal');
const joomla = require('./adapters/joomla');
const plain = require('./adapters/plain');

const adapters = [wordpress, typo3, contao, drupal, joomla, plain];
const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));

function publicAdapter(adapter, detected = true) {
  return {
    id: adapter.id,
    label: adapter.label,
    docroot: adapter.docroot,
    mediaPaths: adapter.mediaPaths,
    phpRange: adapter.phpRange,
    recommendedPhpVersion: adapter.recommendedPhpVersion,
    installPhpMin: adapter.installPhpMin,
    phpExtensions: adapter.phpExtensions,
    detected
  };
}

function list() {
  return adapters.map((adapter) => publicAdapter(adapter));
}

function get(id) {
  const adapter = byId.get(id || 'wordpress');
  if (!adapter) throw new Error(`Unknown CMS adapter: ${id}`);
  return adapter;
}

async function detect(projectPath) {
  for (const adapter of adapters) {
    if (await adapter.detect(projectPath)) return publicAdapter(adapter);
  }
  return publicAdapter(plain, false);
}

module.exports = {
  list,
  get,
  detect
};
