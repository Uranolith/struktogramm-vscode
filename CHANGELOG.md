# Änderungen

## Unveröffentlicht
- **Echte Debug-Sitzung in VS Code:** Jede Ausführung eines gespeicherten Struktogramms läuft als Debug-Sitzung
  (eigener Debug-Adapter): Debug-Leiste mit Fortsetzen, Schritt über (F10), Schritt hinein (F11), Rücksprung
  (Umschalt+F11), Anhalten, Neustart und Beenden; Variablen und Aufrufliste in *Ausführen und Debuggen*; Ausdrücke
  unter *Überwachen* und in der Debugkonsole; Programmausgabe auch in der Debugkonsole, `INPUT` lässt sich dort
  eingeben. *Ohne Debuggen ausführen* (Strg+F5) ignoriert Haltepunkte. Auch im Editor gestartete Ausführungen
  bekommen eine Sitzung (ohne zur Debug-Ansicht zu wechseln). Unbenannte Struktogramme laufen weiter ohne Sitzung.
- **Debug-Menü vollständig nutzbar:**
  - Haltepunkte (F9) sind VS-Code-Haltepunkte: Ansicht *Haltepunkte* (aktivieren, deaktivieren, entfernen, gespeichert),
    Bedingung, Trefferzahl und Logpoints (im Kontextmenü des Struktogramms), Funktionshaltepunkte (Unterprogramm),
    *Bei Laufzeitfehlern anhalten* mit Variablen und Aufrufliste an der Fehlerstelle.
  - Aufrufliste mit Element, Datei und Zeile; ein Klick markiert die Stelle im Struktogramm.
  - Variablen: Felder und Records aufklappbar, Werte änderbar; Vorschläge in der Debugkonsole.
- **Ausführen-Menü (▷) im Editor** mit *Struktogramm debuggen* und *Struktogramm ohne Debuggen ausführen*, dieselben
  Links in der leeren Ansicht *Ausführen und Debuggen*. Ersetzt den eigenen Ausführen-Knopf in der Titelleiste.
- **Variablenanzeige als durchgehende Tabelle:** Namen, Werte und Typen stehen über alle (auch abgeschlossenen)
  Aufrufe hinweg untereinander. Die drei Spalten sind anfangs gleich breit und lassen sich an den Spaltengrenzen
  breiter und schmaler ziehen (Doppelklick: gleich breit, ←/→ per Tastatur); die Aufteilung bleibt gespeichert.
  Typen wurden vorher im Editor zu groß dargestellt (Namensgleichheit mit einer CSS-Klasse der Diagrammgrafik).
- **F5 nach VS-Code-Standard:** Struktograf greift nicht mehr in die Wahl des Debuggers ein. F5 startet das
  Struktogramm nur im Struktogramm-Editor; sonst entscheidet VS Code (`launch.json`, Debugger der aktiven Datei).
  Weggefallen: F5/F10 starten das offene Struktogramm, wenn die aktive Datei keinen Debugger hat; Tasten einer
  laufenden Ausführung gelten überall (übernimmt jetzt die Debug-Sitzung); der Struktograf-Eintrag steht nicht mehr
  künstlich an erster Stelle der Debugger-Auswahl.

## 0.9.4
- **← / → wechseln zwischen Fällen:** In Fallauswahl, Verzweigung (true/false) und Parallelverarbeitung gehen die
  Pfeiltasten in den Nachbarzweig auf gleicher Höhe, auch aus verschachtelten Elementen heraus. Ohne Nachbarn wie
  bisher hinein bzw. hinaus. Strg/⌘ + → / ← geht immer hinein bzw. hinaus (vorher: Zweig wechseln).
  ↓ / ↑ gehen bei Try von try über catch nach finally.
- **Ausführungsanzeige verstellbar:** Die Bereiche Konsole, Turtleizer und Variablen/Aufrufe lassen sich an den
  Trennlinien breiter und schmaler ziehen (Doppelklick setzt zurück, ←/→ per Tastatur). Die Aufteilung gilt für Editor
  und Panel und bleibt gespeichert.
- **Standard: Werkzeugleiste wieder im Editor.** Die Ansicht *Struktograf* in der Aktivitätsleiste gibt es weiter mit
  `struktogramm.toolbarLocation` = `sidebar`.

## 0.9.3
- **Fallauswahl mit `true` (bzw. `false`) als Ausdruck** und Bedingungen als Marken – `case true of  kdnr < 2000: …` –
  übersetzt jetzt in allen Sprachen: `switch (true)` in JavaScript, `case true when …` in C#, `when { … }` in Kotlin,
  `match true` mit Guards in Rust, sonst als `if / else if`-Kette. Vorher entstand ein `switch` mit Bedingungen als
  Marken, das Java, C, C++, C#, Rust und Pascal ablehnen; in Python ergab `True == kdnr < 2000` eine Vergleichskette,
  die nie zutraf.
- Wird einer Variablen erst eine Ganzzahl und später eine Kommazahl zugewiesen (`rabatt := 0` … `rabatt := 0.15`),
  wird sie als Kommazahl deklariert.
- C#: Kommazahlen werden unabhängig von der Ländereinstellung mit Punkt geschrieben und gelesen (vorher `0,15` und
  `double.Parse("0.5")` = 5 auf deutschem Windows).
- Pascal: Heißt das Programm wie eine Variable (`Rabatt` / `rabatt`), wird der Programmname angepasst – Pascal
  unterscheidet keine Groß- und Kleinschreibung.
- `test/sprachtest.js`: mehrere Eingaben mit `--input 1500,1000`.
- **Ungleich lange Zweige** in Verzweigung, Fallauswahl und Parallelverarbeitung: Das letzte Element des kürzeren
  Zweigs wird auf die volle Höhe gestreckt (wie im Structorizer) statt eine leere Fläche zu lassen. Schleifen,
  Verzweigungen, Try und Parallelverarbeitung geben die zusätzliche Höhe an ihren Inhalt weiter.

## 0.9.2
- **Zoom-Tasten** (Strg/⌘ + `+` / `−` / `0`) zoomen nur noch das Struktogramm: VS Code reicht jeden Tastendruck
  aus der Webview weiter, dadurch wurde zusätzlich die ganze Oberfläche gezoomt bzw. (Strg/⌘+0) in die
  Seitenleiste gesprungen. Die Tasten sind jetzt Tastenbelegungen, die nur bei Fokus im Struktogramm greifen.
- **macOS:** Tooltips, Statuszeile, Kontextmenü, Werkzeug-Ansicht und Tastenübersicht zeigen ⌘, ⇧⌘Z, ⌫ und Fn+Pfeile
  statt Strg, Strg+Y, Entf, Pos1/Ende; Tasten, die es am Mac nicht gibt (Einfg, Menütaste), entfallen.
  Vorschläge im Bearbeiten-Dialog zusätzlich mit ⌘I (⌃Leertaste ist oft vom System belegt).
- Verzweigungen sind standardmäßig mit **true / false** beschriftet (vorher ja/nein bzw. yes/no); änderbar über
  `struktogramm.trueLabel` und `struktogramm.falseLabel`.
- Pinch-Zoom auf dem Trackpad und Strg+Mausrad zoomen proportional zur Bewegung (vorher viel zu schnell).

## 0.9.1
- **Parallelverarbeitung als echte Threads** im erzeugten Code: Python `threading`, Java Thread-Klassen,
  C# `Parallel.Invoke`, C++ `std::thread`, C OpenMP, Kotlin `thread { }`, Rust `std::thread::scope`,
  Pascal `BeginThread` (Hauptprogramm). Bisher liefen die Zweige nacheinander; JavaScript bleibt dabei.
- Pascal: Feld-Literale `{1, 2, 3}` werden als `[1, 2, 3]` erzeugt (vorher als Kommentar missverstanden).
- Zählvariablen gelten im Schleifenrumpf als deklariert (keine doppelte Deklaration in C, C++, Java, C#).
- Neues Beispiel `test/samples/gesamttest.nsd` (alle Elemente, Rekursion, Parallelverarbeitung) und
  `test/sprachtest.js`, das es in allen Zielsprachen übersetzt, ausführt und mit dem Interpreter vergleicht.

## 0.9.0
- README an den neuen Arbeitsbereich angepasst: Werkzeug-Ansicht, Ausführungs-Panel mit den Reitern
  „Variablen“ und „Aufrufe“, aktuelle Befehlsnamen, alle Exportformate.

## 0.8.4
- **Neue Standard-Anordnung:** Werkzeuge in der Ansicht *Struktograf* (Aktivitätsleiste links) und Ausführung im Panel
  *Struktograf* unten in VS Code. Die bisherige Anordnung (beides im Editor) lässt sich in den Einstellungen
  `struktogramm.toolbarLocation` und `struktogramm.executionPanelLocation` wieder wählen.
- **Werkzeuge in der Seitenleiste:** die Werkzeuge des Struktogramm-Editors wahlweise als Ansicht *Struktograf* in der
  Aktivitätsleiste (wie der Explorer), im Stil der VS-Code-Seitenleiste. Kategorien lassen sich ein- und ausklappen
  und per Drag & Drop (oder Alt+↑/↓) umsortieren. Einstellung `struktogramm.toolbarLocation`, live umschaltbar per
  Befehl oder Knopf in der Titelleiste.
- **Ausführung im Panel unten:** Konsole, Eingabe, Turtleizer und Variablen wahlweise im Panel *Struktograf* unten in
  VS Code (neben Probleme, Ausgabe, Debugkonsole) statt unter dem Diagramm. Einstellung
  `struktogramm.executionPanelLocation`, live umschaltbar per Befehl, mit dem Knopf ⇲ in der Ausführungsanzeige oder in
  der Kopfzeile des Panels (dort auch Ausführen, Schritt, Anhalten, Beenden, Leeren).
- **F5 überall:** Nach einem Einzelschritt (F10) setzt F5 fort, egal wo der Fokus gerade ist. Hat die aktive Datei
  keinen eigenen Debugger, startet F5 das geöffnete Struktogramm. In der Debugger-Auswahl von VS Code steht
  „▶ Struktogramm ausführen (Struktograf)“ ganz oben; auch in `launch.json` nutzbar (`"type": "struktogramm"`).
- **Eingabe:** Wartet das Programm auf `INPUT`, steht der Cursor direkt im Eingabefeld.
- **Tempo neu abgestuft:** langsam 400 ms, mittel 200 ms (Standard), schnell 50 ms, sofort.
- **Mitscrollen:** Beim Ausführen scrollt das Diagramm mit, sodass der gerade ausgeführte Bereich immer zu sehen ist.
- **Abgeschlossene Aufrufe:** Die Variablenansicht zeigt unter den laufenden Aufrufen alle beendeten Funktionen mit
  ihrem Endzustand, „(beendet)“ und Rückgabewert, neueste zuerst. Mehrfache Aufrufe sind nummeriert (`summe #1`,
  `summe #2` …). Auch bei Tempo „Sofort“ bleibt so der Endzustand des Programms sichtbar.
- **Reiter „Aufrufe“** neben den Variablen: oben der Aufrufstapel (laufende Aufrufe mit Argumenten), darunter der
  Aufrufverlauf als Baum – wer hat wen mit welchen Argumenten aufgerufen, mit Rückgabewert oder Status. Teilbäume lassen
  sich einklappen, ein Klick springt zu den Variablen des Aufrufs. Aufgezeichnet werden bis zu 5000 Aufrufe.
- **Zoom als Eingabefeld:** Zoomstufe direkt eingeben (z.B. `150`, `150 %`, `1,5x`); Enter übernimmt, Esc verwirft,
  ↑/↓ ändern um 10 %.

## 0.8.3
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
