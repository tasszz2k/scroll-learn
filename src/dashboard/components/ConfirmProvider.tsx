import { useCallback, useState, type ReactNode } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { ConfirmContext, type ConfirmOptions } from '../hooks/useConfirm';

type Resolver = (ok: boolean) => void;

interface PendingConfirm extends ConfirmOptions {
  resolve: Resolver;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = (result: boolean) => {
    if (!pending) return;
    pending.resolve(result);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title}
        message={pending?.message ?? ''}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        variant={pending?.variant}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    </ConfirmContext.Provider>
  );
}
