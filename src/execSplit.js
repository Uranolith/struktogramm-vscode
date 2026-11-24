'use strict';
/**
 * Aufteilung der Ausführungsanzeige (Breite von Turtleizer und Variablen/Aufrufe-Bereich als Anteil der Breite)
 * und Spaltenbreiten der Variablentabelle (cols: Name, Wert, Typ).
 * Gemeinsam für die Anzeige im Editor und im Panel unten; dauerhaft im globalState gespeichert.
 */
const KEY = 'struktograf.execSplit';
let context = null;

function init(ctx) { context = ctx; }

/** gespeicherte Aufteilung { side, turtle } (Anteile 0…1) oder null */
function getSplit() {
  return (context && context.globalState.get(KEY)) || null;
}

function setSplit(v) {
  if (!context || !v || typeof v !== 'object') return;
  const frac = (x) => (typeof x === 'number' && x > 0.02 && x < 0.95 ? Math.round(x * 1000) / 1000 : undefined);
  // Spalten der Variablentabelle: drei Anteile, Summe 1
  const cols = Array.isArray(v.cols) && v.cols.length === 3 && v.cols.every((x) => typeof x === 'number' && x > 0.02 && x < 0.96)
    && Math.abs(v.cols.reduce((a, b) => a + b, 0) - 1) < 0.01 ? v.cols.map((x) => Math.round(x * 1000) / 1000) : undefined;
  context.globalState.update(KEY, { side: frac(v.side), turtle: frac(v.turtle), cols });
}

module.exports = { init, getSplit, setSplit };
