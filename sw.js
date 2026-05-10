/* Foundry Service Worker — offline-first */

const CACHE = 'foundry-v28';
const ASSETS = [
  './foundry.html',
  './app.html',
  './app.css',
  './app.js',
  './styles.css',
  './script.js',
  './foundry.css',
  './foundry.js',
  './scorebook-export.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const MEDIA_ASSETS = [
  './BetweenInnings/BiG GiRL TaLK -CJ Beatty.mp3',
  './BetweenInnings/Glory Days.mp3',
  './BetweenInnings/Light Em Up.mp3',
  './BetweenInnings/North Carolina.mp3',
  './BetweenInnings/Row My Boat ft. CJ Beatty.mp3',
  './BetweenInnings/Swing.mp3',
  './BetweenInnings/Tokyo Drift.mp3',
  './BetweenInnings/We Ready.mp3',
  './sounds/Angerdingus.mp3',
  './sounds/Homerun.mp3',
  './sounds/K Riff.mp3',
  './sounds/Rally.mp3',
  './sounds/SoNervy.mp3',
  './sounds/Strikeout.mp3',
  './sounds/awkward-cricket.mp3',
  './sounds/aye-thats-pretty-good.mp3',
  './sounds/bruh-sound-effect.mp3',
  './sounds/catch.mp3',
  './sounds/charge.mp3',
  './sounds/foul-ball.mp3',
  './sounds/homerun.mp3',
  './sounds/horn.mp3',
  './sounds/lizard-button.mp3',
  './sounds/no_crying.mp3',
  './sounds/roar.mp3',
  './sounds/stolenbase.mp3',
  './sounds/yeah-boiii-i-i-i.mp3',
  './walkupsongs/2Pac Americas.mp3',
  './walkupsongs/2Pac California.mp3',
  './walkupsongs/A-O-K.mp3',
  './walkupsongs/ACDC Thunderstruck.mp3',
  './walkupsongs/Beautiful Things.mp3',
  './walkupsongs/Big Dawgs.mp3',
  './walkupsongs/Bring Em Out.mp3',
  './walkupsongs/Bully.mp3',
  './walkupsongs/CrazyTrain.mp3',
  './walkupsongs/DMX Ruff Ryders.mp3',
  './walkupsongs/Eve - Who\'s That Girl.mp3',
  './walkupsongs/Forrest Frank - Never Get Used To This.mp3',
  './walkupsongs/Janelle Monay Beach.mp3',
  './walkupsongs/Katseye Gnarly.mp3',
  './walkupsongs/Katseye Pink Up.mp3',
  './walkupsongs/Last Of My Kind.mp3',
  './walkupsongs/Metallica - Enter Sandman.mp3',
  './walkupsongs/Party In The USA.mp3',
  './walkupsongs/Pretty Girl Walk.mp3',
  './walkupsongs/Rihanna - What\'s My Name.mp3',
  './walkupsongs/Saweetie - Best Friend.mp3',
  './walkupsongs/Silent Watch Me Whip.mp3',
  './walkupsongs/Soda_Pop.mp3',
  './walkupsongs/Soulja Boy Superman.mp3',
  './walkupsongs/Taylor Swift - The Fate of Ophelia.mp3',
  './walkupsongs/The Largest.mp3',
  './walkupsongs/Up.mp3',
  './walkupsongs/Walk_Up_Centerfield.mp3',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).then(() =>
        Promise.all(MEDIA_ASSETS.map(asset => c.add(asset).catch(() => null)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isMedia = url.pathname.includes('/audio/')
    || url.pathname.includes('/sounds/')
    || url.pathname.includes('/walkupsongs/')
    || url.pathname.includes('/BetweenInnings/');

  if (isMedia) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
