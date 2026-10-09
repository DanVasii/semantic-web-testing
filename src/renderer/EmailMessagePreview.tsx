import { useMemo } from "react";

import type { ImapMatchedMessage } from "../shared/imap.js";

type PreviewMessage = Omit<ImapMatchedMessage, "accountName"> & {
  accountName?: string;
};

const blockedElements = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "base",
  "link",
  "video",
  "audio",
  "source",
  "track",
].join(",");

const safeDataImage = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i;
const sanitizeCss = (value: string): string =>
  value
    .replaceAll(/@import\s+[^;]+;?/gi, "")
    .replaceAll(/url\([^)]*\)/gi, "none")
    .replaceAll(/expression\s*\([^)]*\)/gi, "");

export const buildSafeEmailPreviewDocument = (html: string): string => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed
    .querySelectorAll(blockedElements)
    .forEach((element) => element.remove());

  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        name === "srcset" ||
        name === "action" ||
        name === "formaction" ||
        name === "poster" ||
        name === "background" ||
        name === "href" ||
        name === "xlink:href"
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "src" && !safeDataImage.test(attribute.value.trim())) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        element.setAttribute("style", sanitizeCss(attribute.value));
      }
    }
  });

  parsed.querySelectorAll("style").forEach((style) => {
    style.textContent = sanitizeCss(style.textContent ?? "");
  });

  const emailStyles = [...parsed.head.querySelectorAll("style")]
    .map((style) => style.outerHTML)
    .join("");

  return `<!doctype html>
<html lang="ro">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; min-height: 100%; background: #fff; color: #0f172a; }
      body { box-sizing: border-box; padding: 16px; overflow-wrap: anywhere; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
    </style>
    ${emailStyles}
  </head>
  <body>${parsed.body.innerHTML}</body>
</html>`;
};

export interface EmailMessagePreviewProps {
  message: PreviewMessage;
}

export const EmailMessagePreview = ({ message }: EmailMessagePreviewProps) => {
  const previewDocument = useMemo(
    () =>
      message.html === undefined
        ? undefined
        : buildSafeEmailPreviewDocument(message.html),
    [message.html],
  );
  const subject = message.subject || "(fără subiect)";

  return (
    <article className="mt-3 overflow-hidden rounded-xl border border-violet-200 bg-white shadow-sm">
      <header className="border-b border-violet-100 bg-violet-50/70 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="font-semibold text-slate-950">{subject}</h4>
            <p className="mt-0.5 text-xs text-slate-600">
              {message.accountName || "Cont IMAP"} · {message.mailbox}
            </p>
          </div>
          <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-800">
            E-mail primit
          </span>
        </div>
        <dl className="mt-3 grid gap-1 text-xs text-slate-700">
          <div>
            <dt className="inline font-semibold">De la: </dt>
            <dd className="inline">
              {message.from.join(", ") || "necunoscut"}
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold">Către: </dt>
            <dd className="inline">{message.to.join(", ") || "necunoscut"}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Primit: </dt>
            <dd className="inline">{message.receivedAt}</dd>
          </div>
        </dl>
      </header>

      {previewDocument === undefined ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-white p-4 text-sm text-slate-800">
          {message.text || "Mesajul nu conține text care poate fi afișat."}
        </pre>
      ) : (
        <>
          <iframe
            className="h-80 w-full bg-white"
            title={`Previzualizare e-mail: ${subject}`}
            sandbox=""
            referrerPolicy="no-referrer"
            loading="lazy"
            srcDoc={previewDocument}
          />
          {message.text.trim().length > 0 ? (
            <details className="border-t border-slate-200 bg-slate-50 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                Vezi varianta text
              </summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs text-slate-700">
                {message.text}
              </pre>
            </details>
          ) : null}
        </>
      )}
    </article>
  );
};
