// Live-Ansicht für Testläufe im Terminal (tasktest.js, fuzz.js): Fortschrittsbalken, Laufzeit und Restzeit, laufende
// Aufgabe mit dem Stand je Sprache, Ergebnis je Sprache und die letzten Fehler. Die Testskripte melden jedes Ereignis
// (Aufgabe begonnen, Sprache fertig, Aufgabe fertig); neu gezeichnet wird nur dann – und einmal je Sekunde für die Uhr.
// Ohne Terminal (CI, Umleitung in eine Datei) oder mit --plain schreiben die Skripte wie bisher Zeile für Zeile.
'use strict';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const MARK = { O: C.green + 'O', X: C.red + 'X', K: C.yellow + 'K', B: C.cyan + 'B', '-': C.dim + '–' };
const fmtTime = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`);
const bar = (p, w) => C.green + '█'.repeat(Math.round(p * w)) + C.dim + '░'.repeat(w - Math.round(p * w)) + C.reset;
/** sichtbare Länge ohne Farbcodes */
const vis = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

class LiveView {
  /**
   * @param {{ title: string, unit: string, langs: {id: string, label: string}[], total: number, out?: NodeJS.WriteStream }} o
   */
  constructor({ title, unit, langs, total, out = process.stdout }) {
    Object.assign(this, { title, unit, langs, total, out });
    this.done = 0;
    this.phase = '';
    this.info = [];
    this.current = null; // { name, langs: { id: status } }
    this.per = Object.fromEntries(langs.map((l) => [l.id, { O: 0, X: 0, K: 0, B: 0, '-': 0 }]));
    this.errors = []; // { name, lines: [] }
    this.started = Date.now();
    this.finished = null;
    this.pending = false;
    this.out.write('\x1b[?25l\x1b[2J'); // Cursor aus, Bildschirm leeren
    const restore = () => this.out.write('\x1b[?25h');
    process.once('exit', restore);
    process.once('SIGINT', () => { restore(); process.exit(130); });
    this.timer = setInterval(() => this.render(), 1000);
    this.timer.unref();
    this.render();
  }

  /** Abschnitt des Laufs (z. B. „Code erzeugen“) und optional Zeilen darunter */
  setPhase(text, info = []) { this.phase = text; this.info = info; this.update(); }
  setTotal(n) { this.total = n; this.update(); }
  /** Zeilen unter dem Abschnitt ersetzen (z. B. Stand des gemeinsamen Übersetzens) */
  setInfo(lines) { this.info = lines; this.update(); }

  /** Aufgabe begonnen: alle Sprachen noch offen */
  startItem(name) { this.current = { name, langs: {} }; this.update(); }

  /** eine Sprache ist mit der laufenden Aufgabe fertig (Status O/X/K/B/-) */
  langDone(id, status) { if (this.current) { this.current.langs[id] = status; this.update(); } }

  /**
   * Aufgabe fertig: endgültiger Status je Sprache und Fehlerzeilen. Ohne startItem (viele Aufgaben gleichzeitig,
   * Zufallstest) zählt jeder Aufruf als ein erledigter Schritt.
   */
  itemDone(name, statuses, errorLines = [], steps = 1) {
    for (const [id, st] of Object.entries(statuses)) if (this.per[id] && this.per[id][st] != null) this.per[id][st]++;
    if (errorLines.length) this.errors.push({ name, lines: errorLines });
    this.done += steps;
    if (this.current && this.current.name === name) this.current = null;
    this.update();
  }

  /** Lauf beendet: Ergebniszeile (grün/rot) und weitere Zeilen; danach bleibt die Ansicht stehen */
  finish(summary, ok, more = []) {
    this.finished = { summary, ok, more, at: Date.now() };
    clearInterval(this.timer);
    this.render();
    this.out.write('\x1b[?25h\n');
  }

  update() {
    if (this.pending) return;
    this.pending = true;
    setImmediate(() => { this.pending = false; this.render(); }); // mehrere Ereignisse gleichzeitig: einmal zeichnen
  }

  render() {
    const cols = Math.max(60, Math.min(this.out.columns || 100, 160));
    const rows = Math.max(20, this.out.rows || 40);
    const end = this.finished ? this.finished.at : Date.now();
    const elapsed = (end - this.started) / 1000;
    const p = this.total ? Math.min(1, this.done / this.total) : 0;
    const eta = this.done && !this.finished ? (elapsed / this.done) * (this.total - this.done) : 0;
    const L = [];
    L.push(`${C.bold}${this.title}${C.reset}`);
    L.push('');
    L.push(`${bar(p, Math.min(40, cols - 40))}  ${C.bold}${this.done}/${this.total || '?'}${C.reset} ${this.unit}  (${Math.round(p * 100)} %)`);
    L.push(`Laufzeit ${fmtTime(elapsed)}` + (eta ? `   ·   noch etwa ${fmtTime(eta)}` : ''));
    L.push('');
    if (this.finished) {
      L.push((this.finished.ok ? C.green : C.red) + C.bold + '■ FERTIG: ' + this.finished.summary + C.reset);
      for (const m of this.finished.more) L.push(m);
    } else if (this.current) {
      const marks = this.langs.map((l) => (this.current.langs[l.id] ? MARK[this.current.langs[l.id]] + C.reset : C.dim + '·' + C.reset)).join(' ');
      L.push(`${C.cyan}▶${C.reset} ${this.current.name}   ${marks}`);
    } else if (this.phase) L.push(`${C.cyan}▶${C.reset} ${this.phase}`);
    if (!this.finished) for (const i of this.info) L.push(`  ${C.dim}${i}${C.reset}`);
    L.push('');
    const w = Math.max(...this.langs.map((l) => l.label.length), 7);
    L.push(`${C.bold}${'Sprache'.padEnd(w)}  erfolgreich  Fehler  bekannt${C.reset}`);
    for (const l of this.langs) {
      const s = this.per[l.id];
      const col = (n, c, width) => (n ? c : C.dim) + String(n).padStart(width) + C.reset;
      L.push(`${l.label.padEnd(w)}  ${col(s.O, C.green, 11)}  ${col(s.X, C.red, 6)}  ${col(s.K + s.B, C.yellow, 7)}`);
    }
    L.push('');
    if (this.errors.length) {
      L.push(`${C.red}${C.bold}Fehler (${this.errors.length}):${C.reset}`);
      const room = Math.max(4, rows - L.length - 3);
      const lines = [];
      for (const e of this.errors) { lines.push(`  ${C.red}✗${C.reset} ${e.name}`); for (const x of e.lines.slice(0, 3)) lines.push(`      ${C.dim}${x}${C.reset}`); }
      if (lines.length > room) L.push(`  ${C.dim}… ${lines.length - room + 1} Zeilen davor${C.reset}`);
      L.push(...lines.slice(-room + (lines.length > room ? 1 : 0)));
    } else L.push(`${C.green}${this.finished ? 'Keine Fehler.' : 'Bisher keine Fehler.'}${C.reset}`);
    // Zeilen auf Fensterbreite kürzen, an den Anfang springen, jede Zeile überschreiben, Rest löschen
    const fit = (s) => (vis(s).length > cols - 1 ? vis(s).slice(0, cols - 2) + '…' : s);
    this.out.write('\x1b[H' + L.map((s) => fit(s) + C.reset + '\x1b[K').join('\n') + '\n\x1b[J');
  }
}

/** Live-Ansicht verwenden? Nur im Terminal, nicht in der CI und nicht mit --plain */
function liveWanted(args) {
  return !!process.stdout.isTTY && !process.env.CI && !args.includes('--plain');
}

module.exports = { LiveView, liveWanted, vis };
