const express = require('../waha-dashboard/node_modules/express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const app     = express();
const PORT    = 3012;

const SENHA  = 'sahl2026';
const TOKEN  = crypto.createHash('sha256').update(SENHA + 'gestao-sahl-secret').digest('hex');
const COOKIE = 'gestao_auth';
const DL_FILE = path.join(__dirname, 'downloads.json');

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Downloads helpers ────────────────────────────────────────────────────────
function readDownloads() {
  try { return JSON.parse(fs.readFileSync(DL_FILE, 'utf8')); } catch { return []; }
}
function writeDownloads(data) {
  fs.writeFileSync(DL_FILE, JSON.stringify(data, null, 2));
}

function isAuth(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  return match && match[1] === TOKEN;
}

const LOGIN_HTML = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gestão SAHL — Acesso</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1117;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Segoe UI',system-ui,sans-serif}
  .box{background:#1a1d2e;border:1px solid #2e3250;border-radius:14px;padding:40px 36px;width:100%;max-width:360px;text-align:center}
  .logo{width:56px;height:56px;background:linear-gradient(135deg,#6366f1,#22c55e);border-radius:14px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;color:#fff;margin:0 auto 16px}
  h1{font-size:18px;color:#e2e8f0;margin-bottom:4px}
  p{font-size:12px;color:#64748b;margin-bottom:28px}
  input{width:100%;background:#242740;border:1px solid #2e3250;color:#e2e8f0;border-radius:8px;padding:12px 14px;font-size:14px;outline:none;margin-bottom:14px;text-align:center;letter-spacing:2px}
  input:focus{border-color:#6366f1}
  button{width:100%;background:#6366f1;border:none;color:#fff;border-radius:8px;padding:12px;font-size:14px;font-weight:600;cursor:pointer}
  button:hover{opacity:.88}
  .err{color:#ef4444;font-size:12px;margin-top:10px}
</style></head><body>
<div class="box">
  <div class="logo">SG</div>
  <h1>Gestão SAHL</h1>
  <p>Painel central — Acesso restrito</p>
  <form method="POST" action="/login">
    <input type="password" name="senha" placeholder="Digite a senha" autofocus autocomplete="current-password">
    <button type="submit">Entrar</button>
    __ERR__
  </form>
</div></body></html>`;

app.get('/login', (req, res) => {
  if (isAuth(req)) return res.redirect('/');
  res.send(LOGIN_HTML.replace('__ERR__', ''));
});

app.post('/login', (req, res) => {
  const { senha } = req.body;
  if (senha === SENHA) {
    res.setHeader('Set-Cookie', `${COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    return res.redirect('/');
  }
  res.status(401).send(LOGIN_HTML.replace('__ERR__', '<div class="err">Senha incorreta.</div>'));
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
  res.redirect('/login');
});

app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();
  if (!isAuth(req)) return res.redirect('/login');
  next();
});

// ─── Downloads API ────────────────────────────────────────────────────────────
app.get('/api/downloads', (req, res) => {
  res.json(readDownloads());
});

app.post('/api/downloads', (req, res) => {
  const list = readDownloads();
  const item = {
    id: 'dl-' + Date.now(),
    name: req.body.name || 'Sem nome',
    description: req.body.description || '',
    url: req.body.url || '',
    filename: req.body.filename || '',
    tag: req.body.tag || '',
    badge: req.body.badge || '',
    icon: req.body.icon || '📋',
    createdAt: new Date().toISOString(),
    archived: false,
    archivedAt: null,
  };
  list.push(item);
  writeDownloads(list);
  res.json(item);
});

app.patch('/api/downloads/:id', (req, res) => {
  const list = readDownloads();
  const idx  = list.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const item = { ...list[idx], ...req.body };
  if (req.body.archived === true  && !list[idx].archived) item.archivedAt = new Date().toISOString();
  if (req.body.archived === false) item.archivedAt = null;
  list[idx] = item;
  writeDownloads(list);
  res.json(item);
});

app.delete('/api/downloads/:id', (req, res) => {
  const list = readDownloads();
  const idx  = list.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  list.splice(idx, 1);
  writeDownloads(list);
  res.json({ ok: true });
});

// ─── Inadimplência ────────────────────────────────────────────────────────────
const https = require('https');
const ASAAS_KEY = '$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmZhYTBlNzMxLTY5MTktNGQ3Zi1iNmYyLWM3Y2MzYmM1ODNmNDo6JGFhY2hfNjgyNDkyOGQtZWUzYi00YmVmLWI2ZGEtN2JmZDEyNWJlMjBm';

let _inadCache = null;
let _inadCacheTs = 0;

// ─── Customer name cache (shared) ─────────────────────────────────────────────
const _custCache = {};
async function asaasGetCustomerCached(id) {
  if (_custCache[id]) return _custCache[id];
  try {
    const c = await asaasGetCustomer(id);
    _custCache[id] = { nome: c.name || '', cpf: (c.cpfCnpj || '').replace(/\D/g, '') };
  } catch { _custCache[id] = { nome: '', cpf: '' }; }
  return _custCache[id];
}

// ─── SQLite — gestão de inadimplentes ─────────────────────────────────────────
const Database = require('../waha-dashboard/node_modules/better-sqlite3');
const db = new Database(path.join(__dirname, 'gestao.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS gestao_clientes (
    cpf TEXT PRIMARY KEY,
    nome TEXT,
    status_gestao TEXT DEFAULT 'NOVO',
    data_entrada TEXT,
    data_ultima_acao TEXT,
    data_resolucao TEXT,
    observacao TEXT
  );
  CREATE TABLE IF NOT EXISTS acoes_inadimplencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpf TEXT,
    tipo TEXT,
    resultado TEXT,
    notas TEXT,
    data_acao TEXT,
    responsavel TEXT
  );
`);
// Migração: adicionar coluna valor_total se não existir
try { db.exec('ALTER TABLE gestao_clientes ADD COLUMN valor_total REAL DEFAULT 0'); } catch(e) {}
// Migração: renomear status legado
db.exec("UPDATE gestao_clientes SET status_gestao='NOVO' WHERE status_gestao='EM_COBRANCA'");

// ─── Recebíveis do dia ────────────────────────────────────────────────────────
let _recebCache = {};
let _recebCacheTs = {};
const RECEBIVEIS_TTL = 15 * 60 * 1000;

const STATUS_LABEL = { RECEIVED: 'PAGO', CONFIRMED: 'PAGO', OVERDUE: 'VENCIDO', PENDING: 'PENDENTE', REFUNDED: 'ESTORNADO' };

async function asaasGetByDate(dateStr) {
  const headers = { 'access_token': ASAAS_KEY };
  let payments = [], offset = 0;
  while (true) {
    const r = await httpsGet('api.asaas.com',
      `/v3/payments?dueDate%5Bge%5D=${dateStr}&dueDate%5Ble%5D=${dateStr}&limit=100&offset=${offset}`, headers);
    if (!r.data || !r.data.length) break;
    payments = payments.concat(r.data);
    if (!r.hasMore) break;
    offset += 100;
  }
  return payments;
}

async function buildRecebiveis(dateStr) {
  const raw = await asaasGetByDate(dateStr);
  const mens = raw.filter(p => {
    const d = (p.description || '').toLowerCase();
    return !d.startsWith('reserva de') && !d.startsWith('parcela');
  });
  const ids = [...new Set(mens.map(p => p.customer))];
  for (let i = 0; i < ids.length; i += 10)
    await Promise.all(ids.slice(i, i + 10).map(id => asaasGetCustomerCached(id)));

  const list = mens.map(p => {
    const cust = _custCache[p.customer] || {};
    return {
      id: p.id,
      nome: cust.nome || '',
      cpf: cust.cpf || '',
      valor: p.value,
      vencimento: p.dueDate,
      status: STATUS_LABEL[p.status] || p.status,
      statusRaw: p.status,
      descricao: p.description || '',
      linkFatura: p.invoiceUrl || '',
      dataPagamento: p.paymentDate || null,
    };
  });

  const order = { VENCIDO: 0, PENDENTE: 1, PAGO: 2, ESTORNADO: 3 };
  list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  const esperado  = list.reduce((s, p) => s + p.valor, 0);
  const recebido  = list.filter(p => p.status === 'PAGO').reduce((s, p) => s + p.valor, 0);
  const vencido   = list.filter(p => p.status === 'VENCIDO').reduce((s, p) => s + p.valor, 0);
  const pendente  = list.filter(p => p.status === 'PENDENTE').reduce((s, p) => s + p.valor, 0);

  return {
    data: dateStr,
    resumo: {
      esperado, recebido, vencido, pendente,
      countTotal:    list.length,
      countPago:     list.filter(p => p.status === 'PAGO').length,
      countVencido:  list.filter(p => p.status === 'VENCIDO').length,
      countPendente: list.filter(p => p.status === 'PENDENTE').length,
      taxaRecuperacao:   esperado > 0 ? (recebido  / esperado * 100) : 0,
      taxaInadimplencia: esperado > 0 ? (vencido   / esperado * 100) : 0,
    },
    cobrancas: list,
    updatedAt: new Date().toISOString(),
  };
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path, headers }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('Parse error: ' + d.slice(0, 200))); } });
    }).on('error', reject);
  });
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('Parse error: ' + d.slice(0, 200))); } }); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function evoGetAll() {
  const auth = Buffer.from('sahlvidanaareia:A73C9883-351A-463C-A8B4-FC2F35ED473D').toString('base64');
  return new Promise((resolve, reject) => {
    let all = [];
    function fetchPage(skip) {
      httpsGet('evo-integracao.w12app.com.br', `/api/v1/members?take=100&skip=${skip}`, { Authorization: 'Basic ' + auth })
        .then(batch => {
          if (!Array.isArray(batch) || !batch.length) return resolve(all);
          all = all.concat(batch);
          if (batch.length < 100) return resolve(all);
          fetchPage(skip + 100);
        }).catch(reject);
    }
    fetchPage(0);
  });
}

async function asaasGetAllOverdue() {
  const headers = { 'access_token': ASAAS_KEY };
  let payments = [], offset = 0;
  while (true) {
    const r = await httpsGet('api.asaas.com', `/v3/payments?status=OVERDUE&limit=100&offset=${offset}`, headers);
    if (!r.data || !r.data.length) break;
    payments = payments.concat(r.data);
    if (!r.hasMore) break;
    offset += 100;
  }
  return payments;
}

async function asaasGetCustomer(id) {
  return httpsGet('api.asaas.com', `/v3/customers/${id}`, { 'access_token': ASAAS_KEY });
}

async function buildInadimplencia(evoMembers) {
  // Build EVO map by CPF
  const evoMap = {};
  for (const m of evoMembers) {
    const cpf = (m.document || '').replace(/\D/g, '');
    if (!cpf || cpf === '00000000000') continue;
    const celContact = (m.contacts || []).find(c => c.contactType === 'Cellphone' || c.idContactType === 2);
    const telEvo = celContact ? celContact.description.replace(/\D/g, '') : '';
    evoMap[cpf] = { status: m.membershipStatus || m.status, nome: (m.firstName + ' ' + m.lastName).trim(), telefone: telEvo };
  }

  // Fetch all overdue payments from Asaas
  const payments = await asaasGetAllOverdue();

  // Filtrar apenas mensalidades (excluir reservas avulsas de quadra e inscrições)
  const isMensalidade = p => {
    const desc = (p.description || '').toLowerCase();
    return !desc.startsWith('reserva de') && !desc.startsWith('parcela');
  };

  // Group by customer ID
  const byCustomer = {};
  for (const p of payments.filter(isMensalidade)) {
    if (!byCustomer[p.customer]) byCustomer[p.customer] = [];
    byCustomer[p.customer].push(p);
  }

  // Fetch customer details in batches of 10 (CPF needed for EVO cross-ref)
  const customerIds = Object.keys(byCustomer);
  const customerMap = {};
  for (let i = 0; i < customerIds.length; i += 10) {
    const batch = customerIds.slice(i, i + 10);
    await Promise.all(batch.map(async id => {
      try {
        const c = await asaasGetCustomer(id);
        customerMap[id] = { nome: c.name || '', cpf: (c.cpfCnpj || '').replace(/\D/g, ''), telefone: (c.mobilePhone || c.phone || '').replace(/\D/g, '') };
      } catch(e) { customerMap[id] = { nome: '', cpf: '', telefone: '' }; }
    }));
  }

  // Build by CPF
  const byCpf = {};
  for (const [custId, pmts] of Object.entries(byCustomer)) {
    const cust = customerMap[custId] || {};
    const cpf = cust.cpf || '';
    const nome = cust.nome || custId;
    const key = cpf || custId;
    if (!byCpf[key]) {
      const telEvo = (cpf && evoMap[cpf]) ? evoMap[cpf].telefone : '';
      byCpf[key] = { nome, cpf, telefone: telEvo || cust.telefone || '', cobras: [], total: 0 };
    }
    for (const p of pmts) {
      byCpf[key].cobras.push({ valor: p.value, venc: p.dueDate, plano: p.description || '', link: p.invoiceUrl || '' });
      byCpf[key].total += p.value;
    }
  }

  const fantasmas = [], ativos = [], naoEncontrados = [];
  for (const [key, d] of Object.entries(byCpf)) {
    const evo = d.cpf ? evoMap[d.cpf] : null;
    const meses = [...new Set(d.cobras.map(c => c.venc.slice(0, 7)))].sort();
    const entry = { ...d, meses, evoStatus: evo ? evo.status : null };
    if (!evo) naoEncontrados.push(entry);
    else if (evo.status === 'Active') ativos.push(entry);
    else fantasmas.push(entry);
  }

  fantasmas.sort((a, b) => b.total - a.total);
  ativos.sort((a, b) => b.total - a.total);
  naoEncontrados.sort((a, b) => b.total - a.total);
  return { fantasmas, ativos, naoEncontrados, updatedAt: new Date().toISOString() };
}

function toCsv(rows) {
  const header = 'Nome;CPF;Status EVO;Meses Devedores;Qtd Cobranças;Valor Total (R$)';
  const lines = rows.map(r =>
    `"${r.nome}";"${r.cpf}";"${r.evoStatus || 'Não encontrado'}";"${r.meses.join(', ')}";"${r.cobras.length}";"${r.total.toFixed(2).replace('.', ',')}"`
  );
  return header + '\n' + lines.join('\n');
}

app.get('/api/inadimplencia', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';
  const age = Date.now() - _inadCacheTs;
  if (_inadCache && age < 30 * 60 * 1000 && !forceRefresh) return res.json(_inadCache);
  try {
    const evo = await evoGetAll();
    _inadCache = await buildInadimplencia(evo);
    _inadCacheTs = Date.now();
    res.json(_inadCache);
  } catch(e) {
    console.error('[INADIMPLENCIA]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/inadimplencia/csv-fantasmas', (req, res) => {
  if (!_inadCache) return res.status(503).send('Dados não carregados ainda. Acesse a página primeiro.');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="fantasmas_asaas.csv"');
  res.send('\uFEFF' + toCsv(_inadCache.fantasmas));
});

app.get('/api/inadimplencia/csv-ativos', (req, res) => {
  if (!_inadCache) return res.status(503).send('Dados não carregados ainda. Acesse a página primeiro.');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inadimplentes_ativos.csv"');
  res.send('\uFEFF' + toCsv(_inadCache.ativos));
});

app.get('/inadimplencia', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inadimplencia.html'));
});

// ─── Recebíveis ───────────────────────────────────────────────────────────────
app.get('/api/recebiveis', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const dateStr = req.query.data || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
  const forceRefresh = req.query.refresh === '1';
  const age = Date.now() - (_recebCacheTs[dateStr] || 0);
  if (_recebCache[dateStr] && age < RECEBIVEIS_TTL && !forceRefresh) return res.json(_recebCache[dateStr]);
  try {
    _recebCache[dateStr] = await buildRecebiveis(dateStr);
    _recebCacheTs[dateStr] = Date.now();
    res.json(_recebCache[dateStr]);
  } catch(e) {
    console.error('[RECEBIVEIS]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/recebiveis', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'recebiveis.html'));
});

// ─── Gestão de inadimplentes (SQLite) ────────────────────────────────────────
function syncToDb(list) {
  const ins = db.prepare(`INSERT OR IGNORE INTO gestao_clientes (cpf,nome,status_gestao,data_entrada,valor_total) VALUES (?,?,'NOVO',?,?)`);
  const updValor = db.prepare(`UPDATE gestao_clientes SET nome=?, valor_total=? WHERE cpf=? AND status_gestao NOT IN ('RECUPERADO','PERDIDO')`);
  const now = new Date().toISOString();
  const sync = db.transaction(items => {
    for (const a of items) {
      if (!a.cpf) continue;
      ins.run(a.cpf, a.nome, now, a.total || 0);
      updValor.run(a.nome, a.total || 0, a.cpf);
    }
  });
  sync(list);
}

app.get('/api/inadimplencia/gestao', async (req, res) => {
  const forceRefresh = req.query.refresh === '1';
  const age = Date.now() - _inadCacheTs;
  try {
    if (!_inadCache || age > 30 * 60 * 1000 || forceRefresh) {
      const evo = await evoGetAll();
      _inadCache = await buildInadimplencia(evo);
      _inadCacheTs = Date.now();
    }
    // Sincroniza valor_total de todos os grupos (não só ativos)
    const todosOverdue = [
      ..._inadCache.ativos,
      ..._inadCache.fantasmas,
      ...(_inadCache.naoEncontrados || []),
    ];
    syncToDb(todosOverdue);

    // Auto-recuperação: quem saiu da lista OVERDUE do Asaas foi baixado
    const overdueAgora = new Set(todosOverdue.map(a => a.cpf).filter(Boolean));
    const valorMap = Object.fromEntries(todosOverdue.filter(a => a.cpf).map(a => [a.cpf, a.total]));

    const pendentesDb = db.prepare(
      `SELECT cpf, valor_total FROM gestao_clientes WHERE status_gestao NOT IN ('RECUPERADO','PERDIDO')`
    ).all();
    const nowAuto = new Date().toISOString();
    for (const row of pendentesDb) {
      if (row.cpf && !overdueAgora.has(row.cpf)) {
        // Preserva valor_total se já estava preenchido; caso contrário usa o valorMap (última snapshot)
        const valorSalvo = row.valor_total && row.valor_total > 0
          ? row.valor_total
          : (valorMap[row.cpf] || 0);
        db.prepare(
          `UPDATE gestao_clientes SET status_gestao='RECUPERADO', data_resolucao=?, valor_total=? WHERE cpf=?`
        ).run(nowAuto, valorSalvo, row.cpf);
      }
    }

    const dbMap = Object.fromEntries(
      db.prepare('SELECT * FROM gestao_clientes').all().map(r => [r.cpf, r])
    );
    const acoesMap = Object.fromEntries(
      db.prepare(`
        SELECT a.* FROM acoes_inadimplencia a
        INNER JOIN (SELECT cpf, MAX(id) as mid FROM acoes_inadimplencia GROUP BY cpf) m
        ON a.cpf=m.cpf AND a.id=m.mid
      `).all().map(a => [a.cpf, a])
    );

    const enrich = list => list.map(item => {
      const g = dbMap[item.cpf] || {};
      const ua = acoesMap[item.cpf] || null;
      return {
        ...item,
        statusGestao:   g.status_gestao || 'NOVO',
        dataEntrada:    g.data_entrada  || null,
        dataResolucao:  g.data_resolucao || null,
        observacao:     g.observacao    || '',
        ultimaAcao: ua ? { tipo: ua.tipo, resultado: ua.resultado, data: ua.data_acao, notas: ua.notas } : null,
      };
    });

    res.json({
      ..._inadCache,
      ativos:          enrich(_inadCache.ativos),
      fantasmas:       enrich(_inadCache.fantasmas),
      naoEncontrados:  enrich(_inadCache.naoEncontrados || []),
    });
  } catch(e) {
    console.error('[GESTAO INAD]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/inadimplencia/gestao/:cpf', (req, res) => {
  const { cpf } = req.params;
  const { status_gestao, observacao, nome } = req.body;
  const now = new Date().toISOString();
  const exists = db.prepare('SELECT cpf FROM gestao_clientes WHERE cpf=?').get(cpf);
  if (!exists) {
    db.prepare(`INSERT INTO gestao_clientes (cpf,nome,status_gestao,data_entrada,observacao) VALUES (?,?,?,?,?)`)
      .run(cpf, nome || '', status_gestao || 'NOVO', now, observacao || '');
  } else {
    const fields = [], vals = [];
    if (status_gestao !== undefined) {
      fields.push('status_gestao=?'); vals.push(status_gestao);
      if (status_gestao === 'RECUPERADO' || status_gestao === 'PERDIDO') {
        fields.push('data_resolucao=?'); vals.push(now);
      }
    }
    if (observacao !== undefined) { fields.push('observacao=?'); vals.push(observacao); }
    if (fields.length) db.prepare(`UPDATE gestao_clientes SET ${fields.join(',')} WHERE cpf=?`).run(...vals, cpf);
  }
  res.json({ ok: true });
});

app.post('/api/inadimplencia/gestao/:cpf/acao', (req, res) => {
  const { cpf } = req.params;
  const { tipo, resultado, notas, nome } = req.body;
  const now = new Date().toISOString();
  const exists = db.prepare('SELECT cpf FROM gestao_clientes WHERE cpf=?').get(cpf);
  if (!exists)
    db.prepare(`INSERT INTO gestao_clientes (cpf,nome,status_gestao,data_entrada) VALUES (?,?,'NOVO',?)`)
      .run(cpf, nome || '', now);
  db.prepare(`INSERT INTO acoes_inadimplencia (cpf,tipo,resultado,notas,data_acao,responsavel) VALUES (?,?,?,?,?,?)`)
    .run(cpf, tipo || 'OUTRO', resultado || 'SEM_RESPOSTA', notas || '', now, 'admin');
  db.prepare(`UPDATE gestao_clientes SET data_ultima_acao=? WHERE cpf=?`).run(now, cpf);
  // Auto-avança NOVO → EM_CONTATO na primeira ação
  const cur = db.prepare('SELECT status_gestao FROM gestao_clientes WHERE cpf=?').get(cpf);
  if (cur && cur.status_gestao === 'NOVO')
    db.prepare(`UPDATE gestao_clientes SET status_gestao='EM_CONTATO' WHERE cpf=?`).run(cpf);
  // Resultado "Pagou" → Recuperado
  if (resultado === 'PAGO')
    db.prepare(`UPDATE gestao_clientes SET status_gestao='RECUPERADO', data_resolucao=? WHERE cpf=?`).run(now, cpf);
  res.json({ ok: true });
});

app.get('/api/inadimplencia/gestao/:cpf/acoes', (req, res) => {
  const acoes = db.prepare(`SELECT * FROM acoes_inadimplencia WHERE cpf=? ORDER BY data_acao DESC LIMIT 50`)
    .all(req.params.cpf);
  res.json(acoes);
});

app.get('/api/inadimplencia/recuperados', (req, res) => {
  const rows = db.prepare(`
    SELECT g.*,
      CAST((julianday(substr(COALESCE(g.data_resolucao, datetime('now')), 1, 19)) - julianday(substr(g.data_entrada, 1, 19))) AS INTEGER) as dias_para_recuperar,
      (SELECT tipo FROM acoes_inadimplencia WHERE cpf=g.cpf ORDER BY data_acao DESC LIMIT 1) as ultimo_canal,
      (SELECT COUNT(*) FROM acoes_inadimplencia WHERE cpf=g.cpf) as num_acoes
    FROM gestao_clientes g
    WHERE g.status_gestao = 'RECUPERADO'
    ORDER BY g.data_resolucao DESC
  `).all();
  const total = rows.reduce((s, r) => s + (r.valor_total || 0), 0);
  const comTempo = rows.filter(r => r.dias_para_recuperar != null && r.dias_para_recuperar >= 0);
  const tempoMedio = comTempo.length
    ? Math.round(comTempo.reduce((s, r) => s + r.dias_para_recuperar, 0) / comTempo.length)
    : 0;
  res.json({ resumo: { count: rows.length, total, tempoMedio }, clientes: rows });
});

// ─── Correção histórica: popula valor_total dos recuperados ───────────────────
app.post('/api/inadimplencia/recuperados/fix-valores', async (req, res) => {
  // Roda em todos os recuperados (não só zerados) para corrigir valores inflados
  const clientes = db.prepare(
    `SELECT cpf, nome, data_entrada, data_resolucao FROM gestao_clientes WHERE status_gestao='RECUPERADO'`
  ).all();

  if (!clientes.length) return res.json({ ok: true, atualizados: 0, detalhes: [] });

  const headers = { 'access_token': ASAAS_KEY };
  const isMensalidade = desc => {
    const d = (desc || '').toLowerCase();
    return !d.startsWith('reserva de') && !d.startsWith('parcela');
  };

  const detalhes = [];
  for (const row of clientes) {
    try {
      // Janela de inadimplência: até 6 meses antes da entrada até a data de resolução
      const dataEntrada   = new Date(row.data_entrada  || row.data_resolucao || new Date());
      const dataResolucao = new Date(row.data_resolucao || new Date());
      const limiteInferior = new Date(dataEntrada);
      limiteInferior.setMonth(limiteInferior.getMonth() - 6);
      const dueDateMin = limiteInferior.toISOString().slice(0, 10); // YYYY-MM-DD
      const dueDateMax = dataResolucao.toISOString().slice(0, 10);

      // Busca o customer pelo CPF no Asaas
      const cs = await httpsGet('api.asaas.com', `/v3/customers?cpfCnpj=${row.cpf}`, headers);
      if (!cs.data || !cs.data.length) {
        detalhes.push({ cpf: row.cpf, nome: row.nome, valor: 0, erro: 'cliente não encontrado no Asaas' });
        continue;
      }
      const customerId = cs.data[0].id;

      // Busca pagamentos pagos (RECEIVED, CONFIRMED) e OVERDUE dentro da janela
      let allPayments = [];
      for (const status of ['RECEIVED', 'CONFIRMED', 'OVERDUE']) {
        let offset = 0;
        while (true) {
          const r = await httpsGet('api.asaas.com',
            `/v3/payments?customer=${customerId}&status=${status}&dueDateGe=${dueDateMin}&dueDateLe=${dueDateMax}&limit=100&offset=${offset}`, headers);
          if (!r.data || !r.data.length) break;
          allPayments = allPayments.concat(r.data);
          if (!r.hasMore) break;
          offset += 100;
        }
      }

      const todos = allPayments.filter(p => isMensalidade(p.description));
      const valor = todos.reduce((s, p) => s + (p.value || 0), 0);

      db.prepare(`UPDATE gestao_clientes SET valor_total=? WHERE cpf=?`).run(valor, row.cpf);
      detalhes.push({ cpf: row.cpf, nome: row.nome, valor, dueDateMin, dueDateMax });
    } catch (e) {
      detalhes.push({ cpf: row.cpf, nome: row.nome, valor: 0, erro: e.message });
    }
  }

  res.json({ ok: true, atualizados: detalhes.filter(d => !d.erro).length, detalhes });
});

// ─── Cobrança Avulsa ──────────────────────────────────────────────────────────
const SPLIT_CONFIG = {
  'futevolei':          { professor: 'Leuzera',  walletId: '88ef954d-93db-4c7b-b6c7-b93f5c2600b1', percentual: 45 },
  'futevolei-personal': { professor: 'Cardoso',  walletId: '272e4ca2-4ac4-48c8-ad3c-5e3e56c1b776', percentual: 45 },
  'beach-tennis':       { professor: 'Prof. BT', walletId: '79ac0c09-cfe5-4e5c-aad9-36d48a303a2e', percentual: 40 },
};

app.get('/api/cobranca/clientes', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const headers = { 'access_token': ASAAS_KEY };
    const isDoc = /^\d{11,14}$/.test(q.replace(/\D/g, ''));
    const param = isDoc ? `cpfCnpj=${encodeURIComponent(q.replace(/\D/g, ''))}` : `name=${encodeURIComponent(q)}`;
    const r = await httpsGet('api.asaas.com', `/v3/customers?${param}&limit=10`, headers);
    res.json((r.data || []).map(c => ({ id: c.id, name: c.name, cpfCnpj: c.cpfCnpj || '', email: c.email || '' })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cobranca/cliente', async (req, res) => {
  const { name, cpfCnpj, email, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const body = { name };
    if (cpfCnpj) body.cpfCnpj = cpfCnpj.replace(/\D/g, '');
    if (email)   body.email   = email;
    if (phone)   body.mobilePhone = phone.replace(/\D/g, '');
    const r = await httpsPost('api.asaas.com', '/v3/customers', { 'access_token': ASAAS_KEY }, body);
    if (r.errors) return res.status(400).json({ error: r.errors.map(e => e.description).join('; ') });
    res.json({ id: r.id, name: r.name, cpfCnpj: r.cpfCnpj || '' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cobranca/criar', async (req, res) => {
  const { customerId, valor, vencimento, descricao, modalidade, billingType } = req.body;
  if (!customerId || !valor || !vencimento) return res.status(400).json({ error: 'customerId, valor e vencimento são obrigatórios' });

  const body = {
    customer:    customerId,
    billingType: billingType || 'UNDEFINED',
    value:       parseFloat(valor),
    dueDate:     vencimento,
    description: descricao || 'Cobrança avulsa',
  };

  const split = SPLIT_CONFIG[modalidade];
  if (split) {
    body.split = [{ walletId: split.walletId, percentualValue: split.percentual }];
  }

  try {
    const r = await httpsPost('api.asaas.com', '/v3/payments', { 'access_token': ASAAS_KEY }, body);
    if (r.errors) return res.status(400).json({ error: r.errors.map(e => e.description).join('; ') });
    res.json({ id: r.id, invoiceUrl: r.invoiceUrl || '', bankSlipUrl: r.bankSlipUrl || '', status: r.status, split: split || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/cobranca-avulsa', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cobranca-avulsa.html'));
});

app.get('/download/antecipacao-leuzera', (req, res) => {
  const file = path.join(__dirname, 'public', 'relatorio-antecipacao-leuzera.csv');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="antecipacao-leuzera-2026-04-02.csv"');
  res.sendFile(file);
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  console.log(`Gestão SAHL rodando em http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    setTimeout(() => { server.close(); server.listen(PORT); }, 3000);
  } else { process.exit(1); }
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
