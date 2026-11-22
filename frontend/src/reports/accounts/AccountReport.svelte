<script lang="ts">
  import ChartSwitcher from "../../charts/ChartSwitcher.svelte";
  import { ParsedHierarchyChart } from "../../charts/hierarchy.ts";
  import { urlForAccount } from "../../helpers.ts";
  import { _ } from "../../i18n.ts";
  import { is_non_empty } from "../../lib/array.ts";
  import { intervalLabel } from "../../lib/interval.ts";
  import { currentTimeFilterDateFormat } from "../../stores/format.ts";
  import { interval } from "../../stores/url.ts";
  import IntervalTreeTable from "../../tree-table/IntervalTreeTable.svelte";
  import JournalTable from "../journal/JournalTable.svelte";
  import type { AccountReportProps } from "./index.ts";

  let {
    account,
    report_type,
    charts,
    journal,
    interval_balances,
    dates,
    budgets,
  }: AccountReportProps = $props();

  let accumulate = $derived(report_type === "balances");
  let interval_label = $derived(intervalLabel($interval).toLowerCase());

  /** Attach listener for chart date clicks to scroll the journal. */
  function chartClickListener(node: HTMLElement) {
    function handler(event: Event) {
      const detail = (event as CustomEvent<{ date: Date }>).detail;
      const targetStr = detail.date.toISOString().slice(0, 10);
      const dateCells = node.querySelectorAll<HTMLElement>(
        ".journal > li > p > .datecell > a",
      );
      let closest: Element | null = null;
      let closestDiff = Infinity;
      for (const cell of dateCells) {
        const dateStr = cell.textContent?.trim();
        if (dateStr) {
          const diff = Math.abs(
            new Date(dateStr).getTime() - new Date(targetStr).getTime(),
          );
          if (diff < closestDiff) {
            closestDiff = diff;
            closest = cell.closest("li");
          }
        }
      }
      closest?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    node.addEventListener("chart-select-date", handler);
    return () => {
      node.removeEventListener("chart-select-date", handler);
    };
  }

  let all_charts = $derived(
    interval_balances && dates
      ? [
          ...charts,
          ...interval_balances
            .slice(0, 3)
            .map(
              (node, index) =>
                new ParsedHierarchyChart(
                  $currentTimeFilterDateFormat(
                    dates[index]?.begin ?? new Date(),
                  ),
                  node,
                ),
            ),
        ]
      : charts,
  );
</script>

<div {@attach chartClickListener}>
<div class="sticky-chart">
  <ChartSwitcher charts={all_charts} />
</div>

<div class="droptarget" data-account-name={account}>
  <div class="headerline">
    <h3>
      {#if report_type !== "journal"}
        <a
          href={$urlForAccount(account)}
          title={_("Journal of all entries for this Account and Sub-Accounts")}
        >
          {_("Account Journal")}
        </a>
      {:else}
        {_("Account Journal")}
      {/if}
    </h3>
    <h3>
      {#if report_type !== "changes"}
        <a href={$urlForAccount(account, { r: "changes" })}>
          {_("Changes")} ({interval_label})
        </a>
      {:else}
        {_("Changes")} ({interval_label})
      {/if}
    </h3>
    <h3>
      {#if report_type !== "balances"}
        <a href={$urlForAccount(account, { r: "balances" })}>
          {_("Balances")} ({interval_label})
        </a>
      {:else}
        {_("Balances")} ({interval_label})
      {/if}
    </h3>
  </div>
  {#if report_type === "journal" && journal != null}
    <JournalTable
      {journal}
      initial_sort={["date", "desc"]}
      show_change_and_balance={true}
    />
  {:else if interval_balances && is_non_empty(interval_balances) && budgets && dates}
    <IntervalTreeTable
      trees={interval_balances}
      {dates}
      {budgets}
      {accumulate}
    />
  {/if}
</div>
</div>

<style>
  .sticky-chart {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--background);
  }
</style>
