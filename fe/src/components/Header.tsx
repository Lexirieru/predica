"use client";

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-2xl border-b border-white/[0.06]">
      <div className="max-w-[430px] mx-auto flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--color-yes)] to-cyan-400 flex items-center justify-center shadow-[0_0_12px_var(--color-yes-glow)]">
            <span className="text-black font-bold text-sm">P</span>
          </div>
          <span className="text-white font-semibold text-lg tracking-tight">Predica</span>
        </div>
        <div dangerouslySetInnerHTML={{ __html: '<appkit-button size="sm"></appkit-button>' }} />
      </div>
    </header>
  );
}
