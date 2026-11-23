from __future__ import annotations

from datetime import date
from decimal import Decimal
from textwrap import dedent
from typing import TYPE_CHECKING

from fava.core import FavaLedger
from fava.core.charts import BalanceCheckPoint
from fava.core.conversion import AT_COST
from fava.util.date import Day
from fava.util.date import Month

if TYPE_CHECKING:  # pragma: no cover
    from pathlib import Path

    from .conftest import GetFavaLedger
    from .conftest import SnapshotFunc


def test_interval_totals(
    small_example_ledger: FavaLedger,
    snapshot: SnapshotFunc,
) -> None:
    filtered = small_example_ledger.get_filtered()
    for conversion in ["at_cost", "USD"]:
        data = small_example_ledger.charts.interval_totals(
            filtered,
            Month,
            "Expenses",
            conversion,
        )
        snapshot(data, json=True)


def test_interval_totals_inverted(
    small_example_ledger: FavaLedger,
    snapshot: SnapshotFunc,
) -> None:
    filtered = small_example_ledger.get_filtered()
    for conversion in ["at_cost", "USD"]:
        data = small_example_ledger.charts.interval_totals(
            filtered,
            Month,
            "Expenses",
            conversion,
            invert=True,
        )
        snapshot(data, json=True)


def test_linechart_data(
    example_ledger: FavaLedger,
    snapshot: SnapshotFunc,
) -> None:
    filtered = example_ledger.get_filtered()
    for conversion in ["at_cost", "units", "at_value", "USD"]:
        data = example_ledger.charts.linechart(
            filtered,
            "Assets:Testing:MultipleCommodities",
            conversion,
        )
        snapshot(data, json=True)

    assert not example_ledger.charts.linechart(
        filtered,
        "Assets:Testing:MultipleCommodities:NotAnAccount",
        "units",
    )


def test_net_worth(example_ledger: FavaLedger, snapshot: SnapshotFunc) -> None:
    filtered = example_ledger.get_filtered()
    data = example_ledger.charts.net_worth(filtered, Month, "USD")
    snapshot(data, json=True)


def test_net_worth_off_by_one(
    snapshot: SnapshotFunc,
    get_ledger: GetFavaLedger,
) -> None:
    off_by_one = get_ledger("off-by-one")
    off_by_one_filtered = off_by_one.get_filtered()
    assert not off_by_one.errors
    assert len(off_by_one_filtered.entries) == 9

    for interval in [Day, Month]:
        data = off_by_one.charts.net_worth(
            off_by_one_filtered,
            interval,
            "at_value",
        )
        assert len(data) == 4 if interval == Day else 1
        snapshot(data, json=True)


def test_hierarchy(example_ledger: FavaLedger) -> None:
    filtered = example_ledger.get_filtered()

    data = example_ledger.charts.hierarchy(filtered, "Assets", AT_COST)
    assert data.balance_children == {
        "IRAUSD": Decimal("7200.00"),
        "USD": Decimal("94320.27840"),
        "VACHR": Decimal(-82),
    }
    assert data.balance == {}
    etrade = data.children[1].children[2]
    assert etrade.account == "Assets:US:ETrade"
    assert etrade.balance_children == {"USD": Decimal("23137.54")}


def test_interval_totals_sibling_with_shared_prefix(
    small_example_ledger: FavaLedger,
) -> None:
    """Accounts that merely share a name prefix are not children."""
    filtered = small_example_ledger.get_filtered()

    for interval in small_example_ledger.charts.interval_totals(
        filtered, Month, "Expenses:Other", "EUR"
    ):
        assert not interval.balance
        assert not interval.account_balances

    for interval in small_example_ledger.charts.interval_totals(
        filtered, Month, "Expenses:Others", "EUR"
    ):
        assert set(interval.account_balances) == {"Expenses:Others"}


def test_balance_checks(tmp_path: Path) -> None:
    path = tmp_path / "balances.beancount"
    path.write_text(
        dedent("""
        2020-01-01 open Assets:Cash
        2020-01-01 open Assets:Cash:Wallet
        2020-01-01 open Assets:CashOther
        2020-01-01 open Equity:Opening

        2020-01-02 * "Opening"
          Assets:Cash          10 USD
          Assets:Cash:Wallet    5 USD
          Assets:CashOther      1 USD
          Equity:Opening

        2020-01-03 balance Assets:Cash         15 USD
        2020-01-03 balance Assets:Cash:Wallet   5 USD
        2020-01-03 balance Assets:CashOther     1 USD
        2020-01-04 balance Assets:Cash         20 USD
        """),
        encoding="utf-8",
    )
    ledger = FavaLedger(str(path))
    filtered = ledger.get_filtered()

    checks = ledger.charts.balance_checks

    passed_cash = BalanceCheckPoint(
        date(2020, 1, 3), "Assets:Cash", "USD", Decimal(15), None
    )
    passed_wallet = BalanceCheckPoint(
        date(2020, 1, 3), "Assets:Cash:Wallet", "USD", Decimal(5), None
    )
    passed_other = BalanceCheckPoint(
        date(2020, 1, 3), "Assets:CashOther", "USD", Decimal(1), None
    )
    failed_cash = BalanceCheckPoint(
        date(2020, 1, 4), "Assets:Cash", "USD", Decimal(20), Decimal(-5)
    )
    # Checks of subaccounts are included, but not of other accounts that
    # just share the prefix.
    assert checks(filtered, "Assets:Cash") == [
        passed_cash,
        passed_wallet,
        failed_cash,
    ]
    assert checks(filtered, "Assets:Cash:Wallet") == [passed_wallet]
    assert checks(filtered, "Assets") == [
        passed_cash,
        passed_wallet,
        passed_other,
        failed_cash,
    ]
    assert checks(filtered, "Expenses") == []
