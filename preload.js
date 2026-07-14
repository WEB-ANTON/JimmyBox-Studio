const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  app: {
    notify: (payload) => ipcRenderer.invoke('app:notify', payload)
  },
  vm: {
    status: () => ipcRenderer.invoke('vm:status'),
    start: () => ipcRenderer.invoke('vm:start'),
    stop: () => ipcRenderer.invoke('vm:stop'),
    provision: () => ipcRenderer.invoke('vm:provision'),
    getIp: () => ipcRenderer.invoke('vm:getIp'),
    setResources: (cpus, memory) => ipcRenderer.invoke('vm:setResources', cpus, memory)
  },
  projects: {
    create: (payload) => ipcRenderer.invoke('projects:create', payload),
    list: () => ipcRenderer.invoke('projects:list'),
    listCms: () => ipcRenderer.invoke('projects:listCms'),
    delete: (domain) => ipcRenderer.invoke('projects:delete', domain),
    setPhp: (domain, version) => ipcRenderer.invoke('projects:setPhp', domain, version),
    open: (domain) => ipcRenderer.invoke('projects:open', domain),
    pickFile: (kind) => ipcRenderer.invoke('projects:pickFile', kind),
    import: (payload) => ipcRenderer.invoke('projects:import', payload)
  },
  db: {
    list: () => ipcRenderer.invoke('db:list'),
    listTables: (dbName) => ipcRenderer.invoke('db:listTables', dbName),
    create: (name) => ipcRenderer.invoke('db:create', name),
    drop: (name) => ipcRenderer.invoke('db:drop', name),
    export: (opts) => ipcRenderer.invoke('db:export', opts),
    import: (opts) => ipcRenderer.invoke('db:import', opts),
    query: (dbName, sql) => ipcRenderer.invoke('db:query', dbName, sql),
    phpMyAdminUrl: () => ipcRenderer.invoke('db:phpMyAdminUrl'),
    openPhpMyAdmin: () => ipcRenderer.invoke('db:openPhpMyAdmin')
  },
  hosts: {
    getModel: () => ipcRenderer.invoke('hosts:getModel'),
    apply: () => ipcRenderer.invoke('hosts:apply'),
    addGroup: (name) => ipcRenderer.invoke('hosts:addGroup', name),
    renameGroup: (id, name) => ipcRenderer.invoke('hosts:renameGroup', id, name),
    toggleGroup: (id, enabled) => ipcRenderer.invoke('hosts:toggleGroup', id, enabled),
    removeGroup: (id) => ipcRenderer.invoke('hosts:removeGroup', id),
    addEntry: (groupId, ip, domain) => ipcRenderer.invoke('hosts:addEntry', groupId, ip, domain),
    toggleEntry: (id, enabled) => ipcRenderer.invoke('hosts:toggleEntry', id, enabled),
    setProjectEntriesEnabled: (domains, enabled, ip) => ipcRenderer.invoke('hosts:setProjectEntriesEnabled', domains, enabled, ip),
    removeEntry: (id) => ipcRenderer.invoke('hosts:removeEntry', id),
    addRemote: (name, url, refreshMinutes) => ipcRenderer.invoke('hosts:addRemote', name, url, refreshMinutes),
    toggleRemote: (id, enabled) => ipcRenderer.invoke('hosts:toggleRemote', id, enabled),
    removeRemote: (id) => ipcRenderer.invoke('hosts:removeRemote', id),
    refreshRemote: (id) => ipcRenderer.invoke('hosts:refreshRemote', id),
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('hosts:changed', listener);
      return () => ipcRenderer.removeListener('hosts:changed', listener);
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    pickDirectory: () => ipcRenderer.invoke('settings:pickDirectory')
  },
  php: {
    list: () => ipcRenderer.invoke('php:list'),
    install: (version) => ipcRenderer.invoke('php:install', version)
  },
  checkpoints: {
    create: (payload) => ipcRenderer.invoke('checkpoints:create', payload),
    list: (domain) => ipcRenderer.invoke('checkpoints:list', domain),
    restore: (domain, id, opts) => ipcRenderer.invoke('checkpoints:restore', domain, id, opts),
    diff: (domain, idA, idB) => ipcRenderer.invoke('checkpoints:diff', domain, idA, idB),
    setPinned: (domain, id, pinned) => ipcRenderer.invoke('checkpoints:setPinned', domain, id, pinned),
    delete: (domain, id) => ipcRenderer.invoke('checkpoints:delete', domain, id)
  },
  tray: {
    listHostProjects: () => ipcRenderer.invoke('tray:listHostProjects'),
    setProjectHost: (domain, enabled) => ipcRenderer.invoke('tray:setProjectHost', domain, enabled),
    openStudio: () => ipcRenderer.invoke('tray:openStudio'),
    hide: () => ipcRenderer.invoke('tray:hide'),
    onShow: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('tray:show', listener);
      return () => ipcRenderer.removeListener('tray:show', listener);
    }
  }
});
