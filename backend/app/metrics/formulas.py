"""Every fixed definition and constant from BUILD_BRIEF.md Phase 1.3 / Phase 3, in one place.

All numbers shown in the UI trace to events or to one of the formulas below.
"""
from __future__ import annotations

from statistics import median

# --- Progressive pass (Phase 1.3) -------------------------------------------------------------
PROG_MIN_GAIN = 15.0          # completed AND end_x - x >= 15 ...
PROG_FINAL_THIRD_X = 80.0     # ... OR (end_x >= 80 AND end_x - x >= 5)
PROG_FINAL_THIRD_GAIN = 5.0


def is_progressive(x: float, end_x: float, completed: bool = True) -> bool:
    if not completed:
        return False
    gain = end_x - x
    return gain >= PROG_MIN_GAIN or (end_x >= PROG_FINAL_THIRD_X and gain >= PROG_FINAL_THIRD_GAIN)


# --- Zones: 6 columns x 4 rows of 20x20 units on the 120x80 pitch ----------------------------
ZONE_COLS, ZONE_ROWS, ZONE_SIZE = 6, 4, 20.0
N_ZONES = ZONE_COLS * ZONE_ROWS


def zone_col(x: float) -> int:
    return max(0, min(ZONE_COLS - 1, int(x // ZONE_SIZE)))


def zone_row(y: float) -> int:
    return max(0, min(ZONE_ROWS - 1, int(y // ZONE_SIZE)))


def zone_index(x: float, y: float) -> int:
    """0..23, column-major: index = col*4 + row."""
    return zone_col(x) * ZONE_ROWS + zone_row(y)


def zone_id(x: float, y: float) -> str:
    return f"c{zone_col(x)}r{zone_row(y)}"


def zone_id_from_index(i: int) -> str:
    return f"c{i // ZONE_ROWS}r{i % ZONE_ROWS}"


def mirror_zone_index(i: int) -> int:
    """StatsBomb records every event in the acting team's attacking frame (left->right).

    A presser's zone (in his team's frame) and a receiver's zone (in the other team's frame)
    describe the same physical area only after mirroring one of them: (c, r) -> (5-c, 3-r).
    """
    c, r = i // ZONE_ROWS, i % ZONE_ROWS
    return (ZONE_COLS - 1 - c) * ZONE_ROWS + (ZONE_ROWS - 1 - r)


# --- Windows -----------------------------------------------------------------------------------
WINDOWS = ["0-15", "15-30", "30-45", "45-60", "60-75", "75-90+"]


def window_id(minute: int) -> str:
    return WINDOWS[min(int(minute) // 15, len(WINDOWS) - 1)]


# --- Touch definition (used for touches, pressured touches, avg position fallback) -------------
TOUCH_TYPES = frozenset({"Pass", "Ball Receipt*", "Carry", "Dribble", "Shot",
                         "Clearance", "Ball Recovery", "Interception"})

# --- Press resistance (Phase 3) ----------------------------------------------------------------
MIN_PRESSURED_PASSES = 15     # below this a player gets the team median
MIN_PRESSURES_FOR_REGAIN = 10  # below this a presser gets the team median regain rate
REGAIN_WINDOW_S = 5.0         # possession switching to presser's team within 5 s => regain


def press_resist_raw(att_all: int, cmp_all: int, att_up: int, cmp_up: int) -> float | None:
    """comp_rate(under_pressure) - comp_rate(all). None when the pressured sample is too small."""
    if att_up < MIN_PRESSURED_PASSES or att_all == 0:
        return None
    return cmp_up / att_up - cmp_all / att_all


def fill_with_median(values: list[float | None]) -> list[float]:
    known = [v for v in values if v is not None]
    med = median(known) if known else 0.0
    return [med if v is None else v for v in values]


def minmax(values: list[float]) -> list[float]:
    """Min-max to [0,1]; a constant vector maps to 0.5 everywhere."""
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-12:
        return [0.5] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


# --- Composite player score S_p (Phase 3) -------------------------------------------------------
W_S = {"pr": 0.30, "bt": 0.30, "prog": 0.25, "press_resist": 0.15}

# --- Team circulation score C (Phase 3) ---------------------------------------------------------
W_C = {"M": 0.5, "V": 0.3, "D": 0.2}


def circulation(M: float, V: float, D: float, M0: float, V0: float, D0: float) -> float:
    """C = 100 * (0.5*M/M0 + 0.3*V/V0 + 0.2*D/D0); a zero baseline component contributes 0."""
    def ratio(a, a0):
        return (a / a0) if a0 else 0.0
    return 100.0 * (W_C["M"] * ratio(M, M0) + W_C["V"] * ratio(V, V0) + W_C["D"] * ratio(D, D0))


# --- Attenuation coefficient k (Phase 3) ---------------------------------------------------------
K_MIN, K_MAX = 0.25, 0.90
K_LANE = 0.30         # lane cut multiplier (fixed)
K_DEFAULT = 0.30      # used when no matchup-derived k is available (evals, manual suppress)
K_DECIMALS = 4        # both simulation tiers round k identically before use
# DEVIATION (documented): with Euro 2024 data the raw product regain*overlap*(1-press_resist) never
# exceeds ~0.1, so the brief's exact formula clamps EVERY pair to 0.90 and cannot rank matchups.
# "relative" feeds the same formula squad-relative inputs: regain min-maxed within the pressing squad,
# overlap divided by the best overlap in the presser x target pool. "raw" is the brief's literal form.
K_MODE = "relative"   # "relative" | "raw"


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def histogram_intersection(p: list[float], q: list[float]) -> float:
    """Overlap in [0,1] of two histograms after normalising each to sum 1."""
    sp, sq = float(sum(p)), float(sum(q))
    if sp <= 0 or sq <= 0:
        return 0.0
    return sum(min(a / sp, b / sq) for a, b in zip(p, q))


def overlap_press_recv(press_zones: list[float], recv_zones: list[float]) -> float:
    """Presser's zone histogram vs receiver's, with the receiver's frame mirrored (see mirror_zone_index)."""
    mirrored = [0.0] * N_ZONES
    for i, v in enumerate(recv_zones):
        mirrored[mirror_zone_index(i)] = v
    return histogram_intersection(press_zones, mirrored)


def k_atten(regain: float, overlap: float, press_resist: float) -> float:
    """k = clamp(1 - regain(X) * overlap(X,Y) * (1 - press_resist(Y)), 0.25, 0.90), rounded to 4 dp."""
    return round(clamp(1.0 - regain * overlap * (1.0 - press_resist), K_MIN, K_MAX), K_DECIMALS)


# --- Optimizer constants (Phase 4) -------------------------------------------------------------
GA_PENALTY_PER_PLAYER = 1.5
MAX_COMMITMENTS = 4
GA_POP, GA_GENS, GA_ELITE, GA_TOURNAMENT = 30, 20, 2, 3
GA_CROSSOVER_P, GA_MUTATION_P = 0.5, 0.25
N_PRESSERS, N_TARGETS, N_LANES = 6, 4, 3
