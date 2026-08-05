"use client";

import {
  Activity,
  Bone,
  CircleUserRound,
  Layers3,
  type LucideIcon,
} from "lucide-react";
import { LAYERS, type LayerId } from "@/lib/anatomy";

const LAYER_ICONS: Record<LayerId, LucideIcon> = {
  surface: CircleUserRound,
  structure: Activity,
  skeleton: Bone,
};

export default function LayerSelectorDock({
  available,
  activeLayer,
  rtl,
  onSelect,
}: {
  available: LayerId[];
  activeLayer: LayerId;
  rtl: boolean;
  onSelect: (layer: LayerId) => void;
}) {
  return (
    <div
      className="universe-layer-dock"
      role="group"
      aria-label={rtl ? "عمق العرض" : "View depth"}
    >
      <div className="layer-dock-title" aria-hidden>
        <Layers3 size={17} />
        <span>{rtl ? "الطبقات" : "Layers"}</span>
      </div>

      <div className="layer-dock-track">
        {available.map((id) => {
          const layer = LAYERS.find((candidate) => candidate.id === id)!;
          const Icon = LAYER_ICONS[id];
          const label = rtl ? layer.ar : layer.en;

          return (
            <button
              key={id}
              type="button"
              className={activeLayer === id ? "active" : ""}
              aria-label={label}
              aria-pressed={activeLayer === id}
              onClick={() => onSelect(id)}
            >
              <span className="layer-dock-orb" aria-hidden>
                <Icon size={20} strokeWidth={1.45} />
              </span>
              <span className="layer-dock-label">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
