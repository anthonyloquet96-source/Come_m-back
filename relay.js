/* Marche Arrière : relais de télécommande (partagé par l'app et remote.html).
   - Transport : ntfy.sh (gratuit, sans compte). Le relais ne voit que des octets chiffrés.
   - Le code de jumelage (≈ 99 bits) ne quitte jamais les deux téléphones : les noms de canaux
     et la clé AES-GCM en sont dérivés par SHA-256.
   - Chaque message porte une date et un nonce : un message rejoué ou trop vieux est ignoré.
   - Aucune dépendance. Si ce fichier ou le réseau manque, l'app fonctionne comme avant. */
(function(root){
  'use strict';
  var HOST = 'https://ntfy.sh';
  var ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; /* 31 signes, sans 0 O 1 I L */
  var LEN = 20, MAX_AGE = 60000, SEEN_MAX = 200;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function supported(){ return !!(root.crypto && root.crypto.subtle && root.EventSource && root.fetch); }

  function newSecret(){
    var out = '', buf = new Uint8Array(64), i;
    while (out.length < LEN){
      root.crypto.getRandomValues(buf);
      for (i = 0; i < buf.length && out.length < LEN; i++){
        if (buf[i] < 248) out += ALPHA[buf[i] % 31]; /* 248 = 8 × 31 : tirage sans biais */
      }
    }
    return format(out);
  }
  function format(s){ return s.replace(/(.{5})(?=.)/g, '$1-'); }
  /* accepte minuscules, espaces, tirets ; renvoie « XXXXX-XXXXX-XXXXX-XXXXX » ou null */
  function normalize(str){
    var s = String(str || '').toUpperCase().replace(/[\s\-_.]/g, '');
    if (s.length !== LEN) return null;
    for (var i = 0; i < s.length; i++) if (ALPHA.indexOf(s[i]) < 0) return null;
    return format(s);
  }

  function b64e(bytes){
    var s = '', i; for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64d(str){
    var s = atob(str.replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function hex(buf){ return Array.prototype.map.call(new Uint8Array(buf), function(b){ return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function sha(txt){ return root.crypto.subtle.digest('SHA-256', enc.encode(txt)); }

  function derive(secret){
    return Promise.all([sha('ma1|c|' + secret), sha('ma1|s|' + secret), sha('ma1|k|' + secret)]).then(function(r){
      return root.crypto.subtle.importKey('raw', r[2], 'AES-GCM', false, ['encrypt', 'decrypt']).then(function(key){
        return {c: 'ma' + hex(r[0]).slice(0, 40), s: 'mb' + hex(r[1]).slice(0, 40), key: key};
      });
    });
  }

  /* role « host » : écoute les ordres (canal c), répond sur le canal s.
     role « remote » : l'inverse. */
  function open(secret, role){
    var api = {onmessage: null, onstatus: null, status: 'connecting', close: close, send: send, ready: null};
    var dead = false, es = null, retry = 1000, retryT = 0, watchT = 0, lastAlive = 0, keys = null, seen = [];
    var inCh = role === 'host' ? 'c' : 's', outCh = role === 'host' ? 's' : 'c';

    function setStatus(s){ if (api.status !== s){ api.status = s; if (api.onstatus) try { api.onstatus(s); } catch(e){} } }

    function seal(obj){
      var iv = root.crypto.getRandomValues(new Uint8Array(12));
      var msg = Object.assign({}, obj, {t: Date.now(), n: b64e(root.crypto.getRandomValues(new Uint8Array(8)))});
      return root.crypto.subtle.encrypt({name: 'AES-GCM', iv: iv, additionalData: enc.encode(outCh)}, keys.key, enc.encode(JSON.stringify(msg))).then(function(ct){
        var out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
        return b64e(out);
      });
    }
    function unseal(txt){
      var raw = b64d(String(txt).trim());
      return root.crypto.subtle.decrypt({name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc.encode(inCh)}, keys.key, raw.slice(12)).then(function(pt){
        var m = JSON.parse(dec.decode(pt));
        if (!m || typeof m.t !== 'number' || typeof m.n !== 'string') throw new Error('format');
        if (Math.abs(Date.now() - m.t) > MAX_AGE) throw new Error('vieux');
        if (seen.indexOf(m.n) >= 0) throw new Error('rejoué');
        seen.push(m.n); if (seen.length > SEEN_MAX) seen.shift();
        return m;
      });
    }

    function send(obj){
      if (dead || !keys) return Promise.resolve(false);
      return seal(obj).then(function(body){
        return fetch(HOST + '/' + keys[outCh], {method: 'POST', body: body, cache: 'no-store'});
      }).then(function(r){ return !!(r && r.ok); }).catch(function(){ return false; });
    }

    function connect(){
      if (dead) return;
      clearTimeout(retryT); clearTimeout(watchT);
      try { if (es) es.close(); } catch(e){}
      setStatus('connecting');
      var url = HOST + '/' + keys[inCh] + '/sse' + (lastAlive ? '?since=' + Math.max(1, lastAlive - 3) : '');
      try { es = new EventSource(url); } catch(e){ fail(); return; }
      function alive(){
        lastAlive = Math.floor(Date.now() / 1000);
        clearTimeout(watchT); watchT = setTimeout(fail, 80000); /* ntfy envoie un signal toutes les ~45 s */
      }
      es.addEventListener('open', function(){ retry = 1000; setStatus('online'); alive(); });
      es.addEventListener('keepalive', alive);
      es.onmessage = function(ev){
        alive();
        var d; try { d = JSON.parse(ev.data); } catch(e){ return; }
        if (!d || d.event !== 'message' || !d.message) return;
        unseal(d.message).then(function(m){ if (api.onmessage && !dead) api.onmessage(m); }).catch(function(){});
      };
      es.onerror = fail;
    }
    function fail(){
      if (dead) return;
      try { if (es) es.close(); } catch(e){}
      es = null; setStatus('offline');
      clearTimeout(retryT); retryT = setTimeout(connect, retry); retry = Math.min(retry * 2, 15000);
    }
    function close(){ dead = true; clearTimeout(retryT); clearTimeout(watchT); try { if (es) es.close(); } catch(e){} es = null; setStatus('offline'); }
    api.reconnect = function(){ if (!dead && (!es || api.status !== 'online')){ retry = 1000; connect(); } };

    api.ready = derive(secret).then(function(k){ keys = k; connect(); return api; });
    return api;
  }

  root.Relay = {supported: supported, newSecret: newSecret, normalize: normalize, open: open};
})(window);
