import { Button, type ButtonVariant } from "./Button.js";
import { Modal } from "./Modal.js";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: Extract<ButtonVariant, "primary" | "danger">;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  cancelLabel = "Anulează",
  confirmLabel = "Confirmă",
  confirmVariant = "primary",
  message,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) => (
  <Modal open={open} title={title} onClose={onCancel}>
    <p>{message}</p>
    <div className="mt-6 flex justify-end gap-3">
      <Button variant="secondary" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button variant={confirmVariant} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  </Modal>
);
