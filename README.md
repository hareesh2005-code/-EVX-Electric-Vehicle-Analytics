# EVX: Electric Vehicle Analytics

EVX estimates electric vehicle range, energy use, charging time and running cost from battery, motor and vehicle data. Every result comes from an equation you can inspect, with the assumptions listed beside it.

- **Simple Mode** for buyers and owners: range, trip, charging and cost tools.
- **Engineering Mode** for students and engineers: editable vehicle configurations, power-flow analysis, drive-cycle simulation with optional regeneration, sensitivity ranking, configuration comparison, CSV/JSON export and a printable report.

Plain HTML, CSS and JavaScript. No build step, no server, no external requests (Chart.js is included in `vendor/`).

## Run it

Open `index.html` in a browser, or in VS Code install the **Live Server** extension, right-click `index.html` and choose **Open with Live Server**.

## Publish on GitHub Pages

1. Create a new repository on GitHub (for example `evx`).
2. In this folder run:
   ```
   git init
   git add .
   git commit -m "EVX 1.0.0"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/evx.git
   git push -u origin main
   ```
3. On GitHub open **Settings, Pages**, set the source to **Deploy from a branch**, branch **main**, folder **/ (root)**, and save.
4. After a minute the site is live at `https://YOUR-USERNAME.github.io/evx/`.

## Project structure

```
index.html          page structure (landing, Simple Mode, Engineering Mode, Model page)
css/styles.css      all styling
js/model.js         calculation engine (no page code; also runs in Node)
js/profiles.js      generic sample vehicle profiles, categories, currencies
js/storage.js       localStorage wrapper (swap this file to add a backend later)
js/charts.js        Chart.js helpers
js/app.js           navigation, forms and rendering
vendor/chart.umd.js Chart.js 4.5.1 (MIT licence)
tests/model.test.js 43 unit tests for the calculation engine
```

## Run the tests

Requires Node.js. From this folder:

```
node tests/model.test.js
```

The tests compare the engine with hand calculations (road load, battery, charging, trip, cost), check physical trends and exercise invalid inputs.

## Model summary

Road load (rolling, aerodynamic, gradient, inertia) gives wheel power. Drivetrain, a loss-based motor model (copper, iron, friction) and controller efficiency give battery terminal power. A battery with internal resistance gives current, terminal voltage and I²R loss. SOC is tracked by coulomb counting in the drive-cycle. Full equations and assumptions are on the in-app **Model and assumptions** page.

Model level: simplified engineering model. It has **not** been validated against measured vehicle data.

## Limitations

- Sample profiles are generic and are not real manufacturer models.
- Constant battery EMF; no temperature, wind, ageing or state-of-health modelling.
- Built-in drive profiles are illustrative, not standardized test cycles.
- No live telemetry: EVX does not connect to a vehicle, BMS or CAN bus.
- Not a battery management or safety system.
- Saved configurations live in the browser's localStorage on one device.

## Roadmap

1. Validate against MATLAB/Simulink results and published vehicle data, then document the error.
2. Battery OCV-versus-SOC curve and temperature effects.
3. Import of measured CSV logs for comparison with simulation.
4. Optional backend for accounts and cloud-saved configurations.

## Licence

Add your preferred licence before publishing. Chart.js is MIT licensed.
