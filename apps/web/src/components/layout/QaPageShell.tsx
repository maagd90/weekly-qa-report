import React from 'react';

interface QaPageShellProps {
  title: string;
  subtitle?: string;
  intro?: string;
  children: React.ReactNode;
}

export function QaPageShell({ title, subtitle, intro, children }: QaPageShellProps) {
  return (
    <main className="max-w-qa mx-auto w-full min-w-0 px-4 pt-5 pb-10 sm:px-6 sm:pt-[26px] sm:pb-[60px] lg:px-8">
      <div className="flex items-start justify-between mb-1.5 gap-2 flex-col sm:flex-row sm:items-baseline sm:gap-4 sm:flex-wrap">
        <h2 className="font-spectral font-bold text-[23px] sm:text-[26px] m-0 tracking-tight break-words">{title}</h2>
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
        <div className={`flex flex-col items-start justify-between gap-3 px-4 pt-4 pb-3.5 border-b border-qa-ink sm:flex-row sm:items-baseline sm:gap-4 sm:px-[22px] sm:pt-[18px]`}>
          <div className="min-w-0">
            {title && <h3 className="font-spectral font-semibold text-base m-0">{title}</h3>}
            {subtitle && <p className="m-0 mt-1 text-[11.5px] text-qa-muted-light">{subtitle}</p>}
          </div>
          {headerRight && <div className="min-w-0 max-w-full">{headerRight}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-4 sm:p-[20px_22px]'}>{children}</div>
    </section>
  );
}
