'use strict';
/**
 * Steuert eine Ausführung (Interpreter-Generator) und spricht mit dem Webview.
 * Webview -> {type:'exec', cmd:'run'|'step'|'pause'|'stop'|'config', root, delay, breakpoints}
 *            {type:'execInput', value}
 * Extension -> {type:'execState', state, path, frames, prompt, error, errorPath}
 *              {type:'execOut', lines:[{text, kind}]}
 */
const { Interpreter, Signal, fmt } = require('./core/executor');
const { t } = require('./i18n');

class ExecSession {
  constructor(webview, model, rootIndex, opts = {}) {
    this.webview = webview;
    this.model = model;
    this.rootIndex = rootIndex;
    this.interp = new Interpreter(model, opts);
    this.gen = this.interp.run(rootIndex);
    this.mode = 'run';
    this.delay = 250;
    this.breakpoints = new Set();
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
    if (Array.isArray(msg.breakpoints)) this.breakpoints = new Set(msg.breakpoints);
  }

  post(state, extra = {}) {
    this.flushOut();
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
    this.mode = mode;
    if (!this.timer) this.timer = setTimeout(() => this.pump(), 0);
    if (mode === 'run') this.post('running');
  }

  pause() {
    if (this.state !== 'running') return;
    this.mode = 'step';
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
    this.state = this.mode === 'run' ? 'running' : 'paused';
    this.timer = setTimeout(() => this.pump(), 0);
  }

  finish(err) {
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
      this.out(t('exec.error', err.message), 'err');
      this.post('done', { error: err.message, errorPath: err.path || this.path });
    }
  }

  pump() {
    this.timer = null;
    const t0 = Date.now();
    let budget = this.mode === 'run' && this.delay === 0 ? 20000 : 50;
    while (budget-- > 0) {
      let r;
      try { r = this.gen.next(this.pending); } catch (e) { this.finish(e); return; }
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
      if (!y.loop && this.breakpoints.has(y.path) && this.mode === 'run') {
        this.mode = 'step';
        this.out(t('exec.breakpoint'), 'info');
        this.post('paused');
        return;
      }
      if (this.mode === 'step') { this.post('paused'); return; }
      if (this.delay > 0) {
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
          this.webview.postMessage({ type: 'execReset', title: (model.roots[idx].text || []).join(' ') });
          this.session.resume(msg.cmd);
        } else {
          s.config(msg);
          s.resume(msg.cmd);
        }
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
      this.session.out(reason || '■ Abgebrochen.', 'info');
      this.session.stop();
    }
  }

  get running() { return !!(this.session && this.session.state !== 'done'); }
}

module.exports = { ExecController };
