/* =====================================================================
   EVX calculation engine  (js/model.js)

   All vehicle physics, charging, cost and simulation maths live here.
   There is NO page (DOM) code in this file, so the same engine serves
   Simple Mode, Engineering Mode and the automated tests (Node).

   Internal units: SI (m, s, kg, N, W, J, rad/s). Conversions happen
   only at the input/output edges (km/h, Wh, kWh, rpm, %).

   Model maturity: "Simplified engineering model" (steady-state and
   time-stepped, constant battery EMF, loss-based motor model).
   Outputs are estimates and are NOT validated against measured data.
   ===================================================================== */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.EVXModel = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    "use strict";

    const VERSION = "1.0.0";
    const GRAVITY = 9.81;          // m/s^2
    const TWO_PI = 2 * Math.PI;

    /* Share of motor loss assigned to each mechanism at the rated point.
       Simplified assumption (documented in the Model page). */
    const LOSS_SPLIT = Object.freeze({ copper: 0.65, iron: 0.22, friction: 0.13 });

    /* ---------------------------------------------------------------
       Parameter schema. The UI builds the vehicle form from this list
       and validateConfig() checks every value against it.
       --------------------------------------------------------------- */
    const FIELDS = Object.freeze([
        // Vehicle
        { key: "massKg", group: "Vehicle", label: "Vehicle mass (without payload)", unit: "kg", min: 20, max: 50000, step: 1, help: "Kerb mass including the battery." },
        { key: "payloadKg", group: "Vehicle", label: "Payload (rider, passengers, cargo)", unit: "kg", min: 0, max: 20000, step: 1 },
        { key: "rollingResistance", group: "Vehicle", label: "Rolling resistance coefficient", unit: "", min: 0.003, max: 0.05, step: 0.001, help: "Typical road tyres: 0.008 to 0.015." },
        { key: "dragCoefficient", group: "Vehicle", label: "Aerodynamic drag coefficient (Cd)", unit: "", min: 0.1, max: 1.5, step: 0.01 },
        { key: "frontalAreaM2", group: "Vehicle", label: "Frontal area", unit: "m²", min: 0.2, max: 12, step: 0.01 },
        { key: "airDensity", group: "Vehicle", label: "Air density", unit: "kg/m³", min: 0.9, max: 1.4, step: 0.01, help: "1.20 at about 20 °C at sea level." },
        { key: "rotationalMassFactor", group: "Vehicle", label: "Rotating mass factor", unit: "", min: 1, max: 1.3, step: 0.01, help: "Adds the effect of wheel and motor inertia during acceleration." },
        // Drivetrain
        { key: "wheelRadiusM", group: "Drivetrain", label: "Wheel radius", unit: "m", min: 0.1, max: 0.6, step: 0.005 },
        { key: "gearRatio", group: "Drivetrain", label: "Overall gear ratio (motor : wheel)", unit: "", min: 1, max: 30, step: 0.01 },
        { key: "drivetrainEfficiencyPercent", group: "Drivetrain", label: "Drivetrain efficiency", unit: "%", min: 80, max: 100, step: 0.5 },
        { key: "controllerEfficiencyPercent", group: "Drivetrain", label: "Controller / inverter efficiency", unit: "%", min: 80, max: 100, step: 0.5 },
        { key: "auxiliaryPowerW", group: "Drivetrain", label: "Auxiliary electrical load", unit: "W", min: 0, max: 5000, step: 5, help: "Lights, display, controller electronics, cooling." },
        // Motor
        { key: "motorType", group: "Motor", label: "Motor type", type: "select", options: ["BLDC", "PMSM"], help: "Both use the same simplified loss model in this version." },
        { key: "motorModel", group: "Motor", label: "Efficiency model", type: "select", options: ["loss", "flat"], optionLabels: { loss: "Loss model (varies with load)", flat: "Flat efficiency" } },
        { key: "motorRatedPowerKW", group: "Motor", label: "Rated power", unit: "kW", min: 0.1, max: 500, step: 0.1 },
        { key: "motorPeakPowerKW", group: "Motor", label: "Peak power", unit: "kW", min: 0.1, max: 800, step: 0.1 },
        { key: "motorRatedRPM", group: "Motor", label: "Rated (base) speed", unit: "rpm", min: 200, max: 20000, step: 10 },
        { key: "motorMaxRPM", group: "Motor", label: "Maximum speed", unit: "rpm", min: 500, max: 25000, step: 10 },
        { key: "motorRatedEfficiencyPercent", group: "Motor", label: "Efficiency at rated point", unit: "%", min: 50, max: 99, step: 0.5 },
        // Battery
        { key: "batteryChemistry", group: "Battery", label: "Battery chemistry (information only)", type: "select", options: ["Li-ion NMC", "Li-ion LFP", "Lead-acid", "Unknown"] },
        { key: "batteryVoltageV", group: "Battery", label: "Nominal voltage", unit: "V", min: 12, max: 1000, step: 0.1 },
        { key: "batteryCapacityAh", group: "Battery", label: "Capacity", unit: "Ah", min: 1, max: 1000, step: 0.1 },
        { key: "batteryInternalResistanceOhm", group: "Battery", label: "Pack internal resistance", unit: "Ω", min: 0.0005, max: 2, step: 0.0005, help: "Causes voltage sag and heat loss under load." },
        { key: "initialSocPercent", group: "Battery", label: "Initial state of charge", unit: "%", min: 1, max: 100, step: 1 },
        { key: "reserveSocPercent", group: "Battery", label: "Reserve SOC (not counted as usable)", unit: "%", min: 0, max: 50, step: 1 },
        // Regeneration
        { key: "regenEnabled", group: "Regeneration", label: "Regenerative braking", type: "select", options: ["off", "on"], optionLabels: { off: "Off", on: "On" } },
        { key: "regenSharePercent", group: "Regeneration", label: "Share of braking done by the motor", unit: "%", min: 0, max: 100, step: 1 },
        { key: "regenMaxPowerKW", group: "Regeneration", label: "Maximum regeneration power", unit: "kW", min: 0, max: 300, step: 0.1 }
    ]);

    const FIELD_MAP = Object.freeze(FIELDS.reduce((m, f) => { m[f.key] = f; return m; }, {}));

    /* ---------------------------------------------------------------
       Validation
       --------------------------------------------------------------- */
    function validateConfig(cfg) {

        const errors = [];
        const warnings = [];

        FIELDS.forEach((f) => {
            const v = cfg[f.key];
            if (f.type === "select") {
                if (!f.options.includes(v)) {
                    errors.push(f.label + ": choose one of the listed options.");
                }
                return;
            }
            if (typeof v !== "number" || !Number.isFinite(v)) {
                errors.push(f.label + ": enter a number.");
            } else if (v < f.min || v > f.max) {
                errors.push(f.label + ": must be between " + f.min + " and " + f.max + (f.unit ? " " + f.unit : "") + ".");
            }
        });

        if (errors.length === 0) {
            if (cfg.motorPeakPowerKW < cfg.motorRatedPowerKW) {
                errors.push("Peak power must be equal to or higher than rated power.");
            }
            if (cfg.motorRatedRPM > cfg.motorMaxRPM) {
                errors.push("Rated speed cannot be higher than maximum speed.");
            }
            if (cfg.reserveSocPercent >= cfg.initialSocPercent) {
                errors.push("Reserve SOC must be lower than the initial SOC.");
            }
        }

        if (errors.length === 0) {
            const top = topSpeedKmh(cfg, 0);
            if (top < 15) {
                warnings.push("With these inputs the vehicle can only reach about " + top.toFixed(0) +
                    " km/h. Check motor power, gear ratio and wheel radius.");
            }
            if (cfg.motorRatedEfficiencyPercent > 96) {
                warnings.push("Motor efficiency above 96% at the rated point is optimistic.");
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /* ---------------------------------------------------------------
       Small helpers
       --------------------------------------------------------------- */
    const kmhToMps = (kmh) => kmh / 3.6;
    const mpsToKmh = (mps) => mps * 3.6;
    const rpmToRadS = (rpm) => rpm * TWO_PI / 60;

    function totalMassKg(cfg) { return cfg.massKg + cfg.payloadKg; }
    function nominalEnergyWh(cfg) { return cfg.batteryVoltageV * cfg.batteryCapacityAh; }

    /** Energy above the reserve that can be used for driving. */
    function usableRemainingWh(cfg, socPercent) {
        return Math.max(0, socPercent - cfg.reserveSocPercent) / 100 * nominalEnergyWh(cfg);
    }

    function motorRPM(cfg, speedKmh) {
        return kmhToMps(speedKmh) / cfg.wheelRadiusM * cfg.gearRatio * 60 / TWO_PI;
    }

    /* ---------------------------------------------------------------
       Road load:  F = F_roll + F_aero + F_grade + F_inertia
       --------------------------------------------------------------- */
    function roadLoad(cfg, speedKmh, opts) {

        const o = Object.assign({ gradePercent: 0, accelMps2: 0 }, opts);
        const v = kmhToMps(speedKmh);
        const m = totalMassKg(cfg);
        const theta = Math.atan(o.gradePercent / 100);

        const rolling = v > 0 || o.accelMps2 !== 0
            ? cfg.rollingResistance * m * GRAVITY * Math.cos(theta) : 0;
        const aero = 0.5 * cfg.airDensity * cfg.dragCoefficient * cfg.frontalAreaM2 * v * v;
        const grade = m * GRAVITY * Math.sin(theta);
        const inertia = m * cfg.rotationalMassFactor * o.accelMps2;
        const total = rolling + aero + grade + inertia;

        return {
            speedMps: v,
            rollingForceN: rolling,
            aerodynamicForceN: aero,
            gradeForceN: grade,
            inertiaForceN: inertia,
            totalForceN: total,
            wheelPowerW: total * v
        };
    }

    /* ---------------------------------------------------------------
       Motor loss model (simplified, parameterized)

       P_loss = kc*T^2 + ki*w^1.5 + kf*w
         copper  ~ torque squared,  iron ~ speed^1.5,  friction ~ speed.
       Coefficients are set so that the total loss at the rated point
       equals P_rated * (1/eta_rated - 1), split by LOSS_SPLIT.
       --------------------------------------------------------------- */
    function motorCoefficients(cfg) {
        const wR = rpmToRadS(cfg.motorRatedRPM);
        const pR = cfg.motorRatedPowerKW * 1000;
        const tR = pR / wR;
        const etaR = cfg.motorRatedEfficiencyPercent / 100;
        const lossR = pR * (1 / etaR - 1);
        return {
            wR, tR, etaR,
            kc: LOSS_SPLIT.copper * lossR / (tR * tR),
            ki: LOSS_SPLIT.iron * lossR / Math.pow(wR, 1.5),
            kf: LOSS_SPLIT.friction * lossR / wR
        };
    }

    /** Motoring: electrical input needed for a given shaft output. */
    function motorMotoring(cfg, shaftW, rpm) {
        const c = motorCoefficients(cfg);
        const w = rpmToRadS(rpm);
        if (cfg.motorModel === "flat") {
            const input = shaftW / c.etaR;
            return { inputW: input, lossW: input - shaftW, efficiency: shaftW > 0 ? c.etaR : 0, torqueNm: w > 0 ? shaftW / w : 0 };
        }
        const torque = w > 0 ? shaftW / w : 0;
        const loss = c.kc * torque * torque + c.ki * Math.pow(w, 1.5) + c.kf * w;
        const input = shaftW + loss;
        return { inputW: input, lossW: loss, efficiency: shaftW > 0 ? shaftW / input : 0, torqueNm: torque };
    }

    /** Generating: electrical output for a given mechanical input. */
    function motorGenerating(cfg, mechW, rpm) {
        const c = motorCoefficients(cfg);
        const w = rpmToRadS(rpm);
        if (cfg.motorModel === "flat") {
            return Math.max(0, mechW * c.etaR);
        }
        const torque = w > 0 ? mechW / w : 0;
        const loss = c.kc * torque * torque + c.ki * Math.pow(w, 1.5) + c.kf * w;
        return Math.max(0, mechW - loss);
    }

    /* ---------------------------------------------------------------
       Battery:  V_t = E - I*R,  P_t = V_t * I
         => I = (E - sqrt(E^2 - 4*R*P_t)) / (2*R)
       Positive P_t = discharge, negative P_t = charging (regeneration).
       --------------------------------------------------------------- */
    function batteryCurrent(emfV, resistanceOhm, terminalPowerW, opts) {

        const clamp = opts && opts.clamp;
        const pMax = emfV * emfV / (4 * resistanceOhm);
        let p = terminalPowerW;
        let limited = false;

        if (p > pMax * 0.999) {
            if (!clamp) {
                throw new Error("The battery cannot deliver " + (p / 1000).toFixed(2) +
                    " kW. Its maximum is about " + (pMax / 1000).toFixed(2) +
                    " kW with this voltage and internal resistance.");
            }
            p = pMax * 0.999;
            limited = true;
        }

        const disc = emfV * emfV - 4 * resistanceOhm * p;
        const current = (emfV - Math.sqrt(disc)) / (2 * resistanceOhm);

        return {
            currentA: current,
            terminalVoltageV: emfV - current * resistanceOhm,
            resistiveLossW: current * current * resistanceOhm,
            chemicalPowerW: emfV * current,
            terminalPowerW: p,
            limited
        };
    }

    /* ---------------------------------------------------------------
       Powertrain: wheel power -> battery terminal power
       --------------------------------------------------------------- */
    function powertrain(cfg, wheelPowerW, speedKmh, opts) {

        const o = Object.assign({ clamp: false, regen: false }, opts);
        const rpm = motorRPM(cfg, speedKmh);
        const w = rpmToRadS(rpm);
        const nD = cfg.drivetrainEfficiencyPercent / 100;
        const nC = cfg.controllerEfficiencyPercent / 100;
        const aux = cfg.auxiliaryPowerW;

        const out = {
            rpm, wheelPowerW,
            shaftPowerW: 0, motorInputW: 0, motorLossW: 0, motorEfficiency: 0,
            torqueNm: 0, drivetrainLossW: 0, controllerLossW: 0,
            auxiliaryW: aux, regenElectricalW: 0,
            terminalPowerW: aux, limited: false, limitReason: ""
        };

        if (wheelPowerW > 0) {

            let shaft = wheelPowerW / nD;
            const baseW = rpmToRadS(cfg.motorRatedRPM);
            const available = cfg.motorPeakPowerKW * 1000 * Math.min(1, w / baseW);

            if (shaft > available + 1e-9) {
                out.limited = true;
                out.limitReason = "Motor limit: needs " + (shaft / 1000).toFixed(2) +
                    " kW at the shaft, but only " + (available / 1000).toFixed(2) +
                    " kW is available at " + Math.round(rpm) + " rpm.";
                if (!o.clamp) { throw new Error(out.limitReason); }
                shaft = available;
                out.wheelPowerW = shaft * nD;
            }

            if (rpm > cfg.motorMaxRPM) {
                out.limited = true;
                out.limitReason = "Motor speed would be " + Math.round(rpm) +
                    " rpm, above the " + Math.round(cfg.motorMaxRPM) + " rpm limit.";
                if (!o.clamp) { throw new Error(out.limitReason); }
            }

            const m = motorMotoring(cfg, shaft, rpm);
            const elec = m.inputW / nC;

            out.shaftPowerW = shaft;
            out.drivetrainLossW = shaft - out.wheelPowerW;
            out.motorInputW = m.inputW;
            out.motorLossW = m.lossW;
            out.motorEfficiency = m.efficiency;
            out.torqueNm = m.torqueNm;
            out.controllerLossW = elec - m.inputW;
            out.terminalPowerW = elec + aux;

        } else if (wheelPowerW < 0 && o.regen) {

            const share = cfg.regenSharePercent / 100;
            const mech = -wheelPowerW * share * nD;
            let elecOut = motorGenerating(cfg, mech, rpm) * nC;
            elecOut = Math.min(elecOut, cfg.regenMaxPowerKW * 1000);
            out.regenElectricalW = elecOut;
            out.terminalPowerW = aux - elecOut;
        }

        return out;
    }

    /* ---------------------------------------------------------------
       Steady-speed operating point (whole chain)
       --------------------------------------------------------------- */
    function operatingPoint(cfg, input) {

        const o = Object.assign({ gradePercent: 0, accelMps2: 0, clamp: false, regen: false }, input);

        if (!Number.isFinite(o.speedKmh) || o.speedKmh <= 0) {
            throw new Error("Vehicle speed must be greater than 0 km/h.");
        }

        const load = roadLoad(cfg, o.speedKmh, { gradePercent: o.gradePercent, accelMps2: o.accelMps2 });
        const pt = powertrain(cfg, load.wheelPowerW, o.speedKmh, { clamp: o.clamp, regen: o.regen });
        const bat = batteryCurrent(cfg.batteryVoltageV, cfg.batteryInternalResistanceOhm, pt.terminalPowerW, { clamp: o.clamp });

        return Object.assign({}, pt, {
            speedKmh: o.speedKmh,
            roadLoad: load,
            currentA: bat.currentA,
            terminalVoltageV: bat.terminalVoltageV,
            batteryLossW: bat.resistiveLossW,
            chemicalPowerW: bat.chemicalPowerW,
            terminalPowerW: bat.terminalPowerW,
            batteryLimited: bat.limited,
            consumptionWhPerKm: bat.chemicalPowerW / o.speedKmh,
            overallEfficiencyPercent: bat.chemicalPowerW > 0
                ? 100 * Math.max(0, pt.wheelPowerW) / bat.chemicalPowerW : 0
        });
    }

    /** Where the battery power goes (for the power-flow chart), in W. */
    function powerFlow(op) {
        return [
            { key: "wheel", label: "Useful power at the wheels", watts: Math.max(0, op.wheelPowerW) },
            { key: "drivetrain", label: "Drivetrain loss", watts: op.drivetrainLossW },
            { key: "motor", label: "Motor loss", watts: op.motorLossW },
            { key: "controller", label: "Controller loss", watts: op.controllerLossW },
            { key: "aux", label: "Auxiliary load", watts: op.auxiliaryW },
            { key: "battery", label: "Battery internal loss", watts: op.batteryLossW }
        ];
    }

    function isFeasible(cfg, speedKmh, gradePercent) {
        try {
            operatingPoint(cfg, { speedKmh, gradePercent });
            return true;
        } catch (e) {
            return false;
        }
    }

    /** Highest steady speed the configuration can hold (bisection). */
    function topSpeedKmh(cfg, gradePercent) {
        const g = gradePercent || 0;
        if (!isFeasible(cfg, 1, g)) { return 0; }
        let lo = 1;
        let hi = 400;
        if (isFeasible(cfg, hi, g)) { return hi; }
        for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (isFeasible(cfg, mid, g)) { lo = mid; } else { hi = mid; }
        }
        return lo;
    }

    /** Operating points from low speed to top speed. */
    function speedSweep(cfg, opts) {
        const o = Object.assign({ gradePercent: 0, points: 36 }, opts);
        const top = topSpeedKmh(cfg, o.gradePercent);
        const result = [];
        if (top <= 0) { return { topSpeedKmh: 0, points: result }; }
        const start = Math.max(2, top / o.points);
        for (let i = 0; i < o.points; i++) {
            const s = start + (top * 0.995 - start) * i / (o.points - 1);
            try {
                const op = operatingPoint(cfg, { speedKmh: s, gradePercent: o.gradePercent });
                result.push({
                    speedKmh: s,
                    wheelPowerKW: op.wheelPowerW / 1000,
                    batteryPowerKW: op.terminalPowerW / 1000,
                    consumptionWhPerKm: op.consumptionWhPerKm,
                    overallEfficiencyPercent: op.overallEfficiencyPercent,
                    motorEfficiencyPercent: op.motorEfficiency * 100,
                    currentA: op.currentA,
                    rpm: op.rpm
                });
            } catch (e) { /* skip points that are not achievable */ }
        }
        return { topSpeedKmh: top, points: result };
    }

    function rangeKm(remainingWh, consumptionWhPerKm) {
        if (!(consumptionWhPerKm > 0)) { throw new Error("Energy consumption must be greater than zero."); }
        return Math.max(0, remainingWh) / consumptionWhPerKm;
    }

    /* ---------------------------------------------------------------
       Range scenarios for Simple Mode. Definitions are fixed and
       shown to the user:
         low / moderate / higher speed = 30 / 50 / 70 % of the modelled
         top speed on a flat road; light load = no payload; heavy load
         = the profile's maximum payload; uphill = 3 % gradient at the
         moderate speed.
       --------------------------------------------------------------- */
    function scenarioRanges(cfg, socPercent, opts) {

        const o = Object.assign({ heavyPayloadKg: cfg.payloadKg * 2 }, opts);
        const top = topSpeedKmh(cfg, 0);
        const remaining = usableRemainingWh(cfg, socPercent);
        const moderate = top * 0.5;

        const defs = [
            { id: "low", label: "Low speed", detail: Math.round(top * 0.3) + " km/h, flat", cfg, speed: top * 0.3, grade: 0 },
            { id: "moderate", label: "Moderate speed", detail: Math.round(moderate) + " km/h, flat", cfg, speed: moderate, grade: 0 },
            { id: "high", label: "Higher speed", detail: Math.round(top * 0.7) + " km/h, flat", cfg, speed: top * 0.7, grade: 0 },
            { id: "light", label: "Light load", detail: "No payload, " + Math.round(moderate) + " km/h", cfg: Object.assign({}, cfg, { payloadKg: 0 }), speed: moderate, grade: 0 },
            { id: "heavy", label: "Heavy load", detail: Math.round(o.heavyPayloadKg) + " kg payload, " + Math.round(moderate) + " km/h", cfg: Object.assign({}, cfg, { payloadKg: o.heavyPayloadKg }), speed: moderate, grade: 0 },
            { id: "uphill", label: "Uphill (3% gradient)", detail: Math.round(moderate) + " km/h", cfg, speed: moderate, grade: 3 }
        ];

        return defs.map((d) => {
            try {
                const op = operatingPoint(d.cfg, { speedKmh: d.speed, gradePercent: d.grade });
                return {
                    id: d.id, label: d.label, detail: d.detail,
                    consumptionWhPerKm: op.consumptionWhPerKm,
                    rangeKm: rangeKm(remaining, op.consumptionWhPerKm)
                };
            } catch (e) {
                return { id: d.id, label: d.label, detail: d.detail, consumptionWhPerKm: NaN, rangeKm: NaN, note: e.message };
            }
        });
    }

    /* ---------------------------------------------------------------
       Trip energy (average-consumption method)
       Extra energy for climbing = m*g*h / chain efficiency; no energy
       is credited for descents.
       --------------------------------------------------------------- */
    function tripEstimate(p) {

        const needs = ["distanceKm", "startSocPercent", "consumptionWhPerKm", "nominalEnergyWh"];
        needs.forEach((k) => {
            if (!Number.isFinite(p[k]) || p[k] < 0) { throw new Error("Enter a valid value for " + k + "."); }
        });
        if (p.distanceKm <= 0) { throw new Error("Trip distance must be greater than 0 km."); }
        if (p.consumptionWhPerKm <= 0) { throw new Error("Energy consumption must be greater than zero."); }

        const reserve = p.reserveSocPercent || 0;
        const flatWh = p.distanceKm * p.consumptionWhPerKm;
        const chain = p.chainEfficiency > 0 ? p.chainEfficiency : 0.8;
        const climbWh = (p.elevationGainM > 0 && p.massKg > 0)
            ? p.massKg * GRAVITY * p.elevationGainM / chain / 3600 : 0;
        const tripWh = flatWh + climbWh;

        const usableWh = Math.max(0, p.startSocPercent - reserve) / 100 * p.nominalEnergyWh;
        const endSoc = p.startSocPercent - 100 * tripWh / p.nominalEnergyWh;

        return {
            tripEnergyWh: tripWh,
            climbEnergyWh: climbWh,
            usableEnergyWh: usableWh,
            endSocPercent: endSoc,
            sufficient: tripWh <= usableWh,
            marginWh: usableWh - tripWh,
            marginKm: (usableWh - tripWh) / p.consumptionWhPerKm,
            maxDistanceKm: usableWh / p.consumptionWhPerKm
        };
    }

    /* ---------------------------------------------------------------
       Charging (simplified)
       Battery-side power = charger power x efficiency, optionally
       tapered linearly above a start SOC (stand-in for the constant-
       voltage phase) and limited by a battery charge limit.
       --------------------------------------------------------------- */
    function chargingEstimate(p) {

        const o = Object.assign({
            efficiencyPercent: 90, taper: true, taperStartPercent: 80,
            taperMinFactor: 0.15, maxBatteryChargeKW: 0
        }, p);

        if (!(o.capacityWh > 0)) { throw new Error("Battery energy must be greater than zero."); }
        if (!(o.chargerKW > 0)) { throw new Error("Charger power must be greater than zero."); }
        if (!(o.efficiencyPercent >= 50 && o.efficiencyPercent <= 100)) { throw new Error("Charging efficiency must be between 50% and 100%."); }
        if (!(o.startSocPercent >= 0 && o.targetSocPercent <= 100) || o.startSocPercent >= o.targetSocPercent) {
            throw new Error("Target SOC must be higher than the current SOC (0 to 100%).");
        }

        const eta = o.efficiencyPercent / 100;
        const step = 0.25;                        // % SOC per step
        let soc = o.startSocPercent;
        let hours = 0;
        let timeTo80 = null;
        const curve = [{ socPercent: soc, hours: 0 }];

        while (soc < o.targetSocPercent - 1e-9) {
            const next = Math.min(o.targetSocPercent, soc + step);
            const mid = (soc + next) / 2;
            let power = o.chargerKW * 1000 * eta;
            if (o.maxBatteryChargeKW > 0) { power = Math.min(power, o.maxBatteryChargeKW * 1000); }
            if (o.taper && mid > o.taperStartPercent) {
                const f = 1 - (1 - o.taperMinFactor) * (mid - o.taperStartPercent) / (100 - o.taperStartPercent);
                power *= f;
            }
            hours += (next - soc) / 100 * o.capacityWh / power;
            soc = next;
            if (timeTo80 === null && soc >= 80 - 1e-9) { timeTo80 = hours; }
            if (curve.length === 0 || Math.round(soc * 4) % 8 === 0 || soc >= o.targetSocPercent - 1e-9) {
                curve.push({ socPercent: soc, hours });
            }
        }

        const batteryWh = (o.targetSocPercent - o.startSocPercent) / 100 * o.capacityWh;

        return {
            batteryEnergyWh: batteryWh,
            gridEnergyWh: batteryWh / eta,
            hours,
            timeTo80Hours: timeTo80,
            curve
        };
    }

    /* ---------------------------------------------------------------
       Electricity cost
       --------------------------------------------------------------- */
    function costEstimate(p) {
        if (!(p.tariffPerKWh >= 0) || !Number.isFinite(p.tariffPerKWh)) { throw new Error("Enter a valid electricity tariff."); }
        const eta = (p.efficiencyPercent || 100) / 100;
        const gridKWhPerKm = p.consumptionWhPerKm / 1000 / eta;
        return {
            gridKWhPerKm,
            costPerKm: gridKWhPerKm * p.tariffPerKWh,
            chargeCost: (p.gridEnergyKWh || 0) * p.tariffPerKWh,
            tripCost: (p.tripKm || 0) * gridKWhPerKm * p.tariffPerKWh,
            monthlyCost: (p.monthlyKm || 0) * gridKWhPerKm * p.tariffPerKWh
        };
    }

    /* ---------------------------------------------------------------
       Speed profiles for the drive-cycle simulation (1 s resolution)
       Presets are ILLUSTRATIVE shapes, not standardized test cycles.
       --------------------------------------------------------------- */
    function rampTo(series, target, rateMps2) {
        let v = series[series.length - 1];
        const dv = mpsToKmh(rateMps2);            // km/h gained per second
        while (Math.abs(v - target) > 1e-9) {
            v = v < target ? Math.min(target, v + dv) : Math.max(target, v - dv);
            series.push(v);
        }
    }

    function holdFor(series, seconds) {
        const v = series[series.length - 1];
        for (let i = 0; i < seconds; i++) { series.push(v); }
    }

    function buildSpeedProfile(kind, peakKmh, repeats) {

        if (!(peakKmh > 0)) { throw new Error("Peak speed must be greater than 0 km/h."); }
        const n = Math.max(1, Math.round(repeats || 1));
        const ACC = 1.0;      // m/s^2
        const DEC = 1.2;      // m/s^2
        const s = [0];

        if (kind === "urban") {
            for (let i = 0; i < n; i++) {
                rampTo(s, peakKmh, ACC); holdFor(s, 20);
                rampTo(s, 0, DEC); holdFor(s, 8);
            }
        } else if (kind === "highway") {
            rampTo(s, peakKmh, ACC);
            holdFor(s, 300 * n);
            rampTo(s, 0, DEC);
        } else if (kind === "mixed") {
            for (let i = 0; i < n; i++) {
                rampTo(s, peakKmh * 0.5, ACC); holdFor(s, 25);
                rampTo(s, 0, DEC); holdFor(s, 6);
                rampTo(s, peakKmh * 0.5, ACC); holdFor(s, 25);
                rampTo(s, peakKmh, ACC); holdFor(s, 90);
                rampTo(s, 0, DEC); holdFor(s, 8);
            }
        } else {
            throw new Error("Unknown speed profile type.");
        }
        return s;
    }

    /** Parse pasted text: one speed per line, or "time_s,speed_kmh" lines. */
    function parseSpeedProfile(text) {

        let lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l[0] !== "#");
        // allow one header line such as "time_s,speed_kmh"
        if (lines.length && /[a-z]/i.test(lines[0]) && lines.length > 1) { lines = lines.slice(1); }
        if (lines.length < 2) { throw new Error("Enter at least two speed values."); }

        const rows = lines.map((l) => l.split(/[,;\s\t]+/).map(Number));
        if (rows.some((r) => r.some((x) => !Number.isFinite(x)))) { throw new Error("The speed profile contains a value that is not a number."); }

        let t;
        let v;
        if (rows[0].length >= 2) {
            t = rows.map((r) => r[0]);
            v = rows.map((r) => r[1]);
            for (let i = 1; i < t.length; i++) {
                if (t[i] <= t[i - 1]) { throw new Error("Time values must increase on every line."); }
            }
        } else {
            v = rows.map((r) => r[0]);
            t = v.map((_, i) => i);
        }
        if (v.some((x) => x < 0)) { throw new Error("Speeds cannot be negative."); }
        if (v.some((x) => x > 400)) { throw new Error("Speeds above 400 km/h are not supported."); }

        const total = Math.floor(t[t.length - 1] - t[0]);
        if (total > 36000) { throw new Error("The profile is longer than 10 hours."); }

        // resample to 1 s by linear interpolation
        const out = [];
        let j = 0;
        for (let sec = 0; sec <= total; sec++) {
            const tt = t[0] + sec;
            while (j < t.length - 2 && t[j + 1] < tt) { j++; }
            const f = (tt - t[j]) / (t[j + 1] - t[j]);
            out.push(v[j] + (v[j + 1] - v[j]) * Math.min(1, Math.max(0, f)));
        }
        return out;
    }

    /* ---------------------------------------------------------------
       Time-stepped drive-cycle simulation
       - Speed is the COMMANDED trace; when the motor or battery cannot
         supply the demand the power is clamped and the step is flagged
         (the speed trace is not re-solved).
       - SOC by coulomb counting: dSOC = -I*dt / capacity.
       --------------------------------------------------------------- */
    function driveCycle(cfg, speedKmh, opts) {

        const o = Object.assign({ socPercent: cfg.initialSocPercent, gradePercent: 0, regen: false, dt: 1 }, opts);
        const n = speedKmh.length;
        if (n < 2) { throw new Error("The speed profile needs at least two points."); }

        const capacityAs = cfg.batteryCapacityAh * 3600;
        let soc = o.socPercent;

        const t = []; const v = []; const p = []; const cur = []; const socArr = []; const eArr = []; const dArr = [];
        let energyWh = 0;
        let distanceM = 0;
        let peakKW = 0;
        let peakRegenKW = 0;
        let regenWh = 0;
        let limitedSteps = 0;
        let depletedAt = null;
        let firstLimit = "";

        for (let i = 0; i < n - 1; i++) {

            const v0 = speedKmh[i];
            const v1 = speedKmh[i + 1];
            const vAvg = (v0 + v1) / 2;
            const a = kmhToMps(v1 - v0) / o.dt;

            let op;
            if (vAvg === 0 && a === 0) {
                // stationary: only the auxiliary load draws power
                const bat = batteryCurrent(cfg.batteryVoltageV, cfg.batteryInternalResistanceOhm, cfg.auxiliaryPowerW, { clamp: true });
                op = { terminalPowerW: bat.terminalPowerW, currentA: bat.currentA, chemicalPowerW: bat.chemicalPowerW, regenElectricalW: 0, limited: false, limitReason: "" };
            } else {
                const load = roadLoad(cfg, vAvg, { gradePercent: o.gradePercent, accelMps2: a });
                const pt = powertrain(cfg, load.wheelPowerW, Math.max(vAvg, 0.0001), { clamp: true, regen: o.regen });
                const bat = batteryCurrent(cfg.batteryVoltageV, cfg.batteryInternalResistanceOhm, pt.terminalPowerW, { clamp: true });
                op = {
                    terminalPowerW: bat.terminalPowerW, currentA: bat.currentA, chemicalPowerW: bat.chemicalPowerW,
                    regenElectricalW: pt.regenElectricalW, limited: pt.limited || bat.limited,
                    limitReason: pt.limitReason || (bat.limited ? "Battery power limit reached." : "")
                };
            }

            if (op.limited) {
                limitedSteps++;
                if (!firstLimit) { firstLimit = "First limit at t = " + (i * o.dt) + " s. " + op.limitReason; }
            }

            t.push(i * o.dt);
            v.push(v0);
            p.push(op.terminalPowerW / 1000);
            cur.push(op.currentA);
            socArr.push(soc);
            eArr.push(energyWh);
            dArr.push(distanceM / 1000);

            peakKW = Math.max(peakKW, op.terminalPowerW / 1000);
            peakRegenKW = Math.max(peakRegenKW, op.regenElectricalW / 1000);
            regenWh += op.regenElectricalW * o.dt / 3600;
            energyWh += op.chemicalPowerW * o.dt / 3600;
            distanceM += kmhToMps(vAvg) * o.dt;
            soc -= 100 * op.currentA * o.dt / capacityAs;

            if (soc <= 0) {
                depletedAt = (i + 1) * o.dt;
                soc = 0;
                break;
            }
            soc = Math.min(100, soc);
        }

        // closing sample
        t.push(t.length * o.dt);
        v.push(speedKmh[Math.min(t.length - 1, n - 1)]);
        p.push(p[p.length - 1] || 0);
        cur.push(cur[cur.length - 1] || 0);
        socArr.push(soc);
        eArr.push(energyWh);
        dArr.push(distanceM / 1000);

        const distanceKm = distanceM / 1000;
        const duration = (t.length - 1) * o.dt;
        const consumption = distanceKm > 0 ? energyWh / distanceKm : NaN;
        const warnings = [];
        if (limitedSteps > 0) {
            warnings.push(limitedSteps + " s of the profile demanded more than the motor or battery can supply, so power was capped. " + firstLimit);
        }
        if (depletedAt !== null) {
            warnings.push("The battery reached 0% at t = " + depletedAt + " s. The rest of the profile was not simulated.");
        }
        if (soc <= cfg.reserveSocPercent && depletedAt === null) {
            warnings.push("The cycle ended below the reserve SOC (" + cfg.reserveSocPercent + "%).");
        }

        return {
            series: { timeS: t, speedKmh: v, powerKW: p, currentA: cur, socPercent: socArr, energyWh: eArr, distanceKm: dArr },
            summary: {
                distanceKm,
                durationS: duration,
                averageSpeedKmh: duration > 0 ? distanceKm / (duration / 3600) : 0,
                netEnergyWh: energyWh,
                consumptionWhPerKm: consumption,
                peakPowerKW: peakKW,
                peakRegenKW,
                regenRecoveredWh: regenWh,
                startSocPercent: o.socPercent,
                finalSocPercent: soc,
                limitedSeconds: limitedSteps,
                estimatedRangeKm: consumption > 0 ? usableRemainingWh(cfg, o.socPercent) / consumption : NaN
            },
            warnings
        };
    }

    /* ---------------------------------------------------------------
       Sensitivity: % change in energy consumption (Wh/km) when one
       parameter is changed by -delta and +delta (relative). Efficiency
       parameters are capped at 100%.
       --------------------------------------------------------------- */
    const SENSITIVITY_PARAMS = Object.freeze([
        ["massKg", "Vehicle mass"],
        ["payloadKg", "Payload"],
        ["dragCoefficient", "Drag coefficient"],
        ["frontalAreaM2", "Frontal area"],
        ["rollingResistance", "Rolling resistance"],
        ["drivetrainEfficiencyPercent", "Drivetrain efficiency"],
        ["controllerEfficiencyPercent", "Controller efficiency"],
        ["motorRatedEfficiencyPercent", "Motor rated efficiency"],
        ["batteryInternalResistanceOhm", "Battery internal resistance"],
        ["auxiliaryPowerW", "Auxiliary load"]
    ]);

    function sensitivity(cfg, opts) {

        const o = Object.assign({ speedKmh: topSpeedKmh(cfg, 0) * 0.5, gradePercent: 0, deltaPercent: 10 }, opts);
        const base = operatingPoint(cfg, { speedKmh: o.speedKmh, gradePercent: o.gradePercent }).consumptionWhPerKm;
        const d = o.deltaPercent / 100;
        const rows = [];

        SENSITIVITY_PARAMS.forEach(([key, label]) => {
            if (!(cfg[key] > 0)) { return; }
            const pct = (factor) => {
                const c = Object.assign({}, cfg);
                c[key] = cfg[key] * factor;
                if (/Percent$/.test(key)) { c[key] = Math.min(100, c[key]); }
                try {
                    const w = operatingPoint(c, { speedKmh: o.speedKmh, gradePercent: o.gradePercent }).consumptionWhPerKm;
                    return 100 * (w - base) / base;
                } catch (e) {
                    return NaN;
                }
            };
            const low = pct(1 - d);
            const high = pct(1 + d);
            if (Number.isFinite(low) && Number.isFinite(high)) {
                rows.push({ key, label, lowPercent: low, highPercent: high, span: Math.max(Math.abs(low), Math.abs(high)) });
            }
        });

        rows.sort((a, b) => b.span - a.span);
        return { baseConsumptionWhPerKm: base, speedKmh: o.speedKmh, deltaPercent: o.deltaPercent, rows };
    }

    /* ---------------------------------------------------------------
       Scale the pack resistance when a user changes voltage/capacity
       of a profile (series cells add resistance, parallel cells reduce it)
       --------------------------------------------------------------- */
    function rescaleBattery(cfg, newVoltageV, newCapacityAh) {
        const r = cfg.batteryInternalResistanceOhm *
            (newVoltageV / cfg.batteryVoltageV) * (cfg.batteryCapacityAh / newCapacityAh);
        return Object.assign({}, cfg, {
            batteryVoltageV: newVoltageV,
            batteryCapacityAh: newCapacityAh,
            batteryInternalResistanceOhm: Math.min(2, Math.max(0.0005, r))
        });
    }

    return Object.freeze({
        VERSION, FIELDS, FIELD_MAP, LOSS_SPLIT,
        validateConfig,
        kmhToMps, mpsToKmh, rpmToRadS,
        totalMassKg, nominalEnergyWh, usableRemainingWh, motorRPM,
        roadLoad, motorCoefficients, motorMotoring, motorGenerating,
        batteryCurrent, powertrain, operatingPoint, powerFlow,
        topSpeedKmh, speedSweep, rangeKm, scenarioRanges,
        tripEstimate, chargingEstimate, costEstimate,
        buildSpeedProfile, parseSpeedProfile, driveCycle,
        sensitivity, SENSITIVITY_PARAMS, rescaleBattery
    });

}));
