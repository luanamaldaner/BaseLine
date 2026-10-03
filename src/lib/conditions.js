// Testing conditions, asked before a test and saved with each result.
//
// Every result is compared to the athlete's own baseline, so anything that
// differs between the baseline and the check (a noisy sideline, direct sun,
// having just sprinted off the field) can look like a concussion. Asking
// keeps conditions consistent, and saving the answers lets us check later
// which confounds actually moved the numbers.

import { createContext, useContext } from 'react';

// Balance and reaction time are worse for roughly 15-20 minutes after hard
// exercise, so checks (and baselines) should wait this long.
export const REST_MINUTES = 15;

export function deviceType() {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    return coarse && Math.min(screen.width, screen.height) < 600 ? 'phone' : 'laptop';
  } catch {
    return 'laptop';
  }
}

// { rested, place, light, device } for the current test, or null.
export const ConditionsContext = createContext(null);
export const useConditions = () => useContext(ConditionsContext);
