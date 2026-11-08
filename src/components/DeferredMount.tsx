import React, { Suspense, useState, useEffect } from 'react';

interface DeferredMountProps {
  /** Becomes true when the wrapped (lazy) component is first needed, e.g. a modal's isOpen flag. */
  when: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Defers mounting a code-split (React.lazy) component until it is first requested.
 * Once mounted it stays mounted, so internal state and exit animations keep working
 * and re-opening is instant (the chunk is already loaded).
 */
export const DeferredMount: React.FC<DeferredMountProps> = ({ when, children, fallback = null }) => {
  const [hasMounted, setHasMounted] = useState<boolean>(when);

  useEffect(() => {
    if (when && !hasMounted) setHasMounted(true);
  }, [when, hasMounted]);

  if (!hasMounted && !when) return null;
  return <Suspense fallback={fallback}>{children}</Suspense>;
};

export default DeferredMount;
