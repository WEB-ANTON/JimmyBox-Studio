const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const vm = require('../vm/lima');
const settings = require('../settings/store');

const gunzipAsync = promisify(zlib.gunzip);
const DB_RE = /^[A-Za-z0-9_]+$/;
const TABLE_RE = /^[A-Za-z0-9_]+$/;
const CHARSET_RE = /^[A-Za-z0-9._-]+$/;
const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
const TRANSFER_DIR = '.jbx-transfer';
const GUEST_TRANSFER_DIR = `/var/www/sites/${TRANSFER_DIR}`;

function validateDatabaseName(name) {
  if (!name || !DB_RE.test(name)) {
    throw new Error('Database name may only contain letters, numbers, and underscores.');
  }
}

function validateTableName(name) {
  if (!name || !TABLE_RE.test(name)) {
    throw new Error('Table names may only contain letters, numbers, and underscores.');
  }
}

function validateCharset(value) {
  if (!value || !CHARSET_RE.test(value)) {
    throw new Error('Charset may only contain letters, numbers, dots, underscores, and hyphens.');
  }
}

function sqlIdentifier(name) {
  validateDatabaseName(name);
  return `\`${name}\``;
}

async function mysql(sql) {
  return vm.shell(`mysql -uroot -proot --batch --skip-column-names -e ${vm.shellQuote(sql)}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function normalizeBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function normalizeExportOptions(opts) {
  const dbName = String(opts.dbName || '').trim();
  validateDatabaseName(dbName);

  const content = ['full', 'structure', 'data'].includes(opts.content) ? opts.content : 'full';
  const charset = String(opts.charset || 'utf8mb4').trim();
  validateCharset(charset);

  const tableMode = opts.tableMode === 'selected' ? 'selected' : 'all';
  const selectedTables = Array.isArray(opts.selectedTables)
    ? opts.selectedTables.map((name) => String(name).trim()).filter(Boolean)
    : [];

  if (tableMode === 'selected' && selectedTables.length === 0) {
    throw new Error('Choose at least one table to export.');
  }

  selectedTables.forEach(validateTableName);

  return {
    dbName,
    content,
    charset,
    tableMode,
    selectedTables,
    addDropTable: normalizeBool(opts.addDropTable, true),
    routines: normalizeBool(opts.routines, true),
    triggers: normalizeBool(opts.triggers, true),
    events: normalizeBool(opts.events, false),
    singleTransaction: normalizeBool(opts.singleTransaction, true),
    extendedInsert: normalizeBool(opts.extendedInsert, true),
    completeInsert: normalizeBool(opts.completeInsert, false),
    hexBlob: normalizeBool(opts.hexBlob, true),
    gzip: normalizeBool(opts.gzip, false)
  };
}

function exportFileName(dbName, gzip = false) {
  return `${dbName}-${timestamp()}.sql${gzip ? '.gz' : ''}`;
}

async function ensureHostTransferDir() {
  const sitesPath = await settings.getExpandedSitesPath();
  const transferPath = path.join(sitesPath, TRANSFER_DIR);
  await fs.mkdir(transferPath, { recursive: true });
  return transferPath;
}

async function ensureGuestTransferDir() {
  return vm.shell(`mkdir -p ${vm.shellQuote(GUEST_TRANSFER_DIR)} && chmod 777 ${vm.shellQuote(GUEST_TRANSFER_DIR)}`);
}

async function listDatabases() {
  const result = await mysql('SHOW DATABASES;');
  if (!result.success) return result;

  const databases = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((name) => !SYSTEM_DATABASES.has(name));

  return {
    success: true,
    databases
  };
}

async function listTables(dbName) {
  try {
    validateDatabaseName(dbName);
    const result = await mysql(`SHOW TABLES IN ${sqlIdentifier(dbName)};`);
    if (!result.success) return result;

    const tables = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((name) => TABLE_RE.test(name));

    return {
      success: true,
      tables
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

async function createDatabase(name) {
  try {
    validateDatabaseName(name);
    const sql = `CREATE DATABASE IF NOT EXISTS ${sqlIdentifier(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
    const result = await mysql(sql);
    if (!result.success) return result;

    return {
      success: true,
      message: `Database ${name} is ready.`
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

async function dropDatabase(name) {
  try {
    validateDatabaseName(name);
    const sql = `DROP DATABASE IF EXISTS ${sqlIdentifier(name)};`;
    const result = await mysql(sql);
    if (!result.success) return result;

    return {
      success: true,
      message: `Database ${name} dropped.`
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

async function databaseExists(name) {
  try {
    validateDatabaseName(name);
    // Exact match — LIKE would treat '_' in the name as a single-char wildcard
    // and could report a different database (e.g. foo_bar matching fooXbar).
    const result = await mysql(`SHOW DATABASES WHERE \`Database\` = '${name}';`);
    if (!result.success) return { success: false, message: result.message };
    return { success: true, exists: result.stdout.trim().length > 0 };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function buildDumpArgs(options) {
  const args = [
    '-uroot',
    '-proot',
    '--no-tablespaces',
    `--default-character-set=${options.charset}`
  ];

  if (options.content === 'structure') args.push('--no-data');
  if (options.content === 'data') args.push('--no-create-info');
  args.push(options.addDropTable ? '--add-drop-table' : '--skip-add-drop-table');
  if (options.routines) args.push('--routines');
  if (options.triggers) args.push('--triggers');
  if (!options.triggers) args.push('--skip-triggers');
  if (options.events) args.push('--events');
  if (options.singleTransaction) args.push('--single-transaction');
  args.push(options.extendedInsert ? '--extended-insert' : '--skip-extended-insert');
  if (options.completeInsert) args.push('--complete-insert');
  if (options.hexBlob) args.push('--hex-blob');

  args.push(options.dbName);

  if (options.tableMode === 'selected') {
    args.push(...options.selectedTables);
  }

  return args;
}

async function exportDatabase(opts) {
  let hostScratchPath = null;

  try {
    const raw = opts || {};
    const options = normalizeExportOptions(raw);
    const destinationPath = String(raw.destinationPath || '').trim();
    if (!destinationPath) {
      throw new Error('Choose an export destination.');
    }

    const transferPath = await ensureHostTransferDir();
    const prepared = await ensureGuestTransferDir();
    if (!prepared.success) return prepared;

    const fileName = exportFileName(options.dbName, options.gzip);
    const guestPath = `${GUEST_TRANSFER_DIR}/${fileName}`;
    hostScratchPath = path.join(transferPath, fileName);
    const dumpArgs = buildDumpArgs(options).map(vm.shellQuote).join(' ');
    const output = options.gzip
      ? `| gzip -c > ${vm.shellQuote(guestPath)}`
      : `> ${vm.shellQuote(guestPath)}`;

    const command = [
      'set -e',
      'set -o pipefail',
      'dump_bin="$(command -v mariadb-dump || command -v mysqldump)"',
      'test -n "$dump_bin"',
      `"${'${dump_bin}'}" ${dumpArgs} ${output}`,
      `chmod 666 ${vm.shellQuote(guestPath)}`
    ].join(' && ');

    const dumped = await vm.shell(command);
    if (!dumped.success) return dumped;

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(hostScratchPath, destinationPath);

    return {
      success: true,
      message: `Database ${options.dbName} exported to ${destinationPath}.`,
      path: destinationPath
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  } finally {
    if (hostScratchPath) {
      await fs.unlink(hostScratchPath).catch(() => {});
    }
  }
}

function validateImportPath(sourcePath) {
  const value = String(sourcePath || '').trim();
  if (!value) {
    throw new Error('Choose an import file.');
  }

  if (!value.endsWith('.sql') && !value.endsWith('.sql.gz')) {
    throw new Error('Import file must end in .sql or .sql.gz.');
  }

  return value;
}

function stripTrailingStatementDelimiter(sql) {
  return String(sql || '').trim().replace(/;+[\s;]*$/, '').trim();
}

function maskSqlLiteralsAndComments(sql) {
  const input = String(sql || '');
  let out = '';
  let state = 'normal';

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'normal';
        out += '\n';
      } else {
        out += ' ';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'normal';
        out += '  ';
        i += 1;
      } else {
        out += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state === 'single-quote') {
      if (char === '\\' && next) {
        out += '  ';
        i += 1;
      } else if (char === "'" && next === "'") {
        out += '  ';
        i += 1;
      } else if (char === "'") {
        state = 'normal';
        out += ' ';
      } else {
        out += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state === 'double-quote') {
      if (char === '\\' && next) {
        out += '  ';
        i += 1;
      } else if (char === '"' && next === '"') {
        out += '  ';
        i += 1;
      } else if (char === '"') {
        state = 'normal';
        out += ' ';
      } else {
        out += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (char === '-' && next === '-') {
      const previous = input[i - 1] || ' ';
      const after = input[i + 2] || ' ';
      if (/\s/.test(previous) && /\s/.test(after)) {
        state = 'line-comment';
        out += '  ';
        i += 1;
        continue;
      }
    }

    if (char === '#') {
      state = 'line-comment';
      out += ' ';
      continue;
    }

    if (char === '/' && next === '*') {
      state = 'block-comment';
      out += '  ';
      i += 1;
      continue;
    }

    if (char === "'") {
      state = 'single-quote';
      out += ' ';
      continue;
    }

    if (char === '"') {
      state = 'double-quote';
      out += ' ';
      continue;
    }

    out += char;
  }

  return out;
}

function assertReadOnlySql(sql) {
  const originalStatement = stripTrailingStatementDelimiter(sql);
  const singleStatement = stripTrailingStatementDelimiter(maskSqlLiteralsAndComments(sql));
  if (!singleStatement) throw new Error('Enter a query.');
  if (singleStatement.includes(';')) {
    throw new Error('Run one read-only query at a time.');
  }

  const firstKeyword = singleStatement.match(/^[A-Za-z]+/);
  const allowed = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN']);
  if (!firstKeyword || !allowed.has(firstKeyword[0].toUpperCase())) {
    throw new Error('Database browser allows read-only queries only: SELECT, SHOW, DESCRIBE, or EXPLAIN.');
  }

  if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL|LOAD|LOCK|UNLOCK|RENAME)\b/i.test(singleStatement) ||
      /\bINTO\s+(OUTFILE|DUMPFILE)\b/i.test(singleStatement)) {
    throw new Error('Database browser allows read-only queries only.');
  }

  return originalStatement;
}

function databaseLifecycleReferences(sql) {
  const refs = [];
  const databasePattern = /\b(CREATE|ALTER|DROP)\s+DATABASE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+`?([A-Za-z0-9_]+)`?/ig;
  const usePattern = /\bUSE\s+(?!INDEX\b|KEY\b)`?([A-Za-z0-9_]+)`?/ig;
  for (const match of sql.matchAll(databasePattern)) {
    refs.push({ statement: match[1].toUpperCase(), dbName: match[2] });
  }
  for (const match of sql.matchAll(usePattern)) {
    refs.push({ statement: 'USE', dbName: match[1] });
  }
  return refs;
}

async function assertImportStaysInSelectedDatabase(sourcePath, gzip, opts = {}) {
  const raw = await fs.readFile(sourcePath);
  const sql = gzip ? (await gunzipAsync(raw)).toString('utf8') : raw.toString('utf8');
  const masked = maskSqlLiteralsAndComments(sql);
  if (opts.allowDatabaseLifecycleStatements) {
    const dbName = String(opts.dbName || '').trim();
    validateDatabaseName(dbName);
    const invalid = databaseLifecycleReferences(masked).find((ref) => ref.dbName !== dbName);
    if (invalid) {
      throw new Error(`Database import lifecycle statement ${invalid.statement} references ${invalid.dbName}, not the selected database ${dbName}.`);
    }
    return;
  }

  if (/\bUSE\s+(?!INDEX\b|KEY\b)`?[A-Za-z0-9_]+`?/i.test(masked) ||
      /\b(CREATE|ALTER|DROP)\s+DATABASE\b/i.test(masked)) {
    throw new Error('Database import cannot include USE, CREATE DATABASE, ALTER DATABASE, or DROP DATABASE statements because they can escape the selected database.');
  }
}

async function importDatabase(opts) {
  let hostScratchPath = null;

  try {
    const raw = opts || {};
    const dbName = String(raw.dbName || '').trim();
    validateDatabaseName(dbName);

    const sourcePath = validateImportPath(raw.sourcePath);
    const createIfMissing = normalizeBool(raw.createIfMissing, false);
    const allowDatabaseLifecycleStatements = normalizeBool(raw.allowDatabaseLifecycleStatements, false);
    const gzip = sourcePath.endsWith('.gz');
    await assertImportStaysInSelectedDatabase(sourcePath, gzip, {
      dbName,
      allowDatabaseLifecycleStatements
    });

    const transferPath = await ensureHostTransferDir();
    const prepared = await ensureGuestTransferDir();
    if (!prepared.success) return prepared;

    const fileName = `import-${timestamp()}.sql${gzip ? '.gz' : ''}`;
    hostScratchPath = path.join(transferPath, fileName);
    const guestPath = `${GUEST_TRANSFER_DIR}/${fileName}`;

    await fs.copyFile(sourcePath, hostScratchPath);

    const setupSql = `CREATE DATABASE IF NOT EXISTS ${sqlIdentifier(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
    const mysqlImport = `mysql -uroot -proot --one-database ${vm.shellQuote(dbName)}`;
    const importCommand = gzip
      ? `gunzip -c ${vm.shellQuote(guestPath)} | ${mysqlImport}`
      : `${mysqlImport} < ${vm.shellQuote(guestPath)}`;

    const command = [
      'set -e',
      'set -o pipefail',
      createIfMissing ? `mysql -uroot -proot -e ${vm.shellQuote(setupSql)}` : null,
      importCommand
    ].filter(Boolean).join(' && ');

    const imported = await vm.shell(command);
    if (!imported.success) return imported;

    return {
      success: true,
      message: `Database ${dbName} imported.`
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  } finally {
    if (hostScratchPath) {
      await fs.unlink(hostScratchPath).catch(() => {});
    }
  }
}

// Run a read query and return columns + rows for the in-app browser.
async function query(dbName, sql) {
  try {
    validateDatabaseName(dbName);
    const cleanSql = assertReadOnlySql(sql);

    const result = await vm.shell(`mysql -uroot -proot ${vm.shellQuote(dbName)} --batch -e ${vm.shellQuote(cleanSql)}`);
    if (!result.success) {
      return { success: false, message: (result.stderr || result.message || 'Query failed').trim() };
    }

    const lines = String(result.stdout || '').replace(/\n$/, '').split('\n');
    if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
      return { success: true, columns: [], rows: [], message: 'Query OK (no result rows).' };
    }
    const columns = lines[0].split('\t');
    const rows = lines.slice(1).filter((l) => l.length > 0).map((l) => l.split('\t'));
    return { success: true, columns, rows };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function phpMyAdminUrl() {
  const apacheConfig = `Alias /_phpmyadmin /usr/share/phpmyadmin

<Directory /usr/share/phpmyadmin>
    Options SymLinksIfOwnerMatch
    DirectoryIndex index.php
    Require all granted
</Directory>

<Directory /usr/share/phpmyadmin/templates>
    Require all denied
</Directory>

<Directory /usr/share/phpmyadmin/libraries>
    Require all denied
</Directory>
`;
  const phpMyAdminPhpConfig = [
    'upload_max_filesize = 512M',
    'post_max_size = 512M',
    'memory_limit = 512M',
    'max_execution_time = 600',
    'max_input_time = 600',
    ''
  ].join('\n');
  const phpMyAdminStorageConfig = `<?php
$i = 1;
$cfg['blowfish_secret'] = 'jimmybox-studio-local-dev-secret-32';
$cfg['TempDir'] = '/var/lib/phpmyadmin/tmp';
$cfg['Servers'][$i]['pmadb'] = 'phpmyadmin';
$cfg['Servers'][$i]['controluser'] = 'pma';
$cfg['Servers'][$i]['controlpass'] = 'jimmybox_pma';
$cfg['Servers'][$i]['bookmarktable'] = 'pma__bookmark';
$cfg['Servers'][$i]['relation'] = 'pma__relation';
$cfg['Servers'][$i]['table_info'] = 'pma__table_info';
$cfg['Servers'][$i]['table_coords'] = 'pma__table_coords';
$cfg['Servers'][$i]['pdf_pages'] = 'pma__pdf_pages';
$cfg['Servers'][$i]['column_info'] = 'pma__column_info';
$cfg['Servers'][$i]['history'] = 'pma__history';
$cfg['Servers'][$i]['table_uiprefs'] = 'pma__table_uiprefs';
$cfg['Servers'][$i]['tracking'] = 'pma__tracking';
$cfg['Servers'][$i]['userconfig'] = 'pma__userconfig';
$cfg['Servers'][$i]['recent'] = 'pma__recent';
$cfg['Servers'][$i]['favorite'] = 'pma__favorite';
$cfg['Servers'][$i]['users'] = 'pma__users';
$cfg['Servers'][$i]['usergroups'] = 'pma__usergroups';
$cfg['Servers'][$i]['navigationhiding'] = 'pma__navigationhiding';
$cfg['Servers'][$i]['savedsearches'] = 'pma__savedsearches';
$cfg['Servers'][$i]['central_columns'] = 'pma__central_columns';
$cfg['Servers'][$i]['designer_settings'] = 'pma__designer_settings';
$cfg['Servers'][$i]['export_templates'] = 'pma__export_templates';
`;

  const encodedConfig = Buffer.from(apacheConfig, 'utf8').toString('base64');
  const encodedPhpConfig = Buffer.from(phpMyAdminPhpConfig, 'utf8').toString('base64');
  const encodedStorageConfig = Buffer.from(phpMyAdminStorageConfig, 'utf8').toString('base64');
  const setupStorageSql = [
    'CREATE DATABASE IF NOT EXISTS `phpmyadmin` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    "CREATE USER IF NOT EXISTS 'pma'@'localhost' IDENTIFIED BY 'jimmybox_pma'",
    "ALTER USER 'pma'@'localhost' IDENTIFIED BY 'jimmybox_pma'",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON `phpmyadmin`.* TO 'pma'@'localhost'",
    'FLUSH PRIVILEGES'
  ].join('; ') + ';';
  const installCommand = [
    'if [ ! -d /usr/share/phpmyadmin ]; then',
    "printf '%s\\n' 'phpmyadmin phpmyadmin/dbconfig-install boolean false' 'phpmyadmin phpmyadmin/reconfigure-webserver multiselect apache2' | sudo debconf-set-selections;",
    'sudo add-apt-repository -y universe || true;',
    'sudo apt-get update;',
    'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y phpmyadmin;',
    'fi'
  ].join(' ');
  const command = [
    'set -e',
    installCommand,
    `printf '%s' ${vm.shellQuote(encodedConfig)} | base64 -d | sudo tee /etc/apache2/conf-available/jimmybox-phpmyadmin.conf >/dev/null`,
    `printf '%s' ${vm.shellQuote(encodedStorageConfig)} | base64 -d | sudo tee /etc/phpmyadmin/conf.d/jimmybox-studio.php >/dev/null`,
    `mysql -uroot -proot -e ${vm.shellQuote(setupStorageSql)}`,
    'pma_sql="$(find /usr/share/phpmyadmin /usr/share/doc/phpmyadmin -path "*/create_tables.sql" -print 2>/dev/null | head -1)"; if [ -n "$pma_sql" ]; then mysql -uroot -proot phpmyadmin < "$pma_sql"; fi',
    'sudo install -d -o www-data -g www-data -m 0750 /var/lib/phpmyadmin/tmp',
    `for version in /etc/php/*; do for sapi in fpm cli; do if [ -d "$version/$sapi/conf.d" ]; then printf '%s' ${vm.shellQuote(encodedPhpConfig)} | base64 -d | sudo tee "$version/$sapi/conf.d/99-jimmybox-phpmyadmin.ini" >/dev/null; fi; done; done`,
    'for version in /etc/php/*; do service="php$(basename "$version")-fpm"; if systemctl list-unit-files "$service.service" >/dev/null 2>&1; then sudo systemctl reload "$service" >/dev/null 2>&1 || sudo systemctl restart "$service" >/dev/null 2>&1 || true; fi; done',
    'sudo a2enconf jimmybox-phpmyadmin >/dev/null',
    'sudo systemctl reload apache2'
  ].join(' && ');

  const result = await vm.shell(command);
  if (!result.success) return result;

  const ipResult = await vm.getIp();
  const host = ipResult.success ? ipResult.ip : '127.0.0.1';
  return {
    success: true,
    url: `http://${host}/_phpmyadmin/`,
    message: 'phpMyAdmin ready — log in with server "localhost", user "root", password "root".'
  };
}

module.exports = {
  listDatabases,
  listTables,
  createDatabase,
  dropDatabase,
  databaseExists,
  exportDatabase,
  importDatabase,
  exportFileName,
  query,
  phpMyAdminUrl
};
