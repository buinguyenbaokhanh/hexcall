"""Rollover regressions that need both seasons in the same store."""
import json
import unittest
from unittest.mock import Mock

from ingest import collect_ladder_puuids, open_db
from publish import current_patch, current_set, slice_scope
from static_data import live_set


class RolloverTests(unittest.TestCase):
    def test_ranked_build_and_population_use_the_selected_set(self):
        conn = open_db(":memory:")
        self.addCleanup(conn.close)
        raw = json.dumps({"metadata": {"participants": ["old", "new"]}})
        conn.executemany("INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)", [
            ("old", "na1", 100000, "Version 16.16.1", 17, 1100, raw, 101),
            ("new", "na1", 200000, "TFT Unreal Version ?.?.?.?", 18, 1100, raw, 201),
            ("normal", "na1", 210000, "Version 99.1.1", 19, 1090, raw, 211),
        ])
        conn.executemany("INSERT INTO players VALUES (?,?,?,?,?)", [
            ("old", "na1", "CHALLENGER", 200, 101),
            ("new", "na1", "PLATINUM", 12, 201),
        ])
        self.assertEqual(current_set(conn, min_matches=1), 18)
        self.assertIsNone(current_patch(conn, tft_set=18))
        self.assertEqual(current_patch(conn, tft_set=17), "16.16")
        _, tiers, last = slice_scope(conn, {}, None, 18)
        self.assertEqual(tiers, {"PLATINUM": 1})
        self.assertEqual(last, 200)
        filters, _, _ = slice_scope(conn, {"tiers": ["CHALLENGER"]}, None, 18)
        self.assertEqual(filters["puuid_filter"], set())

    def test_fallback_completes_its_budget_without_duplicate_seeds(self):
        client = Mock()
        client.apex_league.return_value = {"entries": []}

        def entries(_, tier, division, page):
            if division != "I" or page != 1:
                return []
            ids = {"EMERALD": ["a"], "PLATINUM": ["a", "b", "c", "d"]}.get(tier, [])
            return [{"puuid": uid} for uid in ids]

        client.league_entries.side_effect = entries
        players = collect_ladder_puuids(client, "sg2", ["challenger"], 3)
        self.assertEqual(players, [("a", "EMERALD", 0), ("b", "PLATINUM", 0),
                                   ("c", "PLATINUM", 0)])

    def test_absent_roster_does_not_fall_back_to_another_set(self):
        raw = {"setData": [{"number": 17, "mutator": "TFTSet17"}]}
        self.assertEqual(live_set(raw, 18), {})
