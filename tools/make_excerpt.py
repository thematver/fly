#!/usr/bin/env python3
"""Cut a bar-aligned excerpt from the master and bake its loudness envelope.

The master itself never goes into dist/. Only the excerpt and a tiny JSON
envelope do. Usage:

  python3 tools/make_excerpt.py MASTER.mp3 START_BAR END_BAR [OUT_DIR] [FADE_IN_S] [TAIL_S]

Bars follow the grid measured on the master: 125 BPM, bar = 1.92 s,
first downbeat at 0.26 s (bar 0). END_BAR is exclusive, so 16 28 means
bars 16..27. Fractions are beats: 15.75 is one beat before bar 16.
TAIL_S > 0 throws the last beat into a huge reverb that rings for TAIL_S
seconds after the dry cut and is then cut off hard.
Writes excerpt.mp3 and excerpt.json to OUT_DIR (default dist/assets).
"""
import array, json, math, os, subprocess, sys

BPM = 125.0
BAR = 240.0 / BPM
PHASE = 0.26
FPS = 30  # envelope frames per second
HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.environ.get('FFMPEG') or os.path.join(
    HERE, '..', '..', '..', 'work', 'audio-tools', 'imageio_ffmpeg', 'binaries', 'ffmpeg-macos-aarch64-v7.1')


def bar_time(n):
    return PHASE + n * BAR


def pcm(path, filt, sr):
    raw = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-af', filt + f',aresample={sr}',
                          '-f', 's16le', '-acodec', 'pcm_s16le', '-'], check=True, capture_output=True).stdout
    a = array.array('h')
    a.frombytes(raw)
    return a


def envelope(path, filt, sr=8000):
    a = pcm(path, 'pan=mono|c0=0.5*c0+0.5*c1,' + filt if filt else 'pan=mono|c0=0.5*c0+0.5*c1', sr)
    hop = sr // FPS
    out = []
    for i in range(0, len(a) - hop + 1, hop):
        s = 0
        for v in a[i:i + hop]:
            s += v * v
        out.append(math.sqrt(s / hop) / 32768)
    peak = max(out) or 1
    return [round(255 * min(1, (x / peak) ** 0.8)) for x in out]


def render_with_tail(master, start, end, fade_in, tail, mp3):
    """Dry excerpt cut hard at `end`; the last beat and a half go into a long,
    dense reverb whose tail swells after the cut and is itself cut off."""
    import tempfile
    beat = 60.0 / BPM
    send0 = end - 1.5 * beat
    dur = end - start
    total = dur + tail
    with tempfile.TemporaryDirectory() as tmp:
        ir = os.path.join(tmp, 'ir.wav')
        # Stereo noise IR, 5 s, exponential decay, darker and thinner at the bottom.
        subprocess.run([FFMPEG, '-v', 'error', '-y',
                        '-f', 'lavfi', '-i', 'anoisesrc=d=5:c=white:r=48000:a=0.5:seed=11',
                        '-f', 'lavfi', '-i', 'anoisesrc=d=5:c=white:r=48000:a=0.5:seed=29',
                        '-filter_complex',
                        '[0][1]amerge=inputs=2,afade=t=in:d=0.04,afade=t=out:st=0.04:d=4.96:curve=exp,'
                        'highpass=f=220,lowpass=f=9000,adelay=18|25',
                        '-ac', '2', ir], check=True)
        graph = (
            f'[0:a]atrim=start={start:.4f}:end={end:.4f},asetpts=PTS-STARTPTS,'
            f'afade=t=in:d={fade_in:.3f},afade=t=out:st={dur - 0.025:.4f}:d=0.025,apad=pad_dur={tail:.3f}[dry];'
            f'[0:a]atrim=start={send0:.4f}:end={end:.4f},asetpts=PTS-STARTPTS,'
            f'afade=t=in:d=0.12,apad=pad_dur=6[send];'
            f'[send][1:a]afir=gtype=none:irnorm=-1:irgain=0.02:maxir=6[w0];'
            f'[w0]acompressor=threshold=-30dB:ratio=4:attack=60:release=1200:makeup=8,'
            f'adelay={int((send0 - start) * 1000)}|{int((send0 - start) * 1000)},'
            # After the dry cut the wash keeps swelling (+15 dB/s against the decay) until it is cut off.
            f"volume='if(lt(t,{dur:.3f}),1,pow(10,(t-{dur:.3f})*0.75))':eval=frame[wet];"
            f'[dry][wet]amix=inputs=2:normalize=0:duration=longest,'
            f'atrim=end={total:.4f},afade=t=out:st={total - 0.012:.4f}:d=0.012,alimiter=limit=0.89:level=false[out]'
        )
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', master, '-i', ir, '-filter_complex', graph, '-map', '[out]',
                        '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1',
                        '-c:a', 'libmp3lame', '-b:a', '192k', mp3], check=True)


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    master, b0, b1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    out_dir = sys.argv[4] if len(sys.argv) > 4 else os.path.join(HERE, '..', 'dist', 'assets')
    fade_in = float(sys.argv[5]) if len(sys.argv) > 5 else .015
    tail = float(sys.argv[6]) if len(sys.argv) > 6 else 0
    start, end = bar_time(b0), bar_time(b1)
    dur = end - start
    mp3 = os.path.join(out_dir, 'excerpt.mp3')
    if tail > 0:
        render_with_tail(master, start, end, fade_in, tail, mp3)
    else:
        # 35 ms out: no click, but the ending still reads as a hard cut.
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', f'{dur:.3f}', '-i', master,
                        '-af', f'afade=t=in:d={fade_in:.3f},afade=t=out:st={dur - 0.035:.3f}:d=0.035',
                        '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1',
                        '-c:a', 'libmp3lame', '-b:a', '192k', mp3], check=True)
    env = {
        'bpm': BPM,
        'fps': FPS,
        'duration': round(dur + tail, 3),
        'cut': round(dur, 3),
        'source': [round(start, 3), round(end, 3)],
        'bars': [b0, b1],
        'low': envelope(mp3, 'lowpass=f=140,lowpass=f=140'),
        'mid': envelope(mp3, 'highpass=f=300,lowpass=f=3000'),
        'high': envelope(mp3, 'highpass=f=5000'),
    }
    with open(os.path.join(out_dir, 'excerpt.json'), 'w') as f:
        json.dump(env, f, separators=(',', ':'))
    print(f'bars {b0}..{b1}: {start:.2f}s -> {end:.2f}s ({dur:.2f}s), {len(env["low"])} frames')


main()
