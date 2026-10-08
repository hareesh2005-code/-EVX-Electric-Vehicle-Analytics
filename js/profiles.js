/* =====================================================================
   EVX sample vehicle profiles  (js/profiles.js)

   IMPORTANT: every profile below is a GENERIC SAMPLE for demonstration.
   None of them represents a real manufacturer or model. Replace the
   values with your own vehicle data for meaningful results.
   ===================================================================== */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.EVXProfiles = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    "use strict";

    const COMMON = Object.freeze({
        airDensity: 1.2,
        rotationalMassFactor: 1.05,
        motorType: "BLDC",
        motorModel: "loss",
        batteryChemistry: "Li-ion NMC",
        regenEnabled: "off",
        regenSharePercent: 60
    });

    function make(id, name, category, description, maxPayloadKg, values) {
        return Object.freeze({
            id, name, category, description, maxPayloadKg,
            isSample: true,
            cfg: Object.freeze(Object.assign({}, COMMON, values))
        });
    }

    const SAMPLE_PROFILES = Object.freeze([

        make("sample-scooter", "Reference scooter (60 V, 50 Ah)", "scooter",
            "The original EVX demonstration setup: 3 kWh pack, about 3150 rpm at 62 km/h.", 140, {
                massKg: 100, payloadKg: 70, rollingResistance: 0.012, dragCoefficient: 0.9, frontalAreaM2: 0.6,
                wheelRadiusM: 0.30, gearRatio: 5.746, drivetrainEfficiencyPercent: 95, controllerEfficiencyPercent: 97, auxiliaryPowerW: 50,
                motorRatedPowerKW: 2.5, motorPeakPowerKW: 4.0, motorRatedRPM: 3000, motorMaxRPM: 5000, motorRatedEfficiencyPercent: 91,
                batteryVoltageV: 60, batteryCapacityAh: 50, batteryInternalResistanceOhm: 0.04, initialSocPercent: 78, reserveSocPercent: 5,
                regenMaxPowerKW: 1.5
            }),

        make("sample-motorcycle", "Sample electric motorcycle", "motorcycle",
            "Generic 4.8 kWh motorcycle, top speed around 110 km/h.", 150, {
                massKg: 150, payloadKg: 75, rollingResistance: 0.012, dragCoefficient: 0.65, frontalAreaM2: 0.55,
                wheelRadiusM: 0.31, gearRatio: 6.4, drivetrainEfficiencyPercent: 95, controllerEfficiencyPercent: 97, auxiliaryPowerW: 80,
                motorRatedPowerKW: 8, motorPeakPowerKW: 12, motorRatedRPM: 3500, motorMaxRPM: 6500, motorRatedEfficiencyPercent: 92,
                batteryVoltageV: 96, batteryCapacityAh: 50, batteryInternalResistanceOhm: 0.06, initialSocPercent: 90, reserveSocPercent: 5,
                regenMaxPowerKW: 4
            }),

        make("sample-three-wheeler", "Sample electric three-wheeler", "three-wheeler",
            "Generic passenger or cargo three-wheeler with a 4.8 kWh pack.", 400, {
                massKg: 420, payloadKg: 300, rollingResistance: 0.014, dragCoefficient: 0.75, frontalAreaM2: 2.0,
                wheelRadiusM: 0.26, gearRatio: 8.0, drivetrainEfficiencyPercent: 94, controllerEfficiencyPercent: 96, auxiliaryPowerW: 60,
                motorRatedPowerKW: 4, motorPeakPowerKW: 6, motorRatedRPM: 3000, motorMaxRPM: 5500, motorRatedEfficiencyPercent: 90,
                batteryVoltageV: 48, batteryCapacityAh: 100, batteryInternalResistanceOhm: 0.05, initialSocPercent: 90, reserveSocPercent: 5,
                regenMaxPowerKW: 2
            }),

        make("sample-car", "Sample electric car", "car",
            "Generic compact car with a 52.5 kWh pack and a top speed near 150 km/h.", 400, {
                massKg: 1650, payloadKg: 150, rollingResistance: 0.010, dragCoefficient: 0.29, frontalAreaM2: 2.2,
                motorType: "PMSM",
                wheelRadiusM: 0.32, gearRatio: 9.0, drivetrainEfficiencyPercent: 96, controllerEfficiencyPercent: 97.5, auxiliaryPowerW: 500,
                motorRatedPowerKW: 70, motorPeakPowerKW: 120, motorRatedRPM: 5000, motorMaxRPM: 12000, motorRatedEfficiencyPercent: 95,
                batteryVoltageV: 350, batteryCapacityAh: 150, batteryInternalResistanceOhm: 0.08, initialSocPercent: 90, reserveSocPercent: 5,
                regenMaxPowerKW: 50
            }),

        make("sample-commercial", "Sample light commercial EV", "commercial",
            "Generic light commercial van with an 80 kWh pack and about 1 tonne payload.", 1200, {
                massKg: 2600, payloadKg: 1000, rollingResistance: 0.011, dragCoefficient: 0.38, frontalAreaM2: 3.2,
                motorType: "PMSM",
                wheelRadiusM: 0.35, gearRatio: 10, drivetrainEfficiencyPercent: 95, controllerEfficiencyPercent: 97, auxiliaryPowerW: 800,
                motorRatedPowerKW: 80, motorPeakPowerKW: 150, motorRatedRPM: 4000, motorMaxRPM: 9000, motorRatedEfficiencyPercent: 94,
                batteryVoltageV: 400, batteryCapacityAh: 200, batteryInternalResistanceOhm: 0.08, initialSocPercent: 90, reserveSocPercent: 5,
                regenMaxPowerKW: 60
            })
    ]);

    const CATEGORIES = Object.freeze([
        { id: "scooter", label: "Electric scooter" },
        { id: "motorcycle", label: "Electric motorcycle" },
        { id: "three-wheeler", label: "Electric three-wheeler" },
        { id: "car", label: "Electric car" },
        { id: "commercial", label: "Light commercial vehicle" }
    ]);

    const CURRENCIES = Object.freeze([
        { code: "INR", symbol: "₹", label: "Indian rupee (₹)" },
        { code: "USD", symbol: "$", label: "US dollar ($)" },
        { code: "EUR", symbol: "€", label: "Euro (€)" },
        { code: "GBP", symbol: "£", label: "Pound sterling (£)" }
    ]);

    function sampleForCategory(categoryId) {
        return SAMPLE_PROFILES.find((p) => p.category === categoryId) || SAMPLE_PROFILES[0];
    }

    return Object.freeze({ SAMPLE_PROFILES, CATEGORIES, CURRENCIES, sampleForCategory });

}));
