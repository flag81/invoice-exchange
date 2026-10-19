'use client';

/**
 * The capture card: one button that opens the camera, and one that takes a file.
 *
 * Two controls, because there are two real intentions: "photograph the paper in front of me" and
 * "use the file I already have" (the gallery, or a PDF a supplier emailed).
 *
 * The big one is a `<button>` that opens a live camera (ADR 0010) — *not* the `<label>` around
 * `<input type="file" capture="environment">` it used to be. `capture` is a hint, and the browsers
 * that ignore it are not a minority: every desktop browser opens the OS file dialog instead,
 * Firefox ignores it on Android too, and Chrome's device emulation does not emulate it either. A
 * button that says "Fotografo faturën" has to produce a camera, so the camera is what it opens.
 *
 * The hidden input stays, demoted to a fallback, for the origin where `getUserMedia` does not exist
 * at all — a phone pointed at the dev server over a plain-http LAN address. There, `capture` still
 * opens the native camera app, which is a better answer than a dead button.
 * `canOpenLiveCamera` decides which of the two runs.
 *
 * The camera path stays image-only: a camera cannot produce a PDF. The second input accepts both,
 * and the server decides from the bytes which of the two it actually got.
 */

import { useEffect, useRef, useState } from 'react';

import { canOpenLiveCamera, requestCamera } from '@/lib/camera';
import { sq } from '@/lib/copy/sq';

import { CameraCapture } from './CameraCapture';

type Phase = 'idle' | 'uploading' | 'reading' | 'review' | 'saving';

const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const ACCEPTED_DOCUMENTS = `${ACCEPTED_IMAGES},application/pdf`;

export type CaptureCardProps = {
  readonly phase: Phase;
  readonly message: string | null;
  readonly hasForm: boolean;
  readonly onPick: (file: File, source: string) => void;
};

const BUTTON_LABELS: Readonly<Record<Phase, string>> = sq.capture.button;

export function CaptureCard({ phase, message, hasForm, onPick }: CaptureCardProps) {
  const busy = phase === 'uploading' || phase === 'reading' || phase === 'saving';
  const [cameraOpen, setCameraOpen] = useState(false);
  /**
   * The permission request, started by the click that opened the overlay and handed to it as-is.
   * `getUserMedia` is what makes the browser ask, so starting it here — while the click still holds
   * the user's gesture — is what guarantees the prompt appears.
   */
  const [cameraRequest, setCameraRequest] = useState<Promise<MediaStream> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Starts `true` and is corrected after mount, because this is a client component that still renders
   * on the server, where `navigator` does not exist. Nothing is drawn for `true`, so a wrong guess
   * costs at worst one frame of silence — never a flash of a note that is not true.
   */
  const [liveCamera, setLiveCamera] = useState(true);

  useEffect(() => {
    setLiveCamera(canOpenLiveCamera(navigator.mediaDevices, window.isSecureContext));
  }, []);

  /**
   * The camera first, the file input only where there cannot be one. Clicking the input from inside
   * a click handler keeps the user gesture the browser requires before it will open a picker.
   *
   * The permission request starts **here**, inside this click: `getUserMedia` is the only thing that
   * makes the browser show its prompt, and a call made while the page still holds the gesture is the
   * one every browser honours. The overlay receives the pending stream and only attaches it.
   */
  function openCamera(): void {
    // Annotated, not inferred: the DOM types claim `mediaDevices` always exists; on an insecure
    // origin it does not, and `canOpenLiveCamera` is what says so.
    const media: MediaDevices | undefined = navigator.mediaDevices;

    if (media === undefined || !canOpenLiveCamera(media, window.isSecureContext)) {
      fileInputRef.current?.click();
      return;
    }

    const request = requestCamera(media);

    // The overlay is the consumer; this keeps a rejection from surfacing as an unhandled promise in
    // the moment between the click and the overlay's effect. The overlay still reads the refusal.
    void request.catch(() => undefined);

    setCameraRequest(request);
    setCameraOpen(true);
  }

  /** Nothing to attach any more: the request belongs to one overlay, and this one is gone. */
  function closeCamera(): void {
    setCameraOpen(false);
    setCameraRequest(null);
  }

  /** Close the overlay first, then open the picker — never a live preview behind a dialog. */
  function useFileInput(): void {
    setCameraOpen(false);
    setCameraRequest(null);
    fileInputRef.current?.click();
  }

  function pick(file: File | undefined, source: string): void {
    if (file !== undefined) {
      onPick(file, source);
    }
  }

  return (
    <div className="card capture-card">
      <h2>{hasForm ? sq.capture.headingAnother : sq.capture.headingStart}</h2>
      <p className="muted">{sq.capture.hint}</p>

      <button
        type="button"
        className={`capture-button${busy ? ' busy' : ''}`}
        disabled={busy}
        onClick={openCamera}
      >
        {BUTTON_LABELS[phase]}
      </button>

      {/*
        Only where no prompt is possible: on a plain-http origin `getUserMedia` is not exposed at all,
        so this button hands over to the phone's own camera app (or a file dialog). Saying so before it
        happens is the difference between a fallback and a bug (ADR 0010).
      */}
      {liveCamera ? null : <p className="capture-note">{sq.capture.camera.notSecure}</p>}

      {/*
        The fallback, not the control: reached only when `canOpenLiveCamera` says there is no
        `getUserMedia` here. It keeps `capture="environment"` for exactly that case.
      */}
      <input
        ref={fileInputRef}
        className="capture-input"
        type="file"
        accept={ACCEPTED_IMAGES}
        capture="environment"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Clearing the value is what lets the same photo be chosen twice in a row.
          event.target.value = '';
          pick(file, 'CAMERA');
        }}
      />

      <label className="capture-secondary">
        {sq.capture.secondary}
        <input
          type="file"
          accept={ACCEPTED_DOCUMENTS}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            pick(file, 'UPLOAD');
          }}
        />
      </label>

      {message === null ? null : <p className="alert">{message}</p>}

      {cameraOpen ? (
        <CameraCapture
          request={cameraRequest}
          onCapture={(file) => {
            setCameraOpen(false);
            setCameraRequest(null);
            onPick(file, 'CAMERA');
          }}
          onClose={closeCamera}
          onUseFile={useFileInput}
        />
      ) : null}
    </div>
  );
}
