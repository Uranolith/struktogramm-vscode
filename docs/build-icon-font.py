"""Symbolschrift für Struktograf: „Neues Struktogramm“ im Codicon-Stil.
Der Kreis mit ausgespartem Plus wird 1:1 aus dem Codicon „new-file“ übernommen
(Codicons © Microsoft, CC BY 4.0, https://github.com/microsoft/vscode-codicons).

Aufruf: python build-icon-font.py <pfad/zu/codicon.ttf> <ziel ohne Endung> 4.5 8 8
  (codicon.ttf liegt in der VS-Code-Installation unter resources/app/out/media/;
   benötigt: pip install fonttools skia-pathops)"""
import sys, math
import pathops
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.fontBuilder import FontBuilder

CODICON = sys.argv[1]
OUT = sys.argv[2]
UPM = 300
PX = UPM / 16          # Einheiten je Pixel bei 16 px
STROKE = 1.0 * PX      # Linienstärke der Codicons

def P(x, y):           # Pixel (y nach unten) -> Schrifteinheiten (y nach oben)
    return (x * PX, UPM - y * PX)

# ---- Kreis + Plus aus new-file
cod = TTFont(CODICON)
gs = cod.getGlyphSet()
rec = DecomposingRecordingPen(gs)
gs[cod.getBestCmap()[0xEA7F]].draw(rec)
contours, cur = [], []
for op, args in rec.value:
    cur.append((op, args))
    if op in ('closePath', 'endPath'):
        contours.append(cur); cur = []
def bounds(c):
    pts = [p for _, a in c for p in a]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)
badge = pathops.Path()
bp = badge.getPen()
cx = cy = r = None
for c in contours:
    x0, y0, x1, y1 = bounds(c)
    if x0 >= 120 and y1 <= 175:          # Kreis und Plus unten rechts
        for op, args in c: getattr(bp, op)(*args)
        if x1 - x0 > 150: cx, cy, r = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2
assert r, 'Kreis nicht gefunden'
badge.simplify(fix_winding=True)

def circle(cx, cy, rr):
    p = pathops.Path(); pen = p.getPen(); k = 0.5523 * rr
    pen.moveTo((cx + rr, cy))
    pen.curveTo((cx + rr, cy + k), (cx + k, cy + rr), (cx, cy + rr))
    pen.curveTo((cx - k, cy + rr), (cx - rr, cy + k), (cx - rr, cy))
    pen.curveTo((cx - rr, cy - k), (cx - k, cy - rr), (cx, cy - rr))
    pen.curveTo((cx + k, cy - rr), (cx + rr, cy - k), (cx + rr, cy))
    pen.closePath(); return p

# ---- Struktogramm (Mittellinien in Pixeln, 16er Raster)
lines = pathops.Path(); pen = lines.getPen()
L, T, R, B, RAD = 1.5, 1.5, 14.5, 14.5, 1.5
k = 0.5523 * RAD
def rrect():
    pen.moveTo(P(L + RAD, T)); pen.lineTo(P(R - RAD, T))
    pen.curveTo(P(R - RAD + k, T), P(R, T + RAD - k), P(R, T + RAD)); pen.lineTo(P(R, B - RAD))
    pen.curveTo(P(R, B - RAD + k), P(R - RAD + k, B), P(R - RAD, B)); pen.lineTo(P(L + RAD, B))
    pen.curveTo(P(L + RAD - k, B), P(L, B - RAD + k), P(L, B - RAD)); pen.lineTo(P(L, T + RAD))
    pen.curveTo(P(L, T + RAD - k), P(L + RAD - k, T), P(L + RAD, T)); pen.closePath()
def seg(a, b):
    pen.moveTo(P(*a)); pen.lineTo(P(*b)); pen.endPath()
rrect()
Y1, Y2, MX = (float(v) for v in (sys.argv[3:6] if len(sys.argv) > 5 else (5.0, 9.5, 8.0)))
seg((L, Y1), (R, Y1))                # Trennlinie unter der ersten Anweisung
seg((L, Y1), (MX, Y2))               # Bedingungsdreieck
seg((R, Y1), (MX, Y2))
seg((L, Y2), (R, Y2))                # Linie unter der Bedingung
seg((MX, Y2), (MX, B))               # Ja-/Nein-Zweig
base = pathops.Path()
lines.stroke(STROKE, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
base = lines
base.simplify(fix_winding=True)

# Abstand um den Kreis wie bei den Codicons (1 px) und zum Rand beschneiden
gap = circle(cx, cy, r + 1.0 * PX)
base = pathops.op(base, gap, pathops.PathOp.DIFFERENCE)
glyph = pathops.op(base, badge, pathops.PathOp.UNION)

# ---- Schrift erzeugen
fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(['.notdef', 'new'])
fb.setupCharacterMap({0xE001: 'new'})
def ttglyph(path):
    tp = TTGlyphPen(None)
    path.draw(Cu2QuPen(tp, max_err=0.5, reverse_direction=True))
    return tp.glyph()
empty = TTGlyphPen(None).glyph()
fb.setupGlyf({'.notdef': empty, 'new': ttglyph(glyph)})
fb.setupHorizontalMetrics({'.notdef': (UPM, 0), 'new': (UPM, 0)})
fb.setupHorizontalHeader(ascent=UPM, descent=0)
fb.setupOS2(sTypoAscender=UPM, sTypoDescender=0, usWinAscent=UPM, usWinDescent=0)
fb.setupNameTable({'familyName': 'struktograf-icons', 'styleName': 'Regular'})
fb.setupPost()
fb.font.save(OUT + '.ttf')
fb.font.flavor = 'woff'
fb.font.save(OUT + '.woff')
# SVG-Fassung (für die Vorschau / README)
from fontTools.pens.svgPathPen import SVGPathPen
sp = SVGPathPen(None); glyph.draw(sp)
open(OUT + '.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {UPM} {UPM}"><path transform="matrix(1 0 0 -1 0 {UPM})" fill="currentColor" d="{sp.getCommands()}"/></svg>')
print('ok', OUT, 'Kreis', round(cx), round(cy), round(r))
