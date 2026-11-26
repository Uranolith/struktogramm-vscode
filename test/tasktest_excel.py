# Excel-Protokoll für test/tasktest.js: python tasktest_excel.py ergebnis.json ausgabe.xlsx
# Blatt „Übersicht“: Aufgaben × Sprachen mit O (erfolgreich) / X (nicht erfolgreich) / K (bekannter Fehler) /
# B (bekannter Fehler behoben) / – (nicht geprüft)
# Blatt „Details“: jeder Testfall mit Eingaben, Ergebnis und Fehlermeldung
import json
import sys
from datetime import datetime

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding='utf-8') as f:
    rep = json.load(f)

FONT = 'Arial'
F = lambda **k: Font(name=FONT, **k)
thin = Side(style='thin', color='BFBFBF')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
HEAD_FILL = PatternFill('solid', start_color='D9E1F2')
OK_FILL = PatternFill('solid', start_color='C6EFCE')
BAD_FILL = PatternFill('solid', start_color='FFC7CE')
NA_FILL = PatternFill('solid', start_color='EDEDED')
KNOWN_FILL = PatternFill('solid', start_color='FFEB9C')
FIXED_FILL = PatternFill('solid', start_color='DDEBF7')
CENTER = Alignment(horizontal='center', vertical='center')
langs = rep['langs']
tasks = rep['tasks']
when = datetime.fromisoformat(rep['started'].replace('Z', '+00:00')).astimezone().strftime('%d.%m.%Y %H:%M')

wb = Workbook()
ws = wb.active
ws.title = 'Übersicht'
n = len(langs)
C0 = 4  # erste Sprachspalte (A Bereich, B Aufgabe, C Titel)
last_col = get_column_letter(n + C0)

ws['A1'] = 'Aufgabentest – echte Übersetzung und Ausführung in allen Sprachen'
ws['A1'].font = F(bold=True, size=14)
ws['A2'] = f'Lauf vom {when}, Dauer {rep["seconds"]} s. Ordner: {rep["samples"]}'
ws['A2'].font = F(size=10, color='595959')

HR = 4  # Kopfzeile
heads = ['Bereich', 'Aufgabe', 'Titel'] + [l['label'] for l in langs] + ['Erfolgreich']
for c, h in enumerate(heads, 1):
    cell = ws.cell(row=HR, column=c, value=h)
    cell.font = F(bold=True)
    cell.fill = HEAD_FILL
    cell.border = BOX
    cell.alignment = Alignment(horizontal='center' if c >= C0 else 'left', vertical='center', wrap_text=True)

first = HR + 1
for i, t in enumerate(tasks):
    r = first + i
    ws.cell(row=r, column=1, value=t.get('group') or '').font = F()
    ws.cell(row=r, column=2, value=t['name']).font = F()
    title = t['title'].split(':', 1)[-1].strip() if ':' in t['title'] else t['title']
    ws.cell(row=r, column=3, value=title).font = F()
    for j, l in enumerate(langs):
        res = t['results'][l['id']]
        s = res['status'] if res['status'] in ('O', 'X', 'K', 'B') else '–'
        cell = ws.cell(row=r, column=C0 + j, value=s)
        cell.font = F(bold=True)
        cell.alignment = CENTER
        if res.get('detail'):
            from openpyxl.comments import Comment
            cell.comment = Comment(res['detail'][:1500], 'Aufgabentest')
    a, b = get_column_letter(C0), get_column_letter(C0 + n - 1)
    sc = ws.cell(row=r, column=C0 + n, value=f'=COUNTIF({a}{r}:{b}{r},"O")&" / "&(COUNTIF({a}{r}:{b}{r},"O")+COUNTIF({a}{r}:{b}{r},"X")+COUNTIF({a}{r}:{b}{r},"K")+COUNTIF({a}{r}:{b}{r},"B"))')
    sc.font = F()
    sc.alignment = CENTER
    for c in range(1, n + C0 + 1):
        ws.cell(row=r, column=c).border = BOX

end = first + len(tasks) - 1
sr = end + 1
ws.cell(row=sr, column=1, value='Erfolgreich').font = F(bold=True)
for j in range(n + 1):
    col = get_column_letter(C0 + j)
    if j < n:
        R = f'{col}{first}:{col}{end}'
    else:
        R = f'{get_column_letter(C0)}{first}:{get_column_letter(C0 + n - 1)}{end}'
    f = f'=COUNTIF({R},"O")&" / "&(COUNTIF({R},"O")+COUNTIF({R},"X")+COUNTIF({R},"K")+COUNTIF({R},"B"))'
    c = ws.cell(row=sr, column=C0 + j, value=f)
    c.font = F(bold=True)
    c.alignment = CENTER
for c in range(1, n + C0 + 1):
    ws.cell(row=sr, column=c).border = BOX
    ws.cell(row=sr, column=c).fill = HEAD_FILL

rng = f'{get_column_letter(C0)}{first}:{get_column_letter(C0 + n - 1)}{end}'
ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"O"'], fill=OK_FILL, font=F(bold=True, color='006100')))
ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"X"'], fill=BAD_FILL, font=F(bold=True, color='9C0006')))
ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"–"'], fill=NA_FILL))
ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"K"'], fill=KNOWN_FILL, font=F(bold=True, color='9C5700')))
ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"B"'], fill=FIXED_FILL, font=F(bold=True, color='1F4E79')))

lg = sr + 2
legend = [
    ('Legende', True),
    ('O = erfolgreich: Code erzeugt, mit dem echten Compiler/Interpreter der Sprache übersetzt und ausgeführt, Ausgabe bei allen Testfällen gleich der des eingebauten Interpreters', False),
    ('X = nicht erfolgreich: Fehler beim Erzeugen, Übersetzen oder Ausführen oder abweichende Ausgabe (Kommentar an der Zelle und Blatt „Details“ nennen den Grund)', False),
    ('K = bekannter Fehler: steht in inputs.json unter „_known“ mit dem Schritt aus docs/CODEGEN-PLAN.md, der ihn behebt; lässt den Lauf nicht fehlschlagen', False),
    ('B = bekannter Fehler behoben: läuft inzwischen fehlerfrei, der Eintrag unter „_known“ muss entfernt werden', False),
    ('– = nicht geprüft: Compiler der Sprache nicht installiert', False),
    ('„Erfolgreich“ zählt O je Zeile bzw. Spalte; hinter dem Schrägstrich steht die Zahl der geprüften Einträge (O, X, K und B). Testfälle: inputs.json im jeweiligen Ordner unter test/samples', False),
]
for k, (txt, bold) in enumerate(legend):
    c = ws.cell(row=lg + k, column=1, value=txt)
    c.font = F(bold=bold, size=10 if not bold else 11)

ws.column_dimensions['A'].width = 20
ws.column_dimensions['B'].width = 30
ws.column_dimensions['C'].width = 34
for j in range(n):
    ws.column_dimensions[get_column_letter(C0 + j)].width = 11
ws.column_dimensions[get_column_letter(C0 + n)].width = 12
ws.row_dimensions[HR].height = 32
ws.freeze_panes = ws.cell(row=first, column=C0)

# Details
d = wb.create_sheet('Details')
dh = ['Bereich', 'Aufgabe', 'Sprache', 'Testfall', 'Eingaben', 'Ergebnis', 'Erwartete Ausgabe (Interpreter)', 'Fehler']
for c, h in enumerate(dh, 1):
    cell = d.cell(row=1, column=c, value=h)
    cell.font = F(bold=True)
    cell.fill = HEAD_FILL
    cell.border = BOX
row = 2
for t in tasks:
    for l in langs:
        res = t['results'][l['id']]
        for k, c in enumerate(t['cases']):
            rc = res['cases'][k] if k < len(res['cases']) else None
            status = '–' if res['status'] == '-' else ('O' if rc and rc['ok'] else 'K' if res['status'] == 'K' else 'X')
            detail = res['detail'] if res['status'] == '-' else (rc['detail'] if rc else res.get('detail', ''))
            vals = [t.get('group') or '', t['name'], l['label'], k + 1, ', '.join(map(str, c['inputs'])) or '(keine)', status, c['expected'], detail]
            for ci, v in enumerate(vals, 1):
                cell = d.cell(row=row, column=ci, value=v)
                cell.font = F(bold=(ci == 6))
                cell.border = BOX
                cell.alignment = Alignment(vertical='top', wrap_text=ci in (7, 8), horizontal='center' if ci in (4, 6) else None)
            row += 1
drng = f'F2:F{row - 1}'
d.conditional_formatting.add(drng, CellIsRule(operator='equal', formula=['"O"'], fill=OK_FILL, font=F(bold=True, color='006100')))
d.conditional_formatting.add(drng, CellIsRule(operator='equal', formula=['"X"'], fill=BAD_FILL, font=F(bold=True, color='9C0006')))
d.conditional_formatting.add(drng, CellIsRule(operator='equal', formula=['"K"'], fill=KNOWN_FILL, font=F(bold=True, color='9C5700')))
for col, wdt in zip('ABCDEFGH', (20, 30, 20, 9, 22, 9, 50, 70)):
    d.column_dimensions[col].width = wdt
d.freeze_panes = 'A2'
d.auto_filter.ref = f'A1:H{row - 1}'

wb.calculation.fullCalcOnLoad = True
try:
    wb.save(dst)
except PermissionError:
    # Datei ist in Excel geöffnet: daneben mit Zeitstempel speichern
    import os
    base, ext = os.path.splitext(dst)
    dst = f'{base}_{datetime.now().strftime("%Y%m%d_%H%M%S")}{ext}'
    wb.save(dst)
print(dst)
