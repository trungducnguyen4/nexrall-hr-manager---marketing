// PWA – dang ky Service Worker (file ngoai de tuong thich CSP script-src 'self')
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('SW registration failed:', err);
      });
    });
  }
})();
