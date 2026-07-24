import { useEffect, useState, type FormEvent } from "react";

import type {
  BasicAuthChallenge,
  BasicAuthCredentials,
} from "../shared/browser-manager.js";
import { Button } from "./components/Button.js";
import { Input } from "./components/Input.js";
import { Modal } from "./components/Modal.js";

export interface BasicAuthDialogProps {
  challenge?: BasicAuthChallenge;
  isSubmitting: boolean;
  open: boolean;
  onCancel: () => void;
  onSubmit: (credentials: BasicAuthCredentials) => Promise<void>;
}

export const BasicAuthDialog = ({
  challenge,
  isSubmitting,
  onCancel,
  onSubmit,
  open,
}: BasicAuthDialogProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [usernameError, setUsernameError] = useState<string>();

  useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      setUsernameError(undefined);
    }
  }, [challenge?.origin, open]);

  useEffect(() => {
    if (challenge?.invalidCredentials) {
      setPassword("");
    }
  }, [challenge?.invalidCredentials]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (username.trim().length === 0) {
      setUsernameError("Username-ul este obligatoriu.");
      return;
    }

    setUsernameError(undefined);
    void onSubmit({ username, password });
  };

  return (
    <Modal open={open} title="Autentificare HTTP necesară" onClose={onCancel}>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <p>
          Site-ul <strong>{challenge?.origin}</strong> solicită HTTP Basic Auth.
        </p>
        <Input
          autoFocus
          autoComplete="username"
          label="Username"
          value={username}
          {...(usernameError ? { error: usernameError } : {})}
          disabled={isSubmitting}
          maxLength={512}
          onChange={(event) => {
            setUsername(event.target.value);
            setUsernameError(undefined);
          }}
        />
        <Input
          autoComplete="current-password"
          label="Parolă"
          type="password"
          value={password}
          {...(challenge?.invalidCredentials
            ? { error: "Username-ul sau parola sunt invalide." }
            : {})}
          disabled={isSubmitting}
          maxLength={512}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Credentialele sunt păstrate numai în memoria aplicației și sunt șterse
          complet la închidere.
        </p>
        <div className="flex justify-end gap-3 border-t border-app-border pt-4">
          <Button
            variant="secondary"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            Anulează
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Se autentifică..." : "Autentifică și continuă"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
