import type { BrowserContext, Page } from "playwright-core";

import type {
  ManualWipeResource,
  WipeDetails,
  WipeLogEntry,
  WipeResource,
} from "../../shared/runner.js";

export class WipeError extends Error {
  public constructor(
    message: string,
    public readonly result: WipeDetails,
  ) {
    super(message);
    this.name = "WipeError";
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failedEntry = (
  resource: WipeResource,
  message: string,
): WipeLogEntry => ({
  resource,
  status: "failed",
  message,
});

export const extractHttpOrigin = (url: string): string => {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Wipe-ul necesită un URL HTTP sau HTTPS.");
  }
  return parsed.origin;
};

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const wipeBrowserStateForOrigin = async (
  context: BrowserContext,
  page: Page,
  startUrl: string,
  options: {
    reloadStartPage?: boolean;
    resources?: ManualWipeResource[];
  } = {},
): Promise<WipeDetails> => {
  const origin = extractHttpOrigin(startUrl);
  const hostname = new URL(origin).hostname;
  const entries: WipeLogEntry[] = [];
  const resources = new Set<ManualWipeResource>(
    options.resources ?? [
      "cookies",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "cacheStorage",
      "serviceWorkers",
    ],
  );

  try {
    const currentOrigin = (() => {
      try {
        return extractHttpOrigin(page.url());
      } catch {
        return undefined;
      }
    })();
    if (currentOrigin !== origin) {
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    }
    if (extractHttpOrigin(page.url()) !== origin) {
      throw new Error("Browserul nu a rămas pe origin-ul proiectului.");
    }
    entries.push({
      resource: "navigation",
      status: "cleared",
      message: `Origin verificat: ${origin}.`,
    });
  } catch (error) {
    entries.push(
      failedEntry(
        "navigation",
        `Origin-ul nu a putut fi deschis: ${errorMessage(error)}`,
      ),
    );
    const result: WipeDetails = { origin, status: "failed", entries };
    throw new WipeError(
      `Wipe critic eșuat pentru ${origin}: origin inaccesibil.`,
      result,
    );
  }

  if ([...resources].some((resource) => resource !== "cookies")) {
    try {
      await page.setContent(
        "<!doctype html><html><head><title>Semantic wipe</title></head><body></body></html>",
        { waitUntil: "domcontentloaded" },
      );
    } catch (error) {
      entries.push(
        failedEntry(
          "navigation",
          `Documentul origin-ului nu a putut fi izolat: ${errorMessage(error)}`,
        ),
      );
      const result: WipeDetails = { origin, status: "failed", entries };
      throw new WipeError(
        `Wipe critic eșuat pentru ${origin}: documentul nu a putut fi izolat.`,
        result,
      );
    }
  }

  if (resources.has("cookies")) {
    try {
      const cookies = (await context.cookies([origin])).filter(
        (cookie) => cookie.domain.replace(/^\./, "") === hostname,
      );
      await context.clearCookies({
        domain: new RegExp(`^\\.?${escapeRegularExpression(hostname)}$`, "i"),
      });
      entries.push({
        resource: "cookies",
        status: "cleared",
        message: "Cookie-urile origin-ului au fost șterse.",
        count: cookies.length,
      });
    } catch (error) {
      entries.push(
        failedEntry(
          "cookies",
          `Cookie-urile nu au putut fi șterse: ${errorMessage(error)}`,
        ),
      );
    }
  }

  if ([...resources].some((resource) => resource !== "cookies")) {
    try {
      const storageEntries = await page.evaluate(
        async ({
          expectedOrigin,
          selectedResources,
        }): Promise<WipeLogEntry[]> => {
          if (location.origin !== expectedOrigin) {
            throw new Error(
              `Origin activ neașteptat: ${location.origin || "necunoscut"}.`,
            );
          }

          const results: WipeLogEntry[] = [];
          const failureText = (error: unknown): string =>
            error instanceof Error ? error.message : String(error);
          const attempt = async (
            resource: WipeResource,
            action: () => number | Promise<number>,
            successMessage: string,
          ): Promise<void> => {
            try {
              const count = await action();
              results.push({
                resource,
                status: "cleared",
                message: successMessage,
                count,
              });
            } catch (error) {
              results.push({
                resource,
                status: "failed",
                message: failureText(error),
              });
            }
          };

          if (selectedResources.includes("localStorage")) {
            await attempt(
              "localStorage",
              () => {
                const count = localStorage.length;
                localStorage.clear();
                return count;
              },
              "localStorage a fost șters.",
            );
          }
          if (selectedResources.includes("sessionStorage")) {
            await attempt(
              "sessionStorage",
              () => {
                const count = sessionStorage.length;
                sessionStorage.clear();
                return count;
              },
              "sessionStorage a fost șters.",
            );
          }
          if (selectedResources.includes("indexedDB")) {
            await attempt(
              "indexedDB",
              async () => {
                if (typeof indexedDB.databases !== "function") {
                  throw new Error(
                    "Browserul nu permite enumerarea bazelor IndexedDB.",
                  );
                }
                const databases = await indexedDB.databases();
                const names = databases
                  .map((database) => database.name)
                  .filter((name): name is string => name !== undefined);
                for (const name of names) {
                  await new Promise<void>((resolve, reject) => {
                    const request = indexedDB.deleteDatabase(name);
                    request.onsuccess = () => {
                      resolve();
                    };
                    request.onerror = () => {
                      reject(
                        request.error ??
                          new Error(`IndexedDB ${name} nu a putut fi ștearsă.`),
                      );
                    };
                    request.onblocked = () => {
                      reject(
                        new Error(
                          `Ștergerea IndexedDB ${name} este blocată de o conexiune deschisă.`,
                        ),
                      );
                    };
                  });
                }
                return names.length;
              },
              "Bazele IndexedDB au fost șterse.",
            );
          }
          if (selectedResources.includes("cacheStorage")) {
            await attempt(
              "cacheStorage",
              async () => {
                if (!("caches" in globalThis)) {
                  throw new Error("Cache Storage nu este disponibil.");
                }
                const names = await caches.keys();
                const deleted = await Promise.all(
                  names.map(async (name) => caches.delete(name)),
                );
                if (deleted.some((result) => !result)) {
                  throw new Error("Cel puțin un cache nu a putut fi șters.");
                }
                return names.length;
              },
              "Cache Storage a fost șters.",
            );
          }

          if (selectedResources.includes("serviceWorkers")) {
            if (!("serviceWorker" in navigator)) {
              results.push({
                resource: "serviceWorkers",
                status: "skipped",
                message:
                  "Service workers nu sunt disponibili în acest browser.",
              });
            } else {
              await attempt(
                "serviceWorkers",
                async () => {
                  const registrations =
                    await navigator.serviceWorker.getRegistrations();
                  const matching = registrations.filter(
                    (registration) =>
                      new URL(registration.scope).origin === expectedOrigin,
                  );
                  const removed = await Promise.all(
                    matching.map(async (registration) =>
                      registration.unregister(),
                    ),
                  );
                  if (removed.some((result) => !result)) {
                    throw new Error(
                      "Cel puțin un service worker nu a putut fi dezînregistrat.",
                    );
                  }
                  return matching.length;
                },
                "Service workers ai origin-ului au fost dezînregistrați.",
              );
            }
          }
          return results;
        },
        {
          expectedOrigin: origin,
          selectedResources: [...resources],
        },
      );
      entries.push(...storageEntries);
    } catch (error) {
      entries.push(
        failedEntry(
          "localStorage",
          `Scriptul de curățare al origin-ului a eșuat: ${errorMessage(error)}`,
        ),
      );
    }
  }

  const failed = entries.some((entry) => entry.status === "failed");
  if (failed) {
    const result: WipeDetails = { origin, status: "failed", entries };
    throw new WipeError(`Wipe-ul manual a eșuat pentru ${origin}.`, result);
  }

  if (options.reloadStartPage !== false) {
    try {
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    } catch (error) {
      entries.push(
        failedEntry(
          "navigation",
          `Pagina de start nu a putut fi reîncărcată: ${errorMessage(error)}`,
        ),
      );
      const result: WipeDetails = { origin, status: "failed", entries };
      throw new WipeError(
        `Wipe-ul s-a încheiat, dar pagina de start nu a putut fi reîncărcată.`,
        result,
      );
    }
  }

  return { origin, status: "completed", entries };
};
