"""
LoL Skin Vault — Downloader
-----------------------------
Run this script while the League of Legends client is open.

It will:
  1. Connect to the League client and save your skins + loot data
  2. Download all DDragon champion data and images locally
  3. Retry any failed downloads automatically (up to 3 passes)

Output structure (everything the HTML needs):
  data/
    champions.json          <- all champion + skin metadata
    skins.json              <- your owned skins (from League client)
    skinsLoot.json          <- your loot skins (from League client)
    img/champion/           <- square portrait PNGs  (e.g. Annie.png)
    img/loading/            <- loading screen JPGs   (e.g. Annie_0.jpg)

After running, open lol-skin-browser.html in your browser.
Serve with: python -m http.server 8000
"""

import json
import re
import ssl
import sys
import time
import base64
import subprocess
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import psutil

BASE_DDR  = "https://ddragon.leagueoflegends.com"
OUT_DIR   = Path("data")
IMG_CHAMP = OUT_DIR / "img" / "champion"
IMG_LOAD  = OUT_DIR / "img" / "loading"

MAX_RETRY_PASSES = 3

# ── Download helpers ───────────────────────────────────────────────────────────
def try_download(url: str, dest: Path) -> tuple[bool, str | None]:
    """
    Attempt a single download.
    Returns (success, error_message).
    success=None means "skip silently" (404/403).
    """
    try:
        urllib.request.urlretrieve(url, dest)
        print(f"Downloaded: {url}")
        return True, None
    except urllib.error.HTTPError as e:
        print(f"Error download http {url} ERROR: {e}")
        if e.code in (403, 404):
            return None, None   # doesn't exist on CDN, skip silently
        return False, f"HTTP {e.code}"
    except Exception as e:
        print(f"Error: {e}")
        return False, str(e)


def progress(current: int, total: int, label: str = ""):
    pct = int(current / total * 40)
    bar = "█" * pct + "░" * (40 - pct)
    sys.stdout.write(f"\r  [{bar}] {current}/{total}  {label:<35}")
    sys.stdout.flush()


def bulk_download(tasks: list[tuple[str, Path, str]], workers: int = 10) -> list[tuple[str, Path, str]]:
    """
    Download all tasks in parallel.
    Returns list of failed tasks (excluding silent 403/404 skips) for retry.
    """
    # Filter out files that already exist before touching the network
    pending = [(url, dest, lbl) for url, dest, lbl in tasks if not dest.exists()]
    already = len(tasks) - len(pending)
    if already:
        print(f"  -> {already} already on disk, skipping")

    failed = []
    if not pending:
        print(f"  -> Nothing to download")
        return failed

    total = len(pending)
    done  = 0

    with ThreadPoolExecutor(max_workers=workers) as ex:
        future_map = {ex.submit(try_download, url, dest): (url, dest, lbl)
                      for url, dest, lbl in pending}

        for fut in as_completed(future_map):
            done += 1
            url, dest, lbl = future_map[fut]
            ok, err = fut.result()

            if ok is None:
                pass   # 403/404 — doesn't exist on CDN, silent skip
            elif not ok:
                failed.append((url, dest, lbl))  # genuine failure, retry later

            progress(done, total, lbl)

    newly = done - len(failed)
    print(f"\n  -> {newly} downloaded, {len(failed)} failed")
    return failed


def bulk_download_with_retry(tasks: list, workers: int = 10, label: str = ""):
    """Run bulk_download, then retry failures with back-off up to MAX_RETRY_PASSES times."""
    remaining = tasks
    for attempt in range(1, MAX_RETRY_PASSES + 1):
        if not remaining:
            break
        if attempt > 1:
            wait = attempt * 3
            print(f"\n  Retry pass {attempt}/{MAX_RETRY_PASSES} "
                  f"({len(remaining)} items) — waiting {wait}s...")
            time.sleep(wait)
        remaining = bulk_download(remaining, workers=workers)

    if remaining:
        print(f"\n  !! {len(remaining)} file(s) still failed after {MAX_RETRY_PASSES} retries:")
        for url, dest, lbl in remaining[:20]:
            print(f"     {lbl}")
        if len(remaining) > 20:
            print(f"     ... and {len(remaining) - 20} more")
        print("  Tip: re-run the script to pick up where it left off "
              "(already-downloaded files are skipped).")
    else:
        print("  All files downloaded successfully.")


# ── DDragon ────────────────────────────────────────────────────────────────────

def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read().decode())


def fetch_ddragon():
    print("\n── DDragon Data ──────────────────────────────────────────────")

    version_file = OUT_DIR / "version.txt"
    print("Checking latest DDragon version...")
    versions = fetch_json(f"{BASE_DDR}/api/versions.json")
    version  = versions[0]
    CDN      = f"{BASE_DDR}/cdn/{version}"

    if version_file.exists() and version_file.read_text().strip() == version:
        print(f"  -> Already on latest version {version}, skipping champion JSON download")
        if (OUT_DIR / "champions.json").exists():
            all_champions = json.loads(
                (OUT_DIR / "champions.json").read_text(encoding="utf-8")
            )
            download_missing_images(all_champions, CDN)
            return

    print(f"  -> New version: {version}")
    version_file.write_text(version)

    print("Fetching champion list...")
    champ_summary = fetch_json(f"{CDN}/data/en_US/champion.json")
    champ_ids     = [c["id"] for c in champ_summary["data"].values()]
    print(f"  -> {len(champ_ids)} champions")

    print("Fetching champion skin data...")
    all_champions = {}

    def fetch_champ(cid):
        try:
            d = fetch_json(f"{CDN}/data/en_US/champion/{cid}.json")
            c = d["data"][cid]
            return cid, {"id": cid, "name": c["name"], "key": c["key"], "skins": c["skins"]}
        except Exception as e:
            print(f"\n  !! {cid}: {e}")
            return cid, None

    with ThreadPoolExecutor(max_workers=20) as ex:
        futures = {ex.submit(fetch_champ, cid): cid for cid in champ_ids}
        done = 0
        for fut in as_completed(futures):
            done += 1
            progress(done, len(champ_ids), futures[fut])
            cid, data = fut.result()
            if data:
                all_champions[cid] = data

    print(f"\n  -> {len(all_champions)} champions loaded")
    (OUT_DIR / "champions.json").write_text(
        json.dumps(all_champions, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("  -> Saved data/champions.json")

    download_missing_images(all_champions, CDN)


def download_missing_images(all_champions: dict, CDN: str):
    # Count total skins
    total_skins = sum(len(c["skins"]) for c in all_champions.values())
    print(f"\n  Total skins in champion data: {total_skins}")
    print(f"  Loading screens already on disk: {len(list(IMG_LOAD.glob('*.jpg')))}")

    print("\nDownloading champion portraits...")
    portrait_tasks = [
        (f"{CDN}/img/champion/{cid}.png", IMG_CHAMP / f"{cid}.png", cid)
        for cid in all_champions
    ]
    bulk_download_with_retry(portrait_tasks, workers=10)

    print("\nDownloading skin loading screens...")
    loading_tasks = []
    for cid, champ in all_champions.items():
        for skin in champ["skins"]:
            fname = f"{cid}_{skin['num']}.jpg"
            loading_tasks.append((
                f"{BASE_DDR}/cdn/img/champion/loading/{fname}",
                IMG_LOAD / fname,
                fname
            ))
    print(f"  Total loading tasks queued: {len(loading_tasks)}")
    bulk_download_with_retry(loading_tasks, workers=10)


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    for d in (OUT_DIR, IMG_CHAMP, IMG_LOAD):
        d.mkdir(parents=True, exist_ok=True)

    fetch_ddragon()

    print("\n All done!")


if __name__ == "__main__":
    main()