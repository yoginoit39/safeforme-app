# SafeForMe (working name)

Scan a food product, get a personal safety verdict and a personal 0–100 score.
Static web app: no backend, no accounts, no tracking. Everything stays in the browser.

```
npm install
npm run dev      # local development
npm test         # engine tests (verdict, score, barcode decoder)
npm run test:devices   # full app on 12 phone/tablet profiles, Safari + Chrome engines
npm run build    # static site in dist/ — upload to any free static host
```

Camera access needs HTTPS (or localhost). Product data: Open Food Facts (ODbL).

Device test screenshots land in `e2e-results/screens/<device>/`.
