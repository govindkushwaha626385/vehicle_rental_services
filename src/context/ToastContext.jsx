import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const tones = {
  success: { icon: CheckCircle2, className: 'text-lime' },
  error: { icon: AlertTriangle, className: 'text-rose-300' },
  info: { icon: Info, className: 'text-sky-300' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message, type = 'info', duration = 4800) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((current) => [...current.slice(-3), { id, message, type }]);
    if (duration) window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({
    push,
    dismiss,
    success: (message, duration) => push(message, 'success', duration),
    error: (message, duration) => push(message, 'error', duration),
    info: (message, duration) => push(message, 'info', duration),
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[120] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end" role="region" aria-label="Notifications">
        {toasts.map((toast) => {
          const tone = tones[toast.type] ?? tones.info;
          const Icon = tone.icon;
          const isError = toast.type === 'error';
          return (
            <div
              key={toast.id}
              className="pointer-events-auto relative flex w-full max-w-md items-start gap-3 overflow-hidden rounded-2xl border border-white/15 bg-ink/95 px-4 py-3 text-sm text-white shadow-[0_28px_70px_-28px_rgba(0,0,0,0.85)] animate-rise backdrop-blur-xl"
              role={isError ? 'alert' : 'status'}
              aria-live={isError ? 'assertive' : 'polite'}
              aria-atomic="true"
            >
              <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-lime via-aqua to-coral" />
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/[0.07]">
                <Icon className={`h-4 w-4 ${tone.className}`} />
              </span>
              <p className="flex-1 pt-1 leading-5 text-white/90">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
