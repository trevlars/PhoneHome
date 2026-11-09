import { registerPlugin } from '@capacitor/core';

import type { PhoneHomeCallKitPlugin } from './definitions';

const PhoneHomeCallKit = registerPlugin<PhoneHomeCallKitPlugin>('PhoneHomeCallKit', {
  web: () => import('./web').then((m) => new m.PhoneHomeCallKitWeb()),
});

export * from './definitions';
export { PhoneHomeCallKit };
