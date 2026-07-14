const fs = require('fs/promises');
const path = require('path');
const { composerCreateProject, exists, mysqlUrl, phpBin, projectShell, randomSecret } = require('../helpers');

function starterRedirectSql() {
  return `
SET @existing_pages = (SELECT COUNT(*) FROM tl_page);
SET @now = UNIX_TIMESTAMP();
INSERT INTO tl_page (pid,sorting,tstamp,title,type,alias,language,fallback,dns,published,useSSL)
SELECT 0,128,@now,'JimmyBox Studio','root','jimmybox-studio','en',1,'',1,1
WHERE @existing_pages = 0;
SET @root = LAST_INSERT_ID();
INSERT INTO tl_page (pid,sorting,tstamp,title,type,alias,pageTitle,redirect,url,published)
SELECT @root,128,@now,'Open Contao','redirect','index','Open Contao','temporary','/contao',1
WHERE @existing_pages = 0;
`;
}

function seedStarterRedirect({ dbName, vm }) {
  return vm.shell(`cat <<'SQL' | mysql -uroot -proot ${vm.shellQuote(dbName)}
${starterRedirectSql()}
SQL`);
}

function upsertDotenv(content, entries) {
  const pending = new Map(Object.entries(entries));
  const lines = String(content || '').split(/\r?\n/);
  const next = [];

  for (const line of lines) {
    if (line === '' && next.length === lines.length - 1) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && pending.has(match[1])) {
      next.push(`${match[1]}=${pending.get(match[1])}`);
      pending.delete(match[1]);
    } else {
      next.push(line);
    }
  }

  for (const [key, value] of pending) {
    next.push(`${key}=${value}`);
  }

  return `${next.filter((line, index) => line !== '' || index < next.length - 1).join('\n')}\n`;
}

function upsertYamlParameters(content, entries) {
  const pending = new Map(Object.entries(entries));
  const lines = String(content || 'parameters:\n').split(/\r?\n/);
  const next = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*):/);
    if (match && pending.has(match[2])) {
      const value = pending.get(match[2]);
      pending.delete(match[2]);
      return `${match[1]}${match[2]}: ${value}`;
    }
    return line;
  });
  const indent = next.some((line) => /^\s{4}\S/.test(line)) ? '    ' : '    ';
  for (const [key, value] of pending) {
    next.push(`${indent}${key}: ${value}`);
  }
  return `${next.filter((line, index) => line !== '' || index < next.length - 1).join('\n')}\n`;
}

module.exports = {
  id: 'contao',
  label: 'Contao',
  docroot: 'public',
  mediaPaths: ['files'],
  phpRange: '>=7.4',
  recommendedPhpVersion: '8.3',
  installPhpMin: '8.3',
  phpExtensions: ['curl', 'gd', 'intl', 'mbstring', 'mysqli', 'xml', 'zip'],

  async detect(projectPath) {
    return exists(path.join(projectPath, 'vendor', 'contao')) ||
      exists(path.join(projectPath, 'contao-manager.phar.php')) ||
      exists(path.join(projectPath, 'web', 'contao-manager.phar.php'));
  },

  async writeDbConfig({ projectPath, dbName }) {
    const content = [
      `APP_SECRET=${randomSecret(32)}`,
      `DATABASE_URL=${mysqlUrl({ dbName })}`,
      ''
    ].join('\n');
    await fs.writeFile(path.join(projectPath, '.env.local'), content, 'utf8');
    return { success: true, changed: true };
  },

  async setupRoutines({ phpVersion } = {}) {
    return [
      { name: 'Contao migrate', cmd: `${phpBin(phpVersion)} vendor/bin/contao-console contao:migrate --no-interaction`, cwd: '', runOn: ['checkout'], location: 'vm' }
    ];
  },

  async install({ domain, projectPath, dbName, phpVersion, vm }) {
    // Imported/existing project: don't re-scaffold, overwrite .env.local, or
    // re-run migrate/user-create. Leave it untouched.
    if (await this.detect(projectPath)) {
      return { success: true, changed: false, message: 'Existing Contao project detected — left unchanged.' };
    }

    const created = await projectShell(vm, domain, composerCreateProject(phpVersion, 'contao/managed-edition:^5'));
    if (!created.success) return created;

    const config = await this.writeDbConfig({ projectPath, dbName });
    if (!config.success) return config;

    const migrated = await projectShell(vm, domain, `${phpBin(phpVersion)} vendor/bin/contao-console contao:migrate --no-interaction`);
    if (!migrated.success) return migrated;

    const seeded = await seedStarterRedirect({ dbName, vm });
    if (!seeded.success) return seeded;

    await projectShell(vm, domain, `${phpBin(phpVersion)} vendor/bin/contao-console contao:user:create --username=admin --name=Admin --email=admin@example.test --password=${vm.shellQuote('Studio.admin1')} --language=en --admin --no-interaction || true`);
    return { success: true, changed: true, message: 'Contao is ready.' };
  },

  // Point an imported Contao at the local DB (keep an existing APP_SECRET) and
  // make it answer on the local host by clearing per-page DNS entries.
  async localize({ projectPath, dbName, domain, phpVersion, vm, hasDump }) {
    const steps = [];
    const envPath = path.join(projectPath, '.env.local');
    const existing = await fs.readFile(envPath, 'utf8').catch(() => '');
    const m = existing.match(/^APP_SECRET=(.*)$/m);
    // Reuse an existing APP_SECRET only when it is a plain unquoted token; a value
    // with quotes, '#', or whitespace would corrupt the regenerated dotenv line,
    // so fall back to a fresh secret in that case.
    const candidate = m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    const secret = /^[A-Za-z0-9_+/=.-]+$/.test(candidate) ? candidate : randomSecret(32);
    await fs.writeFile(envPath, upsertDotenv(existing, {
      APP_SECRET: secret,
      DATABASE_URL: mysqlUrl({ dbName })
    }), 'utf8');
    steps.push({ name: 'contao config', success: true, message: '.env.local pointed at the local database.' });

    const parametersPath = path.join(projectPath, 'app', 'config', 'parameters.yml');
    if (await exists(parametersPath)) {
      const parameters = await fs.readFile(parametersPath, 'utf8');
      await fs.writeFile(parametersPath, upsertYamlParameters(parameters, {
        database_host: 'localhost',
        database_user: 'root',
        database_password: 'root',
        database_name: dbName
      }), 'utf8');
      steps.push({ name: 'contao legacy config', success: true, message: 'parameters.yml pointed at the local database.' });
    }

    if (hasDump) {
      await vm.shell(`mysql -uroot -proot ${vm.shellQuote(dbName)} -e "UPDATE tl_page SET dns='' WHERE dns IS NOT NULL AND dns<>''" 2>/dev/null || true`);
      await projectShell(vm, domain, `${phpBin(phpVersion)} vendor/bin/contao-console cache:clear --no-warmup || true`);
      steps.push({ name: 'contao domains', success: true, message: 'Cleared per-page domains for local use.' });
    }
    return { success: true, steps };
  }
};
