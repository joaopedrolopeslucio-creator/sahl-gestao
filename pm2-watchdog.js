// PM2 Watchdog - SAHL
// Verifica todos os processos PM2 e reinicia os que estiverem parados/crashados
// Agendado para rodar a cada 5 minutos via Task Scheduler

const { spawnSync } = require('child_process');
const fs = require('fs');

const LOG_FILE = 'C:/Users/Administrator/.pm2/watchdog.log';
const PM2_CMD = 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\pm2.cmd';
const MAX_LOG_LINES = 500;

const EXPECTED = ['sahl-fluxo', 'sahl-dashboard', 'sahl-auditoria', 'sahl-instagram', 'sahl-tunnel', 'sahl-gestao', 'medcup'];

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
    const content = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    if (content.length > MAX_LOG_LINES) {
      fs.writeFileSync(LOG_FILE, content.slice(-MAX_LOG_LINES).join('\n'));
    }
  } catch (e) {}
}

function pm2(args) {
  const result = spawnSync(PM2_CMD, args, { encoding: 'utf8', timeout: 30000, shell: true });
  return result.stdout || '';
}

function getProcesses() {
  const out = pm2(['jlist']);
  try {
    // JSON.parse do Node.js suporta chaves duplicadas (ultima vence) - diferente do PowerShell
    const list = JSON.parse(out);
    return list.map(p => ({
      name: p.name,
      status: p.pm2_env ? p.pm2_env.status : 'unknown'
    }));
  } catch (e) {
    log('ERRO ao parsear lista PM2: ' + e.message);
    return [];
  }
}

const processes = getProcesses();

if (processes.length === 0) {
  log('CRITICO: Nao foi possivel obter lista PM2 - executando resurrect...');
  pm2(['resurrect']);
  process.exit(1);
}

const runningNames = processes.map(p => p.name);
const restarted = [];
const missing = [];

// Verificar status de cada processo rodando
for (const proc of processes) {
  if (proc.status !== 'online') {
    log(`ALERTA: ${proc.name} esta '${proc.status}' - reiniciando...`);
    pm2(['restart', proc.name]);
    restarted.push(proc.name);
  }
}

// Verificar processos esperados que sumiram completamente
for (const expected of EXPECTED) {
  if (!runningNames.includes(expected)) {
    missing.push(expected);
  }
}

if (missing.length > 0) {
  log(`CRITICO: Processos nao encontrados: ${missing.join(', ')} - executando resurrect...`);
  pm2(['resurrect']);
}

if (restarted.length > 0) {
  log(`Reiniciados com sucesso: ${restarted.join(', ')}`);
  pm2(['save']);
} else if (missing.length === 0) {
  // Log de saude apenas na primeira execucao de cada hora
  const min = new Date().getMinutes();
  if (min < 5) {
    log(`OK: todos os ${processes.length} processos online`);
  }
}
