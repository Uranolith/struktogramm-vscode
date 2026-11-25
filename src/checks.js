'use strict';
/**
 * Prüfungen der Struktogramme (core/lint.js) in VS Code: Marken an den Elementen (über die Webansicht) und Einträge
 * in der Ansicht „Probleme“. Fehler (rot) = funktioniert nicht, Hinweis (gelb, in „Probleme“ als Warnung) = weicht von
 * bewährter Praxis oder üblichen Konventionen ab.
 * Einstellung struktogramm.checks: all (Fehler und Hinweise), errors (nur Fehler), off.
 * Hinweise je Gruppe abschaltbar: struktogramm.hints.bestPractice / .conventions / .confusion / .logic (Fehler immer).
 */
const vscode = require('vscode');
const { lintDoc, CATEGORIES } = require('./core/lint');
const { elementLines } = require('./core/nsdxml');
const { t } = require('./i18n');

class Checks {
  constructor(context) {
    this.diag = vscode.languages.createDiagnosticCollection('struktogramm');
    context.subscriptions.push(this.diag);
  }

  level() {
    const v = vscode.workspace.getConfiguration('struktogramm').get('checks', 'all');
    return ['all', 'errors', 'off'].includes(v) ? v : 'all';
  }

  /** Dokument prüfen; liefert die Meldungen für die Webansicht und füllt „Probleme“ */
  run(document, model) {
    const lvl = this.level();
    let items = [];
    if (model && lvl !== 'off') {
      try { items = lintDoc(model); } catch (e) { items = []; }
      if (lvl === 'errors') items = items.filter((x) => x.severity === 'error');
      // Hinweise je Gruppe
      const cfg = vscode.workspace.getConfiguration('struktogramm.hints');
      const off = new Set(CATEGORIES.filter((c) => cfg.get(c, true) === false));
      if (off.size) items = items.filter((x) => x.severity === 'error' || !off.has(x.category));
    }
    // Zeile im XML: die des Elements, sonst die des nächsten übergeordneten
    let lines = new Map();
    try { lines = elementLines(document.getText()).pathToLine; } catch (e) { /* unlesbar: Zeile 0 */ }
    const lineOf = (p) => {
      for (let q = p; q; q = q.includes('/') ? q.slice(0, q.lastIndexOf('/')) : '') if (lines.has(q)) return lines.get(q);
      return 0;
    };
    const diags = items.map((x) => {
      const ln = Math.min(Math.max(lineOf(x.path), 0), Math.max(document.lineCount - 1, 0));
      const text = document.lineCount ? document.lineAt(ln) : null;
      const range = text ? new vscode.Range(ln, text.firstNonWhitespaceCharacterIndex, ln, text.text.length) : new vscode.Range(0, 0, 0, 0);
      const d = new vscode.Diagnostic(range, x.message, x.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      d.source = x.severity === 'error' ? 'Struktograf' : `Struktograf · ${t('lint.cat.' + x.category)}`;
      // Klick auf den Code-Link in „Probleme“ markiert das Element im Struktogramm. (Die Zeile selbst kann das nicht:
      // VS Code gibt die Fundstelle an eigene Editoren nicht weiter.)
      const args = encodeURIComponent(JSON.stringify([document.uri.toString(), x.path]));
      d.code = { value: t('lint.showElement'), target: vscode.Uri.parse(`command:struktogramm.revealProblem?${args}`) };
      return d;
    });
    this.diag.set(document.uri, diags);
    return items.map((x) => ({ ...x, label: t(x.severity === 'error' ? 'lint.error' : 'lint.hint'), catLabel: x.severity === 'error' ? '' : t('lint.cat.' + x.category) }));
  }

  clear(uri) { this.diag.delete(uri); }
}

module.exports = { Checks };
