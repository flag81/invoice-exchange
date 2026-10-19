# ADR 0010 — The capture button opens a real camera, not a `capture` hint

- **Status**: accepted (capture MVP), implemented in `apps/web`
- **Date**: 2026-10-18

## Context

The capture screen's primary control was a `<label>` wrapping
`<input type="file" accept="image/*" capture="environment">`, and it read **"Fotografo faturën"**.

`capture` is a _hint_ to the user agent, not a command, and the user agents that ignore it are not a
minority. On a desktop browser — Chrome, Edge, Safari, Firefox — it is ignored outright and the OS
file dialog opens. Firefox has not implemented it on Android either, and Chrome's device emulation
does not emulate it, so a laptop in "device toolbar" mode behaves exactly like the laptop it is. The
practical result was a button that promised a camera and produced a file picker, on most of the
machines the app is developed and demoed on, with no way for the person pressing it to know the
difference between "this browser cannot" and "the app is broken".

The obvious alternative — rewording the button to "choose a file" — was rejected: photographing the
paper on the desk is the product, and a UI that cannot do it on a laptop cannot be demonstrated,
reviewed or tested on one.

## Decision

1. **The button is a `<button>` that opens a live `getUserMedia` preview** — `<video>` for the frame,
   a canvas for the shutter, `facingMode: 'environment'` for the rear camera and `audio: false` so no
   microphone is ever requested.
2. **What is captured is what was previewed.** The frame is drawn to a canvas at the video's own
   resolution and encoded as a JPEG (`0.92`, because a 12 MP frame at quality 1 costs megabytes for
   detail no reader can use against an 8 MiB ceiling). It becomes a `File` named
   `fatura-YYYYMMDD-HHMMSS.jpg` and takes the ordinary upload path unchanged.
3. **The `capture` input survives as the fallback, not the control.** `canOpenLiveCamera` checks
   `navigator.mediaDevices.getUserMedia` _and_ `window.isSecureContext`; where either is missing the
   button clicks the hidden input instead. On a phone that origin is a plain-http LAN address, and
   there `capture` still opens the native camera app — a worse answer than the overlay, and a far
   better one than a dead button.
4. **Every refusal is named.** `NotAllowedError`/`SecurityError` (permission), `NotFoundError`/
   `OverconstrainedError` (no camera), `NotReadableError`/`AbortError` (camera in use) and everything
   else each get their own Albanian sentence, and the failed overlay offers the file input. The
   browser's own message is English and aimed at a developer, so it is never shown. A refusal the browser
   _remembers_ is a sixth case with a sentence of its own: `navigator.permissions.query` is asked
   alongside the call, and an already-recorded `denied` says how to undo it instead of inviting a
   retry that cannot work.
5. **The stream is owned by the component's lifetime.** Tracks are stopped in the effect cleanup, not
   in a close handler: an unmount cannot be forgotten, and a camera left running behind a closed
   overlay is a lit indicator light and a flat battery. The same cleanup stops the duplicate stream
   React's StrictMode opens in development.
6. **`Permissions-Policy` moves from `camera=()` to `camera=(self)`.** An empty allowlist disables
   `getUserMedia` for the whole origin, so the old header would have failed every request with
   `NotAllowedError` before the browser ever asked the person. `self` keeps the permission from being
   delegated to an embedded frame; `microphone`, `geolocation` and `payment` stay closed.
7. **The prompt is the first thing, and it is the browser's — asked for by the click.** `getUserMedia`
   is issued inside the click handler that opens the overlay, and again from the overlay's "Provo
   përsëri kamerën" button, rather than from an effect that runs later: the call _is_ what makes the
   browser ask, and a request made while the page still holds the user's gesture is the one every
   browser honours (Safari is strict about it). Nothing pre-flight gates it, because a check beforehand
   that decided "maybe not" would be the one way to suppress the prompt the person is entitled to
   answer. While the request is open the overlay says the browser is asking for permission, instead of
   looking frozen. The three situations in which no prompt can appear are named on screen rather than
   left to look like a broken camera: a plain-http origin (the card says the live camera needs
   `https`/`localhost` _before_ the button is pressed, and the input's `capture` then opens the native
   app), a `Permissions-Policy` that forbids camera, and a refusal already on record — and that last
   one hides the retry button, because only the padlock menu can undo it.

## Consequences

- The camera works where the product is demonstrated: a laptop, a desktop browser, and a phone — one
  code path, one `CAMERA` capture source, no browser-specific behaviour to explain.
- The app now asks for a permission it did not ask for before, which is a real cost: the prompt is
  answered once per origin, and a refusal is remembered — a fresh request cannot undo it. That is why
  the refusal is a sentence with the file input next to it, why a remembered refusal gets a sentence of
  its own and no retry button ("allow it again in the padlock menu" is an action the person can take,
  "try again" is not), and why "Provo përsëri kamerën" appears only for the failures a new gesture can
  actually fix.
- `getUserMedia` requires a secure context. `http://localhost` qualifies; `http://192.168.x.x:3001`
  does not, so photographing with a phone against a dev machine needs `pnpm dev:https`. This is the
  browser's rule and cannot be configured away.
- The still is a JPEG re-encode rather than the camera's own file. The stored bytes are what the
  server sniffs (ADR 0004) and what the operator saw framed, but EXIF is lost — nothing in the
  pipeline reads it, and losing the GPS tag of the person photographing their supplier's office is a
  privacy improvement rather than a regression.
- A single still per capture: no torch, no auto-crop or deskew, no multi-page scan. A page the
  operator cannot frame is a page they photograph twice.

## Alternatives rejected

- **Keep `capture` and reword the button** — honest about the file picker, but abandons the product's
  central gesture on every desktop browser.
- **`getUserMedia` on phones only, file picker on desktop** — two behaviours to explain, and the
  worse one on the machine where the app is reviewed.
- **`enumerateDevices` and a camera picker** — a second UI to choose between a laptop's front and rear
  cameras. `facingMode: 'environment'` already asks for the one pointed at paper, and the browser
  falls back on its own when there is only one camera.
- **A native mobile app for the camera** — the mobile client is phase 6; the browser can do this now.
- **Trusting the client's declared type for the captured still** — unchanged: the server decides from
  the bytes, exactly as it does for an upload (ADR 0004).
