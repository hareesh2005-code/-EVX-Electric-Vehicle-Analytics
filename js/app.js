/* =====================================================================
   EVX application  (js/app.js)
   Page navigation, forms and rendering. All calculations are done by
   EVXModel (js/model.js); this file only reads inputs, calls the model
   and shows results.
   ===================================================================== */

(function () {

    "use strict";

    const M = window.EVXModel;
    const P = window.EVXProfiles;
    const S = window.EVXStorage;
    const C = window.EVXCharts;

    /* ------------------------------------------------------------
       Small helpers
       ------------------------------------------------------------ */
    const $ = (id) => document.getElementById(id);

    function fmt(value, decimals) {
        if (!Number.isFinite(value)) { return "-"; }
        return value.toLocaleString("en-IN", {
            minimumFractionDigits: decimals || 0,
            maximumFractionDigits: decimals || 0
        });
    }

    function esc(text) {
        return String(text).replace(/[&<>"']/g, (ch) => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
        ));
    }

    function setText(id, text) {
        const el = $(id);
        if (el) { el.textContent = text; }
    }

    function fmtDuration(hours) {
        if (!Number.isFinite(hours)) { return "-"; }
        const total = Math.round(hours * 60);
        if (total < 60) { return total + " min"; }
        return Math.floor(total / 60) + " h " + (total % 60) + " min";
    }

    function readNumber(id) {
        const el = $(id);
        if (!el || el.value.trim() === "") { return NaN; }
        return Number(el.value);
    }

    function setValue(id, value) {
        const el = $(id);
        if (!el) { return; }
        el.value = Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : "";
    }

    /** Show a list of messages inside a container (kind: error | warn | info). */
    function showMessages(id, list, kind) {
        const el = $(id);
        if (!el) { return; }
        if (!list || list.length === 0) {
            el.innerHTML = "";
            el.className = "messages";
            return;
        }
        el.className = "messages messages-" + (kind || "error") + " is-visible";
        el.innerHTML = "<ul>" + list.map((m) => "<li>" + esc(m) + "</li>").join("") + "</ul>";
    }

    function debounce(fn, ms) {
        let timer = null;
        return function () {
            clearTimeout(timer);
            timer = setTimeout(fn, ms);
        };
    }

    function download(filename, text, mime) {
        const blob = new Blob([text], { type: mime || "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function timeStamp() {
        return new Date().toLocaleTimeString();
    }

    /* ------------------------------------------------------------
       State
       ------------------------------------------------------------ */
    const REFERENCE_SPEED = { "sample-scooter": 62 };

    const state = {
        simple: null,
        customProfiles: [],
        activeId: "sample-scooter",
        eng: { speed: NaN, grade: 0, soc: NaN },
        drive: { preset: "urban", peak: NaN, repeats: 3, grade: 0, soc: NaN, regen: false, custom: "" },
        ana: { speed: NaN, grade: 0, a: "", b: "" },
        draft: null,
        last: { drive: null, driveCfgName: "" }
    };

    /* ---- profiles ---- */
    function allProfiles() {
        return P.SAMPLE_PROFILES.concat(state.customProfiles);
    }

    function getProfile(id) {
        return allProfiles().find((p) => p.id === id) || P.SAMPLE_PROFILES[0];
    }

    function activeProfile() {
        return getProfile(state.activeId);
    }

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function newId() {
        return "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function saveProfiles() {
        S.set("profiles", state.customProfiles);
        S.set("active", state.activeId);
    }

    function loadProfiles() {
        const stored = S.get("profiles", []);
        state.customProfiles = [];
        if (Array.isArray(stored)) {
            stored.forEach((p) => {
                if (p && typeof p.id === "string" && typeof p.name === "string" && p.cfg &&
                    M.validateConfig(p.cfg).valid) {
                    state.customProfiles.push({
                        id: p.id, name: p.name.slice(0, 60), category: p.category || "scooter",
                        description: "Saved on this device.", maxPayloadKg: p.maxPayloadKg || p.cfg.payloadKg * 2,
                        isSample: false, cfg: p.cfg
                    });
                }
            });
        }
        const active = S.get("active", "sample-scooter");
        state.activeId = allProfiles().some((p) => p.id === active) ? active : "sample-scooter";
    }

    /* ------------------------------------------------------------
       Routing
       ------------------------------------------------------------ */
    const SIMPLE_SUBS = ["range", "trip", "charging", "cost"];
    const ENG_SUBS = ["overview", "vehicle", "drive", "analytics", "report"];
    let route = { view: "home", sub: "" };

    function parseHash() {
        const parts = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
        const view = parts[0] || "home";
        if (view === "simple") { return { view, sub: SIMPLE_SUBS.includes(parts[1]) ? parts[1] : "range" }; }
        if (view === "engineering") { return { view, sub: ENG_SUBS.includes(parts[1]) ? parts[1] : "overview" }; }
        if (view === "model") { return { view, sub: "" }; }
        return { view: "home", sub: "" };
    }

    function applyRoute() {
        route = parseHash();

        document.querySelectorAll(".view").forEach((v) => { v.hidden = (v.id !== "view-" + route.view); });

        document.querySelectorAll(".topnav a").forEach((a) => {
            if (a.dataset.nav === route.view) { a.setAttribute("aria-current", "page"); }
            else { a.removeAttribute("aria-current"); }
        });

        if (route.view === "simple" || route.view === "engineering") {
            document.querySelectorAll("#view-" + route.view + " .subview").forEach((s) => {
                s.hidden = (s.id !== "sub-" + route.view + "-" + route.sub);
            });
            document.querySelectorAll("#" + (route.view === "simple" ? "simple-nav" : "eng-nav") + " a").forEach((a) => {
                if (a.dataset.sub === route.sub) { a.setAttribute("aria-current", "page"); }
                else { a.removeAttribute("aria-current"); }
            });
        }

        document.title = "EVX | " + ({
            home: "Electric Vehicle Analytics", simple: "Simple Mode", engineering: "Engineering Mode", model: "Model and assumptions"
        }[route.view]);

        renderCurrent();
        window.scrollTo(0, 0);
    }

    function renderCurrent() {
        try {
            if (route.view === "home") { renderHome(); }
            else if (route.view === "simple") { renderSimple(); }
            else if (route.view === "engineering") { renderEngineering(); }
            else if (route.view === "model") { renderModelPage(); }
        } catch (error) {
            console.error("EVX render error:", error);
        }
    }

    /* ------------------------------------------------------------
       HOME
       ------------------------------------------------------------ */
    function renderHome() {
        const sample = P.SAMPLE_PROFILES[0];
        const op = M.operatingPoint(sample.cfg, { speedKmh: 62 });
        const items = M.powerFlow(op);
        const total = op.chemicalPowerW;
        const list = $("home-flow");

        list.innerHTML = items.map((it) => {
            const pct = Math.max(1.5, 100 * it.watts / total);
            const cls = it.key === "wheel" ? "is-useful" : (it.key === "aux" ? "is-aux" : "is-loss");
            return '<li class="' + cls + '"><span class="flow-label">' + esc(it.label) + '</span>' +
                '<span class="flow-bar"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
                '<span class="flow-val">' + fmt(it.watts / 1000, 2) + ' kW</span></li>';
        }).join("");

        const remaining = M.usableRemainingWh(sample.cfg, sample.cfg.initialSocPercent);
        $("home-totals").innerHTML =
            "<div><dt>Drawn from the battery</dt><dd>" + fmt(total / 1000, 2) + " kW</dd></div>" +
            "<div><dt>Energy use</dt><dd>" + fmt(op.consumptionWhPerKm, 0) + " Wh/km</dd></div>" +
            "<div><dt>Range at " + sample.cfg.initialSocPercent + "% charge</dt><dd>" + fmt(M.rangeKm(remaining, op.consumptionWhPerKm), 0) + " km</dd></div>";
        setText("flow-sub", "Sample scooter at 62 km/h, flat road, " + sample.cfg.initialSocPercent + "% charge");
    }

    /* ------------------------------------------------------------
       MODEL PAGE
       ------------------------------------------------------------ */
    function renderModelPage() {
        const s = M.LOSS_SPLIT;
        setText("split-text", Math.round(s.copper * 100) + "% copper, " + Math.round(s.iron * 100) +
            "% iron and " + Math.round(s.friction * 100) + "% friction");
    }

    /* ------------------------------------------------------------
       SIMPLE MODE
       ------------------------------------------------------------ */
    const SIMPLE_NUMBER_FIELDS = [
        ["s-kwh", "kwh"], ["s-voltage", "voltage"], ["s-soc", "soc"], ["s-reserve", "reserve"],
        ["s-mass", "mass"], ["s-payload", "payload"], ["s-speed", "speed"], ["s-manual", "manual"],
        ["t-distance", "distance"], ["t-elevation", "elevation"],
        ["c-start", "cStart"], ["c-target", "cTarget"], ["c-power", "cPower"], ["c-eff", "cEff"], ["c-max", "cMax"],
        ["k-tariff", "tariff"], ["k-monthly", "monthly"], ["k-eff", "kEff"]
    ];
    const SIMPLE_OPTIONAL = ["elevation", "cMax", "monthly", "manual", "speed"];

    function simpleDefaults(categoryId) {
        const sample = P.sampleForCategory(categoryId);
        const c = sample.cfg;
        const top = M.topSpeedKmh(c, 0);
        return {
            category: sample.category,
            kwh: Math.round(M.nominalEnergyWh(c)) / 1000,
            voltage: c.batteryVoltageV,
            soc: c.initialSocPercent,
            reserve: c.reserveSocPercent,
            mass: c.massKg,
            payload: c.payloadKg,
            consMode: "model",
            speed: REFERENCE_SPEED[sample.id] || Math.round(top * 0.5),
            manual: Math.round(M.operatingPoint(c, { speedKmh: Math.max(5, top * 0.5) }).consumptionWhPerKm)
        };
    }

    function simpleExtras() {
        return {
            distance: 20, elevation: 0,
            cStart: 20, cTarget: 90, cPower: 3.3, cEff: 90, cMax: 0, cTaper: true,
            tariff: 8, currency: "INR", monthly: 600, kEff: 90
        };
    }

    function loadSimpleState() {
        const base = Object.assign(simpleDefaults("scooter"), simpleExtras());
        const saved = S.get("simple", null);
        if (saved && typeof saved === "object") {
            Object.keys(base).forEach((k) => {
                if (saved[k] !== undefined && typeof saved[k] === typeof base[k] &&
                    (typeof base[k] !== "number" || Number.isFinite(saved[k]))) {
                    base[k] = saved[k];
                }
            });
            if (!P.CATEGORIES.some((c) => c.id === base.category)) { base.category = "scooter"; }
        }
        state.simple = base;
    }

    function pushSimpleToDom() {
        const s = state.simple;
        SIMPLE_NUMBER_FIELDS.forEach(([id, key]) => setValue(id, s[key]));
        $("s-category").value = s.category;
        $("s-cons-mode").value = s.consMode;
        $("k-currency").value = s.currency;
        $("c-taper").checked = Boolean(s.cTaper);
        toggleConsMode();
        updateTariffUnit();
    }

    function pullSimpleFromDom() {
        const s = state.simple;
        SIMPLE_NUMBER_FIELDS.forEach(([id, key]) => {
            let v = readNumber(id);
            if (Number.isNaN(v) && SIMPLE_OPTIONAL.includes(key)) { v = 0; }
            s[key] = v;
        });
        s.category = $("s-category").value;
        s.consMode = $("s-cons-mode").value;
        s.currency = $("k-currency").value;
        s.cTaper = $("c-taper").checked;
        S.set("simple", s);
    }

    function toggleConsMode() {
        const manual = $("s-cons-mode").value === "manual";
        $("s-manual-wrap").hidden = !manual;
        $("s-speed-wrap").hidden = manual;
    }

    function currencySymbol() {
        const c = P.CURRENCIES.find((x) => x.code === state.simple.currency);
        return c ? c.symbol : "";
    }

    function updateTariffUnit() {
        setText("k-tariff-unit", currencySymbol() + "/kWh");
    }

    function money(v) {
        return Number.isFinite(v) ? currencySymbol() + fmt(v, 2) : "-";
    }

    /** Builds the physics configuration for Simple Mode and checks all inputs. */
    function prepareSimple() {
        const s = state.simple;
        const errors = [];
        const inRange = (v, lo, hi, label, unit) => {
            if (!Number.isFinite(v) || v < lo || v > hi) {
                errors.push(label + " must be between " + lo + " and " + hi + (unit ? " " + unit : "") + ".");
                return false;
            }
            return true;
        };

        inRange(s.kwh, 0.1, 2000, "Battery energy", "kWh");
        inRange(s.voltage, 12, 1000, "Battery voltage", "V");
        inRange(s.soc, 0, 100, "Current charge", "%");
        inRange(s.reserve, 0, 50, "Reserve", "%");
        inRange(s.mass, 20, 50000, "Vehicle mass", "kg");
        inRange(s.payload, 0, 20000, "Rider and load", "kg");

        if (s.consMode === "manual") {
            inRange(s.manual, 1, 5000, "Energy use", "Wh/km");
        } else {
            inRange(s.speed, 1, 400, "Typical speed", "km/h");
        }
        if (errors.length) { return { ok: false, errors }; }

        const sample = P.sampleForCategory(s.category);
        let cfg = Object.assign({}, sample.cfg, {
            massKg: s.mass, payloadKg: s.payload, reserveSocPercent: s.reserve, initialSocPercent: 100
        });
        cfg = M.rescaleBattery(cfg, s.voltage, s.kwh * 1000 / s.voltage);

        const check = M.validateConfig(cfg);
        if (!check.valid) { return { ok: false, errors: check.errors }; }

        const top = M.topSpeedKmh(cfg, 0);
        setText("s-speed-hint", "Modelled top speed for this vehicle: about " + fmt(top, 0) + " km/h.");

        let cons;
        if (s.consMode === "manual") {
            cons = { whPerKm: s.manual, source: "Based on the energy use you entered (" + fmt(s.manual, 0) + " Wh/km). EVX scenarios are hidden because they need its own estimate." };
        } else {
            try {
                const op = M.operatingPoint(cfg, { speedKmh: s.speed });
                cons = {
                    whPerKm: op.consumptionWhPerKm,
                    source: "Estimated by EVX for steady driving at " + fmt(s.speed, 0) + " km/h on a flat road, using the sample " +
                        sample.category.replace("-", " ") + " profile with your battery, mass and load. This is an average-value estimate."
                };
            } catch (e) {
                return { ok: false, errors: ["At " + fmt(s.speed, 0) + " km/h: " + e.message + " Try a speed below " + fmt(top, 0) + " km/h."] };
            }
        }
        return { ok: true, cfg, cons, sample, errors: [] };
    }

    function clearSimpleResults() {
        ["rng-range", "rng-remaining", "rng-consumption", "t-energy", "t-end", "t-margin", "t-max",
            "c-time", "c-battery", "c-grid", "c-t80", "k-perkm", "k-charge", "k-trip", "k-month"].forEach((id) => setText(id, "-"));
        setText("rng-source", "");
        $("rng-scenarios").innerHTML = "";
        $("rng-insights").innerHTML = "";
        setText("rng-spread", "");
        setText("t-source", "");
        setText("k-source", "");
        $("t-verdict").className = "verdict";
        setText("t-verdict", "");
        ["chart-rng-soc", "chart-trip", "chart-charge"].forEach(C.destroy);
    }

    function renderSimple() {
        const prep = prepareSimple();
        showMessages("s-messages", prep.errors);

        const s = state.simple;
        const sample = P.sampleForCategory(s.category);
        setText("s-profile-note", "Sample values for a generic " + sample.category.replace("-", " ") +
            ". They are not a real model; change anything to match your vehicle.");

        if (!prep.ok) {
            clearSimpleResults();
            return;
        }

        if (route.sub === "range") { renderRange(prep); }
        else if (route.sub === "trip") { renderTrip(prep); }
        else if (route.sub === "charging") { renderCharging(prep); }
        else if (route.sub === "cost") { renderCost(prep); }
    }

    function renderRange(prep) {
        const s = state.simple;
        const cfg = prep.cfg;
        const wh = prep.cons.whPerKm;
        const remainingWh = M.usableRemainingWh(cfg, s.soc);
        const range = M.rangeKm(remainingWh, wh);

        setText("rng-range", fmt(range, range < 100 ? 1 : 0));
        setText("rng-remaining", fmt(remainingWh / 1000, 2));
        setText("rng-consumption", fmt(wh, 0));
        setText("rng-source", prep.cons.source);

        const body = $("rng-scenarios");
        const insights = [];

        if (s.consMode === "model") {
            const scen = M.scenarioRanges(cfg, s.soc, { heavyPayloadKg: prep.sample.maxPayloadKg });
            body.innerHTML = scen.map((r) =>
                "<tr><th scope=\"row\">" + esc(r.label) + "<span class=\"row-detail\">" + esc(r.detail) + "</span></th>" +
                "<td class=\"num\">" + fmt(r.consumptionWhPerKm, 0) + "</td><td class=\"num\">" + fmt(r.rangeKm, r.rangeKm < 100 ? 1 : 0) + "</td></tr>"
            ).join("");

            const ok = scen.filter((r) => Number.isFinite(r.rangeKm));
            if (ok.length) {
                const lo = Math.min.apply(null, ok.map((r) => r.rangeKm));
                const hi = Math.max.apply(null, ok.map((r) => r.rangeKm));
                setText("rng-spread", "Across these conditions the estimate runs from about " + fmt(lo, 0) + " km to " + fmt(hi, 0) + " km.");
            }

            const by = Object.fromEntries(scen.map((r) => [r.id, r]));
            if (by.low && by.high && Number.isFinite(by.low.rangeKm) && Number.isFinite(by.high.rangeKm)) {
                insights.push("Speed matters most. Air resistance grows with the square of speed, so range falls from about " +
                    fmt(by.low.rangeKm, 0) + " km at low speed to " + fmt(by.high.rangeKm, 0) + " km at higher speed.");
            }
            if (by.light && by.heavy && Number.isFinite(by.light.rangeKm) && Number.isFinite(by.heavy.rangeKm)) {
                insights.push("Extra load increases rolling and climbing energy: about " + fmt(by.light.rangeKm, 0) +
                    " km with no payload versus " + fmt(by.heavy.rangeKm, 0) + " km with a heavy load.");
            }
            if (by.uphill && Number.isFinite(by.uphill.rangeKm)) {
                insights.push("A steady 3% uphill gradient cuts the range to about " + fmt(by.uphill.rangeKm, 0) + " km at moderate speed.");
            }
        } else {
            body.innerHTML = "<tr><td colspan=\"3\">Switch \"Energy use per km comes from\" to the EVX estimate to compare conditions.</td></tr>";
            setText("rng-spread", "");
        }

        insights.unshift("Your estimate follows from the selected energy use of " + fmt(wh, 0) + " Wh/km and the " +
            fmt(remainingWh / 1000, 2) + " kWh above your " + s.reserve + "% reserve.");
        insights.push("Cold weather, strong wind, tyre pressure, battery age and driving style are not modelled, so your real range may differ.");
        $("rng-insights").innerHTML = insights.map((t) => "<li>" + esc(t) + "</li>").join("");

        const pts = [];
        for (let soc = 0; soc <= 100; soc += 5) {
            pts.push({ x: soc, y: M.rangeKm(M.usableRemainingWh(cfg, soc), wh) });
        }
        C.line("chart-rng-soc", {
            datasets: [{ label: "Range", points: pts, color: C.COLORS.blue, fill: true }],
            xTitle: "Charge level (%)", yTitle: "Range (km)", xMin: 0, xMax: 100
        });
    }

    function renderTrip(prep) {
        const s = state.simple;
        const cfg = prep.cfg;
        const chain = cfg.drivetrainEfficiencyPercent / 100 * cfg.controllerEfficiencyPercent / 100 * cfg.motorRatedEfficiencyPercent / 100;
        const verdict = $("t-verdict");

        let t;
        try {
            t = M.tripEstimate({
                distanceKm: s.distance, startSocPercent: s.soc, consumptionWhPerKm: prep.cons.whPerKm,
                nominalEnergyWh: M.nominalEnergyWh(cfg), reserveSocPercent: s.reserve,
                elevationGainM: s.elevation, massKg: M.totalMassKg(cfg), chainEfficiency: chain
            });
        } catch (e) {
            showMessages("s-messages", [e.message]);
            verdict.className = "verdict";
            verdict.textContent = "";
            ["t-energy", "t-end", "t-margin", "t-max"].forEach((id) => setText(id, "-"));
            C.destroy("chart-trip");
            return;
        }

        setText("t-energy", fmt(t.tripEnergyWh / 1000, 2));
        setText("t-end", fmt(t.endSocPercent, 0));
        setText("t-margin", fmt(t.marginKm, 1));
        setText("t-max", fmt(t.maxDistanceKm, 0));

        if (t.sufficient) {
            verdict.className = "verdict verdict-ok";
            verdict.textContent = "You can complete this trip with about " + fmt(t.marginKm, 0) + " km of range to spare above your reserve.";
        } else {
            const needSoc = Math.min(999, s.reserve + 100 * t.tripEnergyWh / M.nominalEnergyWh(cfg));
            verdict.className = "verdict verdict-bad";
            verdict.textContent = "Not enough charge for this trip under the model. You are short by about " + fmt(-t.marginKm, 0) +
                " km. " + (needSoc <= 100 ? "Start with at least " + fmt(Math.ceil(needSoc), 0) + "% charge or plan a charging stop." : "The trip is longer than a full charge allows; plan a charging stop.");
        }

        setText("t-source", "Average-consumption estimate at " + fmt(prep.cons.whPerKm, 0) + " Wh/km" +
            (t.climbEnergyWh > 0 ? ", plus " + fmt(t.climbEnergyWh, 0) + " Wh for climbing" : "") +
            ". It is not a route simulation, so traffic, wind and stops are not included.");

        const pts = [{ x: 0, y: s.soc }, { x: s.distance, y: t.endSocPercent }];
        C.line("chart-trip", {
            datasets: [
                { label: "Charge level", points: pts, color: C.COLORS.blue, pointRadius: 4 },
                { label: "Reserve", points: [{ x: 0, y: s.reserve }, { x: s.distance, y: s.reserve }], color: C.COLORS.red, dashed: true }
            ],
            xTitle: "Distance (km)", yTitle: "Charge level (%)", xMin: 0, xMax: s.distance, yBeginAtZero: false
        });
    }

    function chargingInputs(prep) {
        const s = state.simple;
        return {
            capacityWh: M.nominalEnergyWh(prep.cfg), startSocPercent: s.cStart, targetSocPercent: s.cTarget,
            chargerKW: s.cPower, efficiencyPercent: s.cEff, taper: s.cTaper, maxBatteryChargeKW: s.cMax
        };
    }

    function renderCharging(prep) {
        let r;
        try {
            r = M.chargingEstimate(chargingInputs(prep));
        } catch (e) {
            showMessages("c-messages", [e.message]);
            ["c-time", "c-battery", "c-grid", "c-t80"].forEach((id) => setText(id, "-"));
            C.destroy("chart-charge");
            return;
        }
        showMessages("c-messages", []);
        setText("c-time", fmtDuration(r.hours));
        setText("c-battery", fmt(r.batteryEnergyWh / 1000, 2));
        setText("c-grid", fmt(r.gridEnergyWh / 1000, 2));
        setText("c-t80", r.timeTo80Hours === null ? "Not reached" : fmtDuration(r.timeTo80Hours));

        C.line("chart-charge", {
            datasets: [{ label: "Charge level", points: r.curve.map((p) => ({ x: p.hours, y: p.socPercent })), color: C.COLORS.blue, fill: true }],
            xTitle: "Time (hours)", yTitle: "Charge level (%)", yBeginAtZero: false, yMin: Math.max(0, state.simple.cStart - 5), yMax: 100
        });
    }

    function renderCost(prep) {
        const s = state.simple;
        let grid = NaN;
        try {
            grid = M.chargingEstimate(chargingInputs(prep)).gridEnergyWh / 1000;
        } catch (e) { /* charge cost stays blank */ }

        let r;
        try {
            if (!(s.kEff >= 50 && s.kEff <= 100)) { throw new Error("Charging efficiency must be between 50% and 100%."); }
            r = M.costEstimate({
                tariffPerKWh: s.tariff, gridEnergyKWh: Number.isFinite(grid) ? grid : 0,
                consumptionWhPerKm: prep.cons.whPerKm, efficiencyPercent: s.kEff,
                tripKm: s.distance, monthlyKm: s.monthly
            });
        } catch (e) {
            showMessages("k-messages", [e.message]);
            ["k-perkm", "k-charge", "k-trip", "k-month"].forEach((id) => setText(id, "-"));
            return;
        }
        showMessages("k-messages", []);
        setText("k-perkm", money(r.costPerKm));
        setText("k-charge", Number.isFinite(grid) ? money(r.chargeCost) : "-");
        setText("k-trip", money(r.tripCost));
        setText("k-month", money(r.monthlyCost));
        setText("k-source", "Tariff of " + money(s.tariff) + " per kWh (an example value; enter your own). Cost of this charge uses the Charging tab settings (" +
            fmt(s.cStart, 0) + "% to " + fmt(s.cTarget, 0) + "%); the trip uses the distance from the Trip tab. Energy use is " + fmt(prep.cons.whPerKm, 0) + " Wh/km.");
    }

    function bindSimple() {
        const cats = $("s-category");
        cats.innerHTML = P.CATEGORIES.map((c) => '<option value="' + c.id + '">' + esc(c.label) + "</option>").join("");
        $("k-currency").innerHTML = P.CURRENCIES.map((c) => '<option value="' + c.code + '">' + esc(c.label) + "</option>").join("");

        const onChange = function () {
            pullSimpleFromDom();
            updateTariffUnit();
            renderSimple();
        };
        const debounced = debounce(onChange, 120);

        SIMPLE_NUMBER_FIELDS.forEach(([id]) => $(id).addEventListener("input", debounced));
        $("c-taper").addEventListener("change", onChange);
        $("k-currency").addEventListener("change", onChange);
        $("s-cons-mode").addEventListener("change", () => { toggleConsMode(); onChange(); });

        cats.addEventListener("change", () => {
            const extras = {};
            Object.keys(simpleExtras()).forEach((k) => { extras[k] = state.simple[k]; });
            state.simple = Object.assign(simpleDefaults(cats.value), extras);
            S.set("simple", state.simple);
            pushSimpleToDom();
            renderSimple();
        });

        $("s-reset").addEventListener("click", () => {
            state.simple = Object.assign(simpleDefaults(cats.value), simpleExtras());
            S.set("simple", state.simple);
            pushSimpleToDom();
            renderSimple();
        });

        $("c-presets").addEventListener("click", (ev) => {
            const kw = ev.target && ev.target.dataset && ev.target.dataset.kw;
            if (kw) { setValue("c-power", Number(kw)); onChange(); }
        });
    }

    /* ------------------------------------------------------------
       ENGINEERING MODE: shared
       ------------------------------------------------------------ */
    function profileOptions(selectedId) {
        const samples = P.SAMPLE_PROFILES.map((p) =>
            '<option value="' + p.id + '"' + (p.id === selectedId ? " selected" : "") + ">" + esc(p.name) + "</option>").join("");
        const custom = state.customProfiles.map((p) =>
            '<option value="' + p.id + '"' + (p.id === selectedId ? " selected" : "") + ">" + esc(p.name) + "</option>").join("");
        return '<optgroup label="Sample profiles (generic)">' + samples + "</optgroup>" +
            (custom ? '<optgroup label="Your configurations">' + custom + "</optgroup>" : "");
    }

    function refreshProfileSelects() {
        ["eng-profile", "veh-profile"].forEach((id) => { $(id).innerHTML = profileOptions(state.activeId); });
        ["cmp-a", "cmp-b"].forEach((id, i) => {
            const prev = i === 0 ? state.ana.a : state.ana.b;
            const fallback = i === 0 ? state.activeId : (allProfiles().find((p) => p.id !== state.activeId) || activeProfile()).id;
            const chosen = allProfiles().some((p) => p.id === prev) ? prev : fallback;
            $(id).innerHTML = profileOptions(chosen);
        });
    }

    function defaultEngInputs() {
        const p = activeProfile();
        const top = M.topSpeedKmh(p.cfg, 0);
        state.eng.speed = REFERENCE_SPEED[p.id] || Math.max(1, Math.round(top * 0.5));
        state.eng.grade = 0;
        state.eng.soc = p.cfg.initialSocPercent;
        state.drive.peak = Math.max(5, Math.round(top * 0.5));
        state.drive.soc = p.cfg.initialSocPercent;
        state.ana.speed = Math.max(1, Math.round(top * 0.5));
    }

    function setActive(id, resetInputs) {
        state.activeId = id;
        saveProfiles();
        if (resetInputs) { defaultEngInputs(); }
        state.last.drive = null;
        loadDraft();
        refreshProfileSelects();
        pushEngInputs();
    }

    function pushEngInputs() {
        setValue("eng-speed", state.eng.speed);
        setValue("eng-grade", state.eng.grade);
        setValue("eng-soc", state.eng.soc);
        setValue("drv-peak", state.drive.peak);
        setValue("drv-repeats", state.drive.repeats);
        setValue("drv-grade", state.drive.grade);
        setValue("drv-soc", state.drive.soc);
        $("drv-regen").checked = state.drive.regen;
        $("drv-preset").value = state.drive.preset;
        $("drv-custom").value = state.drive.custom;
        setValue("ana-speed", state.ana.speed);
        setValue("ana-grade", state.ana.grade);
        toggleDrivePreset();
    }

    function renderEngineering() {
        if (route.sub === "overview") { renderOverview(); }
        else if (route.sub === "vehicle") { renderVehicleTab(); }
        else if (route.sub === "drive") { if (!state.last.drive) { runDrive(); } }
        else if (route.sub === "analytics") { runAnalytics(); runCompare(); }
        else if (route.sub === "report") { /* generated on demand */ }
    }

    /* ------------------------------------------------------------
       ENGINEERING: operating point
       ------------------------------------------------------------ */
    function drawSweepCharts(cfg, grade, op, ids) {
        const sw = M.speedSweep(cfg, { gradePercent: grade });
        const marker = (y) => ({ label: "Operating point", points: [{ x: op.speedKmh, y }], color: C.COLORS.amber, pointRadius: 6 });
        const pts = (fn) => sw.points.map((p) => ({ x: p.speedKmh, y: fn(p) }));

        if (ids.cons) {
            C.line(ids.cons, {
                datasets: [{ label: "Energy use", points: pts((p) => p.consumptionWhPerKm), color: C.COLORS.blue }, marker(op.consumptionWhPerKm)],
                xTitle: "Speed (km/h)", yTitle: "Energy use (Wh/km)", xMin: 0
            });
        }
        if (ids.power) {
            C.line(ids.power, {
                datasets: [
                    { label: "Battery power", points: pts((p) => p.batteryPowerKW), color: C.COLORS.blue },
                    { label: "Wheel power", points: pts((p) => p.wheelPowerKW), color: C.COLORS.teal },
                    marker(op.terminalPowerW / 1000)
                ],
                xTitle: "Speed (km/h)", yTitle: "Power (kW)", xMin: 0
            });
        }
        if (ids.eff) {
            C.line(ids.eff, {
                datasets: [
                    { label: "Overall, battery to wheel", points: pts((p) => p.overallEfficiencyPercent), color: C.COLORS.blue },
                    { label: "Motor", points: pts((p) => p.motorEfficiencyPercent), color: C.COLORS.teal },
                    marker(op.overallEfficiencyPercent)
                ],
                xTitle: "Speed (km/h)", yTitle: "Efficiency (%)", xMin: 0, yMin: 0, yMax: 100
            });
        }
        return sw;
    }

    function drawFlowChart(id, op) {
        const items = M.powerFlow(op);
        const colors = items.map((it) => it.key === "wheel" ? C.COLORS.blue : (it.key === "aux" ? C.COLORS.dim : C.COLORS.slate));
        C.bar(id, {
            labels: items.map((it) => it.label),
            datasets: [{ label: "Power", data: items.map((it) => it.watts / 1000), colors }],
            horizontal: true, xTitle: "Power (kW)"
        });
    }

    function metricTile(label, value, unit, kind) {
        return '<div class="metric metric-' + kind + '"><span class="metric-label">' + esc(label) + '</span>' +
            '<strong class="metric-value">' + esc(value) + (unit ? ' <small>' + esc(unit) + "</small>" : "") + "</strong>" +
            '<span class="tag tag-' + kind + '">' + (kind === "input" ? "Input" : "Calculated") + "</span></div>";
    }

    function readEngInputs() {
        state.eng.speed = readNumber("eng-speed");
        state.eng.grade = Number.isNaN(readNumber("eng-grade")) ? 0 : readNumber("eng-grade");
        state.eng.soc = readNumber("eng-soc");
    }

    /** Simulation state badge: ready | running | complete | warning | error */
    function setSimState(kind, label) {
        const el = $("eng-state");
        el.className = "state state-" + kind;
        el.textContent = label;
    }

    function setDriveState(kind) {
        const el = $("drv-state");
        if (!el) { return; }
        el.className = "state state-" + kind;
        el.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
    }

    function pipelineNode(name, outW, lossW, eff, extra) {
        return '<li><span class="node-name">' + esc(name) + '</span>' +
            '<strong class="node-value">' + fmt(outW / 1000, 2) + ' <small>kW</small></strong>' +
            '<span class="node-meta">' + (extra || ("Loss " + fmt(lossW / 1000, 3) + " kW<br>Efficiency " + (Number.isFinite(eff) ? fmt(eff, 1) + " %" : "-"))) + "</span></li>";
    }

    function renderPipeline(op, cfg) {
        const eff = (out, inp) => (inp > 0 ? 100 * out / inp : NaN);
        const toController = op.terminalPowerW - op.auxiliaryW;
        $("eng-pipeline").innerHTML = [
            pipelineNode("Battery (terminal output)", op.terminalPowerW, op.batteryLossW, eff(op.terminalPowerW, op.chemicalPowerW)),
            pipelineNode("After auxiliary load", toController, op.auxiliaryW, NaN, "Auxiliary draw " + fmt(op.auxiliaryW / 1000, 3) + " kW<br>Chemical power " + fmt(op.chemicalPowerW / 1000, 2) + " kW"),
            pipelineNode("Controller output", op.motorInputW, op.controllerLossW, eff(op.motorInputW, toController)),
            pipelineNode("Motor shaft output", op.shaftPowerW, op.motorLossW, eff(op.shaftPowerW, op.motorInputW)),
            pipelineNode("Wheel power", Math.max(0, op.wheelPowerW), op.drivetrainLossW, eff(op.wheelPowerW, op.shaftPowerW)),
            pipelineNode("Road load", Math.max(0, op.wheelPowerW), 0, NaN, "Required at the wheels<br>at " + fmt(op.speedKmh, 0) + " km/h")
        ].join("");

        const rl = op.roadLoad;
        const row = (name, f) => "<tr><th scope=\"row\">" + name + "</th><td class=\"num\">" + fmt(f, 1) + " N</td><td class=\"num\">" +
            fmt(f * rl.speedMps / 1000, 3) + " kW</td></tr>";
        $("eng-roadload").innerHTML = "<thead><tr><th scope=\"col\">Road-load component</th><th scope=\"col\" class=\"num\">Force</th><th scope=\"col\" class=\"num\">Power at wheel</th></tr></thead><tbody>" +
            row("Rolling resistance", rl.rollingForceN) + row("Aerodynamic drag", rl.aerodynamicForceN) + row("Gradient", rl.gradeForceN) +
            "<tr><th scope=\"row\">Total</th><td class=\"num\">" + fmt(rl.totalForceN, 1) + " N</td><td class=\"num\">" + fmt(rl.wheelPowerW / 1000, 3) + " kW</td></tr></tbody>";
    }

    function renderOverview() {
        const prof = activeProfile();
        const cfg = prof.cfg;
        const e = state.eng;
        const status = $("eng-status");
        const grid = $("eng-metrics");

        const fail = (msg) => {
            status.className = "status-line is-error";
            status.textContent = msg;
            setSimState("error", "Error");
            grid.innerHTML = "";
            $("eng-pipeline").innerHTML = "";
            $("eng-roadload").innerHTML = "";
            ["chart-eng-flow", "chart-eng-cons", "chart-eng-power", "chart-eng-eff", "chart-eng-range"].forEach(C.destroy);
        };

        if (!Number.isFinite(e.speed) || e.speed <= 0 || e.speed > 400) { return fail("Enter a vehicle speed between 1 and 400 km/h."); }
        if (!Number.isFinite(e.grade) || e.grade < -20 || e.grade > 30) { return fail("Road gradient must be between -20% and 30%."); }
        if (!Number.isFinite(e.soc) || e.soc < 0 || e.soc > 100) { return fail("State of charge must be between 0% and 100%."); }

        let op;
        try {
            op = M.operatingPoint(cfg, { speedKmh: e.speed, gradePercent: e.grade });
        } catch (err) {
            const top = M.topSpeedKmh(cfg, e.grade);
            return fail(err.message + (top > 0 ? " The highest speed this configuration holds at this gradient is about " + fmt(top, 0) + " km/h." : " This configuration cannot hold any speed at this gradient."));
        }

        const remainingWh = M.usableRemainingWh(cfg, e.soc);
        const range = op.consumptionWhPerKm > 0 ? M.rangeKm(remainingWh, op.consumptionWhPerKm) : NaN;
        const top = M.topSpeedKmh(cfg, e.grade);

        const title = (t) => '<h3 class="grid-title">' + t + "</h3>";
        grid.innerHTML = [
            title("Inputs"),
            metricTile("Vehicle speed", fmt(e.speed, 0), "km/h", "input"),
            metricTile("Road gradient", fmt(e.grade, 1), "%", "input"),
            metricTile("State of charge", fmt(e.soc, 0), "%", "input"),
            title("Calculated: battery"),
            metricTile("Battery voltage (terminal)", fmt(op.terminalVoltageV, 1), "V", "calc"),
            metricTile("Battery current", fmt(op.currentA, 1), "A", "calc"),
            metricTile("Battery power", fmt(op.terminalPowerW / 1000, 2), "kW", "calc"),
            metricTile("Battery internal loss", fmt(op.batteryLossW, 0), "W", "calc"),
            title("Calculated: powertrain"),
            metricTile("Wheel power", fmt(op.wheelPowerW / 1000, 2), "kW", "calc"),
            metricTile("Motor power (shaft)", fmt(op.shaftPowerW / 1000, 2), "kW", "calc"),
            metricTile("Motor RPM", fmt(op.rpm, 0), "rpm", "calc"),
            metricTile("Motor torque", fmt(op.torqueNm, 1), "N·m", "calc"),
            metricTile("Motor efficiency", fmt(op.motorEfficiency * 100, 1), "%", "calc"),
            metricTile("Overall efficiency", fmt(op.overallEfficiencyPercent, 1), "%", "calc"),
            title("Calculated: energy and range"),
            metricTile("Energy consumption", fmt(op.consumptionWhPerKm, 1), "Wh/km", "calc"),
            metricTile("Usable energy remaining", fmt(remainingWh / 1000, 2), "kWh", "calc"),
            metricTile("Estimated range", fmt(range, 1), "km", "calc"),
            metricTile("Modelled top speed", fmt(top, 0), "km/h", "calc")
        ].join("");

        const A = (label, value) => "<tr><th scope=\"row\">" + esc(label) + "</th><td class=\"num\">" + esc(value) +
            "</td><td><span class=\"tag tag-assumption\">Model assumption</span></td></tr>";
        $("eng-assumptions").innerHTML = "<tbody>" + [
            A("Rolling resistance coefficient", fmt(cfg.rollingResistance, 3)),
            A("Drag coefficient (Cd)", fmt(cfg.dragCoefficient, 2)),
            A("Frontal area", fmt(cfg.frontalAreaM2, 2) + " m²"),
            A("Air density", fmt(cfg.airDensity, 2) + " kg/m³"),
            A("Vehicle mass plus payload", fmt(M.totalMassKg(cfg), 0) + " kg"),
            A("Drivetrain efficiency", fmt(cfg.drivetrainEfficiencyPercent, 1) + " %"),
            A("Controller efficiency", fmt(cfg.controllerEfficiencyPercent, 1) + " %"),
            A("Motor efficiency model", cfg.motorModel === "loss" ? "Loss model, " + fmt(cfg.motorRatedEfficiencyPercent, 1) + " % at rated point" : "Flat " + fmt(cfg.motorRatedEfficiencyPercent, 1) + " %"),
            A("Battery nominal voltage (held constant)", fmt(cfg.batteryVoltageV, 1) + " V"),
            A("Battery internal resistance", fmt(cfg.batteryInternalResistanceOhm * 1000, 1) + " mΩ"),
            A("Reserve SOC", fmt(cfg.reserveSocPercent, 0) + " %"),
            A("Auxiliary load", fmt(cfg.auxiliaryPowerW, 0) + " W")
        ].join("") + "</tbody>";

        const notes = [];
        if (op.shaftPowerW > 0.9 * cfg.motorPeakPowerKW * 1000) { notes.push("Operating near the motor peak-power limit."); }
        if (e.soc <= cfg.reserveSocPercent) { notes.push("State of charge is at or below the reserve."); }
        M.validateConfig(cfg).warnings.forEach((w) => notes.push(w));

        status.className = "status-line";
        status.textContent = (notes.length ? notes.join(" ") + " " : "") + "Solved at " + timeStamp() + ". Configuration: " + prof.name +
            (prof.isSample ? " (sample values, not measured data)." : " (saved by you).");
        setSimState(notes.length ? "warning" : "complete", notes.length ? "Warning" : "Complete");
        renderPipeline(op, cfg);

        drawFlowChart("chart-eng-flow", op);
        drawSweepCharts(cfg, e.grade, op, { cons: "chart-eng-cons", power: "chart-eng-power", eff: "chart-eng-eff" });

        const rangePts = [];
        for (let soc = 0; soc <= 100; soc += 5) {
            rangePts.push({ x: soc, y: M.rangeKm(M.usableRemainingWh(cfg, soc), op.consumptionWhPerKm) });
        }
        C.line("chart-eng-range", {
            datasets: [
                { label: "Range", points: rangePts, color: C.COLORS.blue, fill: true },
                { label: "Operating point", points: [{ x: e.soc, y: range }], color: C.COLORS.amber, pointRadius: 6 }
            ],
            xTitle: "State of charge (%)", yTitle: "Range (km)", xMin: 0, xMax: 100
        });
    }

    /* ------------------------------------------------------------
       ENGINEERING: vehicle configuration
       ------------------------------------------------------------ */
    function loadDraft() {
        const p = activeProfile();
        state.draft = { name: p.name, category: p.category, cfg: clone(p.cfg) };
    }

    function renderVehicleTab() {
        const p = activeProfile();
        $("veh-profile").value = state.activeId;
        $("veh-name").value = state.draft.name;
        $("veh-category").innerHTML = P.CATEGORIES.map((c) =>
            '<option value="' + c.id + '"' + (c.id === state.draft.category ? " selected" : "") + ">" + esc(c.label) + "</option>").join("");
        setText("veh-kind", p.isSample
            ? "This is a generic sample. Editing and saving creates your own copy; the original is never changed."
            : "Saved on this device. Saving overwrites this configuration.");
        $("veh-delete").disabled = p.isSample;
        $("veh-rename").disabled = p.isSample;

        const groups = {};
        M.FIELDS.forEach((f) => { (groups[f.group] = groups[f.group] || []).push(f); });

        $("veh-form").innerHTML = Object.keys(groups).map((g) =>
            "<fieldset><legend>" + esc(g) + "</legend><div class=\"field-grid\">" +
            groups[g].map((f) => {
                const id = "f-" + f.key;
                const value = state.draft.cfg[f.key];
                let control;
                if (f.type === "select") {
                    control = '<select id="' + id + '">' + f.options.map((o) =>
                        '<option value="' + esc(o) + '"' + (o === value ? " selected" : "") + ">" +
                        esc(f.optionLabels ? f.optionLabels[o] : o) + "</option>").join("") + "</select>";
                } else {
                    control = '<div class="input-unit"><input id="' + id + '" type="number" inputmode="decimal" step="' + f.step +
                        '" min="' + f.min + '" max="' + f.max + '" value="' + esc(value) + '">' + (f.unit ? "<span>" + esc(f.unit) + "</span>" : "") + "</div>";
                }
                return '<div class="field"><label for="' + id + '">' + esc(f.label) + "</label>" + control +
                    (f.help ? '<p class="hint">' + esc(f.help) + "</p>" : "") + "</div>";
            }).join("") + "</div></fieldset>").join("");

        showMessages("veh-messages", []);
    }

    function readDraftFromForm() {
        const cfg = {};
        M.FIELDS.forEach((f) => {
            const el = $("f-" + f.key);
            cfg[f.key] = f.type === "select" ? el.value : (el.value.trim() === "" ? NaN : Number(el.value));
        });
        return cfg;
    }

    function saveVehicle() {
        const cfg = readDraftFromForm();
        const name = $("veh-name").value.trim().slice(0, 60);
        const category = $("veh-category").value;
        const result = M.validateConfig(cfg);

        if (!name) { result.errors.unshift("Enter a name for this configuration."); result.valid = false; }
        if (!result.valid) {
            showMessages("veh-messages", result.errors);
            return;
        }

        const current = activeProfile();
        if (current.isSample) {
            const copy = {
                id: newId(), name: name === current.name ? name + " (custom)" : name, category,
                description: "Saved on this device.", maxPayloadKg: current.maxPayloadKg, isSample: false, cfg
            };
            state.customProfiles.push(copy);
            state.activeId = copy.id;
        } else {
            current.name = name;
            current.category = category;
            current.cfg = cfg;
        }
        saveProfiles();
        state.last.drive = null;
        loadDraft();
        refreshProfileSelects();
        renderVehicleTab();
        showMessages("veh-messages", result.warnings.length ? ["Saved. Note: " + result.warnings.join(" ")] : ["Configuration saved on this device."], result.warnings.length ? "warn" : "info");
    }

    function bindVehicle() {
        $("veh-category").addEventListener("change", () => { state.draft.category = $("veh-category").value; });

        $("veh-profile").addEventListener("change", () => setActive($("veh-profile").value, true) || renderVehicleTab());
        $("eng-profile").addEventListener("change", () => { setActive($("eng-profile").value, true); renderOverview(); });

        $("veh-save").addEventListener("click", saveVehicle);
        $("veh-reset").addEventListener("click", () => { loadDraft(); renderVehicleTab(); });

        $("veh-new").addEventListener("click", () => {
            const base = P.sampleForCategory($("veh-category").value || "scooter");
            const created = {
                id: newId(), name: "New configuration", category: base.category, description: "Saved on this device.",
                maxPayloadKg: base.maxPayloadKg, isSample: false, cfg: clone(base.cfg)
            };
            state.customProfiles.push(created);
            setActive(created.id, true);
            renderVehicleTab();
            showMessages("veh-messages", ["New configuration created from the " + base.category.replace("-", " ") + " sample. Edit the values and save."], "info");
        });

        $("veh-duplicate").addEventListener("click", () => {
            const p = activeProfile();
            const created = {
                id: newId(), name: (p.name + " copy").slice(0, 60), category: p.category, description: "Saved on this device.",
                maxPayloadKg: p.maxPayloadKg, isSample: false, cfg: clone(p.cfg)
            };
            state.customProfiles.push(created);
            setActive(created.id, true);
            renderVehicleTab();
        });

        $("veh-rename").addEventListener("click", () => {
            const p = activeProfile();
            if (p.isSample) { return; }
            const name = window.prompt("New name for this configuration", p.name);
            if (name && name.trim()) {
                p.name = name.trim().slice(0, 60);
                saveProfiles();
                loadDraft();
                refreshProfileSelects();
                renderVehicleTab();
            }
        });

        $("veh-delete").addEventListener("click", () => {
            const p = activeProfile();
            if (p.isSample) { return; }
            if (!window.confirm("Delete \"" + p.name + "\"? This cannot be undone.")) { return; }
            state.customProfiles = state.customProfiles.filter((x) => x.id !== p.id);
            setActive("sample-scooter", true);
            renderVehicleTab();
        });
    }

    /* ------------------------------------------------------------
       ENGINEERING: drive cycle
       ------------------------------------------------------------ */
    function toggleDrivePreset() {
        const custom = $("drv-preset").value === "custom";
        $("drv-custom-wrap").hidden = !custom;
        $("drv-peak-wrap").hidden = custom;
        $("drv-repeat-wrap").hidden = custom;
    }

    function thin(series, maxPoints) {
        const n = series.timeS.length;
        const stride = Math.max(1, Math.ceil(n / maxPoints));
        const out = {};
        Object.keys(series).forEach((k) => { out[k] = series[k].filter((_, i) => i % stride === 0 || i === n - 1); });
        return out;
    }

    function drawDriveCharts(series, ids) {
        const t = thin(series, 1500);
        const xy = (arr) => t.timeS.map((x, i) => ({ x, y: arr[i] }));
        if (ids.speed) { C.line(ids.speed, { datasets: [{ label: "Speed", points: xy(t.speedKmh), color: C.COLORS.blue }], xTitle: "Time (s)", yTitle: "Speed (km/h)", xMin: 0 }); }
        if (ids.power) { C.line(ids.power, { datasets: [{ label: "Battery power", points: xy(t.powerKW), color: C.COLORS.teal }], xTitle: "Time (s)", yTitle: "Power (kW), negative = regeneration", xMin: 0, yBeginAtZero: false }); }
        if (ids.current) { C.line(ids.current, { datasets: [{ label: "Battery current", points: xy(t.currentA), color: C.COLORS.slate }], xTitle: "Time (s)", yTitle: "Current (A)", xMin: 0, yBeginAtZero: false }); }
        if (ids.soc) { C.line(ids.soc, { datasets: [{ label: "State of charge", points: xy(t.socPercent), color: C.COLORS.blue, fill: true }], xTitle: "Time (s)", yTitle: "State of charge (%)", xMin: 0, yBeginAtZero: false }); }
    }

    function runDrive() {
        const cfg = activeProfile().cfg;
        const d = state.drive;
        d.preset = $("drv-preset").value;
        d.peak = readNumber("drv-peak");
        d.repeats = readNumber("drv-repeats");
        d.grade = Number.isNaN(readNumber("drv-grade")) ? 0 : readNumber("drv-grade");
        d.soc = readNumber("drv-soc");
        d.regen = $("drv-regen").checked;
        d.custom = $("drv-custom").value;

        const errors = [];
        if (!Number.isFinite(d.soc) || d.soc < 1 || d.soc > 100) { errors.push("Starting charge must be between 1% and 100%."); }
        if (!Number.isFinite(d.grade) || d.grade < -20 || d.grade > 30) { errors.push("Road gradient must be between -20% and 30%."); }

        let speeds = null;
        if (!errors.length) {
            try {
                if (d.preset === "custom") {
                    speeds = M.parseSpeedProfile(d.custom);
                } else {
                    if (!Number.isFinite(d.peak) || d.peak < 1 || d.peak > 400) { throw new Error("Peak speed must be between 1 and 400 km/h."); }
                    if (!Number.isFinite(d.repeats) || d.repeats < 1 || d.repeats > 50) { throw new Error("Repeats must be between 1 and 50."); }
                    speeds = M.buildSpeedProfile(d.preset, d.peak, d.repeats);
                }
            } catch (e) { errors.push(e.message); }
        }

        if (errors.length) {
            setDriveState("error");
            showMessages("drv-messages", errors);
            $("drv-results").hidden = true;
            state.last.drive = null;
            return;
        }

        const result = M.driveCycle(cfg, speeds, { socPercent: d.soc, gradePercent: d.grade, regen: d.regen });
        state.last.drive = result;
        state.last.driveCfgName = activeProfile().name;
        S.set("drive", { preset: d.preset, peak: d.peak, repeats: d.repeats, grade: d.grade, regen: d.regen, custom: d.custom.slice(0, 20000) });

        setDriveState(result.warnings.length ? "warning" : "complete");
        showMessages("drv-messages", result.warnings, "warn");
        $("drv-results").hidden = false;

        const s = result.summary;
        $("drv-summary").innerHTML = [
            metricTile("Distance", fmt(s.distanceKm, 2), "km", "calc"),
            metricTile("Duration", fmtDuration(s.durationS / 3600), "", "calc"),
            metricTile("Average speed", fmt(s.averageSpeedKmh, 1), "km/h", "calc"),
            metricTile("Net energy used", fmt(s.netEnergyWh, 0), "Wh", "calc"),
            metricTile("Energy use", fmt(s.consumptionWhPerKm, 1), "Wh/km", "calc"),
            metricTile("Peak battery power", fmt(s.peakPowerKW, 2), "kW", "calc"),
            metricTile("Energy recovered", fmt(s.regenRecoveredWh, 1), "Wh", "calc"),
            metricTile("Final state of charge", fmt(s.finalSocPercent, 1), "%", "calc"),
            metricTile("Range at this energy use", fmt(s.estimatedRangeKm, 1), "km", "calc")
        ].join("");

        drawDriveCharts(result.series, { speed: "chart-drv-speed", power: "chart-drv-power", current: "chart-drv-current", soc: "chart-drv-soc" });
    }

    function exportDriveCsv() {
        if (!state.last.drive) { runDrive(); }
        const r = state.last.drive;
        if (!r) { return; }
        const s = r.series;
        const rows = ["time_s,speed_kmh,battery_power_kW,battery_current_A,soc_percent,net_energy_Wh,distance_km"];
        for (let i = 0; i < s.timeS.length; i++) {
            rows.push([s.timeS[i], s.speedKmh[i].toFixed(3), s.powerKW[i].toFixed(4), s.currentA[i].toFixed(3),
                s.socPercent[i].toFixed(4), s.energyWh[i].toFixed(3), s.distanceKm[i].toFixed(5)].join(","));
        }
        download("evx-drive-cycle.csv", rows.join("\n") + "\n");
    }

    /* ------------------------------------------------------------
       ENGINEERING: analytics
       ------------------------------------------------------------ */
    function runAnalytics() {
        const cfg = activeProfile().cfg;
        const speed = readNumber("ana-speed");
        const grade = Number.isNaN(readNumber("ana-grade")) ? 0 : readNumber("ana-grade");
        state.ana.speed = speed;
        state.ana.grade = grade;

        if (!Number.isFinite(speed) || speed <= 0 || speed > 400) {
            showMessages("ana-messages", ["Enter a speed between 1 and 400 km/h."]);
            return;
        }
        let result;
        try {
            result = M.sensitivity(cfg, { speedKmh: speed, gradePercent: grade });
        } catch (e) {
            showMessages("ana-messages", [e.message]);
            C.destroy("chart-ana-sens");
            return;
        }
        showMessages("ana-messages", []);

        C.bar("chart-ana-sens", {
            labels: result.rows.map((r) => r.label),
            datasets: [
                { label: "Parameter 10% lower", data: result.rows.map((r) => r.lowPercent), color: C.COLORS.teal },
                { label: "Parameter 10% higher", data: result.rows.map((r) => r.highPercent), color: C.COLORS.blue }
            ],
            horizontal: true, xTitle: "Change in energy use (%)"
        });
        setText("ana-sens-note", "Base energy use: " + fmt(result.baseConsumptionWhPerKm, 1) + " Wh/km at " + fmt(speed, 0) +
            " km/h, " + fmt(grade, 1) + "% gradient, configuration \"" + activeProfile().name + "\". Parameters set to zero are skipped.");
    }

    function runCompare() {
        const a = getProfile($("cmp-a").value);
        const b = getProfile($("cmp-b").value);
        state.ana.a = a.id;
        state.ana.b = b.id;
        const grade = Number.isNaN(readNumber("ana-grade")) ? 0 : readNumber("ana-grade");

        const topA = M.topSpeedKmh(a.cfg, grade);
        const topB = M.topSpeedKmh(b.cfg, grade);
        if (topA <= 0 || topB <= 0) {
            showMessages("cmp-messages", ["One of these configurations cannot move at a " + fmt(grade, 1) + "% gradient."]);
            $("cmp-results").hidden = true;
            return;
        }
        showMessages("cmp-messages", []);

        const common = Math.max(1, Math.round(Math.min(topA, topB) * 0.5));
        const opA = M.operatingPoint(a.cfg, { speedKmh: common, gradePercent: grade });
        const opB = M.operatingPoint(b.cfg, { speedKmh: common, gradePercent: grade });
        const rangeOf = (p, op) => M.rangeKm(M.usableRemainingWh(p.cfg, p.cfg.initialSocPercent), op.consumptionWhPerKm);

        const rows = [
            ["Total mass (kg)", fmt(M.totalMassKg(a.cfg), 0), fmt(M.totalMassKg(b.cfg), 0)],
            ["Battery energy (kWh)", fmt(M.nominalEnergyWh(a.cfg) / 1000, 1), fmt(M.nominalEnergyWh(b.cfg) / 1000, 1)],
            ["Motor peak power (kW)", fmt(a.cfg.motorPeakPowerKW, 1), fmt(b.cfg.motorPeakPowerKW, 1)],
            ["Modelled top speed (km/h)", fmt(topA, 0), fmt(topB, 0)],
            ["Compared at (km/h)", fmt(common, 0), fmt(common, 0)],
            ["Battery power (kW)", fmt(opA.terminalPowerW / 1000, 2), fmt(opB.terminalPowerW / 1000, 2)],
            ["Energy use (Wh/km)", fmt(opA.consumptionWhPerKm, 1), fmt(opB.consumptionWhPerKm, 1)],
            ["Overall efficiency (%)", fmt(opA.overallEfficiencyPercent, 1), fmt(opB.overallEfficiencyPercent, 1)],
            ["Range from initial charge (km)", fmt(rangeOf(a, opA), 0), fmt(rangeOf(b, opB), 0)]
        ];
        $("cmp-table").innerHTML = "<thead><tr><th scope=\"col\">Quantity</th><th scope=\"col\" class=\"num\">" + esc(a.name) +
            "</th><th scope=\"col\" class=\"num\">" + esc(b.name) + "</th></tr></thead><tbody>" +
            rows.map((r) => "<tr><th scope=\"row\">" + esc(r[0]) + "</th><td class=\"num\">" + r[1] + "</td><td class=\"num\">" + r[2] + "</td></tr>").join("") + "</tbody>";

        const sa = M.speedSweep(a.cfg, { gradePercent: grade }).points;
        const sb = M.speedSweep(b.cfg, { gradePercent: grade }).points;
        $("cmp-results").hidden = false;
        C.line("chart-cmp", {
            datasets: [
                { label: a.name, points: sa.map((p) => ({ x: p.speedKmh, y: p.consumptionWhPerKm })), color: C.COLORS.blue },
                { label: b.name, points: sb.map((p) => ({ x: p.speedKmh, y: p.consumptionWhPerKm })), color: C.COLORS.teal, dashed: true }
            ],
            xTitle: "Speed (km/h)", yTitle: "Energy use (Wh/km)", xMin: 0
        });
    }

    /* ------------------------------------------------------------
       ENGINEERING: report and exports
       ------------------------------------------------------------ */
    function exportSweepCsv() {
        const cfg = activeProfile().cfg;
        const grade = state.eng.grade || 0;
        const sw = M.speedSweep(cfg, { gradePercent: grade, points: 60 });
        if (!sw.points.length) {
            showMessages("rep-messages", ["No speed points are achievable with this configuration."]);
            return;
        }
        const rows = ["speed_kmh,wheel_power_kW,battery_power_kW,energy_use_Wh_per_km,overall_efficiency_percent,motor_efficiency_percent,battery_current_A,motor_rpm"];
        sw.points.forEach((p) => rows.push([p.speedKmh.toFixed(2), p.wheelPowerKW.toFixed(4), p.batteryPowerKW.toFixed(4),
            p.consumptionWhPerKm.toFixed(3), p.overallEfficiencyPercent.toFixed(3), p.motorEfficiencyPercent.toFixed(3),
            p.currentA.toFixed(3), p.rpm.toFixed(1)].join(",")));
        download("evx-speed-sweep.csv", rows.join("\n") + "\n");
        showMessages("rep-messages", ["Downloaded the speed sweep at " + fmt(grade, 1) + "% gradient."], "info");
    }

    function exportConfigJson() {
        const p = activeProfile();
        const payload = { evxVersion: M.VERSION, exportedAt: new Date().toISOString(), name: p.name, category: p.category, sample: p.isSample, config: p.cfg };
        download("evx-configuration.json", JSON.stringify(payload, null, 2) + "\n", "application/json");
    }

    function formatFieldValue(f, v) {
        if (f.type === "select") { return f.optionLabels ? f.optionLabels[v] : v; }
        return fmt(v, v >= 100 ? 0 : (v < 0.1 ? 4 : 2)).replace(/\.00$/, "") + (f.unit ? " " + f.unit : "");
    }

    function generateReport() {
        const p = activeProfile();
        const cfg = p.cfg;
        const e = state.eng;

        readEngInputs();
        let op;
        try {
            op = M.operatingPoint(cfg, { speedKmh: e.speed, gradePercent: e.grade });
        } catch (err) {
            showMessages("rep-messages", ["The operating point on the Operating point tab is not achievable: " + err.message + " Fix it there, then generate the report."]);
            return;
        }
        showMessages("rep-messages", []);

        const remainingWh = M.usableRemainingWh(cfg, e.soc);
        const groups = {};
        M.FIELDS.forEach((f) => { (groups[f.group] = groups[f.group] || []).push(f); });
        const configRows = Object.keys(groups).map((g) =>
            '<tr class="group-row"><th colspan="2" scope="colgroup">' + esc(g) + "</th></tr>" +
            groups[g].map((f) => "<tr><td>" + esc(f.label) + '</td><td class="num">' + esc(formatFieldValue(f, cfg[f.key])) + "</td></tr>").join("")).join("");

        const resultRows = [
            ["Vehicle speed", fmt(e.speed, 0) + " km/h"], ["Road gradient", fmt(e.grade, 1) + " %"], ["State of charge", fmt(e.soc, 0) + " %"],
            ["Wheel power", fmt(op.wheelPowerW / 1000, 2) + " kW"], ["Motor shaft power", fmt(op.shaftPowerW / 1000, 2) + " kW"],
            ["Motor speed", fmt(op.rpm, 0) + " rpm"], ["Motor torque", fmt(op.torqueNm, 1) + " N·m"],
            ["Motor efficiency", fmt(op.motorEfficiency * 100, 1) + " %"], ["Battery terminal voltage", fmt(op.terminalVoltageV, 1) + " V"],
            ["Battery current", fmt(op.currentA, 1) + " A"], ["Battery power", fmt(op.terminalPowerW / 1000, 2) + " kW"],
            ["Overall efficiency", fmt(op.overallEfficiencyPercent, 1) + " %"], ["Energy use", fmt(op.consumptionWhPerKm, 1) + " Wh/km"],
            ["Usable energy remaining", fmt(remainingWh / 1000, 2) + " kWh"], ["Estimated range", fmt(M.rangeKm(remainingWh, op.consumptionWhPerKm), 1) + " km"],
            ["Modelled top speed", fmt(M.topSpeedKmh(cfg, e.grade), 0) + " km/h"]
        ].map((r) => "<tr><td>" + r[0] + '</td><td class="num">' + r[1] + "</td></tr>").join("");

        let driveBlock = "";
        const dr = state.last.drive;
        if (dr) {
            const s = dr.summary;
            driveBlock = "<h2>Drive-cycle result</h2><p>Configuration: " + esc(state.last.driveCfgName) + ". Starting charge " + fmt(s.startSocPercent, 0) + "%.</p>" +
                '<table class="data-table compact"><tbody>' + [
                    ["Distance", fmt(s.distanceKm, 2) + " km"], ["Duration", fmtDuration(s.durationS / 3600)], ["Average speed", fmt(s.averageSpeedKmh, 1) + " km/h"],
                    ["Net energy used", fmt(s.netEnergyWh, 0) + " Wh"], ["Energy use", fmt(s.consumptionWhPerKm, 1) + " Wh/km"],
                    ["Peak battery power", fmt(s.peakPowerKW, 2) + " kW"], ["Energy recovered by regeneration", fmt(s.regenRecoveredWh, 1) + " Wh"],
                    ["Final state of charge", fmt(s.finalSocPercent, 1) + " %"]
                ].map((r) => "<tr><td>" + r[0] + '</td><td class="num">' + r[1] + "</td></tr>").join("") + "</tbody></table>" +
                (dr.warnings.length ? "<p><strong>Warnings:</strong> " + dr.warnings.map(esc).join(" ") + "</p>" : "") +
                '<div class="chart-box short"><canvas id="chart-rep-soc" aria-label="State of charge over the drive cycle" role="img"></canvas></div>';
        }

        const sheet = $("rep-sheet");
        sheet.hidden = false;
        sheet.innerHTML =
            '<header class="report-head"><h1>EVX engineering report</h1>' +
            "<p>Platform version " + esc(M.VERSION) + ". Generated " + esc(new Date().toLocaleString()) + ".</p>" +
            "<p>Configuration: <strong>" + esc(p.name) + "</strong> (" + (p.isSample ? "generic sample values, not a real vehicle" : "saved by the user") + ")</p></header>" +
            "<h2>Model and assumptions</h2><p>Model level: simplified engineering model, steady-state operating point with an optional time-stepped drive cycle. " +
            "Constant battery EMF, constant drivetrain and controller efficiency, loss-based motor model, no temperature, wind or ageing effects. " +
            "Results are estimates and have not been validated against measured vehicle data.</p>" +
            "<h2>Vehicle configuration</h2><table class=\"data-table compact\"><tbody>" + configRows + "</tbody></table>" +
            "<h2>Operating point results</h2><table class=\"data-table compact\"><tbody>" + resultRows + "</tbody></table>" +
            '<div class="report-charts"><div class="chart-box short"><canvas id="chart-rep-flow" aria-label="Power flow" role="img"></canvas></div>' +
            '<div class="chart-box short"><canvas id="chart-rep-cons" aria-label="Energy use versus speed" role="img"></canvas></div></div>' +
            driveBlock +
            "<h2>Limitations</h2><p>EVX is an estimation tool and not a battery management or safety system. Actual range depends on vehicle design, weather, road, load, battery condition, driving style and control software.</p>";

        drawFlowChart("chart-rep-flow", op);
        drawSweepCharts(cfg, e.grade, op, { cons: "chart-rep-cons" });
        if (dr) { drawDriveCharts(dr.series, { soc: "chart-rep-soc" }); }

        $("rep-print").disabled = false;
        sheet.scrollIntoView({ behavior: "auto", block: "start" });
    }

    function printReport() {
        document.body.classList.add("print-report");
        const cleanup = () => { document.body.classList.remove("print-report"); window.removeEventListener("afterprint", cleanup); };
        window.addEventListener("afterprint", cleanup);
        window.print();
    }

    /* ------------------------------------------------------------
       Engineering bindings
       ------------------------------------------------------------ */
    function bindEngineering() {
        const rerun = debounce(() => { readEngInputs(); renderOverview(); }, 120);
        ["eng-speed", "eng-grade", "eng-soc"].forEach((id) => $(id).addEventListener("input", () => { setSimState("ready", "Ready"); rerun(); }));
        $("eng-run").addEventListener("click", () => {
            setSimState("running", "Running");
            setTimeout(() => { readEngInputs(); renderOverview(); }, 150);
        });

        $("drv-preset").addEventListener("change", toggleDrivePreset);
        $("drv-run").addEventListener("click", runDrive);
        $("drv-export").addEventListener("click", exportDriveCsv);

        $("ana-run").addEventListener("click", () => { runAnalytics(); runCompare(); });
        $("cmp-run").addEventListener("click", runCompare);

        $("rep-generate").addEventListener("click", generateReport);
        $("rep-print").addEventListener("click", printReport);
        $("rep-csv-sweep").addEventListener("click", exportSweepCsv);
        $("rep-json").addEventListener("click", exportConfigJson);
    }

    /* ------------------------------------------------------------
       Start
       ------------------------------------------------------------ */
    function init() {
        setText("version-label", "version " + M.VERSION);

        loadProfiles();
        loadSimpleState();
        defaultEngInputs();

        const drv = S.get("drive", null);
        if (drv && typeof drv === "object") {
            if (["urban", "mixed", "highway", "custom"].includes(drv.preset)) { state.drive.preset = drv.preset; }
            if (Number.isFinite(drv.repeats)) { state.drive.repeats = drv.repeats; }
            if (Number.isFinite(drv.grade)) { state.drive.grade = drv.grade; }
            if (typeof drv.custom === "string") { state.drive.custom = drv.custom; }
            state.drive.regen = Boolean(drv.regen);
        }

        loadDraft();
        refreshProfileSelects();
        bindSimple();
        bindVehicle();
        bindEngineering();
        pushSimpleToDom();
        pushEngInputs();

        window.addEventListener("hashchange", applyRoute);
        applyRoute();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

}());
