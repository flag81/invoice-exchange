'use client';

/**
 * The capture flow container: photograph → read → review → save. Mobile-first, one screen.
 *
 * The product's promise is in this component's order of operations, so the order is explicit:
 *
 *   1. the camera opens (`getUserMedia`, rear camera — the one pointed at paper, ADR 0010);
 *   2. the image is uploaded as-is, and the server decides what it is from its own bytes;
 *   3. an extraction returns a *draft plus its problems*;
 *   4. the human sees both and can fix anything before anything is stored;
 *   5. saving posts the reviewed text, and the server recomputes and validates it.
 *
 * What this component may *not* do is decide an amount. It holds text, hands text to the server, and
 * shows what comes back; `previewTotals` is the domain's own arithmetic, labelled as a preview.
 */

import type { TaxRate } from '@einv/shared';
import { useEffect, useMemo, useState } from 'react';

import { sq } from '@/lib/copy/sq';
import { type ExtractionSourceView, toExtractionSource } from '@/lib/extraction-source';
import {
  previewTotals,
  toDuplicateInvoice,
  toReviewForm,
  toSubmitPayload,
  type DraftView,
  type DuplicateInvoice,
  type ReviewForm,
  type TaxRateOptionView,
} from '@/lib/invoice-view';

import { CaptureCard } from './CaptureCard';
import { ReviewPanel } from './ReviewPanel';

type Phase = 'idle' | 'uploading' | 'reading' | 'review' | 'saving';

type ApiError = {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
};

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { readonly error?: unknown }).error === 'object';
}

function failureMessage(payload: unknown, fallback: string): string {
  return isApiError(payload) ? payload.error.message : fallback;
}

/** A `DUPLICATE_INVOICE` refusal carries the existing invoice; anything else is not a duplicate. */
function duplicateFromError(payload: unknown): DuplicateInvoice | null {
  if (!isApiError(payload) || payload.error.code !== 'DUPLICATE_INVOICE') {
    return null;
  }

  return toDuplicateInvoice(payload.error.details);
}

/** How long the review screen waits after a keystroke before asking whether the number is taken. */
const DUPLICATE_CHECK_DELAY_MS = 400;

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; payload: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return { ok: response.ok, payload: await response.json().catch(() => null) };
}

export function CaptureFlow() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [rates, setRates] = useState<readonly TaxRate[]>([]);
  const [rateOptions, setRateOptions] = useState<readonly TaxRateOptionView[]>([]);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  /** Who read the document, from the extraction response: a stub draft must say so on screen. */
  const [extractionSource, setExtractionSource] = useState<ExtractionSourceView | null>(null);
  const [captureSource, setCaptureSource] = useState('CAMERA');
  const [savedInvoiceId, setSavedInvoiceId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInvoice | null>(null);

  const preview = useMemo(() => (form === null ? null : previewTotals(form, rates)), [form, rates]);

  const invoiceNumber = form?.invoiceNumber ?? '';
  const supplierVatNumber = form?.supplierVatNumber ?? '';
  const supplierName = form?.supplierName ?? '';

  /**
   * Ask the server whether this number is already stored, before the save button is pressed.
   *
   * Debounced, and deliberately quiet on failure: the check is a courtesy, so a slow or broken request
   * hides nothing and blocks nothing — `POST /api/invoices` runs the same rule and answers 409 on its own.
   * The fields are read through primitives so typing in a line does not re-issue the check.
   */
  useEffect(() => {
    const numbered = invoiceNumber.trim() !== '';
    const identified = supplierVatNumber.trim() !== '' || supplierName.trim() !== '';

    if (!numbered || !identified || phase !== 'review' || savedInvoiceId !== null) {
      setDuplicate(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ invoiceNumber, supplierVatNumber, supplierName });

      fetch(`/api/invoices/duplicate?${query.toString()}`, { signal: controller.signal })
        .then(async (response) =>
          response.ok
            ? ((await response.json()) as { readonly duplicate?: unknown }).duplicate
            : null,
        )
        .then((value) => {
          if (!controller.signal.aborted) {
            setDuplicate(toDuplicateInvoice(value));
          }
        })
        .catch(() => {
          // No answer is not "no duplicate": leave the card as it is and let the save decide.
        });
    }, DUPLICATE_CHECK_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [invoiceNumber, supplierVatNumber, supplierName, phase, savedInvoiceId]);

  function update(fields: Partial<ReviewForm>): void {
    setForm((current) => (current === null ? current : { ...current, ...fields }));
  }

  function updateLine(index: number, fields: Partial<ReviewForm['lines'][number]>): void {
    setForm((current) =>
      current === null
        ? current
        : {
            ...current,
            lines: current.lines.map((line, position) =>
              position === index ? { ...line, ...fields } : line,
            ),
          },
    );
  }

  async function onFile(file: File, source: string): Promise<void> {
    setMessage(null);
    setDraft(null);
    setForm(null);
    setExtractionSource(null);
    setSavedInvoiceId(null);
    setDuplicate(null);
    setCaptureSource(source);
    setPhase('uploading');

    try {
      const body = new FormData();
      body.append('file', file);

      const upload = await fetch('/api/documents', { method: 'POST', body });
      const uploadPayload: unknown = await upload.json().catch(() => null);

      if (!upload.ok) {
        setPhase('idle');
        setMessage(failureMessage(uploadPayload, sq.capture.uploadFailed(upload.status)));
        return;
      }

      const documentId = (uploadPayload as { readonly documentId?: unknown }).documentId;
      if (typeof documentId !== 'string') {
        setPhase('idle');
        setMessage(sq.capture.noDocumentId);
        return;
      }

      setPhase('reading');

      const extraction = await postJson('/api/extractions', { documentId });
      if (!extraction.ok) {
        setPhase('idle');
        setMessage(failureMessage(extraction.payload, sq.capture.extractionFailed));
        return;
      }

      const payload = extraction.payload as {
        readonly draft?: DraftView;
        readonly taxRates?: readonly TaxRateOptionView[];
        readonly extractionId?: unknown;
      };

      if (payload.draft === undefined) {
        setPhase('idle');
        setMessage(sq.capture.noDraft);
        return;
      }

      const options = payload.taxRates ?? [];

      setDraft(payload.draft);
      setForm(toReviewForm(payload.draft));
      setExtractionSource(toExtractionSource(payload));
      setRateOptions(options);
      setRates(
        options.map((option): TaxRate => ({
          id: option.id,
          name: option.label,
          category: option.category as TaxRate['category'],
          ratePercent: option.ratePercent,
        })),
      );
      setExtractionId(typeof payload.extractionId === 'string' ? payload.extractionId : null);
      setPhase('review');
    } catch (error) {
      setPhase('idle');
      setMessage(error instanceof Error ? error.message : sq.capture.uploadFailedGeneric);
    }
  }

  async function onSave(): Promise<void> {
    if (form === null) {
      return;
    }

    setPhase('saving');
    setMessage(null);

    try {
      const result = await postJson(
        '/api/invoices',
        toSubmitPayload(form, { extractionId, captureSource }),
      );

      if (!result.ok) {
        const returnedDraft = (result.payload as { readonly draft?: DraftView }).draft;
        if (returnedDraft !== undefined) {
          setDraft(returnedDraft);
        }

        setPhase('review');

        // A refusal for a duplicate is not an error to read: it is the invoice that already exists.
        const existing = duplicateFromError(result.payload);
        if (existing !== null) {
          setDuplicate(existing);
          setMessage(null);
          return;
        }

        setMessage(failureMessage(result.payload, sq.capture.saveFailed));
        return;
      }

      const savedId = (result.payload as { readonly invoice?: { readonly id?: unknown } }).invoice
        ?.id;

      setDuplicate(null);
      setSavedInvoiceId(typeof savedId === 'string' ? savedId : null);
      setPhase('review');
    } catch (error) {
      setPhase('review');
      setMessage(error instanceof Error ? error.message : sq.capture.saveFailed);
    }
  }

  const errors = draft?.problems.filter((problem) => problem.severity === 'error') ?? [];
  const warnings = draft?.problems.filter((problem) => problem.severity === 'warning') ?? [];

  return (
    <section className="capture">
      <CaptureCard
        phase={phase}
        message={message}
        hasForm={form !== null}
        onPick={(file, source) => {
          void onFile(file, source);
        }}
      />

      {form === null || draft === null ? null : (
        <ReviewPanel
          form={form}
          draft={draft}
          source={extractionSource}
          errors={errors}
          warnings={warnings}
          rates={rateOptions}
          preview={preview}
          phase={phase}
          message={message}
          savedInvoiceId={savedInvoiceId}
          duplicate={duplicate}
          onChange={update}
          onChangeLine={updateLine}
          onSave={() => {
            void onSave();
          }}
        />
      )}
    </section>
  );
}
