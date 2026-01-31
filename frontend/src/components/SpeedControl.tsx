import type { ChangeEvent } from "react";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface SpeedControlProps {
  value: number;
  onChange: (speed: number) => void;
  disabled?: boolean;
}

export function SpeedControl({ value, onChange, disabled }: SpeedControlProps) {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onChange(Number(e.target.value));
  };
  return (
    <div className="speed-control">
      <label htmlFor="speed">Playback speed</label>
      <select
        id="speed"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        aria-label="Playback speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </div>
  );
}
