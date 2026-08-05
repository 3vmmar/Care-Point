"use client";

import {
  HeartPulse,
  PersonStanding,
  ScanFace,
  ScanLine,
  Smile,
  type LucideIcon,
} from "lucide-react";
import { AREAS, type AreaId } from "@/lib/anatomy";

const AREA_ICONS: Record<AreaId, LucideIcon> = {
  face: ScanFace,
  nose: ScanLine,
  body: PersonStanding,
  breast: HeartPulse,
  dental: Smile,
};

export default function AnatomySystemToolbar({
  activeArea,
  rtl,
  onSelect,
}: {
  activeArea: AreaId;
  rtl: boolean;
  onSelect: (area: AreaId) => void;
}) {
  return (
    <div
      className="anatomy-system-toolbar"
      role="group"
      aria-label={rtl ? "اختيار منطقة الرعاية السريع" : "Quick care area selector"}
    >
      {AREAS.map((area) => {
        const Icon = AREA_ICONS[area.id];
        const label = rtl ? area.ar : area.en;

        return (
          <button
            key={area.id}
            type="button"
            className={activeArea === area.id ? "active" : ""}
            aria-label={label}
            aria-pressed={activeArea === area.id}
            onClick={() => onSelect(area.id)}
          >
            <Icon size={19} strokeWidth={1.45} aria-hidden />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
