/* Marche Arrière : mode hors ligne. Réseau d'abord (pour recevoir les mises à jour), copie locale si pas de réseau. */
var CACHE = 'marche-arriere-v33';
var CORE = ['./', './index.html', './apple-touch-icon.png', './icon-512.png', './manifest.webmanifest'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(CORE); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  e.respondWith((function(){
    var net = fetch(req, {cache: 'no-cache'}).then(function(res){
      if (res && res.ok && url.origin === self.location.origin){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
      }
      return res;
    });
    var timeout = new Promise(function(_, rej){ setTimeout(rej, 3000); });
    return Promise.race([net, timeout]).catch(function(){
      return caches.match(req, {ignoreSearch: true}).then(function(hit){
        return hit || caches.match('./index.html');
      });
    });
  })());
});
