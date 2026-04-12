"use client";

export default function OddsBar({
  yesPercent,
  noPercent,
}: {
  yesPercent: number;
  noPercent: number;
}) {
  return (
    <div className="w-full" role="meter" aria-label={`Yes ${yesPercent}%, No ${noPercent}%`}>
      <div className="flex justify-between text-xs font-semibold mb-2">
        <span className="text-[var(--color-yes)]">Yes {yesPercent}%</span>
        <span className="text-[var(--color-no)]">No {noPercent}%</span>
      </div>
      {/* Emil: Specify exact properties, not transition: all */}
      <div className="flex h-2 rounded-full overflow-hidden gap-[2px] bg-white/[0.03]">
        <div
          className="rounded-full relative overflow-hidden"
          style={{
            width: `${yesPercent}%`,
            background: "linear-gradient(90deg, var(--color-yes), #00E4B8)",
            transition: "width 500ms var(--ease-in-out)",
            boxShadow: "0 0 8px var(--color-yes-glow)",
          }}
        >
          {/* Shimmer effect */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
              backgroundSize: "200% 100%",
              animation: "shimmer 3s infinite",
            }}
          />
        </div>
        <div
          className="rounded-full relative overflow-hidden"
          style={{
            width: `${noPercent}%`,
            background: "linear-gradient(90deg, #FF6090, var(--color-no))",
            transition: "width 500ms var(--ease-in-out)",
            boxShadow: "0 0 8px var(--color-no-glow)",
          }}
        />
      </div>
    </div>
  );
}
