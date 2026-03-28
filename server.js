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

  // Group by customer ID
  const byCustomer = {};
  for (const p of payments) {
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
