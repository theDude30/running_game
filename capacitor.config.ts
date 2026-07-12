import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rhythmrunner.game',
  appName: 'Rhythm Runner',
  webDir: 'dist',
  backgroundColor: '#0a0a12',
  ios: {
    contentInset: 'never',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
