// Portão 3: o código está inteiro? Sintaxe, referências locais, build e testes do projeto.
// Uso: node scripts/portoes/portao-3.mjs <pasta>. Sai com 1 se algo falhar.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const pasta = process.argv[2];
if (!pasta || !existsSync(pasta)) { console.error('Uso: node scripts/portoes/portao-3.mjs <pasta>'); process.exit(2); }
const raiz = resolve(pasta);

const IGNORAR = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const listar = d => readdirSync(d).flatMap(n => {
  if (IGNORAR.has(n)) return [];
  const c = join(d, n);
  return statSync(c).isDirectory() ? listar(c) : [c];
});
const arquivos = listar(raiz);
const nome = f => relative(raiz, f).replaceAll('\\', '/');
const falhas = [], avisos = [], feitos = [];

if (!existsSync(join(raiz, 'index.html')) && !existsSync(join(raiz, 'package.json'))) falhas.push('Sem index.html nem package.json na raiz.');

for (const f of arquivos) {
  const ext = extname(f);
  if (ext === '.json' || ext === '.webmanifest') {
    try { JSON.parse(readFileSync(f, 'utf8')); } catch (e) { falhas.push(`JSON inválido em ${nome(f)}: ${e.message}`); }
  }
  if (ext === '.js' || ext === '.mjs') {
    // Módulo é conferido como .mjs para aceitar import e export em qualquer pasta.
    const eModulo = ext === '.mjs' || /^\s*(import|export)\s/m.test(readFileSync(f, 'utf8'));
    try {
      if (eModulo) execFileSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(f), stdio: ['pipe', 'pipe', 'pipe'] });
      else execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      falhas.push(`Sintaxe em ${nome(f)}: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 5).join(' | ')}`);
    }
  }
}

// Referência local que aponta para arquivo inexistente.
const conferirRef = (origem, ref) => {
  const r = ref.split(/[?#]/)[0];
  if (!r || /^(https?:|\/\/|data:|mailto:|tel:|javascript:|#)/i.test(ref)) return;
  const alvo = r.startsWith('/') ? join(raiz, r) : join(dirname(origem), r);
  const achou = existsSync(alvo) && (!statSync(alvo).isDirectory() || existsSync(join(alvo, 'index.html')));
  if (!achou) falhas.push(`${nome(origem)} aponta para arquivo inexistente: ${ref}`);
};
for (const f of arquivos.filter(a => extname(a) === '.html')) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) conferirRef(f, m[1]);
  if (!/<title>[^<]+<\/title>/i.test(html)) falhas.push(`${nome(f)} sem <title>.`);
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) falhas.push(`${nome(f)} sem meta viewport.`);
  if (!/<html[^>]+lang=/i.test(html)) falhas.push(`${nome(f)} sem lang no <html>.`);
}
for (const f of arquivos.filter(a => extname(a) === '.css')) {
  for (const m of readFileSync(f, 'utf8').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) conferirRef(f, m[1]);
}

// Build e testes, quando o projeto declara.
const pacote = join(raiz, 'package.json');
let temTeste = arquivos.some(f => /\.(test|spec)\.m?js$/.test(f));
if (existsSync(pacote)) {
  let scripts = {};
  try { scripts = JSON.parse(readFileSync(pacote, 'utf8')).scripts || {}; } catch (e) {}
  for (const s of ['build', 'test']) {
    if (!scripts[s]) continue;
    if (s === 'test') temTeste = true;
    try { execSync(`npm run --silent ${s}`, { cwd: raiz, stdio: 'pipe', timeout: 300000 }); feitos.push(`npm run ${s}: passou`); }
    catch (e) { falhas.push(`npm run ${s} falhou: ${String(e.stdout || '').slice(-400)} ${String(e.stderr || '').slice(-400)}`); }
  }
} else if (temTeste) {
  try { execFileSync(process.execPath, ['--test'], { cwd: raiz, stdio: 'pipe', timeout: 300000 }); feitos.push('node --test: passou'); }
  catch (e) { falhas.push(`node --test falhou: ${String(e.stdout || '').slice(-600)}`); }
}
if (!temTeste) avisos.push('Sem testes de unidade. Aceitável só em página sem lógica própria: quem cobre o comportamento é o portão 4.');

console.log(`Portão 3: ${arquivos.length} arquivos em ${relative(process.cwd(), raiz) || '.'}`);
feitos.forEach(x => console.log('  ok    ' + x));
avisos.forEach(x => console.log('  aviso ' + x));
falhas.forEach(x => console.log('  FALHA ' + x));
console.log(falhas.length ? `REPROVADO: ${falhas.length} falha(s).` : 'APROVADO.');
process.exit(falhas.length ? 1 : 0);
