from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / 'src' / 'assets' / 'taskbar'
out.mkdir(parents=True, exist_ok=True)
scale = 4
def icon(name, draw):
    image = Image.new('RGBA', (32 * scale, 32 * scale))
    draw(ImageDraw.Draw(image))
    image.resize((32, 32), Image.Resampling.LANCZOS).save(out / (name + '.png'))
def polygon(draw, points, fill='white'):
    draw.polygon([(x * scale, y * scale) for x, y in points], fill=fill)
icon('play', lambda d: polygon(d, [(10,5),(27,16),(10,27)]))
icon('pause', lambda d: [polygon(d, points) for points in [[(8,5),(13,5),(13,27),(8,27)],[(19,5),(24,5),(24,27),(19,27)]]])
for name, flipped in [('previous', False), ('next', True)]:
    shapes = [[(7,6),(11,6),(11,26),(7,26)],[(25,6),(11,16),(25,26)]]
    icon(name, lambda d, shapes=shapes, flipped=flipped: [polygon(d, [(32-x if flipped else x,y) for x,y in shape]) for shape in shapes])
heart = [(16,28),(3,15),(2,11),(3,7),(6,4),(10,4),(13,5),(16,9),(19,5),(22,4),(26,4),(29,7),(30,11),(29,15)]
icon('favorite', lambda d: d.line([(x*scale,y*scale) for x,y in heart + [heart[0]]], fill='white', width=2*scale, joint='curve'))
icon('favorited', lambda d: polygon(d, heart, '#006cff'))
image = Image.new('RGBA', (256,256))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0,0,255,255), radius=54, fill='#006cff')
draw.ellipse((44,36,214,216), fill='white')
draw.ellipse((87,15,239,178), fill='#006cff')
image.save(out / 'app.png')
