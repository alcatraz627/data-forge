/** The single phone/desktop breakpoint. JS layout logic (useIsMobile) and the
 * stylesheet MUST agree on this value or the app renders mobile chrome with a
 * desktop editor in the gap band (the 560-vs-639 bug this file retires).
 * app.css cannot read this constant — every `@media (max-width: 639px)` there
 * carries a "breakpoint.ts" comment and must change in the same commit. */
export const MOBILE_BREAKPOINT_PX = 640;

export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;
