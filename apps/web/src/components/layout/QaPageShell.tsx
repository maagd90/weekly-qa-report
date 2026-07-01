import React from 'react';

interface QaPageShellProps {
  title: string;
  subtitle?: string;
  intro?: string;
  children: React.ReactNode;
}

export function QaPageShell({ title, subtitle, intro, children }: QaPageShellProps) {
  return (
    <main className="max-w-qa mx-auto px-8 pt-[26px] pb-[60px]">
      <div className="flex items-baseline justify-between mb-1.5 gap-4 flex-wrap">
        <h2 className="font-spectral font-bold text-[26px] m-0 tracking-tight">{title}</h2>
        {subtitle && (
          <div className="font-mono-qa text-[11px] text-qa-muted-light">{subtitle}</div>
        )}
      </div>
      {intro && (
        <p className="text-[13px] text-qa-muted m-0 mb-[22px] max-w-[700px] leading-relaxed">{intro}</p>
      )}
      {children}
    </main>
  );
}

interface QaSectionProps {
  title?: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function QaSection({ title, subtitle, headerRight, children, className = '', noPadding }: QaSectionProps) {
  return (
    <section className={`bg-white border border-qa-border ${className}`}>
      {(title || headerRight) && (
        <div className={`flex items-baseline justify-between gap-4 ${noPadding ? 'px-[22px] pt-[18px] pb-3.5 border-b border-qa-ink' : 'px-[22px] pt-[18px] pb-3.5 border-b border-qa-ink'}`}>
          <div>
            {title && <h3 className="font-spectral font-semibold text-base m-0">{title}</h3>}
            {subtitle && <p className="m-0 mt-1 text-[11.5px] text-qa-muted-light">{subtitle}</p>}
          </div>
          {headerRight}
        </div>
      )}
      <div className={noPadding ? '' : 'p-[20px_22px]'}>{children}</div>
    </section>
  );
}
