import { useState } from "react";

import { Button } from "./components/Button.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { Dropdown } from "./components/Dropdown.js";
import { Input } from "./components/Input.js";
import { Modal } from "./components/Modal.js";
import { Select } from "./components/Select.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { Tabs } from "./components/Tabs.js";
import { Toast } from "./components/Toast.js";

const browserOptions = [
  { value: "chromium", label: "Chromium" },
  { value: "chrome", label: "Chrome" },
  { value: "firefox", label: "Firefox" },
  { value: "webkit", label: "WebKit" },
];

export const DesignSystemShowcase = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  return (
    <>
      <section aria-labelledby="design-system-title" className="mt-10">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-semibold text-brand-700">
              Grupul B · Design system
            </p>
            <h2
              id="design-system-title"
              className="mt-1 text-2xl font-semibold tracking-tight"
            >
              Componente de bază
            </h2>
          </div>
          <StatusBadge status="running" />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
            <h3 className="text-base font-semibold">Acțiuni</h3>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setIsModalOpen(true);
                }}
              >
                Deschide modal
              </Button>
              <Button variant="secondary">Secundar</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setIsConfirmOpen(true);
                }}
              >
                Șterge
              </Button>
              <Dropdown
                label="Mai multe"
                items={[
                  { id: "duplicate", label: "Duplică" },
                  { id: "export", label: "Exportă" },
                ]}
              />
            </div>
          </article>

          <article className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
            <h3 className="text-base font-semibold">Câmpuri</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input
                label="Nume proiect"
                placeholder="Magazin demo"
                hint="Folosit în lista de proiecte."
              />
              <Select
                label="Browser implicit"
                defaultValue="chromium"
                options={browserOptions}
              />
              <Input
                label="Câmp indisponibil"
                value="Gestionat automat"
                disabled
                readOnly
              />
              <Input
                label="Exemplu eroare"
                defaultValue="URL incomplet"
                error="Introdu un URL valid."
              />
            </div>
          </article>

          <article className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
            <h3 className="text-base font-semibold">Navigare și status</h3>
            <div className="mt-4">
              <Tabs
                label="Detalii demonstrație"
                tabs={[
                  {
                    id: "overview",
                    label: "Prezentare",
                    content:
                      "Componente reutilizabile pentru interfața aplicației.",
                  },
                  {
                    id: "activity",
                    label: "Activitate",
                    content: "Interacțiunile sunt verificate prin teste DOM.",
                  },
                ]}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusBadge status="waiting_for_manual_intervention" />
              <StatusBadge status="completed" />
              <StatusBadge status="failed" />
              <StatusBadge status="stopped" />
            </div>
          </article>

          <article className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
            <h3 className="text-base font-semibold">Feedback</h3>
            <div className="mt-4 grid gap-3">
              <Toast
                variant="success"
                title="Salvat"
                message="Modificările au fost păstrate."
              />
              <Toast
                variant="warning"
                title="Atenție"
                message="Rularea așteaptă o acțiune manuală."
              />
              <Toast
                variant="error"
                title="Eroare"
                message="Pasul curent nu a putut continua."
              />
            </div>
          </article>
        </div>
      </section>

      <Modal
        open={isModalOpen}
        title="Modal demonstrativ"
        onClose={() => {
          setIsModalOpen(false);
        }}
      >
        Modalul poate fi închis din buton, fundal sau cu tasta Escape.
      </Modal>

      <ConfirmDialog
        open={isConfirmOpen}
        title="Ștergi elementul?"
        message="Aceasta este o demonstrație; nu va fi șters niciun element."
        confirmLabel="Șterge"
        confirmVariant="danger"
        onConfirm={() => {
          setIsConfirmOpen(false);
        }}
        onCancel={() => {
          setIsConfirmOpen(false);
        }}
      />
    </>
  );
};
