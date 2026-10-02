import { MAP_STYLES, type MapStyleId } from "./theme";

type Props = {
  value: MapStyleId;
  onChange: (id: MapStyleId) => void;
  ariaLabel: string;
};

export function StyleSelect({ value, onChange, ariaLabel }: Props) {
  return (
    <select
      className="select style-select"
      value={value}
      onChange={(event) => onChange(event.target.value as MapStyleId)}
      aria-label={ariaLabel}
    >
      {MAP_STYLES.map((style) => (
        <option key={style.id} value={style.id}>{style.label}</option>
      ))}
    </select>
  );
}
