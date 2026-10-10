"""Render a clearly labelled Wallet layout approximation around the actual strip.

Usage: python scripts/preview-wallet.py pass.json strip.png output.png
This is not an iPhone screenshot; native field placement/fonts vary by device.
"""
import io
import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFont
import qrcode

ROOT = Path(__file__).resolve().parents[1]
S = 3
pass_json = json.loads(Path(sys.argv[1]).read_text())
strip = Image.open(sys.argv[2]).convert('RGB')
W, H = 435 * S, 670 * S
im = Image.new('RGB', (W, H), '#f6f4ef')
d = ImageDraw.Draw(im)
font_cache = {}


def face(size, weight=500, native=False):
    key = (size, weight, native)
    if key not in font_cache:
        if native:
            # Approximate the system text only; do not suggest that custom pass fonts exist.
            filename = '/usr/share/fonts/truetype/dejavu/DejaVuSans' + ('-Bold' if weight >= 600 else '') + '.ttf'
            font_cache[key] = ImageFont.truetype(filename, round(size * S))
        else:
            ft = TTFont(ROOT / 'public/fonts/readex-pro-arabic-wght-normal.woff2')
            ft = instantiateVariableFont(ft, {'wght': weight}, inplace=True)
            ft.flavor = None
            buf = io.BytesIO()
            ft.save(buf)
            buf.seek(0)
            font_cache[key] = ImageFont.truetype(buf, round(size * S))
    return font_cache[key]


def text(value, xy, size=16, color='#205447', weight=500, anchor='mm', native=False):
    f = face(size, weight, native)
    options = {'direction': 'rtl', 'language': 'ar'} if any('\u0600' <= c <= '\u06ff' for c in str(value)) else {}
    d.text((xy[0] * S, xy[1] * S), str(value), fill=color, font=f, anchor=anchor, **options)


text('التحديث الجديد', (W / S / 2, 31), 20, weight=650)
text('معاينة قبل النشر', (W / S / 2, 62), 13)
x, y, cw, ch = 30, 95, 375, 505
bg = pass_json['backgroundColor']
fg = pass_json['foregroundColor']
label = pass_json['labelColor']
d.rounded_rectangle((x*S,y*S,(x+cw)*S,(y+ch)*S),radius=19*S,fill=bg)
text(pass_json['organizationName'],(x+24,y+31),28,fg,650,'lm')
text('COFFEE HOUSE',(x+24,y+58),8,fg,native=True,anchor='lm')
header = pass_json['storeCard']['headerFields'][0]
text(header['label'],(x+cw-24,y+23),12,label,native=True,anchor='rm')
text(header['value'],(x+cw-24,y+53),28,fg,native=True,anchor='rm')
im.paste(strip.resize((cw*S,144*S),Image.Resampling.LANCZOS),(x*S,(y+80)*S))
fields = pass_json['storeCard']['secondaryFields']
for i, field in enumerate(fields):
    fx=x+24 if i==0 else x+cw-24
    anchor='lm' if i==0 else 'rm'
    text(field['label'],(fx,y+252),12,label,native=True,anchor=anchor)
    value_size=23 if i==1 else 19
    # Native Wallet can shrink longer names. Fit the approximation without clipping.
    while face(value_size,600,True).getlength(str(field['value'])) > 160*S and value_size>13:
        value_size-=1
    text(field['value'],(fx,y+282),value_size,fg,600,native=True,anchor=anchor)
qr = qrcode.QRCode(box_size=10,border=3)
qr.add_data(pass_json['barcodes'][0]['message'])
qr.make(fit=True)
qi = qr.make_image(fill_color='black',back_color='white').convert('RGB')
qi = qi.resize((147*S,147*S),Image.Resampling.NEAREST)
qx=x+(cw-147)/2
im.paste(qi,(round(qx*S),(y+325)*S))
text(pass_json['barcodes'][0]['altText'],(x+cw/2,y+487),14,fg,native=True)
text('الرسم من التحديث، وترتيب المحفظة تقريبي',(W/S/2,631),11)
im.save(sys.argv[3])
print(sys.argv[3])
