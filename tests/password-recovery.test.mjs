import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readRecoveryLink, passwordRecoveryLink } from '../src/lib/password-recovery.ts';
import { emailRedefinicaoSenha } from '../src/lib/email-templates.ts';

const token = 'a'.repeat(64);

test('O link aponta ao domínio Planning e o token nunca chega na requisição HTTP', async () => {
  const link = passwordRecoveryLink(token);
  const url = new URL(link);
  assert.equal(url.origin, 'https://planningbrain.com.br');
  assert.equal(url.pathname, '/redefinir-senha');
  assert.equal(url.search, '');
  let received;
  const server = createServer((req, res) => { received = req.url; res.end('ok'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.hash}`);
    assert.equal(received, '/redefinir-senha');
  } finally { await new Promise((resolve) => server.close(resolve)); }
  assert.deepEqual(readRecoveryLink(link), { kind: 'token', tokenHash: token });
});

test('Ler o link várias vezes não consome o token e não chama o Auth', (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Não chamar Auth ao abrir'); });
  for (let i = 0; i < 5; i++) assert.equal(readRecoveryLink(passwordRecoveryLink(token)).kind, 'token');
  assert.equal(fetch.mock.callCount(), 0);
});

test('Tokens de outro fluxo e erros não autorizam redefinir a senha da sessão existente', () => {
  assert.equal(readRecoveryLink('https://planningbrain.com.br/redefinir-senha').kind, 'missing');
  assert.equal(readRecoveryLink(`https://planningbrain.com.br/redefinir-senha#token_hash=${token}&type=invite`).kind, 'invalid');
  assert.equal(readRecoveryLink('https://planningbrain.com.br/redefinir-senha#error=access_denied&error_code=otp_expired').kind, 'invalid');
  assert.equal(readRecoveryLink('https://planningbrain.com.br/redefinir-senha#access_token=ordinary-session&type=signin').kind, 'missing');
  assert.throws(() => passwordRecoveryLink('bad-token'));
});

test('Emails antigos válidos preservam a identidade do token para conferir a sessão', () => {
  assert.deepEqual(readRecoveryLink('https://planningbrain.com.br/redefinir-senha#access_token=legacy-token&type=recovery'), { kind: 'legacy', accessToken: 'legacy-token' });
});

test('HTML mantém um link próprio e não permite inserir conteúdo via nome', () => {
  const link = passwordRecoveryLink(token);
  const mail = emailRedefinicaoSenha({ nome: '<img/src=x>', email: 'usuario@example.com', link });
  assert.ok(mail.html.includes('#token_hash=' + token + '&amp;type=recovery'));
  assert.equal(mail.html.includes('supabase.co'), false);
  assert.equal(mail.html.includes('<img/src=x>'), false);
  assert.ok(mail.text.includes(link));
});
