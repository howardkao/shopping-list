// Landing-page client behavior. Externalized from landing.html so the page can ship a
// strict Content-Security-Policy without `script-src 'unsafe-inline'`.

(function bounceOAuthCallbackToSignin() {
  // If an OAuth provider returns the user to `/` instead of `/signin` (because the marketing
  // page is the public root), bounce to `/signin` so the SPA's `getRedirectResult` /
  // password-reset handler can complete the flow.
  var path = window.location.pathname;
  if (path !== '/' && path !== '') return;
  var q = window.location.search || '';
  var h = window.location.hash || '';
  if (!q && !h) return;
  var qh = q + h;
  if (/apiKey|oobCode|mode|state|code|scope|authType|__firebase|id_token|access_token|session_state|signInWithRedirect/i.test(qh)) {
    window.location.replace('/signin' + q + h);
  }
})();

(function typedWordHero() {
  var el = document.getElementById('typed-word');
  if (!el) return;
  var words = [
    'milk', 'eggs', 'worcestershire', 'bread', 'mozzarella',
    'coffee', 'gnocchi', 'bananas', 'sriracha', 'butter',
    'parmesan', 'chicken',
  ];
  var wi = 0, ci = 0, del = false;
  function tick() {
    var w = words[wi];
    if (!del) {
      ci++;
      el.textContent = w.slice(0, ci);
      if (ci === w.length) {
        el.classList.add('blink');
        return setTimeout(function () { el.classList.remove('blink'); del = true; tick(); }, 1700);
      }
      setTimeout(tick, 85 + Math.random() * 55);
    } else {
      ci--;
      el.textContent = w.slice(0, ci);
      if (ci === 0) {
        del = false;
        wi = (wi + 1) % words.length;
        el.classList.add('blink');
        return setTimeout(function () { el.classList.remove('blink'); tick(); }, 300);
      }
      setTimeout(tick, 40);
    }
  }
  el.classList.add('blink');
  setTimeout(function () { el.classList.remove('blink'); tick(); }, 800);
})();
