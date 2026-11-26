'use strict';
/**
 * Nachrichten an Webansichten, die inzwischen geschlossen sein können (Editor, Vorschau, Seitenleiste).
 * Nach dem Schließen wirft schon der Zugriff auf panel.webview („Webview is disposed“), und postMessage liefert ein
 * abgelehntes Versprechen – beides würde sonst als nicht abgefangener Fehler der Erweiterung gezählt.
 */

/** target: Webansicht (oder etwas mit postMessage) bzw. Funktion, die sie liefert. Ergebnis: Promise<boolean> */
function safePost(target, msg) {
  try {
    const w = typeof target === 'function' ? target() : target;
    if (!w) return Promise.resolve(false);
    const r = w.postMessage(msg);
    return r && typeof r.then === 'function' ? r.then((ok) => ok, () => false) : Promise.resolve(r !== false);
  } catch (e) {
    return Promise.resolve(false);
  }
}

/** Ziel mit abgesichertem postMessage (für Ausführung und andere Absender, die das Ziel behalten) */
function safeTarget(target) {
  return { postMessage: (msg) => safePost(target, msg) };
}

module.exports = { safePost, safeTarget };
