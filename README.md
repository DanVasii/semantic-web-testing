# Semantic Web Testing App

Aplicație desktop pentru crearea, configurarea, rularea și depanarea testelor
web end-to-end definite semantic.

Implementarea urmează specificația din
`Specificație_finală_aplicație_testare_web_semantică_Codex.pdf` și avansează
în task-uri mici, verificabile.

## Cerințe locale

- Node.js 22 sau mai nou
- npm

## Pornire

```bash
npm install
npm run verify
```

Comanda `verify` rulează toate verificările locale ale proiectului.

## Verificări locale

```bash
npm run lint
npm run typecheck
npm run build
```

`npm run verify` rulează toate verificările de mai sus în această ordine.

## Stadiu

Etapa 0: workspace TypeScript și lint TypeScript configurate. Funcționalitățile
Electron, React, Tailwind, formatarea automată și testarea vor fi adăugate numai
în task-urile dedicate.
