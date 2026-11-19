"""Dateisymbol für .nsd im Stil der Seti-Symbole: einfarbige Linien (Rahmen, Kopfzeile, Verzweigung, Zweige).
Aufruf: python build-nsd-file-icon.py <zielordner> [linienstärke]   (benötigt: pip install skia-pathops fonttools)"""
import sys
import pathops
from fontTools.pens.svgPathPen import SVGPathPen

W = float(sys.argv[2]) if len(sys.argv) > 2 else 1.25   # Linienstärke in px
H = W / 2
L, T, R, B = 2.5 + H, 2.5 + H, 13.5 - H, 13.5 - H        # Außenmaß 11 px wie die Seti-Glyphen
Y1, Y2, MX = 5.5, 9.25, 8.0                              # Kopfzeile, Unterkante der Verzweigung, Mitte

lines = pathops.Path(); p = lines.getPen()
RAD = 1.25                                               # Eckenradius (Mittellinie), wie bei den Codicons
k = 0.5523 * RAD
p.moveTo((L + RAD, T)); p.lineTo((R - RAD, T))
p.curveTo((R - RAD + k, T), (R, T + RAD - k), (R, T + RAD)); p.lineTo((R, B - RAD))
p.curveTo((R, B - RAD + k), (R - RAD + k, B), (R - RAD, B)); p.lineTo((L + RAD, B))
p.curveTo((L + RAD - k, B), (L, B - RAD + k), (L, B - RAD)); p.lineTo((L, T + RAD))
p.curveTo((L, T + RAD - k), (L + RAD - k, T), (L + RAD, T)); p.closePath()
def seg(a, b):
    p.moveTo(a); p.lineTo(b); p.endPath()
seg((L, Y1), (R, Y1))           # unter der ersten Anweisung
seg((L, Y1), (MX, Y2))          # Bedingungsdreieck
seg((R, Y1), (MX, Y2))
seg((L, Y2), (R, Y2))           # unter der Bedingung
seg((MX, Y2), (MX, B))          # Ja-/Nein-Zweig
lines.stroke(W, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
lines.simplify(fix_winding=True)
# nichts darf über das 11-px-Feld hinausragen
box = pathops.Path(); b = box.getPen()
b.moveTo((2.5, 2.5)); b.lineTo((13.5, 2.5)); b.lineTo((13.5, 13.5)); b.lineTo((2.5, 13.5)); b.closePath()
shape = pathops.op(lines, box, pathops.PathOp.INTERSECTION)

sp = SVGPathPen(None, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
shape.draw(sp)
d = sp.getCommands()
for name, color in (('nsd-dark.svg', '#962D47'), ('nsd-light.svg', '#962D47')):
    open(sys.argv[1] + '/' + name, 'w').write(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="{color}" d="{d}"/></svg>\n')
print(d)
