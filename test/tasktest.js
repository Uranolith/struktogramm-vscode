// Aufgabentest: jedes Struktogramm in test/samples in alle Zielsprachen übersetzen, mit dem echten Compiler bzw.
// Interpreter der Sprache übersetzen und ausführen (keine Simulation) und die Ausgabe mit dem eingebauten
// Interpreter vergleichen. Ergebnis: Konsole plus Excel-Protokoll (O = erfolgreich, X = nicht erfolgreich).
//
//   node test/tasktest.js [--out datei.xlsx] [sprache …] [teil-des-pfads …]
//   (oder test\tasktest.cmd bzw. npm test; Beispiel: „edge_cases java“)
//
// Die Struktogramme liegen nach Themen in Unterordnern von test/samples (z. B. branching, edge_cases).
// Je Ordner stehen die Testfälle in inputs.json: je Struktogramm eine Liste von Eingabefolgen (eine Zeile je INPUT).
// Ordner mit "_tasktest": false in inputs.json werden übersprungen (z. B. checks – absichtlich fehlerhaft).
//
// Ablauf in drei Schritten, jeweils mit Ausgabe in der Konsole:
//   1. Code erzeugen: test/samples/codefiles/<ordner>/<aufgabe>/Program.<endung> – bei jedem Lauf vollständig neu,
//      für alle Struktogramme in allen Sprachen (auch wenn nur ein Teil übersetzt und ausgeführt wird)
//   2. Übersetzen und ausführen: Aufgabe für Aufgabe, die Sprachen gleichzeitig; danach das Ergebnis jeder Sprache
//      mit jedem Testfall
//   3. Ergebnisse in der Excel-Datei speichern (test/out/tasktest.xlsx)
// Eine Aufgabe gilt in einer Sprache als erfolgreich, wenn das Programm übersetzt und bei allen Testfällen dieselbe
// Ausgabe liefert wie der Interpreter. Sprachen ohne installierten Compiler werden als „–“ (nicht geprüft) eingetragen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fromNsd } = require('../src/core/nsdxml');
const { generateCode, TARGETS } = require('../src/core/generators');
const S = require('./languages');
// Kommentare im erzeugten Code in der Sprache der Erweiterung (Einstellung struktogramm.language)
const CODE_LANG = require('./vscodelang').codeLanguage([path.join(__dirname, 'samples'), path.join(__dirname, '..')]);
require('../src/i18n').setLanguage(CODE_LANG.lang);

const SAMPLES = path.join(__dirname, 'samples');
const CODEFILES = path.join(SAMPLES, 'codefiles');
// „java python“ als ein Argument (z. B. aus der VS-Code-Aufgabe) an Leerzeichen trennen – außer dem Pfad nach --out
const args = process.argv.slice(2).flatMap((a, i, all) => (all[i - 1] === '--out' ? [a] : a.split(/\s+/))).filter(Boolean);
let out = path.join(__dirname, 'out', 'tasktest.xlsx');
const langFilter = [], fileFilter = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = path.resolve(args[++i]);
  else if (args[i] === '--sprache' || args[i] === '--lang') i++; // Sprache der Kommentare (test/vscodelang.js)
  else if (TARGETS[args[i]]) langFilter.push(args[i]);
  else fileFilter.push(args[i]);
}
const LANGS = Object.keys(TARGETS).filter((l) => !langFilter.length || langFilter.includes(l));

/** Alle Struktogramme: direkt in samples und in Themen-Unterordnern (ohne codefiles und versteckte Ordner) */
function findSamples() {
  const res = [];
  const visit = (dir, group) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // Ordner mit „_tasktest": false in inputs.json (z. B. checks – absichtlich fehlerhaft) überspringen
        let skip = false;
        try { skip = JSON.parse(fs.readFileSync(path.join(p, 'inputs.json'), 'utf8'))._tasktest === false; } catch (err) { /* keine inputs.json */ }
        if (p !== CODEFILES && !skip) visit(p, group ? `${group}/${e.name}` : e.name);
      }
      else if (/\.nsd$/i.test(e.name)) res.push({ group, file: e.name, abs: p, name: e.name.replace(/\.nsd$/i, ''), rel: group ? `${group}/${e.name}` : e.name });
    }
  };
  visit(SAMPLES, '');
  return res;
}
const ALL = findSamples();
const selected = ALL.filter((s) => !fileFilter.length || fileFilter.some((x) => s.rel.toLowerCase().includes(x.toLowerCase())));
if (!selected.length) { console.error(`Keine Struktogramme in ${SAMPLES}` + (fileFilter.length ? ` passend zu „${fileFilter.join(' ')}“` : '')); process.exit(2); }

/* Konsole: Farben nur im Terminal */
// Farben im Terminal; NO_COLOR schaltet sie ab, FORCE_COLOR erzwingt sie (auch bei umgeleiteter Ausgabe)
const color = !!process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0' || (process.stdout.isTTY && !process.env.NO_COLOR);
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const green = paint('32'), red = paint('31'), gray = paint('90'), bold = paint('1'), cyan = paint('36');
const mark = (st) => (st === 'O' ? green('O') : st === 'X' ? red('X') : gray('–'));
const label = (l) => TARGETS[l].label.replace(/ \(.*\)$/, '');
const LW = Math.max(...LANGS.map((l) => label(l).length));
const heading = (n, text) => console.log('\n' + bold(cyan(`[${n}/3] ${text}`)) + '\n' + gray('─'.repeat(70)));

/** Testfälle je Ordner aus inputs.json */
const inputCache = new Map();
function inputsFor(s) {
  const dir = path.dirname(s.abs);
  if (!inputCache.has(dir)) {
    let j = {};
    const f = path.join(dir, 'inputs.json');
    if (fs.existsSync(f)) { try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.warn(red(`${f} nicht lesbar: ${e.message}`)); } }
    inputCache.set(dir, j);
  }
  const c = inputCache.get(dir)[s.file];
  return Array.isArray(c) && c.length ? c : null;
}

const started = new Date();
console.log(bold('Aufgabentest') + gray(` – ${started.toLocaleString('de-DE')}`));
const groups = [...new Set(selected.map((s) => s.group))];
console.log(`${selected.length} Aufgaben × ${LANGS.length} Sprachen` + (groups.length ? gray(` – ${groups.map((g) => g || '(samples)').join(', ')}`) : '') +
  (fileFilter.length || langFilter.length ? gray(' (Auswahl)') : ''));
console.log(`Kommentare im Code: ${CODE_LANG.lang === 'de' ? 'Deutsch' : 'Englisch'}` + gray(` – ${CODE_LANG.source}`));

/* ------------------------------------------------------------------ */
/* 1. Code erzeugen                                                   */
/* ------------------------------------------------------------------ */
heading(1, `Code erzeugen → ${CODEFILES}`);
fs.rmSync(CODEFILES, { recursive: true, force: true });
const docs = new Map(), codes = new Map();
let genFiles = 0, genErrors = 0, lastGroup = null;
const NW = Math.max(...ALL.map((s) => s.name.length));
for (const s of ALL) {
  if (s.group !== lastGroup) { console.log(bold(s.group || '(samples)')); lastGroup = s.group; }
  const dir = path.join(CODEFILES, s.group, s.name);
  fs.mkdirSync(dir, { recursive: true });
  let doc;
  try { doc = fromNsd(fs.readFileSync(s.abs, 'utf8')); } catch (e) {
    fs.writeFileSync(path.join(dir, 'FEHLER.txt'), `Struktogramm nicht lesbar: ${e.message}\n`);
    console.log(`  ${red('X')} ${s.name.padEnd(NW)} ${red('Struktogramm nicht lesbar: ' + e.message)}`);
    genErrors++;
    continue;
  }
  docs.set(s.rel, doc);
  const written = [], failed = [];
  for (const lang of Object.keys(TARGETS)) {
    let code;
    try { code = generateCode(doc, lang, { className: S.CLASS_NAME }); codes.set(`${s.rel}|${lang}`, code); written.push(TARGETS[lang].ext); } catch (e) {
      code = `Codeerzeugung fehlgeschlagen: ${e.message}\n`;
      failed.push(`${label(lang)}: ${e.message}`);
    }
    fs.writeFileSync(path.join(dir, `${S.CLASS_NAME}.${TARGETS[lang].ext}`), code);
    genFiles++;
  }
  genErrors += failed.length;
  console.log(`  ${failed.length ? red('X') : green('O')} ${s.name.padEnd(NW)} ${written.length} Dateien ${gray('Program.{' + written.join(',') + '}')}`);
  for (const m of failed) console.log('      ' + red(m));
}
console.log(gray(`${genFiles} Dateien geschrieben` + (genErrors ? `, ${genErrors} Fehler` : '')));

/* Aufgaben laden und Referenzausgaben des Interpreters berechnen */
const tasks = selected.filter((s) => docs.has(s.rel)).map((s) => {
  const doc = docs.get(s.rel);
  const root = doc.roots.find((r) => r.rootType === 'program') || doc.roots[0];
  const defined = inputsFor(s);
  const tc = (defined || [[5]]).map((inp) => { const r = S.interpret(doc, inp); return { inputs: r.used, expected: r.output, refError: r.error }; });
  const title = root ? String(root.text[0] || '') : '';
  return { ...s, title: title.includes(':') ? title.split(':').slice(1).join(':').trim() : title, cases: tc, defaultInputs: !defined };
});

/* ------------------------------------------------------------------ */
/* 2. Übersetzen und ausführen                                        */
/* ------------------------------------------------------------------ */
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktest-'));
const available = new Map(LANGS.map((l) => [l, S.has(S.RUN[l].tool)]));
heading(2, 'Übersetzen und ausführen');
const missing = LANGS.filter((l) => !available.get(l));
if (missing.length) console.log(gray('Nicht installiert (werden als – eingetragen): ' + missing.map((l) => `${label(l)} (${S.RUN[l].tool})`).join(', ')));

/** Eine Aufgabe in einer Sprache: übersetzen, jeden Testfall ausführen und vergleichen */
async function runOne(t, lang) {
  if (!available.get(lang)) return { status: '-', detail: `${S.RUN[lang].tool} nicht installiert`, cases: [] };
  const R = S.RUN[lang];
  const code = codes.get(`${t.rel}|${lang}`);
  if (code == null) return { status: 'X', detail: 'Codeerzeugung fehlgeschlagen', cases: t.cases.map(() => ({ ok: false, detail: 'Codeerzeugung fehlgeschlagen' })) };
  const dir = path.join(WORK, lang, `${t.group}_${t.name}`.replace(/[^\w.-]/g, '_'));
  S.prepare(dir, lang);
  fs.writeFileSync(path.join(dir, R.file), code);
  const t0 = Date.now();
  const err = await S.build(lang, dir);
  const buildMs = Date.now() - t0;
  if (err) return { status: 'X', detail: 'Übersetzen: ' + err, buildMs, cases: t.cases.map(() => ({ ok: false, detail: 'nicht übersetzt' })) };
  const res = { status: 'O', detail: '', buildMs, cases: [] };
  for (const c of t.cases) {
    if (c.refError) { res.cases.push({ ok: false, detail: 'Interpreter: ' + c.refError }); res.status = 'X'; res.detail ||= 'Interpreter: ' + c.refError; continue; }
    const r = await S.run(lang, dir, c.inputs);
    let detail = null;
    if (r.error) detail = 'Start: ' + r.error.message;
    else if (r.timedOut) detail = 'Zeitüberschreitung';
    else {
      detail = S.diff(c.expected, r.stdout);
      if (!detail && r.status !== 0) detail = `Exitcode ${r.status}`;
      if (detail && r.stderr) detail += ' | ' + r.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
    }
    res.cases.push({ ok: !detail, detail: detail || '' });
    if (detail) { res.status = 'X'; res.detail ||= `Testfall ${res.cases.length}: ${detail}`; }
  }
  return res;
}

const results = {}; // results[rel][lang] = { status: 'O'|'X'|'-', cases: [{ ok, detail }], detail }

(async () => {
  for (const [k, t] of tasks.entries()) {
    console.log(`\n${bold(`Aufgabe ${k + 1}/${tasks.length}: ${t.group ? t.group + '/' : ''}${t.name}`)}${t.title ? gray(' – ' + t.title) : ''}`);
    t.cases.forEach((c, i) => console.log(gray(`  Testfall ${i + 1}: Eingabe ${c.inputs.length ? c.inputs.join(', ') : '(keine)'}`)));
    const res = await Promise.all(LANGS.map((l) => runOne(t, l)));
    results[t.rel] = Object.fromEntries(LANGS.map((l, i) => [l, res[i]]));
    LANGS.forEach((l, i) => {
      const r = res[i];
      const per = r.status === '-' ? gray('nicht installiert') : r.cases.map((c, j) => `${j + 1}:${c.ok ? green('O') : red('X')}`).join(' ');
      const ok = r.cases.filter((c) => c.ok).length;
      const sum = r.status === '-' ? '' : gray(` (${ok}/${t.cases.length} Testfälle${r.buildMs != null && S.RUN[l].build ? `, übersetzt in ${(r.buildMs / 1000).toFixed(1)} s` : ''})`);
      console.log(`  ${mark(r.status)} ${label(l).padEnd(LW)}  ${per}${sum}`);
      if (r.status === 'X') console.log('      ' + red(r.detail.split('\n')[0].slice(0, 220)));
    });
  }
  const seconds = Math.round((Date.now() - started) / 1000);

  /* Übersicht je Ordner */
  console.log('\n' + bold('Übersicht'));
  const short = (n) => n.replace(/^\d+_aufgaben_le\d+_/, '');
  const w = Math.max(...tasks.map((t) => short(t.name).length));
  const cw = Math.max(LW, 6);
  let okCount = 0, failed = 0, skipped = 0;
  for (const g of [...new Set(tasks.map((t) => t.group))]) {
    console.log('\n' + bold(g || '(samples)').padEnd(w) + '  ' + LANGS.map((l) => label(l).padEnd(cw)).join(' '));
    for (const t of tasks.filter((x) => x.group === g)) console.log(short(t.name).padEnd(w) + '  ' + LANGS.map((l) => mark(results[t.rel][l].status) + ''.padEnd(cw - 1)).join(' '));
  }
  for (const t of tasks) for (const l of LANGS) { const s = results[t.rel][l].status; if (s === 'O') okCount++; else if (s === 'X') failed++; else skipped++; }

  /* ---------------------------------------------------------------- */
  /* 3. Excel-Protokoll                                               */
  /* ---------------------------------------------------------------- */
  heading(3, 'Ergebnisse in Excel speichern');
  const report = {
    started: started.toISOString(), seconds, samples: SAMPLES,
    langs: LANGS.map((l) => ({ id: l, label: TARGETS[l].label })),
    tasks: tasks.map((t) => ({
      group: t.group, name: t.name, title: t.title, defaultInputs: t.defaultInputs,
      cases: t.cases.map((c) => ({ inputs: c.inputs, expected: c.expected })),
      results: results[t.rel],
    })),
  };
  const json = path.join(WORK, 'ergebnis.json');
  fs.writeFileSync(json, JSON.stringify(report));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const py = spawnSync('python', [path.join(__dirname, 'tasktest_excel.py'), json, out], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (py.status === 0) {
    const saved = (py.stdout || '').trim().split('\n').pop() || out;
    if (path.resolve(saved) !== path.resolve(out)) console.log(red(`${out} ist geöffnet und gesperrt – stattdessen gespeichert unter:`));
    console.log(`${green('O')} Excel-Protokoll: ${saved}`);
  } else {
    console.log(`${red('X')} Excel-Protokoll nicht geschrieben (Python mit openpyxl nötig: pip install openpyxl)`);
    console.log(gray((py.stderr || py.error || '').toString().trim().slice(-600)));
  }
  console.log(`${green('O')} Erzeugter Code: ${CODEFILES}`);

  const total = okCount + failed;
  console.log('\n' + bold(failed ? red(`${failed} von ${total} nicht erfolgreich`) : green(`alle ${total} erfolgreich`)) +
    gray(`${skipped ? `, ${skipped} nicht geprüft` : ''} – ${seconds} s`));
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exitCode = failed ? 1 : 0;
})();
