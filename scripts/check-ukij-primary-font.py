"""Prove the primary UKIJ subset and the original files cover one repertoire.

The check reads the generated fonts and the declarations. It does not write
font files. Shaping uses HarfBuzz through uharfbuzz and compares glyph names,
clusters, advances, and offsets. Glyph ids are not compared: subsetting
renumbers glyphs, and the WOFF2 and TTF sources already use different names.
"""
from pathlib import Path
import hashlib
import re
import sys
import tempfile

from fontTools.ttLib import TTFont
from fontTools.unicodedata import script
import uharfbuzz as hb

ROOT = Path(__file__).resolve().parents[1]
DEFERRED = {"Hani", "Hang", "Kana", "Hira", "Bopo"}
RANGE_RE = re.compile(r"U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?")
FACE_RE = re.compile(r"@font-face\s*\{[^{}]*font-family:\s*\"UKIJ CJK\"[^{}]*\}", re.S)


def sha256(path):
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def cmap(path):
    font = TTFont(path)
    return font, set((font.getBestCmap() or {}))


def parse_ranges(text):
    values = set()
    for start, end in RANGE_RE.findall(text):
        first = int(start, 16)
        last = int(end, 16) if end else first
        if last < first or last - first > 200000:
            raise SystemExit(f"invalid unicode range U+{start}-{end}")
        values.update(range(first, last + 1))
    return values


def face_ranges(text):
    faces = []
    for block in FACE_RE.findall(text):
        if "unicode-range" not in block:
            raise SystemExit("UKIJ face is missing unicode-range")
        kind = "primary" if "UKIJCJK-primary.woff2" in block else "original"
        if kind == "original" and "UKIJCJK.woff2" not in block:
            raise SystemExit("complementary face lost the original font URL")
        match = re.search(r"unicode-range\s*:\s*([^;}]+)", block)
        faces.append((kind, parse_ranges(match.group(1))))
    return faces


def features(font, table):
    if table not in font:
        return []
    records = font[table].table.FeatureList.FeatureRecord
    return [record.FeatureTag for record in records]


def names(font):
    rows = []
    for record in font["name"].names:
        try:
            text = record.toUnicode()
        except Exception:
            text = ""
        rows.append((record.nameID, record.platformID, record.platEncID, record.langID, text))
    return sorted(rows)


def glyph_signature(tt, glyph_id, seen=None):
    name = tt.getGlyphName(glyph_id)
    if seen is None:
        seen = set()
    if name in seen:
        return ("cycle",)
    seen.add(name)
    glyph = tt["glyf"][name]
    program = b""
    if getattr(glyph, "program", None) is not None:
        program = bytes(glyph.program.getBytecode())
    if glyph.numberOfContours > 0:
        coordinates = tuple((int(point[0]), int(point[1])) for point in glyph.coordinates)
        return ("simple", coordinates, tuple(glyph.flags), tuple(glyph.endPtsOfContours), program)
    if glyph.isComposite():
        components = []
        for component in glyph.components:
            component_id = tt.getGlyphID(component.glyphName)
            components.append((
                glyph_signature(tt, component_id, seen),
                component.x,
                component.y,
                component.flags,
            ))
        return ("composite", tuple(components), program)
    return ("empty", program)


def shape_font(font, text):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    rows = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        rows.append((
            info.codepoint,
            font.get_glyph_name(info.codepoint),
            info.cluster,
            pos.x_advance,
            pos.y_advance,
            pos.x_offset,
            pos.y_offset,
        ))
    return rows


def shape_rows(hb_font, tt, text, compare_names):
    rows = []
    for glyph_id, name, cluster, x_advance, y_advance, x_offset, y_offset in shape_font(hb_font, text):
        row = [
            glyph_signature(tt, glyph_id),
            cluster,
            x_advance,
            y_advance,
            x_offset,
            y_offset,
        ]
        if compare_names:
            row.insert(1, name)
        rows.append(tuple(row))
    return rows


def load_face(path):
    temporary = None
    source = path
    tt = TTFont(path)
    if path.suffix.lower() == ".woff2":
        tt.flavor = None
        temporary = tempfile.NamedTemporaryFile(suffix=".ttf", delete=False)
        temporary.close()
        source = Path(temporary.name)
        tt.save(source)
        tt = TTFont(source)
    blob = hb.Blob.from_file_path(str(source))
    face = hb.Font(hb.Face(blob))
    return face, tt, temporary.name if temporary else None


def compare_shape(label, left_path, right_path, samples, compare_names=True):
    left_font, left_tt, left_temp = load_face(left_path)
    right_font, right_tt, right_temp = load_face(right_path)
    mismatches = []
    try:
        for text in samples:
            left = shape_rows(left_font, left_tt, text, compare_names)
            right = shape_rows(right_font, right_tt, text, compare_names)
            if left != right:
                mismatches.append((text, left, right))
    finally:
        for temporary in (left_temp, right_temp):
            if temporary:
                Path(temporary).unlink(missing_ok=True)
    print(f"shape {label} samples {len(samples)} mismatches {len(mismatches)}")
    for text, left, right in mismatches[:5]:
        print(f" mismatch {text!r}")
        print(f"  left {left}")
        print(f"  right {right}")
    return mismatches


def samples(repertoire):
    explicit = [
        "ئ ا ە ب پ ت ج چ خ د ر ز ژ س ش غ ف ق ك گ ڭ ل م ن ھ و ۇ ۆ ۈ ۋ ې ى ي",
        "كىتابخانىسى",
        "قۇتادغۇبىلىك",
        "ئۇيغۇرچە",
        "ئ",
        "ء",
        "أ",
        "إ",
        "ؤ",
        "ئې",
        "ب\u200dا",
        "ب\u200cا",
        "كىتاب\u200cخانىسى",
        "،؛؟!",
        "123 370.50",
        "كىتاب 2026 Book",
        "العربية",
        "İstanbul Şehir ğüşıöç",
        "Kutadgu Bilig",
        "Қазақ",
    ]
    marks = ["ب" + mark for mark in "\u064b\u064e\u064f\u0650\u0651\u0652"]
    presentation = []
    for value in sorted(repertoire):
        if 0xFB50 <= value <= 0xFDFF or 0xFE70 <= value <= 0xFEFF:
            presentation.append(chr(value))
        if len(presentation) == 12:
            break
    return [text for text in explicit + marks + presentation if all(ord(char) in repertoire or char in " \u200c\u200d" for char in text)]


def main():
    original_woff, original_set = cmap(ROOT / "UKIJCJK.woff2")
    original_ttf, ttf_set = cmap(ROOT / "UKIJCJK.ttf")
    primary_woff, primary_woff_set = cmap(ROOT / "UKIJCJK-primary.woff2")
    primary_ttf, primary_ttf_set = cmap(ROOT / "UKIJCJK-primary.ttf")
    if original_set != ttf_set:
        raise SystemExit("original WOFF2 and TTF cmaps differ")
    deferred = {value for value in original_set if script(value) in DEFERRED}
    expected = original_set - deferred
    failures = 0
    if primary_woff_set != expected or primary_ttf_set != expected:
        failures += 1
        print("cmap mismatch", len(primary_woff_set), len(primary_ttf_set), len(expected))
    overlap = primary_woff_set & deferred
    if overlap:
        failures += 1
        print("primary contains deferred codepoints", len(overlap))
    declarations = [
        ROOT / "theme.css",
        ROOT / "index.css",
        ROOT / "account.css",
        ROOT / "admin.css",
        ROOT / "book-staff.css",
        ROOT / "index.html",
        ROOT / "books.html",
        ROOT / "sheirlar.html",
        ROOT / "uyghur-adabiyati.html",
        ROOT / "admin.html",
        ROOT / "account.html",
        ROOT / "book-staff.html",
    ]
    reference = None
    for path in declarations:
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".html" and "@font-face" not in text and "UKIJCJK-primary.woff2" not in text:
            if path.name == "index.html" and 'href="UKIJCJK-primary.woff2"' not in text:
                failures += 1
                print("preload missing", path.name)
            continue
        faces = face_ranges(text) if "@font-face" in text else []
        if path.suffix == ".css" or (path.suffix == ".html" and "@font-face" in text):
            kinds = [kind for kind, _values in faces]
            if kinds != ["primary", "original"]:
                failures += 1
                print("face order", path.name, kinds)
            covered = set()
            for kind, values in faces:
                if reference is None:
                    reference = {}
                if kind not in reference:
                    reference[kind] = values
                elif reference[kind] != values:
                    failures += 1
                    print("range drift", path.name, kind)
                covered |= values
            if covered & original_set != original_set or (reference["primary"] & reference["original"]):
                failures += 1
                print("coverage gap or overlap", path.name)
    if reference["primary"] & original_set != expected or reference["original"] & original_set != deferred:
        failures += 1
        print("css range does not match cmap partition")
    outside = (reference["primary"] | reference["original"]) - original_set
    if outside:
        failures += 1
        print("css range includes codepoints absent from the font", len(outside))
    for table in ("GSUB", "GPOS"):
        if features(original_woff, table) != features(primary_woff, table):
            failures += 1
            print("woff feature drift", table, features(original_woff, table), features(primary_woff, table))
        if features(original_ttf, table) != features(primary_ttf, table):
            failures += 1
            print("ttf feature drift", table, features(original_ttf, table), features(primary_ttf, table))
    if "GDEF" not in primary_woff or "GDEF" not in primary_ttf:
        failures += 1
        print("GDEF missing")
    if names(original_woff) != names(primary_woff) or names(original_ttf) != names(primary_ttf):
        failures += 1
        print("name metadata drift")
    for label, source, derivative in (
        ("woff2", original_woff, primary_woff),
        ("ttf", original_ttf, primary_ttf),
    ):
        for key in ("ascent", "descent", "lineGap"):
            if getattr(source["hhea"], key) != getattr(derivative["hhea"], key):
                failures += 1
                print("hhea drift", label, key)
    hint_tables = [name for name in ("fpgm", "prep", "cvt ") if name in original_ttf]
    kept_hints = [name for name in hint_tables if name in primary_ttf]
    print(f"ttf hint tables source {hint_tables} kept {kept_hints}")
    if hint_tables and not kept_hints:
        failures += 1
        print("ttf hints were dropped")
    text_samples = samples(expected)
    mismatches = compare_shape("woff2", ROOT / "UKIJCJK.woff2", ROOT / "UKIJCJK-primary.woff2", text_samples)
    mismatches += compare_shape("ttf", ROOT / "UKIJCJK.ttf", ROOT / "UKIJCJK-primary.ttf", text_samples)
    cross = compare_shape(
        "original-woff2-vs-ttf",
        ROOT / "UKIJCJK.woff2",
        ROOT / "UKIJCJK.ttf",
        text_samples,
        compare_names=False,
    )
    cjk = ["中文", "日本語", "한글", "ㄅㄆㄇ"]
    for text in cjk:
        if any(ord(char) in expected for char in text):
            failures += 1
            print("cjk sample leaked into primary", text)
    print(f"primary_woff2_bytes { (ROOT / 'UKIJCJK-primary.woff2').stat().st_size }")
    print(f"primary_ttf_bytes {(ROOT / 'UKIJCJK-primary.ttf').stat().st_size}")
    print(f"original_woff2_sha256 {sha256(ROOT / 'UKIJCJK.woff2')}")
    print(f"original_ttf_sha256 {sha256(ROOT / 'UKIJCJK.ttf')}")
    print(f"cross_format_mismatches {len(cross)}")
    if mismatches:
        failures += 1
    if failures:
        print(f"ukij font check: FAIL {failures}")
        return 1
    print("ukij font check: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
