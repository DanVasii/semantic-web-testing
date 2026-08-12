import { useEffect, useRef, useState } from "react";

import type {
  ImapAccountSummary,
  ImapDiagnosticMessage,
  ImapMailboxSummary,
} from "../shared/imap.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import { Button } from "./components/Button.js";

export interface ImapSettingsPanelProps {
  api: SemanticAppApi;
}

const emptyForm = {
  name: "Cont principal",
  host: "",
  port: 993,
  secure: true,
  username: "",
  password: "",
  mailbox: "INBOX",
};

export const ImapSettingsPanel = ({ api }: ImapSettingsPanelProps) => {
  const [accounts, setAccounts] = useState<ImapAccountSummary[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState(emptyForm);
  const [mailboxes, setMailboxes] = useState<ImapMailboxSummary[]>([]);
  const [busy, setBusy] = useState<"save" | "test" | "delete" | "mailboxes">();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [listening, setListening] = useState(false);
  const [listenStatus, setListenStatus] = useState<string>();
  const [diagnosticMessages, setDiagnosticMessages] = useState<
    ImapDiagnosticMessage[]
  >([]);
  const listenGeneration = useRef(0);
  const listenTimer = useRef<number | undefined>(undefined);
  const savedAccount = accounts.find((account) => account.id === editingId);

  const currentInput = () => ({
    ...(editingId === undefined ? {} : { id: editingId }),
    name: form.name,
    host: form.host,
    port: form.port,
    secure: form.secure,
    username: form.username,
    ...(form.password.length === 0 ? {} : { password: form.password }),
    mailbox: form.mailbox,
  });

  useEffect(() => {
    if (typeof api.listImapAccounts !== "function") return;
    let active = true;
    void api
      .listImapAccounts()
      .then((items) => {
        if (active) setAccounts(items);
      })
      .catch(() => {
        if (active) setError("Conturile IMAP nu au putut fi încărcate.");
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(
    () => () => {
      listenGeneration.current += 1;
      if (listenTimer.current !== undefined) {
        window.clearTimeout(listenTimer.current);
      }
    },
    [],
  );

  const stopListening = (status = "Ascultarea IMAP a fost oprită."): void => {
    listenGeneration.current += 1;
    if (listenTimer.current !== undefined) {
      window.clearTimeout(listenTimer.current);
      listenTimer.current = undefined;
    }
    setListening(false);
    setListenStatus(status);
  };

  const pollDiagnostic = async (
    input: ReturnType<typeof currentInput>,
    receivedAfter: string,
    generation: number,
  ): Promise<void> => {
    try {
      const result = await api.pollImapDiagnostic(input, receivedAfter);
      if (listenGeneration.current !== generation) return;
      setDiagnosticMessages((current) => {
        const next = new Map(
          current.map((item) => [`${item.mailbox}:${item.uid}`, item]),
        );
        for (const item of result.messages) {
          next.set(`${item.mailbox}:${item.uid}`, item);
        }
        return [...next.values()]
          .sort((left, right) =>
            right.receivedAt.localeCompare(left.receivedAt),
          )
          .slice(0, 50);
      });
      setListenStatus(
        result.messages.length === 0
          ? `Ascultare activă · ultima verificare ${new Date(
              result.checkedAt,
            ).toLocaleTimeString("ro-RO")} · niciun mesaj nou`
          : `Ascultare activă · ${result.messages.length} mesaj(e) detectate`,
      );
      listenTimer.current = window.setTimeout(
        () => void pollDiagnostic(input, receivedAfter, generation),
        5_000,
      );
    } catch (reason) {
      if (listenGeneration.current !== generation) return;
      stopListening("Ascultarea IMAP s-a oprit din cauza unei erori.");
      setError(
        reason instanceof Error
          ? reason.message
          : "Ascultarea IMAP nu a putut continua.",
      );
    }
  };

  const startListening = (): void => {
    stopListening("");
    const generation = listenGeneration.current;
    const receivedAfter = new Date().toISOString();
    const input = currentInput();
    setError(undefined);
    setMessage(undefined);
    setDiagnosticMessages([]);
    setListening(true);
    setListenStatus(
      `Ascultare activă din ${new Date(receivedAfter).toLocaleTimeString(
        "ro-RO",
      )} · trimite acum un e-mail`,
    );
    void pollDiagnostic(input, receivedAfter, generation);
  };

  const edit = (account: ImapAccountSummary): void => {
    stopListening();
    setEditingId(account.id);
    setForm({
      name: account.name,
      host: account.host,
      port: account.port,
      secure: account.secure,
      username: account.username,
      password: "",
      mailbox: account.mailbox,
    });
    setMessage(undefined);
    setError(undefined);
    setMailboxes([]);
  };

  const save = async (): Promise<void> => {
    setBusy("save");
    setError(undefined);
    setMessage(undefined);
    try {
      const saved = await api.saveImapAccount(currentInput());
      setAccounts((current) => [
        ...current.filter((account) => account.id !== saved.id),
        saved,
      ]);
      edit(saved);
      setMessage("Contul IMAP a fost salvat criptat local.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Contul IMAP nu a putut fi salvat.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const test = async (): Promise<void> => {
    setBusy("test");
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await api.testImapConnection(currentInput());
      (result.success ? setMessage : setError)(
        `${result.message} (${result.latencyMs} ms)`,
      );
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async (): Promise<void> => {
    if (editingId === undefined) return;
    setBusy("delete");
    setError(undefined);
    try {
      await api.deleteImapAccount(editingId);
      setAccounts((current) =>
        current.filter((account) => account.id !== editingId),
      );
      setEditingId(undefined);
      setForm(emptyForm);
      setMessage("Contul IMAP a fost șters.");
    } finally {
      setBusy(undefined);
    }
  };

  const loadMailboxes = async (): Promise<void> => {
    if (editingId === undefined) return;
    setBusy("mailboxes");
    setError(undefined);
    try {
      const loaded = await api.listImapMailboxes(editingId);
      setMailboxes(loaded);
      setMessage(`${loaded.length} mailbox-uri au fost încărcate.`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Mailbox-urile nu au putut fi încărcate.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section
      className="mt-5 rounded-xl border border-app-border bg-slate-50 p-4"
      aria-labelledby="imap-settings-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="imap-settings-heading" className="font-semibold">
            Conexiuni IMAP
          </h3>
          <p className="mt-1 text-sm text-app-muted">
            Parola este criptată local. Runnerul citește numai mesajele sosite
            după pornirea testului.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            stopListening();
            setEditingId(undefined);
            setForm(emptyForm);
            setMailboxes([]);
            setMessage(undefined);
            setError(undefined);
          }}
        >
          Cont nou
        </Button>
      </div>

      {accounts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {accounts.map((account) => (
            <Button
              key={account.id}
              variant={editingId === account.id ? "primary" : "secondary"}
              onClick={() => {
                edit(account);
              }}
            >
              {account.name}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">
          Nume
          <input
            className="min-h-10 rounded-lg border border-app-border bg-white px-3 font-normal"
            value={form.name}
            onChange={(event) => {
              setForm((current) => ({ ...current, name: event.target.value }));
            }}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Host
          <input
            className="min-h-10 rounded-lg border border-app-border bg-white px-3 font-normal"
            placeholder="imap.example.com"
            value={form.host}
            onChange={(event) => {
              setForm((current) => ({ ...current, host: event.target.value }));
            }}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Port
          <input
            className="min-h-10 rounded-lg border border-app-border bg-white px-3 font-normal"
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                port: Number(event.target.value),
              }));
            }}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Utilizator
          <input
            className="min-h-10 rounded-lg border border-app-border bg-white px-3 font-normal"
            value={form.username}
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                username: event.target.value,
              }));
            }}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Parolă
          <input
            className="min-h-10 rounded-lg border border-app-border bg-white px-3 font-normal"
            type="password"
            placeholder={
              editingId === undefined
                ? "Obligatorie"
                : "Lasă gol pentru păstrare"
            }
            value={form.password}
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                password: event.target.value,
              }));
            }}
          />
          <span className="text-xs font-normal text-app-muted">
            {form.password.length > 0
              ? "Parolă introdusă și pregătită pentru test."
              : savedAccount?.passwordConfigured === true
                ? "Parola este salvată criptat."
                : "Este necesară o parolă de aplicație."}
          </span>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Mailbox
          {mailboxes.length > 0 ? (
            <select
              className="min-h-10 rounded-lg border border-app-border bg-white px-3 font-normal"
              value={form.mailbox}
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  mailbox: event.target.value,
                }));
              }}
            >
              {!mailboxes.some(({ path }) => path === form.mailbox) ? (
                <option value={form.mailbox}>{form.mailbox}</option>
              ) : null}
              {mailboxes.map((mailbox) => (
                <option key={mailbox.path} value={mailbox.path}>
                  {mailbox.path}
                  {mailbox.specialUse ? ` · ${mailbox.specialUse}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="min-h-10 rounded-lg border border-app-border bg-white px-3 font-normal"
              value={form.mailbox}
              onChange={(event) => {
                setForm((current) => ({
                  ...current,
                  mailbox: event.target.value,
                }));
              }}
            />
          )}
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={form.secure}
          onChange={(event) => {
            setForm((current) => ({
              ...current,
              secure: event.target.checked,
            }));
          }}
        />
        TLS/SSL
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy !== undefined} onClick={() => void save()}>
          {busy === "save" ? "Se salvează…" : "Salvează contul"}
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== undefined}
          onClick={() => void test()}
        >
          {busy === "test" ? "Se testează…" : "Testează conexiunea"}
        </Button>
        <Button
          variant="secondary"
          disabled={editingId === undefined || busy !== undefined}
          onClick={() => void loadMailboxes()}
        >
          {busy === "mailboxes"
            ? "Se încarcă mailbox-urile…"
            : "Încarcă mailbox-uri"}
        </Button>
        <Button
          variant="danger"
          disabled={editingId === undefined || busy !== undefined}
          onClick={() => void remove()}
        >
          Șterge contul
        </Button>
        {listening ? (
          <Button variant="danger" onClick={() => stopListening()}>
            Oprește ascultarea
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={busy !== undefined}
            onClick={startListening}
          >
            Pornește ascultarea
          </Button>
        )}
      </div>
      {listenStatus ? (
        <div
          className={`mt-3 rounded-lg p-3 text-sm ${
            listening ? "bg-sky-50 text-sky-900" : "bg-slate-100 text-app-muted"
          }`}
          role="status"
        >
          {listenStatus}
        </div>
      ) : null}
      {diagnosticMessages.length > 0 ? (
        <div className="mt-3 rounded-lg border border-sky-200 bg-white p-3">
          <h4 className="font-semibold">
            Mesaje primite după pornirea ascultării
          </h4>
          <div className="mt-2 grid gap-2">
            {diagnosticMessages.map((item) => (
              <article
                key={`${item.mailbox}:${item.uid}`}
                className="rounded-lg border border-app-border bg-slate-50 p-3 text-sm"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{item.subject || "(fără subiect)"}</strong>
                  <span className="text-app-muted">
                    {item.receivedAt.length === 0
                      ? "dată necunoscută"
                      : new Date(item.receivedAt).toLocaleString("ro-RO")}
                  </span>
                </div>
                <p className="mt-1 text-app-muted">
                  De la: {item.from.join(", ") || "necunoscut"} · Către:{" "}
                  {item.to.join(", ") || "necunoscut"}
                </p>
                {item.textPreview.length > 0 ? (
                  <p className="mt-2 whitespace-pre-wrap">{item.textPreview}</p>
                ) : null}
                <p className="mt-1 text-xs text-app-muted">
                  {item.mailbox} · UID {item.uid}
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
};
