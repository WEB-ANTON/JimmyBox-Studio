const { ipcMain, shell, dialog } = require('electron');
const projects = require('../core/projects/project-manager');
const projectImport = require('../core/projects/project-import');
const cms = require('../core/cms');
const hosts = require('../core/hosts/hosts-manager');
const vm = require('../core/vm/lima');
const domainAliases = require('../core/projects/domain-aliases');

const DOMAIN_RE = domainAliases.DOMAIN_RE;

function registerProjectsIpc() {
  ipcMain.handle('projects:create', (_event, payload) => projects.createProject(payload));
  ipcMain.handle('projects:list', () => projects.listProjects());
  ipcMain.handle('projects:listCms', () => ({ success: true, adapters: cms.list() }));
  ipcMain.handle('projects:delete', (_event, domain) => projects.deleteProject(domain));
  ipcMain.handle('projects:setPhp', (_event, domain, version) => projects.setProjectPhp(domain, version));
  ipcMain.handle('projects:import', (_event, payload) => projectImport.importProject(payload));

  // File picker for the importer (code archive or database dump).
  ipcMain.handle('projects:pickFile', async (_event, kind) => {
    const filters = kind === 'dump'
      ? [{ name: 'Database dumps', extensions: ['sql', 'gz'] }]
      : [{ name: 'Code archives', extensions: ['zip', 'gz', 'tgz', 'tar'] }];
    const result = await dialog.showOpenDialog({
      title: kind === 'dump' ? 'Choose a database dump' : 'Choose a code archive',
      properties: ['openFile'],
      filters
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0] };
  });

  // Open a project in the default browser, first making sure its /etc/hosts
  // entry is active so the domain actually resolves.
  ipcMain.handle('projects:open', async (_event, domain) => {
    let clean;
    try {
      clean = domainAliases.canonicalProjectDomain(domain);
      if (!DOMAIN_RE.test(clean)) {
        return { success: false, message: 'Invalid domain.' };
      }
    } catch (_error) {
      return { success: false, message: 'Invalid domain.' };
    }
    const repaired = await projects.repairProject(clean);
    if (!repaired.success) return repaired;
    const projectDomain = repaired.domain || clean;
    const ipResult = await vm.getIp();
    const ip = ipResult.success ? ipResult.ip : '127.0.0.1';
    const host = await hosts.addProjectEntry(projectDomain, ip);
    if (!host.success) return host;
    const url = domainAliases.preferredHttpsUrl(projectDomain);
    await shell.openExternal(url);
    return { success: true, message: `Opened ${url}` };
  });
}

module.exports = { registerProjectsIpc };
