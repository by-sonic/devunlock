// Разбор аргументов командной строки без зависимостей.
export function parseArgs(argv) {
  const opts = { _: [], domain: [] };
  const dashdash = argv.indexOf('--');
  const head = dashdash >= 0 ? argv.slice(0, dashdash) : argv;
  opts.rest = dashdash >= 0 ? argv.slice(dashdash + 1) : [];
  const bool = new Set(['json', 'quiet', 'all', 'verbose', 'help', 'version']);
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a === '-h') { opts.help = true; continue; }
    if (a === '-v') { opts.version = true; continue; }
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    let [key, val] = a.slice(2).split(/=(.*)/s);
    if (bool.has(key)) { opts[key] = true; continue; }
    if (val === undefined) {
      val = head[++i];
      if (val === undefined) throw new Error(`Флагу --${key} нужно значение`);
    }
    if (key === 'domain') opts.domain.push(val);
    else opts[key] = val;
  }
  return opts;
}
