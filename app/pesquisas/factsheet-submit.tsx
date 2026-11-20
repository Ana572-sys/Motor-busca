'use client';

import { useFormStatus } from 'react-dom';

export function FactsheetSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <>
    <button className="secondary" disabled={disabled || pending}>
      {pending ? 'A gerar ficha… aguarde' : 'Gerar ficha completa'}
    </button>
    {pending && <div className="factsheet-progress" role="status" aria-live="polite">
      <span>A OpenAI está a analisar os documentos. A duração depende dos ficheiros e da resposta do serviço.</span>
      <div className="progress-track indeterminate" aria-label="Geração da ficha em curso"><span /></div>
    </div>}
  </>;
}
