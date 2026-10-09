# Browser, MySQL, and email: extending the walkthrough

The [README walkthrough](../README.md#walkthrough-a-booking-form) exercises the browser without submitting a booking. This guide describes the optional integration setup and concrete scenarios to validate it. These live integrations were not run during the documentation pass.

## 1. Start the local database fixture

Start a local MySQL/MariaDB instance, for example the MySQL service in XAMPP. The bundled fixture is a local development playground configured for:

| Setting        | Value                         |
| -------------- | ----------------------------- |
| Host           | `127.0.0.1`                   |
| Port           | `3306`                        |
| Database       | `semantic_fixture`            |
| User           | `root`                        |
| Password       | Empty, for this local fixture |
| Fixture API    | `http://127.0.0.1:4174`       |
| Web playground | `http://127.0.0.1:4173`       |

The fixture API's database connection is defined in [fixture-database.mjs](../fixtures/mysql/fixture-database.mjs). These defaults are development settings; a different database installation requires corresponding configuration changes. Do not expose the fixture services publicly.

Run setup once, then keep the API and web playground running in separate terminals:

```bash
npm run fixture:mysql:setup
npm run fixture:mysql:api
```

```bash
npm run fixture:web
```

Setup creates the schema and seeds available slots. If the web playground from the README is already running, reuse it.

On Windows, the helper can manage the fixture processes instead:

```powershell
.\scripts\mysql-fixture.ps1 start
.\scripts\mysql-fixture.ps1 status
.\scripts\mysql-fixture.ps1 stop
```

Use either the helper or the separate terminals for a given port. `reset` clears fixture-created customers and appointments while retaining seeded slots:

```powershell
.\scripts\mysql-fixture.ps1 reset
```

## 2. Record a booking submission

Create a separate recorded test so the browser-only tutorial remains easy to rerun. For an accepted submission, use:

- Service **Testare semantică** (`semantic`). The backend accepts this service; the README's `automation` selection is only a browser demonstration.
- Date **2027-08-15**, time **10:30**, one of the seeded slots. Move the calendar to August after selecting the year.
- A synthetic customer name and an email address in a test mailbox you control if you will enable delivery.
- A synthetic password if you want to exercise that optional field. The fixture does not require a password.

Record the submit action and add an explicit page check for the successful response. Browser clicks alone do not verify persistence.

## 3. Add a MySQL check

In the project's MySQL settings, configure the local connection and test it. Then open the test's **Checks** tab, choose **Adaugă un check → Check bază de date**, and select the relevant tables:

| Table                | Evidence to inspect                                      |
| -------------------- | -------------------------------------------------------- |
| `customers`          | The customer's stored email and profile values           |
| `appointments`       | Customer relation, service, date, time, and status       |
| `appointment_events` | Events produced by the booking flow                      |
| `booking_slots`      | Seeded availability context, if relevant to the scenario |

The runner captures the configured baseline after stage entry and before the stage flow, then compares the later snapshot. Configure identity columns where necessary; the event table does not have a primary key.

For an explicit assertion, configure a required extractor that selects the relevant inserted appointment and requires a unique match. Give the extracted value a runtime variable name, such as `appointmentId`. A later stage can consume that variable. Inspect the selected row's business values too; merely completing a snapshot diff is not an assertion that the appointment is correct.

Repeated use of the same customer email can update an existing customer rather than insert another. Use a new synthetic address per run when your test expects a new customer, or configure the expected update behavior.

## 4. Configure delivery and add an IMAP check

SMTP sends the fixture confirmation. IMAP lets the testing application observe it. They are separate connections.

Copy the included template:

```powershell
Copy-Item .env.fixture.example .env.fixture
```

Fill in `.env.fixture` locally with the SMTP host, port, TLS setting, username, app password, and sender. The fixture API loads that file at startup; restart it after changing the values. The real file is ignored by Git.

With no SMTP host configured, delivery is disabled and the booking can still be saved. A delivery error also leaves the booking in the database and appears in the form status. This distinction is useful for testing a successful database write followed by failed delivery.

In **Setări aplicație → Conexiuni IMAP**, configure a dedicated test mailbox, test its connection, and choose the mailbox folder. Add **Check e-mail** to the stage and set:

- The account and mailbox.
- The recipient used in the test dataset.
- Subject containing **Am primit rezervarea ta**.
- A body filter or required extraction that matches the expected booking data.

Run the test before generating the confirmation. Checks select new messages within the stage's collection window, and consumed messages are tracked to avoid reusing the same message for subsequent checks. If no match arrives, the check keeps polling until you intervene; this is not an assertion for “no email should be sent.”

The bundled confirmation contains the customer's name, appointment date, and time. It does not implement a payment or confirmation-link workflow. Link extraction for a later stage requires a target application that actually sends such a link.

## 5. Optional AI features

Select **Setări aplicație → Provider AI** to configure Ollama, LM Studio, Gemini, or OpenAI. Keep **None** for ordinary recording and DOM checks. Vision features require a provider/model capable of processing images.

For LM Studio, load a model with structured-output support and start its local server, usually `http://127.0.0.1:1234`. Select **LM Studio**, test the connection, reload models, choose a model, and save. The adapter uses the OpenAI-compatible models and chat-completions endpoints; a trailing `/v1` is normalized.

For a visual check, describe the visible condition and choose its confidence threshold. Visual checks evaluate captured viewport sections around the current position; do not assume the model has seen every part of a long page.

For post-run evaluation, write a concrete rule, for example: “Compare the appointment date and time in the collected database evidence with the test data and the confirmation email. Report a mismatch or missing evidence.” This request uses the dataset and MySQL/IMAP evidence; screenshots belong to the separate visual-check path.

## Concrete validation scenarios

These are reproducible acceptance scenarios to run in your configured environment, not claims of completed live integration tests.

| Scenario                    | Setup or change                                            | Expected observation                                               |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Browser success             | Follow the README                                          | Date and time text checks pass                                     |
| Browser failure             | Expect `11:00` while selecting `10:30`                     | Time check fails                                                   |
| Database insert             | New customer, valid seeded appointment                     | Relevant inserted rows appear; required unique extraction succeeds |
| Existing customer           | Submit again with the same email                           | Inspect update/reuse behavior; do not assume a new customer row    |
| Invalid service             | Submit `automation` to the fixture backend                 | Request rejected; do not report a successful booking               |
| Email success               | Valid SMTP plus matching IMAP filters                      | New confirmation is collected and can be inspected                 |
| Wrong email filter          | Expect an unrelated subject                                | Check remains waiting until interrupted or abandoned               |
| SMTP failure                | Use invalid SMTP settings in the isolated fixture          | Booking can persist while delivery reports an error                |
| Stage handoff               | Extract a required ID in stage 1 and consume it in stage 2 | Later step receives the produced runtime value                     |
| Missing required extraction | Filter so no row or value matches                          | Check reports an extraction failure                                |

The fixture smoke check can be run with `npm run smoke:mysql` once its services are available. It clears the `customers`, `appointments`, and `appointment_events` tables in `semantic_fixture` as part of the smoke scenario and cleanup. Run it only against the disposable fixture database.
