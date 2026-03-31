import { useEffect } from 'react';

let activeLocks = 0;
let lockedScrollY = 0;
let originalBodyPosition = '';
let originalBodyTop = '';
let originalBodyLeft = '';
let originalBodyRight = '';
let originalBodyWidth = '';
let originalBodyOverflow = '';

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const { body } = document;

    if (activeLocks === 0) {
      lockedScrollY = window.scrollY;
      originalBodyPosition = body.style.position;
      originalBodyTop = body.style.top;
      originalBodyLeft = body.style.left;
      originalBodyRight = body.style.right;
      originalBodyWidth = body.style.width;
      originalBodyOverflow = body.style.overflow;

      body.style.position = 'fixed';
      body.style.top = `-${lockedScrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    }

    activeLocks += 1;

    return () => {
      activeLocks = Math.max(0, activeLocks - 1);

      if (activeLocks > 0) {
        return;
      }

      body.style.position = originalBodyPosition;
      body.style.top = originalBodyTop;
      body.style.left = originalBodyLeft;
      body.style.right = originalBodyRight;
      body.style.width = originalBodyWidth;
      body.style.overflow = originalBodyOverflow;

      window.scrollTo(0, lockedScrollY);
    };
  }, [locked]);
}
