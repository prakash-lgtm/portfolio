import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from PIL import Image, ImageFilter
import numpy as np
import scipy.ndimage as ndi

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(BASE_DIR, 'ezgif-6691b0d7d5062ee0-jpg')
OUTPUT_DIR = os.path.join(BASE_DIR, 'frames-transparent')

os.makedirs(OUTPUT_DIR, exist_ok=True)

def process_one_frame(i):
    """
    Extracts the subject silhouette cleanly:
    - Calibrated chroma keying for studio red backdrop (G/R < 0.28, B/R < 0.33)
    - 100% solid skin, forehead, eyes, sunglasses, mouth, and beard
    - 1px erosion choke to pull back boundary from outer red studio light
    - Color despill on dark clothing, hair, and edges
    - Smooth 1.0px anti-aliased alpha feathering
    """
    try:
        padded = str(i).zfill(3)
        in_file = os.path.join(INPUT_DIR, f'ezgif-frame-{padded}.jpg')
        out_file = os.path.join(OUTPUT_DIR, f'ezgif-frame-{padded}.webp')

        if not os.path.exists(in_file):
            return i, False, f"File not found: {in_file}"

        img = Image.open(in_file)
        arr = np.array(img, dtype=np.float32)
        r = arr[:, :, 0]
        g = arr[:, :, 1]
        b = arr[:, :, 2]

        # Studio background chromatic calibration:
        redness = r - np.maximum(g, b)
        ratio_g = g / np.maximum(r, 1.0)
        ratio_b = b / np.maximum(r, 1.0)

        is_bg = (r > 38) & (redness > 20) & (ratio_g < 0.28) & (ratio_b < 0.33)
        fg_raw = ~is_bg

        # Erase outer black border encode artifacts & bottom-right watermark
        fg_raw[:3, :] = False
        fg_raw[1076:, :350] = False
        fg_raw[1076:, 1550:] = False
        fg_raw[995:, 1805:] = False

        # Morphological closing bridges small hair curl crevices and fills single-pixel shadows
        fg_closed = ndi.binary_closing(fg_raw, structure=np.ones((5, 5)))

        # Fill internal cavities so facial hair, shadows, eyes & mouth remain 100% solid
        fg_filled = ndi.binary_fill_holes(fg_closed)

        # Retain main connected human silhouette
        labeled, num = ndi.label(fg_filled)
        if num > 0:
            sizes = ndi.sum(fg_filled, labeled, range(1, num + 1))
            main_label = np.argmax(sizes) + 1
            fg_mask = (labeled == main_label)
        else:
            fg_mask = fg_filled

        # Final hole fill
        fg_mask = ndi.binary_fill_holes(fg_mask)

        # 1px erosion choke: pulls back the mask to eliminate the outer 1-pixel red studio fringe
        fg_choked = ndi.binary_erosion(fg_mask, structure=ndi.generate_binary_structure(2, 1))

        # Convert mask to PIL Image and apply smooth anti-aliased feathering
        mask_im = Image.fromarray((fg_choked * 255).astype(np.uint8))
        mask_blur = mask_im.filter(ImageFilter.GaussianBlur(radius=1.0))
        alpha_arr = np.array(mask_blur, dtype=np.float32)

        # Professional Red Despill (Removes all red shadow/fringe from dark clothing, hair and edges):
        r_clean = r.copy()
        # 1. Dark clothing and hair (G < 45, B < 45): clamp red excess down to max(G, B)
        despill_dark = (alpha_arr > 0) & (g < 45) & (b < 45) & (r_clean > np.maximum(g, b))
        r_clean[despill_dark] = np.maximum(g[despill_dark], b[despill_dark])

        # 2. Feathered silhouette transition edge (alpha < 240): remove red backdrop spill
        edge_spill = (alpha_arr > 0) & (alpha_arr < 240) & (g + b < 160) & (r_clean > np.maximum(g, b))
        r_clean[edge_spill] = np.maximum(g[edge_spill], b[edge_spill])

        # Output RGBA WebP with alpha transparency
        clean_rgba = np.dstack([r_clean, g, b, alpha_arr]).astype(np.uint8)
        rgba = Image.fromarray(clean_rgba, 'RGBA')
        rgba.save(out_file, 'WEBP', quality=90, method=2)
        return i, True, None
    except Exception as e:
        return i, False, str(e)

def main():
    # Parse optional CLI range arguments:
    # Example usage:
    #   python convert_frames_to_transparent.py           -> processes all 240 frames
    #   python convert_frames_to_transparent.py 226       -> processes frame 226 only
    #   python convert_frames_to_transparent.py 1 50      -> processes frames 1 to 50
    start_frame = 1
    end_frame = 240

    if len(sys.argv) == 2:
        start_frame = int(sys.argv[1])
        end_frame = start_frame
    elif len(sys.argv) >= 3:
        start_frame = int(sys.argv[1])
        end_frame = int(sys.argv[2])

    frame_indices = list(range(start_frame, end_frame + 1))
    total_count = len(frame_indices)

    print(f"Converting {total_count} frame(s) [{start_frame} -> {end_frame}] to transparent WebP...")
    print(f"Input : {INPUT_DIR}")
    print(f"Output: {OUTPUT_DIR}\n")

    t0 = time.time()
    workers = min(8, os.cpu_count() or 4)

    success_count = 0
    errors = []

    with ProcessPoolExecutor(max_workers=workers) as executor:
        future_to_idx = {executor.submit(process_one_frame, idx): idx for idx in frame_indices}
        
        for future in as_completed(future_to_idx):
            idx, ok, err = future.result()
            if ok:
                success_count += 1
            else:
                errors.append((idx, err))
            
            # Real-time progress display
            pct = (success_count + len(errors)) / total_count * 100
            status_str = "OK" if ok else "FAIL"
            print(f"\rProgress: [{success_count + len(errors)}/{total_count}] ({pct:5.1f}%) - Frame {idx:03d} [{status_str}]", end="", flush=True)

    print()
    elapsed = time.time() - t0
    print(f"\nDone! Processed {success_count}/{total_count} frames successfully in {elapsed:.2f}s ({elapsed/max(1, total_count):.3f}s per frame).")

    if errors:
        print(f"\nEncountered {len(errors)} error(s):")
        for idx, err in errors[:10]:
            print(f"  Frame {idx:03d}: {err}")

if __name__ == '__main__':
    main()
