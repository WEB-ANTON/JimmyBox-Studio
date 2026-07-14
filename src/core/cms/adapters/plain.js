const fs = require('fs/promises');
const path = require('path');
const { exists } = require('../helpers');

module.exports = {
  id: 'plain',
  label: 'Plain PHP',
  docroot: 'public',
  mediaPaths: [],
  phpRange: '>=7.4',
  recommendedPhpVersion: '8.2',
  phpExtensions: ['curl', 'mbstring', 'mysqli', 'xml', 'zip'],

  async detect(projectPath) {
    return exists(path.join(projectPath, 'public', 'index.php'));
  },

  async writeDbConfig() {
    return { success: true, changed: false, message: 'Plain PHP has no generated DB config.' };
  },

  async setupRoutines() {
    return [];
  },

  async install({ projectPath }) {
    await fs.mkdir(path.join(projectPath, 'public'), { recursive: true });
    const indexPath = path.join(projectPath, 'public', 'index.php');
    if (!(await exists(indexPath))) {
      await fs.writeFile(indexPath, "<?php\nphpinfo();\n", 'utf8');
      return { success: true, changed: true, message: 'Plain PHP project is ready.' };
    }
    return { success: true, changed: false, message: 'Plain PHP project already exists.' };
  }
};
