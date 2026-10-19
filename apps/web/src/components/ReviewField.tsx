'use client';

/**
 * One labelled input, used by every field on the review screen.
 *
 * It exists so the review screen has exactly one way to render a field: same id/label wiring, same
 * `inputMode` for the on-screen keypad, same change signature. A screen where two fields behave
 * differently is a screen where one of them is wrong on a phone.
 */

export type FieldProps = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string | undefined;
  readonly inputMode?: 'decimal' | 'numeric' | undefined;
  readonly maxLength?: number | undefined;
};

export function Field({ id, label, value, onChange, type, inputMode, maxLength }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        {...(type === undefined ? {} : { type })}
        {...(inputMode === undefined ? {} : { inputMode })}
        {...(maxLength === undefined ? {} : { maxLength })}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}
