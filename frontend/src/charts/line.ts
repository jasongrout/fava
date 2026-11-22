import { sort } from "d3-array";

import type { FormatterContext } from "../format.ts";
import { day } from "../format.ts";
import type { Validator } from "../lib/validation.ts";
import {
  array,
  boolean,
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
 * A balance check marker on a line chart.
 */
export interface BalanceCheckMarker {
  readonly date: Date;
  readonly currency: string;
  readonly number: number;
  readonly passed: boolean;
}

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
  readonly balance_checks: readonly BalanceCheckMarker[];
  readonly tooltip_text: (
    $ctx: FormatterContext,
    d: LineChartDatum,
  ) => TooltipContent;

  constructor(
    label: string | null,
    data: readonly LineChartSeries[],
    tooltip_text: ($ctx: FormatterContext, d: LineChartDatum) => TooltipContent,
    balance_checks: readonly BalanceCheckMarker[] = [],
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

  with_context(): this {
    return this;
  }
}

const balance_check_validator = object({
  date,
  currency: string,
  number: decimal,
  passed: boolean,
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
  readonly balance_checks: readonly BalanceCheckMarker[];

  constructor(
    label: string | null,
    data: ParsedLineChartData,
    key: string | null = null,
    balance_checks: readonly BalanceCheckMarker[] = [],
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
