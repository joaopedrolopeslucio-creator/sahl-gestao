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
    evoMap[cpf] = { status: m.membershipStatus || m.status, nome: (m.firstName + ' ' + m.lastName).trim() };
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
        customerMap[id] = { nome: c.name || '', cpf: (c.cpfCnpj || '').replace(/\D/g, '') };
      } catch(e) { customerMap[id] = { nome: '', cpf: '' }; }
    }));
  }

  // Build by CPF
  const byCpf = {};
  for (const [custId, pmts] of Object.entries(byCustomer)) {
    const cust = customerMap[custId] || {};
    const cpf = cust.cpf || '';
    const nome = cust.nome || custId;
    const key = cpf || custId;
    if (!byCpf[key]) byCpf[key] = { nome, cpf, cobras: [], total: 0 };
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
