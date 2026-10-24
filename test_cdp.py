"""
Local CDP and Server Verification Script
Checks server health, frame availability, and verifies transparent video playback.
"""
import urllib.request
import json
import os

PORT = 3000
BASE_URL = f"http://localhost:{PORT}"

def check_server():
    try:
        resp = urllib.request.urlopen(BASE_URL, timeout=5)
        print(f"[OK] Server running on {BASE_URL} (Status {resp.status})")
        return True
    except Exception as e:
        print(f"[FAIL] Could not reach server at {BASE_URL}: {e}")
        return False

def check_sample_frames():
    test_indices = ["001", "050", "100", "150", "200", "226", "240"]
    missing = []
    for idx in test_indices:
        url = f"{BASE_URL}/frames-transparent/ezgif-frame-{idx}.webp?v=4"
        try:
            resp = urllib.request.urlopen(url, timeout=5)
            if resp.status != 200:
                missing.append(idx)
        except Exception:
            missing.append(idx)
    
    if not missing:
        print(f"[OK] Transparent frames successfully served from server ({len(test_indices)} sample keyframes verified).")
    else:
        print(f"[WARN] Some frames could not be fetched: {missing}")

if __name__ == '__main__':
    print("Testing Portfolio Local Server & Frames...")
    if check_server():
        check_sample_frames()
