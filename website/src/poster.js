(() => {
  'use strict';
  const sectionLinks = [...document.querySelectorAll('.portal-section-menu a')];
  const menuSections = sectionLinks.map(link => document.querySelector(link.hash));
  const syncHeaderHeight = () => document.documentElement.style.setProperty('--header', `${document.querySelector('.site-header').offsetHeight}px`);
  syncHeaderHeight();
  new ResizeObserver(syncHeaderHeight).observe(document.querySelector('.site-header'));

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
    let activeSection = 0;
    menuSections.forEach((section, index) => {
      if (section && section.getBoundingClientRect().top <= header + 32) activeSection = index;
    });
    sectionLinks.forEach((link, index) => {
      if (index === activeSection) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
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
