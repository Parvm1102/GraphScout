"""4E.4 leakage guard: the fold-m score table contains no rows from match m, and the prediction played >= 45 min in m."""
import pytest

from app.graph import db
from app.metrics import scores as S

pytestmark = pytest.mark.skipif(
    not any(n.startswith("match_") for n in db.list_graphs()), reason="no ingested match graphs")


def test_fold_never_sees_its_own_match():
    from app.evals.expert import fold
    df = S.all_components()
    for team in ("Spain", "England"):
        for mid in S.team_match_ids(team):
            f = fold(df, team, mid)
            if f.get("skipped"):
                continue
            assert mid not in f["table_used_match_ids"], f"fold {mid} leaked its own match"
            played = df[(df.match_id == mid) & (df.id == f["prediction"]["id"])]
            assert len(played) == 1 and float(played.minutes.iloc[0]) >= 45.0


def test_composite_exclude_match_drops_rows():
    df = S.all_components()
    mid = S.team_match_ids("Spain")[0]
    sub = df[df.match_id != mid]
    a = S.composite(df, exclude_match=mid)
    b = S.composite(sub)
    assert a[["team", "id", "s_p_mean"]].round(9).equals(b[["team", "id", "s_p_mean"]].round(9))
