"""Regenerate project-owned fixtures. Requires Pillow and an FFmpeg executable."""
import argparse
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--ffmpeg', default='ffmpeg')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
art = root / 'tests' / 'fixtures' / 'cover.png'
image = Image.new('RGB', (256, 256))
for y in range(256):
    for x in range(256):
        image.putpixel((x, y), (20 + x // 8, 35 + y // 5, 75 + (x + y) // 5))
draw = ImageDraw.Draw(image)
draw.ellipse((48, 36, 212, 200), fill='#c7e0ff')
draw.ellipse((91, 20, 229, 162), fill='#254b87')
draw.text((24, 224), 'CRESCENT TEST', fill='#e0edff')
image.save(art)
def encode(file, title, duration, frequency, cover):
    command = [args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency={frequency}:sample_rate=44100:duration={duration}']
    if cover:
        command += ['-i', str(art), '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic']
    command += ['-c:a', 'libmp3lame' if file.suffix == '.mp3' else 'flac']
    if file.suffix == '.mp3':
        command += ['-b:a', '64k', '-id3v2_version', '3']
    command += ['-metadata', f'title={title}', '-metadata', 'artist=Crescent Studio', '-metadata', 'album=First Light', str(file)]
    subprocess.run(command, check=True)
for filename, title, frequency in [('Moonrise.mp3', 'Moonrise', 220), ('Afterglow.flac', 'Afterglow', 330)]:
    encode(art.parent / filename, title, 3, frequency, True)
seek = root / 'tests' / 'seek-fixtures'
seek.mkdir(exist_ok=True)
for extension, frequency in [('mp3', 220), ('flac', 330)]:
    encode(seek / ('Seek.' + extension), 'Seek Fixture', 185, frequency, False)
print('Generated sine-wave audio and procedural artwork; no third-party recordings used.')
