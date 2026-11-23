<script lang="ts">
  import ChartSwitcher from "../../charts/ChartSwitcher.svelte";
  import { ParsedHierarchyChart } from "../../charts/hierarchy.ts";
  import { get_date_format } from "../../format.ts";
  import { url_for_account } from "../../helpers.ts";
  import { _ } from "../../i18n.ts";
  import { is_non_empty } from "../../lib/array.ts";
  import { interval_label } from "../../lib/interval.ts";
  import { fiscal_year_end } from "../../stores/fava_options.ts";
  import { interval as current_interval } from "../../stores/url.ts";
  import IntervalTreeTable from "../../tree-table/IntervalTreeTable.svelte";
  import JournalTable from "../journal/JournalTable.svelte";
  import type { AccountReportProps } from "./index.ts";

  let { account, report_type, report }: AccountReportProps = $props();

  let accumulate = $derived(report_type === "balances");
  let interval_label_lower = $derived(
    interval_label($current_interval).toLowerCase(),
  );

  let chart_container: HTMLDivElement | undefined = $state();

  /** Find the journal entry with the date closest to the given date. */
  function closest_journal_entry(
    node: HTMLElement,
    date: Date,
  ): HTMLElement | null {
    const target = new Date(date.toISOString().slice(0, 10)).getTime();
    const date_links = node.querySelectorAll<HTMLAnchorElement>(
      ".journal > li > p > .datecell > a",
    );
    let closest: HTMLElement | null = null;
    let closest_diff = Infinity;
    for (const link of date_links) {
      const diff = Math.abs(new Date(link.textContent).getTime() - target);
      if (diff < closest_diff) {
        closest_diff = diff;
        closest = link.closest("li");
      }
    }
    return closest;
  }

  /** Scroll the journal to the date that was clicked on in a chart. */
  function chart_click_listener(node: HTMLElement) {
    function handler(event: Event) {
      const { date } = (event as CustomEvent<{ date: Date }>).detail;
      const entry = closest_journal_entry(node, date);
      if (!entry) {
        return;
      }
      // Scroll the entry to just below the chart if that sticks to the top.
      const chart_height =
        chart_container &&
        getComputedStyle(chart_container).position === "sticky"
          ? chart_container.getBoundingClientRect().height
          : 0;
      entry.style.scrollMarginTop = `${chart_height.toString()}px`;
      entry.scrollIntoView({ behavior: "smooth", block: "start" });
      entry.animate(
        [
          { outline: "2px solid var(--link-color)" },
          { outline: "2px solid transparent" },
        ],
        { duration: 2000, easing: "ease-in" },
      );
    }
    node.addEventListener("chart-select-date", handler);
    return () => {
      node.removeEventListener("chart-select-date", handler);
    };
  }

  let all_charts = $derived.by(() => {
    if (report.type === "journal") {
      return report.charts;
    }
    const { charts, interval_balances, dates, interval } = report;
    const date_format = get_date_format(interval, $fiscal_year_end);
    return [
      ...charts,
      ...interval_balances
        .slice(0, 3)
        .map(
          (node, index) =>
            new ParsedHierarchyChart(
              date_format(dates[index]?.begin ?? new Date()),
              node,
              `interval_${index.toString()}`,
            ),
        ),
    ];
  });
</script>

<div {@attach chart_click_listener}>
  <div
    class={{ "sticky-chart": report.type === "journal" }}
    bind:this={chart_container}
  >
    <ChartSwitcher charts={all_charts} />
  </div>

  <div class="droptarget" data-account-name={account}>
    <div class="headerline">
      <h3>
        {#if report_type !== "journal"}
          <a
            href={$url_for_account(account)}
            title={_(
              "Journal of all entries for this Account and Sub-Accounts",
            )}
          >
            {_("Account Journal")}
          </a>
        {:else}
          {_("Account Journal")}
        {/if}
      </h3>
      <h3>
        {#if report_type !== "changes"}
          <a href={$url_for_account(account, { r: "changes" })}>
            {_("Changes")} ({interval_label_lower})
          </a>
        {:else}
          {_("Changes")} ({interval_label_lower})
        {/if}
      </h3>
      <h3>
        {#if report_type !== "balances"}
          <a href={$url_for_account(account, { r: "balances" })}>
            {_("Balances")} ({interval_label_lower})
          </a>
        {:else}
          {_("Balances")} ({interval_label_lower})
        {/if}
      </h3>
    </div>
    {#if report.type === "journal"}
      <JournalTable
        journal={report.journal}
        initial_sort={["date", "desc"]}
        show_change_and_balance={true}
      />
    {:else if is_non_empty(report.interval_balances)}
      <IntervalTreeTable
        trees={report.interval_balances}
        dates={report.dates}
        budgets={report.budgets}
        interval={report.interval}
        {accumulate}
      />
    {/if}
  </div>
</div>

<style>
  /*
  Keep the chart in view while scrolling through the journal, so that the
  journal can be navigated by clicking on the chart. The negative offset and
  margin cover the padding of the scrolling <article>. On small screens the
  whole page scrolls instead, so this has no effect there.
  */
  @media (width > 767px) {
    .sticky-chart {
      position: sticky;
      top: -1.5em;
      z-index: 1;
      padding-top: 1.5em;
      margin-top: -1.5em;
      background: var(--background);
    }
  }
</style>
