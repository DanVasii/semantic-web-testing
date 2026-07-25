const report = document.querySelector("#storage-report");
const seedButton = document.querySelector("#seed-storage");
const refreshButton = document.querySelector("#refresh-storage");
const clearButton = document.querySelector("#clear-storage");

const openFixtureDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("semantic-fixture", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("state")) {
        request.result.createObjectStore("state");
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB nu poate fi deschis."));
    };
  });

const listDatabaseNames = async () => {
  if (typeof indexedDB.databases !== "function") return ["unsupported"];
  return (await indexedDB.databases())
    .map((database) => database.name)
    .filter((name) => name !== undefined);
};

const readState = async () => {
  const registrations =
    "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : [];
  const state = {
    origin: location.origin,
    cookie: document.cookie.includes("fixture_cookie=seeded"),
    localStorage: localStorage.getItem("fixture_wipe"),
    sessionStorage: sessionStorage.getItem("fixture_wipe"),
    indexedDB: await listDatabaseNames(),
    cacheStorage:
      "caches" in globalThis ? await caches.keys() : ["unsupported"],
    serviceWorkers: registrations
      .filter((registration) => new URL(registration.scope).origin === origin)
      .map((registration) => registration.scope),
  };
  if (report) report.textContent = JSON.stringify(state, null, 2);
};

const seedState = async () => {
  localStorage.setItem("fixture_wipe", "seeded");
  sessionStorage.setItem("fixture_wipe", "seeded");
  document.cookie = "fixture_cookie=seeded; Path=/; SameSite=Lax";

  const database = await openFixtureDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("state", "readwrite");
    transaction.objectStore("state").put("seeded", "fixture_wipe");
    transaction.oncomplete = resolve;
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB nu poate fi populat."));
    };
  });
  database.close();

  if ("caches" in globalThis) {
    const cache = await caches.open("semantic-fixture");
    await cache.put(
      "/fixture-cache-value",
      new Response("seeded", { headers: { "content-type": "text/plain" } }),
    );
  }
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/fixture-service-worker.js");
  }
  await readState();
};

const deleteDatabase = (name) =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => {
      reject(
        request.error ?? new Error(`IndexedDB ${name} nu poate fi ștearsă.`),
      );
    };
    request.onblocked = () => {
      reject(new Error(`Ștergerea IndexedDB ${name} este blocată.`));
    };
  });

const clearState = async () => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "fixture_cookie=; Path=/; Max-Age=0; SameSite=Lax";
  const databaseNames = await listDatabaseNames();
  await Promise.all(
    databaseNames
      .filter((name) => name !== "unsupported")
      .map(async (name) => deleteDatabase(name)),
  );
  if ("caches" in globalThis) {
    const names = await caches.keys();
    await Promise.all(names.map(async (name) => caches.delete(name)));
  }
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => new URL(registration.scope).origin === origin)
        .map(async (registration) => registration.unregister()),
    );
  }
  await readState();
};

seedButton?.addEventListener("click", () => {
  void seedState();
});
refreshButton?.addEventListener("click", () => {
  void readState();
});
clearButton?.addEventListener("click", () => {
  void clearState();
});

void readState();
