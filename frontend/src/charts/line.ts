import { bisector, sort } from "d3-array";

import type { FormatterContext } from "../format.ts";
import { day } from "../format.ts";
import { _ } from "../i18n.ts";
import type { Validator } from "../lib/validation.ts";
import {
  array,
  date,
  decimal,
  default_value,
  object,
  optional,
  record,
  string,
} from "../lib/validation.ts";
import type { ParsedFavaChart } from "./index.ts";
import type { TooltipContent } from "./tooltip.ts";
import { domHelpers } from "./tooltip.ts";

/**
 * A single data point on a line or area chart.
 */
export interface LineChartDatum {
  readonly name: string;
  readonly date: Date;
  readonly value: number;
}

/**
 * A balance check of the account of a line chart or one of its subaccounts.
 */
export interface BalanceCheck {
  readonly date: Date;
  readonly account: string;
  readonly currency: string;
  /** The expected balance. */
  readonly number: number;
  /** The actual minus the expected balance, if the check failed. */
  readonly difference: number | null;
}

/**
 * A marker for the passed or the failed balance checks at a date in a
 * currency on a line chart.
 *
 * It is placed on the line, at the balance at the start of the day, which is
 * when a balance check applies. If there are both passed and failed checks at
 * a date, there are two markers at the same position; both have all the
 * checks at the date in `checks`, since they overlap.
 */
export interface BalanceCheckMarker {
  readonly date: Date;
  readonly currency: string;
  readonly value: number;
  readonly failed: boolean;
  readonly checks: readonly BalanceCheck[];
}

const bisect_date = bisector((d: LineChartDatum) => d.date);

/**
 * A series of values for a line chart, e.g., for a single currency.
 */
interface LineChartSeries {
  readonly name: string;
  readonly values: readonly LineChartDatum[];
}

/**
 * A line or area chart.
 *
 * This consists of several series of points, e.g., a line for each currency
 * in the balances of an account.
 */
export class LineChart {
  readonly type = "linechart";
  readonly series_names: readonly string[];
  readonly label: string | null;
  private readonly data: readonly LineChartSeries[];
  readonly balance_checks: readonly BalanceCheck[];
  readonly tooltip_text: (
    $ctx: FormatterContext,
    d: LineChartDatum,
  ) => TooltipContent;

  constructor(
    label: string | null,
    data: readonly LineChartSeries[],
    tooltip_text: ($ctx: FormatterContext, d: LineChartDatum) => TooltipContent,
    balance_checks: readonly BalanceCheck[] = [],
  ) {
    this.label = label;
    this.data = sort(data, (d) => -d.values.length);
    this.tooltip_text = tooltip_text;
    this.balance_checks = balance_checks;
    this.series_names = this.data.map((series) => series.name);
  }

  /** Filter the data of this chart, excluding some series. */
  filter(hidden_names: ReadonlySet<string>): LineChartSeries[] {
    return this.data.filter((series) => !hidden_names.has(series.name));
  }

  /**
   * Get the markers for the balance checks in the shown series.
   *
   * Balance checks are in units of their currency, so with a conversion
   * active, only those for currencies that are plotted are shown.
   */
  balance_check_markers(
    hidden_names: ReadonlySet<string>,
  ): BalanceCheckMarker[] {
    const series_values = new Map(
      this.filter(hidden_names).map((series) => [series.name, series.values]),
    );
    // Group the checks by currency and date, and then by result.
    const groups = new Map<string, BalanceCheck[]>();
    for (const check of this.balance_checks) {
      if (series_values.has(check.currency)) {
        const key = `${check.currency} ${check.date.getTime().toString()}`;
        const group = groups.get(key);
        if (group) {
          group.push(check);
        } else {
          groups.set(key, [check]);
        }
      }
    }
    return [...groups.values()].flatMap((checks) => {
      const [{ date, currency }] = checks as [BalanceCheck];
      const values = series_values.get(currency) ?? [];
      // The balance at the start of the day is the last one before the date.
      const index = bisect_date.left(values, date);
      const value = values[index - 1]?.value ?? 0;
      const has_failed = checks.some((check) => check.difference != null);
      const has_passed = checks.some((check) => check.difference == null);
      // Failed first, so that they are drawn below passed ones.
      return [
        ...(has_failed ? [true] : []),
        ...(has_passed ? [false] : []),
      ].map((failed) => ({ date, currency, value, failed, checks }));
    });
  }

  /** Text describing the balance checks of a marker, e.g., for a tooltip. */
  balance_check_text(
    $ctx: FormatterContext,
    marker: BalanceCheckMarker,
  ): string {
    const lines = marker.checks.map((check) => {
      const expected = $ctx.amount(check.number, check.currency);
      if (check.difference == null) {
        return `${_("Balance check passed")}: ${check.account} ${expected}`;
      }
      const actual = $ctx.amount(
        check.number + check.difference,
        check.currency,
      );
      return `${_("Balance check failed")}: ${check.account} ${expected} (${_("actual")}: ${actual})`;
    });
    return [...lines, day(marker.date)].join("\n");
  }

  with_context(): this {
    return this;
  }
}

const balance_check_validator = object({
  date,
  account: string,
  currency: string,
  number: decimal,
  difference: optional(decimal),
});

const balances_validator = object({
  label: string,
  key: optional(string),
  data: array(object({ date, balance: record(decimal) })),
  balance_checks: default_value(array(balance_check_validator), () => []),
});

type ParsedLineChartData = { date: Date; balance: Record<string, number> }[];

export class ParsedLineChart implements ParsedFavaChart {
  readonly label: string | null;
  readonly data: ParsedLineChartData;
  readonly key: string | null;
  readonly balance_checks: readonly BalanceCheck[];

  constructor(
    label: string | null,
    data: ParsedLineChartData,
    key: string | null = null,
    balance_checks: readonly BalanceCheck[] = [],
  ) {
    this.label = label;
    this.data = data;
    this.key = key;
    this.balance_checks = balance_checks;
  }

  static validator: Validator<ParsedLineChart> = (json) =>
    balances_validator(json).map(
      ({ label, data, key, balance_checks }) =>
        new ParsedLineChart(label, data, key, balance_checks),
    );

  with_context(): LineChart {
    const groups = new Map<string, LineChartDatum[]>();
    for (const { date: date_val, balance } of this.data) {
      Object.entries(balance).forEach(([currency, value]) => {
        const group = groups.get(currency);
        const datum = { date: date_val, value, name: currency };
        if (group) {
          group.push(datum);
        } else {
          groups.set(currency, [datum]);
        }
      });
    }
    const data = [...groups.entries()].map(([name, values]) => ({
      name,
      values,
    }));

    return new LineChart(
      this.label,
      data,
      (c, d) => [c.amount(d.value, d.name), domHelpers.em(day(d.date))],
      this.balance_checks,
    );
  }
}
