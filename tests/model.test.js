/* EVX model tests.  Run from the project folder:  node tests/model.test.js
   Hand calculations are written next to each check so they can be
   verified on paper. */
const assert = require("assert");
const M = require("../js/model.js");
const P = require("../js/profiles.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log("  ok    " + name); }
    catch (e) { failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
const near = (a, b, tol, msg) =>
    assert.ok(Math.abs(a - b) <= tol, (msg || "value") + ": expected " + b + " +/- " + tol + ", got " + a);

const scooter = P.SAMPLE_PROFILES[0].cfg;
const flatScooter = Object.assign({}, scooter, { motorModel: "flat" });

console.log("\nRoad load");
// v = 62/3.6 = 17.222 m/s; mass = 170 kg
// F_roll = 0.012*170*9.81 = 20.01 N ; F_aero = 0.5*1.2*0.9*0.6*17.222^2 = 96.10 N
test("forces and wheel power at 62 km/h", () => {
    const r = M.roadLoad(scooter, 62);
    near(r.rollingForceN, 20.01, 0.05, "rolling");
    near(r.aerodynamicForceN, 96.10, 0.1, "aero");
    near(r.wheelPowerW, 1999.7, 1.5, "wheel power");
});
test("5% gradient adds m*g*sin(atan 0.05)", () => {
    const r = M.roadLoad(scooter, 30, { gradePercent: 5 });
    near(r.gradeForceN, 170 * 9.81 * Math.sin(Math.atan(0.05)), 0.01);
});
test("acceleration adds m*k*a (170 kg, k=1.05, a=1 m/s^2 -> 178.5 N)", () => {
    const r = M.roadLoad(scooter, 30, { accelMps2: 1 });
    near(r.inertiaForceN, 178.5, 0.01);
});
test("motor rpm at 62 km/h is about 3150", () => near(M.motorRPM(scooter, 62), 3150, 1));

console.log("\nMotor model");
test("loss model returns the rated efficiency at the rated point", () => {
    const rated = scooter.motorRatedPowerKW * 1000;
    const m = M.motorMotoring(scooter, rated, scooter.motorRatedRPM);
    near(m.efficiency * 100, scooter.motorRatedEfficiencyPercent, 0.01, "efficiency");
});
test("efficiency drops at light load (iron + friction dominate)", () => {
    const rated = scooter.motorRatedPowerKW * 1000;
    const light = M.motorMotoring(scooter, rated * 0.05, scooter.motorRatedRPM).efficiency;
    assert.ok(light < 0.80, "light-load efficiency " + light);
});
test("generating output is below mechanical input", () => {
    assert.ok(M.motorGenerating(scooter, 1000, 3000) < 1000);
});

console.log("\nBattery");
test("terminal power = Vt*I and chemical power = terminal + I^2R", () => {
    const b = M.batteryCurrent(60, 0.04, 2400);
    near(b.terminalVoltageV * b.currentA, 2400, 0.01);
    near(b.chemicalPowerW, 2400 + b.resistiveLossW, 0.01);
    assert.ok(b.terminalVoltageV < 60);
});
test("tiny resistance gives I = P/V", () => near(M.batteryCurrent(60, 1e-9, 3000).currentA, 50, 0.01));
test("negative power (regeneration) gives negative current", () => assert.ok(M.batteryCurrent(60, 0.04, -500).currentA < 0));
test("impossible demand throws, or is clamped when requested", () => {
    assert.throws(() => M.batteryCurrent(60, 0.04, 25000), /cannot deliver/);
    assert.ok(M.batteryCurrent(60, 0.04, 25000, { clamp: true }).limited);
});

console.log("\nOperating point");
test("power chain is ordered wheel < shaft < motor input < terminal < chemical", () => {
    const o = M.operatingPoint(scooter, { speedKmh: 62 });
    assert.ok(o.wheelPowerW < o.shaftPowerW && o.shaftPowerW < o.motorInputW && o.motorInputW < o.terminalPowerW && o.terminalPowerW < o.chemicalPowerW);
});
test("flat-efficiency chain matches hand calculation at 62 km/h", () => {
    // shaft = 1999.7/0.95; motor in = shaft/0.91; terminal = /0.97 + 50
    const o = M.operatingPoint(flatScooter, { speedKmh: 62 });
    near(o.terminalPowerW, 1999.7 / 0.95 / 0.91 / 0.97 + 50, 1);
});
test("power-flow items add up to chemical power", () => {
    const o = M.operatingPoint(scooter, { speedKmh: 50 });
    const sum = M.powerFlow(o).reduce((a, x) => a + x.watts, 0);
    near(sum, o.chemicalPowerW, 0.5);
});
test("consumption rises with speed", () => {
    const w = [20, 40, 60].map((s) => M.operatingPoint(scooter, { speedKmh: s }).consumptionWhPerKm);
    assert.ok(w[0] < w[1] && w[1] < w[2]);
});
test("mass, gradient, payload and weaker efficiency all raise consumption", () => {
    const base = M.operatingPoint(scooter, { speedKmh: 40 }).consumptionWhPerKm;
    assert.ok(M.operatingPoint(Object.assign({}, scooter, { massKg: 160 }), { speedKmh: 40 }).consumptionWhPerKm > base);
    assert.ok(M.operatingPoint(scooter, { speedKmh: 40, gradePercent: 4 }).consumptionWhPerKm > base);
    assert.ok(M.operatingPoint(Object.assign({}, scooter, { payloadKg: 140 }), { speedKmh: 40 }).consumptionWhPerKm > base);
    assert.ok(M.operatingPoint(Object.assign({}, scooter, { drivetrainEfficiencyPercent: 85 }), { speedKmh: 40 }).consumptionWhPerKm > base);
});
test("speed above the motor limit throws a clear error", () => {
    assert.throws(() => M.operatingPoint(scooter, { speedKmh: 120 }), /Motor limit|rpm/);
});
test("invalid speed is rejected", () => {
    assert.throws(() => M.operatingPoint(scooter, { speedKmh: 0 }), /greater than 0/);
    assert.throws(() => M.operatingPoint(scooter, { speedKmh: NaN }), /greater than 0/);
});
test("top speed is feasible and just above it is not", () => {
    const top = M.topSpeedKmh(scooter, 0);
    assert.ok(top > 60 && top < 100, "top " + top);
    M.operatingPoint(scooter, { speedKmh: top * 0.999 });
    assert.throws(() => M.operatingPoint(scooter, { speedKmh: top * 1.02 }));
});
test("range = usable energy / consumption (reserve excluded)", () => {
    // (78-5)% of 3000 Wh = 2190 Wh ; /40 = 54.75 km
    near(M.usableRemainingWh(scooter, 78), 2190, 1e-9);
    near(M.rangeKm(2190, 40), 54.75, 1e-9);
});

console.log("\nSample profiles");
P.SAMPLE_PROFILES.forEach((p) => {
    test(p.name + " is valid and gives a plausible consumption", () => {
        const v = M.validateConfig(p.cfg);
        assert.ok(v.valid, v.errors.join("; "));
        const top = M.topSpeedKmh(p.cfg, 0);
        const op = M.operatingPoint(p.cfg, { speedKmh: top * 0.5 });
        assert.ok(op.consumptionWhPerKm > 5 && op.consumptionWhPerKm < 600);
        assert.ok(op.terminalVoltageV < p.cfg.batteryVoltageV);
    });
});

console.log("\nValidation");
test("out-of-range and missing values are reported", () => {
    const bad = Object.assign({}, scooter, { massKg: -5, gearRatio: "x" });
    const v = M.validateConfig(bad);
    assert.ok(!v.valid && v.errors.length >= 2);
});
test("cross checks: peak < rated, reserve >= initial SOC", () => {
    assert.ok(!M.validateConfig(Object.assign({}, scooter, { motorPeakPowerKW: 1 })).valid);
    assert.ok(!M.validateConfig(Object.assign({}, scooter, { reserveSocPercent: 80 })).valid);
});

console.log("\nCharging, trip and cost");
test("charging: 20% to 80% of 3000 Wh at 1 kW, 90% efficient, no taper", () => {
    // battery energy = 0.6*3000 = 1800 Wh ; battery power = 900 W ; time = 2.0 h ; grid = 2000 Wh
    const c = M.chargingEstimate({ capacityWh: 3000, startSocPercent: 20, targetSocPercent: 80, chargerKW: 1, efficiencyPercent: 90, taper: false });
    near(c.batteryEnergyWh, 1800, 1e-6);
    near(c.gridEnergyWh, 2000, 1e-6);
    near(c.hours, 2.0, 0.01);
});
test("charging: taper makes 80% to 100% slower than the no-taper time", () => {
    const base = { capacityWh: 3000, startSocPercent: 80, targetSocPercent: 100, chargerKW: 1, efficiencyPercent: 90 };
    assert.ok(M.chargingEstimate(Object.assign({ taper: true }, base)).hours > M.chargingEstimate(Object.assign({ taper: false }, base)).hours);
});
test("charging: invalid inputs are rejected", () => {
    assert.throws(() => M.chargingEstimate({ capacityWh: 3000, startSocPercent: 80, targetSocPercent: 50, chargerKW: 1 }), /Target SOC/);
    assert.throws(() => M.chargingEstimate({ capacityWh: 3000, startSocPercent: 10, targetSocPercent: 50, chargerKW: 0 }), /Charger power/);
});
test("trip: 30 km at 40 Wh/km from 78% on 3000 Wh", () => {
    // trip = 1200 Wh ; usable = (78-5)% = 2190 Wh ; end SOC = 78 - 40 = 38%
    const t = M.tripEstimate({ distanceKm: 30, startSocPercent: 78, consumptionWhPerKm: 40, nominalEnergyWh: 3000, reserveSocPercent: 5 });
    near(t.tripEnergyWh, 1200, 1e-9);
    near(t.endSocPercent, 38, 1e-9);
    assert.ok(t.sufficient);
    near(t.marginWh, 990, 1e-9);
});
test("trip: too long is flagged, climbing adds energy", () => {
    const base = { startSocPercent: 78, consumptionWhPerKm: 40, nominalEnergyWh: 3000, reserveSocPercent: 5 };
    assert.ok(!M.tripEstimate(Object.assign({ distanceKm: 80 }, base)).sufficient);
    const climb = M.tripEstimate(Object.assign({ distanceKm: 10, elevationGainM: 100, massKg: 170, chainEfficiency: 0.8 }, base));
    // 170*9.81*100/0.8/3600 = 57.9 Wh
    near(climb.climbEnergyWh, 57.9, 0.1);
});
test("cost: 2 kWh at 8 per kWh and 40 Wh/km at 90% charging efficiency", () => {
    const c = M.costEstimate({ tariffPerKWh: 8, gridEnergyKWh: 2, consumptionWhPerKm: 40, efficiencyPercent: 90, tripKm: 30, monthlyKm: 600 });
    near(c.chargeCost, 16, 1e-9);
    near(c.gridKWhPerKm, 0.04444, 1e-4);
    near(c.costPerKm, 0.35556, 1e-3);
    near(c.monthlyCost, 213.33, 0.01);
});

console.log("\nDrive cycle");
test("constant 40 km/h for 600 s: distance and energy match steady state", () => {
    const speeds = [0];
    for (let i = 0; i < 40; i++) { speeds.push(Math.min(40, (i + 1) * 3.6)); }
    for (let i = 0; i < 600; i++) { speeds.push(40); }
    const r = M.driveCycle(scooter, speeds, { socPercent: 78 });
    const steady = M.operatingPoint(scooter, { speedKmh: 40 }).consumptionWhPerKm;
    assert.ok(r.summary.distanceKm > 6 && r.summary.distanceKm < 7.5, "distance " + r.summary.distanceKm);
    // acceleration adds a little energy so it is slightly above steady state
    assert.ok(r.summary.consumptionWhPerKm > steady * 0.98 && r.summary.consumptionWhPerKm < steady * 1.25, "cons " + r.summary.consumptionWhPerKm + " vs " + steady);
});
test("SOC falls by (net energy / nominal energy) within coulomb-counting tolerance", () => {
    const r = M.driveCycle(scooter, M.buildSpeedProfile("urban", 40, 3), { socPercent: 78 });
    const drop = r.summary.startSocPercent - r.summary.finalSocPercent;
    near(drop, 100 * r.summary.netEnergyWh / M.nominalEnergyWh(scooter), 0.01, "SOC drop");
});
test("regeneration recovers energy and lowers net consumption", () => {
    const speeds = M.buildSpeedProfile("urban", 45, 4);
    const off = M.driveCycle(scooter, speeds, {});
    const on = M.driveCycle(scooter, speeds, { regen: true });
    assert.ok(on.summary.regenRecoveredWh > 0);
    assert.ok(on.summary.netEnergyWh < off.summary.netEnergyWh);
    // recovered energy cannot exceed the kinetic + potential energy removed (sanity bound: 60% of 1/2 m v^2 per stop)
    const v = 45 / 3.6;
    const boundWh = 4 * 0.5 * 170 * 1.05 * v * v / 3600;
    assert.ok(on.summary.regenRecoveredWh < boundWh, "recovered " + on.summary.regenRecoveredWh + " bound " + boundWh);
});
test("an impossible profile is capped and warned about", () => {
    const r = M.driveCycle(scooter, [0, 30, 60, 90, 120, 150, 150, 150], {});
    assert.ok(r.summary.limitedSeconds > 0 && r.warnings.length > 0);
});
test("a nearly empty battery is reported as depleted", () => {
    const small = Object.assign({}, scooter, { initialSocPercent: 6, reserveSocPercent: 1 });
    const r = M.driveCycle(small, M.buildSpeedProfile("highway", 60, 3), { socPercent: 6 });
    assert.ok(r.warnings.some((w) => /0%|reserve/.test(w)));
});

console.log("\nSpeed profiles");
test("presets start and end at 0 km/h", () => {
    ["urban", "mixed", "highway"].forEach((k) => {
        const s = M.buildSpeedProfile(k, 50, 1);
        assert.strictEqual(s[0], 0);
        assert.strictEqual(s[s.length - 1], 0);
        assert.ok(Math.max(...s) <= 50 + 1e-9);
    });
});
test("pasted profiles: single column, time/speed pairs, bad input", () => {
    assert.strictEqual(M.parseSpeedProfile("0\n10\n20\n30").length, 4);
    const r = M.parseSpeedProfile("time,speed\n0,0\n10,36\n20,36");
    assert.strictEqual(r.length, 21);
    near(r[5], 18, 1e-9);
    assert.throws(() => M.parseSpeedProfile("0\nabc"), /not a number/);
    assert.throws(() => M.parseSpeedProfile("0\n-5"), /negative/);
    assert.throws(() => M.parseSpeedProfile("5"), /at least two/);
});

console.log("\nSensitivity and helpers");
test("sensitivity: more drag raises consumption, and results are sorted by size", () => {
    const s = M.sensitivity(scooter, { speedKmh: 50 });
    const drag = s.rows.find((r) => r.key === "dragCoefficient");
    assert.ok(drag.highPercent > 0 && drag.lowPercent < 0);
    for (let i = 1; i < s.rows.length; i++) { assert.ok(s.rows[i - 1].span >= s.rows[i].span); }
});
test("scenario ranges: heavy < light, uphill < flat, higher speed < low speed", () => {
    const r = Object.fromEntries(M.scenarioRanges(scooter, 78, { heavyPayloadKg: 140 }).map((x) => [x.id, x.rangeKm]));
    assert.ok(r.heavy < r.light && r.uphill < r.moderate && r.high < r.low);
});
test("battery rescale: doubling voltage at the same Ah doubles pack resistance", () => {
    near(M.rescaleBattery(scooter, 120, 50).batteryInternalResistanceOhm, 0.08, 1e-9);
});

console.log("\n" + passed + " passed, " + failed + " failed\n");
if (failed) { process.exit(1); }
