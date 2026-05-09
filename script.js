/* ═══════════════════════════════════════════════════════
   Foundry — Main Site Script
   Interaction patterns adapted from the Elevation 168
   design language: scroll reveal, split text, count-up,
   header scroll behaviour, step cycling, feed cycling.
═══════════════════════════════════════════════════════ */

"use strict";

/* ── Header scroll state ── */
(function initHeader() {
  const header = document.getElementById("siteHeader");
  if (!header) return;

  const observer = new IntersectionObserver(
    ([entry]) => header.classList.toggle("scrolled", !entry.isIntersecting),
    { rootMargin: "-86px 0px 0px 0px" }
  );

  const sentinel = document.createElement("div");
  sentinel.style.cssText = "position:absolute;top:0;height:1px;width:1px;pointer-events:none";
  document.body.prepend(sentinel);
  observer.observe(sentinel);
})();

/* ── Game phase meter (replaces week meter) ── */
(function initGameMeter() {
  const phases = ["PRE-GAME", "1ST INNING", "2ND INNING", "3RD INNING", "4TH INNING", "5TH INNING", "6TH INNING", "7TH INNING", "FINAL"];
  const phasePcts = [0, 11, 22, 33, 44, 56, 67, 78, 100];
  const phaseEl = document.getElementById("gamePhase");
  const progressEl = document.getElementById("gameProgress");
  if (!phaseEl || !progressEl) return;

  // Cycle through game phases for demo
  let idx = Math.floor(Math.random() * phases.length);
  phaseEl.textContent = phases[idx];
  progressEl.style.width = phasePcts[idx] + "%";
})();

/* ── Scroll reveal ── */
(function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;

  const io = new IntersectionObserver(
    (entries) => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); io.unobserve(e.target); } }),
    { threshold: 0.14 }
  );

  els.forEach(el => io.observe(el));
})();

/* ── Split text hero animation ── */
(function initSplitText() {
  const targets = document.querySelectorAll("[data-split-text]");
  if (!targets.length) return;

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  targets.forEach(el => {
    const text = el.textContent.trim();
    el.innerHTML = "";

    text.split(" ").forEach((word, wi) => {
      const wordSpan = document.createElement("span");
      wordSpan.className = "split-word";

      word.split("").forEach((char, ci) => {
        const s = document.createElement("span");
        s.className = "split-char";
        s.textContent = char;
        s.style.animationDelay = `${(wi * word.length + ci) * 52}ms`;
        wordSpan.appendChild(s);
      });

      el.appendChild(wordSpan);

      // Space between words
      if (wi < text.split(" ").length - 1) {
        const space = document.createElement("span");
        space.className = "split-space";
        el.appendChild(space);
      }
    });
  });
})();

/* ── Count-up numbers ── */
(function initCountUp() {
  const els = document.querySelectorAll("[data-count-up]");
  if (!els.length) return;

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.countUp, 10);
      io.unobserve(el);

      if (prefersReduced) { el.textContent = target; return; }

      let current = 0;
      const duration = 1200;
      const startTime = performance.now();

      function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        current = Math.round(eased * target);
        el.textContent = current;
        if (progress < 1) requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });
  }, { threshold: 0.6 });

  els.forEach(el => io.observe(el));
})();

/* ── Flow stepper cycling (Command Center section) ── */
(function initFlowStepper() {
  const steps = document.querySelectorAll(".flow-stepper .step");
  if (!steps.length) return;

  let current = 0;
  const interval = 1800;

  function advance() {
    steps[current].classList.remove("active");
    current = (current + 1) % steps.length;
    steps[current].classList.add("active");
  }

  // Only animate when visible
  const container = steps[0].closest(".flow-stepper");
  const io = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      timer = setInterval(advance, interval);
    } else {
      clearInterval(timer);
    }
  }, { threshold: 0.5 });

  let timer = null;
  io.observe(container);
})();

/* ── Live feed cycling (community section) ── */
(function initFeedCycling() {
  const items = document.querySelectorAll(".feed-item");
  if (items.length < 2) return;

  let activeIdx = 0;

  function cycle() {
    items[activeIdx].classList.remove("is-active");
    activeIdx = (activeIdx + 1) % items.length;
    items[activeIdx].classList.add("is-active");
  }

  const container = items[0].closest(".activity-feed");
  if (!container) return;

  const io = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) timer = setInterval(cycle, 2400);
    else clearInterval(timer);
  }, { threshold: 0.4 });

  let timer = null;
  io.observe(container);
})();

/* ── Border-glow mouse-tracking (optional enhancement) ── */
(function initGlowTracking() {
  const glowEls = document.querySelectorAll(".border-glow");
  if (!glowEls.length) return;

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  glowEls.forEach(el => {
    el.addEventListener("mousemove", e => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1);
      const y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1);
      el.style.setProperty("--glow-x", x + "%");
      el.style.setProperty("--glow-y", y + "%");
    }, { passive: true });
  });
})();

/* ── Outcome button press feedback (scorebook demo) ── */
(function initOutcomeButtons() {
  const btns = document.querySelectorAll(".out-btn");
  if (!btns.length) return;

  btns.forEach(btn => {
    btn.addEventListener("click", function () {
      this.style.transform = "scale(0.92)";
      setTimeout(() => { this.style.transform = ""; }, 120);

      // Show a brief amber flash on the at-bat card as feedback
      const card = document.querySelector(".at-bat-card");
      if (card) {
        card.style.borderColor = "rgba(245,158,11,0.8)";
        card.style.boxShadow = "0 0 30px rgba(245,158,11,0.35)";
        setTimeout(() => {
          card.style.borderColor = "";
          card.style.boxShadow = "";
        }, 400);
      }
    });
  });
})();
