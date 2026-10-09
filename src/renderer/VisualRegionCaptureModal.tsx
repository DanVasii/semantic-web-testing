import { useEffect, useRef, useState, type PointerEvent } from "react";

import type { VisualStepContextCapture } from "../shared/runner.js";
import type { VisualInteractionRegion } from "../shared/test-model.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";

interface Point {
  x: number;
  y: number;
}

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualRegionCaptureModalProps {
  capture: VisualStepContextCapture;
  open: boolean;
  onClose: () => void;
  onSave: (region: VisualInteractionRegion) => void;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

const selectionFrom = (start: Point, end: Point): Selection => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

export const VisualRegionCaptureModal = ({
  capture,
  onClose,
  onSave,
  open,
}: VisualRegionCaptureModalProps) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const [start, setStart] = useState<Point>();
  const [selection, setSelection] = useState<Selection>();

  useEffect(() => {
    setStart(undefined);
    setSelection(undefined);
  }, [capture.capturedAt]);

  const pointForEvent = (event: PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const save = (): void => {
    const image = imageRef.current;
    if (
      image === null ||
      selection === undefined ||
      selection.width < 0.01 ||
      selection.height < 0.01
    ) {
      return;
    }
    const canvas = document.createElement("canvas");
    const sourceX = Math.round(selection.x * image.naturalWidth);
    const sourceY = Math.round(selection.y * image.naturalHeight);
    const sourceWidth = Math.max(
      1,
      Math.round(selection.width * image.naturalWidth),
    );
    const sourceHeight = Math.max(
      1,
      Math.round(selection.height * image.naturalHeight),
    );
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    );
    const referenceImageBase64 = canvas
      .toDataURL("image/jpeg", 0.82)
      .split(",")[1];
    if (referenceImageBase64 === undefined) return;
    onSave({
      ...selection,
      viewportWidth: capture.viewportWidth,
      viewportHeight: capture.viewportHeight,
      referenceImageBase64,
    });
  };

  return (
    <Modal
      open={open}
      size="wide"
      title="Selectează zona văzută de AI"
      onClose={onClose}
    >
      <p>
        Am rulat pașii anteriori și am capturat starea curentă. Trasează un
        dreptunghi peste zona în care AI-ul poate decide și da click.
      </p>
      <div className="mt-4 overflow-auto rounded-xl border border-app-border bg-slate-950 p-2">
        <div
          className="relative mx-auto w-fit cursor-crosshair touch-none select-none"
          onPointerDown={(event) => {
            const point = pointForEvent(event);
            event.currentTarget.setPointerCapture(event.pointerId);
            setStart(point);
            setSelection({ ...point, width: 0, height: 0 });
          }}
          onPointerMove={(event) => {
            if (start === undefined) return;
            setSelection(selectionFrom(start, pointForEvent(event)));
          }}
          onPointerUp={(event) => {
            if (start !== undefined) {
              setSelection(selectionFrom(start, pointForEvent(event)));
            }
            setStart(undefined);
          }}
        >
          <img
            ref={imageRef}
            alt="Captura browserului înainte de pasul vizual"
            className="block max-h-[65vh] max-w-full"
            draggable={false}
            src={`data:${capture.mimeType};base64,${capture.imageBase64}`}
          />
          {selection !== undefined ? (
            <div
              className="pointer-events-none absolute border-2 border-amber-400 bg-amber-300/20 shadow-[0_0_0_9999px_rgba(2,6,23,0.42)]"
              style={{
                left: `${selection.x * 100}%`,
                top: `${selection.y * 100}%`,
                width: `${selection.width * 100}%`,
                height: `${selection.height * 100}%`,
              }}
            />
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Anulează
        </Button>
        <Button
          disabled={
            selection === undefined ||
            selection.width < 0.01 ||
            selection.height < 0.01
          }
          onClick={save}
        >
          Salvează zona
        </Button>
      </div>
    </Modal>
  );
};
