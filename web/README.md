# Overwrite — web

Landing page + operator dashboard. Vite + React + TypeScript + Tailwind.

```bash
npm install
npm run dev        # local dev
npm run build      # production build to dist/
```

## Deploy (Vercel)

Import the GitHub repo in Vercel, set **Root Directory** to `web/`. Framework
preset: Vite. Build `npm run build`, output `dist`. Add a SPA rewrite so
`/dashboard` resolves (vercel.json already included).

## Wiring the dashboard to a real agent

The dashboard ships with demo data. To show real numbers, export agent state
and serve it as a static JSON the page can fetch:

```bash
python -m agent.main status --config configs/config.yaml > web/public/status.json
```

Then replace the `DEMO_*` constants in `src/pages/Dashboard.tsx` with a fetch
of `/status.json` (shapes match the agent's state store). A cron on the agent
host + any static hosting keeps it a fully static, keyless dashboard.

## Numbers policy

Every yield figure on the site imports from `src/data/validation.ts`, which
mirrors `backtest/results/validation.json`. If you re-run the validation,
update that one file — nothing else hardcodes numbers.
