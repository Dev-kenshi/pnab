// Abre a prévia de uma entrega: node scripts/portoes/servir.mjs entregas/<projeto> [porta]
import { servir } from './servidor.mjs';

const [pasta, porta] = process.argv.slice(2);
if (!pasta) { console.error('Uso: node scripts/portoes/servir.mjs <pasta> [porta]'); process.exit(2); }
const { url } = await servir(pasta, Number(porta) || 4173);
console.log(`Prévia em ${url}. Ctrl+C para parar.`);
