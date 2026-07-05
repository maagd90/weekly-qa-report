import React from 'react';

export function QaFooter() {
  return (
    <footer className="max-w-qa mx-auto px-8 py-5 pb-10 border-t-2 border-qa-ink mt-2.5 print:hidden">
      <div className="flex justify-between items-center font-mono-qa text-[10px] tracking-wider uppercase text-qa-muted-light flex-wrap gap-2">
        <span>QA Weekly · DLM Travel Studio · Test execution data</span>
        <span>Dashboard · live API + file imports</span>
      </div>
    </footer>
  );
}
