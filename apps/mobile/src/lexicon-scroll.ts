/** Navigate inside definitions without moving the adjacent navigation rail or page. */
export function scrollLexiconTo(panel: HTMLElement, target: HTMLElement, instant: boolean): void {
  const top = Math.max(0, target.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 6);
  if (instant) panel.scrollTop = top;
  else panel.scrollTo({ top, behavior: 'smooth' });
}
