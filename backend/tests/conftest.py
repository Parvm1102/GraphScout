import numpy as np
import pytest

from app.sim.model import EdgeList


@pytest.fixture
def toy() -> EdgeList:
    """7 players, one window. Player 3 (CDM, col 2) is the suppression target; 6 is a same-column
    alternative for passer 2; 7 is a same-column alternative with a different count (floor test)."""
    positions = {1: "Goalkeeper", 2: "Right Center Back", 3: "Center Defensive Midfield",
                 4: "Right Wing", 5: "Center Forward", 6: "Left Defensive Midfield", 7: "Left Center Midfield"}
    avg_x = {1: 10, 2: 30, 3: 55, 4: 85, 5: 95, 6: 50, 7: 58}
    rows = [(1, 2, "0-15", 10, 10, 0), (2, 3, "0-15", 8, 8, 2), (2, 4, "0-15", 4, 3, 2),
            (3, 4, "0-15", 6, 5, 3), (3, 5, "0-15", 5, 4, 3), (4, 5, "0-15", 3, 3, 1),
            (2, 5, "0-15", 2, 2, 1), (2, 6, "0-15", 4, 4, 1), (2, 7, "0-15", 3, 3, 1),
            (6, 5, "0-15", 2, 2, 1), (7, 4, "0-15", 2, 2, 1)]
    players = [{"id": i, "team": "T", "position": positions[i], "avg_x": avg_x[i], "name": f"p{i}"} for i in positions]
    return EdgeList.from_rows(1, "T", ["0-15"], rows, players)
