import type { ConfigContext, ExpoConfig } from 'expo/config';

const APP_NAME = 'AVIORA';
const APP_SLUG = 'aviora-mobile';
const APP_SCHEME = 'aviora';
const IOS_BUNDLE_ID = process.env.AVIORA_IOS_BUNDLE_ID ?? 'com.aviora.app';
const ANDROID_PACKAGE = process.env.AVIORA_ANDROID_PACKAGE ?? 'com.aviora.app';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: APP_SLUG,
  scheme: APP_SCHEME,
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0E1822',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: IOS_BUNDLE_ID,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0E1822',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0E1822',
        image: './assets/splash-icon.png',
        imageWidth: 180,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    avioraEnvironment: process.env.EXPO_PUBLIC_AVIORA_ENV ?? 'local',
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
});
