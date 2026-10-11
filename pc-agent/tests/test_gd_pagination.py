"""Pagination regressions runnable without Windows/Excel dependencies."""
import ast
import logging
from pathlib import Path
from types import SimpleNamespace
import unittest

source = Path(__file__).parents[1] / "tool" / "gd_print.py"
tree = ast.parse(source.read_text(encoding="utf-8"))
names = {"GdError", "_page_count", "_single_print_area", "_force_one_page",
         "_content_range", "_fit_zoom", "_pdf_pages", "_pages_now"}
selected = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))
            and n.name in names]
import re
ns = {"Any": object, "log": logging.getLogger("test"), "re": re, "Path": Path,
      "A4_PT": (595.28, 841.89), "MIN_MARGIN_PT": 18.0}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), "exec"), ns)


class Sheet:
    def __init__(self):
        self.PageSetup = SimpleNamespace(Zoom=False, Pages=SimpleNamespace(Count=2))
        self.activated = False

    def Activate(self):
        self.activated = True

    def ResetAllPageBreaks(self):
        pass


class PaginationTests(unittest.TestCase):
    def test_fit_one_page_stays_fit(self):
        ws = Sheet()
        excel = SimpleNamespace(ExecuteExcel4Macro=lambda _: 1)
        ns["_force_one_page"](excel, ws, 3)
        self.assertIs(ws.PageSetup.Zoom, False)
        self.assertTrue(ws.activated)

    def test_portrait_stale_pages_count_recalculates(self):
        ws = Sheet()
        ws.PageSetup.Pages.Count = 1  # Cached value must not bypass verification.
        excel = SimpleNamespace(ExecuteExcel4Macro=lambda _: (
            1 if ws.PageSetup.Zoom is not False and ws.PageSetup.Zoom <= 65 else 2))
        ns["_force_one_page"](excel, ws, 3)
        self.assertLessEqual(ws.PageSetup.Zoom, 65)
        self.assertGreater(ws.PageSetup.Zoom, 60)

    def test_macro_unavailable_uses_pages(self):
        ws = Sheet()
        ws.PageSetup.Pages.Count = 1
        ns["_force_one_page"](SimpleNamespace(), ws, 5)
        self.assertIs(ws.PageSetup.Zoom, False)

    def test_no_page_count_blocks_printing(self):
        ws = Sheet()
        ws.PageSetup.Pages = None
        with self.assertRaises(ns["GdError"]):
            ns["_force_one_page"](SimpleNamespace(), ws, 3)

    def test_two_pages_at_minimum_zoom_blocks_printing(self):
        with self.assertRaises(ns["GdError"]):
            ns["_force_one_page"](
                SimpleNamespace(ExecuteExcel4Macro=lambda _: 2), Sheet(), 3)

    def test_sheet5_landscape_uses_measured_zoom_and_pdf_check(self):
        rng = SimpleNamespace(Width=900.0, Height=600.0, Address="$A$1:$K$30")
        setup = SimpleNamespace(Zoom=False, PrintArea="$A$1:$K$30", LeftMargin=7.2,
                                RightMargin=7.2, TopMargin=21.6, BottomMargin=21.6)
        zooms = []
        def export(_t, fn, *a):
            zooms.append(setup.Zoom)
            pages = 1 if setup.Zoom <= 80 else 2
            Path(fn).write_bytes(b"/Type /Pages /Count 2 " + b"/Type /Page " * pages)
        ws = SimpleNamespace(PageSetup=setup, Range=lambda a: rng,
                             ExportAsFixedFormat=export, Activate=lambda: None,
                             ResetAllPageBreaks=lambda: None)
        ns["_force_one_page"](SimpleNamespace(ExecuteExcel4Macro=lambda _: 1), ws, 5, "landscape")
        self.assertEqual(setup.LeftMargin, 18.0)
        self.assertLessEqual(setup.Zoom, 80)
        self.assertGreater(zooms[0], 80)  # PDF said 2 pages -> stepped down

    def test_disjoint_areas_join_without_losing_bounds(self):
        parts = [SimpleNamespace(Row=1, Column=1, Rows=SimpleNamespace(Count=20),
                                 Columns=SimpleNamespace(Count=8)),
                 SimpleNamespace(Row=21, Column=2, Rows=SimpleNamespace(Count=10),
                                 Columns=SimpleNamespace(Count=7))]
        areas = SimpleNamespace(Count=2, Item=lambda i: parts[i - 1])
        bounds = []
        def range_of(*args):
            if len(args) == 1:
                return SimpleNamespace(Areas=areas)
            bounds.extend(args)
            return SimpleNamespace(Address="$A$1:$H$30")
        ws = SimpleNamespace(PageSetup=SimpleNamespace(PrintArea="$A$1:$H$20,$B$21:$H$30"),
                             Range=range_of, Cells=lambda row, col: (row, col))
        ns["_single_print_area"](ws)
        self.assertEqual(bounds, [(1, 1), (30, 8)])
        self.assertEqual(ws.PageSetup.PrintArea, "$A$1:$H$30")


if __name__ == "__main__":
    unittest.main()