import pytest

from app.metrics import formulas as F
from app.metrics.circulation import c_score, components, source_sink_sets
from app.sim.model import apply_plan


def test_progressive_flag():
    assert F.is_progressive(10, 30)             # gain 20 >= 15
    assert F.is_progressive(70, 84)             # end >= 80 and gain 14 >= 5
    assert F.is_progressive(78, 83)             # end >= 80 and gain 5
    assert not F.is_progressive(70, 78)         # gain 8, end < 80
    assert not F.is_progressive(10, 24.9)
    assert not F.is_progressive(10, 50, completed=False)


def test_zone_ids_and_windows():
    assert F.zone_id(0, 0) == "c0r0"
    assert F.zone_id(119.9, 79.9) == "c5r3"
    assert F.zone_id(120, 80) == "c5r3"          # clamped
    assert F.zone_index(45, 25) == 2 * 4 + 1
    assert F.zone_id_from_index(9) == "c2r1"
    assert F.mirror_zone_index(0) == 23
    assert F.mirror_zone_index(9) == 3 * 4 + 2   # (c2,r1) -> (c3,r2)
    assert [F.window_id(m) for m in (0, 14, 15, 44, 45, 74, 75, 89, 90, 120)] == \
        ["0-15", "0-15", "15-30", "30-45", "45-60", "60-75", "75-90+", "75-90+", "75-90+", "75-90+"]


def test_k_clamping():
    assert F.k_atten(1.0, 1.0, 0.0) == 0.25
    assert F.k_atten(0.0, 0.0, 0.0) == 0.90
    assert F.k_atten(0.5, 0.5, 0.5) == pytest.approx(0.875)
    assert F.K_MIN <= F.k_atten(0.9, 0.9, 0.1) <= F.K_MAX
    assert F.K_LANE == 0.30


def test_histogram_overlap():
    a = [0.0] * 24; b = [0.0] * 24
    a[0] = 5; b[23] = 5           # same physical zone after mirroring
    assert F.overlap_press_recv(a, b) == pytest.approx(1.0)
    b = [0.0] * 24; b[0] = 5      # opposite corner of the pitch
    assert F.overlap_press_recv(a, b) == pytest.approx(0.0)


def test_reroute_conservation(toy):
    el2, det = apply_plan(toy, [{"type": "suppress", "target_player": 3, "k": 0.3}])
    assert det["removed"] == 6                      # 8 -> int(8*0.3)=2
    assert 0 < det["redistributed"] <= det["removed"]
    assert det["redistributed"] == 5                # int(6*4/7)=3 + int(6*3/7)=2 (floored)
    assert el2.cc.sum() <= toy.cc.sum()
    assert el2.est.any() and not toy.est.any()
    # every reroute lands on an observed edge of the same passer, same window
    base_pairs = set(zip(toy.src.tolist(), toy.dst.tolist()))
    for r in det["reroutes"]:
        assert (r["src"], r["dst"]) in base_pairs and r["src"] == 2 and r["dst"] in (6, 7)


def test_delete_removes_in_and_out(toy):
    el2, det = apply_plan(toy, [{"type": "delete", "target_player": 3}])
    mask = (el2.src == 3) | (el2.dst == 3)
    assert el2.cnt[mask].sum() == 0 and el2.cc[mask].sum() == 0


def test_cut_lane(toy):
    el2, det = apply_plan(toy, [{"type": "cut_lane", "edge": {"src": 3, "dst": 4}, "k": F.K_LANE}])
    i = [k for k in range(len(toy.src)) if toy.src[k] == 3 and toy.dst[k] == 4][0]
    assert el2.cnt[i] == int(6 * 0.3) and el2.cc[i] == int(5 * 0.3)


def test_source_sink_sets(toy):
    S, T = source_sink_sets(toy.positions)
    assert S == [1, 2] and T == [4, 5]


def test_c_baseline_is_100(toy):
    base = components(toy)
    assert base.M > 0 and base.D > 0 and base.V > 0
    assert c_score(base, base) == pytest.approx(100.0)
    el2, _ = apply_plan(toy, [{"type": "suppress", "target_player": 3, "k": 0.3}])
    assert c_score(components(el2), base) < 100.0
