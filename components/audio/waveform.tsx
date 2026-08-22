type WaveformProps = {
  values: number[];
  active?: boolean;
  large?: boolean;
};

export function Waveform({ values, active = false, large = false }: WaveformProps) {
  return (
    <div className={`wave ${active ? "active" : ""} ${large ? "large" : ""}`} aria-hidden="true">
      {values.map((height, index) => (
        <i key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}
