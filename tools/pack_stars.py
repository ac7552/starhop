# Packs the HYG star catalog (v4.1, CC BY-SA 4.0, https://github.com/astronexus/HYG-Database) into
# data/stars.bin and data/stars.json. Keeps every star brighter than magnitude 7 as seen from the Sun, plus
# every star within 25 parsecs. Positions are turned from the equatorial frame HYG uses into the J2000
# ecliptic frame the planets use.
# Run:  python3 tools/pack_stars.py path/to/hygdata_v41.csv
import csv, json, math, struct, sys

EPS = math.radians(23.4392911)  # obliquity of the ecliptic at J2000
src = sys.argv[1]
rows = []
with open(src, newline="") as f:
    for r in csv.DictReader(f):
        if r["id"] == "0":
            continue  # the Sun is modelled separately
        try:
            dist, mag, absmag = float(r["dist"]), float(r["mag"]), float(r["absmag"])
        except ValueError:
            continue
        if not (0 < dist < 100000):
            continue
        if mag > 7.0 and dist > 25:
            continue
        ci = float(r["ci"]) if r["ci"] not in ("", None) else 0.65
        x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
        ye = y * math.cos(EPS) + z * math.sin(EPS)
        ze = -y * math.sin(EPS) + z * math.cos(EPS)
        rows.append((x, ye, ze, absmag, ci, mag, dist, r["proper"].strip(), r["spect"].strip(), r["hip"], r["gl"].strip(), r["bf"].strip()))

rows.sort(key=lambda t: t[5])  # brightest first
with open("data/stars.bin", "wb") as f:
    for t in rows:
        f.write(struct.pack("<5f", *t[:5]))
named = [{"i": i, "name": t[7], "dist": round(t[6], 4), "mag": t[5], "spect": t[8]} for i, t in enumerate(rows) if t[7]]
meta = {
    "count": len(rows),
    "fields": ["x_pc", "y_pc", "z_pc", "absmag", "bv"],
    "frame": "J2000 ecliptic, parsecs, origin at the Sun",
    "source": "HYG database v4.1 (astronexus), CC BY-SA 4.0",
    "named": named,
    "check": [{"i": i, "mag": t[5], "dist": t[6]} for i, t in enumerate(rows) if i % 97 == 0],
}
with open("data/stars.json", "w") as f:
    json.dump(meta, f, separators=(",", ":"))
print(len(rows), "stars,", len(named), "named")
