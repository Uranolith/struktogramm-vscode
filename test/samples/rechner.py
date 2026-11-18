import math

def summe(a: int, b: int) -> int:
    """Addiert zwei Zahlen."""
    return a + b

def ist_prim(n):
    if n < 2:
        return False
    for i in range(2, int(math.sqrt(n)) + 1):
        if n % i == 0:
            return False
    return True

zahl = int(input("Zahl: "))
s = 0
for i in range(1, zahl + 1):
    s += i
print("Summe:", s)
if ist_prim(zahl):
    print(f"{zahl} ist prim")
elif zahl % 2 == 0:
    print("gerade")
else:
    print("ungerade")
while zahl > 0 and s != 3:
    zahl = zahl // 2
match zahl:
    case 0:
        print("null")
    case 1 | 2:
        print("klein")
    case _:
        print("groß")
x = 10
while True:
    x -= 3
    if x < 0:
        break
print(summe(x, 2))
