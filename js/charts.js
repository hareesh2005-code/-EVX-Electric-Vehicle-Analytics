/* =====================================================================
   EVX charts  (js/charts.js)
   Small helpers around Chart.js. Every chart is created from model
   results by app.js; existing charts are destroyed before redrawing so
   repeated simulations never stack up.
   ===================================================================== */

(function (root) {

    "use strict";

    const COLORS = Object.freeze({
        blue: "#3ccf80",     // primary series (green)
        teal: "#d5dbe1",     // secondary series (near white)
        amber: "#e0a43a",    // operating-point marker
        red: "#f0705f",      // limits and reserve lines
        slate: "#8f9ba7",    // neutral grey
        dim: "#56626d",      // darker neutral
        ink: "#e8ecf0"
    });

    const registry = {};

    function applyDefaults() {
        if (!root.Chart || applyDefaults.done) { return; }
        const d = root.Chart.defaults;
        d.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        d.font.size = 12;
        d.color = "#9aa6b2";
        d.borderColor = "#242b33";
        const tt = d.plugins.tooltip;
        tt.backgroundColor = "#0b0e11";
        tt.borderColor = "#3a4550";
        tt.borderWidth = 1;
        tt.titleColor = "#e8ecf0";
        tt.bodyColor = "#d5dbe1";
        tt.padding = 10;
        tt.cornerRadius = 3;
        d.plugins.legend.labels.color = "#b4bec8";
        applyDefaults.done = true;
    }

    function destroy(id) {
        if (registry[id]) {
            registry[id].destroy();
            delete registry[id];
        }
    }

    function create(id, config) {
        const canvas = document.getElementById(id);
        if (!canvas || !root.Chart) { return null; }
        applyDefaults();
        destroy(id);
        registry[id] = new root.Chart(canvas, config);
        return registry[id];
    }

    function tooltipLabel(ctx) {
        const v = ctx.parsed.y !== undefined && ctx.parsed.y !== null && ctx.chart.options.indexAxis !== "y"
            ? ctx.parsed.y : ctx.parsed.x;
        const text = Number.isFinite(v) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "n/a";
        return (ctx.dataset.label ? ctx.dataset.label + ": " : "") + text;
    }

    function axis(title, extra) {
        return Object.assign({
            title: { display: Boolean(title), text: title || "" },
            grid: { color: "#222a31" }
        }, extra || {});
    }

    /** Line chart with numeric x axis. datasets: [{label, points:[{x,y}], color, dashed, axis, fill, stepped}] */
    function line(id, o) {
        const datasets = o.datasets.map((d) => ({
            label: d.label,
            data: d.points,
            borderColor: d.color || COLORS.blue,
            backgroundColor: d.fill ? (d.color || COLORS.blue) + "22" : (d.color || COLORS.blue),
            borderWidth: 2,
            borderDash: d.dashed ? [6, 4] : [],
            pointRadius: d.pointRadius === undefined ? 0 : d.pointRadius,
            pointHoverRadius: 4,
            tension: 0,
            stepped: d.stepped || false,
            fill: Boolean(d.fill),
            yAxisID: d.axis || "y"
        }));

        const scales = {
            x: axis(o.xTitle, { type: "linear", min: o.xMin, max: o.xMax }),
            y: axis(o.yTitle, { beginAtZero: o.yBeginAtZero !== false, min: o.yMin, max: o.yMax })
        };
        if (o.y2Title) {
            scales.y2 = axis(o.y2Title, { position: "right", beginAtZero: true, grid: { drawOnChartArea: false } });
        }

        return create(id, {
            type: "line",
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: "nearest", axis: "x", intersect: false },
                plugins: {
                    legend: { display: datasets.length > 1, position: "bottom", labels: { boxWidth: 14 } },
                    tooltip: { callbacks: { label: tooltipLabel } }
                },
                scales
            }
        });
    }

    /** Bar chart. datasets: [{label, data, color | colors}] */
    function bar(id, o) {
        const datasets = o.datasets.map((d) => ({
            label: d.label,
            data: d.data,
            backgroundColor: d.colors || d.color || COLORS.blue,
            borderWidth: 0,
            borderRadius: 2
        }));

        return create(id, {
            type: "bar",
            data: { labels: o.labels, datasets },
            options: {
                indexAxis: o.horizontal ? "y" : "x",
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { display: datasets.length > 1, position: "bottom", labels: { boxWidth: 14 } },
                    tooltip: { callbacks: { label: tooltipLabel } }
                },
                scales: {
                    x: axis(o.xTitle, { beginAtZero: true, stacked: Boolean(o.stacked) }),
                    y: axis(o.yTitle, { beginAtZero: true, stacked: Boolean(o.stacked) })
                }
            }
        });
    }

    /** PNG data URL of a chart canvas (used by the printable report). */
    function toImage(id) {
        const c = registry[id];
        try { return c ? c.toBase64Image() : ""; } catch (e) { return ""; }
    }

    root.EVXCharts = Object.freeze({ COLORS, line, bar, destroy, toImage });

}(typeof self !== "undefined" ? self : this));
