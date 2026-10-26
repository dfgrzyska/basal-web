// The System One page: its text exists in both languages (data-doc="pl" / "en"); the switch shows one of them, and
// i18n.js fills the shared parts (top bar, footer).
import { apply, getLang, setLang } from './i18n.js';

const TITLES = { pl: 'System One · basal', en: 'System One · basal' };

function show() {
  const lang = getLang();
  for (const el of document.querySelectorAll('[data-doc]')) el.hidden = el.dataset.doc !== lang;
  for (const b of document.querySelectorAll('[data-set-lang]')) b.setAttribute('aria-pressed', String(b.dataset.setLang === lang));
  document.title = TITLES[lang];
}

document.querySelector('.langs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-set-lang]');
  if (b) setLang(b.dataset.setLang);
});
addEventListener('langchange', show);

apply();
show();
