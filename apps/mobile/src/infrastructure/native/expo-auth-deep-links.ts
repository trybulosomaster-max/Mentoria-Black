import * as Linking from 'expo-linking';

import type { AuthDeepLinkPort } from '../../ports/foundation-ports';

export const expoAuthDeepLinks: AuthDeepLinkPort = Object.freeze({
  callback: () => Linking.createURL('/auth/callback'),
  passwordRecovery: () => Linking.createURL('/auth/callback', {
    queryParams: { next: 'update-password' },
  }),
});
