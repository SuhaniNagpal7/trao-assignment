'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  return <div className="drawer-root" data-open={open} aria-hidden={!open}>
    <div className="drawer-backdrop" onClick={onClose} />
    <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="drawer-body">{open && children}</div>
    </aside>
  </div>;
}
