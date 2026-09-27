import { createFullscreenController } from './model-fullscreen.js';
import { projects } from './project-config.js';
const project = projects[decodeURIComponent(location.pathname.split('/').pop())];
// Shared presentation derived from Locuinta 2. Media lives in project-config.js.
document.querySelector('.plansa-title').textContent = project.title;
document.querySelector('.project-summary p').textContent = project.subtitle;
const projectLinks = document.querySelectorAll('.house-project-header > a');
projectLinks[0].href = project.previous;
projectLinks[1].href = project.next;
const gallery = document.querySelector('.house-gallery');
const stage = gallery.querySelector('.house-gallery-stage');
const content = gallery.querySelector('.house-gallery-content');
const track = gallery.querySelector('.house-thumbnail-track');
const carousel = gallery.querySelector('.house-thumbnail-carousel');
const openModel = gallery.querySelector('[data-open-model]');
const openFullscreen = gallery.querySelector('[data-fullscreen]');
const closeFullscreen = gallery.querySelector('[data-exit-fullscreen]');
const imageNavigation = gallery.querySelector('[data-image-navigation]');
const counter = gallery.querySelector('[data-image-counter]');
const scrollPrevious = gallery.querySelector('[data-scroll-prev]');
const scrollNext = gallery.querySelector('[data-scroll-next]');
const items = project.media.map(media => {
 const button=document.createElement('button'); button.type='button'; button.className='house-thumbnail';
 button.setAttribute('aria-label',media.alt); button.setAttribute('aria-controls',content.id); button.setAttribute('aria-pressed','false');
 if(media.type==='3d') { button.classList.add('house-model-thumbnail'); button.innerHTML='<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7Z M3 7l9 5 9-5 M12 12v10"/></svg><span>Model 3D</span>'; }
 else { if (media.thumbnail || media.type === 'image') { const image=document.createElement('img'); image.src=media.thumbnail||media.src; image.alt=media.alt; image.decoding='async'; button.append(image); }
 if(['youtube','video'].includes(media.type)) { const label=document.createElement('span'); label.className='house-video-label'; label.textContent='▶ Video'; button.append(label); } }
 track.append(button); return {...media,button};
});
const imageItems = items.filter(item => item.type === 'image');
const modelItem = items.find(item => item.type === '3d');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let activeItem = null;
let generation = 0;
let disposeContent = () => {};
let fullscreen = false;
let previousFocus = null;
const fullscreenController = createFullscreenController(stage, setFullscreen);

// New projects use these renderers through configuration only.
const renderers = { image: renderImage, '3d': renderModel, youtube: renderVideo, video: renderVideo };

async function selectItem(item, reveal = true) {
    if (!item || activeItem === item || !renderers[item.type]) return;
    const version = ++generation;
    if (item.type === 'youtube' && fullscreen) {
        await fullscreenController.exit();
        if (version !== generation) return;
    }
    disposeContent();
    disposeContent = () => {};
    activeItem = item;
    stage.classList.toggle('is-bim-model', item.type === '3d');
    for (const candidate of items) {
        candidate.button.classList.toggle('is-active', candidate === item);
        candidate.button.setAttribute('aria-pressed', String(candidate === item));
    }
    updateControls();
    const cleanup = await renderers[item.type](item, version);
    if (version === generation) disposeContent = cleanup || (() => {});
    else cleanup?.();
    if (reveal && version === generation) revealThumbnail(item.button);
}

function updateControls() {
    const youtube = activeItem?.type === 'youtube';
    openModel.hidden = youtube || !modelItem || activeItem === modelItem || fullscreen;
    openFullscreen.hidden = youtube || fullscreen;
    closeFullscreen.hidden = youtube || !fullscreen;
    imageNavigation.hidden = youtube || items.length < 2;
    counter.hidden = youtube || !fullscreen;
    counter.textContent = fullscreen ? `${items.indexOf(activeItem) + 1} / ${items.length}` : '';
}

function renderImage(item) {
    let surface = content.querySelector('.house-image-surface');
    let image = surface?.querySelector('img');
    // Reuse the server-rendered first image; do not wait for JS to discover it.
    if (!image || image.getAttribute('src') !== item.src) {
        surface = document.createElement('div');
        surface.className = 'house-image-surface';
        image = document.createElement('img');
        image.src = item.src;
        image.alt = item.alt;
        image.draggable = false;
        image.decoding = 'async';
        surface.append(image);
        content.replaceChildren(surface);
    }
    return installImageGestures(surface, image);
}

function renderVideo(item) {
 const surface=document.createElement('div'); surface.className='house-video-surface';
 const player=document.createElement(item.type==='youtube'?'iframe':'video');
 if(item.type==='youtube') { player.src=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.src)}?rel=0&mute=1&controls=1`; player.title=item.alt; player.allowFullscreen=true; player.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share'; player.referrerPolicy='strict-origin-when-cross-origin'; }
 else { player.src=item.src; player.controls=true; player.preload='metadata'; }
 surface.append(player); content.replaceChildren(surface);
 return ()=>{ if(item.type==='video') player.pause(); player.removeAttribute('src'); surface.remove(); };
}
async function renderModel(item,version) {
 content.innerHTML='<canvas class="sport-model-canvas" aria-label="Model 3D: rotire, pan și zoom"></canvas><p class="sport-model-status" role="status">Se încarcă modelul 3D…</p><button class="btn btn-light btn-sm sport-model-reset" type="button" data-reframe disabled>Reîncadrează</button><button class="house-gallery-button model-reverse-light" type="button" data-reverse-light>Inversează lumina</button>';
 try {
  const {createModelViewer}=await import('./model-viewer.js'); if(version!==generation) return;
  const viewer=createModelViewer(content,{...item.viewer,src:item.src,fullscreenController});
  content.querySelector('[data-reverse-light]').addEventListener('click', viewer.reverseLight);
  const reset=content.querySelector('[data-reframe]'); reset.addEventListener('click',viewer.fit);
  viewer.ready.then(()=>{if(version===generation) reset.disabled=false;}).catch(error=>console.error('Model load',error));
  return ()=>viewer.dispose();
 } catch(error) { if(version===generation) content.querySelector('[role="status"]').textContent='Modelul 3D nu este disponibil. Selectează o imagine.'; console.error(error); }
}
function changeImage(direction) {
    const index = items.indexOf(activeItem);
    void selectItem(items[(index + direction + items.length) % items.length], !fullscreen);
}

for (const item of items) item.button.addEventListener('click', () => { void selectItem(item); });
openModel.addEventListener('click', () => { void selectItem(modelItem); stage.focus({ preventScroll: true }); });
gallery.querySelector('[data-image-prev]').addEventListener('click', () => changeImage(-1));
gallery.querySelector('[data-image-next]').addEventListener('click', () => changeImage(1));

function updateCarousel() {
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    // Compare natural item widths with the full row, before arrows take space.
    // This avoids a feedback loop at the fit/overflow breakpoint.
    const needed = items.reduce((sum, item) => sum + item.button.getBoundingClientRect().width, 0) + gap * (items.length - 1);
    const overflowing = needed > carousel.clientWidth + 1;
    carousel.classList.toggle('is-fitting', !overflowing);
    scrollPrevious.hidden = scrollNext.hidden = !overflowing;
    if (!overflowing) track.scrollLeft = 0;
    updateScrollButtons();
}

function updateScrollButtons() {
    scrollPrevious.disabled = track.scrollLeft <= 1;
    scrollNext.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1;
}

function revealThumbnail(button) {
    const itemRect = button.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const offset = itemRect.left < trackRect.left ? itemRect.left - trackRect.left
        : itemRect.right > trackRect.right ? itemRect.right - trackRect.right : 0;
    if (offset) track.scrollBy({ left: offset, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function scrollThumbnails(direction) {
    track.scrollBy({ left: direction * track.clientWidth * .8, behavior: reducedMotion() ? 'auto' : 'smooth' });
}
scrollPrevious.addEventListener('click', () => scrollThumbnails(-1));
scrollNext.addEventListener('click', () => scrollThumbnails(1));
track.addEventListener('scroll', updateScrollButtons, { passive: true });
track.addEventListener('focusin', event => {
    const button = event.target.closest('.house-thumbnail');
    if (button) revealThumbnail(button);
});
const carouselObserver = new ResizeObserver(updateCarousel);
carouselObserver.observe(carousel);
carouselObserver.observe(track);
window.addEventListener('orientationchange', updateCarousel);
window.addEventListener('resize', updateCarousel);

function setFullscreen(enabled) {
    if (fullscreen === enabled) return;
    fullscreen = enabled;
    updateControls();
    if (enabled) closeFullscreen.focus({ preventScroll: true });
    else {
        previousFocus?.focus({ preventScroll: true });
        revealThumbnail(activeItem.button);
    }
}

async function enterFullscreen() {
    previousFocus = document.activeElement;
    await fullscreenController.enter();
}
async function exitFullscreen() { await fullscreenController.exit(); }
openFullscreen.addEventListener('click', enterFullscreen);
closeFullscreen.addEventListener('click', exitFullscreen);
document.addEventListener('keydown', event => {
    if (!fullscreen) return;
    if (event.key === 'Escape') { event.preventDefault(); void exitFullscreen(); }
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        changeImage(event.key === 'ArrowLeft' ? -1 : 1);
    }
    if (event.key === 'Tab') {
        const buttons = [...stage.querySelectorAll('button:not(:disabled), iframe, video[controls]')].filter(button => button.getClientRects().length);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === stage)) {
            event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
        }
    }
});

function installImageGestures(surface, image) {
    const events = new AbortController();
    const listen = (type, callback, options = {}) => surface.addEventListener(type, callback, { ...options, signal: events.signal });
    let scale = 1, x = 0, y = 0, startX = 0, startY = 0, dragging = false;
    let pinchStart = 0, pinchScale = 1, swipeStart = null, gestureWasPinch = false;
    const pinchDistance = touches => Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
    function paint() {
        scale = Math.max(1, Math.min(5, scale));
        x = Math.max(-surface.clientWidth * (scale - 1) / 2, Math.min(surface.clientWidth * (scale - 1) / 2, x));
        y = Math.max(-surface.clientHeight * (scale - 1) / 2, Math.min(surface.clientHeight * (scale - 1) / 2, y));
        image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        surface.classList.toggle('is-zoomed', scale > 1);
    }
    listen('wheel', event => { event.preventDefault(); scale += event.deltaY < 0 ? .15 : -.15; paint(); }, { passive: false });
    listen('dblclick', () => { scale = scale > 1 ? 1 : 2; paint(); });
    listen('contextmenu', event => event.preventDefault());
    listen('pointerdown', event => {
        if (event.pointerType === 'touch' || event.button !== 0 || scale <= 1) return;
        dragging = true; startX = event.clientX - x; startY = event.clientY - y;
        surface.setPointerCapture(event.pointerId);
        surface.classList.add('is-dragging');
    });
    listen('pointermove', event => {
        if (!dragging) return;
        x = event.clientX - startX; y = event.clientY - startY; paint();
    });
    const stopDrag = () => { dragging = false; surface.classList.remove('is-dragging'); };
    listen('pointerup', stopDrag); listen('pointercancel', stopDrag); listen('lostpointercapture', stopDrag);
    listen('touchstart', event => {
        if (event.touches.length === 2) {
            event.preventDefault(); gestureWasPinch = true; swipeStart = null;
            pinchStart = pinchDistance(event.touches); pinchScale = scale;
        } else if (event.touches.length === 1) {
            gestureWasPinch = false;
            startX = event.touches[0].clientX - x; startY = event.touches[0].clientY - y;
            swipeStart = scale === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
        }
    }, { passive: false });
    listen('touchmove', event => {
        if (event.touches.length === 2 && pinchStart) {
            event.preventDefault(); scale = pinchScale * pinchDistance(event.touches) / pinchStart; paint();
        } else if (event.touches.length === 1 && scale > 1) {
            event.preventDefault(); x = event.touches[0].clientX - startX; y = event.touches[0].clientY - startY; paint();
        } else if (event.touches.length === 1 && swipeStart) {
            // Let vertical page scrolling proceed and cancel gallery navigation for it.
            const dx = event.touches[0].clientX - swipeStart.x;
            const dy = event.touches[0].clientY - swipeStart.y;
            if (Math.abs(dy) > 24 && Math.abs(dy) >= Math.abs(dx)) swipeStart = null;
        }
    }, { passive: false });
    listen('touchend', event => {
        if (event.touches.length === 1) {
            startX = event.touches[0].clientX - x; startY = event.touches[0].clientY - y;
        }
        if (event.touches.length) return;
        if (scale === 1 && swipeStart && !gestureWasPinch) {
            const dx = event.changedTouches[0].clientX - swipeStart.x;
            const dy = event.changedTouches[0].clientY - swipeStart.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) changeImage(dx < 0 ? 1 : -1);
        }
        pinchStart = 0; swipeStart = null;
    });
    listen('touchcancel', () => { pinchStart = 0; swipeStart = null; });
    return () => events.abort();
}

void selectItem(imageItems[0] || items[0], false);
updateCarousel();
window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    generation++;
    disposeContent();
    carouselObserver.disconnect();
    fullscreenController.dispose();
});
