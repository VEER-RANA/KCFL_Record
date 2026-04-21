interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (nextValue: number) => void;
  helperText?: string;
}

export function NumberStepper({ label, value, min, max, onChange, helperText }: NumberStepperProps) {
  const canDecrease = value > min;
  const canIncrease = value < max;

  return (
    <label className="number-stepper-field">
      <span>{label}</span>
      <div className="number-stepper" role="group" aria-label={label}>
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={!canDecrease}
          aria-label={`Decrease ${label}`}
        >
          -
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const rawValue = Number(event.target.value);
            if (Number.isNaN(rawValue)) {
              return;
            }

            onChange(Math.min(max, Math.max(min, rawValue)));
          }}
          aria-label={label}
        />
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={!canIncrease}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
      {helperText ? <small className="muted">{helperText}</small> : null}
    </label>
  );
}
