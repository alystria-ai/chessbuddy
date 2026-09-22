/** Coarse pointer or phone-width viewport — matches the compact CSS layout. */
export function isMobilePortrait(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse), (max-width: 767px)').matches;
}
