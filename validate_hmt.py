import json, urllib.request, time, sys
TOKEN = "MLY|27847157814868912|297a1717444edeb373bb94009d2df54a"
def coverage(lat, lng, offsets=(0.004, 0.008, 0.012)):
    for off in offsets:
        bbox = f"{lng-off},{lat-off},{lng+off},{lat+off}"
        url = f"https://graph.mapillary.com/images?access_token={TOKEN}&fields=id,geometry,is_pano&bbox={bbox}&limit=1"
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                data = json.load(r)
            if data.get("data"):
                return True, off
        except Exception as e:
            continue
    return False, None
candidates = [
    ("中国香港·维多利亚港", 22.2940, 114.1720, 1),
    ("中国澳门·大三巴", 22.1970, 113.5430, 2),
    ("中国台北·台北101", 25.0339, 121.5646, 1),
    ("中国香港·中环", 22.2819, 114.1583, 2),
    ("中国香港·旺角", 22.3193, 114.1694, 2),
    ("中国香港·尖沙咀", 22.2988, 114.1722, 2),
    ("中国香港·铜锣湾", 22.2800, 114.1830, 2),
    ("中国香港·太平山顶", 22.2711, 114.1503, 3),
    ("中国香港·金紫荆广场", 22.2841, 114.1734, 2),
    ("中国香港·庙街夜市", 22.3098, 114.1697, 3),
    ("中国澳门·议事亭前地", 22.1933, 113.5396, 2),
    ("中国澳门·妈阁庙", 22.1861, 113.5311, 3),
    ("中国澳门·官也街", 22.1526, 113.5572, 3),
    ("中国澳门·东望洋灯塔", 22.1986, 113.5514, 3),
    ("中国台北·西门町", 25.0420, 121.5075, 2),
    ("中国台北·士林夜市", 25.0879, 121.5243, 2),
    ("中国高雄·六合夜市", 22.6319, 120.2994, 2),
    ("中国台中·逢甲夜市", 24.1786, 120.6449, 2),
    ("中国垦丁·垦丁大街", 21.9482, 120.7800, 4),
    ("中国日月潭", 23.8571, 120.9159, 4),
    ("中国九份·老街", 25.1097, 121.8450, 4),
]
print("total candidates:", len(candidates), flush=True)
ok = 0
for name, lat, lng, diff in candidates:
    good, off = coverage(lat, lng)
    print(("PASS" if good else "FAIL"), "@", off, name, flush=True)
    if good: ok += 1
    time.sleep(0.2)
print("SUMMARY PASS:", ok, "FAIL:", len(candidates)-ok, flush=True)
