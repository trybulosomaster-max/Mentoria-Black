import { AccessibilityInfo } from 'react-native';
import { createContext, createElement, type PropsWithChildren, useContext, useEffect, useState } from 'react';

const ReducedMotionContext = createContext(true);

export function ReducedMotionProvider({ children }: PropsWithChildren) {
  // Fail closed during the asynchronous native preference lookup so the first
  // transition never animates before Reduce Motion is known.
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduced(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return createElement(ReducedMotionContext.Provider, { value: reduced }, children);
}

export function useReducedMotion(): boolean {
  return useContext(ReducedMotionContext);
}
