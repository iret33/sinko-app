/* The page's behaviour: the store buttons from links.js, the language button, and the guide's Copy button. The language itself
   is picked by the small script in each page's <head>, before the first paint. */
(() => {
  const links = window.SINKO_LINKS || {};
  const html = document.documentElement;

  // A store button with a link opens the store; without one it stays on the page and says "Coming soon".
  document.querySelectorAll('[data-link]').forEach((a) => {
    const url = links[a.getAttribute('data-link')];
    if (url) {
      a.href = url;
      a.removeAttribute('aria-disabled');
    } else {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
    }
  });
  document.querySelectorAll('[data-needs]').forEach((el) => {
    el.hidden = !links[el.getAttribute('data-needs')];
  });

  function setTitle() {
    const t = html.getAttribute('data-title-' + html.lang);
    if (t) document.title = t;
  }

  // The language button switches in place, keeps the choice (when the browser lets the page store it) and carries it in the
  // page's own links, so the guide opens in the language the links page was in.
  function keepLang() {
    document.querySelectorAll('a[data-keep-lang]').forEach((a) => {
      const [rest, hash] = a.getAttribute('href').split('#');
      a.setAttribute('href', rest.split('?')[0] + '?lang=' + html.lang + (hash ? '#' + hash : ''));
    });
  }
  document.querySelectorAll('a.lang').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const lang = a.getAttribute('hreflang');
      html.lang = lang;
      html.dir = lang === 'ar' ? 'rtl' : 'ltr';
      try { localStorage.setItem('sinko.lang', lang); } catch { /* private window: the links carry it instead */ }
      try { history.replaceState(null, '', '?lang=' + lang + location.hash); } catch { /* file:// */ }
      setTitle();
      keepLang();
    });
  });
  setTitle();
  keepLang();

  // Copy the message for an AI: the clipboard where the browser allows it, else the text is left selected for the user to copy.
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    const box = document.getElementById(btn.getAttribute('data-copy'));
    const status = btn.parentNode.querySelector('.copied');
    function say(key) {
      if (!status) return;
      status.textContent = status.getAttribute('data-' + key);
      status.hidden = false;
      setTimeout(() => { status.hidden = true; }, 6000);
    }
    function byHand() {
      box.focus();
      box.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* left selected */ }
      say(ok ? 'done' : 'select');
    }
    btn.addEventListener('click', () => {
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(box.value).then(() => say('done'), byHand);
      else byHand();
    });
  });
})();
