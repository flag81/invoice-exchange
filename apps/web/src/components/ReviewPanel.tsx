'use client';

/**
 * The review screen: what was read, what is wrong with it, and the way to save it.
 *
 * This is the screen the whole product is built around, so it does three things and refuses a fourth.
 * It *shows* every number the extraction produced (editable), it *separates* errors from warnings
 * (`error` blocks saving; `warning` never does, or people learn to click through both), and it *shows
 * the totals* as they will be stored — computed by the same domain code the server will run.
 *
 * It does not decide anything: the save button is disabled while an error is unresolved, and the server
 * re-parses and re-validates regardless. A disabled button is a courtesy, not a control.
 */

import { formatMoney, isCurrencyCode, type DraftProblem } from '@einv/shared';

import { sq } from '@/lib/copy/sq';
import {
  type ExtractionSourceView,
  extractionSourceLabel,
  formatExtractionDuration,
  isDemoExtraction,
} from '@/lib/extraction-source';
import { formatDateSq } from '@/lib/format-sq';
import type {
  DraftView,
  DuplicateInvoice,
  PreviewTotals,
  ReviewForm,
  TaxRateOptionView,
} from '@/lib/invoice-view';

import { Field } from './ReviewField';
import { ReviewLinesCard } from './ReviewLinesCard';

type Phase = 'idle' | 'uploading' | 'reading' | 'review' | 'saving';

export type ReviewPanelProps = {
  readonly form: ReviewForm;
  readonly draft: DraftView;
  /** Who read the document — `null` when the response did not say. */
  readonly source: ExtractionSourceView | null;
  readonly errors: readonly DraftProblem[];
  readonly warnings: readonly DraftProblem[];
  readonly rates: readonly TaxRateOptionView[];
  readonly preview: PreviewTotals | null;
  readonly phase: Phase;
  readonly message: string | null;
  readonly savedInvoiceId: string | null;
  /** The stored invoice this draft duplicates, once either the check or the save found one. */
  readonly duplicate: DuplicateInvoice | null;
  readonly onChange: (fields: Partial<ReviewForm>) => void;
  readonly onChangeLine: (index: number, fields: Partial<ReviewForm['lines'][number]>) => void;
  readonly onSave: () => void;
};

/** `14.03.2026 · 42,25 EUR` — what the existing invoice is, in the terms the person holding it uses. */
function duplicateDetail(duplicate: DuplicateInvoice): string {
  const date = duplicate.issueDate === null ? sq.common.noDate : formatDateSq(duplicate.issueDate);
  const currency = isCurrencyCode(duplicate.currency) ? duplicate.currency : 'EUR';
  const total = formatMoney(BigInt(duplicate.totalMinor), currency);

  return sq.review.duplicate.detail(date, total);
}

/** `Lexuar nga gemini (gemini-2.5-flash) · 3,4 s` — how this draft was produced. */
function sourceLine(source: ExtractionSourceView): string {
  const label = extractionSourceLabel(source.provider, source.model);
  const duration = formatExtractionDuration(source.durationMs);

  return duration === null ? sq.review.readBy(label) : `${sq.review.readBy(label)} · ${duration}`;
}

function ProblemCard({
  title,
  problems,
  tone,
}: {
  readonly title: string;
  readonly problems: readonly DraftProblem[];
  readonly tone: 'error' | 'warning';
}) {
  return (
    <div className={`card ${tone === 'error' ? 'alert-card' : 'warn-card'}`}>
      <h2>{title}</h2>
      <ul>
        {problems.map((problem) => (
          <li key={`${problem.code}-${problem.field ?? ''}-${problem.message}`}>
            {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReviewPanel(props: ReviewPanelProps) {
  const {
    form,
    draft,
    source,
    errors,
    warnings,
    rates,
    preview,
    phase,
    message,
    savedInvoiceId,
    duplicate,
  } = props;

  return (
    <>
      {/*
        Who read the document, first — before the numbers. The `stub` provider reads nothing and
        returns a plausible fixture, so a demo that looked like a reading would be the one failure
        this product cannot afford: a wrong total stored with confidence.
      */}
      {source === null ? null : isDemoExtraction(source.provider) ? (
        <div className="card warn-card">
          <h2>{sq.review.demoTitle}</h2>
          <p>{sq.review.demoBody}</p>
          <p className="muted footnote">{sourceLine(source)}</p>
        </div>
      ) : (
        <p className="muted footnote">{sourceLine(source)}</p>
      )}

      {duplicate === null ? null : (
        <div className="card alert-card">
          <h2>{sq.review.duplicate.title}</h2>
          <p>
            {duplicate.invoiceNumber === null
              ? sq.review.duplicate.bodyNoNumber(duplicate.supplierName)
              : sq.review.duplicate.body(duplicate.invoiceNumber, duplicate.supplierName)}
          </p>
          <p className="muted footnote">{duplicateDetail(duplicate)}</p>
          <p>
            <a href={`/invoices/${duplicate.id}`}>{sq.review.duplicate.open}</a>
          </p>
        </div>
      )}
      {errors.length === 0 ? null : (
        <ProblemCard title={sq.review.fixBeforeSaving} problems={errors} tone="error" />
      )}
      {warnings.length === 0 ? null : (
        <ProblemCard title={sq.review.worthChecking} problems={warnings} tone="warning" />
      )}

      <div className="card">
        <h2>{sq.review.supplierSection}</h2>
        <Field
          id="supplierName"
          label={sq.review.supplier}
          value={form.supplierName}
          onChange={(value) => {
            props.onChange({ supplierName: value });
          }}
        />
        <Field
          id="supplierVatNumber"
          label={sq.review.supplierVat}
          inputMode="numeric"
          value={form.supplierVatNumber}
          onChange={(value) => {
            props.onChange({ supplierVatNumber: value });
          }}
        />
        <Field
          id="supplierAddress"
          label={sq.review.supplierAddress}
          value={form.supplierAddress}
          onChange={(value) => {
            props.onChange({ supplierAddress: value });
          }}
        />
        <div className="field-row">
          <Field
            id="supplierCountryCode"
            label={sq.review.country}
            maxLength={2}
            value={form.supplierCountryCode}
            onChange={(value) => {
              props.onChange({ supplierCountryCode: value.toUpperCase() });
            }}
          />
          <Field
            id="buyerName"
            label={sq.review.yourCompany}
            value={form.buyerName}
            onChange={(value) => {
              props.onChange({ buyerName: value });
            }}
          />
        </div>
        <Field
          id="invoiceNumber"
          label={sq.review.invoiceNumber}
          value={form.invoiceNumber}
          onChange={(value) => {
            props.onChange({ invoiceNumber: value });
          }}
        />
        <div className="field-row">
          <Field
            id="issueDate"
            label={sq.review.issueDate}
            type="date"
            value={form.issueDate}
            onChange={(value) => {
              props.onChange({ issueDate: value });
            }}
          />
          <Field
            id="dueDate"
            label={sq.review.dueDate}
            type="date"
            value={form.dueDate}
            onChange={(value) => {
              props.onChange({ dueDate: value });
            }}
          />
        </div>
        <p className="muted footnote">{sq.review.currencyNote(form.currency)}</p>
      </div>

      <ReviewLinesCard
        form={form}
        rates={rates}
        preview={preview}
        phase={phase}
        message={message}
        savedInvoiceId={savedInvoiceId}
        errorCount={errors.length}
        blocked={duplicate !== null}
        onChange={props.onChange}
        onChangeLine={props.onChangeLine}
        onSave={props.onSave}
      />

      <p className="footnote muted">{sq.review.linesRead(draft.lines.length)}</p>
    </>
  );
}
