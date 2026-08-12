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

## Aplicația desktop

Compilează și pornește fereastra Electron:

```bash
npm run electron:start
```

În acest stadiu, fereastra este intenționat goală. Renderer-ul React va fi
adăugat într-un task separat.

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

## Fixture MySQL local cu XAMPP

Fixture-ul poate salva formularul direct în MariaDB/MySQL local. Configurația
implicită este `127.0.0.1:3306`, baza `semantic_fixture`, utilizatorul `root` și
parola goală. API-ul este disponibil numai pe interfața locală.

Din PowerShell, după pornirea MySQL din XAMPP:

```powershell
.\scripts\mysql-fixture.ps1 start
```

Comanda creează sau actualizează schema, pornește API-ul pe
`http://127.0.0.1:4174` și fixture-ul web pe `http://127.0.0.1:4173`. Nu necesită
`pnpm`.

Comenzile auxiliare sunt:

```powershell
.\scripts\mysql-fixture.ps1 status
.\scripts\mysql-fixture.ps1 reset
.\scripts\mysql-fixture.ps1 stop
```

`reset` șterge programările și clienții creați prin fixture, dar păstrează
sloturile de calendar inițiale.

### E-mail SMTP la trimiterea formularului

Fixture-ul poate trimite o confirmare HTML către adresa introdusă în formular.
Copiază `.env.fixture.example` ca `.env.fixture`, apoi completează hostul,
portul, utilizatorul, parola de aplicație și expeditorul SMTP. Fișierul real cu
secrete este ignorat de Git.

După modificarea configurației, repornește fixture-ul:

```powershell
.\scripts\mysql-fixture.ps1 stop
.\scripts\mysql-fixture.ps1 start
```

Dacă SMTP nu este configurat, programarea se salvează în continuare și interfața
afișează `SMTP disabled`. Dacă serverul SMTP respinge mesajul, programarea rămâne
salvată, iar eroarea de trimitere este afișată în statusul formularului.

## Stadiu

Etapa 0: workspace TypeScript, lint, formatare automată, teste unitare și fixture
web local configurate. Funcționalitățile Electron, React și Tailwind vor fi
adăugate numai în task-urile dedicate.
