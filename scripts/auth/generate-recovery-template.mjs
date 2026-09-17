// Node 24. Uma única fonte visual para os emails do Auth e do administrador.
import { writeFileSync, readFileSync } from 'node:fs';
import { emailRecuperacaoSenha } from '../../src/lib/email-templates.ts';

const output = new URL('../../supabase/templates/recovery.html', import.meta.url);
const { html } = emailRecuperacaoSenha({
  link: 'https://planningbrain.com.br/redefinir-senha#token_hash={{ .TokenHash }}&type=recovery',
  codigo: '{{ .Token }}',
});
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== html + '\n') throw new Error('Regenere o template de recuperação.');
} else {
  writeFileSync(output, html + '\n');
}
