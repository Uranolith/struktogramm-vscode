# Plan: fehlerfreie Codeerzeugung

**Ziel:** Jedes Struktogramm, das der eingebaute Interpreter fehlerfrei ausführt, wird in allen acht Zielsprachen
(Python, Java, C, C++, C#, JavaScript, Kotlin, Rust) zu Code, der

1. ohne Fehler übersetzt (C/C++ auch ohne Warnungen bei `-Wall -Wextra`),
2. bei denselben Eingaben **dieselbe Ausgabe** liefert wie der Interpreter.

Was sich grundsätzlich nicht übersetzen lässt, erzeugt **keinen kaputten Code**. Stattdessen gibt der Generator
eine klare Meldung aus, die im Editor angezeigt wird. „100 %“ bedeutet also: kein stiller Fehler und kein Code,
der nicht übersetzt.

**Ausgangslage (26.11.2026):** Die offizielle Suite (`npm test`, 46 Aufgaben × 8 Sprachen) ist vollständig grün
(368/368). Zusätzliche Stresstests (≈ 55 Struktogramme) zeigen jedoch Fehler in Kontrollfluss, `try`, Arrays,
Typableitung, Textverkettung und Bibliotheksfunktionen. Die Liste steht unten bei den einzelnen Schritten.

**Vorgehen je Schritt:** zuerst den Test, der den Fehler zeigt (rot), dann die Korrektur, dann ist der Test grün und
`npm test` läuft vollständig ohne Rückschritt. Aufwand: S = unter 1 h, M = einige Stunden, L = mehr als ein Tag.

---

## Phase 0 – Messbar machen

- [x] **0.1 Stresstests ins Repo übernehmen** (S)
  Die Struktogramme liegen bisher nur im Scratchpad. Sie kommen nach Themen sortiert in neue Ordner unter
  `test/samples/` mit je einer `inputs.json`: `control_flow`, `try_catch`, `arrays`, `functions`, `types`,
  `expressions`, `builtins`, `identifiers`, `records`.
  Die Test-Artefakte bleiben draußen: der Eingabe-Prompt landet auf stdout, `const`-Syntax und automatisch
  wachsende Arrays kennt der Interpreter nicht.
  *Erledigt:* 54 Struktogramme in 9 Ordnern. Der Dateitest (`fileCreate` …) kam mit 6.2 (`test/samples/files`); damals schrieb der Interpreter
  relativ zum aktuellen Verzeichnis, `npm test` hätte also Dateien ins Repo gelegt.
- [x] **0.2 Bekannte Fehler markieren** (S)
  Neuer Eintrag `"_known": { "datei.nsd": ["c", "rust"] }` in `inputs.json`. `tasktest.js` zeigt bekannte Fehler
  als `K` statt `X` an, und die Suite gilt als bestanden, solange nur bekannte Fehler auftreten. Wird ein
  bekannter Fehler grün, meldet `tasktest.js` das ausdrücklich, damit der Eintrag entfernt wird. So bleibt der
  Fortschritt messbar.
  *Erledigt:* Format `"_known": { "datei.nsd": { "c": "2.1", "*": "6.1" } }` (Sprache → Planschritt). Status K
  (bekannt) und B (behoben, Lauf schlägt fehl, bis der Eintrag entfernt ist), auch im Excel-Protokoll.
  Nebenbei behoben: Ein Programm mit Endlosschleife und Ausgabe ließ den ganzen Testlauf abstürzen
  (`Invalid string length`). Die Ausgabe ist jetzt auf 4 MB begrenzt.
- [x] **0.3 Strenge Übersetzung** (S)
  - C/C++ in `test/languages.js` mit `-Wall -Wextra -Werror=sizeof-array-argument -Werror=format
    -Werror=int-conversion -Werror=stringop-overread`.
  - Java mit `-Xlint`, C# mit `TreatWarningsAsErrors` für ausgewählte Warnungen.
  - Kotlin ohne `-nowarn`; die Warnungen landen im Protokoll.

  *Erledigt (nur C/C++):* `-Werror=` für `sizeof-array-argument`, `format`, `stringop-overread`, `return-type`,
  `sizeof-pointer-div`, in C zusätzlich `int-conversion`, `implicit-function-declaration`,
  `incompatible-pointer-types`. Für Java, C# und Kotlin gibt es keine Warnung, die zuverlässig einen Fehler
  anzeigt (CS0162 „unerreichbarer Code“ ist nach einer Endlosschleife korrekt), deshalb bleibt es dort beim
  Vergleich der Ausgaben.
- [x] **0.4 CI** (M)
  GitHub-Workflow `test.yml` bei Push und Pull Request: `setup-java`, `setup-dotnet`, `setup-python`,
  Rust-Toolchain, Kotlin-Compiler, gcc. Darin läuft `npm test`. Kotlin ist langsam (≈ 15 s je Datei):
  Sprachen auf parallele Jobs verteilen.
  *Erledigt:* `.github/workflows/test.yml` (ein Job je Sprache und ein Job für `test/builtins.js`, Excel und
  erzeugter Code als Artefakt). Läuft erst nach dem nächsten Push – beim ersten Lauf prüfen.
- [x] **0.5 Abdeckungstest für Funktionen** (S)
  Ein Unit-Test prüft: Jede Funktion, die `executor.js` kennt, hat für jede Zielsprache eine Übersetzung oder
  steht ausdrücklich auf einer Liste „nicht übersetzbar“ mit Meldung. Eine neue Interpreter-Funktion ohne
  Generator lässt den Test fehlschlagen (Vorlage: Scratchpad `funcs.js`).
  *Erledigt:* `test/builtins.js` (läuft in `npm test` vor dem Aufgabentest, `npm run test:builtins` zeigt alle
  Lücken). Liest die Funktionen aus `builtin()` und `method()` in `executor.js`: 64 Funktionen und
  20 Methoden. Bekannte Lücken stehen in `KNOWN` mit Planschritt: zu Beginn 282 von 672 Kombinationen.

## Phase 1 – Semantik festlegen (Entscheidungen)

Diese Fragen entscheiden wir **gemeinsam, bevor** die betroffenen Schritte beginnen. Die Ergebnisse kommen in
den Abschnitt „Grenzen“ des README.

**Entschieden am 26.11.2026:**

| Frage | Entscheidung | Umsetzung |
|---|---|---|
| 1.1 Ganzzahlbreite | **Geändert am 26.11.2026 – der Datentyp ist Sache des Anwenders:** Der Code verwendet den angegebenen Typ (`var x: long` → `long`/`long long`/`Long`/`i64`), ohne Angabe wie bisher `int` (bzw. `long` beim vorhandenen Fall `f := f * i`). Ein Überlauf ist kein Fehler des Generators; eine `int`-Variable, die mit einer Multiplikation berechnet wird, bekommt einmal einen Hinweis-Kommentar („int reicht bis 2147483647 – bei größeren Werten long verwenden“). Bei Werten über 32 Bit kann der Interpreter daher anders rechnen als `int`-Code – bewusste Grenze. *Verworfen:* 64 Bit im Code, Grenze im Interpreter (der Umbau machte den Code mit `long` überall, `(long) i * i` und `.toLong()` deutlich schwerer lesbar). `long`/`i64`/`Long` statt `int`; der Interpreter meldet einen Fehler, wenn ein ganzzahliges Ergebnis 2⁵³ überschreitet. | 3.6 |
| 1.2 Typ von `INPUT` | **Interpreter folgt der Ableitung.** Die Typableitung wird besser (Kommazahl, wenn die Variable mit `/`, Kommazahlen, `sqrt` … benutzt wird) und gilt für Generator und Interpreter: Der Interpreter wandelt die Eingabe in den abgeleiteten Typ um – wie das echte Programm. **Geändert am 26.11.2026:** `2.5` für eine Ganzzahl-Variable wird abgeschnitten (`2`, `-2.7` → `-2`), nur Text wie `abc` ist ein Fehler. | 3.6 |
| 1.3 Arrays an Unterprogramme | **Als Referenz** wie im Interpreter (ohne Rückfrage, es gibt keine sinnvolle Alternative). | 4.2, 4.3 |
| 1.4 Laufzeitfehler in `try` | **Nur innerhalb von `try` prüfen.** Im `try`-Block erzeugen C, C++ und JS Prüf-Hilfsfunktionen (z. B. `_div(a, b)`, `_at(a, i)`), die einen abfangbaren Fehler werfen; außerhalb bleibt der Code schlicht. | 2.7 |
| 1.5 Texte in C | **Dynamisch, Zeichen zählen.** `char*` mit `malloc` statt `char[256]`, keine Längengrenze; `length`/`copy`/`pos`/`insert`/`delete` zählen UTF-8-Zeichen. Speicher wird nicht freigegeben (für Lernprogramme unkritisch, im README erwähnen). | 5.10 |
| 1.6 Nicht Übersetzbares | **Meldung und Kommentar.** Der Code wird erzeugt, an der Stelle steht `// NICHT ÜBERSETZBAR: …`, und im Problems-Panel erscheint eine Meldung mit Verweis auf das Element. | 9.1 |

- [x] **1.1 Ganzzahlbreite.** Der Interpreter rechnet mit JS-Zahlen (exakt bis 2⁵³), die Zielsprachen meist
  mit 32 Bit (`2147483647 + 1` läuft über, Rust bricht ab). Optionen:
  a) überall 64 Bit (`long`/`i64`),
  b) der Interpreter meldet einen Überlauf über 32 Bit,
  c) beides – 64 Bit im Code, Hinweis im Interpreter ab 2⁵³.
- [x] **1.2 Typ von `INPUT`.** Bisher Ganzzahl, falls nichts anderes folgt; eine Eingabe von `2.5` stürzt in
  fünf Sprachen ab. Optionen:
  a) Kommazahl, wenn die Variable je mit `/` oder Kommazahlen benutzt wird, sonst Ganzzahl (heutiges Verhalten
     plus besserer Ableitung),
  b) Ganzzahl, aber das Lesen akzeptiert Kommazahlen und rundet ab (wie der Interpreter?),
  c) Hinweis im Editor „Eingabetyp unklar – `var x: double` angeben“.
- [x] **1.3 Arrays an Unterprogramme.** Wie im Interpreter als Referenz (Änderungen sichtbar). Rust: `&mut Vec`
  statt `.clone()`; C: Länge als zusätzlicher Parameter.
- [x] **1.4 Laufzeitfehler in `try`** (Division durch 0, Index außerhalb). Sollen sie in C/C++/JS abgefangen
  werden (Prüf-Hilfsfunktionen wie `_div(a, b)`) oder dokumentierte Grenze bleiben?
- [x] **1.5 Texte in C.** Feste Puffer (`char[256]`) oder dynamisch (`malloc`)? Länge in Zeichen statt Bytes
  (UTF-8: `length("Äpfel")` = 5)?
- [x] **1.6 Nicht Übersetzbares.** Meldung und Abbruch der Erzeugung oder Code mit `// TODO`-Kommentar? Wo
  erscheint die Meldung (Problems-Panel, Benachrichtigung)?

## Phase 2 – Kontrollfluss (stille Fehler, höchste Priorität)

- [x] **2.1 `leave` in einer Fallauswahl innerhalb einer Schleife** (M)
  `break` verlässt nur das `switch`: Endlosschleife in C, C++, C#, JS; Java übersetzt nicht („nicht erreichbare
  Anweisung“).
  *Erledigt:* `loopNeedsLabel` erkennt ein `leave` in einer Fallauswahl. Beim Erzeugen eines `switch` zählt
  `inSwitch` mit, und `leave` wird dort zu `break L1` (Java, JS) bzw. `goto L1` (C, C++, C#). Kotlin und Rust
  brauchen nichts. Test: `control_flow/01_leave_in_case`.
- [x] **2.2 `continue` in `repeat … until`** (S)
  Python (`while True … if cond: break`) und Rust (`loop { … }`) überspringen mit `continue` die Bedingung.
  *Erledigt:* Vor einem `continue`, dessen innerste Schleife eine Fußschleife ist, steht die Abbruchprüfung
  (`if cond: break`). Das Umschreiben auf `while erstes or not cond` wäre in Rust falsch gewesen, weil im Rumpf
  deklarierte Variablen in der Bedingung nicht sichtbar wären. Test: `control_flow/02_continue_step`.
- [x] **2.3 C: `return`/`leave`/`continue` innerhalb von `try`** (M)
  `_try_env` bleibt auf einem toten Stack-Frame, das nächste `throw` stürzt ab (`0xC0000028`).
  *Erledigt:* Jeder `try`-Block hat eigene Namen (`_prevN`, `_envN`). `tryExit` setzt vor jedem Sprung hinaus
  die Sprungpunkte aller verlassenen Blöcke zurück. Ein Rückgabewert wird vorher berechnet, damit ein Fehler darin
  noch zum eigenen `catch` gehört. Tests: `try_catch/02_try_return`, `04_try_leave_loop`, `07_try_nested_jumps`.
- [x] **2.4 `finally` bei `return` (C/C++)** (M)
  *Erledigt:* C führt `finally` vor jedem Sprung hinaus aus; der `catch`-Teil läuft bei vorhandenem `finally` in
  einem eigenen `setjmp`, damit ein Fehler im `catch` erst `finally` ausführt und dann weitergeworfen wird. C++
  nutzt ein Wächter-Objekt `_Finally` (Lambda im Destruktor). Endet eine C-Funktion mit `try`, steht danach ein
  unerreichbares `return` mit Standardwert (gcc erkennt die Wege hinter `setjmp` nicht).
  Tests: `try_catch/03_finally_return`, `06_finally_paths`.
- [x] **2.5 Rust: `return`/`leave`/`continue` innerhalb von `try`** (M)
  *Erledigt:* Die Closure gibt `Flow<T>` zurück (`Normal`, `Leave(n)`, `Continue`, `Return(T)`); nach dem Block
  führt ein `match` den Sprung aus. Mit `finally` läuft auch der `catch`-Teil in einer Closure; ein Fehler daraus
  wird nach `finally` weitergeworfen. Ohne Sprünge und `finally` bleibt die einfache Form `if let Err(e) = …`.
  Nebenbei: In Python fing das `except Exception` eines `try` die Ausnahme von `leave 2` ab – `_LeaveN` erbt jetzt
  von `BaseException`. Tests: `try_catch/02`–`07`.
- [x] **2.6 Schleifenvariable nach der Schleife** (S → M)
  Schwerer als gedacht: Schon **zwei Schleifen nacheinander mit demselben `i`** übersetzten in C, C++, Java und
  C# nicht, sobald der erste Rumpf `i` benutzte (die zweite Schleife schrieb `for (i = …)` ohne Deklaration).
  *Erledigt:* Die Analyse unterscheidet nun. Wird die Zählvariable nur in Schleifen über sich selbst benutzt,
  deklariert jede Schleife sie im Kopf. Wird sie auch außerhalb benutzt (`loopOuter`), wird sie am Anfang der
  Routine deklariert, und die Schleife zählt mit `_i` und setzt `i = _i;`. Danach hat `i` wie im Interpreter den
  Wert des letzten Durchlaufs, auch nach `leave`. Python braucht das nicht.
  Tests: `control_flow/08_loop_vars`, `10_same_loop_var`.
- [x] **2.7 Laufzeitfehler innerhalb von `try`: Division** (M)
  Umsetzung von 1.4.
  *Erledigt:* Im `try`-Teil und in allen Unterprogrammen, die (auch indirekt) von dort aufgerufen werden,
  werden Ganzzahl-`/`, `div` und `mod` in C, C++ und JS zu `_idiv(a, b)`/`_imod(a, b)`. Diese werfen bei 0
  einen abfangbaren Fehler mit dem Text des Interpreters. Tests: `try_catch/05_catch_runtime`,
  `08_div_in_function`. Offen: C-Hilfsfunktionen sind `int` – mit 3.6 (64 Bit) auf `long long` umstellen.
- [x] **2.8 Laufzeitfehler innerhalb von `try`: Index außerhalb** (M, nach 4.2)
  *Erledigt:* Im `try`-Teil und in von dort aufgerufenen Unterprogrammen: C++ `a.at(i)`, C `a[_idx(i, len)]`, JS und
  Python `a[_ix(a, i)]` (Python nähme `-1` sonst als letztes Element). Test `try_catch/09_index_error`.
  Ein Index außerhalb von Array oder Text ist im Interpreter ein Fehler. C/C++ lesen dann beliebigen Speicher, JS
  liefert `undefined`, Python akzeptiert negative Indizes. Prüf-Hilfsfunktion `_at(a, i)` wie bei 2.7; in C erst
  möglich, wenn Array-Parameter ihre Länge mitbringen (4.2).
- [ ] **2.9 Einheitliche Fehlertexte** (M, optional)
  Wird die Fehlervariable eines `catch` ausgegeben, unterscheidet sich der Text je Sprache (Java „/ by zero“,
  Python „integer division or modulo by zero“, Interpreter „Division durch 0“). Für 100 % gleiche Ausgabe: im
  `catch` bekannte Ausnahmearten auf die Texte des Interpreters abbilden.

## Phase 3 – Typableitung

- [x] **3.1 Parametertypen aus allen Aufrufen** (M)
  Heute gilt nur der erste Aufruf (`generators.js` ≈ Z. 259: `prm.inferredType` wird nicht mehr überschrieben).
  `halb(7)` und `halb(3.0)` müssen `double` ergeben. Konflikte wie Text und Zahl erzeugen eine Meldung (1.6).
  **Entscheidung (26.11.2026): Interpreter folgt der Ableitung** – wie bei 1.2; `halb(7)` ergibt dann überall 3.5.
  *Erledigt:* `widenType` führt die Argumenttypen aller Aufrufstellen zusammen (int + double → double, auch bei
  Arrays). Der Interpreter wandelt Argumente ohne Typangabe in den abgeleiteten Parametertyp um
  (`executor.js`, `staticType` über `inferTypes`). Nebenbei behoben: Ein einzelner Aufruf hat jetzt den
  Rückgabetyp der Funktion (`OUTPUT istGerade(4)` gab in Python/C# `True`, in C/C++ `1` aus), und C# verkettet
  Wahrheitswerte als `true`/`false`. Konflikte (Text und Zahl) bleiben beim ersten Typ; die Meldung kommt mit
  9.1. Tests: `functions/02_param_widen`, `03_type_inference`.
- [x] **3.2 Arrays als Rückgabewert und Parameter** (M)
  Bei `return q` mit `q` als Array wird `int` abgeleitet; Parameter, die indiziert werden, ebenso.
  *Erledigt:* `inferType('new int[n]')` ergibt `int[]`; damit stimmen Variable, Rückgabetyp und Aufrufer
  (`b := quadrate(4)`). Test `arrays/02_array_func` (C/C++ hängen an 4.2/4.6, Rust an 4.3).
- [x] **3.3 Records als Parameter** (S)
  Der Parameter wird `int`; der Typ muss aus dem Aufruf bzw. den Feldzugriffen kommen.
  *Erledigt:* Eine Record-Variable als Argument hat ihren Record-Typ (`inferType`). Test `records/01_record`.
- [x] **3.4 Zeichen und Text** (S)
  `erstes := s[0]` ist ein Zeichen, wird aber als Text deklariert (C, C++, Java, C#, Kotlin, Rust).
  *Erledigt:* `s[i]` auf einem Text ist wie im Interpreter ein Text aus einem Zeichen (`TEXT_INDEX` in pseudo.js:
  Java `String.valueOf(s.charAt(i))`, C++ `string(1, s[i])`, C `str_chr(s[i])`, Rust `s.chars().nth(i)…`).
  Nebenbei: `str_chr`/`str_int` in C lieferten Zeiger in einen Ringpuffer mit 8 Plätzen – ein gespeicherter Wert
  wurde nach 8 weiteren Aufrufen überschrieben; jetzt eigener Speicher. Test `types/06_foreach_chars`.
- [x] **3.5 Feldtypen in Record-Arrays** (S)
  C gibt `leute[1].n` (Text) mit `%d` aus.
  *Erledigt:* Die Typableitung kannte Record-Felder gar nicht (alles nach dem Punkt wurde übersprungen).
  `fieldAccess` in pseudo.js löst `p.x`, `leute[1].n` und verschachtelte Felder auf; die Definitionen kommen
  über `fnTypes.records`. Test `records/02_record_array`.
- [x] **3.6 Umsetzung von 1.1 (Ganzzahlbreite) und 1.2 (`INPUT`-Typ)** (M)
  *Teil 1.2 erledigt:* Der Interpreter wandelt Eingaben ohne Typangabe in den abgeleiteten Typ um (`5` für eine
  Kommazahl-Variable wird `5.0`; `2.5` für eine Ganzzahl-Variable wird auf `2` abgeschnitten, Text wie `abc` ist
  ein Fehler). Alle Sprachen lesen Zahlen genauso: Ganzzahlen über eine Kommazahl mit Abschneiden
  (`int(float(…))`, `(int) Double.parseDouble(…)`, `.toDouble().toInt()`, `parse::<f64>() as i32`, C/C++
  `read_int` über `read_double`, JS `_int`/`_num` statt `Number`), C# mit `NumberStyles.Float` (sonst las es `1,5`
  als 15), Kotlin mit `trim()`. Ein Eingabefehler ist abfangbar.
  Der Aufgabentest zählt jetzt „Interpreter und Programm brechen beide ab, gleiche Ausgabe bis dahin“ als Erfolg.
  Im Vergleich alter und neuer Interpreter ändern sich von 185 Testfällen nur die 4 beabsichtigten.
  Tests: `types/03_input_mixed`, `04_avg`, `09_input_error_try`.
  *Teil 1.1 erledigt (neuer Ansatz):* Ausdrücklich angegebene Typen kommen in allen Sprachen an (Test
  `types/05_big_ints` mit `var g: long`). Eine `int`-Variable, die mit einer Multiplikation berechnet wird,
  bekommt in Java, C, C++, C#, Kotlin und Rust einmal je Routine einen Hinweis-Kommentar (`overflowHint`).
  Mitgenommen: C-Parameter mit mehrteiligem Typ (`long long a[]`), Kotlin übernimmt den genauen Typ bei
  Deklarationen, `foreach`-Variable mit genauem Typ.
  Anmerkung, nicht geändert: Der vorhandene `long`-Sonderfall (`f := f * i`) rechnet ein Produkt aus
  `int`-Operanden (`a * b`) erst in 32 Bit und weitet dann – in Java/C/C#/Kotlin kann es dabei schon überlaufen.
- [x] **4.1 `new int[n]` in allen Sprachen** (S)
  *Erledigt* (C: `calloc` mit Länge, C++: `vector<int>(n)`).
  *Teilweise erledigt:* Python, JS, Java, C# (`NEW_ARRAY` in pseudo.js; Text-Arrays mit `""` statt `null`
  gefüllt). Kotlin und Rust hatten es schon. Offen: C und C++ (mit 4.2/4.6).
  Bisher nur für Kotlin und Rust (`pseudo.js` ≈ Z. 764). Python `[0] * n`, JS `new Array(n).fill(0)`, C
  `int q[n]` bzw. `calloc`, C++ `vector<int>(n)`, Java/C# `new int[n]`.
- [x] **4.2 C: Länge von Array-Parametern** (M)
  *Erledigt:* Array-Parameter bekommen `int name_len`; dynamische Arrays (aus `new`, Funktion, `copyArray`, anderem
  Array) sind Zeiger mit Begleitvariable `name_len`, am Anfang der Routine deklariert; eine Funktion mit
  Array-Ergebnis gibt `T*` zurück und die Länge über `int* _len`; `length`, `foreach` und Aufrufe nutzen die Länge.
  `sizeof(f)/sizeof(f[0])` auf einem Parameter misst den Zeiger: still falsche Ergebnisse. Lösung: zusätzlicher
  Parameter `int f_len` bei jeder Funktion mit Array-Parameter und `length(f)` → `f_len`. Alternative:
  `struct { int* data; int len; }`. Test: `s37_array_param_len`.
- [x] **4.3 Rust: Arrays als Referenz** (M)
  *Erledigt:* `&mut Vec<T>`, wenn das Unterprogramm das Array verändert (Element zuweisen, einlesen, an einen
  verändernden Parameter weitergeben – Fixpunkt über alle Routinen, `rsMutParams`), sonst `&Vec<T>`; Aufruf mit
  `&mut a`/`&a`, Array-Parameter werden unverändert weitergereicht.
  Umsetzung von 1.3: `&mut Vec<T>` bzw. `&[T]`, je nachdem ob das Unterprogramm schreibt. Test:
  `s37_array_param_len`.
- [x] **4.4 `copyArray`** (S)
  *Erledigt:* C `_arr_dup`, C++ über `vector`, C# `System.Linq.Enumerable.ToArray`; `copyArray(x)` hat den Typ von x.
  C++ `auto b = a;` erzeugt bei C-Arrays einen Zeiger, das Original ändert sich mit (C++ besser durchgängig
  `vector`). C fehlt ganz, C# fehlt `using System.Linq`. Test: `d03_copyarray`.
- [x] **4.5 Text-Arrays in C** (S)
  *Erledigt* mit der Parameter-Syntax für mehrteilige Typen (3.6).
  Parameter `char*[] arr` ist ungültig, richtig ist `char* arr[]`. Test: `s29_string_array`.
- [x] **4.7 Rust: Elemente aus Text-Arrays** (S)
  *Erledigt:* Lesen eines Elements aus einem Text- oder Record-Array mit `.clone()`, als Zuweisungsziel ohne.
  `return arr[0]` mit `arr: Vec<String>` übersetzt nicht („cannot move out of index“) – `.clone()` anhängen, wenn ein
  Element eines Arrays mit Nicht-Copy-Typ als Wert benutzt wird. Test: `arrays/03_string_array`.
- [x] **4.6 C++ einheitlich auf `std::vector`** (L, optional)
  *Erledigt:* Arrays sind `vector<T>`, Parameter `vector<T>&` (Referenz wie im Interpreter), `a[5]` wird
  `vector<int> a(5)`, `new int[n]` wird `vector<int>(n)`, `length` wird `.size()`. Damit für C++ auch 4.1, 4.2 und
  4.4 erledigt (`copyArray` kopiert den Vector).
  Löst 4.2, 4.4 und `begin/end` auf Parametern in einem Zug; der Code ist für Lernende auch idiomatischer.

## Phase 5 – Ausdrücke und Textverkettung

- [x] **5.1 Zahlen vor dem ersten Text** (M)
  *Erledigt:* Zahlen vor dem ersten Text werden zu einer Summe zusammengefasst (`concatTerms`, Python-`x`,
  `concatParts`).
  `a + 1 + "!"` gibt in Python und Kotlin „11!“ statt „2!“; C/C++ machen daraus Zeigerarithmetik, also
  undefiniertes Verhalten. Stelle: `concatTerms` (`if (first > 1) return null`). Lösung: Die Zahlenterme vor dem
  ersten Text erst addieren, dann verketten. Test: `s36_output_forms`.
- [x] **5.2 Rust: Text + Zahl** (S)
  *Erledigt:* `concatParts` erkennt Text auch an Variablen vom Typ Text (nicht nur an Literalen).
  Bei `c + a + b` mit Text `c` vorn fehlt die Umwandlung. Test: `s36_output_forms`.
- [x] **5.3 `min`/`max`** (S)
  *Erledigt:* `minMaxFn` – beliebig viele Argumente, Ganzzahl-Argumente werden bei Kommazahlen in Kotlin, Rust
  und C++ umgewandelt; `inferType` liefert den breitesten Typ.
  Mehr als zwei Argumente werden verworfen (verschachteln: `max(a, max(b, c))`). Gemischte Typen: in C `%d`
  für einen `double`-Ausdruck, C++ `max(double, int)` und Rust übersetzen nicht. Ergebnistyp = breitester Typ,
  Argumente angleichen. Tests: `s30_nested_calls`, `d09_mathdoc`.
- [x] **5.4 `random()` ohne Argument in C/C++** (S)
  *Erledigt:* Hilfsfunktion `random01()`.
  Wird zu `rand()`, einer Ganzzahl. Richtig: `rand() / (RAND_MAX + 1.0)`. Test: `s33_random`.
- [x] **5.5 `strcmp` einheitlich −1/0/1, ordinal** (S)
  Java/Kotlin liefern 31, C#/JS vergleichen kulturabhängig, C++ übersetzt mit Literalen nicht. Lösung: Signum
  des ordinalen Vergleichs (`Integer.signum(a.compareTo(b))`, `string.CompareOrdinal`, …). Test: `s32_strcmp`.
- [x] **5.6 Methoden auf Text-Literalen in C++** (S)
  *Erledigt:* Text-Literale als Argumente von Textfunktionen werden `string("…")`.
  `length("")` → `"".size()` übersetzt nicht. Literal in `string(...)` einpacken. Test: `s17_text_funcs`,
  `s22_umlaut_idents`.
- [x] **5.7 `xor`** (S)
  *Erledigt:* `xor` auf oberster Ebene wird in allen Sprachen zu `(links) != (rechts)` (in Python, Rust und
  Kotlin band `^`/`xor` stärker als ein Vergleich, JS lieferte 1/0); bitweises `^` in Kotlin wird `xor`.
  JS: Wahrheitswerte ergeben `1`/`0` (→ `a !== b`). Kotlin: `^` ist ungültig (→ `xor` bzw. `!=`). Ob `^` im
  Struktogramm xor oder Potenz ist, mit dem Interpreter abgleichen. Tests: `s38_xor_bool`, `s35_math_mix`.
- [x] **5.8 Python: Wahrheitswerte aus Funktionsaufrufen** (S)
  *Erledigt* mit 3.1 (Rückgabetyp eines einzelnen Aufrufs).
  In Texten erscheint `True`/`False` statt `true`/`false`. Test: `s18_type_inference`.
- [x] **5.10 C: dynamische Texte; C und Rust: Zeichen zählen** (L)
  *Erledigt:* C liest Texte in eigenen Speicher (`str_dup`, keine Grenze von 255 Zeichen); `length`, `copy`, `pos`,
  `insert`, `delete` zählen in C, C++ und Rust UTF-8-Zeichen. Gefunden mit dem neuen Test
  `expressions/12_utf8_text`: C# und JS lasen Umlaute in Eingaben falsch – C# setzt jetzt
  `Console.InputEncoding = UTF8`, JS nutzt eine eigene Eingabefunktion statt `prompt-sync` (das Paket wandelte
  jedes Byte einzeln um; der erzeugte Code braucht dadurch auch kein `npm install` mehr). Offen: `uppercase`/
  `lowercase` und `foreach` über Texte arbeiten in C noch byteweise (Umlaute).
  Umsetzung von 1.5: `char*` mit `malloc` statt `char[256]` (auch für `INPUT`), Hilfsfunktionen für
  `length`/`copy`/`pos`/`insert`/`delete` auf UTF-8-Zeichen. Rust zählt mit `.len()` ebenfalls Bytes →
  `.chars().count()` bzw. Zeichen-Indizes. Test: `expressions/05_umlaut_idents`.
- [x] **5.9 C: Aufzählungen** (S)
  *Erledigt:* `enum { ROT = 0, GRUEN = 5, BLAU = 6 };` statt `const int`.
  `const int BLAU = 6;` ist keine gültige `case`-Marke → `enum` oder `#define`. Test: `d07_enum`.

## Phase 6 – Bibliotheksfunktionen

- [x] **6.1 Dokumentierte Befehle vollständig übersetzen** (M)
  *Erledigt* bis auf `copyRecord`: `signum` (Kommazahl), `isArray`/`isString`/`isNumber`/`isBool`/`isChar` (beim
  Übersetzen aus dem Typ, `isChar` auf Text zur Laufzeit), `split` (C/C++ über Hilfsfunktionen, Java behält leere
  Teile), `copyArray`.
  Fehlend laut Test: `signum` (alle außer teilweise), `isArray`/`isString`/`isNumber`/`isBool`/`isChar` (alle;
  in typisierten Sprachen zur Übersetzungszeit aus dem Typ bekannt → `true`/`false`), `split` (C, C++, Java),
  `copyArray` (C, C#).
- [x] **6.2 Dateifunktionen** (L)
  `fileOpen` … `fileEOF` fehlen in allen Sprachen. Je Sprache eine kleine Hilfsschicht (Handle = Index in eine
  Liste offener Dateien). Alternative: ausdrücklich „nicht übersetzbar“ (1.6) und das README anpassen.
  *Erledigt:* `src/core/filehelpers.js` erzeugt je Sprache dieselbe Hilfsschicht wie der Interpreter: Nummer =
  Position + 1, Fehlercodes -2/-3/-1, Lesen lädt die ganze Datei, Schreiben hängt an. Gelesen wird nach Wort
  (`fileReadInt`, `fileReadDouble` – jetzt auch im Interpreter streng wie `INPUT`), Zeichen (Unicode-Zeichen,
  `\r\n` = `\n`) oder Zeile. Fehler (Dateiende, keine Zahl, Datei nicht geöffnet) sind wie im Interpreter in `try`
  abfangbar, mit denselben Texten. `fileWrite` wandelt den Wert wie `OUTPUT` in Text um; `fileWriteLine` schreibt
  `\n` (Interpreter vorher: `\r\n` unter Windows).
  **`fileRead`** hat keinen festen Typ. Entscheidung wie bei `INPUT` (1.2): `v := fileRead(h)` liest je nach Typ
  von `v` wie `fileReadInt`, `fileReadDouble` oder als Text (ohne Anführungszeichen, `{…}` als Text). Ohne
  Typangabe wird der Typ aus der Verwendung abgeleitet (gerechnet → Zahl, sonst Text). Der Interpreter folgt dem.
  Mitten in einem Ausdruck bleibt `fileRead` in Python/JavaScript/Interpreter dynamisch, in den Sprachen mit
  festen Typen liefert es Text (Kommentar im Code und Meldung).
  Tests: `test/samples/files` (6 Struktogramme). `test/languages.js` lässt den Interpreter dafür in einem eigenen,
  leeren Ordner arbeiten.
- [x] **6.3 Weitere Interpreter-Funktionen** (M)
  *Großteils erledigt:* weitere Namen werden auf vorhandene Funktionen abgebildet (`FN_ALIAS`: `upper`, `lower`,
  `ln`, `power`, `real`, `intToStr`, `floatToStr`, `toString`, `strToInt`, `strToFloat`); neu `odd`, `randint`,
  `sum`. `int`/`float` auf Text parsen, `str` auf Kommazahlen schreibt wie der Interpreter (`3.0`). Interpreter:
  `sum` über Kommazahlen ist eine Kommazahl. Dazu `range(n)`/`range(a, b)` (mit Schrittweite nur Python, Java, JS;
  C als Zuweisung oder im `foreach`-Kopf) und `copyRecord`. Test `builtins/06_range_copyrecord`.
  `intToStr`, `strToInt`, `strToFloat`, `floatToStr`, `toString`, `odd`, `power`, `ln`, `upper`/`lower`,
  `substring`, `indexOf`, `contains`, `startsWith`/`endsWith`, `strip`, `randint`, `size`, `sum` – heute in allen
  Sprachen roh übernommen. Entweder übersetzen oder in 0.5 als „nicht übersetzbar“ führen.
- [x] **6.5 Methoden auf Texten und Arrays** (M)
  *Großteils erledigt:* `rewriteMethods` bildet `length`/`size`, `substring`, `charAt`, `indexOf`, `contains`,
  `equals`, `startsWith`/`endsWith`, `toUpperCase`/`upper`, `toLowerCase`/`lower`, `trim`/`strip` und `get` vor der
  Übersetzung auf Struktogramm-Funktionen ab (auch in der Typableitung). Test `builtins/05_methods`. `contains`/
  `indexOf` auf Arrays über `_aindexof` (Test `builtins/07_array_search`). Bewusst nicht übersetzt (Meldung nach 9.1):
  Arrays, die wachsen (`push`/`append`/`add`, `pop`) – Java, C# und C haben Arrays fester Größe.
  Der Interpreter kennt `s.length()`, `s.substring(…)`, `s.toUpperCase()`, `a.append(x)`, `a.pop()` … (`method()` in
  `executor.js`). Der Generator gibt sie unverändert aus: In C, C++ und C# ist das immer falsch, in den anderen
  Sprachen je nach Methode. Gefunden mit `test/builtins.js`.
- [ ] **6.4 Tabellen statt Einzelfälle** (M, optional)
  Die Funktionstabellen (`SFN`, `MATH_FUNCS`, `modernFn`) in eine Matrix Funktion × Sprache zusammenführen.
  Dann prüft 0.5 die Vollständigkeit automatisch.

## Phase 7 – Bezeichner

- [x] **7.1 Schlüsselwörter umbenennen** (M)
  *Erledigt:* `renameReserved` benennt vor der Übersetzung eigene Namen (Variablen, Parameter, Unterprogramme,
  Schleifen- und Fehlervariablen, Record-Typen/-Felder, Aufzählungswerte) um, die in der Zielsprache reserviert
  sind (`class` → `class_`), in allen Texten des Dokuments.
  Je Sprache eine Liste reservierter Wörter (aus den Sprachspezifikationen) und eine einheitliche Umbenennung,
  z. B. `class` → `class_`. Gilt für Variablen, Parameter, Funktionsnamen und Record-Felder, mit Prüfung auf
  Kollisionen nach der Umbenennung. Test: `s05_keywords`.
- [x] **7.2 Namen, die der Generator selbst benutzt** (S)
  *Erledigt* mit derselben Liste (`RESERVED` je Sprache: Python `len`/`str`/`int`/…, Hilfsfunktionen wie
  `read_line`, `fmt`, `prompt`, `fmt_num`).
  Python: Eine Variable `len`, `str`, `int`, `float`, `print`, `input`, `math`, `random`, `sys`, `threading`
  oder `fmt_num` überdeckt Funktionen, die der erzeugte Code braucht. Gleiches gilt für Hilfsfunktionen in
  C/C++ (`str_cat`, `read_line`, `fmt_double` …), Rust (`read_line`, `fmt_num`) und für `_i`, `_e`, `_t1`,
  `L1` usw. Lösung: Diese Namen in 7.1 aufnehmen.

## Phase 8 – Automatisch nach Fehlern suchen (Fuzzing)

- [x] **8.1 Zufällige Struktogramme** (L)
  *Erledigt – ohne fast-check:* `test/fuzz.js` (`npm run test:fuzz -- --n 100 --seed 1`) erzeugt mit einem eigenen,
  über den Seed wiederholbaren Zufallsgenerator Struktogramme (Ganz-/Kommazahlen, Texte, Arrays, `if`, `case`, alle
  Schleifen, `leave`/`continue`, Unterprogramm), vergleicht Interpreter und erzeugten Code und schreibt Abweichungen
  als `.nsd` nach `test/out/fuzz/`. Ganzzahlen bleiben klein (`mod`), geteilt wird nur durch Konstanten ≠ 0 – die
  bewussten Grenzen aus Phase 1 werden so nicht als Fehler gemeldet. Kein Verkleinern (Shrinking); die Programme sind
  von vornherein kurz (`--size`). Gleich im ersten Lauf gefunden und behoben: `div` in JavaScript ohne Abschneiden
  (`7 div 2` ergab 3.5) und in Python mit `//` (rundet bei negativen Zahlen ab); Textverkettung in Argumenten
  (`copy(s + "ab", 1, 3)` in C, `f("n" + a)` in Python). `div` fiel in den festen Tests nicht auf, weil `.nsd`-Dateien
  beim Speichern `div` zu `/` normalisieren – aus dem offenen Editor kommt es aber an. Test
  `expressions/13_concat_in_args`.
  Ein Lauf über 150 Seeds (5000–5149) fand außerdem `for i := -1 to -1` → `i < ;` in C, C++, JavaScript, Kotlin
  (`until`) und Rust (`..`): Die Vereinfachung „Ende `n - 1` → `i < n`“ hielt das Literal `-1` für „etwas minus 1“.
  Test `control_flow/11_for_bounds`. Java, C# und Kotlin: 20 Seeds (9000–9019) ohne Befund.
  Mit 6.2 schreibt und liest der Zufallstest auch Dateien. Dabei gefunden: `abs(3 / -4)` in Rust („ambiguous numeric
  type“, nur Zahlen ohne Variable) – Test `expressions/14_abs_const`.
  Ein Generator für zufällige, gültige Struktogramme beginnt mit einer kleinen Teilmenge und wächst schrittweise:
  - Zuweisungen, Ausgaben, `if`, `while`, `for`
  - danach `case`, `repeat`, `leave`/`continue`
  - danach Unterprogramme, Arrays, Texte, `try`

  Je Fall: Interpreter ausführen, dann alle Sprachen übersetzen und die Ausgaben vergleichen. fast-check
  verkleinert einen Fehlschlag auf das kleinste Gegenbeispiel, das dann als fester Test in `test/samples` landet.
- [ ] **8.2 Schnell genug machen** (M)
  Mehrere Programme je Sprache in einem Compiler-Aufruf (Java: mehrere Klassen, Kotlin: eine Datei mit
  mehreren `object`s); Python/JS ohne Übersetzung zuerst. Fuzzing lokal und nachts in der CI mit festem und mit
  zufälligem Seed.

## Phase 9 – Abschluss

- [x] **9.1 Meldungen im Editor** (M)
  *Erledigt:* Tabelle `UNTRANSLATABLE` im Generator (Dateifunktionen, `copyRecord`, `range`, Turtle-Befehle außer
  Python, wachsende Arrays `push`/`append`/`add`/`pop`). Im Code steht „NICHT ÜBERSETZBAR: …“ vor der Zeile, beim
  Erzeugen erscheint eine Meldung, und die Prüfung zeigt am Element einen Hinweis der neuen, abschaltbaren Gruppe
  „Codeerzeugung“ (`struktogramm.hints.codegen`) mit den betroffenen Sprachen. Beispiel:
  `test/samples/checks/untranslatable.nsd`.
  Die Warnungen des Generators (`this.warnings` und 1.6) erscheinen beim Erzeugen im Problems-Panel bzw. als
  Hinweis, mit Verweis auf das Element im Struktogramm.
- [x] **9.2 README** (S)
  *Erledigt:* Abschnitt *Grenzen* mit den Entscheidungen, *Entwicklung* mit K/B, `_known`, `test/builtins.js`, CI.
  Abschnitt „Grenzen der Codeerzeugung“ mit den Entscheidungen aus Phase 1; den Satz „werden diese Befehle in
  die Zielsprache übersetzt“ an den echten Stand anpassen.
- [x] **9.3 CHANGELOG und Version** (S)
  *Erledigt:* Abschnitt *Unveröffentlicht*; die Versionsnummer beim Veröffentlichen festlegen.

---

## Empfohlene Reihenfolge

1. **Phase 0** – ohne Messung kein „100 %“.
2. **Phase 1** – kurze Entscheidungsrunde (eine Sitzung).
3. **Phase 2 und 4.2/4.3** – die stillen Fehler und Abstürze zuerst.
4. **Phase 3, 5, 4 (Rest)** – Typen und Ausdrücke.
5. **Phase 7** – Bezeichner.
6. **Phase 6** – Bibliotheksumfang (am meisten Fleißarbeit, gut aufteilbar).
7. **Phase 8** – Fuzzing findet, was die festen Tests übersehen; ab hier läuft es dauerhaft mit.
8. **Phase 9** – Dokumentation und Veröffentlichung.

## Fortschritt

| Datum | Schritt | Ergebnis |
|---|---|---|
| 26.11.2026 | Bestandsaufnahme | `npm test` 368/368; Stresstests: ≈ 25 Fehlerklassen gefunden |
| 26.11.2026 | Phase 0 | 54 neue Struktogramme, `_known`/K/B, strenge C/C++-Flags, CI, `test/builtins.js`; Testwerkzeug: `exit` und Endlosausgabe |
| 26.11.2026 | Phase 1 | Entscheidungen 1.1–1.6 getroffen (Tabelle oben) |
| 26.11.2026 | Phase 2 | 2.1–2.7 erledigt, dazu zwei weitere Fehler gefunden (gleiche Zählvariable in zwei Schleifen, Python `leave n` in `try`); 4 neue Tests |
| 26.11.2026 | Phase 3 (Teil) | 3.1–3.5 erledigt, 3.6 Teil Eingabe; dazu 4.1 (ohne C/C++) und 5.9. Interpreter folgt der Typableitung bei Parametern und `INPUT` (Entscheidung); 1.1 präzisiert (Zähler bleiben `int`) |
| 26.11.2026 | 3.6 | Eingabe: Kommazahl für Ganzzahl abschneiden. 1.1 neu entschieden: Typ ist Sache des Anwenders, Hinweis-Kommentar statt automatischem 64 Bit (64-Bit-Umbau verworfen) |
| 26.11.2026 | Phase 4 | Arrays: Rust als Referenz (`&mut`/`&`), C++ `std::vector`, C mit Länge (`name_len`, `_len`), `copyArray` in C/C#, Elemente aus Text-Arrays in Rust |
| 26.11.2026 | Phase 5, 6.1, 6.3 | Ausdrücke, Texte (UTF-8, auch Eingabe in C#/JS), Befehlssatz; Gesamtlauf: 770 erfolgreich, 0 neue Fehler. Bekannte Fehler nur noch bei Bezeichnern (Phase 7) |
| 26.11.2026 | Phase 7, 6.5, 2.8, 9.2, 9.3 | Bezeichner umbenennen, Methoden, Indexprüfung in `try`, README/CHANGELOG. Gesamtlauf: **alle 856 erfolgreich** (107 Struktogramme × 8 Sprachen, keine bekannten Fehler mehr) |
| 26.11.2026 | 9.1, 6.3, 6.5 | Meldungen für nicht Übersetzbares (Code-Kommentar, Meldung, Hinweis im Editor); `range`, `copyRecord`, Array-Suche. Abdeckung Bibliotheksfunktionen 647/672 (Rest: wachsende Arrays, bewusst nicht übersetzt) |
