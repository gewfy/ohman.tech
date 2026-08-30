/* Header appears once the in-page lockup has scrolled out of view */

const masthead = document.querySelector('.masthead');
const identity = document.querySelector('.identity');

let shown = false;

function syncMasthead() {
  if (!masthead || !identity) return;
  const bottom = identity.getBoundingClientRect().bottom;
  if (!shown && bottom <= 0) shown = true;
  else if (shown && bottom > 12) shown = false;
  masthead.classList.toggle('is-on', shown);
  masthead.setAttribute('aria-hidden', shown ? 'false' : 'true');
  const link = masthead.querySelector('.masthead__brand');
  if (link) link.tabIndex = shown ? 0 : -1;
}

let mastRAF = 0;
addEventListener('scroll', () => {
  if (mastRAF) return;
  mastRAF = requestAnimationFrame(() => { mastRAF = 0; syncMasthead(); });
}, { passive: true });
addEventListener('resize', syncMasthead);

syncMasthead();
