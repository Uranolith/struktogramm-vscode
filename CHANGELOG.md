# Änderungen

## Unveröffentlicht
Der erzeugte Code wurde mit den echten Compilern aller acht Sprachen gegen den Interpreter geprüft (66 neue
Test-Struktogramme) und an vielen Stellen korrigiert. Plan und Entscheidungen: `docs/CODEGEN-PLAN.md`.
- **Kontrollfluss:** `leave` in einer Fallauswahl verlässt die Schleife (vorher Endlosschleife in C, C++, C#, JS);
  `continue` in `repeat … until` prüft die Bedingung (Python, Rust); zwei Schleifen mit derselben Zählvariable
  übersetzen in C, C++, Java und C#; die Zählvariable hat nach der Schleife den Wert des letzten Durchlaufs.
- **`try`/`finally`:** `return`, `leave` und `continue` aus einem `try` in C (vorher Absturz), C++ und Rust;
  `finally` läuft bei jedem Ausgang; Division durch 0 in `try` ist in allen Sprachen abfangbar.
- **Typen:** Parametertypen aus allen Aufrufen; Arrays und Records als Parameter und Ergebnis; angegebene Typen
  (`var x: long`) werden übernommen, bei `int` mit Multiplikation weist ein Kommentar auf den größeren Typ hin.
- **Interpreter:** wandelt Argumente und Eingaben in den abgeleiteten Typ um – `halb(7)` rechnet wie im Code mit
  Kommazahl, wenn `halb` auch mit Kommazahlen aufgerufen wird; `2.5` als Eingabe für eine Ganzzahl wird zu `2`,
  Text ist ein Fehler. `sum` über Kommazahlen ist eine Kommazahl.
- **Arrays:** C trägt die Länge mit (vorher maß `sizeof` bei Parametern nur den Zeiger), C++ verwendet `std::vector`,
  Rust übergibt Referenzen (Änderungen kommen beim Aufrufer an), `new int[n]` und `copyArray` in allen Sprachen.
- **Texte:** Zeichen statt Bytes (C, C++, Rust); C ohne Längengrenze für Eingaben; Umlaute in Eingaben in C# und
  JavaScript (JavaScript liest jetzt ohne das Paket `prompt-sync`).
- **Ausdrücke und Befehle:** `a + 1 + "!"`, `min`/`max` mit mehreren Argumenten, `strcmp`, `xor`, `random()`,
  `signum`, `isArray` & Co., `split`, `odd`, `randint`, `sum`, weitere Namen (`upper`, `intToStr`, `strToInt` …)
  und Methoden wie `s.length()`, `s.substring(…)`.
- **Namen**, die in der Zielsprache reserviert sind (`class`, `new`, in Python `len`, `str` …), werden umbenannt.
- **Dateifunktionen** (`fileOpen` … `fileWriteLine`) werden jetzt in alle acht Sprachen übersetzt, mit demselben
  Verhalten wie im Interpreter. `v := fileRead(h)` liest je nach Typ von `v` eine Zahl oder Text.
  `fileReadDouble` lehnt jetzt wie `INPUT` Text wie `2.5abc` ab, `fileReadChar` liefert auch Zeichen außerhalb der
  Basisebene (Emoji) ganz, und `fileWriteLine` schreibt unter Windows `\n` statt `\r\n`.
- **Zufallstest** (`npm run test:fuzz`): vergleicht zufällige Struktogramme in allen Sprachen mit dem Interpreter, auf
  GitHub jede Nacht. Bisher gefunden und behoben: `div` in JavaScript und Python, Textverkettung in Argumenten,
  `for i := -1 to …`, `abs` mit reinen Zahlen und mit Zählvariablen in Rust, `abs` in C ohne `stdlib.h`.

## 1.0.3
- **Testlauf der automatischen Veröffentlichung:** Keine Änderungen an der Erweiterung – inhaltlich gleich 1.0.2.
  Diese Version wird erstmals über den GitHub-Workflow `publish.yml` per OIDC Trusted Publishing im Marketplace
  veröffentlicht, ausgelöst durch das GitHub-Release. Die README beschreibt den Ablauf unter *Entwicklung*.

## 1.0.2
- **Hinweis „ohne Typ“ an jeder ersten Zuweisung je Weg:** Bekommt eine Variable ohne Typ in mehreren Fällen einer
  Fallauswahl (oder Zweigen einer Verzweigung) ihren ersten Wert, erscheint der Hinweis in jedem dieser Fälle – bisher
  nur an der ersten Stelle im Struktogramm. Spätere Zuweisungen im selben Block bekommen ihn nicht noch einmal.
- **Robuster beim Schließen von Ansichten:** Alle Nachrichten an Struktogramm-Editor, Vorschau und Seitenleisten-
  Ansichten laufen über eine abgesicherte Funktion. Wird eine Ansicht geschlossen, während die Erweiterung noch an sie
  sendet (laufendes Programm, Debugger, Haltepunkte, Einstellungsänderung), entsteht kein Fehler „Webview is
  disposed“ mehr; der PNG-Export bricht dann mit einer Meldung ab, statt zu warten.

## 1.0.1
- **Zahnrad für die Einstellungen** oben rechts im Struktogramm-Editor: öffnet wie *Struktograf: Settings* die
  Einstellungen von VS Code, gefiltert auf Struktograf.

## 1.0.0
Schreibweise, Prüfungen und Code-Erzeugung sind festgelegt. Die Extension bleibt als **Preview**
gekennzeichnet – sie ist noch experimentell.

> **Bitte beachten – `=` ist jetzt immer der Vergleich.** Bisher wurde eine Zuweisung mit `=` (`x = 5`) beim Speichern
> stillschweigend zu `x := 5`. Jetzt meldet die Prüfung sie als Fehler, der Interpreter weist nichts zu, und aus dem
> Struktogramm lässt sich kein Code erzeugen, bis die Zeile mit `:=` oder `<-` geschrieben ist. Dateien, die seit
> Version 0.7.0 gespeichert wurden, enthalten bereits `:=` und sind nicht betroffen.

- **Neuer Hinweis: Deklaration nur in einem Zweig** (Good Practice) – `var a: double` im Fall „Q“, `a` auch im Fall
  „Y“: Dort ist `a` nicht deklariert. Wird `a` nur in den Zweigen gebraucht, lautet der Vorschlag, es auch in diesem
  Zweig zu deklarieren; wird es auch danach gebraucht, die Deklaration vor die Fallauswahl zu ziehen.
- **Befehl „Struktograf: Settings“** (bzw. „Struktograf: Einstellungen“) in der Befehlspalette: öffnet die
  Einstellungen von VS Code, gefiltert auf Struktograf.
- **Anzeige der Zuweisung wählbar:** Einstellung `struktogramm.assignmentOperator` (Abschnitt Darstellung) – wie
  geschrieben (Standard), immer `:=` oder immer `<-` (mit *Operatoren hübsch darstellen* als `←`). Gilt für
  Anweisungen, Deklarationen und Zählschleifen im Editor, in der Vorschau und beim Export als Bild; die Datei bleibt
  unverändert.
- **Eingaben wie in normalem Code:** Der Interpreter wandelt ein Komma nicht mehr in einen Punkt um. `3,5` für eine
  Kommazahl meldet „‚3,5‘ ist keine gültige Zahl – meintest du 3.5?“; ohne Typ bleibt `3,5` Text. Nur vollständige
  Zahlen gelten (`3a` ist keine Zahl, `3.5` keine ganze Zahl) – auch bei `float()`, `double()`, `int()`,
  `strtoint` und `strtofloat`.
- **Behoben:** Eine ungültige Eingabe für eine `double`- oder `int`-Variable (z. B. Buchstaben) zeigte statt der
  Meldung den internen Fehler „Cannot access 'tr' before initialization“.
- **Behoben:** Eine Deklaration in einer Verzweigung, Fallauswahl oder Schleife (`var a: double` im ersten Zweig, `a`
  auch im zweiten) galt im erzeugten Code nur in diesem Block. Sie steht jetzt am Anfang der Routine wie im
  Interpreter; an der Stelle bleibt die Zuweisung des Anfangswerts.
- **Kommazahlen in allen Sprachen wie im Interpreter:** kürzeste exakte Form, `80.0`, Exponent erst unter 0.000001
  bzw. ab 1e21 (`1e-7`, `1e+21`) – auch in Textverkettungen. Java, Kotlin, Python und Rust bekommen dafür eine kleine
  Hilfsfunktion (bisher z. B. Java `1.23456785E7`, Python `1e-05`); C, C++ und C# eine überarbeitete.
- **Aufgabentest:** Kommentare im erzeugten Code in der Sprache der Erweiterung (`struktogramm.language`, bei
  *Automatisch* die VS-Code-Oberfläche); die Sprache steht am Anfang der Ausgabe, vorgeben mit `--sprache de|en`.
- **Code nur aus fehlerfreien Struktogrammen:** *Code erzeugen* ist gesperrt, solange die Struktogramm-Datei einen
  Fehler hat; die Meldung nennt die Anzahl und den ersten Fehler. Verbundener Code wird bei Fehlern nicht nachgeführt.
- **Neuer Fehler: Zuweisung in einer Bedingung** (`if x := 5`, `while x <- 0`) – in Prüfung und Interpreter mit klarer
  Meldung statt „Syntaxfehler“.
- Die Meldung zu `x = 5` ist kurz wie die übrigen Fehler: „Vergleich statt Zuweisung: zugewiesen wird mit := bzw.
  <-.“
- **Neuer Fehler: Zuweisung mit `=`** (`x = 5`, `var x: int = 5`, `const MAX = 10`, `for i = 1 to 10`) – `=` ist im
  Struktogramm der Vergleich; die Meldung nennt die richtige Zeile (`x := 5`). Bisher wurden `=` und `<-` beim
  Speichern stillschweigend zu `:=` umgestellt und als Zuweisung ausgeführt; das entfällt: `=` ist überall der
  Vergleich, auch im Interpreter und im erzeugten Code (`x = 5` wird zu `x == 5`). `:=` und `<-` sind beide gültig
  und bleiben, wie sie geschrieben sind.
- **Einstellungen gruppiert:** Allgemein, Darstellung, Prüfungen, Code erzeugen und einlesen, Structorizer – in fester,
  zusammenhängender Reihenfolge.
- **Hinweise mit konkreten Vorschlägen:** statt Platzhaltern die echten Namen und Ausdrücke – Kommazahl-Vergleich
  `x = 0.5` → `abs(x - 0.5) < 0.000001` (bei `<>` mit `>=`), Fallauswahl mit ihrer Bedingung, Signatur eines
  Unterprogramms getrennt nach Parametertypen (`verdopple(a: int, b: int)`) und Rückgabetyp (`verdopple(a, b): int`),
  Anzahl der Anweisungen im Block.
- **Neuer Hinweis „void“:** Ein Unterprogramm ohne `return` und ohne Rückgabetyp bekommt den Vorschlag `zeige(n): void`,
  damit klar ist, dass es absichtlich nichts zurückgibt (Gruppe Good Practice).
- **Hinweis auch bei `var s := "Hallo"` und Konstanten:** Eine Deklaration ohne Typ bekommt den Vorschlag
  `var s: string := "Hallo"` bzw. `const PI: double := 3.14`.
- **Sprachauswahl:** Einstellung `struktogramm.language` (Automatisch / Deutsch / Englisch), wirkt sofort auf Editor,
  Werkzeuge, Ausführung, Prüfungen und Kommentare im erzeugten Code.
- **Code-Erzeugung – allgemeine Korrekturen** (Grenzfälle im Aufgabentest von 79 Fehlschlägen auf keinen – alle
  Spezialfälle laufen in allen acht Sprachen):
  - Textverkettung mit Zahlen in allen Sprachen (`"x = " + x`): Python f-String, JavaScript Template, C# und C++
    mit Umwandlung, C mit Hilfsfunktionen; eine Verkettung macht eine Zahl nicht mehr zu Text.
  - Typen aus Funktionsargumenten: Parameter eigener Unterprogramme, `int`/`trunc`/`round`-Argumente als Kommazahl.
  - Eingabe: C und C++ lesen die ganze Zeile (Text mit Leerzeichen). Eine Kommazahl mit Komma (`3,5`) wird wie in
    normalem Code der jeweiligen Sprache nicht umgewandelt.
  - Wahrheitswerte als `true`/`false` (Python, C, C++, C#); `round` überall wie im Interpreter; Rest mit Vorzeichen
    in Python (`math.fmod`); `pow` in Python als Kommazahl; `abs` mit Kommazahl in C (`fabs`) und Rust; `trunc`
    übersetzt; `length` von Texten (Java `.length()`) und Feldern (C/C++ `sizeof`).
  - Ganzzahlen, die sich selbst multiplizieren (`f := f * i`), als 64-Bit-Zahl.
  - C#: Ausgabe als UTF-8, wenn das Programm Umlaute enthält.
  - **Typwechsel Ganzzahl → Kommazahl** (`x := 5` … `x := 2.5`) wie im Interpreter: Die Variable wird als Kommazahl
    gespeichert und, solange sie eine Ganzzahl ist, beim Rechnen und Ausgeben umgewandelt (`(int) x`, `x.toInt()`,
    Python/JavaScript rechnen mit dem aktuellen Typ). In Schleifen und Verzweigungen gilt sie als Kommazahl.
  - **Text und Zahl in einer Variable:** In typisierten Sprachen nicht übersetzbar – die Stelle wird im Code mit
    ACHTUNG markiert, und *Code erzeugen* zeigt eine Warnung.
  - Umwandlungen: `double(x)` wie `float(x)`; Python: Ganzzahl in einer Kommazahl-Variable als `float`, `floor`/`ceil`
    als Kommazahl; Rust: gemischte Rechnungen und Vergleiche (`a * 1.5`, `a < 2.5`) mit `as f64`.
- **Hinweise in Gruppen, einzeln abschaltbar:** Good Practice, Konventionen, Missverständlich und Mögliche Logikfehler
  (Einstellungen `struktogramm.hints.*`). Die Gruppe steht im Hover-Fenster und als Quelle in *Probleme*; Fehler
  erscheinen immer.
- **Farbige Typen und Unterprogramm-Namen:** Im Kopf eines Unterprogramms erscheinen der Name in der Farbe für
  Funktionen und Parameter- sowie Rückgabetypen in der Typfarbe (`fib(n: int): int`, auch `int summe(int a, int b)`);
  in Deklarationen wird der Typ an seiner Stelle gefärbt, auch eigene Typen (`var p: Punkt`, `int x = 5`).
- **Autoformatierung beim Übernehmen eines Blocks:** Schlüsselwörter in der Schreibweise der Vorlage (`INPUT`,
  `OUTPUT` groß, `var`, `return`, `for … to`, `and` … klein), Deklarationen immer als `var name: typ` (auch aus
  `var name : Typ`, `int x = 5`, `x: int`, `var x as int`), mehrere Namen als `var a, b: int`, Leerzeichen um
  Rechen-, Vergleichs- und Zuweisungsoperatoren (`a+b` → `a + b`, Vorzeichen bleiben am Wert), nach Kommas ein
  Leerzeichen, Signaturen als `fib(n: int): int`.
  Gleichnamige Variablen (`Output := 3`, `by`) und Texte in Anführungszeichen bleiben unverändert.

## 0.9.6
- **Variablen mit Schlüsselwort-Namen** (`by`, `to`, `step`, `in`, `new`, `do` …): Die Hervorhebung erkennt
  Schlüsselwörter jetzt am Zusammenhang (`by := 5` bleibt eine Variable, `for i := 1 to n by 2` hat das Schlüsselwort
  `by`), und der Zählschleifenkopf liest `by`/`step` nur zwischen Endwert und Schrittweite als Schlüsselwort
  (`for i := 1 to by` hat den Endwert `by`).
- **Vorschlagsliste im Bearbeiten-Dialog** wird nicht mehr abgeschnitten: Sie erscheint unter oder über der Zeile, je
  nachdem wo mehr Platz ist, und wird bei wenig Platz niedriger und scrollbar.
- **Prüfungen im Struktogramm:** Marken an den Elementen (Tooltip beim Darüberfahren) und Einträge in *Probleme*.
  **Fehler** (rot) für Dinge, die nicht funktionieren (Syntaxfehler, Variable ohne Wert, unbekannte Funktion,
  Argumentzahl, `leave` außerhalb einer Schleife, Division durch 0, unlesbarer Schleifenkopf, leere Bedingung);
  **Hinweise** (gelb, mit Begründung) für Good Practice und DIN 66261 (Typen für Variablen, Parameter und
  Rückgabewerte mit Vorschlag, Eingabe ohne Aufforderungstext, Kommazahl-Vergleich mit `=`, Fallauswahl über eine
  Bedingung, mehrere Anweisungen je Block, mögliche Endlosschleife, unbenutzte Werte, nicht erreichbare Elemente,
  Typwechsel). Einstellung `struktogramm.checks` (alle / nur Fehler / aus). **F8 / Umschalt+F8** springt zum
  nächsten / vorherigen Element mit Meldung und blendet sie ein. In *Probleme* markiert der Link **Element zeigen**
  an jeder Meldung das Element im Struktogramm. Beispiele in `test/samples/checks`.
  Tooltips zeigen im Editor nur noch die Marken – als gegliedertes Hover-Fenster (Aussage, Vorschlag als Code,
  Begründung); der Kommentar eines Elements erscheint nicht mehr als Tooltip am Element (weiterhin beim Bearbeiten
  und im SVG-Export).
- Behoben: Ein geschlossener Struktogramm-Editor blieb intern eingetragen (seit 0.9.5) – das Aufräumen brach beim
  Zugriff auf die schon geschlossene Webansicht ab.
- **Schleifen im erzeugten Code:**
  - `foreach` über ein Feld-Literal im Schleifenkopf (`foreach k in {1, 2, 3}`) wird je Sprache gültig: Java/C# `new int[] {…}`, JavaScript `[…]`, Kotlin `intArrayOf(…)`, C mit Hilfsfeld.
  - `foreach` über einen Text läuft Zeichen für Zeichen: Java `toCharArray()`, Rust `chars()`, C bis zum Textende statt über die Puffergröße. Vergleiche und Fallauswahl mit einem Zeichen nutzen Zeichen-Literale (`'a'`).
  - Die Schleifenvariable von `foreach` über ein Textfeld bekommt den richtigen Typ (vorher `int` in C, `var` in Java).
  - In `repeat … until` eingelesene Variablen, die nur in der Abbruchbedingung vorkommen (`repeat INPUT x until x > 0`), werden vor der Schleife deklariert (vorher fehlte die Deklaration).
- **Pascal entfernt:** Struktograf erzeugt keinen Pascal-Code mehr, bietet die Structorizer-Generatoren für Pascal und
  Delphi nicht mehr an und liest keine Pascal/Delphi-Dateien (`.pas`, `.dpr`, `.pp`, `.lpr`) mehr ein. Die
  Structorizer-Schreibweise im Struktogramm (`:=`, `div`, `mod`) bleibt unverändert.
- **Typen eingelesener Variablen wie im Interpreter:** Eine Eingabe ist eine Zahl, wenn mit ihr gerechnet oder sie mit
  einer Zahl verglichen wird (auch über Fallauswahl-Marken), sonst Text. Fließt sie in eine Kommazahl ein
  (`umfang := a + b + c`), wird sie als Kommazahl gelesen. Vorher wurden Zahlen oft als Text gelesen (`7 + 3 = 73`)
  und Namen als Zahl.
- **Ausgabe von Kommazahlen wie im Interpreter** in allen Sprachen: `80.0` statt `80`, vollständig statt gerundet
  (C/C++ schrieben nur 6 Stellen).
- **Ganzzahldivision schneidet ab** wie im Interpreter (`-3 / 4` = `0`): Python `int(a / b)`, JavaScript
  `Math.trunc(a / b)` – je Division nach den Operandentypen bestimmt.
- **`'G'` im Vergleich mit Text** wird in Java, C, C++, C#, Kotlin und Rust zum Text-Literal `"G"`.
- **Fallauswahl über eine Bedingung** (`case a = 0` mit den Marken `true`/`false`) wird zu if/else (vorher ungültiges
  `switch` bzw. in Python `a == 0 == True`).
- `pi` wird in jeder Sprache übersetzt; Java liest Eingaben zeilenweise (kein leeres `nextLine()` nach `nextInt()`,
  Kommazahlen mit Punkt); C kopiert Texte mit `strcpy`; Kotlin wandelt Ganzzahl-Ausdrücke für Kommazahl-Variablen
  um.
- **Aufgabentest** (`npm test`, `test\tasktest.cmd` oder VS-Code-Aufgabe): übersetzt alle Struktogramme in den
  Themenordnern unter `test/samples` (`branching`, `edge_cases`) in alle Sprachen, baut und startet sie
  mit den echten Compilern, vergleicht mit dem Interpreter und protokolliert das Ergebnis in
  `test/out/tasktest.xlsx`; Testfälle je Ordner in `inputs.json`, der erzeugte Code liegt in
  `test/samples/codefiles`.
- **Textvergleiche im erzeugten Code:** `a < b`, `a = b` usw. mit Zeichenketten werden in allen Sprachen gültig und
  richtig übersetzt. Vorher: Java verglich mit `==` die Referenzen statt des Inhalts und lehnte `<` ab, C verglich
  Zeiger, C# und Rust (`String < "x"`) übersetzten nicht. Jetzt Java `compareTo`/`equals`, C `strcmp`,
  C# `string.CompareOrdinal`, Rust `as_str()`; eine Fallauswahl über einen Text wird in C und C++ zur if-Kette.

## 0.9.5
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
- **macOS: Kopieren und Einfügen im Bearbeiten-Dialog** (⌘C, ⌘X, ⌘V, ⌘A) funktioniert. Der Dialog hatte alle
  Tasten abgefangen; auf dem Mac führt VS Code die Zwischenablage-Befehle in Webviews aber selbst aus und muss den
  Tastendruck dafür sehen.
- **F5 nach VS-Code-Standard:** Struktograf greift nicht mehr in die Wahl des Debuggers ein. F5 startet das
  Struktogramm nur im Struktogramm-Editor; sonst entscheidet VS Code (`launch.json`, Debugger der aktiven Datei).
  Weggefallen: F5/F10 starten das offene Struktogramm, wenn die aktive Datei keinen Debugger hat; Tasten einer
  laufenden Ausführung gelten überall (übernimmt jetzt die Debug-Sitzung); der Struktograf-Eintrag steht nicht mehr
  künstlich an erster Stelle der Debugger-Auswahl.
- Startzeile der Ausführung: Das ▶ steht aufrecht, nur der Name des Struktogramms ist kursiv.

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
- `test/langtest.js`: mehrere Eingaben mit `--input 1500,1000`.
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
  `test/langtest.js`, das es in allen Zielsprachen übersetzt, ausführt und mit dem Interpreter vergleicht.

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
