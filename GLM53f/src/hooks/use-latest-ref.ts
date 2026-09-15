'use client';

import { useEffect, useRef } from 'react';

/** Ref, синхронизирующийся с значением в эффекте (без записи в refs во время рендера). */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
