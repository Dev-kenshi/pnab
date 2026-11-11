// Portão 4: funciona de verdade? Abre no navegador em 4 larguras e executa os critérios.
// Uso: node scripts/portoes/portao-4.mjs <pasta> [--criterios arquivo.json] [--telas pasta]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { servir } from './servidor.mjs';

const args = process.argv.slice(2);
const opcao = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const pasta = args[0];
if (!pasta || pasta.startsWith('--') || !existsSync(pasta)) { console.error('Uso: node scripts/portoes/portao-4.mjs <pasta> [--criterios arquivo.json] [--telas pasta]'); process.exit(2); }
const LARGURAS = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];

async function acharPlaywright() {
  const tentativas = [
    () => createRequire(join(process.cwd(), 'x.js'))('playwright'),
    () => import('playwright'),
    () => createRequire(join(execSync('npm root -g').toString().trim(), 'x.js'))('playwright')
  ];
  for (const t of tentativas) { try { return await t(); } catch (e) {} }
  return null;
}
const pw = await acharPlaywright();
if (!pw) { console.error('REPROVADO: Playwright não encontrado. Rode: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

let criterios = [];
const arquivoCriterios = opcao('--criterios');
if (arquivoCriterios) {
  try { criterios = JSON.parse(readFileSync(arquivoCriterios, 'utf8')); }
  catch (e) { console.error(`REPROVADO: critérios ilegíveis em ${arquivoCriterios}: ${e.message}`); process.exit(1); }
  if (!Array.isArray(criterios) || !criterios.length) { console.error('REPROVADO: arquivo de critérios sem critérios.'); process.exit(1); }
}
const telas = opcao('--telas');
if (telas) mkdirSync(telas, { recursive: true });

const { url, fechar } = await servir(pasta);
const navegador = await pw.chromium.launch();
const falhas = [], avisos = [], ok = [];

// Só erros do próprio site reprovam. Rede externa fora do ar vira aviso.
function vigiar(pagina, rotulo) {
  const erros = [];
  pagina.on('pageerror', e => erros.push(`erro de JavaScript: ${e.message}`));
  pagina.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) erros.push(`console: ${m.text()}`); });
  pagina.on('response', r => {
    if (r.status() < 400) return;
    if (r.url().startsWith(url)) { if (!r.url().endsWith('/favicon.ico')) erros.push(`${r.status()} em ${r.url().slice(url.length) || '/'}`); }
    else avisos.push(`${rotulo}: ${r.status()} externo em ${r.url()}`);
  });
  pagina.on('requestfailed', r => { if (!r.url().startsWith(url)) avisos.push(`${rotulo}: falha externa em ${r.url()}`); else erros.push(`falha ao carregar ${r.url().slice(url.length)}`); });
  return erros;
}

// Layout em cada largura, conforme a prática de checar em navegador real do Taste Skill.
for (const [w, h] of LARGURAS) {
  const ctx = await navegador.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  const erros = vigiar(p, `${w}px`);
  try {
    await p.goto(url, { waitUntil: 'load', timeout: 30000 });
    await p.waitForTimeout(400);
    const m = await p.evaluate(() => {
      const doc = document.documentElement;
      const largos = [...document.querySelectorAll('body *')].filter(e => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return r.width > 0 && r.right > innerWidth + 1 && s.position !== 'fixed' && !e.closest('[aria-hidden="true"]') && (() => { for (let a = e.parentElement; a; a = a.parentElement) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return false; } return true; })();
      }).slice(0, 3).map(e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''));
      return {
        rolagem: doc.scrollWidth - innerWidth, largos,
        texto: document.body.innerText.trim().length,
        h1: document.querySelectorAll('h1').length,
        imagens: [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src.startsWith(location.origin)).map(i => i.getAttribute('src')),
        semAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
        semRotulo: [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')].filter(c => !c.labels?.length && !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby')).length,
        pequenos: innerWidth <= 400 ? [...document.querySelectorAll('p, li, a, button, label')].filter(e => e.innerText?.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).length : 0
      };
    });
    const local = [];
    if (m.rolagem > 1) local.push(`rolagem horizontal de ${m.rolagem}px${m.largos.length ? ` (${m.largos.join(', ')})` : ''}`);
    if (m.texto < 20) local.push('página praticamente vazia');
    if (m.h1 !== 1) local.push(`${m.h1} títulos h1, o esperado é 1`);
    if (m.imagens.length) local.push(`imagens quebradas: ${m.imagens.join(', ')}`);
    if (m.semAlt) local.push(`${m.semAlt} imagens sem alt`);
    if (m.semRotulo) local.push(`${m.semRotulo} campos sem rótulo`);
    if (m.pequenos) local.push(`${m.pequenos} textos abaixo de 12px no celular`);
    local.push(...erros);
    if (telas) await p.screenshot({ path: join(telas, `${w}.png`), fullPage: true });
    if (local.length) local.forEach(x => falhas.push(`${w}px: ${x}`)); else ok.push(`layout em ${w}px`);
  } catch (e) { falhas.push(`${w}px: não abriu: ${e.message.split('\n')[0]}`); }
  await ctx.close();
}

// Critérios da spec, em desktop. Cada um começa de uma página limpa.
async function conferir(p, espera, limite = 3000) {
  if (!espera?.seletor) throw new Error('critério sem espera.seletor');
  // Só conta o que a pessoa vê. Elemento escondido no HTML não cumpre critério.
  const alvo = p.locator(espera.seletor).locator('visible=true');
  if (espera.ausente) { await p.waitForTimeout(300); if (await alvo.count()) throw new Error(`${espera.seletor} deveria estar ausente`); return; }
  await alvo.first().waitFor({ state: 'visible', timeout: limite }).catch(() => {});
  const n = await alvo.count();
  if (espera.contagem !== undefined && n !== espera.contagem) throw new Error(`${espera.seletor}: ${n} encontrados, esperado ${espera.contagem}`);
  if (espera.contagem_minima !== undefined && n < espera.contagem_minima) throw new Error(`${espera.seletor}: ${n} encontrados, mínimo ${espera.contagem_minima}`);
  if (espera.contagem === undefined && espera.contagem_minima === undefined && n === 0) throw new Error(`${espera.seletor}: nada encontrado`);
  if (espera.contem !== undefined) {
    const textos = await alvo.allInnerTexts();
    if (!textos.some(t => t.includes(espera.contem))) throw new Error(`${espera.seletor}: sem o texto "${espera.contem}"`);
  }
}
for (const c of criterios) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const erros = vigiar(p, c.id);
  p.setDefaultTimeout(4000);
  try {
    await p.goto(url + (c.rota || '').replace(/^\//, ''), { waitUntil: 'load', timeout: 30000 });
    // Critério com passos precisa provar a ação. Se o esperado já vale na página limpa e nenhum
    // passo "esperar" confere o meio do caminho, ele passaria mesmo com a ação quebrada.
    if (c.passos?.length && !c.passos.some(x => x.esperar)) {
      const jaVale = await conferir(p, c.espera, 300).then(() => true, () => false);
      if (jaVale) throw new Error('critério não prova a ação: o esperado já vale antes dos passos. Inclua um passo "esperar" que confira o estado intermediário.');
    }
    for (const passo of c.passos || []) {
      if (passo.clicar) await p.click(passo.clicar);
      else if (passo.preencher) {
        const [seletor, valor] = passo.preencher;
        if (await p.locator(seletor).first().evaluate(e => e.tagName === 'SELECT')) await p.selectOption(seletor, [{ value: valor }, { label: valor }]);
        else await p.fill(seletor, valor);
      }
      else if (passo.esperar) await p.waitForSelector(passo.esperar);
      else throw new Error(`passo desconhecido: ${JSON.stringify(passo)}`);
    }
    await conferir(p, c.espera);
    if (erros.length) throw new Error(erros.join('; '));
    ok.push(`${c.id}: ${c.descricao}`);
  } catch (e) { falhas.push(`${c.id}: ${c.descricao}. ${e.message.split('\n')[0]}`); }
  await ctx.close();
}

await navegador.close();
await fechar();

const relatorio = { pasta: resolve(pasta), aprovado: falhas.length === 0, passou: ok, falhas, avisos: [...new Set(avisos)] };
if (telas) writeFileSync(join(telas, 'portao-4.json'), JSON.stringify(relatorio, null, 2));
console.log(`Portão 4: ${LARGURAS.length} larguras e ${criterios.length} critérios`);
if (!arquivoCriterios) console.log('  aviso Sem arquivo de critérios: só o layout foi conferido.');
ok.forEach(x => console.log('  ok    ' + x));
relatorio.avisos.forEach(x => console.log('  aviso ' + x));
falhas.forEach(x => console.log('  FALHA ' + x));
console.log(falhas.length ? `REPROVADO: ${falhas.length} falha(s).` : 'APROVADO.');
process.exit(falhas.length ? 1 : 0);
