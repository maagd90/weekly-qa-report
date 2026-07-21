import React from 'react';

export function QaFooter() {
  return (
    <footer className="max-w-qa mx-auto w-full px-4 py-5 pb-8 border-t-2 border-qa-ink mt-2.5 sm:px-6 sm:pb-10 lg:px-8 print:hidden">
      <div className="flex justify-between items-center font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light flex-wrap gap-2">
        <span>QA Weekly · Project quality reporting · Test execution data</span>
        <span>Dashboard · live API + file imports</span>
      </div>
    </footer>
  );
}
