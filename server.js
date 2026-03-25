const express = require('../waha-dashboard/node_modules/express');
const crypto  = require('crypto');
const path    = require('path');
const app     = express();
const PORT    = 3012;

const SENHA  = 'sahl2026';
const TOKEN  = crypto.createHash('sha256').update(SENHA + 'gestao-sahl-secret').digest('hex');
const COOKIE = 'gestao_auth';

app.use(express.urlencoded({ extended: false }));

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
