# Änderungen

## Unveröffentlicht
- **Neues Struktogramm** anlegen: über *Datei → Neue Datei …*, das Explorer-Kontextmenü auf Ordnern, ein Symbol in
  der Explorer-Leiste, das Menü ⋯ des Struktogramm-Editors und einen Knopf in dessen Werkzeugleiste. Statt eines
  Speichern-Dialogs genügt ein Dateiname; die Datei landet im gewählten Ordner bzw. neben der aktiven Datei.
- **Mehrsprachig:** Oberfläche, Meldungen, Befehle, Einstellungen und Kommentare im erzeugten Code auf Englisch und
  Deutsch – passend zur Anzeigesprache von VS Code (Deutsch bei `de`, sonst Englisch).
- Befehle nach VS-Code-Konvention benannt (Kategorie „Struktograf“, „...“ bei Befehlen mit Rückfrage), Symbol für
  „Neues Struktogramm“ im Stil der VS-Code-Symbole.
- Eigenes **Dateisymbol für `.nsd`** im Explorer (im Stil der Seti-Symbole, für helle und dunkle Themes);
  `.nsd` ist eine eigene Sprache „Struktogramm (NSD)“, als Text geöffnet weiterhin mit XML-Hervorhebung.
- Einfüge-Auswahl (Strg+Enter): die Liste scrollt zum gewählten Element und passt sich der Fensterhöhe an.
- Ja/Nein-Beschriftung der Verzweigung folgt der Sprache (yes/no bzw. ja/nein), solange in den Einstellungen nichts
  anderes eingetragen ist.

## 0.8.2
- README für den Marketplace: Installation über *Erweiterungen* → *Struktograf*.
- Änderungsliste (dieser Reiter) ergänzt.

## 0.8.1
- Neuer Name **Struktograf**, eigenes Icon, Veröffentlichung im VS Code Marketplace (Preview).
- Ausdrücklich angegebene Typen (`float`, `long`, `short`, `byte`) bleiben im erzeugten Code erhalten – mit den nötigen
  Umwandlungen (`1.5f`, `.toFloat()`, `as f32` …) und passendem Einlesen. Der Live-Code folgt auch Typwechseln.
- Vollständige Tastaturbedienung: Navigation über alle Zweige (Strg+→/←), Kontext- und Einfügemenü per Tastatur,
  Ansage des ausgewählten Elements in der Statusleiste, Tastenübersicht mit `?`.
- **Strg+Enter** öffnet eine Einfüge-Auswahl mit Suche und Vorschau im Diagramm.
- Dialoge scrollen, wenn sie nicht auf den Bildschirm passen.

## 0.8.0
- Befehlssatz des Original-Structorizers: Mathematik-, Zeichenketten- und Prüffunktionen, `inc`/`dec`/`insert`/`delete`,
  Datei-API, Records und `enum`, `leave n`, eingebundene Diagramme.
- Neues Element **Try** (try / catch / finally).
- **Turtleizer** mit Zeichenfläche neben der Konsole.
- **Live-Code:** ungespeicherter erzeugter Code folgt jeder Änderung am Struktogramm.
- Elementtyp im Bearbeiten-Dialog wechselbar, ohne Inhalt zu verlieren.

## 0.7.0
- Kotlin und Rust: Code → Struktogramm und Struktogramm → Code.
- Schreibweise des Structorizers: Zuweisung `:=`, Vergleich `=` und `<>`; `.nsd`-Dateien lassen sich direkt im
  Structorizer öffnen.
- Division immer mit `/`.

## 0.6.3
- Erste veröffentlichte Fassung: Code ⇄ Struktogramm für Python, Java, C, C++, C#, JavaScript/TypeScript und Pascal,
  grafischer Editor, Ausführung mit Haltepunkten, Export als SVG, PNG, JSON, XML und KI-Pseudocode.
