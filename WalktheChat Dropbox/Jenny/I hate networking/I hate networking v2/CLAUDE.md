Make the UX as minimal as possible.
Before rewriting any section of code, read docs/FIXES.md to avoid reintroducing previously fixed bugs.
Before editing any extension file, check extension/package.json build script to confirm the file is actually compiled. The built files are sidepanel/sidepanel.ts, background/service-worker.ts, content/luma.ts, content/linkedin.ts. Do not edit content/panel.ts thinking it will take effect.
Before changing any navigation or user-visible behavior, trace what the user actually sees at each step.
