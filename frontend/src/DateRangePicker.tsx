import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { formatDmy } from "./format";
import { PRESETS } from "./ranges";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function DateRangePicker({
  from,
  to,
  activePreset,
  onChange,
  onPreset,
}: {
  from: string;
  to: string;
  activePreset: string;
  onChange: (from: string, to: string) => void;
  onPreset: (id: string) => void;
}): JSX.Element {
  return (
    <div className="range">
      <div className="presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={preset.id === activePreset ? "preset-on" : "ghost"}
            aria-pressed={preset.id === activePreset}
            onClick={() => onPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="range-fields">
        <DayField label="From" value={from} rangeFrom={from} rangeTo={to} onPick={(next) => onChange(next, to && next > to ? next : to)} />
        <DayField label="To" value={to} rangeFrom={from} rangeTo={to} onPick={(next) => onChange(from && next < from ? next : from, next)} />
      </div>
    </div>
  );
}

function DayField({
  label,
  value,
  rangeFrom,
  rangeTo,
  onPick,
}: {
  label: string;
  value: string;
  rangeFrom: string;
  rangeTo: string;
  onPick: (next: string) => void;
}): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => (value ? fromYmd(value) : new Date()));
  const cells = useMemo(() => monthCells(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent): void {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  return (
    <div className={`day-field${open ? " open" : ""}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`day-button${value ? " has-value" : ""}`}
        onClick={() => {
          setCursor(value ? fromYmd(value) : new Date());
          setOpen((current) => !current);
        }}
      >
        <span>{label}</span>
        <strong className={value ? "set" : "empty"}>{value ? formatDmy(value) : "DD/MM/YYYY"}</strong>
      </button>
      {open ? (
        <div className="day-pop" ref={popupRef}>
          <div className="day-nav">
            <button type="button" className="ghost" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Previous month">
              ‹
            </button>
            <strong>
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </strong>
            <button type="button" className="ghost" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="day-grid">
            {WEEKDAYS.map((day) => (
              <span key={day} className="day-name">
                {day}
              </span>
            ))}
            {cells.map((date) => {
              const ymd = toYmd(date);
              const outside = date.getMonth() !== cursor.getMonth();
              const inRange = rangeFrom !== "" && rangeTo !== "" && ymd >= rangeFrom && ymd <= rangeTo;
              return (
                <button
                  key={ymd + String(outside)}
                  type="button"
                  className={`day-cell${outside ? " outside" : ""}${inRange ? " in-range" : ""}${ymd === value ? " selected" : ""}`}
                  onClick={() => {
                    onPick(ymd);
                    setOpen(false);
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toYmd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromYmd(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year ?? 2025, (month ?? 1) - 1, day ?? 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function monthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}
