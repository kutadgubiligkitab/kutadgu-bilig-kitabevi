"""Build the primary UKIJ CJK derivatives and point declarations at them.

The original UKIJCJK.woff2 and UKIJCJK.ttf files stay byte for byte at the
same URLs. Each derivative keeps every original codepoint except the
deferred scripts Hani, Hang, Kana, Hira, and Bopo. The WOFF2 derivative is
subset from the WOFF2 source, and the TTF derivative is subset from the TTF
source, because those files do not share glyph names.

Requires Python 3 with fontTools, brotli, and uharfbuzz. From the repository
root:

    python scripts/generate-ukij-primary-font.py

Then run scripts/check-ukij-primary-font.py.
"""
from pathlib import Path
import hashlib
import os
import re
import sys

if os.environ.get("PYTHONHASHSEED") != "0":
    os.environ["PYTHONHASHSEED"] = "0"
    os.execv(sys.executable, [sys.executable, *sys.argv])

from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter
from fontTools.unicodedata import script

ROOT = Path(__file__).resolve().parents[1]
DEFERRED = {"Hani", "Hang", "Kana", "Hira", "Bopo"}
SOURCE = {
    "woff2": ROOT / "UKIJCJK.woff2",
    "ttf": ROOT / "UKIJCJK.ttf",
}
DERIVATIVE = {
    "woff2": ROOT / "UKIJCJK-primary.woff2",
    "ttf": ROOT / "UKIJCJK-primary.ttf",
}
RANGE_DIR = ROOT / "scripts" / "ukij-font-ranges"
SKIP_PARTS = ("node_modules", ".git", "test-results", "playwright-report", "tests/e2e/fixtures", "tests\\e2e\\fixtures")
PIN_REPLACEMENTS = (
    ("theme.css?v=11", "theme.css?v=12"),
    ("theme.css?v=9", "theme.css?v=12"),
    ("index.css?v=21", "index.css?v=22"),
    ("admin.css?v=66", "admin.css?v=67"),
    ("admin.css?v=9", "admin.css?v=67"),
    ("admin.css?v=4", "admin.css?v=67"),
    ("account.css?v=7", "account.css?v=8"),
    ("book-staff.css?v=8", "book-staff.css?v=9"),
)
FACE_RE = re.compile(r"@font-face\s*\{[^{}]*\}", re.S)
PRELOAD_RE = re.compile(
    r'(<link\b[^>]*\brel="preload"[^>]*\bhref=")UKIJCJK\.woff2("[^>]*\bas="font"[^>]*>)'
    r'|(<link\b[^>]*\bas="font"[^>]*\bhref=")UKIJCJK\.woff2("[^>]*\brel="preload"[^>]*>)'
)


def codepoints(path):
    font = TTFont(path)
    mapping = font.getBestCmap() or {}
    return font, set(mapping)


def css_ranges(values):
    ordered = sorted(values)
    if not ordered:
        raise SystemExit("unicode range is empty")
    ranges = []
    start = previous = ordered[0]
    for value in ordered[1:]:
        if value == previous + 1:
            previous = value
            continue
        ranges.append((start, previous))
        start = previous = value
    ranges.append((start, previous))
    parts = []
    for start, end in ranges:
        if start == end:
            parts.append(f"U+{start:04X}")
        else:
            parts.append(f"U+{start:04X}-{end:04X}")
    return ", ".join(parts)


def subset_font(src, dest, unicodes, flavor):
    font = TTFont(src)
    source_metrics = metric_snapshot(font)
    source_modified = font["head"].modified
    options = Options()
    options.layout_features = ["*"]
    options.layout_closure = True
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    options.hinting = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    options.glyph_names = True
    options.legacy_kern = True
    options.ignore_missing_glyphs = False
    options.desubroutinize = False
    options.recalc_bounds = False
    options.recalc_timestamp = False
    options.canonical_order = True
    options.obfuscate_names = False
    tool = Subsetter(options=options)
    tool.populate(unicodes=unicodes)
    tool.subset(font)
    restore_metrics(font, source_metrics)
    font["head"].modified = source_modified
    font.recalcTimestamp = False
    font.flavor = flavor
    dest.parent.mkdir(parents=True, exist_ok=True)
    font.save(dest)


def metric_snapshot(font):
    hhea = font["hhea"]
    os2 = font["OS/2"]
    return {
        "ascent": hhea.ascent,
        "descent": hhea.descent,
        "lineGap": hhea.lineGap,
        "sTypoAscender": os2.sTypoAscender,
        "sTypoDescender": os2.sTypoDescender,
        "sTypoLineGap": os2.sTypoLineGap,
        "usWinAscent": os2.usWinAscent,
        "usWinDescent": os2.usWinDescent,
        "sxHeight": os2.sxHeight,
        "sCapHeight": os2.sCapHeight,
        "usWeightClass": os2.usWeightClass,
        "usWidthClass": os2.usWidthClass,
        "fsSelection": os2.fsSelection,
    }


def restore_metrics(font, snapshot):
    hhea = font["hhea"]
    os2 = font["OS/2"]
    hhea.ascent = snapshot["ascent"]
    hhea.descent = snapshot["descent"]
    hhea.lineGap = snapshot["lineGap"]
    for key, value in snapshot.items():
        if key in ("ascent", "descent", "lineGap"):
            continue
        setattr(os2, key, value)


def primary_body(body):
    def replace_src(match):
        src = match.group(0)
        src = src.replace("UKIJCJK.woff2", "UKIJCJK-primary.woff2")
        src = src.replace("UKIJCJK.ttf", "UKIJCJK-primary.ttf")
        return src

    return re.sub(r"src\s*:[^;]*;", replace_src, body, count=1)


def with_range(block, body, unicode_range):
    open_match = re.match(r"@font-face\s*\{", block)
    prefix = open_match.group(0)
    text = body
    if not text.rstrip().endswith(";"):
        text = text.rstrip() + ";"
    if "\n" in text:
        indent_match = re.search(r"\n([ \t]+)src\s*:", block)
        indent = indent_match.group(1) if indent_match else "    "
        declaration = f"\n{indent}unicode-range: {unicode_range};"
    else:
        declaration = f"unicode-range:{unicode_range};"
    return prefix + text + declaration + "}"


def patch_faces(text, primary_range, complementary_range):
    changed = 0

    def replace(match):
        nonlocal changed
        block = match.group(0)
        if "UKIJCJK.woff2" not in block or "UKIJCJK-primary.woff2" in block:
            return block
        if "unicode-range" in block:
            raise SystemExit("a UKIJ face already has unicode-range and is not the generated pair")
        body_match = re.search(r"\{(.*)\}", block, re.S)
        body = body_match.group(1)
        changed += 1
        primary = with_range(block, primary_body(body), primary_range)
        complementary = with_range(block, body, complementary_range)
        return primary + ("\n" if block.startswith("@font-face\n") or "\n" in block[:12] else "") + complementary

    updated = FACE_RE.sub(replace, text)
    return updated, changed


def patch_preload(text):
    count = 0

    def replacer(match):
        nonlocal count
        count += 1
        groups = [part for part in match.groups() if part is not None]
        return groups[0] + "UKIJCJK-primary.woff2" + groups[1]

    return PRELOAD_RE.sub(replacer, text), count


def should_skip(path):
    text = str(path)
    return any(part in text for part in SKIP_PARTS)


def patch_tree(primary_range, complementary_range):
    face_files = 0
    faces = 0
    preloads = 0
    for path in ROOT.rglob("*"):
        if not path.is_file() or should_skip(path):
            continue
        if path.suffix.lower() not in {".css", ".html", ".js"}:
            continue
        if path.name.startswith("UKIJCJK"):
            continue
        original = path.read_text(encoding="utf-8")
        updated, face_count = patch_faces(original, primary_range, complementary_range)
        updated, preload_count = patch_preload(updated)
        if path.suffix.lower() in {".html", ".js"}:
            for old, new in PIN_REPLACEMENTS:
                updated = re.sub(re.escape(old) + r"(?!\d)", new, updated)
        if updated != original:
            path.write_text(updated, encoding="utf-8", newline="\n")
            if face_count:
                face_files += 1
                faces += face_count
            preloads += preload_count
    return face_files, faces, preloads


def sha256(path):
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main():
    before = {kind: sha256(path) for kind, path in SOURCE.items()}
    fonts = {}
    sets = {}
    for kind, path in SOURCE.items():
        fonts[kind], sets[kind] = codepoints(path)
    if sets["woff2"] != sets["ttf"]:
        raise SystemExit("woff2 and ttf cmaps differ; the shared range would have a gap")
    repertoire = sets["woff2"]
    deferred = {value for value in repertoire if script(value) in DEFERRED}
    primary = repertoire - deferred
    if not primary or not deferred:
        raise SystemExit("primary or complementary coverage is empty")
    primary_range = css_ranges(primary)
    complementary_range = css_ranges(deferred)
    RANGE_DIR.mkdir(parents=True, exist_ok=True)
    (RANGE_DIR / "primary.txt").write_text(primary_range + "\n", encoding="utf-8", newline="\n")
    (RANGE_DIR / "complementary.txt").write_text(complementary_range + "\n", encoding="utf-8", newline="\n")
    subset_font(SOURCE["woff2"], DERIVATIVE["woff2"], primary, "woff2")
    subset_font(SOURCE["ttf"], DERIVATIVE["ttf"], primary, None)
    after = {kind: sha256(path) for kind, path in SOURCE.items()}
    if after != before:
        raise SystemExit("original font bytes changed")
    fonts_only = "--fonts-only" in sys.argv
    face_files = faces = preloads = 0
    if not fonts_only:
        face_files, faces, preloads = patch_tree(primary_range, complementary_range)
    print(f"repertoire {len(repertoire)}")
    print(f"primary {len(primary)}")
    print(f"complementary {len(deferred)}")
    print(f"primary_woff2 {DERIVATIVE['woff2'].stat().st_size}")
    print(f"primary_ttf {DERIVATIVE['ttf'].stat().st_size}")
    print(f"faces {faces} files {face_files} preloads {preloads}")
    print(f"primary_range_chars {len(primary_range)}")
    print(f"complementary_range_chars {len(complementary_range)}")


if __name__ == "__main__":
    main()
