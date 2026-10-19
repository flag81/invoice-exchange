'use client';

/**
 * The lines, the totals and the save button — the bottom half of the review screen.
 *
 * Split from `ReviewPanel` for the same reason the domain is split from the app: this component is
 * where the *numbers* live, and it stays small enough to read in one go. Every field holds text, never
 * a parsed number, and the totals underneath come from `previewTotals` — the domain's own arithmetic.
 *
 * The save button is disabled while an error is unresolved. That is a courtesy to the user, not a
 * control: the server re-parses and re-validates everything on save, and would refuse the same draft.
 */

import { sq } from '@/lib/copy/sq';
import type { PreviewTotals, ReviewForm, TaxRateOptionView } from '@/lib/invoice-view';

import { Field } from './ReviewField';

type Phase = 'idle' | 'uploading' | 'reading' | 'review' | 'saving';

export type ReviewLinesCardProps = {
  readonly form: ReviewForm;
  readonly rates: readonly TaxRateOptionView[];
  readonly preview: PreviewTotals | null;
  readonly phase: Phase;
  readonly message: string | null;
  readonly savedInvoiceId: string | null;
  readonly errorCount: number;
  /** True when the invoice is already stored: the save button is disabled for that reason, not for errors. */
  readonly blocked: boolean;
  readonly onChange: (fields: Partial<ReviewForm>) => void;
  readonly onChangeLine: (index: number, fields: Partial<ReviewForm['lines'][number]>) => void;
  readonly onSave: () => void;
};

export function ReviewLinesCard(props: ReviewLinesCardProps) {
  const { form, rates, preview, phase, message, savedInvoiceId, errorCount, blocked } = props;
  const currency = form.currency;

  return (
    <div className="card">
      <h2>{sq.lines.title}</h2>
      {form.lines.map((line, index) => (
        <div className="line-editor" key={`line-${String(index)}`}>
          <Field
            id={`description-${String(index)}`}
            label={sq.lines.item(index + 1)}
            value={line.description}
            onChange={(value) => {
              props.onChangeLine(index, { description: value });
            }}
          />
          <div className="field-row">
            <Field
              id={`quantity-${String(index)}`}
              label={sq.lines.quantity}
              inputMode="decimal"
              value={line.quantity}
              onChange={(value) => {
                props.onChangeLine(index, { quantity: value });
              }}
            />
            <Field
              id={`unitPrice-${String(index)}`}
              label={sq.lines.unitPrice}
              inputMode="decimal"
              value={line.unitPrice}
              onChange={(value) => {
                props.onChangeLine(index, { unitPrice: value });
              }}
            />
            <Field
              id={`lineDiscount-${String(index)}`}
              label={sq.lines.discount}
              inputMode="decimal"
              value={line.lineDiscount}
              onChange={(value) => {
                props.onChangeLine(index, { lineDiscount: value });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`taxRate-${String(index)}`}>{sq.lines.vatRate}</label>
            <select
              id={`taxRate-${String(index)}`}
              value={line.taxRateId}
              onChange={(event) => {
                props.onChangeLine(index, { taxRateId: event.target.value });
              }}
            >
              {rates.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {rate.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}

      <Field
        id="documentDiscount"
        label={sq.lines.documentDiscount}
        inputMode="decimal"
        value={form.documentDiscount}
        onChange={(value) => {
          props.onChange({ documentDiscount: value });
        }}
      />

      <dl className="totals">
        <div>
          <dt>{sq.lines.subtotal}</dt>
          <dd>
            {preview?.subtotal ?? '—'} {currency}
          </dd>
        </div>
        <div>
          <dt>{sq.lines.vat}</dt>
          <dd>
            {preview?.tax ?? '—'} {currency}
          </dd>
        </div>
        <div className="total-row">
          <dt>{sq.lines.total}</dt>
          <dd>
            {preview?.total ?? '—'} {currency}
          </dd>
        </div>
      </dl>

      <p className="muted footnote">
        {preview === null || preview.error === null
          ? sq.lines.previewNote
          : sq.lines.previewPaused(preview.error)}
      </p>

      {message === null ? null : <p className="alert">{message}</p>}

      <button
        type="button"
        className="primary"
        disabled={phase === 'saving' || errorCount > 0 || blocked}
        onClick={props.onSave}
      >
        {phase === 'saving'
          ? sq.capture.button.saving
          : sq.lines.save(preview?.total ?? '—', currency)}
      </button>

      {errorCount === 0 ? null : <p className="muted footnote">{sq.lines.saveDisabledNote}</p>}
      {errorCount > 0 || !blocked ? null : (
        <p className="muted footnote">{sq.review.duplicate.blockedNote}</p>
      )}

      {savedInvoiceId === null ? null : (
        <p className="muted">
          {sq.lines.saved} <a href={`/invoices/${savedInvoiceId}`}>{sq.lines.openInvoice}</a> ·{' '}
          <a href="/invoices">{sq.common.allInvoices}</a>
        </p>
      )}
    </div>
  );
}

/** Nothing here but the review screen's field list; the `InvoiceLineTotalsInput` type is not needed. */
