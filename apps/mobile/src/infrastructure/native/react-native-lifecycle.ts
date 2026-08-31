import { AppState } from 'react-native';

import type { LifecyclePort, LifecycleState } from '../../ports/foundation-ports';

function lifecycleState(value: string): LifecycleState {
  return value === 'active' ? 'foreground' : 'background';
}

export const reactNativeLifecycle: LifecyclePort = Object.freeze({
  current: () => lifecycleState(AppState.currentState),
  subscribe(listener) {
    const subscription = AppState.addEventListener('change', (nextState) => {
      listener(lifecycleState(nextState));
    });
    return () => subscription.remove();
  },
});
