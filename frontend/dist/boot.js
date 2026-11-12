(() => {
  if (location.hostname === 'localhost') {
    const url = new URL(location.href); url.hostname = '127.0.0.1'; location.replace(url.href); return;
  }
  const fail = () => {
    const root = document.getElementById('root');
    if (!root || root.dataset.ready) return;
    root.replaceChildren();
    const text = document.createElement('p'); text.textContent = 'Не удалось загрузить страницу. Обновите её и проверьте соединение.';
    const link = document.createElement('a'); link.href = location.pathname; link.textContent = 'Обновить страницу';
    root.append(text,link);
  };
  window.addEventListener('error', event => { if (event.target instanceof HTMLScriptElement) fail(); }, true);
})();
