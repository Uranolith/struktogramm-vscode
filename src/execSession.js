'use strict';
/**
 * Steuert eine Ausführung (Interpreter-Generator) und spricht mit dem Webview.
 * Webview -> {type:'exec', cmd:'run'|'step'|'over'|'out'|'pause'|'stop'|'config', root, delay, breakpoints, noDebug}
 *            {type:'execInput', value}
 * Extension -> {type:'execState', state, path, frames, prompt, error, errorPath, reason}
 * Modi: run (weiterlaufen), step (ein Schritt, auch in Unterprogramme hinein), over (Schritt über Aufrufe hinweg),
 * out (bis das aktuelle Unterprogramm verlassen ist). reason beim Anhalten: breakpoint | step | pause
 *              {type:'execOut', lines:[{text, kind}]}
 */
const { Interpreter, Signal, fmt, truthy } = require('./core/executor');
const { t } = require('./i18n');

/** Trefferzahl-Bedingung eines Haltepunkts: „3“ (ab dem 3. Mal), „>= 3“, „== 3“, „> 3“, „< 3“, „% 2“ (jedes 2. Mal) */
function hitMatches(cond, hits) {
  const m = /^\s*(>=|<=|==|=|>|<|%)?\s*(\d+)\s*$/.exec(String(cond));
  if (!m) return true;
  const n = Number(m[2]);
  switch (m[1] || '>=') {
    case '>=': return hits >= n;
    case '<=': return hits <= n;
    case '==': case '=': return hits === n;
    case '>': return hits > n;
    case '<': return hits < n;
    case '%': return n > 0 && hits % n === 0;
    default: return true;
  }
}

class ExecSession {
  constructor(webview, model, rootIndex, opts = {}) {
    this.webview = webview;
    this.model = model;
    this.rootIndex = rootIndex;
    this.interp = new Interpreter(model, opts);
    this.gen = this.interp.run(rootIndex);
    this.mode = 'run';
    this.delay = 200;
    this.breakpoints = new Map(); // Pfad -> { condition, hitCondition, logMessage, hits }
    this.functions = new Set();   // Funktionshaltepunkte: Namen von Unterprogrammen (klein geschrieben)
    this.breakOnError = false;    // bei Laufzeitfehlern anhalten (Debug-Sitzung)
    this.external = false;        // Haltepunkte kommen von VS Code (setDebug) statt aus der Webview
    this.lastFrameId = null;
    this.lastDepth = 0;
    this.state = 'idle';
    this.path = null;
    this.timer = null;
    this.pending = undefined;
    this.outBuf = [];
    this.lastPost = 0;
    this.steps = 0;
    this.started = Date.now();
  }

  config(msg) {
    if (msg.delay != null) this.delay = Math.max(0, Number(msg.delay) || 0);
    if (msg.noDebug) { this.noDebug = true; this.breakpoints = new Map(); this.functions = new Set(); } // Strg+F5
    // Haltepunkte aus der Webview (Live-Vorschau); im Struktogramm-Editor verwaltet sie VS Code (setDebug)
    if (Array.isArray(msg.breakpoints) && !this.external && !this.noDebug) this.breakpoints = new Map(msg.breakpoints.map((p) => [p, {}]));
  }

  /**
   * Haltepunkte von VS Code: { breakpoints: [{ path, condition, hitCondition, logMessage }], functions: [Name],
   * breakOnError }. Trefferzähler bleiben erhalten, solange der Haltepunkt gleich bleibt.
   */
  setDebug(opts) {
    this.external = true;
    if (opts.breakOnError != null) this.breakOnError = !!opts.breakOnError;
    if (this.noDebug) return;
    if (opts.breakpoints) {
      const old = this.breakpoints;
      this.breakpoints = new Map(opts.breakpoints.map((b) => {
        const prev = old.get(b.path);
        const same = prev && prev.condition === b.condition && prev.hitCondition === b.hitCondition && prev.logMessage === b.logMessage;
        return [b.path, { condition: b.condition, hitCondition: b.hitCondition, logMessage: b.logMessage, hits: same ? prev.hits : 0 }];
      }));
    }
    if (opts.functions) this.functions = new Set(opts.functions.map((n) => String(n).trim().toLowerCase()).filter(Boolean));
  }

  /** Ausdruck im aktuellen Aufruf sofort auswerten (Bedingungen, Logpoints, Debugkonsole) */
  evalNow(expr, path) {
    const g = this.interp.eval(expr, path || this.path);
    let r = g.next(), n = 0;
    while (!r.done) {
      if (r.value && r.value.type === 'input') throw new Error(t('dap.evalInput'));
      if (++n > 100000) throw new Error(t('dap.evalTooLong'));
      r = g.next();
    }
    return r.value;
  }

  /** Logpoint-Text: {Ausdruck} wird ausgewertet eingesetzt */
  interpolate(msg, path) {
    return String(msg).replace(/\{([^{}]+)\}/g, (m, e) => { try { return fmt(this.evalNow(e, path)); } catch (err) { return `{${e}: ${err.message}}`; } });
  }

  /** hält der Haltepunkt jetzt an? (Bedingung, Trefferzahl; Logpoints schreiben nur) */
  hitBreakpoint(bp, path) {
    if (bp.condition && String(bp.condition).trim()) {
      let v;
      try { v = this.evalNow(bp.condition, path); } catch (e) { this.out(t('exec.bpCondError', bp.condition, e.message), 'err'); return true; }
      if (!truthy(v)) return false;
    }
    bp.hits = (bp.hits || 0) + 1;
    if (bp.hitCondition && String(bp.hitCondition).trim() && !hitMatches(bp.hitCondition, bp.hits)) return false;
    if (bp.logMessage && String(bp.logMessage).trim()) { this.out(this.interpolate(bp.logMessage, path), 'info'); return false; }
    return true;
  }

  post(state, extra = {}) {
    this.flushOut();
    // beendete Aufrufe (Endzustände) als eigene Meldung, damit sie in der Anzeige erhalten bleiben
    const calls = this.interp.takeCalls();
    if (calls.items.length) this.webview.postMessage({ type: 'execCalls', items: calls.items, total: calls.total });
    const done = this.interp.takeCompleted();
    if (done.length) this.webview.postMessage({ type: 'execCompleted', items: done });
    this.state = state;
    this.lastPost = Date.now();
    this.webview.postMessage({ type: 'execState', state, path: this.path, frames: this.interp.snapshot(), steps: this.steps, ...extra });
  }

  out(text, kind = 'out') { this.outBuf.push({ text, kind }); }

  flushOut() {
    if (this.turtleBuf && this.turtleBuf.length) {
      this.webview.postMessage({ type: 'execTurtle', ops: this.turtleBuf });
      this.turtleBuf = [];
    }
    if (!this.outBuf.length) return;
    this.webview.postMessage({ type: 'execOut', lines: this.outBuf });
    this.outBuf = [];
  }

  /** Weiterlaufen ('run') oder einen Schritt ('step') ausführen */
  resume(mode) {
    if (this.state === 'done' || this.state === 'input') return;
    // nach dem Anhalten bei einem Laufzeitfehler: Fortsetzen beendet das Programm mit dem Fehler
    if (this.errorHalt) { const e = this.errorHalt; this.errorHalt = null; this.finish(e, true); return; }
    this.mode = mode;
    // Schritt über / Rücksprung: Aufruftiefe beim Start merken
    if (mode === 'over' || mode === 'out') this.depth = this.interp.frames.length;
    if (!this.timer) this.timer = setTimeout(() => this.pump(), 0);
    if (mode !== 'step') this.post('running');
  }

  pause() {
    if (this.state !== 'running') return;
    this.mode = 'step';
    this.pauseRequested = true;
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.state !== 'done') {
      this.out(t('exec.aborted'), 'info');
      this.path = null;
      this.post('done');
    }
    try { this.gen.return(); } catch { /* egal */ }
  }

  input(value) {
    if (this.state !== 'input') return;
    this.out(String(value), 'in');
    this.pending = value;
    this.state = this.mode === 'step' ? 'paused' : 'running';
    this.timer = setTimeout(() => this.pump(), 0);
  }

  finish(err, reported) {
    clearTimeout(this.timer);
    this.timer = null;
    const secs = ((Date.now() - this.started) / 1000).toFixed(1);
    if (!err) {
      this.out(t('exec.finished', this.steps, secs), 'info');
      this.path = null;
      this.post('done');
    } else if (err instanceof Signal && err.kind === 'exit') {
      this.out(t('exec.finishedExit', fmt(err.value)), 'info');
      this.path = null;
      this.post('done');
    } else if (err instanceof Signal) {
      this.out(t('exec.finishedKind', err.kind), 'info');
      this.path = null;
      this.post('done');
    } else {
      if (!reported) this.out(t('exec.error', err.message), 'err');
      this.post('done', { error: err.message, errorPath: err.path || this.path });
    }
  }

  pump() {
    this.timer = null;
    const t0 = Date.now();
    // Schritt über / Rücksprung laufen ohne Verzögerung durch (wie in anderen Debuggern)
    const fast = (this.mode === 'run' && this.delay === 0) || this.mode === 'over' || this.mode === 'out';
    let budget = fast ? 20000 : 50;
    while (budget-- > 0) {
      let r;
      try { r = this.gen.next(this.pending); } catch (e) {
        // Debug-Sitzung mit „Bei Laufzeitfehlern anhalten“: erst anhalten (Variablen ansehen), Fortsetzen beendet
        if (this.breakOnError && !this.noDebug && !(e instanceof Signal)) {
          this.errorHalt = e;
          this.mode = 'step';
          if (e.path) this.path = e.path;
          // Aufrufe zum Zeitpunkt des Fehlers wiederherstellen (beim Hochlaufen schon abgeräumt)
          if (Array.isArray(e.frames) && e.frames.length) {
            this.interp.frames = e.frames;
            const top = e.frames[e.frames.length - 1];
            if (top && e.path) top.at = e.path;
          }
          this.out(t('exec.error', e.message), 'err');
          this.post('paused', { reason: 'exception', description: e.message, errorPath: this.path });
          return;
        }
        this.finish(e);
        return;
      }
      this.pending = undefined;
      if (r.done) { this.finish(null); return; }
      const y = r.value;
      if (y.type === 'output') { this.out(y.text, y.info ? 'info' : 'out'); if (this.outBuf.length > 200) this.flushOut(); continue; }
      if (y.type === 'input') { this.post('input', { prompt: y.prompt }); return; }
      if (y.type === 'turtle') {
        (this.turtleBuf = this.turtleBuf || []).push(...y.ops);
        if (this.turtleBuf.length > 2000) this.flushOut();
        continue;
      }
      if (y.type !== 'step') continue;
      this.steps++;
      this.path = y.path;
      // aktuelle Stelle je Aufruf (für die Aufrufliste von VS Code)
      const frames = this.interp.frames;
      const top = frames[frames.length - 1];
      if (top) top.at = y.path;
      // Funktionshaltepunkt: beim Eintritt in ein Unterprogramm mit diesem Namen
      const entered = top && top.id !== this.lastFrameId && frames.length > this.lastDepth;
      this.lastFrameId = top ? top.id : null;
      this.lastDepth = frames.length;
      if (entered && this.mode !== 'step' && this.functions.has(String(top.name).toLowerCase())) {
        this.mode = 'step';
        this.out(t('exec.fnBreakpoint', top.name), 'info');
        this.post('paused', { reason: 'function breakpoint' });
        return;
      }
      const bp = !y.loop && this.mode !== 'step' ? this.breakpoints.get(y.path) : null;
      if (bp && this.hitBreakpoint(bp, y.path)) {
        this.mode = 'step';
        this.out(t('exec.breakpoint'), 'info');
        this.post('paused', { reason: 'breakpoint' });
        return;
      }
      if (this.mode === 'step') {
        this.post('paused', { reason: this.pauseRequested ? 'pause' : 'step' });
        this.pauseRequested = false;
        return;
      }
      const depth = this.interp.frames.length;
      if ((this.mode === 'over' && depth <= this.depth) || (this.mode === 'out' && depth < this.depth)) {
        this.mode = 'step';
        this.post('paused', { reason: 'step' });
        return;
      }
      if (this.mode === 'run' && this.delay > 0) {
        this.post('running');
        this.timer = setTimeout(() => this.pump(), this.delay);
        return;
      }
      if (Date.now() - t0 > 40) break;
    }
    if (Date.now() - this.lastPost > 120) this.post('running');
    else this.flushOut();
    this.timer = setTimeout(() => this.pump(), 0);
  }
}

/**
 * Bindet die Ausführung an ein Webview-Panel.
 * getModel(): liefert das aktuelle Modell
 */
class ExecController {
  /** getBaseDir: Ordner für relative Pfade der Datei-API (fileOpen …) */
  constructor(webview, getModel, getBaseDir) {
    this.webview = webview;
    this.getModel = getModel;
    this.getBaseDir = getBaseDir || (() => undefined);
    this.session = null;
    this.debug = null; // Haltepunkte von VS Code (Struktogramm-Editor); null = aus der Webview (Live-Vorschau)
  }

  /** Haltepunkte/Funktionshaltepunkte/„bei Fehlern anhalten“ von VS Code – gelten auch für spätere Ausführungen */
  setDebug(opts) {
    this.debug = { ...(this.debug || {}), ...opts };
    if (this.session && this.session.state !== 'done') this.session.setDebug(this.debug);
  }

  handle(msg) {
    if (msg.type === 'execInput') { if (this.session) this.session.input(msg.value); return true; }
    if (msg.type !== 'exec') return false;
    const s = this.session;
    switch (msg.cmd) {
      case 'run': case 'step':
        if (!s || s.state === 'done') {
          let model;
          try { model = this.getModel(); } catch (e) { this.webview.postMessage({ type: 'execOut', lines: [{ text: '✖ ' + e.message, kind: 'err' }] }); return true; }
          if (!model || !model.roots.length) return true;
          let idx = Number.isInteger(msg.root) && model.roots[msg.root] ? msg.root : model.roots.findIndex((r) => r.rootType === 'program');
          if (idx < 0) idx = 0;
          this.session = new ExecSession(this.webview, model, idx, { baseDir: this.getBaseDir() });
          this.session.config(msg);
          if (this.debug) this.session.setDebug(this.debug);
          this.webview.postMessage({ type: 'execReset', title: (model.roots[idx].text || []).join(' ') });
          this.session.resume(msg.cmd);
        } else {
          s.config(msg);
          s.resume(msg.cmd);
        }
        return true;
      case 'over': case 'out':
        if (s && s.state !== 'done') { s.config(msg); s.resume(msg.cmd); }
        return true;
      case 'pause': if (s) s.pause(); return true;
      case 'stop': if (s) s.stop(); return true;
      case 'config': if (s) s.config(msg); return true;
      default: return true;
    }
  }

  /** z.B. bei Änderungen am Diagramm */
  abort(reason) {
    if (this.session && this.session.state !== 'done') {
      this.session.out(reason || t('exec.aborted'), 'info');
      this.session.stop();
    }
  }

  get running() { return !!(this.session && this.session.state !== 'done'); }
}

module.exports = { ExecController };
