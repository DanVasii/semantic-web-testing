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
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run verify` rulează toate verificările de mai sus în această ordine.

Pentru aplicarea automată a formatării:

```bash
npm run format
```

Pentru rularea testelor în mod watch:

```bash
npm run test:watch
```

## Fixture web local

Pornește pagina deterministă folosită pentru dezvoltarea testelor web:

```bash
npm run fixture:web
```

Pagina devine disponibilă la `http://127.0.0.1:4173`. Comanda folosește un port
strict și va eșua dacă portul este deja ocupat.

Pentru verificarea build-ului static:

```bash
npm run fixture:web:build
```

Artefactele sunt generate în `dist/fixture-web` și sunt incluse automat în
`npm run verify`.

## Stadiu

Etapa 0: workspace TypeScript, lint, formatare automată, teste unitare și fixture
web local configurate. Funcționalitățile Electron, React și Tailwind vor fi
adăugate numai în task-urile dedicate.
