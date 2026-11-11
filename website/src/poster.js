(() => {
  'use strict';
  const menu = document.querySelector('.menu-button');
  const nav = document.querySelector('#main-menu');
  const closeMenu = () => {
    nav.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'メニューを開く');
  };
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    nav.classList.toggle('open', open);
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

  const chapters = [...document.querySelectorAll('.story-chapter')];
  const chapterLinks = [...document.querySelectorAll('.story-nav a')];
  const motionButton = document.querySelector('#motion-toggle');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let motion = !reduced.matches;
  let scheduled = false;
  const clamp = value => Math.max(0, Math.min(1, value));
  function update() {
    scheduled = false;
    const header = document.querySelector('.site-header').offsetHeight;
    const toolbar = document.querySelector('.story-toolbar').offsetHeight;
    let current = -1;
    chapters.forEach((chapter, index) => {
      const rect = chapter.getBoundingClientRect();
      const stage = chapter.querySelector('.story-stage');
      const sticky = getComputedStyle(stage).position === 'sticky';
      const p = motion && sticky ? clamp((header + toolbar - rect.top) / Math.max(1, rect.height - stage.offsetHeight)) : 1;
      chapter.style.setProperty('--p', p.toFixed(4));
      if (rect.top < innerHeight * .55 && rect.bottom > header + toolbar) current = index;
    });
    chapterLinks.forEach((link, index) => {
      if (index === current) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
  }
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } };
  function setMotion(value) {
    motion = value;
    document.body.dataset.motion = value ? 'on' : 'off';
    motionButton.textContent = `演出 ${value ? 'ON' : 'OFF'}`;
    motionButton.setAttribute('aria-pressed', String(value));
    schedule();
  }
  motionButton.addEventListener('click', () => {
    const active = chapterLinks.findIndex(link => link.hasAttribute('aria-current'));
    const toolbarVisible = document.querySelector('.story-toolbar').getBoundingClientRect().top <= innerHeight;
    setMotion(!motion);
    if (active >= 0 && toolbarVisible) chapters[active].scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  reduced.addEventListener('change', event => setMotion(!event.matches));
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  addEventListener('load', schedule);
  document.fonts.ready.then(schedule);
  setMotion(motion);
})();
