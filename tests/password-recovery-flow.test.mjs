import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordRecoveryFlow } from '../src/lib/password-recovery-flow.ts';

function fixture() {
  const calls = [];
  const user = { id: 'recovery-user' };
  const auth = {
    async verifyOtp(input) { calls.push(['verify', input]); return { data: { user, session: { user } }, error: null }; },
    async setSession(input) { calls.push(['legacy', input]); return { data: { user, session: { user } }, error: null }; },
    async getUser() { calls.push(['user']); return { data: { user }, error: null }; },
    async updateUser(input) { calls.push(['update', input]); return { data: { user }, error: null }; },
  };
  return { calls, auth };
}
const link = { kind: 'token', tokenHash: 'a'.repeat(56) };

test('Abrir a recuperação não consome o link; salvar verifica a identidade antes de trocar a senha', async () => {
  const { calls, auth } = fixture();
  const flow = createPasswordRecoveryFlow(auth, link);
  assert.equal(calls.length, 0);
  assert.deepEqual(await flow.save('valid-password'), { ok: true });
  assert.deepEqual(calls.map(c => c[0]), ['verify', 'user', 'update']);
  assert.equal(calls[0][1].type, 'recovery');
});

test('Código funciona sem o link e somente como OTP de recuperação', async () => {
  const { calls, auth } = fixture();
  const flow = createPasswordRecoveryFlow(auth, { kind: 'missing' });
  assert.deepEqual(await flow.save('valid-password', { email: ' synthetic@example.com ', token: '123456' }), { ok: true });
  assert.deepEqual(calls[0], ['verify', { email: 'synthetic@example.com', token: '123456', type: 'recovery' }]);
});

test('Link legado só estabelece sessão depois da confirmação', async () => {
  const { calls, auth } = fixture();
  const flow = createPasswordRecoveryFlow(auth, { kind: 'legacy', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await flow.save('valid-password'), { ok: true });
  assert.deepEqual(calls[0], ['legacy', { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }]);
});

test('OTP expirado não altera senha e erro de rede não é tratado como expiração', async () => {
  const { calls, auth } = fixture();
  auth.verifyOtp = async () => ({ data: {}, error: { code: 'otp_expired' } });
  assert.equal((await createPasswordRecoveryFlow(auth, link).save('valid-password')).expired, true);
  auth.verifyOtp = async () => { throw new Error('network'); };
  const failure = await createPasswordRecoveryFlow(auth, link).save('valid-password');
  assert.equal(failure.ok, false);
  assert.equal(failure.expired, undefined);
  assert.equal(calls.length, 0);
});

test('Sessão de outra pessoa nunca pode ser usada para alterar a senha', async () => {
  const { calls, auth } = fixture();
  auth.getUser = async () => ({ data: { user: { id: 'different-user' } }, error: null });
  const result = await createPasswordRecoveryFlow(auth, link).save('valid-password');
  assert.equal(result.ok, false);
  assert.equal(calls.some(c => c[0] === 'update'), false);
});

test('Senha recusada pode ser corrigida sem consumir o token uma segunda vez', async () => {
  const { calls, auth } = fixture();
  let attempts = 0;
  auth.updateUser = async () => ({ error: attempts++ === 0 ? { code: 'same_password' } : null });
  const flow = createPasswordRecoveryFlow(auth, link);
  assert.equal((await flow.save('old-password')).ok, false);
  assert.equal(flow.isVerified(), true);
  assert.deepEqual(await flow.save('new-password'), { ok: true });
  assert.equal(calls.filter(c => c[0] === 'verify').length, 1);
});

test('Duplo clique não verifica nem salva duas vezes', async () => {
  const { calls, auth } = fixture();
  const flow = createPasswordRecoveryFlow(auth, link);
  const first = flow.save('valid-password');
  assert.equal((await flow.save('valid-password')).ok, false);
  assert.deepEqual(await first, { ok: true });
  assert.equal(calls.filter(c => c[0] === 'verify').length, 1);
  assert.equal(calls.filter(c => c[0] === 'update').length, 1);
});

test('Link ausente não aproveita uma sessão já logada', async () => {
  const { calls, auth } = fixture();
  assert.equal((await createPasswordRecoveryFlow(auth, {kind:'missing'}).save('valid-password')).ok, false);
  assert.equal(calls.length, 0);
});

test('Senha provisória: a sessão prova a identidade, sem OTP e sem e-mail', async () => {
  const { calls, auth } = fixture();
  const flow = createPasswordRecoveryFlow(auth, { kind: 'sessao' });
  assert.deepEqual(await flow.save('valid-password'), { ok: true });
  assert.equal(calls.some(c => c[0] === 'verify'), false);
  assert.deepEqual(calls.map(c => c[0]), ['user', 'user', 'update']);
  assert.deepEqual(calls.at(-1), ['update', { password: 'valid-password' }]);
});

test('Senha provisória sem sessão viva não troca a senha', async () => {
  const { calls, auth } = fixture();
  auth.getUser = async () => ({ data: { user: null }, error: { code: 'session_not_found' } });
  const result = await createPasswordRecoveryFlow(auth, { kind: 'sessao' }).save('valid-password');
  assert.equal(result.ok, false);
  assert.equal(result.expired, true);
  assert.equal(calls.some(c => c[0] === 'update'), false);
});
